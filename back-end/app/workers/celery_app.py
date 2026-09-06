import uuid

from celery import Celery

from app.core.config import get_settings

settings = get_settings()

celery_app = Celery(
    "bigbanana",
    broker=settings.redis_url,
    backend=settings.redis_url,
    # Worker 启动时必须加载任务模块，否则会报 unregistered task 'run_ai_job'
    include=["app.workers.tasks"],
)
celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    # 单 GPU 本地 ComfyUI：串行执行任务，避免多 worker 抢占同一张卡
    worker_concurrency=1,
    worker_prefetch_multiplier=1,
)
