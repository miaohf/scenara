"""SQLite 并发配置。

FastAPI（aiosqlite）和 Celery Worker（sqlite3）写同一份 app.db。
默认 DELETE journal 会在任一方持锁时让另一方立刻报 database is locked。
WAL + busy_timeout 让写操作排队等待，而不是直接失败。
"""

from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import Awaitable, Callable
from typing import TypeVar

from sqlalchemy import event
from sqlalchemy.engine import Engine
from sqlalchemy.exc import OperationalError

logger = logging.getLogger(__name__)

SQLITE_TIMEOUT_SEC = 30
SQLITE_CONNECT_ARGS = {
    "check_same_thread": False,
    "timeout": SQLITE_TIMEOUT_SEC,
}

T = TypeVar("T")


def apply_sqlite_pragmas(dbapi_connection, _connection_record) -> None:
    cursor = dbapi_connection.cursor()
    try:
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute(f"PRAGMA busy_timeout={SQLITE_TIMEOUT_SEC * 1000}")
        cursor.execute("PRAGMA synchronous=NORMAL")
        cursor.execute("PRAGMA wal_autocheckpoint=1000")
    finally:
        cursor.close()


def attach_sqlite_pragmas(engine: Engine) -> None:
    if engine.dialect.name != "sqlite":
        return
    event.listen(engine, "connect", apply_sqlite_pragmas)


def is_sqlite_locked(exc: BaseException) -> bool:
    text = str(exc).lower()
    return "database is locked" in text or "database locked" in text


def retry_on_lock(operation: Callable[[], T], *, attempts: int = 6, label: str = "sqlite") -> T:
    delay = 0.15
    last_error: BaseException | None = None
    for index in range(attempts):
        try:
            return operation()
        except OperationalError as exc:
            last_error = exc
            if not is_sqlite_locked(exc) or index == attempts - 1:
                raise
            logger.warning(
                "%s 遇到 database is locked，%.2fs 后重试（%s/%s）",
                label,
                delay,
                index + 1,
                attempts,
            )
            time.sleep(delay)
            delay = min(delay * 2, 2.0)
    raise last_error or RuntimeError(f"{label} 重试失败")


async def retry_on_lock_async(
    operation: Callable[[], Awaitable[T]],
    *,
    attempts: int = 6,
    label: str = "sqlite",
) -> T:
    delay = 0.15
    last_error: BaseException | None = None
    for index in range(attempts):
        try:
            return await operation()
        except OperationalError as exc:
            last_error = exc
            if not is_sqlite_locked(exc) or index == attempts - 1:
                raise
            logger.warning(
                "%s 遇到 database is locked，%.2fs 后重试（%s/%s）",
                label,
                delay,
                index + 1,
                attempts,
            )
            await asyncio.sleep(delay)
            delay = min(delay * 2, 2.0)
    raise last_error or RuntimeError(f"{label} 重试失败")
