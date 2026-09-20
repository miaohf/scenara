import asyncio
import base64
import logging
from datetime import datetime, timezone

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.config import get_settings
from app.db.sqlite import retry_on_lock
from app.db.urls import is_sqlite_url, sync_connect_args, to_sync_database_url
from app.models.settings import Job, UserSettings
from app.services.ai.chat import AiConfigError, generate_image_openai_compatible
from app.services.ai.comfyui import run_comfy_image, run_comfy_video
from app.services.ai.video_job import publish_job_event, run_video_job
from app.services.job_apply import apply_job_result_to_episode
from app.services.model_registry import apply_deployment_overrides
from app.services.storage import MediaStoreError, build_media_url, save_media_bytes
from app.workers.celery_app import celery_app

logger = logging.getLogger(__name__)
settings = get_settings()
sync_engine = create_engine(
    to_sync_database_url(settings.database_url),
    connect_args=sync_connect_args(settings.database_url),
    pool_pre_ping=True,
)
if is_sqlite_url(settings.database_url):
    from app.db.sqlite import attach_sqlite_pragmas

    attach_sqlite_pragmas(sync_engine)
SessionLocal = sessionmaker(bind=sync_engine, expire_on_commit=False)


def _update_job(job_id: str, **fields) -> None:
    def _write() -> None:
        with SessionLocal() as session:
            job = session.get(Job, job_id)
            if not job:
                return
            incoming_status = fields.get("status")
            # 已取消不要改；已完成不要回退。误判 failed 的任务若 Worker 其实跑完了，允许纠正为 completed。
            if job.status == "cancelled":
                return
            if job.status == "completed" and incoming_status not in {None, "completed"}:
                return
            if job.status == "failed" and incoming_status not in {None, "completed", "failed", "running"}:
                return
            for key, value in fields.items():
                setattr(job, key, value)
            job.updated_at = datetime.now(timezone.utc)
            session.commit()

    retry_on_lock(_write, label=f"update_job:{job_id}")


def _load_registry(user_id: int) -> dict:
    def _read() -> dict:
        with SessionLocal() as session:
            row = session.get(UserSettings, user_id)
            if row and row.model_registry:
                return row.model_registry
        return {"globalApiKey": settings.default_api_key or ""}

    return apply_deployment_overrides(
        retry_on_lock(_read, label=f"load_registry:{user_id}"),
        settings,
    )


def _job_status(job_id: str) -> str | None:
    with SessionLocal() as session:
        job = session.get(Job, job_id)
        return job.status if job else None


def _format_job_target(payload: dict | None) -> str:
    target = (payload or {}).get("_target") if isinstance(payload, dict) else None
    if not isinstance(target, dict):
        return "target=-"
    kind = target.get("kind") or "?"
    parts = [f"kind={kind}"]
    if target.get("shotId"):
        parts.append(f"shot={target.get('shotId')}")
    if target.get("type"):
        parts.append(f"frame={target.get('type')}")
    if target.get("id"):
        parts.append(f"id={target.get('id')}")
    if target.get("characterId"):
        parts.append(f"character={target.get('characterId')}")
    if target.get("generationId"):
        parts.append(f"generation={target.get('generationId')}")
    return " ".join(parts)


def _log_job_failure(job_id: str, job_type: str, payload: dict | None, err: str) -> None:
    """结构化输出任务失败，避免一整坨 JSON 糊在一行里。"""
    logger.error(
        "任务失败\n  job=%s\n  type=%s\n  %s\n  %s",
        job_id,
        job_type,
        _format_job_target(payload),
        err.replace("\n", "\n  "),
    )


def _apply_job_to_episode(job_id: str, result: dict | None) -> None:
    """写回剧集失败不能把已经成功的生成改判失败。"""

    def _write() -> bool:
        with SessionLocal() as session:
            job = session.get(Job, job_id)
            if not job:
                return False
            applied = apply_job_result_to_episode(session, job, result)
            session.commit()
            return applied

    try:
        applied = retry_on_lock(_write, label=f"apply_job:{job_id}")
        if not applied:
            logger.warning("任务 %s 已结束，但没有匹配到可写回的剧集目标", job_id)
    except Exception:
        logger.exception("任务 %s 生成已完成，但写回剧集失败", job_id)


class JobCancelled(Exception):
    """用户取消后，Worker 自行收尾，不再改判失败。"""


async def _run_image_job(registry: dict, payload: dict, user_id: int) -> dict[str, str]:
    """运行 OpenAI/NewAPI 兼容生图，并把结果落盘后交给统一任务写回链路。"""
    encoded = await generate_image_openai_compatible(
        registry,
        prompt=str(payload.get("prompt") or ""),
        model_id=payload.get("modelId"),
        aspect_ratio=str(payload.get("aspectRatio") or "16:9"),
        reference_images=payload.get("referenceImages") or [],
        reference_annotations=payload.get("referenceAnnotations") or [],
    )
    try:
        content = base64.b64decode(encoded, validate=True)
    except (ValueError, TypeError) as exc:
        raise AiConfigError("Image API 返回的图片数据无效") from exc

    try:
        media_key = save_media_bytes(user_id, content, suffix=".png", content_type="image/png")
    except MediaStoreError as exc:
        logger.warning("OpenAI/NewAPI 图片落盘失败，任务结果降级为 base64: %s", exc)
        return {"image_base64": encoded}
    url = build_media_url(media_key)
    return {"image_url": url, "image_data_url": url, "media_key": media_key}


@celery_app.task(name="run_ai_job")
def run_ai_job(job_id: str, user_id: int, job_type: str, payload: dict) -> None:
    if _job_status(job_id) == "cancelled":
        return
    _update_job(job_id, status="running", progress=0, message="任务启动")
    publish_job_event(job_id, {"status": "running", "progress": 0, "message": "任务启动"})
    registry = _load_registry(user_id)

    def on_progress(progress: int, message: str) -> None:
        # 只有用户取消才停。sweep 可能把仍在跑的任务误标 failed，
        # 这时拉回 running 并继续跑完。
        current = _job_status(job_id)
        if current == "cancelled":
            raise JobCancelled()
        fields: dict = {"progress": progress, "message": message}
        event: dict = {"progress": progress, "message": message}
        if current == "failed":
            fields["status"] = "running"
            fields["error"] = None
            event["status"] = "running"
        try:
            _update_job(job_id, **fields)
        except Exception:
            logger.warning("任务 %s 进度写入失败，忽略", job_id, exc_info=True)
        try:
            publish_job_event(job_id, event)
        except Exception:
            logger.warning("任务 %s 进度推送失败，忽略", job_id, exc_info=True)

    try:
        if job_type == "image":
            result = asyncio.run(_run_image_job(registry, payload, user_id))
        elif job_type == "video":
            result = asyncio.run(run_video_job(job_id, registry, payload, user_id=user_id))
        elif job_type == "comfyui_video":
            result = asyncio.run(
                run_comfy_video(registry, payload, on_progress=on_progress, user_id=user_id)
            )
        elif job_type == "comfyui_image":
            result = asyncio.run(
                run_comfy_image(registry, payload, on_progress=on_progress, user_id=user_id)
            )
        else:
            raise AiConfigError(f"暂不支持的任务类型: {job_type}")

        if _job_status(job_id) == "cancelled":
            return
        _update_job(job_id, status="completed", progress=100, message="完成", result=result, error=None)
        _apply_job_to_episode(job_id, result)
        publish_job_event(
            job_id,
            {"status": "completed", "progress": 100, "message": "完成", "result": result},
        )
    except JobCancelled:
        return
    except Exception as exc:
        if _job_status(job_id) == "cancelled":
            return
        err = str(exc)
        _log_job_failure(job_id, job_type, payload, err)
        _update_job(job_id, status="failed", progress=100, message="失败", error=err)
        _apply_job_to_episode(job_id, None)
        publish_job_event(job_id, {"status": "failed", "progress": 100, "message": "失败", "error": err})
