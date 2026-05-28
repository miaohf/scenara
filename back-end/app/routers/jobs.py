import asyncio
import json
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user
from app.db.session import get_db
from app.models.settings import Job
from app.models.user import User
from app.schemas.ai import JobCreateRequest, JobResponse
from app.services.ai.video_job import get_redis_client
from app.workers.tasks import run_ai_job

router = APIRouter(prefix="/v1/jobs", tags=["jobs"])


def _job_to_response(job: Job) -> JobResponse:
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
    )


@router.post("", response_model=JobResponse, status_code=status.HTTP_201_CREATED)
async def create_job(
    body: JobCreateRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> JobResponse:
    job = Job(
        id=str(uuid.uuid4()),
        user_id=current_user.id,
        episode_id=body.episode_id,
        job_type=body.job_type,
        status="pending",
        progress=0,
        request_payload=body.payload,
    )
    db.add(job)
    await db.commit()
    await db.refresh(job)

    run_ai_job.delay(job.id, current_user.id, body.job_type, body.payload)
    return _job_to_response(job)


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
        client = get_redis_client()
        pubsub = client.pubsub()
        pubsub.subscribe(f"job:{job_id}:events")
        try:
            yield f"data: {json.dumps({'status': job.status, 'progress': job.progress})}\n\n"
            while True:
                message = pubsub.get_message(ignore_subscribe_messages=True, timeout=1.0)
                if message and message.get("type") == "message":
                    yield f"data: {message['data']}\n\n"
                    payload = json.loads(message["data"])
                    if payload.get("status") in {"completed", "failed"}:
                        break
                await asyncio.sleep(0.5)
        finally:
            pubsub.close()

    return StreamingResponse(event_generator(), media_type="text/event-stream")
