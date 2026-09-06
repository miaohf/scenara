from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.core.config import get_settings
from app.db.urls import async_connect_args, is_sqlite_url

settings = get_settings()

_engine_kwargs: dict = {
    "echo": settings.debug,
    "connect_args": async_connect_args(settings.database_url),
}
if not is_sqlite_url(settings.database_url):
    _engine_kwargs.update(pool_pre_ping=True, pool_size=5, max_overflow=10)

engine = create_async_engine(settings.database_url, **_engine_kwargs)

if is_sqlite_url(settings.database_url):
    from app.db.sqlite import attach_sqlite_pragmas

    attach_sqlite_pragmas(engine.sync_engine)

AsyncSessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionLocal() as session:
        yield session


async def init_db() -> None:
    from app.models import episode, project, settings, user  # noqa: F401

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
