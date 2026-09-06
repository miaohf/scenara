import type { Episode } from "@/types";
import { extractJobMedia, type JobStatus } from "./aiApiAdapter";
import { sameShotRef } from "./generationQueue";

const sameId = (left: unknown, right: unknown): boolean => String(left) === String(right);

const isActive = (status?: string): boolean =>
  status === "pending" || status === "running";

const isImageJob = (jobType?: string): boolean =>
  !jobType || jobType === "comfyui_image";

export const episodeHasGeneratingWork = (episode: Episode | null | undefined): boolean => {
  if (!episode) return false;
  const script = episode.scriptData;
  if (
    script?.characters.some(
      (character) =>
        character.status === "generating" ||
        character.variations?.some((variation) => variation.status === "generating") ||
        character.turnaround?.status === "generating_image",
    )
  ) {
    return true;
  }
  if (script?.scenes.some((scene) => scene.status === "generating")) return true;
  if ((script?.props || []).some((prop) => prop.status === "generating")) return true;
  return episode.shots.some(
    (shot) =>
      shot.keyframes?.some((frame) => frame.status === "generating") ||
      shot.interval?.status === "generating" ||
      shot.nineGrid?.status === "generating_image",
  );
};

/**
 * 按服务端任务对账剧集：
 * - 已完成（或失败但带了媒体）且目标还在 generating / 没有图 → 写回媒体
 * - 失败且没有媒体、目标还在 generating → 标 failed
 * - 排队/执行中 → 保持 generating
 * - markOrphans 时：仍标 generating 但没有任何对应任务 → 视为中断
 *   轮询中途不要启用，避免任务刚完成、列表尚未带上结果时把镜头标失败。
 */
export function reconcileEpisodeWithJobs(
  episode: Episode,
  jobs: JobStatus[],
  options?: { markOrphans?: boolean },
): { episode: Episode; changed: boolean } {
  const markOrphans = options?.markOrphans !== false;
  let next: Episode = {
    ...episode,
    scriptData: episode.scriptData
      ? {
          ...episode.scriptData,
          characters: episode.scriptData.characters.map((item) => ({
            ...item,
            variations: item.variations?.map((variation) => ({ ...variation })),
            turnaround: item.turnaround ? { ...item.turnaround } : item.turnaround,
          })),
          scenes: episode.scriptData.scenes.map((item) => ({ ...item })),
          props: (episode.scriptData.props || []).map((item) => ({ ...item })),
        }
      : episode.scriptData,
    shots: episode.shots.map((shot) => ({
      ...shot,
      keyframes: shot.keyframes?.map((frame) => ({ ...frame })),
      interval: shot.interval ? { ...shot.interval } : shot.interval,
      nineGrid: shot.nineGrid ? { ...shot.nineGrid } : shot.nineGrid,
      dubbing: shot.dubbing ? { ...shot.dubbing } : shot.dubbing,
    })),
  };

  let changed = false;
  const claimed = new Set<string>();

  const markClaimed = (key: string) => claimed.add(key);

  for (const job of jobs) {
    const target = job.target;
    if (!target) continue;
    const mediaKind = isImageJob(job.job_type) ? "image" : "video";
    let url: string | undefined;
    if (job.status === "completed" || job.status === "failed") {
      try {
        url = extractJobMedia(job, mediaKind);
      } catch {
        url = undefined;
      }
    }

    if (target.kind === "character" || target.kind === "scene" || target.kind === "prop") {
      const key = `${target.kind}:${target.id}`;
      markClaimed(key);
      const list =
        target.kind === "character"
          ? next.scriptData?.characters
          : target.kind === "scene"
            ? next.scriptData?.scenes
            : next.scriptData?.props;
      const item = list?.find((row) => sameId(row.id, target.id));
      if (!item) continue;
      if (url && (item.status === "generating" || !item.referenceImage)) {
        item.referenceImage = url;
        item.status = "completed";
        changed = true;
      } else if ((job.status === "failed" || job.status === "cancelled") && item.status === "generating" && !url) {
        item.status = job.status === "cancelled" && item.referenceImage ? "completed" : job.status === "cancelled" ? "pending" : "failed";
        changed = true;
      } else if (isActive(job.status) && item.status !== "generating") {
        item.status = "generating";
        changed = true;
      }
      continue;
    }

    if (target.kind === "variation") {
      const key = `variation:${target.characterId}:${target.id}`;
      markClaimed(key);
      const character = next.scriptData?.characters.find((row) => sameId(row.id, target.characterId));
      const variation = character?.variations?.find((row) => sameId(row.id, target.id));
      if (!variation) continue;
      if (url && (variation.status === "generating" || !variation.referenceImage)) {
        variation.referenceImage = url;
        variation.status = "completed";
        changed = true;
      } else if ((job.status === "failed" || job.status === "cancelled") && variation.status === "generating" && !url) {
        variation.status = job.status === "cancelled" && variation.referenceImage ? "completed" : job.status === "cancelled" ? "pending" : "failed";
        changed = true;
      } else if (isActive(job.status) && variation.status !== "generating") {
        variation.status = "generating";
        changed = true;
      }
      continue;
    }

    if (target.kind === "turnaround") {
      const key = `turnaround:${target.characterId}`;
      markClaimed(key);
      const character = next.scriptData?.characters.find((row) => sameId(row.id, target.characterId));
      if (!character) continue;
      const turnaround = character.turnaround ? { ...character.turnaround } : { panels: [], status: "generating_image" as const };
      if (url && (turnaround.status === "generating_image" || !turnaround.imageUrl)) {
        turnaround.imageUrl = url;
        turnaround.status = "completed";
        changed = true;
      } else if ((job.status === "failed" || job.status === "cancelled") && turnaround.status === "generating_image" && !url) {
        turnaround.status = job.status === "cancelled" && turnaround.imageUrl ? "completed" : "failed";
        changed = true;
      } else if (isActive(job.status) && turnaround.status !== "generating_image") {
        turnaround.status = "generating_image";
        changed = true;
      }
      character.turnaround = turnaround;
      continue;
    }

    const shot = next.shots.find(
      (row, index) => sameId(row.id, target.shotId) || sameShotRef(String(target.shotId), row.id, index),
    );
    if (!shot) continue;

    if (target.kind === "keyframe") {
      const key = `keyframe:${shot.id}:${target.type}`;
      markClaimed(key);
      if (!shot.keyframes) shot.keyframes = [];
      let frame = shot.keyframes.find((row) => row.type === target.type);
      if (!frame && ((job.status === "completed" && url) || isActive(job.status))) {
        frame = {
          id: `kf-${shot.id}-${target.type}`,
          type: target.type,
          visualPrompt: "",
          status: "pending",
        };
        shot.keyframes.push(frame);
        changed = true;
      }
      if (!frame) continue;
      if (url && (frame.status === "generating" || !frame.imageUrl)) {
        frame.imageUrl = url;
        frame.status = "completed";
        changed = true;
      } else if ((job.status === "failed" || job.status === "cancelled") && frame.status === "generating" && !url) {
        frame.status = job.status === "cancelled" && frame.imageUrl ? "completed" : job.status === "cancelled" ? "pending" : "failed";
        changed = true;
      } else if (isActive(job.status) && frame.status !== "generating") {
        frame.status = "generating";
        changed = true;
      }
      continue;
    }

    if (target.kind === "video") {
      const key = `video:${shot.id}`;
      markClaimed(key);
      if (!shot.interval) continue;
      if (url && (shot.interval.status === "generating" || !shot.interval.videoUrl)) {
        shot.interval.videoUrl = url;
        shot.interval.status = "completed";
        changed = true;
      } else if ((job.status === "failed" || job.status === "cancelled") && shot.interval.status === "generating" && !url) {
        shot.interval.status = job.status === "cancelled" && shot.interval.videoUrl ? "completed" : job.status === "cancelled" ? "pending" : "failed";
        changed = true;
      } else if (isActive(job.status) && shot.interval.status !== "generating") {
        shot.interval.status = "generating";
        changed = true;
      }
      continue;
    }

    if (target.kind === "nineGrid") {
      const key = `nineGrid:${shot.id}`;
      markClaimed(key);
      if (!shot.nineGrid) continue;
      if (url && (shot.nineGrid.status === "generating_image" || !shot.nineGrid.imageUrl)) {
        shot.nineGrid.imageUrl = url;
        shot.nineGrid.status = "completed";
        changed = true;
      } else if ((job.status === "failed" || job.status === "cancelled") && shot.nineGrid.status === "generating_image" && !url) {
        shot.nineGrid.status = job.status === "cancelled" && shot.nineGrid.imageUrl ? "completed" : "failed";
        changed = true;
      } else if (isActive(job.status) && shot.nineGrid.status !== "generating_image") {
        shot.nineGrid.status = "generating_image";
        changed = true;
      }
    }
  }

  if (markOrphans) {
    if (next.scriptData) {
      next.scriptData.characters = next.scriptData.characters.map((character) => {
        const nextChar = { ...character };
        if (nextChar.status === "generating" && !claimed.has(`character:${nextChar.id}`)) {
          nextChar.status = nextChar.referenceImage ? "completed" : "failed";
          changed = true;
        }
        nextChar.variations = nextChar.variations?.map((variation) => {
          if (variation.status === "generating" && !claimed.has(`variation:${nextChar.id}:${variation.id}`)) {
            changed = true;
            return { ...variation, status: variation.referenceImage ? "completed" : "failed" };
          }
          return variation;
        });
        if (
          nextChar.turnaround &&
          nextChar.turnaround.status === "generating_image" &&
          !claimed.has(`turnaround:${nextChar.id}`)
        ) {
          nextChar.turnaround = {
            ...nextChar.turnaround,
            status: nextChar.turnaround.imageUrl ? "completed" : "failed",
          };
          changed = true;
        }
        if (
          nextChar.turnaround &&
          nextChar.turnaround.status === "generating_panels"
        ) {
          nextChar.turnaround = {
            ...nextChar.turnaround,
            status: nextChar.turnaround.panels?.length ? "panels_ready" : "failed",
          };
          changed = true;
        }
        return nextChar;
      });
      next.scriptData.scenes = next.scriptData.scenes.map((scene) => {
        if (scene.status === "generating" && !claimed.has(`scene:${scene.id}`)) {
          changed = true;
          return { ...scene, status: scene.referenceImage ? "completed" : "failed" };
        }
        return scene;
      });
      next.scriptData.props = (next.scriptData.props || []).map((prop) => {
        if (prop.status === "generating" && !claimed.has(`prop:${prop.id}`)) {
          changed = true;
          return { ...prop, status: prop.referenceImage ? "completed" : "failed" };
        }
        return prop;
      });
    }

    next.shots = next.shots.map((shot) => {
      const keyframes = shot.keyframes?.map((frame) => {
        if (frame.status === "generating" && !claimed.has(`keyframe:${shot.id}:${frame.type}`)) {
          changed = true;
          return { ...frame, status: frame.imageUrl ? "completed" : "failed" };
        }
        return frame;
      });
      const interval =
        shot.interval?.status === "generating" && !claimed.has(`video:${shot.id}`)
          ? ((changed = true), { ...shot.interval, status: shot.interval.videoUrl ? "completed" : "failed" as const })
          : shot.interval;
      const nineGrid =
        shot.nineGrid &&
        (shot.nineGrid.status === "generating_image" || shot.nineGrid.status === "generating") &&
        !claimed.has(`nineGrid:${shot.id}`)
          ? ((changed = true), {
              ...shot.nineGrid,
              status: shot.nineGrid.imageUrl ? "completed" : "failed" as const,
            })
          : shot.nineGrid?.status === "generating_panels"
            ? ((changed = true), { ...shot.nineGrid, status: shot.nineGrid.panels?.length ? "panels_ready" : "failed" as const })
            : shot.nineGrid;
      const dubbing =
        shot.dubbing?.status === "generating"
          ? ((changed = true), { ...shot.dubbing, status: shot.dubbing.audioUrl ? "completed" : "failed" as const })
          : shot.dubbing;
      return { ...shot, keyframes, interval, nineGrid, dubbing };
    });
  }

  if (episode.isParsingScript || episode.scriptGenerationCheckpoint) {
    changed = true;
  }

  if (!changed) {
    return { episode, changed: false };
  }

  return {
    episode: {
      ...next,
      isParsingScript: false,
      scriptGenerationCheckpoint: null,
    },
    changed: true,
  };
}

const hasMediaUrl = (value: unknown): value is string => typeof value === "string" && value.length > 0;

function takeServerMedia<T extends { status?: string }>(
  local: T,
  server: T | undefined,
  urlKey: keyof T,
  doneStatus: NonNullable<T["status"]> = "completed" as NonNullable<T["status"]>,
): T {
  if (!server) return local;
  const serverUrl = server[urlKey];
  const localUrl = local[urlKey];
  if (hasMediaUrl(serverUrl) && !hasMediaUrl(localUrl)) {
    return { ...local, [urlKey]: serverUrl, status: doneStatus };
  }
  return local;
}

/** Worker 已把媒体写进剧集时，用服务端快照补上本地还空着的图/视频。 */
export function mergeEpisodeMediaFromServer(
  local: Episode,
  server: Episode,
): { episode: Episode; changed: boolean } {
  let changed = false;

  const mergeAsset = <T extends { id: string; status?: string; referenceImage?: string }>(
    localItems: T[] | undefined,
    serverItems: T[] | undefined,
  ): T[] | undefined => {
    if (!localItems) return localItems;
    return localItems.map((item) => {
      const next = takeServerMedia(item, serverItems?.find((row) => sameId(row.id, item.id)), "referenceImage");
      if (next !== item) changed = true;
      return next;
    });
  };

  const scriptData = local.scriptData
    ? {
        ...local.scriptData,
        characters: (local.scriptData.characters || []).map((character) => {
          const serverChar = server.scriptData?.characters.find((row) => sameId(row.id, character.id));
          let next = takeServerMedia(character, serverChar, "referenceImage");
          if (next !== character) changed = true;
          const variations = character.variations?.map((variation) => {
            const merged = takeServerMedia(
              variation,
              serverChar?.variations?.find((row) => sameId(row.id, variation.id)),
              "referenceImage",
            );
            if (merged !== variation) changed = true;
            return merged;
          });
          const turnaround = character.turnaround
            ? takeServerMedia(character.turnaround, serverChar?.turnaround, "imageUrl")
            : character.turnaround;
          if (turnaround !== character.turnaround) {
            changed = true;
            next = { ...next, turnaround };
          }
          return variations !== character.variations ? { ...next, variations } : next;
        }),
        scenes: mergeAsset(local.scriptData.scenes, server.scriptData?.scenes) || local.scriptData.scenes,
        props: mergeAsset(local.scriptData.props, server.scriptData?.props) || local.scriptData.props,
      }
    : local.scriptData;

  const shots = local.shots.map((shot, index) => {
    const serverShot = server.shots.find(
      (row, rowIndex) => sameId(row.id, shot.id) || sameShotRef(String(shot.id), row.id, rowIndex) || sameShotRef(String(row.id), shot.id, index),
    );
    const keyframes = shot.keyframes?.map((frame) => {
      const merged = takeServerMedia(
        frame,
        serverShot?.keyframes?.find((row) => row.type === frame.type),
        "imageUrl",
      );
      if (merged !== frame) changed = true;
      return merged;
    });
    const interval = shot.interval
      ? takeServerMedia(shot.interval, serverShot?.interval, "videoUrl")
      : shot.interval;
    if (interval !== shot.interval) changed = true;
    const nineGrid = shot.nineGrid
      ? takeServerMedia(shot.nineGrid, serverShot?.nineGrid, "imageUrl")
      : shot.nineGrid;
    if (nineGrid !== shot.nineGrid) changed = true;
    return { ...shot, keyframes, interval, nineGrid };
  });

  if (!changed) {
    return { episode: local, changed: false };
  }
  return { episode: { ...local, scriptData, shots }, changed: true };
}
