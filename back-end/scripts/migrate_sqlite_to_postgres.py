"""把本地 SQLite 数据拷进 PostgreSQL（独立库 scenara，不动其它库）。

默认只预览行数。真正写入：

    uv run scripts/migrate_sqlite_to_postgres.py --apply

源库默认 back-end/data/app.db；目标库读当前 DATABASE_URL。
"""

from __future__ import annotations

import argparse
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
os.chdir(ROOT)
sys.path.insert(0, str(ROOT))

from sqlalchemy import create_engine, select, text  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402

from app.core.config import get_settings  # noqa: E402
from app.db.session import Base  # noqa: E402
from app.db.urls import is_sqlite_url, to_sync_database_url  # noqa: E402
from app.models.episode import Episode  # noqa: E402
from app.models.project import Series, SeriesProject  # noqa: E402
from app.models.settings import Job, UserSettings  # noqa: E402
from app.models.user import User  # noqa: E402

COPY_ORDER = (User, UserSettings, SeriesProject, Series, Episode, Job)


def _aware(value: object) -> object:
    if isinstance(value, datetime) and value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


def _row_kwargs(model, row) -> dict:
    data = {}
    for column in model.__table__.columns:
        data[column.key] = _aware(getattr(row, column.key))
    return data


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="写入 PostgreSQL")
    parser.add_argument(
        "--sqlite",
        default=str(ROOT / "data" / "app.db"),
        help="SQLite 文件路径",
    )
    args = parser.parse_args()

    settings = get_settings()
    if is_sqlite_url(settings.database_url):
        raise SystemExit(
            "当前 DATABASE_URL 仍是 SQLite。请先改成 postgresql+asyncpg://.../scenara 再迁移。"
        )

    sqlite_path = Path(args.sqlite).resolve()
    if not sqlite_path.is_file():
        raise SystemExit(f"找不到 SQLite 文件: {sqlite_path}")

    src = create_engine(f"sqlite:///{sqlite_path}")
    dest = create_engine(to_sync_database_url(settings.database_url))
    Base.metadata.create_all(dest)

    with Session(src) as source, Session(dest) as target:
        for model in COPY_ORDER:
            rows = source.execute(select(model)).scalars().all()
            existing = target.execute(select(model)).scalars().all()
            print(f"{model.__tablename__}: sqlite={len(rows)} postgres={len(existing)}")
            if not args.apply:
                continue
            if existing:
                print(f"  跳过（目标表已有数据，避免覆盖）")
                continue
            for row in rows:
                target.add(model(**_row_kwargs(model, row)))
            target.commit()
            print(f"  已写入 {len(rows)} 行")

        if args.apply:
            target.execute(
                text(
                    "SELECT setval("
                    "pg_get_serial_sequence('users', 'id'), "
                    "COALESCE((SELECT MAX(id) FROM users), 1), "
                    "(SELECT MAX(id) FROM users) IS NOT NULL)"
                )
            )
            target.commit()

    if not args.apply:
        print("\n预览结束。确认无误后加 --apply 执行拷贝。")


if __name__ == "__main__":
    main()
