import type { ChatOptions, GenerationTarget, ImageGenerateOptions, VideoGenerateOptions } from "../types/model";
import type { ChatModelDefinition } from "../types/model";
import { apiFetch } from "@/lib/api-client";
import { getAccessToken } from "@/lib/auth";
import { getGenerationEpisodeId, notifyGenerationJob } from "./generationContext";

export const isApiAiMode = (): boolean => {
  if (typeof process !== "undefined" && process.env.NEXT_PUBLIC_USE_API_AI === "true") {
    return true;
  }
  return false;
};

export async function syncModelRegistryToServer(state: unknown): Promise<void> {
  await apiFetch("/v1/settings/models", {
    method: "PUT",
    body: JSON.stringify({ model_registry: state }),
  });
}

export async function loadModelRegistryFromServer(): Promise<unknown | null> {
  try {
    const data = await apiFetch<{ model_registry: unknown }>("/v1/settings/models");
    return data.model_registry;
  } catch {
    return null;
  }
}

export async function apiCallChat(
  options: ChatOptions,
  model?: ChatModelDefinition,
): Promise<string> {
  const timeoutMs = options.timeout || 600000;
  const data = await apiFetch<{ content: string }>("/v1/ai/chat", {
    method: "POST",
    signal: options.abortSignal,
    body: JSON.stringify({
      prompt: options.prompt,
      system_prompt: options.systemPrompt,
      image_urls: options.imageUrls || [],
      model_id: model?.id,
      response_format: options.responseFormat,
      timeout: Math.min(Math.floor(timeoutMs / 1000), 600),
    }),
    timeoutMs,
  });
  return data.content;
}

export async function apiCallImage(options: ImageGenerateOptions): Promise<string> {
  const data = await apiFetch<JobMediaResult>("/v1/ai/image", {
    method: "POST",
    body: JSON.stringify({
      prompt: options.prompt,
      aspect_ratio: options.aspectRatio || "16:9",
      reference_images: options.referenceImages || [],
      reference_annotations: options.referenceAnnotations || [],
    }),
  });
  return resolveImageResult(data);
}

/**
 * 生成结果的统一形态：媒体已落盘时只回 URL，存储不可用降级时才回 base64。
 * 剧集里保存的是这个字符串，因此优先取 URL 才能避免 payload 再被 base64 撑爆。
 */
interface JobMediaResult {
  image_url?: string;
  image_data_url?: string;
  image_base64?: string;
  video_url?: string;
  video_data_url?: string;
  video_base64?: string;
  media_key?: string;
}

const asDataUrl = (value: string, mime: string): string =>
  value.startsWith("data:") ? value : `data:${mime};base64,${value}`;

function resolveImageResult(result: JobMediaResult | undefined): string {
  const url = result?.image_url || result?.image_data_url;
  if (url) return url;
  if (result?.image_base64) return asDataUrl(result.image_base64, "image/png");
  throw new Error("任务完成但未返回图片数据");
}

function resolveVideoResult(result: JobMediaResult | undefined): string {
  const url = result?.video_url || result?.video_data_url;
  if (url) return url;
  if (result?.video_base64) return asDataUrl(result.video_base64, "video/mp4");
  throw new Error("任务完成但未返回视频数据");
}

export async function apiCallComfyImage(
  options: ImageGenerateOptions & { modelId?: string; steps?: number },
): Promise<string> {
  // 异步任务：避免长连接在等待 ComfyUI 时被刷新/代理掐断（出图成功但前端报失败）
  const payload = {
    prompt: options.prompt,
    negativePrompt: options.negativePrompt,
    modelId: options.modelId,
    aspectRatio: options.aspectRatio || "16:9",
    referenceImages: options.referenceImages,
    continuityReferenceImage: options.continuityReferenceImage,
    characterReferenceImage: options.characterReferenceImage,
    img2imgDenoise: options.img2imgDenoise,
    seed: options.seed,
    steps: options.steps,
    workflowName: options.workflowName,
  };
  console.info("[ComfyUI Image] 提交异步任务 comfyui_image", {
    modelId: options.modelId,
    workflowName: options.workflowName,
    steps: options.steps,
    referenceCount: options.referenceImages?.length || 0,
  });
  console.info("[ComfyUI Image] 最终提示词 payload", {
    prompt: payload.prompt,
    negativePrompt: payload.negativePrompt,
    hasWardrobeLock: /(?:^|[,.\n])\s*Attire:\s*\S+/i.test(payload.prompt || ""),
  });
  const job = await createJob("comfyui_image", payload, options.episodeId, options.target);
  options.onJobCreated?.(job);
  console.info("[ComfyUI Image] 任务已创建:", job.id);
  if (options.waitForResult === false) {
    return "";
  }
  return waitForJobResult(job.id, "image", (next) => options.onJobCreated?.(next));
}

export class JobCancelledError extends Error {
  constructor(message = "任务已取消") {
    super(message);
    this.name = "JobCancelledError";
  }
}

export const isJobCancelled = (error: unknown): boolean => {
  if (error instanceof JobCancelledError) return true;
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return /任务已取消|用户取消|job cancelled|cancelled/i.test(message);
};

const TERMINAL_JOB_STATUSES = new Set(["completed", "failed", "cancelled"]);

export interface JobStatus {
  id: string;
  job_type?: string;
  status: string;
  progress?: number;
  message?: string;
  result?: JobMediaResult;
  error?: string;
  created_at?: string;
  episode_id?: string | null;
  target?: GenerationTarget | null;
  queue_position?: number | null;
  queue_running?: boolean | null;
}

/** 创建异步任务。带上 episode_id 后，离开页面也能按剧集把结果找回来。 */
export async function createJob(
  jobType: string,
  payload: unknown,
  episodeId?: string,
  target?: GenerationTarget,
): Promise<JobStatus> {
  const job = await apiFetch<JobStatus>("/v1/jobs", {
    method: "POST",
    body: JSON.stringify({
      job_type: jobType,
      episode_id: episodeId ?? getGenerationEpisodeId(),
      target,
      payload,
    }),
  });
  notifyGenerationJob(job);
  return job;
}

export async function fetchJob(jobId: string): Promise<JobStatus> {
  return apiFetch<JobStatus>(`/v1/jobs/${jobId}`);
}

export async function cancelJob(jobId: string): Promise<JobStatus> {
  return apiFetch<JobStatus>(`/v1/jobs/${jobId}/cancel`, { method: "POST" });
}

const sameTarget = (left?: GenerationTarget | null, right?: GenerationTarget | null): boolean => {
  if (!left || !right || left.kind !== right.kind) return false;
  if (left.kind === "variation") {
    return left.kind === right.kind && left.id === right.id && left.characterId === right.characterId;
  }
  if (left.kind === "turnaround" || left.kind === "threeView") {
    return left.kind === right.kind && left.characterId === right.characterId;
  }
  if (left.kind === "keyframe") {
    return left.kind === right.kind && left.shotId === right.shotId && left.type === right.type;
  }
  if (left.kind === "video" || left.kind === "nineGrid") {
    return left.kind === right.kind && left.shotId === right.shotId;
  }
  return left.id === (right as { id: string }).id;
};

/** 取消某个生成目标上仍在排队/执行的任务。找不到任务时返回 0，调用方仍应回滚本地 generating。 */
export async function cancelJobsForTarget(
  target: GenerationTarget,
  episodeId?: string,
): Promise<number> {
  const id = episodeId ?? getGenerationEpisodeId();
  if (!id) return 0;
  const jobs = await listEpisodeJobs(id, ["pending", "running"]);
  const matches = jobs.filter((job) => sameTarget(job.target, target));
  await Promise.all(matches.map((job) => cancelJob(job.id)));
  return matches.length;
}

/** 列出某剧集的任务，用于重新进入页面后恢复生成结果。 */
export async function listEpisodeJobs(
  episodeId: string,
  statuses?: string[],
): Promise<JobStatus[]> {
  const params = new URLSearchParams({ episode_id: episodeId });
  if (statuses?.length) params.set("job_status", statuses.join(","));
  return apiFetch<JobStatus[]>(`/v1/jobs?${params.toString()}`);
}

/** 没有任何任务在跑、自己又排在队首时，才认为 Worker 可能掉线（约 2 分钟）。 */
const STALLED_QUEUE_ATTEMPTS = 40;
const JOB_NETWORK_RETRY_LOG_EVERY = 10;
const JOB_MAX_POLL_ATTEMPTS_IMAGE = 2400;
const JOB_MAX_POLL_ATTEMPTS_VIDEO = 2400;

export function extractJobMedia(
  job: JobStatus,
  kind: "image" | "video",
): string {
  return kind === "image" ? resolveImageResult(job.result) : resolveVideoResult(job.result);
}

function mergeJobEvent(jobId: string, event: Partial<JobStatus>, previous?: JobStatus): JobStatus {
  return {
    id: jobId,
    job_type: event.job_type ?? previous?.job_type,
    status: event.status || previous?.status || "pending",
    progress: event.progress ?? previous?.progress,
    message: event.message ?? previous?.message,
    result: event.result ?? previous?.result,
    error: event.error ?? previous?.error,
    episode_id: event.episode_id ?? previous?.episode_id,
    target: event.target ?? previous?.target,
    created_at: event.created_at ?? previous?.created_at,
    queue_position: event.queue_position ?? previous?.queue_position,
    queue_running: event.queue_running ?? previous?.queue_running,
  };
}

async function waitForJobViaStream(
  jobId: string,
  onProgress?: (job: JobStatus) => void,
): Promise<JobStatus> {
  const token = getAccessToken();
  const headers: HeadersInit = {};
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(`/api/v1/jobs/${jobId}/stream`, { headers });
  if (!response.ok || !response.body) {
    throw new Error(`任务推送连接失败 (${response.status})`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let buffer = "";
  let latest: JobStatus | undefined;

  const consume = (chunk: string) => {
    const blocks = chunk.split(/\r?\n\r?\n/);
    buffer = blocks.pop() || "";
    for (const block of blocks) {
      const dataLine = block
        .split(/\r?\n/)
        .find((line) => line.startsWith("data:"));
      if (!dataLine) continue;
      try {
        const event = JSON.parse(dataLine.slice(5).trim()) as Partial<JobStatus>;
        latest = mergeJobEvent(jobId, event, latest);
        onProgress?.(latest);
      } catch {
        // 忽略心跳或残缺帧
      }
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    consume(buffer + decoder.decode(value, { stream: true }));
    if (latest && TERMINAL_JOB_STATUSES.has(latest.status)) {
      try {
        await reader.cancel();
      } catch {
        // ignore
      }
      return latest;
    }
  }
  consume(buffer + decoder.decode() + "\n\n");
  if (latest) return latest;
  throw new Error("任务推送结束但没有收到状态");
}

async function pollJobResult(
  jobId: string,
  maxAttempts = 2400,
  onProgress?: (job: JobStatus) => void,
): Promise<JobStatus> {
  let stalledAttempts = 0;
  let networkErrorStreak = 0;
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    let job: JobStatus;
    try {
      job = await fetchJob(jobId);
      networkErrorStreak = 0;
    } catch (error) {
      // 浏览器与后端短暂断开时，任务仍可能在 Celery/ComfyUI 中继续执行。
      // 不把一次轮询失败转换为任务失败，保留轮询窗口并在恢复后继续拿状态。
      networkErrorStreak += 1;
      if (networkErrorStreak === 1 || networkErrorStreak % JOB_NETWORK_RETRY_LOG_EVERY === 0) {
        console.warn(
          `[Job ${jobId}] 状态查询暂时失败，继续重试 (${networkErrorStreak}):`,
          error instanceof Error ? error.message : error,
        );
      }
      continue;
    }
    onProgress?.(job);

    if (job.status === "running" || job.status === "pending") {
      if (i > 0 && i % 10 === 0) {
        const queue = job.queue_position ? ` queue=${job.queue_position}` : "";
        console.info(
          `[Job ${jobId}] ${job.status} ${job.progress ?? 0}%${queue} ${job.message || ""}`,
        );
      }
      const stalled = job.status === "pending" && !job.queue_running && (job.queue_position ?? 1) <= 1;
      stalledAttempts = stalled ? stalledAttempts + 1 : 0;
      if (stalledAttempts >= STALLED_QUEUE_ATTEMPTS) {
        throw new Error(
          "任务已入队但没有 Worker 在消费，请检查 Celery Worker：\n" +
            "cd back-end && uv run celery -A app.workers.celery_app.celery_app worker --loglevel=info",
        );
      }
      continue;
    }

    if (TERMINAL_JOB_STATUSES.has(job.status)) return job;
  }
  throw new Error("任务超时");
}

async function waitForJobResult(
  jobId: string,
  kind: "image" | "video",
  onProgress?: (job: JobStatus) => void,
): Promise<string> {
  const trackProgress = (job: JobStatus) => {
    notifyGenerationJob(job);
    onProgress?.(job);
  };
  let job: JobStatus;
  try {
  job = await waitForJobViaStream(jobId, trackProgress);
  } catch (error) {
    console.warn("[Job] SSE 不可用，回退轮询:", error instanceof Error ? error.message : error);
    job = await pollJobResult(
      jobId,
      kind === "image" ? JOB_MAX_POLL_ATTEMPTS_IMAGE : JOB_MAX_POLL_ATTEMPTS_VIDEO,
      trackProgress,
    );
  }

  if (job.status === "cancelled") throw new JobCancelledError(job.error || "任务已取消");
  if (job.status === "failed") throw new Error(job.error || "任务失败");
  if (job.status === "completed") {
    try {
      return extractJobMedia(job, kind);
    } catch {
      // SSE 首包可能只有 status，补一次查询拿结果
    }
  }

  const latest = await fetchJob(jobId);
  if (latest.status === "completed") return extractJobMedia(latest, kind);
  if (latest.status === "cancelled") throw new JobCancelledError(latest.error || "任务已取消");
  if (latest.status === "failed") throw new Error(latest.error || "任务失败");
  throw new Error("任务未完成");
}

export async function apiCallVideo(options: VideoGenerateOptions): Promise<string> {
  const job = await createJob(
    "video",
    {
      prompt: options.prompt,
      aspectRatio: options.aspectRatio,
      duration: options.duration,
      imageBase64: options.startImage,
    },
    options.episodeId,
    options.target,
  );
  options.onJobCreated?.(job);
  return waitForJobResult(job.id, "video", options.onJobCreated);
}

export async function apiCallComfyVideo(
  options: VideoGenerateOptions & { modelId?: string },
): Promise<string> {
  const job = await createJob(
    "comfyui_video",
    {
      prompt: options.prompt,
      modelId: options.modelId,
      aspectRatio: options.aspectRatio || "16:9",
      duration: options.duration ?? 5,
      steps: options.steps,
      startImage: options.startImage,
      endImage: options.endImage,
      referenceImages: options.referenceImages,
      referenceVideos: options.referenceVideos,
      referenceAudios: options.referenceAudios,
      audioUrl: options.audioUrl,
      workflowName: options.workflowName,
    },
    options.episodeId,
    options.target,
  );
  options.onJobCreated?.(job);
  return waitForJobResult(job.id, "video", options.onJobCreated);
}

/** ComfyUI 工作流名候选（与后端 comfyui.py 一致） */
export function workflowNameCandidates(workflowName: string): string[] {
  const trimmed = workflowName.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("http") || trimmed.startsWith("/")) {
    return [trimmed];
  }
  const base = trimmed.endsWith(".json") ? trimmed.slice(0, -5) : trimmed;
  return Array.from(new Set([base, base.replace(/-/g, "_"), base.replace(/_/g, "-")]));
}

/** 从后端加载 ComfyUI 工作流模板（单一数据源：back-end/workflows/） */
export async function fetchComfyWorkflowTemplate(workflowName: string): Promise<unknown> {
  const candidates = workflowNameCandidates(workflowName);
  if (candidates.length === 0) {
    throw new Error("ComfyUI 工作流名称为空，请在模型中配置 workflowName。");
  }

  for (const name of candidates) {
    try {
      return await apiFetch<unknown>(`/v1/ai/workflows/${encodeURIComponent(name)}`);
    } catch {
      // try next candidate
    }
  }

  throw new Error(
    `ComfyUI 工作流模板未找到：${workflowName}（已尝试 ${candidates.join("、")}）`,
  );
}

export interface TtsCallOptions {
  text: string;
  modelId?: string;
  voice?: string;
  responseFormat?: string;
  timeout?: number;
}

/** 配音 TTS（OpenAI /v1/audio/speech 兼容，如 IndexTTS） */
export async function apiCallTts(options: TtsCallOptions): Promise<string> {
  const data = await apiFetch<{ audio_data_url: string; audio_base64: string; mime_type?: string }>(
    "/v1/ai/tts",
    {
      method: "POST",
      body: JSON.stringify({
        text: options.text,
        model_id: options.modelId,
        voice: options.voice,
        response_format: options.responseFormat,
        timeout: options.timeout ?? 120,
      }),
    },
  );
  if (data.audio_data_url) return data.audio_data_url;
  const mime = data.mime_type || "audio/opus";
  return `data:${mime};base64,${data.audio_base64}`;
}
