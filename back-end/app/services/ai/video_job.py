"""异步视频任务：OpenAI 兼容 /v1/videos，或火山方舟 /api/v3/contents/generations/tasks。"""

from __future__ import annotations

import asyncio
import base64
import logging
import json
from typing import Any

import httpx
import redis

from app.core.config import get_settings
from app.services.ai.chat import (
    AiConfigError,
    _api_key_for_model,
    _load_reference_image,
    _pick_model,
    _provider_for_model,
)
from app.services.storage import (
    MediaStoreError,
    build_media_url,
    save_media_bytes,
)

logger = logging.getLogger(__name__)


def get_redis_client() -> redis.Redis:
    settings = get_settings()
    return redis.from_url(settings.redis_url, decode_responses=True)


def publish_job_event(job_id: str, event: dict) -> None:
    client = get_redis_client()
    client.publish(f"job:{job_id}:events", json.dumps(event))


def _is_volcengine_video_task(model: dict[str, Any], provider: dict[str, Any], endpoint: str) -> bool:
    if (provider.get("id") or "") == "volcengine":
        return True
    return "/contents/generations/tasks" in (endpoint or "").lower()


def _normalize_volcengine_image_mime(mime: str) -> str:
    """火山要求 data:image/<小写格式>;base64,...；jpg 需写成 jpeg。"""
    cleaned = (mime or "image/png").split(";", 1)[0].strip().lower()
    if cleaned == "image/jpg":
        return "image/jpeg"
    if cleaned.startswith("image/") and cleaned != "image/":
        return cleaned
    return "image/png"


def _sniff_image_mime(data: bytes) -> str | None:
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    if data[:6] in (b"GIF87a", b"GIF89a"):
        return "image/gif"
    if data.startswith(b"BM"):
        return "image/bmp"
    return None


async def _to_volcengine_image_data_uri(image: str) -> str:
    """把媒体签名 URL / http(s) / data URL / 裸 base64 转成火山可接受的 data URI。

    前端关键帧通常是 /api/v1/media/raw/...，火山无法访问，也不能直接当 base64 塞进去。
    """
    data, mime = await _load_reference_image(image)
    if not data:
        raise AiConfigError("首帧图片为空，请重新生成或上传后重试")

    sniffed = _sniff_image_mime(data)
    resolved_mime = _normalize_volcengine_image_mime(sniffed or mime)
    if len(data) > 28 * 1024 * 1024:
        raise AiConfigError(
            f"首帧图片过大（{len(data) / (1024 * 1024):.1f}MB），请压缩到 30MB 以内后重试"
        )

    b64 = base64.b64encode(data).decode("ascii")
    return f"data:{resolved_mime};base64,{b64}"


def _extract_video_url(payload: dict[str, Any]) -> str | None:
    candidates = [
        payload.get("content", {}).get("video_url") if isinstance(payload.get("content"), dict) else None,
        payload.get("content", {}).get("videoUrl") if isinstance(payload.get("content"), dict) else None,
        payload.get("video_url"),
        payload.get("videoUrl"),
        payload.get("url"),
        (payload.get("output") or {}).get("url") if isinstance(payload.get("output"), dict) else None,
        (payload.get("result") or {}).get("video_url") if isinstance(payload.get("result"), dict) else None,
    ]
    data = payload.get("data")
    if isinstance(data, dict):
        candidates.extend(
            [
                (data.get("content") or {}).get("video_url") if isinstance(data.get("content"), dict) else None,
                data.get("video_url"),
                data.get("url"),
            ]
        )
    elif isinstance(data, list) and data:
        first = data[0] if isinstance(data[0], dict) else {}
        candidates.extend([first.get("url"), first.get("video_url")])
    for value in candidates:
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


async def _persist_video_result(user_id: int | None, content: bytes, video_url: str | None = None) -> dict:
    if user_id is not None:
        try:
            media_key = save_media_bytes(user_id, content, suffix=".mp4", content_type="video/mp4")
            url = build_media_url(media_key)
            return {"video_url": url, "video_data_url": url, "media_key": media_key}
        except MediaStoreError as exc:
            logger.warning("视频落盘失败，降级为 base64: %s", exc)
    b64 = base64.b64encode(content).decode("ascii")
    result = {"video_base64": b64}
    if video_url:
        result["video_url"] = video_url
    return result


async def _run_volcengine_video_job(
    job_id: str,
    *,
    base_url: str,
    endpoint: str,
    api_key: str,
    api_model: str,
    payload: dict,
    user_id: int | None,
) -> dict:
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    prompt = str(payload.get("prompt") or "")
    aspect_ratio = str(payload.get("aspectRatio") or "16:9")
    duration = payload.get("duration") or 8
    start_image = payload.get("imageBase64") or payload.get("startImage") or ""

    content: list[dict[str, Any]] = [{"type": "text", "text": prompt}]
    has_image = False
    if start_image:
        image_data_uri = await _to_volcengine_image_data_uri(str(start_image))
        content.append(
            {
                "type": "image_url",
                "image_url": {"url": image_data_uri},
                "role": "first_frame",
            }
        )
        has_image = True
        logger.info(
            "Volcengine video image prepared mime=%s chars=%s source_prefix=%s",
            image_data_uri.split(";", 1)[0],
            len(image_data_uri),
            (str(start_image)[:96] + ("…" if len(str(start_image)) > 96 else "")),
        )

    ratio = "adaptive" if has_image else ("9:16" if aspect_ratio == "9:16" else "16:9")
    body = {
        "model": api_model,
        "content": content,
        "ratio": ratio,
        "duration": duration,
        "watermark": False,
    }

    publish_job_event(job_id, {"progress": 10, "message": "提交火山视频任务..."})
    task_url = f"{base_url}{endpoint}"
    logger.info(
        "Volcengine video create url=%s model=%s duration=%s ratio=%s has_image=%s",
        task_url,
        api_model,
        duration,
        ratio,
        has_image,
    )

    async with httpx.AsyncClient(timeout=120, trust_env=False) as client:
        create_res = await client.post(task_url, headers=headers, json=body)
        if not create_res.is_success:
            raise AiConfigError(f"Volcengine Video create 失败: {create_res.text[:2000]}")
        create_data = create_res.json()
        task_id = (
            create_data.get("id")
            or create_data.get("task_id")
            or (create_data.get("data") or {}).get("id")
            or (create_data.get("data") or {}).get("task_id")
        )
        if not task_id:
            raise AiConfigError("Volcengine Video API 未返回 task id")

        success_states = {"succeeded", "completed", "success", "done"}
        failed_states = {"failed", "error", "canceled", "cancelled"}
        for i in range(240):  # ~20 分钟
            publish_job_event(
                job_id,
                {"progress": min(10 + i // 3, 95), "message": f"火山视频生成中... ({i + 1}/240)"},
            )
            await asyncio.sleep(5)
            try:
                poll_res = await client.get(f"{task_url}/{task_id}", headers=headers)
            except (httpx.TimeoutException, httpx.NetworkError, httpx.RemoteProtocolError) as exc:
                logger.warning("Volcengine 任务状态暂时不可达，继续等待: %s", exc)
                continue
            if not poll_res.is_success:
                if poll_res.status_code >= 500:
                    continue
                raise AiConfigError(f"Volcengine Video poll 失败: {poll_res.text[:2000]}")
            data = poll_res.json()
            status = str(
                data.get("status")
                or (data.get("data") or {}).get("status")
                or ""
            ).lower()
            if status in success_states:
                video_url = _extract_video_url(data)
                if not video_url:
                    raise AiConfigError("任务已完成，但未返回视频地址")
                video_res = await client.get(video_url)
                video_res.raise_for_status()
                return await _persist_video_result(user_id, video_res.content, video_url)
            if status in failed_states:
                err = (
                    ((data.get("error") or {}) if isinstance(data.get("error"), dict) else {}).get("message")
                    or data.get("message")
                    or data.get("msg")
                    or "视频生成失败"
                )
                raise AiConfigError(str(err))

    raise AiConfigError("火山视频生成超时（已等待约 20 分钟）")


async def run_video_job(job_id: str, registry: dict, payload: dict, user_id: int | None = None) -> dict:
    """异步视频任务：OpenAI /v1/videos，或火山方舟 contents/generations/tasks。"""
    model = _pick_model(registry, payload.get("modelId"), "video")
    provider = _provider_for_model(registry, model)
    api_key = _api_key_for_model(registry, model, provider)

    base_url = (model.get("baseUrl") or provider.get("baseUrl") or "").rstrip("/")
    if not base_url:
        raise AiConfigError("API Base URL 未配置，请在模型设置中填写")
    endpoint = model.get("endpoint") or "/v1/videos"
    if not endpoint.startswith("/"):
        endpoint = f"/{endpoint}"
    api_model = str(model.get("apiModel") or model.get("id") or "")

    # 只要命中火山任务 endpoint，就必须走 content[] 协议，不能用 OpenAI /v1/videos 请求体。
    use_volcengine = _is_volcengine_video_task(model, provider, endpoint)
    logger.info(
        "Video job start model_id=%s api_model=%s provider=%s endpoint=%s base=%s volcengine=%s key_prefix=%s",
        model.get("id"),
        api_model,
        provider.get("id"),
        endpoint,
        base_url,
        use_volcengine,
        (api_key or "")[:8],
    )

    if use_volcengine:
        return await _run_volcengine_video_job(
            job_id,
            base_url=base_url,
            endpoint=endpoint,
            api_key=api_key,
            api_model=api_model or "ep-20260919140814-hwwtt",
            payload=payload,
            user_id=user_id,
        )

    if "/contents/generations/tasks" in endpoint.lower():
        raise AiConfigError(
            f"视频模型 {model.get('id')} 配置了火山任务 endpoint，但未识别为 Volcengine 路由，请检查 providerId/endpoint"
        )

    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    body = {
        "model": api_model,
        "prompt": payload.get("prompt", ""),
        "aspect_ratio": payload.get("aspectRatio", "16:9"),
    }
    if payload.get("duration"):
        body["duration"] = payload["duration"]
    if payload.get("imageBase64"):
        body["image"] = payload["imageBase64"]

    publish_job_event(job_id, {"progress": 10, "message": "提交视频任务..."})

    async with httpx.AsyncClient(timeout=60, trust_env=False) as client:
        create_res = await client.post(f"{base_url}{endpoint}", headers=headers, json=body)
        if not create_res.is_success:
            raise AiConfigError(f"Video create 失败: {create_res.text}")
        task = create_res.json()
        task_id = task.get("id") or task.get("task_id")
        if not task_id:
            raise AiConfigError("Video API 未返回 task id")

        network_error_streak = 0
        for i in range(2400):
            publish_job_event(job_id, {"progress": min(10 + i // 24, 95), "message": f"生成中... ({i + 1}/2400)"})
            try:
                poll_res = await client.get(f"{base_url}{endpoint}/{task_id}", headers=headers)
                network_error_streak = 0
            except (httpx.TimeoutException, httpx.NetworkError, httpx.RemoteProtocolError) as exc:
                network_error_streak += 1
                if network_error_streak == 1 or network_error_streak % 10 == 0:
                    logger.warning("视频任务状态暂时不可达，继续等待 (%s 次): %s", network_error_streak, exc)
                await asyncio.sleep(5)
                continue
            if not poll_res.is_success:
                if poll_res.status_code >= 500:
                    network_error_streak += 1
                    if network_error_streak == 1 or network_error_streak % 10 == 0:
                        logger.warning(
                            "视频任务状态暂时返回 %s，继续等待 (%s 次)",
                            poll_res.status_code,
                            network_error_streak,
                        )
                    await asyncio.sleep(5)
                    continue
                raise AiConfigError(f"Video poll 失败: {poll_res.text}")
            data = poll_res.json()
            status = (data.get("status") or "").lower()
            if status in {"completed", "succeeded", "success"}:
                video_url = data.get("video_url") or data.get("url") or data.get("output", {}).get("url")
                if not video_url and data.get("data"):
                    video_url = data["data"][0].get("url")
                if not video_url:
                    raise AiConfigError("视频完成但未返回 URL")
                video_res = await client.get(video_url)
                video_res.raise_for_status()
                return await _persist_video_result(user_id, video_res.content, video_url)
            if status in {"failed", "error"}:
                raise AiConfigError(data.get("error") or "视频生成失败")
            await asyncio.sleep(5)

    raise AiConfigError("视频生成超时（已等待约 3 小时）")
