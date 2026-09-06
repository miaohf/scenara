"""把剧集 payload 里内嵌的 base64 图片/视频迁移到媒体存储。

历史剧集把定妆图、关键帧、视频都以 `data:...;base64,` 存进 episodes.payload，
单集能涨到上百 MB，自动保存的请求体会被代理截断（截断后 JSON 解析失败，保存直接失败）。
迁移后 payload 只留签名 URL，体积回到几百 KB。

默认只统计不落盘：

    ./.venv/bin/python scripts/migrate_payload_media.py
    ./.venv/bin/python scripts/migrate_payload_media.py --apply
"""

from __future__ import annotations

import argparse
import base64
import binascii
import json
import re
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import create_engine, select  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402

from app.core.config import get_settings  # noqa: E402
from app.db.urls import to_sync_database_url  # noqa: E402
from app.models.episode import Episode  # noqa: E402
from app.models.settings import Job  # noqa: E402
from app.services.storage import (  # noqa: E402
    MediaStoreError,
    build_media_url,
    save_media_bytes,
)

DATA_URL_RE = re.compile(r"^data:(image|video|audio)/([a-zA-Z0-9.+-]+);base64,(.+)$", re.DOTALL)

SUFFIX_BY_SUBTYPE = {
    "jpeg": ".jpg",
    "jpg": ".jpg",
    "png": ".png",
    "webp": ".webp",
    "gif": ".gif",
    "mp4": ".mp4",
    "webm": ".webm",
    "quicktime": ".mov",
    "mpeg": ".mp3",
    "wav": ".wav",
    "opus": ".opus",
    "ogg": ".ogg",
}


class Stats:
    def __init__(self) -> None:
        self.assets = 0
        self.bytes_inline = 0
        self.bytes_stored = 0
        self.failures = 0


def _convert(value: str, user_id: int, stats: Stats, apply: bool) -> str:
    match = DATA_URL_RE.match(value)
    if not match:
        return value

    kind, subtype, payload = match.groups()
    try:
        raw = base64.b64decode(payload, validate=False)
    except (binascii.Error, ValueError):
        stats.failures += 1
        return value

    stats.assets += 1
    stats.bytes_inline += len(value)

    if not apply:
        return value

    suffix = SUFFIX_BY_SUBTYPE.get(subtype.lower(), f".{subtype.lower()}")
    try:
        media_key = save_media_bytes(
            user_id, raw, suffix=suffix, content_type=f"{kind}/{subtype}"
        )
    except MediaStoreError as exc:
        print(f"    ! 写入失败，保留原值: {exc}")
        stats.failures += 1
        return value

    stats.bytes_stored += len(raw)
    return build_media_url(media_key)


def _walk(node: Any, user_id: int, stats: Stats, apply: bool) -> Any:
    if isinstance(node, str):
        return _convert(node, user_id, stats, apply)
    if isinstance(node, list):
        return [_walk(item, user_id, stats, apply) for item in node]
    if isinstance(node, dict):
        return {key: _walk(item, user_id, stats, apply) for key, item in node.items()}
    return node


# 任务里合法的长文本是提示词（上限 5000 字符）；超过这个量级的字符串只会是媒体数据。
# 注意历史任务的 `image_base64` 是裸 base64，没有 `data:...;base64,` 前缀，只靠前缀判断会漏掉。
BLOB_LENGTH_THRESHOLD = 8192


def _prune_job_payloads(session: Session, apply: bool) -> None:
    """清掉历史任务里内嵌的媒体数据。

    结果早已被前端写进剧集，这些副本只是在撑大数据库；
    新任务只存媒体 URL，不会再产生。
    """
    freed = 0
    pruned = 0
    for job in session.execute(select(Job)).scalars():
        before = len(
            json.dumps({"r": job.result or {}, "p": job.request_payload or {}}, ensure_ascii=False)
        )
        result = _strip_blobs(job.result)
        payload = _strip_blobs(job.request_payload)
        after = len(json.dumps({"r": result or {}, "p": payload or {}}, ensure_ascii=False))
        if after >= before:
            continue

        freed += before - after
        pruned += 1
        if apply:
            job.result = result
            job.request_payload = payload

    if apply:
        session.commit()
    if pruned:
        verb = "已清理" if apply else "待清理"
        print(f"\n{verb} {pruned} 个任务记录中的内嵌媒体，约 {freed / 1048576:.1f}MB")


def _strip_blobs(node: Any) -> Any:
    if isinstance(node, str):
        is_blob = ";base64," in node or len(node) > BLOB_LENGTH_THRESHOLD
        return "[pruned]" if is_blob else node
    if isinstance(node, list):
        return [_strip_blobs(item) for item in node]
    if isinstance(node, dict):
        return {key: _strip_blobs(item) for key, item in node.items()}
    return node


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="实际写入媒体存储并更新 payload")
    parser.add_argument("--episode-id", help="只处理指定剧集")
    parser.add_argument(
        "--prune-jobs", action="store_true", help="同时清理历史任务记录里内嵌的 base64"
    )
    args = parser.parse_args()

    settings = get_settings()
    engine = create_engine(to_sync_database_url(settings.database_url))
    total = Stats()

    with Session(engine) as session:
        query = select(Episode)
        if args.episode_id:
            query = query.where(Episode.id == args.episode_id)
        episodes = session.execute(query).scalars().all()

        for episode in episodes:
            payload = episode.payload or {}
            before = len(json.dumps(payload, ensure_ascii=False))
            stats = Stats()
            migrated = _walk(payload, episode.user_id, stats, args.apply)

            if stats.assets == 0:
                continue

            if args.apply:
                episode.payload = migrated
                session.commit()
                after = len(json.dumps(migrated, ensure_ascii=False))
            else:
                after = before - stats.bytes_inline

            print(
                f"[{episode.id}] {episode.title}: {stats.assets} 个内嵌媒体, "
                f"{before / 1048576:.1f}MB -> {after / 1048576:.1f}MB"
                + (f", {stats.failures} 个失败" if stats.failures else "")
            )
            total.assets += stats.assets
            total.bytes_inline += stats.bytes_inline
            total.bytes_stored += stats.bytes_stored
            total.failures += stats.failures

        if args.prune_jobs:
            _prune_job_payloads(session, args.apply)

    mode = "已迁移" if args.apply else "待迁移（--apply 才会写入）"
    print(
        f"\n{mode}: {total.assets} 个媒体, payload 可减少 "
        f"{total.bytes_inline / 1048576:.1f}MB"
        + (f", {total.failures} 个失败" if total.failures else "")
    )


if __name__ == "__main__":
    main()
