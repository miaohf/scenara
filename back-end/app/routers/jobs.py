import asyncio
import json
import uuid
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user
from app.db.session import get_db
from app.db.sqlite import retry_on_lock_async
from app.models.settings import Job, UserSettings
from app.models.user import User
from app.schemas.ai import JobCreateRequest, JobResponse
from app.services.ai.video_job import get_redis_client, publish_job_event
from app.services.job_apply import apply_job_result_to_episode
from app.services.job_sweep import reap_stale_jobs
from app.workers.celery_app import celery_app
from app.workers.tasks import SessionLocal, run_ai_job

router = APIRouter(prefix="/v1/jobs", tags=["jobs"])


def _task_queue(job_type: str) -> str:
    """Route ComfyUI jobs to independent execution lanes.

    Non-ComfyUI/legacy jobs remain on the default queue so existing workers and
    already-published tasks are not stranded during rollout.
    """
    if job_type in {"video", "comfyui_video"}:
        return "video"
    if job_type == "comfyui_image":
        return "image"
    return "celery"


def _job_to_response(
    job: Job,
    *,
    queue_position: int | None = None,
    queue_running: bool | None = None,
) -> JobResponse:
    return JobResponse(
        id=job.id,
        job_type=job.job_type,
        status=job.status,
        progress=job.progress,
        message=job.message,
        result=job.result,
        error=job.error,
        created_at=job.created_at.isoformat(),
        updated_at=job.updated_at.isoformat(),
        episode_id=job.episode_id,
        target=(job.request_payload or {}).get("_target"),
        queue_position=queue_position,
        queue_running=queue_running,
    )


async def _queue_stats(db: AsyncSession, job: Job) -> tuple[int | None, bool]:
    """返回 (排队位次, 是否有任务正在跑)。

    Worker concurrency=1，pending 数分钟到数十分钟都可能是正常排队；
    只有「没有任何任务在跑且自己排第一」才说明 Worker 可能掉线。
    """
    running = await db.scalar(
        select(func.count())
        .select_from(Job)
        .where(Job.user_id == job.user_id, Job.status == "running")
    )
    queue_running = bool(running or 0)

    if job.status != "pending":
        return None, queue_running

    ahead = await db.scalar(
        select(func.count())
        .select_from(Job)
        .where(
            Job.user_id == job.user_id,
            Job.status == "pending",
            Job.created_at <= job.created_at,
            Job.id != job.id,
        )
    )
    return int(ahead or 0) + 1, queue_running


async def _jobs_with_queue_stats(
    db: AsyncSession,
    user_id: int,
    jobs: list[Job],
) -> list[JobResponse]:
    running = await db.scalar(
        select(func.count()).select_from(Job).where(Job.user_id == user_id, Job.status == "running")
    )
    queue_running = bool(running or 0)
    pending_rows = (
        await db.execute(
            select(Job.id)
            .where(Job.user_id == user_id, Job.status == "pending")
            .order_by(Job.created_at.asc(), Job.id.asc())
        )
    ).scalars().all()
    positions = {job_id: index + 1 for index, job_id in enumerate(pending_rows)}
    return [
        _job_to_response(
            job,
            queue_position=positions.get(job.id) if job.status == "pending" else None,
            queue_running=queue_running,
        )
        for job in jobs
    ]


@router.post("", response_model=JobResponse, status_code=status.HTTP_201_CREATED)
async def create_job(
    body: JobCreateRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> JobResponse:
    payload = dict(body.payload or {})
    if body.target:
        payload["_target"] = body.target

    job = Job(
        id=str(uuid.uuid4()),
        user_id=current_user.id,
        episode_id=body.episode_id,
        job_type=body.job_type,
        status="pending",
        progress=0,
        request_payload=payload,
    )
    db.add(job)
    await retry_on_lock_async(db.commit, label=f"create_job:{job.id}")
    await db.refresh(job)

    run_ai_job.apply_async(
        args=[job.id, current_user.id, body.job_type, payload],
        task_id=job.id,
        queue=_task_queue(body.job_type),
    )
    return _job_to_response(job)


@router.get("", response_model=list[JobResponse])
async def list_jobs(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    episode_id: str | None = None,
    job_status: str | None = None,
    limit: int = 200,
) -> list[JobResponse]:
    """按剧集列出任务，供前端重新进入页面时恢复未完成/已完成的生成结果。"""
    wanted = [s.strip() for s in (job_status or "").split(",") if s.strip()]
    if not wanted or any(item in {"pending", "running"} for item in wanted):
        await asyncio.to_thread(reap_stale_jobs, current_user.id)

    query = select(Job).where(Job.user_id == current_user.id)
    if episode_id:
        query = query.where(Job.episode_id == episode_id)
    if wanted:
        query = query.where(Job.status.in_(wanted))
    query = query.order_by(Job.created_at.desc()).limit(max(1, min(limit, 500)))

    rows = (await db.execute(query)).scalars().all()
    return await _jobs_with_queue_stats(db, current_user.id, rows)


@router.get("/{job_id}", response_model=JobResponse)
async def get_job(
    job_id: str,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> JobResponse:
    result = await db.execute(
        select(Job).where(Job.id == job_id, Job.user_id == current_user.id)
    )
    job = result.scalar_one_or_none()
    if job is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found")
    queue_position, queue_running = await _queue_stats(db, job)
    return _job_to_response(job, queue_position=queue_position, queue_running=queue_running)


@router.post("/{job_id}/cancel", response_model=JobResponse)
async def cancel_job(
    job_id: str,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> JobResponse:
    result = await db.execute(
        select(Job).where(Job.id == job_id, Job.user_id == current_user.id)
    )
    job = result.scalar_one_or_none()
    if job is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found")
    if job.status in {"completed", "failed", "cancelled"}:
        return _job_to_response(job)

    job.status = "cancelled"
    job.message = "已取消"
    job.error = "用户取消"
    job.updated_at = datetime.now(timezone.utc)
    await retry_on_lock_async(db.commit, label=f"cancel_job:{job.id}")
    await db.refresh(job)

    try:
        celery_app.control.revoke(job.id, terminate=True, signal="SIGTERM")
        inspect = celery_app.control.inspect(timeout=1.0)
        seen = inspect.active() or {}
        reserved = inspect.reserved() or {}
        for worker_tasks in list(seen.values()) + list(reserved.values()):
            for item in worker_tasks or []:
                args = item.get("args") or []
                if args and str(args[0]) == job.id and item.get("id") != job.id:
                    celery_app.control.revoke(item["id"], terminate=True, signal="SIGTERM")
    except Exception:
        pass

    if "comfyui" in (job.job_type or ""):
        try:
            from app.services.ai.comfyui import interrupt_comfyui, resolve_comfy_base

            settings_row = await db.get(UserSettings, current_user.id)
            registry = settings_row.model_registry if settings_row else {}
            model_id = (job.request_payload or {}).get("modelId")
            kind = "video" if "video" in (job.job_type or "") else "image"
            base = resolve_comfy_base(registry or {}, model_id, kind)
            await interrupt_comfyui(base)
        except Exception:
            pass

    def _apply_cancel() -> None:
        with SessionLocal() as session:
            row = session.get(Job, job.id)
            if row:
                apply_job_result_to_episode(session, row, None)
                session.commit()

    await asyncio.to_thread(_apply_cancel)
    publish_job_event(
        job.id,
        {"status": "cancelled", "progress": job.progress, "message": "已取消", "error": "用户取消"},
    )
    return _job_to_response(job)


@router.get("/{job_id}/stream")
async def stream_job(
    job_id: str,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    result = await db.execute(
        select(Job).where(Job.id == job_id, Job.user_id == current_user.id)
    )
    job = result.scalar_one_or_none()
    if job is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found")

    async def event_generator():
        snapshot = {
            "status": job.status,
            "progress": job.progress,
            "message": job.message,
            "result": job.result,
            "error": job.error,
            "target": (job.request_payload or {}).get("_target"),
        }
        yield f"data: {json.dumps(snapshot)}\n\n"
        if job.status in {"completed", "failed", "cancelled"}:
            return

        client = get_redis_client()
        pubsub = client.pubsub()
        pubsub.subscribe(f"job:{job_id}:events")
        try:
            while True:
                message = pubsub.get_message(ignore_subscribe_messages=True, timeout=1.0)
                if message and message.get("type") == "message":
                    yield f"data: {message['data']}\n\n"
                    payload = json.loads(message["data"])
                    if payload.get("status") in {"completed", "failed", "cancelled"}:
                        break
                await asyncio.sleep(0.5)
        finally:
            pubsub.close()

    return StreamingResponse(event_generator(), media_type="text/event-stream")
