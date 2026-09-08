"""回收已经没有 Worker / ComfyUI 在跑的僵死任务。"""

from __future__ import annotations

import logging
import time
from datetime import datetime, timezone

import httpx
from sqlalchemy import select

from app.models.settings import Job, UserSettings
from app.services.job_apply import apply_job_result_to_episode
from app.workers.celery_app import celery_app

logger = logging.getLogger(__name__)

SWEEP_EVERY_SEC = 8
STALE_ORPHAN_SEC = 45
STALE_COMFY_IDLE_SEC = 90
STALE_PENDING_SEC = 90
_last_sweep_at: dict[int, float] = {}


def _aware(value: datetime | None) -> datetime:
    if value is None:
        return datetime.now(timezone.utc)
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


def _celery_known_job_ids() -> set[str] | None:
    """返回 Worker 仍认领的任务 id；空集合表示没有 Worker；None 表示探测失败。"""
    try:
        inspect = celery_app.control.inspect(timeout=1.0)
        if inspect is None:
            return set()
        ping = inspect.ping() or {}
        if not ping:
            # 探测超时不等于没有 Worker。空集合会把正在跑的任务误判成孤儿。
            return None
        known: set[str] = set()
        for bucket in (inspect.active() or {}, inspect.reserved() or {}, inspect.scheduled() or {}):
            for tasks in (bucket or {}).values():
                for item in tasks or []:
                    task_id = item.get("id")
                    if task_id:
                        known.add(str(task_id))
                    args = item.get("args") or []
                    if args:
                        known.add(str(args[0]))
        return known
    except Exception:
        logger.warning("探测 Celery 任务失败，跳过 Worker 对账", exc_info=True)
        return None


def _comfy_queue_idle(registry: dict, job: Job) -> bool | None:
    try:
        from app.services.ai.comfyui import resolve_comfy_base

        model_id = (job.request_payload or {}).get("modelId")
        kind = "video" if "video" in (job.job_type or "") else "image"
        base = resolve_comfy_base(registry or {}, model_id, kind)
        if not base:
            return None
        with httpx.Client(trust_env=False, timeout=3.0) as client:
            response = client.get(f"{base.rstrip('/')}/queue")
            if not response.is_success:
                return None
            data = response.json()
            return not (data.get("queue_running") or data.get("queue_pending"))
    except Exception:
        return None


def _revoke_job(job_id: str) -> None:
    try:
        celery_app.control.revoke(job_id, terminate=True, signal="SIGTERM")
        inspect = celery_app.control.inspect(timeout=1.0)
        seen = (inspect.active() or {}) if inspect else {}
        reserved = (inspect.reserved() or {}) if inspect else {}
        for worker_tasks in list(seen.values()) + list(reserved.values()):
            for item in worker_tasks or []:
                args = item.get("args") or []
                if args and str(args[0]) == job_id and item.get("id") != job_id:
                    celery_app.control.revoke(item["id"], terminate=True, signal="SIGTERM")
    except Exception:
        logger.warning("回收任务 %s 时 revoke 失败", job_id, exc_info=True)


def _fail_job(session, job: Job, message: str, error: str) -> None:
    if job.status in {"completed", "failed", "cancelled"}:
        return
    job.status = "failed"
    job.message = message
    job.error = error
    job.updated_at = datetime.now(timezone.utc)
    apply_job_result_to_episode(session, job, None)
    _revoke_job(job.id)
    try:
        from app.services.ai.video_job import publish_job_event

        publish_job_event(
            job.id,
            {"status": "failed", "progress": job.progress, "message": message, "error": error},
        )
    except Exception:
        logger.warning("回收任务 %s 时推送事件失败", job.id, exc_info=True)


def reap_stale_jobs(user_id: int) -> int:
    now_mono = time.monotonic()
    last = _last_sweep_at.get(user_id, 0.0)
    if now_mono - last < SWEEP_EVERY_SEC:
        return 0
    _last_sweep_at[user_id] = now_mono

    from app.workers.tasks import SessionLocal

    known = _celery_known_job_ids()
    now = datetime.now(timezone.utc)
    reaped = 0

    with SessionLocal() as session:
        jobs = (
            session.execute(
                select(Job).where(
                    Job.user_id == user_id,
                    Job.status.in_(("pending", "running")),
                )
            )
            .scalars()
            .all()
        )
        if not jobs:
            return 0

        settings_row = session.get(UserSettings, user_id)
        registry = settings_row.model_registry if settings_row else {}
        running_jobs = [job for job in jobs if job.status == "running"]
        running_comfy = [job for job in running_jobs if "comfyui" in (job.job_type or "")]
        comfy_idle = _comfy_queue_idle(registry, running_comfy[0]) if running_comfy else None
        live_running = False

        for job in running_jobs:
            age = (now - _aware(job.updated_at)).total_seconds()
            # Worker 仍在跑（如下载 Comfy 输出、写盘）时队列会短暂空闲，不能当幽灵任务杀掉。
            if known is not None and job.id in known:
                live_running = True
                continue
            orphan = known is not None and job.id not in known and age >= STALE_ORPHAN_SEC
            ghost = (
                known is not None
                and job.id not in known
                and comfy_idle is True
                and "comfyui" in (job.job_type or "")
                and age >= STALE_COMFY_IDLE_SEC
                and (
                    (job.message or "").startswith("ComfyUI 生成中")
                    or (job.progress or 0) >= 10
                )
            )
            if orphan:
                logger.info("回收僵死任务 %s：Worker 已不在运行", job.id)
                _fail_job(session, job, "生成中断：工作进程已退出", "stale_worker")
                reaped += 1
            elif ghost:
                logger.info("回收僵死任务 %s：ComfyUI 队列为空", job.id)
                _fail_job(session, job, "生成中断：ComfyUI 已空闲，任务已丢失", "stale_comfyui")
                reaped += 1
            else:
                live_running = True

        if not live_running:
            for job in jobs:
                if job.status != "pending":
                    continue
                age = (now - _aware(job.updated_at)).total_seconds()
                if known is None or job.id in known or age < STALE_PENDING_SEC:
                    continue
                logger.info("回收僵死任务 %s：Celery 队列中已不存在", job.id)
                _fail_job(session, job, "生成中断：任务已从队列丢失，请重新提交", "stale_queue")
                reaped += 1

        if reaped:
            session.commit()
    return reaped
