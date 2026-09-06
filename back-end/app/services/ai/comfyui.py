"""ComfyUI workflow execution (ported from services/adapters/imageAdapter & videoAdapter)."""

from __future__ import annotations

import asyncio
import base64
import copy
import io
import json
import random
import re
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any
from urllib.parse import urlencode

import httpx
import logging
import redis

from app.core.config import get_settings
from app.services.ai.chat import AiConfigError, _pick_model, _provider_for_model
from app.services.storage import (
    MediaStoreError,
    build_media_url,
    media_content_type,
    parse_media_url,
    read_media_bytes,
    save_media_bytes,
)

logger = logging.getLogger(__name__)

BACKEND_ROOT = Path(__file__).resolve().parents[3]
WORKFLOW_DIRS = [
    BACKEND_ROOT / "workflows",
]

COMFYUI_GPU_LOCK_KEY = "scenara:comfyui:gpu"
COMFYUI_GPU_LOCK_TIMEOUT_SEC = 3600
# How long a waiter may block for the GPU lock before failing fast.
COMFYUI_GPU_LOCK_BLOCKING_TIMEOUT_SEC = 180

COMFYUI_POLL_INTERVAL_SEC = 1.0
COMFYUI_MAX_POLLS_IMAGE = 1800  # Qwen 全量 ~50 steps @1328 可能超过 10 分钟
COMFYUI_MAX_POLLS_VIDEO = 3600  # MiniMax H3 20 steps @1344x768 可能超过 1 小时
IMG2IMG_DENOISE_CONTINUITY = 0.65
IMG2IMG_DENOISE_CHARACTER = 0.78
FLUX2_EDIT_MAX_REFS = 4


def _collect_reference_images(payload: dict[str, Any]) -> list[str]:
    """按关键帧语义收集最多 4 张参考图：角色/场景在前，连贯性图靠后。"""
    refs: list[str] = []
    seen: set[str] = set()

    def add(value: Any) -> None:
        text = str(value or "").strip()
        if not text or text in seen:
            return
        seen.add(text)
        refs.append(text)

    for img in payload.get("referenceImages") or payload.get("reference_images") or []:
        add(img)
    add(payload.get("characterReferenceImage") or payload.get("character_reference_image"))
    continuity = payload.get("continuityReferenceImage") or payload.get("continuity_reference_image")
    if continuity:
        add(continuity)
        if continuity in refs and refs[-1] != continuity:
            refs = [r for r in refs if r != continuity] + [continuity]
    return refs[:FLUX2_EDIT_MAX_REFS]


def _trim_flux2_reference_slots(
    nodes: dict[str, Any],
    used_count: int,
    *,
    width: int,
    height: int,
) -> None:
    """裁掉未使用的 Reference Image 槽位，并把 CFGGuider 接到最后一档 ReferenceLatent。"""
    used = max(0, min(FLUX2_EDIT_MAX_REFS, int(used_count)))

    cfg = next(
        (node for node in nodes.values() if str(node.get("class_type", "")).lower() == "cfgguider"),
        None,
    )

    if used <= 0:
        # 无参考：去掉全部参考链路，画布直接用请求宽高
        for nid in [
            nid
            for nid, node in list(nodes.items())
            if any(
                key in str((node.get("_meta") or {}).get("title", "")).lower()
                for key in (
                    "reference image",
                    "scale reference",
                    "vae encode reference",
                    "set reference latent",
                    "get image size",
                )
            )
        ]:
            nodes.pop(nid, None)
        for node in nodes.values():
            inputs = node.get("inputs") or {}
            class_type = str(node.get("class_type", "")).lower()
            if class_type in {"emptyflux2latentimage", "flux2scheduler"}:
                inputs["width"] = width
                inputs["height"] = height
        if cfg:
            inputs = cfg.setdefault("inputs", {})
            pos_clip = next(
                (
                    nid
                    for nid, node in nodes.items()
                    if "positive" in str((node.get("_meta") or {}).get("title", "")).lower()
                    and str(node.get("class_type", "")).lower() == "cliptextencode"
                ),
                None,
            )
            neg_clip = next(
                (
                    nid
                    for nid, node in nodes.items()
                    if "negative" in str((node.get("_meta") or {}).get("title", "")).lower()
                    and str(node.get("class_type", "")).lower() == "cliptextencode"
                ),
                None,
            )
            if pos_clip:
                inputs["positive"] = [pos_clip, 0]
            if neg_clip:
                inputs["negative"] = [neg_clip, 0]
        return

    if used >= FLUX2_EDIT_MAX_REFS:
        return

    drop_titles: set[str] = set()
    for n in range(used + 1, FLUX2_EDIT_MAX_REFS + 1):
        drop_titles.update(
            {
                f"reference image {n}",
                f"scale reference {n}",
                f"vae encode reference {n}",
                f"set reference latent {n} positive",
                f"set reference latent {n} negative",
            }
        )

    for nid in [
        nid
        for nid, node in list(nodes.items())
        if str((node.get("_meta") or {}).get("title", "")).lower() in drop_titles
    ]:
        nodes.pop(nid, None)

    if not cfg:
        return
    inputs = cfg.setdefault("inputs", {})
    pos_id = next(
        (
            nid
            for nid, node in nodes.items()
            if str((node.get("_meta") or {}).get("title", "")).lower()
            == f"set reference latent {used} positive"
        ),
        None,
    )
    neg_id = next(
        (
            nid
            for nid, node in nodes.items()
            if str((node.get("_meta") or {}).get("title", "")).lower()
            == f"set reference latent {used} negative"
        ),
        None,
    )
    if pos_id:
        inputs["positive"] = [pos_id, 0]
    if neg_id:
        inputs["negative"] = [neg_id, 0]


def normalize_comfy_base(base_url: str) -> str:
    base = (base_url or "").strip().rstrip("/")
    for suffix in ("/prompt", "/history", "/view", "/upload/image"):
        if base.lower().endswith(suffix):
            base = base[: -len(suffix)]
    return base.rstrip("/")


def resolve_comfy_base(registry: dict[str, Any], model_id: str | None, kind: str) -> str:
    model = _pick_model(registry, model_id, kind)
    provider = _provider_for_model(registry, model)
    endpoint = (model.get("endpoint") or provider.get("baseUrl") or "").strip()
    if endpoint.startswith("http"):
        return normalize_comfy_base(endpoint)
    return normalize_comfy_base(provider.get("baseUrl", ""))


async def interrupt_comfyui(base: str) -> None:
    """打断 ComfyUI 当前正在跑的 prompt（单机本地队列）。"""
    if not base:
        return
    try:
        async with httpx.AsyncClient(trust_env=False, timeout=5) as client:
            await client.post(f"{base.rstrip('/')}/interrupt")
    except Exception:
        logger.warning("ComfyUI interrupt 失败 base=%s", base, exc_info=True)


def _workflow_name_candidates(workflow_name: str) -> list[str]:
    trimmed = workflow_name.strip()
    if not trimmed:
        raise AiConfigError("ComfyUI 工作流名称为空")
    if trimmed.startswith("http") or trimmed.startswith("/"):
        return [trimmed]
    base = trimmed[:-5] if trimmed.endswith(".json") else trimmed
    names = {base, base.replace("-", "_"), base.replace("_", "-")}
    return list(names)


def load_workflow_template(workflow_name: str) -> dict[str, Any]:
    if workflow_name.startswith("http"):
        # remote template not supported server-side
        raise AiConfigError("远程工作流 URL 请改为本地 workflow 名称")

    for name in _workflow_name_candidates(workflow_name):
        for directory in WORKFLOW_DIRS:
            path = directory / f"{name}.json"
            if path.is_file():
                return json.loads(path.read_text(encoding="utf-8"))
    # Linux 大小写敏感：image_qwen_Image_2512 vs image_qwen_image_2512
    wanted = {n.lower() for n in _workflow_name_candidates(workflow_name)}
    for directory in WORKFLOW_DIRS:
        if not directory.is_dir():
            continue
        for path in directory.glob("*.json"):
            if path.stem.lower() in wanted:
                return json.loads(path.read_text(encoding="utf-8"))
    raise AiConfigError(f"ComfyUI 工作流模板未找到: {workflow_name}")


def list_workflow_templates() -> list[str]:
    names: set[str] = set()
    for directory in WORKFLOW_DIRS:
        if not directory.is_dir():
            continue
        for path in directory.glob("*.json"):
            if path.is_file():
                names.add(path.stem)
    return sorted(names)


@asynccontextmanager
async def _comfyui_gpu_lock():
    """Optional Redis lock; ComfyUI already queues prompts. Off by default."""
    settings = get_settings()
    if not settings.comfyui_gpu_lock_enabled:
        yield
        return

    lock = None
    acquired = False
    try:
        # Fail fast when Redis is down / port-forwarded but dead, so image
        # generation does not sit on the GPU lock for up to 1 hour.
        client = redis.from_url(
            settings.redis_url,
            socket_connect_timeout=2,
            socket_timeout=5,
        )
        # thread_local=False: acquire/release run in different to_thread workers
        lock = client.lock(
            COMFYUI_GPU_LOCK_KEY,
            timeout=COMFYUI_GPU_LOCK_TIMEOUT_SEC,
            blocking_timeout=COMFYUI_GPU_LOCK_BLOCKING_TIMEOUT_SEC,
            thread_local=False,
        )
        acquired = await asyncio.to_thread(lock.acquire, blocking=True)
        if not acquired:
            raise AiConfigError("ComfyUI GPU 队列等待超时，请稍后重试")
        yield
    except (redis.ConnectionError, redis.TimeoutError, OSError):
        # Redis 不可用时降级为无锁（仅适合本地开发调试）
        yield
    finally:
        if lock is not None and acquired:
            try:
                await asyncio.to_thread(lock.release)
            except (redis.RedisError, AttributeError, RuntimeError):
                # AttributeError: legacy thread-local token mismatch across to_thread workers
                pass


def _wrap_comfy_http_errors(exc: Exception, *, comfy_base: str = "") -> AiConfigError:
    target = f" ({comfy_base})" if comfy_base else ""
    if isinstance(exc, httpx.ConnectError):
        return AiConfigError(f"无法连接 ComfyUI{target}，请确认服务已启动: {exc}")
    if isinstance(exc, httpx.TimeoutException):
        return AiConfigError(f"ComfyUI 请求超时{target}: {exc}")
    if isinstance(exc, httpx.HTTPError):
        return AiConfigError(f"ComfyUI 请求失败{target}: {exc}")
    return AiConfigError(f"{exc}{target}")


def _decode_data_url(data_url: str) -> tuple[bytes, str]:
    match = re.match(r"^data:([a-zA-Z0-9.+/-]+);base64,(.+)$", data_url.strip())
    if not match:
        if re.match(r"^[A-Za-z0-9+/=]+$", data_url.strip()):
            return base64.b64decode(data_url), "image/png"
        raise AiConfigError("无效的图片 data URL")
    return base64.b64decode(match.group(2)), match.group(1)


async def _load_media_source(value: str) -> tuple[bytes, str]:
    """解析参考图/首帧/音频来源：媒体签名 URL、http(s) URL、data URL、裸 base64。

    历史剧集里仍是 base64，新剧集是媒体 URL，两者都要能喂给 ComfyUI。
    """
    text = (value or "").strip()
    if not text:
        raise AiConfigError("媒体来源为空")

    media_key = parse_media_url(text)
    if media_key:
        try:
            return read_media_bytes(media_key), media_content_type(media_key)
        except MediaStoreError as exc:
            raise AiConfigError(f"媒体文件读取失败 ({media_key}): {exc}") from exc

    if text.startswith(("http://", "https://")):
        async with httpx.AsyncClient(trust_env=False, timeout=120) as client:
            res = await client.get(text)
        if not res.is_success:
            raise AiConfigError(f"媒体下载失败 ({text[:120]}): HTTP {res.status_code}")
        return res.content, res.headers.get("content-type") or "image/png"

    if text.startswith("/"):
        raise AiConfigError(f"无法解析的媒体路径: {text[:120]}")

    return _decode_data_url(text)


def _store_generated_media(
    content: bytes,
    *,
    user_id: int | None,
    suffix: str,
    content_type: str,
) -> dict[str, str]:
    """把生成结果落地为媒体对象，返回可直接渲染的 URL。

    落盘失败（或缺少 user_id）时降级为 data URL，保证生成结果不丢。
    """
    if user_id is not None:
        try:
            media_key = save_media_bytes(
                user_id, content, suffix=suffix, content_type=content_type
            )
            return {"media_key": media_key, "url": build_media_url(media_key)}
        except MediaStoreError as exc:
            logger.warning("媒体落盘失败，降级为 base64: %s", exc)

    b64 = base64.b64encode(content).decode("ascii")
    return {"base64": b64, "url": f"data:{content_type};base64,{b64}"}


def _resize_image_bytes(image_bytes: bytes, width: int, height: int) -> bytes:
    try:
        from PIL import Image
    except ImportError:
        return image_bytes

    img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    scale = max(width / img.width, height / img.height)
    new_size = (int(img.width * scale), int(img.height * scale))
    resized = img.resize(new_size, Image.Resampling.LANCZOS)
    left = (new_size[0] - width) // 2
    top = (new_size[1] - height) // 2
    cropped = resized.crop((left, top, left + width, top + height))
    out = io.BytesIO()
    cropped.save(out, format="PNG")
    return out.getvalue()


def _resolution_selector_aspect(aspect_ratio: str) -> str:
    normalized = (aspect_ratio or "16:9").strip()
    if normalized == "9:16":
        return "9:16 (Mobile/Portrait)"
    if normalized == "1:1":
        return "1:1 (Square)"
    return "16:9 (Widescreen)"


def _aspect_ratio_size(aspect_ratio: str, *, video: bool = False, minimax: bool = False) -> tuple[int, int]:
    if minimax:
        mapping = {"16:9": (1344, 768), "9:16": (768, 1344), "1:1": (768, 768)}
    elif video:
        mapping = {"16:9": (1280, 720), "9:16": (720, 1280), "1:1": (720, 720)}
    else:
        mapping = {"16:9": (1024, 576), "9:16": (576, 1024), "1:1": (1024, 1024)}
    return mapping.get(aspect_ratio, mapping["16:9"])


def _pick_img2img_source(continuity: str | None, character: str | None) -> tuple[str | None, str]:
    if continuity:
        return continuity, "continuity"
    if character:
        return character, "character"
    return None, "none"


def _resolve_img2img_workflow_name(workflow_name: str) -> str:
    trimmed = workflow_name.strip()
    if trimmed.endswith("-img2img") or trimmed.endswith("_img2img"):
        return trimmed
    base = trimmed[:-5] if trimmed.endswith(".json") else trimmed
    return f"{base}-img2img"


def _resolve_denoise(mode: str, override: float | None) -> float | None:
    if override is not None:
        return override
    if mode == "continuity":
        return IMG2IMG_DENOISE_CONTINUITY
    if mode == "character":
        return IMG2IMG_DENOISE_CHARACTER
    return None


def patch_image_workflow(
    workflow: dict[str, Any],
    *,
    prompt: str,
    negative_prompt: str | None = None,
    width: int,
    height: int,
    seed: int,
    steps: int,
    reference_image_name: str | None = None,
    reference_image_names: list[str] | None = None,
    denoise: float | None = None,
) -> dict[str, Any]:
    patched = copy.deepcopy(workflow)
    nodes = patched.get("prompt") or patched
    if not isinstance(nodes, dict):
        raise AiConfigError("ComfyUI 工作流格式无效")

    prompt_patched = False
    reference_patched = False
    ref_names = [n for n in (reference_image_names or []) if n]
    if not ref_names and reference_image_name:
        ref_names = [reference_image_name]
    # Lightning 开关图里常有两个 Steps PrimitiveInt（如 50 / 4）；只改写与请求步数同档的那一侧
    step_primitives: list[tuple[dict[str, Any], float]] = []
    for node in nodes.values():
        inputs = node.get("inputs") or {}
        class_type = str(node.get("class_type", "")).lower()
        title = str((node.get("_meta") or {}).get("title", "")).lower()
        if (
            class_type == "primitiveint"
            and "step" in title
            and isinstance(inputs.get("value"), int | float)
        ):
            step_primitives.append((inputs, float(inputs["value"])))

    slot_nodes: dict[int, dict[str, Any]] = {}
    for node in nodes.values():
        inputs = node.get("inputs") or {}
        class_type = str(node.get("class_type", "")).lower()
        title = str((node.get("_meta") or {}).get("title", "")).lower()
        if class_type != "loadimage":
            continue
        slot_match = re.search(r"reference\s*image\s*(\d+)", title)
        if slot_match:
            slot_nodes[int(slot_match.group(1))] = inputs

    for slot, name in enumerate(ref_names, start=1):
        if slot in slot_nodes and isinstance(slot_nodes[slot].get("image"), str):
            slot_nodes[slot]["image"] = name
            reference_patched = True

    for node in nodes.values():
        inputs = node.get("inputs") or {}
        class_type = str(node.get("class_type", "")).lower()
        title = str((node.get("_meta") or {}).get("title", "")).lower()
        is_negative = "negative" in title

        if (
            title == "prompt"
            and class_type == "primitivestringmultiline"
            and isinstance(inputs.get("value"), str)
        ):
            inputs["value"] = prompt
            prompt_patched = True

        if not is_negative and "text" in inputs and isinstance(inputs["text"], str) and "clip" in class_type:
            inputs["text"] = prompt
            prompt_patched = True
        if not is_negative and "prompt" in inputs and isinstance(inputs["prompt"], str):
            inputs["prompt"] = prompt
            prompt_patched = True
        if not is_negative and "positive" in inputs and isinstance(inputs["positive"], str):
            inputs["positive"] = prompt
            prompt_patched = True
        # Flux: CLIPTextEncodeFlux uses clip_l + t5xxl instead of text
        if class_type == "cliptextencodeflux":
            if isinstance(inputs.get("clip_l"), str):
                inputs["clip_l"] = prompt
                prompt_patched = True
            if isinstance(inputs.get("t5xxl"), str):
                inputs["t5xxl"] = prompt
                prompt_patched = True

        if negative_prompt:
            if is_negative and "text" in inputs and isinstance(inputs["text"], str):
                inputs["text"] = negative_prompt
            elif is_negative and "prompt" in inputs and isinstance(inputs["prompt"], str):
                inputs["prompt"] = negative_prompt
            elif "negative" in title and "text" in inputs and isinstance(inputs["text"], str):
                inputs["text"] = negative_prompt

        # Flux2 Klein 等：Width/Height 常是 PrimitiveInt，再接到 EmptyFlux2LatentImage
        if title == "width" and isinstance(inputs.get("value"), int | float):
            inputs["value"] = width
        elif "width" in inputs and isinstance(inputs["width"], int | float):
            inputs["width"] = width
        if title == "height" and isinstance(inputs.get("value"), int | float):
            inputs["value"] = height
        elif "height" in inputs and isinstance(inputs["height"], int | float):
            inputs["height"] = height
        if "seed" in inputs and isinstance(inputs["seed"], int | float):
            inputs["seed"] = seed
        if "noise_seed" in inputs and isinstance(inputs["noise_seed"], int | float):
            inputs["noise_seed"] = seed
        if "steps" in inputs and isinstance(inputs["steps"], int | float):
            inputs["steps"] = steps
        if denoise is not None and "denoise" in inputs and isinstance(inputs["denoise"], int | float):
            inputs["denoise"] = denoise

        if (
            not reference_patched
            and reference_image_name
            and class_type == "loadimage"
            and "image" in inputs
            and isinstance(inputs["image"], str)
        ):
            # 多槽 Reference Image N：单参考注入只写槽位 1，避免把 2–5 全改成同一张
            slot_match = re.search(r"reference\s*image\s*(\d+)", title)
            if slot_match and int(slot_match.group(1)) != 1:
                continue
            if "reference" in title or "load image" in title or not reference_patched:
                inputs["image"] = reference_image_name
                reference_patched = True

    if step_primitives:
        if len(step_primitives) == 1:
            step_primitives[0][0]["value"] = steps
        else:
            # 高步数请求 → 改写当前值较大的全量路径；低步数 → 改写 Lightning 路径
            target = max(step_primitives, key=lambda x: x[1]) if steps > 8 else min(
                step_primitives, key=lambda x: x[1]
            )
            target[0]["value"] = steps

    if slot_nodes:
        _trim_flux2_reference_slots(nodes, len(ref_names), width=width, height=height)

    if not prompt_patched:
        raise AiConfigError("工作流中未找到 prompt 节点")
    return nodes


def patch_video_workflow(
    workflow: dict[str, Any],
    *,
    prompt: str,
    width: int,
    height: int,
    seed: int,
    steps: int,
    duration: float,
    aspect_ratio: str = "16:9",
    start_image_name: str | None = None,
    end_image_name: str | None = None,
    audio_name: str | None = None,
) -> dict[str, Any]:
    patched = copy.deepcopy(workflow)
    nodes = patched.get("prompt") or patched
    if not isinstance(nodes, dict):
        raise AiConfigError("ComfyUI 视频工作流格式无效")

    uses_primitive = any(
        str(n.get("_meta", {}).get("title", "")).lower() == "prompt"
        and str(n.get("class_type", "")) == "PrimitiveStringMultiline"
        for n in nodes.values()
    )
    frame_rate = 25
    for node in nodes.values():
        title = str(node.get("_meta", {}).get("title", "")).lower()
        if "frame rate" in title:
            val = node.get("inputs", {}).get("value")
            if isinstance(val, int | float):
                frame_rate = int(val)

    prompt_patched = False
    first_image_patched = False
    for node in nodes.values():
        inputs = node.get("inputs") or {}
        class_type = str(node.get("class_type", "")).lower()
        title = str(node.get("_meta", {}).get("title", "")).lower()
        is_negative = "clip" in class_type and "negative" in title

        if title == "prompt" and class_type == "primitivestringmultiline" and isinstance(inputs.get("value"), str):
            inputs["value"] = prompt
            prompt_patched = True
        if not is_negative and "positive" in title and isinstance(inputs.get("text"), str):
            inputs["text"] = prompt
            prompt_patched = True
        if not uses_primitive and not is_negative and "text" in inputs and isinstance(inputs["text"], str) and "clip" in class_type:
            inputs["text"] = prompt
            prompt_patched = True
        if isinstance(inputs.get("prompt"), str):
            inputs["prompt"] = prompt
            prompt_patched = True
        if isinstance(inputs.get("positive"), str):
            inputs["positive"] = prompt
            prompt_patched = True

        if title == "width" and isinstance(inputs.get("value"), int | float):
            inputs["value"] = width
        elif isinstance(inputs.get("width"), int | float):
            inputs["width"] = width
        if title == "height" and isinstance(inputs.get("value"), int | float):
            inputs["value"] = height
        elif isinstance(inputs.get("height"), int | float):
            inputs["height"] = height
        if title == "length" and isinstance(inputs.get("value"), int | float):
            inputs["value"] = max(1, round(duration * frame_rate))
        if (
            "duration" in title
            and class_type in {"primitivefloat", "primitiveint"}
            and isinstance(inputs.get("value"), int | float)
        ):
            inputs["value"] = int(duration) if class_type == "primitiveint" else duration
        if class_type == "resolutionselector" and isinstance(inputs.get("aspect_ratio"), str):
            inputs["aspect_ratio"] = _resolution_selector_aspect(aspect_ratio)
        if isinstance(inputs.get("seed"), int | float):
            inputs["seed"] = seed
        if isinstance(inputs.get("noise_seed"), int | float):
            inputs["noise_seed"] = seed
        if isinstance(inputs.get("steps"), int | float):
            inputs["steps"] = steps
        if isinstance(inputs.get("duration"), int | float):
            inputs["duration"] = duration
        if isinstance(inputs.get("seconds"), int | float):
            inputs["seconds"] = duration

        if start_image_name and class_type == "loadimage" and isinstance(inputs.get("image"), str):
            if "first" in title:
                inputs["image"] = start_image_name
                first_image_patched = True
            elif "last" in title:
                inputs["image"] = end_image_name or start_image_name
            elif not first_image_patched:
                inputs["image"] = start_image_name
                first_image_patched = True
            else:
                inputs["image"] = end_image_name or start_image_name

        if audio_name and class_type == "loadaudio" and isinstance(inputs.get("audio"), str):
            inputs["audio"] = audio_name
            inputs.pop("audioUI", None)

    minimax_id = None
    last_loader_id = None
    for node_id, node in nodes.items():
        class_type = str(node.get("class_type", "")).lower()
        title = str(node.get("_meta", {}).get("title", "")).lower()
        if class_type == "minimaxh3imagetovideo":
            minimax_id = node_id
        if class_type == "loadimage" and "last" in title:
            last_loader_id = node_id
    if minimax_id:
        minimax_inputs = nodes[minimax_id].setdefault("inputs", {})
        if end_image_name and last_loader_id:
            minimax_inputs["last_frame"] = [last_loader_id, 0]
        else:
            minimax_inputs.pop("last_frame", None)

    if not prompt_patched:
        raise AiConfigError("视频工作流中未找到 prompt 节点")
    return nodes


async def _upload_file(client: httpx.AsyncClient, base: str, path: str, field: str, filename: str, content: bytes, content_type: str) -> str:
    files = {field: (filename, content, content_type)}
    data = {"overwrite": "true"}
    res = await client.post(f"{base}{path}", files=files, data=data, timeout=120)
    if not res.is_success:
        raise AiConfigError(f"ComfyUI 上传失败 ({path}): {res.text}")
    result = res.json()
    return result.get("name") or filename


async def _upload_image(client: httpx.AsyncClient, base: str, data_url: str, filename: str) -> str:
    raw, mime = _decode_data_url(data_url)
    return await _upload_file(client, base, "/upload/image", "image", filename, raw, mime)


async def _upload_audio(client: httpx.AsyncClient, base: str, data_url: str, filename: str) -> str:
    raw, mime = await _load_media_source(data_url)
    for path, field in (("/upload/audio", "audio"), ("/upload/image", "image")):
        try:
            return await _upload_file(client, base, path, field, filename, raw, mime)
        except AiConfigError:
            continue
    raise AiConfigError("ComfyUI 音频上传失败")


def _build_view_url(base: str, file_info: dict[str, Any]) -> str:
    params = {"filename": file_info.get("filename", "")}
    if file_info.get("subfolder"):
        params["subfolder"] = file_info["subfolder"]
    if file_info.get("type"):
        params["type"] = file_info["type"]
    return f"{base}/view?{urlencode(params)}"


def _comfy_ws_url(base: str, client_id: str) -> str:
    root = base.rstrip("/")
    if root.startswith("https://"):
        root = "wss://" + root[len("https://") :]
    elif root.startswith("http://"):
        root = "ws://" + root[len("http://") :]
    return f"{root}/ws?clientId={client_id}"


# 采样步数条通常 >= 4；加载权重/单节点完成常见 1/1，不能当成进度。
_SAMPLER_PROGRESS_MIN_STEPS = 4


def _as_step_progress(
    value: int,
    maximum: int,
    *,
    sampling_started: bool,
    locked_max: int | None = None,
) -> tuple[int, int, str] | None:
    if maximum < _SAMPLER_PROGRESS_MIN_STEPS:
        return None
    if locked_max is not None and maximum != locked_max:
        return None
    if not sampling_started:
        # 采样 tqdm 从 0/N 或 1/N 起；加载模型常直接报到接近完成。
        if value >= maximum:
            return None
        if value > 2 and value / maximum > 0.25:
            return None
    if value <= 0:
        return 0, maximum, f"ComfyUI 0/{maximum}"
    return min(99, int(value / maximum * 100)), maximum, f"ComfyUI {value}/{maximum}"


def _progress_from_comfy_message(
    message: dict[str, Any],
    prompt_id: str | None,
    *,
    sampling_started: bool,
    locked_max: int | None = None,
) -> tuple[int, int, str] | None:
    data = message.get("data") if isinstance(message.get("data"), dict) else {}
    incoming_id = data.get("prompt_id")
    if prompt_id and incoming_id and str(incoming_id) != str(prompt_id):
        return None

    msg_type = message.get("type")
    if msg_type == "progress":
        return _as_step_progress(
            int(data.get("value") or 0),
            int(data.get("max") or 0),
            sampling_started=sampling_started,
            locked_max=locked_max,
        )

    if msg_type == "progress_state":
        nodes = data.get("nodes") if isinstance(data.get("nodes"), dict) else {}
        best: tuple[int, int] | None = None
        for node in nodes.values():
            if not isinstance(node, dict):
                continue
            state = str(node.get("state") or "").lower()
            if state in {"finished", "pending", "idle"}:
                continue
            value = int(node.get("value") or 0)
            maximum = int(node.get("max") or 0)
            parsed = _as_step_progress(
                value,
                maximum,
                sampling_started=sampling_started,
                locked_max=locked_max,
            )
            if parsed and (best is None or maximum > best[1]):
                best = (value, maximum)
        if not best:
            return None
        return _as_step_progress(
            *best,
            sampling_started=sampling_started,
            locked_max=locked_max,
        )

    return None


async def _listen_comfy_progress(
    base: str,
    client_id: str,
    prompt_id: str,
    on_progress: Any | None,
) -> None:
    if on_progress is None:
        return
    try:
        import websockets
    except ImportError:
        return

    sampling_started = False
    locked_max: int | None = None
    try:
        async with websockets.connect(_comfy_ws_url(base, client_id), open_timeout=5, close_timeout=2) as ws:
            async for raw in ws:
                try:
                    message = json.loads(raw)
                except Exception:
                    continue
                if not isinstance(message, dict):
                    continue
                parsed = _progress_from_comfy_message(
                    message,
                    prompt_id,
                    sampling_started=sampling_started,
                    locked_max=locked_max,
                )
                if parsed:
                    percent, locked_max, text = parsed
                    sampling_started = True
                    on_progress(percent, text)
    except asyncio.CancelledError:
        raise
    except Exception:
        logger.debug("ComfyUI websocket 进度订阅失败", exc_info=True)


async def _queue_and_poll(
    client: httpx.AsyncClient,
    base: str,
    prompt: dict[str, Any],
    *,
    max_polls: int,
    poll_interval: float,
    on_progress: Any | None = None,
) -> bytes:
    client_id = f"bigbanana-{uuid.uuid4().hex[:12]}"
    prompt_url = f"{base}/prompt"
    logger.info("ComfyUI POST %s (nodes=%s)", prompt_url, len(prompt))
    res = await client.post(prompt_url, json={"prompt": prompt, "client_id": client_id}, timeout=60)
    if not res.is_success:
        raise AiConfigError(f"ComfyUI 提交失败 ({prompt_url}): {res.text}")
    prompt_id = res.json().get("prompt_id")
    if not prompt_id:
        raise AiConfigError(f"ComfyUI 未返回 prompt_id ({prompt_url})")

    if on_progress:
        on_progress(0, "ComfyUI 已入队")

    # httpx 每次请求都会打一条 INFO，2 分钟的任务就刷上百行；轮询期间只保留告警级别
    httpx_logger = logging.getLogger("httpx")
    previous_httpx_level = httpx_logger.level
    httpx_logger.setLevel(logging.WARNING)
    listener = asyncio.create_task(_listen_comfy_progress(base, client_id, prompt_id, on_progress))
    try:
        return await _poll_history(
            client,
            base,
            prompt_id,
            max_polls=max_polls,
            poll_interval=poll_interval,
        )
    finally:
        listener.cancel()
        try:
            await listener
        except asyncio.CancelledError:
            pass
        httpx_logger.setLevel(previous_httpx_level)


def _queue_prompt_ids(items: Any) -> set[str]:
    ids: set[str] = set()
    for item in items or []:
        if isinstance(item, (list, tuple)) and len(item) > 1:
            ids.add(str(item[1]))
    return ids


async def _prompt_queue_state(client: httpx.AsyncClient, base: str, prompt_id: str) -> str:
    """running | pending | missing | unknown"""
    try:
        response = await client.get(f"{base.rstrip('/')}/queue", timeout=10)
        if not response.is_success:
            return "unknown"
        data = response.json()
        if prompt_id in _queue_prompt_ids(data.get("queue_running")):
            return "running"
        if prompt_id in _queue_prompt_ids(data.get("queue_pending")):
            return "pending"
        return "missing"
    except Exception:
        return "unknown"


async def _poll_history(
    client: httpx.AsyncClient,
    base: str,
    prompt_id: str,
    *,
    max_polls: int,
    poll_interval: float,
) -> bytes:
    missing_streak = 0
    for poll_index in range(max_polls):
        await asyncio.sleep(poll_interval)
        poll_url = f"{base}/history/{prompt_id}"
        history_res = await client.get(poll_url, timeout=30)
        if not history_res.is_success:
            continue
        record = history_res.json().get(prompt_id) or {}
        outputs = record.get("outputs") or {}
        for output in outputs.values():
            for key in ("images", "videos", "gifs"):
                files = output.get(key) or []
                if not files:
                    continue
                file_info = files[0]
                view_url = _build_view_url(base, file_info)
                logger.info("ComfyUI result ready after %s polls: %s", poll_index + 1, view_url)
                view_res = await client.get(view_url, timeout=120)
                if view_res.is_success:
                    return view_res.content
        status = record.get("status", {})
        if status.get("status_str") == "error":
            raise AiConfigError(
                f"ComfyUI 执行失败 ({base}): {status.get('messages') or 'unknown'}"
            )
        if record:
            missing_streak = 0
            continue
        queue_state = await _prompt_queue_state(client, base, prompt_id)
        if queue_state in {"running", "pending", "unknown"}:
            missing_streak = 0
            continue
        missing_streak += 1
        if missing_streak >= 3:
            raise AiConfigError("ComfyUI 任务已丢失：队列和历史均为空，可能已重启或被中断")

    raise AiConfigError(f"ComfyUI 生成超时 ({base}; polls={max_polls})")


async def run_comfy_image(
    registry: dict[str, Any],
    payload: dict[str, Any],
    on_progress: Any | None = None,
    user_id: int | None = None,
) -> dict[str, str]:
    model_id = payload.get("modelId")
    base = resolve_comfy_base(registry, model_id, "image")
    model = _pick_model(registry, model_id, "image")
    workflow_name = (
        (payload.get("workflowName") or "").strip()
        or (model.get("params") or {}).get("workflowName")
        or model.get("apiModel")
        or model.get("id")
    )
    steps = int((model.get("params") or {}).get("steps") or payload.get("steps") or 20)
    if payload.get("steps") is not None:
        steps = int(payload["steps"])
    aspect_ratio = payload.get("aspectRatio") or "16:9"
    width, height = _aspect_ratio_size(aspect_ratio, video=False)

    source, mode = _pick_img2img_source(
        payload.get("continuityReferenceImage"),
        payload.get("characterReferenceImage"),
    )
    reference_sources = _collect_reference_images(payload)
    use_reference = bool(reference_sources) or bool(source)
    denoise = _resolve_denoise(mode, payload.get("img2imgDenoise")) if source else None
    seed_raw = payload.get("seed")
    # 未显式传 seed 时每次随机（ComfyUI RandomNoise 为 64-bit 量级）
    seed = int(seed_raw) if seed_raw is not None else random.getrandbits(63)

    # 优先尝试 *-img2img 变体；不存在则用原工作流，并保留参考图写入 LoadImage（Edit/Turnaround）
    effective_workflow = workflow_name
    if source and not reference_sources:
        # 旧单图 img2img 路径
        img2img_name = _resolve_img2img_workflow_name(workflow_name)
        try:
            workflow = load_workflow_template(img2img_name)
            effective_workflow = img2img_name
        except AiConfigError:
            workflow = load_workflow_template(workflow_name)
            denoise = None
    else:
        workflow = load_workflow_template(workflow_name)
        # Edit 多参考工作流不走 denoise img2img 语义
        if reference_sources:
            denoise = None

    reference_name = None
    reference_names: list[str] = []
    upload_url = f"{base}/upload/image"
    prompt_url = f"{base}/prompt"
    logger.info(
        "ComfyUI image start model_id=%s workflow=%s effective=%s "
        "comfy_base=%s upload=%s prompt=%s size=%sx%s steps=%s seed=%s has_ref=%s ref_count=%s",
        model_id,
        workflow_name,
        effective_workflow,
        base,
        upload_url,
        prompt_url,
        width,
        height,
        steps,
        seed,
        use_reference,
        len(reference_sources) or (1 if source else 0),
    )
    try:
        async with _comfyui_gpu_lock():
            async with httpx.AsyncClient(trust_env=False, timeout=120) as client:
                upload_list = reference_sources or ([source] if source else [])
                for idx, img in enumerate(upload_list):
                    raw, _ = await _load_media_source(img)
                    raw = _resize_image_bytes(raw, width, height)
                    b64 = base64.b64encode(raw).decode("ascii")
                    logger.info("ComfyUI POST upload %s (ref %s/%s)", upload_url, idx + 1, len(upload_list))
                    name = await _upload_image(
                        client, base, f"data:image/png;base64,{b64}", f"ref-{seed}-{idx + 1}.png"
                    )
                    reference_names.append(name)
                if reference_names:
                    reference_name = reference_names[0]

                prompt_nodes = patch_image_workflow(
                    workflow,
                    prompt=payload.get("prompt", ""),
                    negative_prompt=payload.get("negativePrompt") or payload.get("negative_prompt"),
                    width=width,
                    height=height,
                    seed=seed,
                    steps=steps,
                    reference_image_name=reference_name,
                    reference_image_names=reference_names or None,
                    denoise=denoise,
                )
                content = await _queue_and_poll(
                    client,
                    base,
                    prompt_nodes,
                    max_polls=COMFYUI_MAX_POLLS_IMAGE,
                    poll_interval=COMFYUI_POLL_INTERVAL_SEC,
                    on_progress=on_progress,
                )
    except AiConfigError as exc:
        logger.warning("ComfyUI image failed base=%s: %s", base, exc)
        raise
    except httpx.HTTPError as exc:
        logger.warning("ComfyUI HTTP error base=%s: %s", base, exc)
        raise _wrap_comfy_http_errors(exc, comfy_base=base) from exc

    stored = _store_generated_media(
        content, user_id=user_id, suffix=".png", content_type="image/png"
    )
    result: dict[str, str] = {"image_url": stored["url"], "image_data_url": stored["url"]}
    if "media_key" in stored:
        result["media_key"] = stored["media_key"]
    if "base64" in stored:
        result["image_base64"] = stored["base64"]
    return result


async def run_comfy_video(
    registry: dict[str, Any],
    payload: dict[str, Any],
    on_progress: Any | None = None,
    user_id: int | None = None,
) -> dict[str, str]:
    model_id = payload.get("modelId")
    base = resolve_comfy_base(registry, model_id, "video")
    model = _pick_model(registry, model_id, "video")
    params = model.get("params") or {}
    workflow_name = params.get("workflowName") or model.get("apiModel") or model.get("id")
    steps = int(params.get("steps") or 20)
    aspect_ratio = payload.get("aspectRatio") or params.get("defaultAspectRatio") or "16:9"
    duration = float(payload.get("duration") or params.get("defaultDuration") or 5)
    is_minimax = "minimax" in str(workflow_name).lower()
    width, height = _aspect_ratio_size(aspect_ratio, video=True, minimax=is_minimax)
    seed = random.randint(0, 2**31 - 1)

    start_image = payload.get("startImage")
    if not start_image:
        raise AiConfigError("ComfyUI 图生视频需要首帧图片")

    workflow = load_workflow_template(workflow_name)
    logger.info(
        "ComfyUI video start model_id=%s workflow=%s comfy_base=%s "
        "upload=%s/upload/image prompt=%s/prompt size=%sx%s",
        model_id,
        workflow_name,
        base,
        base,
        base,
        width,
        height,
    )
    async with _comfyui_gpu_lock():
        async with httpx.AsyncClient(trust_env=False, timeout=7200) as client:
            start_raw, start_mime = await _load_media_source(start_image)
            if is_minimax:
                start_raw = _resize_image_bytes(start_raw, width, height)
                start_mime = "image/png"
            start_name = await _upload_file(
                client, base, "/upload/image", "image", f"start-{seed}.png", start_raw, start_mime
            )
            end_name = None
            if payload.get("endImage"):
                end_raw, end_mime = await _load_media_source(payload["endImage"])
                if is_minimax:
                    end_raw = _resize_image_bytes(end_raw, width, height)
                    end_mime = "image/png"
                end_name = await _upload_file(
                    client, base, "/upload/image", "image", f"end-{seed}.png", end_raw, end_mime
                )
            audio_name = None
            if payload.get("audioUrl"):
                audio_name = await _upload_audio(client, base, payload["audioUrl"], f"audio-{seed}.wav")

            prompt_nodes = patch_video_workflow(
                workflow,
                prompt=payload.get("prompt", ""),
                width=width,
                height=height,
                seed=seed,
                steps=steps,
                duration=duration,
                aspect_ratio=aspect_ratio,
                start_image_name=start_name,
                end_image_name=end_name,
                audio_name=audio_name,
            )
            content = await _queue_and_poll(
                client,
                base,
                prompt_nodes,
                max_polls=COMFYUI_MAX_POLLS_VIDEO,
                poll_interval=2.0,
                on_progress=on_progress,
            )

    stored = _store_generated_media(
        content, user_id=user_id, suffix=".mp4", content_type="video/mp4"
    )
    result: dict[str, str] = {"video_url": stored["url"], "video_data_url": stored["url"]}
    if "media_key" in stored:
        result["media_key"] = stored["media_key"]
    if "base64" in stored:
        result["video_base64"] = stored["base64"]
    return result
