import type { ChatOptions, ImageGenerateOptions, VideoGenerateOptions } from "../types/model";
import type { ChatModelDefinition } from "../types/model";
import { apiFetch } from "@/lib/api-client";

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
    body: JSON.stringify({
      prompt: options.prompt,
      system_prompt: options.systemPrompt,
      model_id: model?.id,
      response_format: options.responseFormat,
      timeout: Math.min(Math.floor(timeoutMs / 1000), 600),
    }),
    timeoutMs,
  });
  return data.content;
}

export async function apiCallImage(options: ImageGenerateOptions): Promise<string> {
  const data = await apiFetch<{ image_base64: string }>("/v1/ai/image", {
    method: "POST",
    body: JSON.stringify({
      prompt: options.prompt,
      aspect_ratio: options.aspectRatio || "16:9",
      reference_images: options.referenceImages || [],
    }),
  });
  return data.image_base64;
}

export async function apiCallComfyImage(
  options: ImageGenerateOptions & { modelId?: string; steps?: number },
): Promise<string> {
  // Qwen 关键帧可能超过 5 分钟；给上传与代理留余量
  const data = await apiFetch<{ image_base64: string; image_data_url?: string }>(
    "/v1/ai/comfyui/image",
    {
      method: "POST",
      body: JSON.stringify({
        prompt: options.prompt,
        negative_prompt: options.negativePrompt,
        model_id: options.modelId,
        aspect_ratio: options.aspectRatio || "16:9",
        continuity_reference_image: options.continuityReferenceImage,
        character_reference_image: options.characterReferenceImage,
        img2img_denoise: options.img2imgDenoise,
        seed: options.seed,
        steps: options.steps,
        workflow_name: options.workflowName,
      }),
      timeoutMs: 1_800_000,
    },
  );
  return data.image_data_url || `data:image/png;base64,${data.image_base64}`;
}

async function pollJobResult(jobId: string, maxAttempts = 600): Promise<string> {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const status = await apiFetch<{
      status: string;
      result?: { video_base64?: string; video_data_url?: string };
      error?: string;
    }>(`/v1/jobs/${jobId}`);
    if (status.status === "completed") {
      const url = status.result?.video_data_url;
      if (url) return url;
      const b64 = status.result?.video_base64;
      if (b64) return b64.startsWith("data:") ? b64 : `data:video/mp4;base64,${b64}`;
    }
    if (status.status === "failed") {
      throw new Error(status.error || "任务失败");
    }
  }
  throw new Error("任务超时");
}

export async function apiCallVideo(options: VideoGenerateOptions): Promise<string> {
  const job = await apiFetch<{ id: string }>("/v1/jobs", {
    method: "POST",
    body: JSON.stringify({
      job_type: "video",
      payload: {
        prompt: options.prompt,
        aspectRatio: options.aspectRatio,
        duration: options.duration,
        imageBase64: options.startImage,
      },
    }),
  });
  return pollJobResult(job.id, 180);
}

export async function apiCallComfyVideo(
  options: VideoGenerateOptions & { modelId?: string },
): Promise<string> {
  // 与图片一致走同步 ComfyUI 端点，避免 Celery Worker 未启动时任务永久 pending
  const data = await apiFetch<{ video_base64: string; video_data_url?: string }>(
    "/v1/ai/comfyui/video",
    {
      method: "POST",
      body: JSON.stringify({
        prompt: options.prompt,
        model_id: options.modelId,
        aspect_ratio: options.aspectRatio || "16:9",
        duration: options.duration ?? 5,
        start_image: options.startImage,
        end_image: options.endImage,
        audio_url: options.audioUrl,
      }),
      timeoutMs: 7_200_000,
    },
  );
  const url = data.video_data_url;
  if (url) return url;
  const b64 = data.video_base64;
  return b64.startsWith("data:") ? b64 : `data:video/mp4;base64,${b64}`;
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
