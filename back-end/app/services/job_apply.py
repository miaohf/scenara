"""把已完成的生成任务写回剧集 payload。

任务带有 episode_id + target 时，Worker 出图后自己落库，
前端离开页面也不会丢掉结果。
"""

from __future__ import annotations

import copy
from datetime import datetime, timezone
from typing import Any

from sqlalchemy.orm import Session

from app.models.episode import Episode
from app.models.settings import Job


def _same(left: Any, right: Any) -> bool:
    return str(left) == str(right)


def _media_url(job_type: str, result: dict[str, Any] | None) -> str | None:
    if not result:
        return None
    if job_type in {"video", "comfyui_video"}:
        return result.get("video_url") or result.get("video_data_url")
    return result.get("image_url") or result.get("image_data_url")


def _find_shot(shots: list[dict[str, Any]], shot_id: Any) -> dict[str, Any] | None:
    return next((shot for shot in shots if _same(shot.get("id"), shot_id)), None)


def _image_identity(url: Any) -> str:
    return str(url or "").split("?", 1)[0]


def _append_character_history(
    character: dict[str, Any],
    image_url: str | None,
    source: str = "generated",
) -> None:
    if not image_url:
        return
    history = character.get("imageHistory")
    if not isinstance(history, list):
        history = []
    key = _image_identity(image_url)
    existing = next(
        (entry for entry in history if isinstance(entry, dict) and _image_identity(entry.get("imageUrl")) == key),
        None,
    )
    now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
    entry = {
        "id": existing.get("id") if existing else f"character-image-{now_ms}",
        "imageUrl": image_url,
        "createdAt": existing.get("createdAt") if existing else now_ms,
        "source": existing.get("source", source) if existing else source,
    }
    if character.get("visualPrompt"):
        entry["prompt"] = character["visualPrompt"]
    character["imageHistory"] = [entry] + [
        row
        for row in history
        if not isinstance(row, dict) or _image_identity(row.get("imageUrl")) != key
    ][:11]


def _idle_status(has_media: bool, job_status: str) -> str:
    if job_status == "cancelled":
        return "completed" if has_media else "pending"
    return "failed"


_GENERATING_STATUSES = {"generating", "generating_image", "generating_panels"}


_EMPTY_SNAPSHOT_STATUSES = _GENERATING_STATUSES | {"failed", "pending"}


def _preserve_completed_media(
    old: dict[str, Any],
    new: dict[str, Any],
    url_key: str,
    *,
    done_status: str = "completed",
) -> dict[str, Any]:
    """前端自动保存若带着过期快照，不要把 Worker 已写回的媒体擦掉。

    生成期间的前端快照仍可能携带上一张图片，而 Worker 会先把新图片写入
    数据库。此时不能只判断 incoming URL 是否为空，否则旧图仍会覆盖新图。
    """
    merged = dict(new)
    old_url = old.get(url_key)
    incoming_status = str(merged.get("status") or "")
    is_stale_generation_snapshot = incoming_status in _EMPTY_SNAPSHOT_STATUSES
    if old_url and (not merged.get(url_key) or is_stale_generation_snapshot):
        merged[url_key] = old_url
        if is_stale_generation_snapshot:
            merged["status"] = done_status
    return merged


def _merge_shot(old: dict[str, Any], new: dict[str, Any]) -> dict[str, Any]:
    merged = dict(new)
    old_frames = {
        str(frame.get("type")): frame
        for frame in (old.get("keyframes") or [])
        if isinstance(frame, dict)
    }
    new_frames = merged.get("keyframes")
    if isinstance(new_frames, list):
        merged["keyframes"] = [
            _preserve_completed_media(old_frames.get(str(frame.get("type")), {}), frame, "imageUrl")
            if isinstance(frame, dict)
            else frame
            for frame in new_frames
        ]
    if isinstance(merged.get("interval"), dict) and isinstance(old.get("interval"), dict):
        merged["interval"] = _preserve_completed_media(old["interval"], merged["interval"], "videoUrl")
    if isinstance(merged.get("nineGrid"), dict) and isinstance(old.get("nineGrid"), dict):
        merged["nineGrid"] = _preserve_completed_media(old["nineGrid"], merged["nineGrid"], "imageUrl")
    return merged


def _merge_named_assets(old_items: list[Any], new_items: list[Any]) -> list[Any]:
    old_by_id = {str(item.get("id")): item for item in old_items if isinstance(item, dict)}
    merged: list[Any] = []
    for item in new_items:
        if not isinstance(item, dict):
            merged.append(item)
            continue
        old = old_by_id.get(str(item.get("id")), {})
        next_item = _preserve_completed_media(old, item, "referenceImage")
        for view_key in ("turnaround", "threeView"):
            if isinstance(old.get(view_key), dict) and isinstance(next_item.get(view_key), dict):
                next_item[view_key] = _preserve_completed_media(old[view_key], next_item[view_key], "imageUrl")
        history: list[Any] = []
        seen: set[str] = set()
        for entry in [*(next_item.get("imageHistory") or []), *(old.get("imageHistory") or [])]:
            if not isinstance(entry, dict):
                continue
            identity = _image_identity(entry.get("imageUrl"))
            if not identity or identity in seen:
                continue
            seen.add(identity)
            history.append(entry)
        if history:
            next_item["imageHistory"] = sorted(
                history,
                key=lambda entry: int(entry.get("createdAt") or 0),
                reverse=True,
            )[:12]
        merged.append(next_item)
    return merged


def merge_episode_payload(existing: dict[str, Any], incoming: dict[str, Any]) -> dict[str, Any]:
    """顶层键仍覆盖，但 shots/scriptData 里已完成的媒体不被 generating 空快照覆盖。"""
    merged = {**(existing or {}), **(incoming or {})}
    if isinstance(existing.get("shots"), list) and isinstance(incoming.get("shots"), list):
        old_by_id = {str(shot.get("id")): shot for shot in existing["shots"] if isinstance(shot, dict)}
        merged["shots"] = [
            _merge_shot(old_by_id.get(str(shot.get("id")), {}), shot) if isinstance(shot, dict) else shot
            for shot in incoming["shots"]
        ]
    old_script = existing.get("scriptData")
    new_script = incoming.get("scriptData")
    if isinstance(old_script, dict) and isinstance(new_script, dict):
        script = dict(new_script)
        for key in ("characters", "scenes", "props"):
            if isinstance(old_script.get(key), list) and isinstance(new_script.get(key), list):
                script[key] = _merge_named_assets(old_script[key], new_script[key])
        merged["scriptData"] = script
    return merged


def apply_target_to_payload(
    payload: dict[str, Any],
    target: dict[str, Any],
    job_type: str,
    result: dict[str, Any] | None,
    job_status: str = "failed",
) -> dict[str, Any] | None:
    """按 target 把媒体 URL / 状态写进 payload 的深拷贝。无法识别则返回 None。"""
    kind = str(target.get("kind") or "")
    if not kind:
        return None

    next_payload = copy.deepcopy(payload)
    script = next_payload.get("scriptData")
    if not isinstance(script, dict):
        script = {}
        next_payload["scriptData"] = script

    url = _media_url(job_type, result)

    if kind in {"character", "scene", "prop"}:
        key = {"character": "characters", "scene": "scenes", "prop": "props"}[kind]
        items = script.get(key)
        if not isinstance(items, list):
            return None
        item = next((row for row in items if _same(row.get("id"), target.get("id"))), None)
        if not item:
            return None
        if url:
            if kind == "character":
                _append_character_history(item, item.get("referenceImage"))
            item["referenceImage"] = url
            item["status"] = "completed"
            if kind == "character":
                item["activeImageView"] = "casting"
                _append_character_history(item, url)
        elif item.get("status") == "generating":
            item["status"] = _idle_status(bool(item.get("referenceImage")), job_status)
        return next_payload

    if kind == "variation":
        characters = script.get("characters")
        if not isinstance(characters, list):
            return None
        character = next(
            (row for row in characters if _same(row.get("id"), target.get("characterId"))),
            None,
        )
        variations = character.get("variations") if character else None
        if not isinstance(variations, list):
            return None
        variation = next((row for row in variations if _same(row.get("id"), target.get("id"))), None)
        if not variation:
            return None
        if url:
            variation["referenceImage"] = url
            variation["status"] = "completed"
        elif variation.get("status") == "generating":
            variation["status"] = _idle_status(bool(variation.get("referenceImage")), job_status)
        return next_payload

    if kind == "turnaround":
        characters = script.get("characters")
        if not isinstance(characters, list):
            return None
        character = next(
            (row for row in characters if _same(row.get("id"), target.get("characterId"))),
            None,
        )
        if not character:
            return None
        turnaround = character.get("turnaround")
        if not isinstance(turnaround, dict):
            turnaround = {}
            character["turnaround"] = turnaround
        if url:
            turnaround["imageUrl"] = url
            turnaround["status"] = "completed"
            character["activeImageView"] = "turnaround"
        elif turnaround.get("status") == "generating_image":
            turnaround["status"] = (
                "completed" if job_status == "cancelled" and turnaround.get("imageUrl") else "failed"
            )
        return next_payload

    if kind == "threeView":
        characters = script.get("characters")
        if not isinstance(characters, list):
            return None
        character = next(
            (row for row in characters if _same(row.get("id"), target.get("characterId"))),
            None,
        )
        if not character:
            return None
        three_view = character.get("threeView")
        if not isinstance(three_view, dict):
            three_view = {}
            character["threeView"] = three_view
        if url:
            three_view["imageUrl"] = url
            three_view["status"] = "completed"
            character["activeImageView"] = "threeView"
        elif three_view.get("status") == "generating":
            three_view["status"] = (
                "completed" if job_status == "cancelled" and three_view.get("imageUrl") else "failed"
            )
        return next_payload

    shots = next_payload.get("shots")
    if not isinstance(shots, list):
        return None
    shot = _find_shot(shots, target.get("shotId"))
    if not shot:
        return None

    if kind == "keyframe":
        frames = shot.get("keyframes")
        if not isinstance(frames, list):
            frames = []
            shot["keyframes"] = frames
        frame_type = target.get("type")
        frame = next((row for row in frames if row.get("type") == frame_type), None)
        if not frame:
            frame = {
                "id": f"kf-{shot.get('id')}-{frame_type}",
                "type": frame_type,
                "visualPrompt": "",
                "status": "pending",
            }
            frames.append(frame)
        # 关键帧被手动复制/上传或重新生成后会获得新的 generationId。
        # 旧任务即使稍后完成，也不能把旧图片写回当前关键帧。
        target_generation = target.get("generationId")
        current_generation = frame.get("generationId")
        if target_generation and current_generation and not _same(target_generation, current_generation):
            return None
        if not target_generation and current_generation:
            return None
        if url:
            frame["imageUrl"] = url
            if target_generation:
                frame["generationId"] = target_generation
            frame["status"] = "completed"
        elif frame.get("status") == "generating":
            frame["status"] = _idle_status(bool(frame.get("imageUrl")), job_status)
        return next_payload

    if kind == "video":
        interval = shot.get("interval")
        if not isinstance(interval, dict):
            interval = {}
            shot["interval"] = interval
        if url:
            interval["videoUrl"] = url
            interval["status"] = "completed"
        elif interval.get("status") == "generating":
            interval["status"] = _idle_status(bool(interval.get("videoUrl")), job_status)
        return next_payload

    if kind == "nineGrid":
        grid = shot.get("nineGrid")
        if not isinstance(grid, dict):
            grid = {}
            shot["nineGrid"] = grid
        if url:
            grid["imageUrl"] = url
            grid["status"] = "completed"
        elif grid.get("status") in {"generating_image", "generating"}:
            grid["status"] = _idle_status(bool(grid.get("imageUrl")), job_status)
        return next_payload

    return None


def apply_job_result_to_episode(session: Session, job: Job, result: dict[str, Any] | None) -> bool:
    if not job.episode_id:
        return False
    target = (job.request_payload or {}).get("_target")
    if not isinstance(target, dict):
        return False

    episode = session.get(Episode, job.episode_id)
    if episode is None or episode.user_id != job.user_id:
        return False

    updated = apply_target_to_payload(
        episode.payload or {}, target, job.job_type, result, job.status
    )
    if updated is None:
        return False

    episode.payload = updated
    episode.updated_at = datetime.now(timezone.utc)
    return True
