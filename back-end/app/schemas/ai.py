from typing import Any

from pydantic import BaseModel, Field


class SettingsResponse(BaseModel):
    model_registry: dict[str, Any] = Field(default_factory=dict)
    updated_at: str | None = None


class SettingsUpdate(BaseModel):
    model_registry: dict[str, Any]


class ChatRequest(BaseModel):
    prompt: str
    system_prompt: str | None = None
    image_urls: list[str] = Field(default_factory=list)
    model_id: str | None = None
    response_format: str | None = None  # "json" | None
    timeout: int = 600


class ChatResponse(BaseModel):
    content: str


class ImageRequest(BaseModel):
    prompt: str
    model_id: str | None = None
    aspect_ratio: str = "16:9"
    reference_images: list[str] = Field(default_factory=list)
    reference_annotations: list[str] = Field(default_factory=list)


class ImageResponse(BaseModel):
    # 媒体落盘后不再回传 base64；仅在存储不可用降级时才有值
    image_base64: str | None = None
    image_data_url: str | None = None
    image_url: str | None = None
    media_key: str | None = None


class ComfyImageRequest(BaseModel):
    prompt: str
    negative_prompt: str | None = None
    model_id: str | None = None
    aspect_ratio: str = "16:9"
    reference_images: list[str] = Field(default_factory=list)
    continuity_reference_image: str | None = None
    character_reference_image: str | None = None
    img2img_denoise: float | None = None
    steps: int | None = None
    workflow_name: str | None = None


class ComfyVideoRequest(BaseModel):
    prompt: str
    model_id: str | None = None
    aspect_ratio: str = "16:9"
    duration: float = 5
    start_image: str | None = None
    end_image: str | None = None
    reference_images: list[str] = Field(default_factory=list)
    reference_videos: list[str] = Field(default_factory=list)
    reference_audios: list[str] = Field(default_factory=list)
    audio_url: str | None = None
    seed: int | None = None
    steps: int | None = None
    enable_stage2_upscaling: bool | None = None
    workflow_name: str | None = None


class VideoResponse(BaseModel):
    video_base64: str | None = None
    video_data_url: str | None = None
    video_url: str | None = None
    media_key: str | None = None


# Backward-compatible alias for job payloads
ComfyVideoJobPayload = ComfyVideoRequest


class TtsRequest(BaseModel):
    text: str
    model_id: str | None = None
    voice: str | None = None
    response_format: str | None = None
    timeout: int = 120


class TtsResponse(BaseModel):
    audio_base64: str
    audio_data_url: str
    mime_type: str | None = None


class JobCreateRequest(BaseModel):
    job_type: str  # image | video | comfyui_image | comfyui_video
    episode_id: str | None = None
    # 写回目标：{kind, id, shotId, characterId, type...}，完成后 Worker 据此更新剧集
    target: dict[str, Any] | None = None
    payload: dict[str, Any] = Field(default_factory=dict)


class JobResponse(BaseModel):
    id: str
    job_type: str
    status: str
    progress: int
    message: str | None = None
    result: dict[str, Any] | None = None
    error: str | None = None
    created_at: str
    updated_at: str
    episode_id: str | None = None
    target: dict[str, Any] | None = None
    # 排队可见性：Worker concurrency=1 时长时间 pending 属正常，前端据此区分「排队」与「Worker 掉线」
    queue_position: int | None = None
    queue_running: bool | None = None
    # 渠道摘要：ComfyUI 工作流名 / gpt-image-2 等（不含大图 payload）
    channel: str | None = None

    model_config = {"from_attributes": True}
