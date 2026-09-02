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
  const data = await apiFetch<{ content: string }>("/v1/ai/chat", {
    method: "POST",
    body: JSON.stringify({
      prompt: options.prompt,
      system_prompt: options.systemPrompt,
      model_id: model?.id,
      response_format: options.responseFormat,
      timeout: Math.min(Math.floor((options.timeout || 600000) / 1000), 600),
    }),
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
      }),
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
  const job = await apiFetch<{ id: string }>("/v1/jobs", {
    method: "POST",
    body: JSON.stringify({
      job_type: "comfyui_video",
      payload: {
        prompt: options.prompt,
        modelId: options.modelId,
        aspectRatio: options.aspectRatio,
        duration: options.duration,
        startImage: options.startImage,
        endImage: options.endImage,
        audioUrl: options.audioUrl,
      },
    }),
  });
  return pollJobResult(job.id, 600);
}
