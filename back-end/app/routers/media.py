import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Response, status
from fastapi.responses import FileResponse

from app.core.config import get_settings
from app.core.deps import get_current_user
from app.models.user import User
from app.schemas.project import MediaUploadRequest, MediaUploadResponse
from app.services.storage import (
    MediaStoreError,
    build_media_url,
    ensure_bucket,
    generate_presigned_download_url,
    generate_presigned_upload_url,
    local_media_path,
    media_content_type,
    parse_signed_media_uri,
    read_media_bytes,
    verify_media_signature,
)

router = APIRouter(prefix="/v1/media", tags=["media"])

# 生成图/视频以签名 URL 存进 episode payload，浏览器 <img src> 无法携带 Authorization，
# 因此这条路由用 HMAC 签名校验代替 Bearer 鉴权。必须声明在 catch-all 之前。
_IMMUTABLE_CACHE = "public, max-age=31536000, immutable"


@router.api_route("/verify", methods=["GET", "HEAD"])
async def verify_media_access(
    uri: Annotated[str | None, Query(description="原始媒体 URI（含 query）")] = None,
    x_original_uri: Annotated[str | None, Header()] = None,
) -> Response:
    """签名校验（不读文件）。网关或调试可用；2xx 放行，403 拒绝。"""
    original = uri or x_original_uri or ""
    parsed = parse_signed_media_uri(original)
    if parsed is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invalid media URI")
    media_key, exp, sig = parsed
    if not verify_media_signature(media_key, exp, sig):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invalid media signature")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/raw/{media_key:path}")
async def get_raw_media(
    media_key: str,
    exp: Annotated[int, Query(description="签名过期时间（Unix 秒）")],
    sig: Annotated[str, Query(description="HMAC 签名")],
) -> Response:
    if not verify_media_signature(media_key, exp, sig):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invalid media signature")

    content_type = media_content_type(media_key)
    path = local_media_path(media_key)
    if path is not None:
        return FileResponse(path, media_type=content_type, headers={"Cache-Control": _IMMUTABLE_CACHE})

    try:
        data = read_media_bytes(media_key)
    except MediaStoreError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return Response(content=data, media_type=content_type, headers={"Cache-Control": _IMMUTABLE_CACHE})


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

    if get_settings().media_backend != "s3":
        return {"url": build_media_url(media_key)}

    try:
        download_url = generate_presigned_download_url(media_key)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"MinIO unavailable: {exc}",
        ) from exc

    return {"url": download_url}
