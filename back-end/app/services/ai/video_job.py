import uuid
from datetime import datetime, timezone

import json

import httpx
import redis

from app.core.config import get_settings
from app.services.ai.chat import AiConfigError, _api_key_for_model, _pick_model, _provider_for_model


def get_redis_client() -> redis.Redis:
    settings = get_settings()
    return redis.from_url(settings.redis_url, decode_responses=True)


def publish_job_event(job_id: str, event: dict) -> None:
    client = get_redis_client()
    client.publish(f"job:{job_id}:events", json.dumps(event))


async def run_video_job(job_id: str, registry: dict, payload: dict) -> dict:
    """异步视频任务：创建 + 轮询 OpenAI 兼容 /v1/videos 接口。"""
    model = _pick_model(registry, payload.get("modelId"), "video")
    provider = _provider_for_model(registry, model)
    api_key = _api_key_for_model(registry, model, provider)

    base_url = (provider.get("baseUrl") or "").rstrip("/")
    if not base_url:
        raise AiConfigError("API Base URL 未配置，请在模型设置中填写")
    endpoint = model.get("endpoint") or "/v1/videos"
    if not endpoint.startswith("/"):
        endpoint = f"/{endpoint}"

    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    body = {
        "model": model.get("apiModel") or model.get("id"),
        "prompt": payload.get("prompt", ""),
        "aspect_ratio": payload.get("aspectRatio", "16:9"),
    }
    if payload.get("duration"):
        body["duration"] = payload["duration"]
    if payload.get("imageBase64"):
        body["image"] = payload["imageBase64"]

    publish_job_event(job_id, {"progress": 10, "message": "提交视频任务..."})

    async with httpx.AsyncClient(timeout=60) as client:
        create_res = await client.post(f"{base_url}{endpoint}", headers=headers, json=body)
        if not create_res.is_success:
            raise AiConfigError(f"Video create 失败: {create_res.text}")
        task = create_res.json()
        task_id = task.get("id") or task.get("task_id")
        if not task_id:
            raise AiConfigError("Video API 未返回 task id")

        for i in range(120):
            publish_job_event(job_id, {"progress": min(10 + i, 95), "message": f"生成中... ({i + 1}/120)"})
            poll_res = await client.get(f"{base_url}{endpoint}/{task_id}", headers=headers)
            if not poll_res.is_success:
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
                import base64

                b64 = base64.b64encode(video_res.content).decode("ascii")
                return {"video_base64": b64, "video_url": video_url}
            if status in {"failed", "error"}:
                raise AiConfigError(data.get("error") or "视频生成失败")
            await __import__("asyncio").sleep(5)

    raise AiConfigError("视频生成超时")
