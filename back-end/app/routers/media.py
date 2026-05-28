import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status

from app.core.deps import get_current_user
from app.models.user import User
from app.schemas.project import MediaUploadRequest, MediaUploadResponse
from app.services.storage import ensure_bucket, generate_presigned_download_url, generate_presigned_upload_url

router = APIRouter(prefix="/v1/media", tags=["media"])


@router.post("/upload-url", response_model=MediaUploadResponse)
async def create_upload_url(
    body: MediaUploadRequest,
    current_user: Annotated[User, Depends(get_current_user)],
) -> MediaUploadResponse:
    try:
        ensure_bucket()
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"MinIO unavailable: {exc}",
        ) from exc

    safe_name = body.filename.replace("/", "_").replace("\\", "_")
    media_key = f"users/{current_user.id}/{uuid.uuid4().hex}_{safe_name}"
    upload_url = generate_presigned_upload_url(media_key, body.content_type)
    return MediaUploadResponse(upload_url=upload_url, media_key=media_key)


@router.get("/{media_key:path}")
async def get_media_url(
    media_key: str,
    current_user: Annotated[User, Depends(get_current_user)],
) -> dict[str, str]:
    if not media_key.startswith(f"users/{current_user.id}/"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")

    try:
        download_url = generate_presigned_download_url(media_key)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"MinIO unavailable: {exc}",
        ) from exc

    return {"url": download_url}
