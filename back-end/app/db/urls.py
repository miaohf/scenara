"""按 DATABASE_URL 方言组装异步/同步引擎参数。"""

from __future__ import annotations


def is_sqlite_url(url: str) -> bool:
    return url.startswith("sqlite")


def to_sync_database_url(url: str) -> str:
    return url.replace("+aiosqlite", "").replace("+asyncpg", "+psycopg")


def async_connect_args(url: str) -> dict:
    if is_sqlite_url(url):
        from app.db.sqlite import SQLITE_CONNECT_ARGS

        return dict(SQLITE_CONNECT_ARGS)
    return {}


def sync_connect_args(url: str) -> dict:
    if is_sqlite_url(url):
        from app.db.sqlite import SQLITE_CONNECT_ARGS

        return dict(SQLITE_CONNECT_ARGS)
    return {}
