from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import get_settings
from app.db.session import init_db
from app.routers import ai, auth, jobs, media, projects, settings


@asynccontextmanager
async def lifespan(_: FastAPI):
    Path("data").mkdir(parents=True, exist_ok=True)
    await init_db()
    yield


def create_app() -> FastAPI:
    config = get_settings()
    app = FastAPI(title=config.app_name, lifespan=lifespan)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=config.cors_origin_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(auth.router)
    app.include_router(settings.router)
    app.include_router(ai.router)
    app.include_router(jobs.router)
    app.include_router(projects.router)
    app.include_router(media.router)

    @app.get("/health")
    async def health():
        return {"status": "ok"}

    return app


app = create_app()
