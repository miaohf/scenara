"""媒体对象存储：本地文件系统（默认）或 S3/MinIO。

生成的图片/视频不再以 base64 写进 episode payload，而是落地为媒体对象，
payload 只保存一个带 HMAC 签名的可直接渲染 URL（`<img src>` 无需 Authorization 头）。
"""

from __future__ import annotations

import hmac
import mimetypes
import time
import uuid
from functools import lru_cache
from hashlib import sha256
from pathlib import Path

import boto3
from botocore.client import Config
from botocore.exceptions import ClientError

from app.core.config import get_settings


class MediaStoreError(RuntimeError):
    """媒体存储不可用（调用方可降级回 base64）。"""


@lru_cache
def get_s3_client():
    settings = get_settings()
    return boto3.client(
        "s3",
        endpoint_url=settings.s3_endpoint,
        aws_access_key_id=settings.s3_access_key,
        aws_secret_access_key=settings.s3_secret_key,
        region_name=settings.s3_region,
        use_ssl=settings.s3_use_ssl,
        config=Config(signature_version="s3v4"),
    )


def ensure_bucket() -> None:
    settings = get_settings()
    client = get_s3_client()
    try:
        client.head_bucket(Bucket=settings.s3_bucket)
    except ClientError:
        client.create_bucket(Bucket=settings.s3_bucket)


def generate_presigned_upload_url(media_key: str, content_type: str, expires_in: int = 3600) -> str:
    settings = get_settings()
    client = get_s3_client()
    return client.generate_presigned_url(
        "put_object",
        Params={
            "Bucket": settings.s3_bucket,
            "Key": media_key,
            "ContentType": content_type,
        },
        ExpiresIn=expires_in,
    )


def generate_presigned_download_url(media_key: str, expires_in: int = 3600) -> str:
    settings = get_settings()
    client = get_s3_client()
    return client.generate_presigned_url(
        "get_object",
        Params={"Bucket": settings.s3_bucket, "Key": media_key},
        ExpiresIn=expires_in,
    )


# ---------------------------------------------------------------- media keys


def local_media_root() -> Path:
    return Path(get_settings().media_local_dir).resolve()


def build_media_key(user_id: int, suffix: str) -> str:
    safe_suffix = suffix if suffix.startswith(".") else f".{suffix}"
    return f"users/{user_id}/{uuid.uuid4().hex}{safe_suffix}"


def is_safe_media_key(media_key: str) -> bool:
    if not media_key or media_key.startswith("/") or "\\" in media_key:
        return False
    return ".." not in Path(media_key).parts


def media_content_type(media_key: str) -> str:
    guessed, _ = mimetypes.guess_type(media_key)
    return guessed or "application/octet-stream"


# --------------------------------------------------------------- read/write


def save_media_bytes(user_id: int, data: bytes, *, suffix: str, content_type: str) -> str:
    """写入媒体对象并返回 media_key。失败抛 MediaStoreError，调用方可降级。"""
    media_key = build_media_key(user_id, suffix)
    settings = get_settings()

    if settings.media_backend == "s3":
        try:
            ensure_bucket()
            get_s3_client().put_object(
                Bucket=settings.s3_bucket,
                Key=media_key,
                Body=data,
                ContentType=content_type,
            )
        except Exception as exc:  # noqa: BLE001 - 统一降级信号
            raise MediaStoreError(f"S3 写入失败: {exc}") from exc
        return media_key

    try:
        target = local_media_root() / media_key
        target.parent.mkdir(parents=True, exist_ok=True)
        # 先写临时文件再 rename，避免读到半截文件
        tmp = target.with_suffix(target.suffix + ".part")
        tmp.write_bytes(data)
        tmp.replace(target)
    except OSError as exc:
        raise MediaStoreError(f"本地媒体写入失败: {exc}") from exc
    return media_key


def local_media_path(media_key: str) -> Path | None:
    """本地后端下返回文件路径；S3 后端返回 None。"""
    if get_settings().media_backend == "s3":
        return None
    if not is_safe_media_key(media_key):
        return None
    root = local_media_root()
    path = (root / media_key).resolve()
    if not path.is_relative_to(root) or not path.is_file():
        return None
    return path


def read_media_bytes(media_key: str) -> bytes:
    if not is_safe_media_key(media_key):
        raise MediaStoreError("非法 media_key")

    if get_settings().media_backend == "s3":
        try:
            obj = get_s3_client().get_object(Bucket=get_settings().s3_bucket, Key=media_key)
            return obj["Body"].read()
        except Exception as exc:  # noqa: BLE001
            raise MediaStoreError(f"S3 读取失败: {exc}") from exc

    path = local_media_path(media_key)
    if path is None:
        raise MediaStoreError(f"媒体文件不存在: {media_key}")
    return path.read_bytes()


# ------------------------------------------------------------------ signing


def _signature(media_key: str, expires_at: int) -> str:
    secret = get_settings().jwt_secret.encode("utf-8")
    message = f"{media_key}:{expires_at}".encode("utf-8")
    return hmac.new(secret, message, sha256).hexdigest()


def sign_media_key(media_key: str, ttl_seconds: int | None = None) -> tuple[int, str]:
    settings = get_settings()
    ttl = ttl_seconds if ttl_seconds is not None else settings.media_url_ttl_days * 86400
    expires_at = int(time.time()) + max(60, ttl)
    return expires_at, _signature(media_key, expires_at)


def verify_media_signature(media_key: str, expires_at: int, signature: str) -> bool:
    if not is_safe_media_key(media_key):
        return False
    if expires_at < int(time.time()):
        return False
    return hmac.compare_digest(_signature(media_key, expires_at), signature)


def build_media_url(media_key: str, ttl_seconds: int | None = None) -> str:
    """浏览器可直接渲染的 URL（经 Next `/api` rewrite 转发到本服务）。"""
    expires_at, signature = sign_media_key(media_key, ttl_seconds)
    prefix = get_settings().media_url_prefix.rstrip("/")
    return f"{prefix}/v1/media/raw/{media_key}?exp={expires_at}&sig={signature}"


def parse_media_url(value: str) -> str | None:
    """从签名 URL 中取回 media_key；不是媒体 URL 时返回 None。"""
    text = (value or "").strip()
    if not text:
        return None
    path = text.split("?", 1)[0]
    marker = "/v1/media/raw/"
    index = path.find(marker)
    if index == -1:
        return None
    media_key = path[index + len(marker) :]
    return media_key if is_safe_media_key(media_key) else None
