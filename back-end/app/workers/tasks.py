import asyncio
import json
import uuid
from datetime import datetime, timezone

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.settings import Job, UserSettings
from app.services.ai.chat import AiConfigError
from app.services.ai.comfyui import run_comfy_image, run_comfy_video
from app.services.ai.video_job import publish_job_event, run_video_job
from app.workers.celery_app import celery_app

settings = get_settings()
sync_engine = create_engine(settings.database_url.replace("+aiosqlite", ""))


def _update_job(job_id: str, **fields) -> None:
    with Session(sync_engine) as session:
        job = session.get(Job, job_id)
        if not job:
            return
        for key, value in fields.items():
            setattr(job, key, value)
        job.updated_at = datetime.now(timezone.utc)
        session.commit()


def _load_registry(user_id: int) -> dict:
    with Session(sync_engine) as session:
        row = session.get(UserSettings, user_id)
        if row and row.model_registry:
            return row.model_registry
    return {"globalApiKey": settings.default_api_key or ""}


@celery_app.task(name="run_ai_job")
def run_ai_job(job_id: str, user_id: int, job_type: str, payload: dict) -> None:
    _update_job(job_id, status="running", progress=5, message="任务启动")
    publish_job_event(job_id, {"status": "running", "progress": 5, "message": "任务启动"})
    registry = _load_registry(user_id)

    try:
        if job_type == "video":
            result = asyncio.run(run_video_job(job_id, registry, payload))
        elif job_type == "comfyui_video":
            def on_progress(progress: int, message: str) -> None:
                _update_job(job_id, progress=progress, message=message)
                publish_job_event(job_id, {"progress": progress, "message": message})

            result = asyncio.run(run_comfy_video(registry, payload, on_progress=on_progress))
        elif job_type == "comfyui_image":
            result = asyncio.run(run_comfy_image(registry, payload))
        else:
            raise AiConfigError(f"暂不支持的任务类型: {job_type}")

        _update_job(job_id, status="completed", progress=100, message="完成", result=result, error=None)
        publish_job_event(
            job_id,
            {"status": "completed", "progress": 100, "message": "完成", "result": result},
        )
    except Exception as exc:
        err = str(exc)
        _update_job(job_id, status="failed", progress=100, message="失败", error=err)
        publish_job_event(job_id, {"status": "failed", "progress": 100, "message": "失败", "error": err})
