import type { Character, Episode, Keyframe, Shot } from "@/types";
import { extractJobMedia, type JobStatus } from "./aiApiAdapter";
import { sameShotRef } from "./generationQueue";
import { addCharacterImageHistory, mergeCharacterImageHistories } from "./characterImageHistory";

const sameId = (left: unknown, right: unknown): boolean => String(left) === String(right);

const isActive = (status?: string): boolean =>
  status === "pending" || status === "running";

/** 签名 URL 的 exp/sig 会变，用 media_key 判断是不是同一张图。 */
const mediaIdentity = (url: string): string => {
  const marker = "/media/raw/";
  const index = url.indexOf(marker);
  if (index >= 0) {
    return decodeURIComponent(url.slice(index + marker.length).split("?")[0] || "");
  }
  return url;
};

const isNewerMedia = (current: string | undefined, incoming: string | undefined): boolean => {
  if (!incoming) return false;
  if (!current) return true;
  return mediaIdentity(current) !== mediaIdentity(incoming);
};

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
        character.turnaround?.status === "generating_image" ||
        character.threeView?.status === "generating",
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
 * - 已完成（或失败但带了媒体）且目标还在 generating / 没有图 / 仍是旧 media_key → 写回媒体
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
  // API 为了展示最近任务按 created_at 倒序返回；对账必须反过来处理，
  // 否则旧的已完成任务会在最新重生成结果之后再次覆盖媒体 URL。
  const orderedJobs = [...jobs].sort((left, right) => {
    const leftTime = left.created_at ? Date.parse(left.created_at) : 0;
    const rightTime = right.created_at ? Date.parse(right.created_at) : 0;
    if (leftTime !== rightTime) return leftTime - rightTime;
    return left.id.localeCompare(right.id);
  });
  const next: Episode = {
    ...episode,
    scriptData: episode.scriptData
      ? {
          ...episode.scriptData,
          characters: episode.scriptData.characters.map((item) => ({
            ...item,
            variations: item.variations?.map((variation) => ({ ...variation })),
            turnaround: item.turnaround ? { ...item.turnaround } : item.turnaround,
            threeView: item.threeView ? { ...item.threeView } : item.threeView,
            imageHistory: item.imageHistory?.map((entry) => ({ ...entry })),
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

  for (const job of orderedJobs) {
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
      if (url && isNewerMedia(item.referenceImage, url)) {
        if (target.kind === "character") {
          const character = item as Character;
          const shouldActivate = character.status === "generating";
          if (character.referenceImage) addCharacterImageHistory(character, character.referenceImage, "generated", character.visualPrompt);
          addCharacterImageHistory(character, url, "generated", character.visualPrompt);
          if (shouldActivate) character.activeImageView = "casting";
        }
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
      if (url && isNewerMedia(variation.referenceImage, url)) {
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
      const shouldActivate = turnaround.status === "generating_image";
      if (url && isNewerMedia(turnaround.imageUrl, url)) {
        turnaround.imageUrl = url;
        turnaround.status = "completed";
        if (shouldActivate) character.activeImageView = "turnaround";
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

    if (target.kind === "threeView") {
      const key = `threeView:${target.characterId}`;
      markClaimed(key);
      const character = next.scriptData?.characters.find((row) => sameId(row.id, target.characterId));
      if (!character) continue;
      const threeView = character.threeView ? { ...character.threeView } : { status: "generating" as const };
      const shouldActivate = threeView.status === "generating";
      if (url && isNewerMedia(threeView.imageUrl, url)) {
        threeView.imageUrl = url;
        threeView.status = "completed";
        if (shouldActivate) character.activeImageView = "threeView";
        changed = true;
      } else if ((job.status === "failed" || job.status === "cancelled") && threeView.status === "generating" && !url) {
        threeView.status = job.status === "cancelled" && threeView.imageUrl ? "completed" : "failed";
        changed = true;
      } else if (isActive(job.status) && threeView.status !== "generating") {
        threeView.status = "generating";
        changed = true;
      }
      character.threeView = threeView;
      continue;
    }

    const shot = next.shots.find(
      (row, index) => sameId(row.id, target.shotId) || sameShotRef(String(target.shotId), row.id, index),
    );
    if (!shot) continue;

    if (target.kind === "keyframe") {
      const key = `keyframe:${shot.id}:${target.type}`;
      if (!shot.keyframes) shot.keyframes = [];
      let frame = shot.keyframes.find((row) => row.type === target.type);
      // 旧生成任务可能在用户复制/上传/重新生成后才完成。只要当前帧已有
      // generationId 且与任务不一致，就不能让该任务回写或认领当前帧。
      if (frame?.generationId && frame.generationId !== target.generationId) continue;
      markClaimed(key);
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
      if (url && isNewerMedia(frame.imageUrl, url)) {
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
      if (url && isNewerMedia(shot.interval.videoUrl, url)) {
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
      if (url && isNewerMedia(shot.nineGrid.imageUrl, url)) {
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
        if (nextChar.threeView?.status === "generating" && !claimed.has(`threeView:${nextChar.id}`)) {
          nextChar.threeView = {
            ...nextChar.threeView,
            status: nextChar.threeView.imageUrl ? "completed" : "failed",
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
      const keyframes = shot.keyframes?.map((frame): Keyframe => {
        if (frame.status === "generating" && !claimed.has(`keyframe:${shot.id}:${frame.type}`)) {
          changed = true;
          return { ...frame, status: frame.imageUrl ? "completed" : "failed" };
        }
        return frame;
      });
      const interval: Shot["interval"] =
        shot.interval?.status === "generating" && !claimed.has(`video:${shot.id}`)
          ? ((changed = true), { ...shot.interval, status: shot.interval.videoUrl ? "completed" : "failed" as const })
          : shot.interval;
      const nineGrid: Shot["nineGrid"] =
        shot.nineGrid &&
        shot.nineGrid.status === "generating_image" &&
        !claimed.has(`nineGrid:${shot.id}`)
          ? ((changed = true), {
              ...shot.nineGrid,
              status: shot.nineGrid.imageUrl ? "completed" : "failed" as const,
            })
          : shot.nineGrid?.status === "generating_panels"
            ? ((changed = true), { ...shot.nineGrid, status: shot.nineGrid.panels?.length ? "panels_ready" : "failed" as const })
            : shot.nineGrid;
      const dubbing: Shot["dubbing"] =
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
  const localStatus = String(local.status || "");
  const localIsGenerating = ["generating", "generating_image", "generating_panels"].includes(localStatus);
  // 服务端刷新只负责补齐空媒体或替换“本地正在生成”的旧预览。
  // 如果用户刚手动复制/上传了一张 completed 图片，不能因为服务端快照
  // 仍是旧 URL 就把用户的选择覆盖掉。
  if (
    hasMediaUrl(serverUrl) &&
    isNewerMedia(hasMediaUrl(localUrl) ? String(localUrl) : undefined, String(serverUrl)) &&
    (!hasMediaUrl(localUrl) || localIsGenerating)
  ) {
    return { ...local, [urlKey]: serverUrl, status: doneStatus };
  }
  return local;
}

/** Worker 已把媒体写进剧集时，用服务端快照补上本地还空着或仍是旧 media_key 的图/视频。 */
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
          const threeView = character.threeView
            ? takeServerMedia(character.threeView, serverChar?.threeView, "imageUrl")
            : character.threeView;
          if (threeView !== character.threeView) {
            changed = true;
            next = { ...next, threeView };
          }
          const imageHistory = mergeCharacterImageHistories(character.imageHistory, serverChar?.imageHistory);
          if (imageHistory !== character.imageHistory) {
            changed = true;
            next = { ...next, imageHistory };
          }
          if (serverChar?.activeImageView && serverChar.activeImageView !== character.activeImageView) {
            changed = true;
            next = { ...next, activeImageView: serverChar.activeImageView };
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
      const serverFrame = serverShot?.keyframes?.find((row) => row.type === frame.type);
      // 服务端旧快照可能在本地新版本保存完成前返回。generationId 存在时，
      // 只能合并同一版本的结果，避免轮询把手动复制的帧换回旧图。
      if (
        frame.generationId &&
        serverFrame &&
        serverFrame.generationId !== frame.generationId
      ) {
        return frame;
      }
      const merged = takeServerMedia(
        frame,
        serverFrame,
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
