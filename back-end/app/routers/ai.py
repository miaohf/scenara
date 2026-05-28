from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user
from app.db.session import get_db
from app.models.settings import UserSettings
from app.models.user import User
from app.schemas.ai import (
    ChatRequest,
    ChatResponse,
    ComfyImageRequest,
    ImageRequest,
    ImageResponse,
)
from app.services.ai.chat import AiConfigError, chat_completion, generate_image_openai_compatible
from app.services.ai.comfyui import run_comfy_image

router = APIRouter(prefix="/v1/ai", tags=["ai"])


async def _get_registry(user: User, db: AsyncSession) -> dict:
    result = await db.execute(select(UserSettings).where(UserSettings.user_id == user.id))
    row = result.scalar_one_or_none()
    return (row.model_registry if row else None) or {}


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
                "modelId": body.model_id,
                "aspectRatio": body.aspect_ratio,
                "continuityReferenceImage": body.continuity_reference_image,
                "characterReferenceImage": body.character_reference_image,
                "img2imgDenoise": body.img2img_denoise,
                "seed": body.seed,
                "steps": body.steps,
            },
        )
    except AiConfigError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return ImageResponse(
        image_base64=result["image_base64"],
        image_data_url=result.get("image_data_url"),
    )
