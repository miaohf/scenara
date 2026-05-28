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


class ImageResponse(BaseModel):
    image_base64: str
    image_data_url: str | None = None


class ComfyImageRequest(BaseModel):
    prompt: str
    model_id: str | None = None
    aspect_ratio: str = "16:9"
    continuity_reference_image: str | None = None
    character_reference_image: str | None = None
    img2img_denoise: float | None = None
    seed: int | None = None
    steps: int | None = None


class ComfyVideoJobPayload(BaseModel):
    prompt: str
    model_id: str | None = None
    aspect_ratio: str = "16:9"
    duration: float = 5
    start_image: str
    end_image: str | None = None
    audio_url: str | None = None


class JobCreateRequest(BaseModel):
    job_type: str  # video | comfyui | script_parse
    episode_id: str | None = None
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

    model_config = {"from_attributes": True}
