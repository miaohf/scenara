import type { Episode, Shot } from "@/types";
import type { JobStatus } from "@/services/aiApiAdapter";
import { getShotDisplayKey, getShotDisplayLabel, parseShotId } from "@/services/storyboardIdUtils";

export type ShotVideoBadge = "ready" | "running" | "queued" | "unsubmitted" | "failed" | "empty";

export const isActiveJob = (status?: string): boolean =>
  status === "pending" || status === "running";

export const jobTargetShotId = (job: JobStatus): string | undefined => {
  const target = job.target;
  if (!target) return undefined;
  if (target.kind === "video" || target.kind === "nineGrid" || target.kind === "keyframe") {
    return target.shotId;
  }
  return undefined;
};

export const isVideoJob = (job: JobStatus): boolean =>
  job.target?.kind === "video" || job.job_type === "comfyui_video" || job.job_type === "video";

export type JobKind = "video" | "keyframe" | "nineGrid" | "character" | "scene" | "prop" | "variation" | "turnaround" | "threeView" | "image" | "other";

export const jobKind = (job: JobStatus): JobKind => {
  const kind = job.target?.kind;
  if (kind === "video" || kind === "nineGrid" || kind === "keyframe" || kind === "character" || kind === "scene" || kind === "prop" || kind === "variation" || kind === "turnaround" || kind === "threeView") {
    return kind;
  }
  if (job.job_type === "comfyui_video" || job.job_type === "video") return "video";
  if (job.job_type === "image" || job.job_type === "comfyui_image") return "image";
  return "other";
};

export const describeJobTitle = (job: JobStatus, episode?: Episode | null): string => {
  const target = job.target;
  if (!target) {
    if (job.job_type === "image" || job.job_type === "comfyui_image") return "图片";
    if (job.job_type === "comfyui_video" || job.job_type === "video") return "视频";
    return "任务";
  }

  if (target.kind === "video" || target.kind === "nineGrid" || target.kind === "keyframe") {
    const index = episode?.shots.findIndex((shot, shotIndex) => sameShotRef(String(target.shotId), shot.id, shotIndex)) ?? -1;
    return getShotDisplayLabel(String(target.shotId), index >= 0 ? index : 0);
  }

  if (target.kind === "character" || target.kind === "scene" || target.kind === "prop") {
    const list =
      target.kind === "character"
        ? episode?.scriptData?.characters
        : target.kind === "scene"
          ? episode?.scriptData?.scenes
          : episode?.scriptData?.props;
    const item = list?.find((row) => String(row.id) === String(target.id));
    const name = item && ("name" in item ? item.name : item.location);
    return name || (target.kind === "character" ? "角色" : target.kind === "scene" ? "场景" : "道具");
  }

  if (target.kind === "variation") {
    const character = episode?.scriptData?.characters.find((item) => String(item.id) === String(target.characterId));
    return character ? character.name : "造型";
  }

  if (target.kind === "turnaround") {
    const character = episode?.scriptData?.characters.find((item) => String(item.id) === String(target.characterId));
    return character ? character.name : "九宫格";
  }

  if (target.kind === "threeView") {
    const character = episode?.scriptData?.characters.find((item) => String(item.id) === String(target.characterId));
    return character ? character.name : "三视图";
  }

  return "任务";
};

export const describeJob = (job: JobStatus, episode?: Episode | null): string => {
  const target = job.target;
  if (!target) {
    if (job.job_type === "image") return "API 图片";
    if (job.job_type === "comfyui_image") return "ComfyUI 图片";
    if (job.job_type === "comfyui_video" || job.job_type === "video") return "ComfyUI 视频";
    return "生成任务";
  }

  if (target.kind === "video" || target.kind === "nineGrid" || target.kind === "keyframe") {
    const index = episode?.shots.findIndex((shot, shotIndex) => sameShotRef(String(target.shotId), shot.id, shotIndex)) ?? -1;
    const shotLabel = getShotDisplayLabel(String(target.shotId), index >= 0 ? index : 0);
    if (target.kind === "video") return `${shotLabel} 视频`;
    if (target.kind === "nineGrid") return `${shotLabel} 网格`;
    return `${shotLabel} ${target.type === "end" ? "尾帧" : "首帧"}`;
  }

  if (target.kind === "character" || target.kind === "scene" || target.kind === "prop") {
    const list =
      target.kind === "character"
        ? episode?.scriptData?.characters
        : target.kind === "scene"
          ? episode?.scriptData?.scenes
          : episode?.scriptData?.props;
    const item = list?.find((row) => String(row.id) === String(target.id));
    const name = item && ("name" in item ? item.name : item.location);
    const kindLabel = target.kind === "character" ? "角色" : target.kind === "scene" ? "场景" : "道具";
    return name ? `${kindLabel} ${name}` : kindLabel;
  }

  if (target.kind === "variation") {
    const character = episode?.scriptData?.characters.find(
      (item) => String(item.id) === String(target.characterId),
    );
    return character ? `${character.name} 造型` : "角色造型";
  }

  if (target.kind === "turnaround") {
    const character = episode?.scriptData?.characters.find(
      (item) => String(item.id) === String(target.characterId),
    );
    return character ? `${character.name} 九宫格` : "角色九宫格";
  }

  if (target.kind === "threeView") {
    const character = episode?.scriptData?.characters.find(
      (item) => String(item.id) === String(target.characterId),
    );
    return character ? `${character.name} 三视图` : "角色三视图";
  }

  return "生成任务";
};

/** 队列 hover：展示渠道（ComfyUI 工作流 / gpt-image-2 等）。 */
export const describeJobChannel = (job: JobStatus): string => {
  const channel = String(job.channel || "").trim();
  if (channel) return channel;
  if (job.job_type === "comfyui_video" || job.job_type === "comfyui_image") {
    return "ComfyUI (本地)";
  }
  if (job.job_type === "image") return "OpenAI Image";
  if (job.job_type === "video") return "API Video";
  return "未知渠道";
};

export const sortQueueJobs = (jobs: JobStatus[]): JobStatus[] =>
  [...jobs].sort((left, right) => {
    if (left.status === "running" && right.status !== "running") return -1;
    if (right.status === "running" && left.status !== "running") return 1;
    const leftPos = left.queue_position ?? Number.MAX_SAFE_INTEGER;
    const rightPos = right.queue_position ?? Number.MAX_SAFE_INTEGER;
    if (leftPos !== rightPos) return leftPos - rightPos;
    return 0;
  });

export const sameShotRef = (leftId: string, rightId: string, rightIndex = 0): boolean => {
  if (String(leftId) === String(rightId)) return true;
  const leftParsed = parseShotId(leftId);
  const rightParsed = parseShotId(rightId);
  if (leftParsed.mode === "unknown" && rightParsed.mode === "unknown") return false;
  const leftKey = leftParsed.mode === "unknown" ? null : getShotDisplayKey(leftId, 0);
  const rightKey =
    rightParsed.mode === "unknown" ? getShotDisplayKey(rightId, rightIndex) : getShotDisplayKey(rightId, 0);
  if (leftKey && leftKey === rightKey) return true;
  if (leftParsed.mode === "unknown") {
    return getShotDisplayKey(leftId, rightIndex) === rightKey;
  }
  return false;
};

export const findShotVideoJob = (
  jobs: JobStatus[],
  shotId: string,
  shotIndex = 0,
): JobStatus | undefined =>
  sortQueueJobs(jobs).find((job) => {
    const targetId = jobTargetShotId(job);
    return isActiveJob(job.status) && isVideoJob(job) && !!targetId && sameShotRef(targetId, shotId, shotIndex);
  });

/** 同一代图片已经写回时，滞后的 pending/running 任务不能再把界面打成 Queued。 */
export const keyframeImageAlreadyLanded = (
  frame: { imageUrl?: string; generationId?: string } | undefined,
  job: JobStatus | undefined,
): boolean => {
  if (!frame?.imageUrl) return false;
  const jobGenerationId = job?.target?.kind === "keyframe" ? job.target.generationId : undefined;
  return !job || !jobGenerationId || !frame.generationId || jobGenerationId === frame.generationId;
};

export const findShotKeyframeJob = (
  jobs: JobStatus[],
  shotId: string,
  type: "start" | "end",
  shotIndex = 0,
): JobStatus | undefined =>
  sortQueueJobs(jobs).find((job) => {
    const target = job.target;
    const targetId = jobTargetShotId(job);
    return (
      isActiveJob(job.status) &&
      target?.kind === "keyframe" &&
      target.type === type &&
      !!targetId &&
      sameShotRef(targetId, shotId, shotIndex)
    );
  });

export type ShotKeyframeBadge = "ready" | "running" | "queued" | "failed" | "empty";

export const resolveShotKeyframeBadge = (
  shot: Shot,
  jobs: JobStatus[],
  type: "start" | "end",
  shotIndex = 0,
): { status: ShotKeyframeBadge; job?: JobStatus; queuePosition?: number } => {
  const job = findShotKeyframeJob(jobs, shot.id, type, shotIndex);
  const frame = shot.keyframes?.find((keyframe) => keyframe.type === type);
  // 任务状态可能因 SSE/轮询丢包而滞后于已写回的图片结果。
  // 同一代图片已经在时，不能继续用 pending/running 或卡住的 generating 覆盖 READY。
  const effectiveJob = keyframeImageAlreadyLanded(frame, job) ? undefined : job;
  if (effectiveJob && jobDisplayState(effectiveJob, jobs) === "running") {
    return { status: "running", job: effectiveJob };
  }
  if (effectiveJob && isActiveJob(effectiveJob.status)) {
    return { status: "queued", job: effectiveJob, queuePosition: effectiveJob.queue_position ?? undefined };
  }
  if (frame?.status === "generating" && !keyframeImageAlreadyLanded(frame, job)) {
    return { status: "queued", queuePosition: undefined };
  }
  if (frame?.status === "failed") {
    return { status: "failed" };
  }
  if (frame?.imageUrl) {
    return { status: "ready" };
  }
  return { status: "empty" };
};

export const formatJobProgressLabel = (
  job: JobStatus | undefined,
  display: "running" | "queued",
): string => {
  if (display === "queued") {
    return job?.queue_position ? `#${job.queue_position}` : "排队";
  }
  return typeof job?.progress === "number" ? `${job.progress}%` : "生成中";
};

/** 返回最早启动的任务，供需要单一代表任务的旧界面兼容使用。 */
export const primaryRunningJobId = (jobs: JobStatus[]): string | undefined => {
  const running = jobs
    .filter((job) => job.status === "running")
    .sort((left, right) => (left.created_at || "").localeCompare(right.created_at || ""));
  return running[0]?.id;
};

/** Worker 已支持并发时，每一条 running 任务都应显示真实进度。 */
export const jobDisplayState = (job: JobStatus, _jobs: JobStatus[]): "running" | "queued" => {
  return job.status === "running" ? "running" : "queued";
};

export const resolveShotVideoBadge = (
  shot: Shot,
  jobs: JobStatus[],
  shotIndex = 0,
): { status: ShotVideoBadge; job?: JobStatus; queuePosition?: number } => {
  const job = findShotVideoJob(jobs, shot.id, shotIndex);
  if (job && jobDisplayState(job, jobs) === "running") {
    return { status: "running", job };
  }
  if (job && isActiveJob(job.status)) {
    return { status: "queued", job, queuePosition: job.queue_position ?? undefined };
  }
  if (shot.interval?.status === "generating") {
    return { status: "queued", queuePosition: undefined };
  }
  if (shot.interval?.status === "failed") {
    return { status: "failed" };
  }
  if (shot.interval?.videoUrl) {
    return { status: "ready" };
  }
  if (shot.keyframes?.some((frame) => frame.type === "start" && frame.imageUrl)) {
    return { status: "unsubmitted" };
  }
  return { status: "empty" };
};
