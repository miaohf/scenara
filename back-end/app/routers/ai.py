from typing import Annotated
import logging

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user
from app.db.session import get_db
from app.models.user import User
from app.routers.settings import _resolve_registry_for_user
from app.schemas.ai import (
    ChatRequest,
    ChatResponse,
    ComfyImageRequest,
    ComfyVideoRequest,
    ImageRequest,
    ImageResponse,
    TtsRequest,
    TtsResponse,
    VideoResponse,
)
from app.services.ai.chat import AiConfigError, chat_completion, generate_image_openai_compatible
from app.services.ai.comfyui import (
    list_workflow_templates,
    load_workflow_template,
    run_comfy_image,
    run_comfy_video,
)
from app.services.ai.tts import generate_speech

router = APIRouter(prefix="/v1/ai", tags=["ai"])
logger = logging.getLogger(__name__)


async def _get_registry(user: User, db: AsyncSession) -> dict:
    return await _resolve_registry_for_user(user.id, db, persist=False)


@router.post("/chat", response_model=ChatResponse)
async def ai_chat(
    body: ChatRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> ChatResponse:
    registry = await _get_registry(current_user, db)
    try:
        content = await chat_completion(
            registry,
            prompt=body.prompt,
            system_prompt=body.system_prompt,
            model_id=body.model_id,
            response_format=body.response_format,
            timeout=body.timeout,
        )
    except AiConfigError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return ChatResponse(content=content)


@router.post("/chat-json", response_model=ChatResponse)
async def ai_chat_json(
    body: ChatRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> ChatResponse:
    body.response_format = "json"
    return await ai_chat(body, current_user, db)


@router.post("/image", response_model=ImageResponse)
async def ai_image(
    body: ImageRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> ImageResponse:
    registry = await _get_registry(current_user, db)
    try:
        image_base64 = await generate_image_openai_compatible(
            registry,
            prompt=body.prompt,
            model_id=body.model_id,
            aspect_ratio=body.aspect_ratio,
        )
    except AiConfigError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return ImageResponse(image_base64=image_base64)


@router.post("/comfyui/image", response_model=ImageResponse)
async def ai_comfyui_image(
    body: ComfyImageRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> ImageResponse:
    registry = await _get_registry(current_user, db)
    try:
        result = await run_comfy_image(
            registry,
            {
                "prompt": body.prompt,
                "negativePrompt": body.negative_prompt,
                "modelId": body.model_id,
                "aspectRatio": body.aspect_ratio,
                "continuityReferenceImage": body.continuity_reference_image,
                "characterReferenceImage": body.character_reference_image,
                "img2imgDenoise": body.img2img_denoise,
                "seed": body.seed,
                "steps": body.steps,
                "workflowName": body.workflow_name,
            },
            user_id=current_user.id,
        )
    except AiConfigError as exc:
        logger.warning("ComfyUI image failed: %s", exc)
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return ImageResponse(
        image_base64=result.get("image_base64"),
        image_data_url=result.get("image_data_url"),
        image_url=result.get("image_url"),
        media_key=result.get("media_key"),
    )


@router.post("/comfyui/video", response_model=VideoResponse)
async def ai_comfyui_video(
    body: ComfyVideoRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> VideoResponse:
    registry = await _get_registry(current_user, db)
    try:
        result = await run_comfy_video(
            registry,
            {
                "prompt": body.prompt,
                "modelId": body.model_id,
                "aspectRatio": body.aspect_ratio,
                "duration": body.duration,
                "startImage": body.start_image,
                "endImage": body.end_image,
                "audioUrl": body.audio_url,
            },
            user_id=current_user.id,
        )
    except AiConfigError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return VideoResponse(
        video_base64=result.get("video_base64"),
        video_data_url=result.get("video_data_url"),
        video_url=result.get("video_url"),
        media_key=result.get("media_key"),
    )


@router.post("/tts", response_model=TtsResponse)
async def ai_tts(
    body: TtsRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> TtsResponse:
    registry = await _get_registry(current_user, db)
    try:
        result = await generate_speech(
            registry,
            text=body.text,
            model_id=body.model_id,
            voice=body.voice,
            response_format=body.response_format or "opus",
            timeout=body.timeout,
        )
    except AiConfigError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return TtsResponse(
        audio_base64=result["audio_base64"],
        audio_data_url=result["audio_data_url"],
        mime_type=result.get("mime_type"),
    )


@router.get("/workflows")
async def ai_list_workflows(
    current_user: Annotated[User, Depends(get_current_user)],
) -> dict[str, list[str]]:
    _ = current_user
    return {"workflows": list_workflow_templates()}


@router.get("/workflows/{workflow_name}")
async def ai_get_workflow(
    workflow_name: str,
    current_user: Annotated[User, Depends(get_current_user)],
) -> dict:
    _ = current_user
    try:
        return load_workflow_template(workflow_name)
    except AiConfigError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
