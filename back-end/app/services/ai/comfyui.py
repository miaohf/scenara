"""ComfyUI workflow execution (ported from services/adapters/imageAdapter & videoAdapter)."""

from __future__ import annotations

import asyncio
import base64
import copy
import io
import json
import os
import random
import re
import tempfile
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
from app.services.model_registry import (
    DEFAULT_IMAGE_WORKFLOW_NAME,
    DEFAULT_VIDEO_WORKFLOW_NAME,
    MINIMAX_H3_R2V_WORKFLOW_NAME,
)
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
COMFYUI_NETWORK_RETRY_LOG_EVERY = 10
IMG2IMG_DENOISE_CONTINUITY = 0.65
IMG2IMG_DENOISE_CHARACTER = 0.78
FLUX2_EDIT_MAX_REFS = 4
QWEN_EDIT_MAX_REFS = 5
QWEN_IMAGE_21_EDIT_MAX_REFS = 10  # 官方 Image Edit (Qwen Image 2.1) 最多 image_1..image_10
COMFY_EDIT_MAX_REFS = QWEN_EDIT_MAX_REFS
QWEN_EDIT_SLOT_SCAN = max(QWEN_EDIT_MAX_REFS, QWEN_IMAGE_21_EDIT_MAX_REFS)


def _collect_reference_images(payload: dict[str, Any]) -> list[str]:
    """收集参考图。若已有打包列表则保持其顺序，不再把定妆图强行插到 Image 1。"""
    refs: list[str] = []
    seen: set[str] = set()

    def add(value: Any) -> None:
        text = str(value or "").strip()
        if not text or text in seen:
            return
        seen.add(text)
        refs.append(text)

    packed = payload.get("referenceImages") or payload.get("reference_images") or []
    if packed:
        for img in packed:
            add(img)
    else:
        add(payload.get("characterReferenceImage") or payload.get("character_reference_image"))
    continuity = payload.get("continuityReferenceImage") or payload.get("continuity_reference_image")
    if continuity:
        add(continuity)
        if continuity in refs and refs[-1] != continuity:
            refs = [r for r in refs if r != continuity] + [continuity]
    return refs[:COMFY_EDIT_MAX_REFS]


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


def _qwen_image_input_keys(slot: int) -> tuple[str, ...]:
    """Qwen Edit 用 imageN；Qwen Image 2.1 用 images.image_N。"""
    return (f"images.image_{slot}", f"image{slot}")


def _node_has_qwen_image_refs(node: dict[str, Any]) -> bool:
    inputs = node.get("inputs") or {}
    class_type = str(node.get("class_type", "")).lower()
    if "textencodeqwenimageedit" in class_type:
        return True
    if "textencodeqwenimage21" not in class_type:
        return False
    return any(
        key in inputs and isinstance(inputs.get(key), list)
        for slot in range(1, QWEN_EDIT_SLOT_SCAN + 1)
        for key in _qwen_image_input_keys(slot)
    )


def _is_qwen_edit_workflow(nodes: dict[str, Any]) -> bool:
    return any(_node_has_qwen_image_refs(node) for node in nodes.values())


_DEFAULT_QWEN_REF_NAMES = {"example.png", "1.png", "2.png", "3.png"}


def _is_placeholder_ref_name(name: str) -> bool:
    text = str(name or "").strip().lower()
    return (not text) or text in _DEFAULT_QWEN_REF_NAMES or text.startswith("pasted/")


def _is_r2v_placeholder_media_name(name: str) -> bool:
    return str(name or "").strip().lower().startswith("r2v-reference-")


def _collect_linked_node_ids(nodes: dict[str, Any]) -> set[str]:
    linked: set[str] = set()
    for node in nodes.values():
        for value in (node.get("inputs") or {}).values():
            if isinstance(value, list) and value:
                linked.add(str(value[0]))
    return linked


def _purge_unlinked_r2v_placeholder_loaders(nodes: dict[str, Any]) -> list[str]:
    """Remove unused R2V placeholder LoadImage/Video/Audio nodes after slots are disconnected.

    ComfyUI validates/loads every node present in the prompt payload, so merely
    popping unused ref_* inputs still triggers missing-file warnings for the
    leftover placeholder loaders.
    """
    linked = _collect_linked_node_ids(nodes)
    removed: list[str] = []
    for nid, node in list(nodes.items()):
        if nid in linked:
            continue
        class_type = str(node.get("class_type", "")).lower()
        inputs = node.get("inputs") or {}
        if class_type == "loadimage":
            media_name = str(inputs.get("image") or "")
        elif class_type == "vhs_loadvideo":
            media_name = str(inputs.get("video") or "")
        elif class_type in {"vhs_loadaudioupload", "loadaudio"}:
            media_name = str(inputs.get("audio") or "")
        else:
            continue
        if not _is_r2v_placeholder_media_name(media_name):
            continue
        nodes.pop(nid, None)
        removed.append(f"{nid}:{media_name}")
    return removed


def _load_image_id_from_link(nodes: dict[str, Any], link: Any) -> str | None:
    if not isinstance(link, list) or not link:
        return None
    nid = str(link[0])
    node = nodes.get(nid)
    if not node:
        return None
    class_type = str(node.get("class_type", "")).lower()
    if class_type == "loadimage":
        return nid
    if class_type == "fluxkontextimagescale":
        return _load_image_id_from_link(nodes, (node.get("inputs") or {}).get("image"))
    return None


def _infer_qwen_slot_ids(nodes: dict[str, Any]) -> dict[int, str]:
    """标题没有 Reference Image N 时，按编码器 image1/2/3 或 images.image_N 反查 Load Image。"""
    slot_ids: dict[int, str] = {}
    for node in nodes.values():
        if not _node_has_qwen_image_refs(node):
            continue
        inputs = node.get("inputs") or {}
        for n in range(1, QWEN_EDIT_SLOT_SCAN + 1):
            for key in _qwen_image_input_keys(n):
                load_id = _load_image_id_from_link(nodes, inputs.get(key))
                if load_id and n not in slot_ids:
                    slot_ids[n] = load_id
                    break
    return slot_ids


def _qwen_encoder_max_refs(nodes: dict[str, Any]) -> int:
    for node in nodes.values():
        class_type = str(node.get("class_type", "")).lower()
        if "textencodeqwenimageeditplus_lrzjason" in class_type:
            return 5
        if "textencodeqwenimage21" in class_type:
            inputs = node.get("inputs") or {}
            count = sum(
                1
                for n in range(1, QWEN_EDIT_SLOT_SCAN + 1)
                if any(key in inputs for key in _qwen_image_input_keys(n))
            )
            if count:
                return min(count, QWEN_IMAGE_21_EDIT_MAX_REFS)
            if _node_has_qwen_image_refs(node):
                return QWEN_IMAGE_21_EDIT_MAX_REFS
    return 3 if _is_qwen_edit_workflow(nodes) else QWEN_EDIT_MAX_REFS


def _reference_workflow_capacity(workflow: dict[str, Any]) -> int:
    """Return the number of usable reference-image slots exposed by a workflow."""
    nodes = workflow.get("prompt") or workflow
    if not isinstance(nodes, dict):
        return 0
    if _is_qwen_edit_workflow(nodes):
        return _qwen_encoder_max_refs(nodes)

    titled_slots = 0
    generic_loaders = 0
    for node in nodes.values():
        if str(node.get("class_type", "")).lower() != "loadimage":
            continue
        generic_loaders += 1
        title = str((node.get("_meta") or {}).get("title", "")).lower()
        if re.search(r"reference\s*image\s*\d+", title):
            titled_slots += 1
    return titled_slots or generic_loaders


def _qwen_encoder_image_source(nodes: dict[str, Any], load_id: str) -> str:
    """Image 1 若先经 FluxKontextImageScale，编码器应接缩放输出，不能直连 Load Image。"""
    for scale_id, node in nodes.items():
        if str(node.get("class_type", "")).lower() != "fluxkontextimagescale":
            continue
        image = (node.get("inputs") or {}).get("image")
        if isinstance(image, list) and image and str(image[0]) == str(load_id):
            return str(scale_id)
    return load_id


def _trim_qwen_reference_slots(
    nodes: dict[str, Any],
    used_count: int,
    slot_ids: dict[int, str] | None = None,
) -> None:
    """只把实际用到的 Reference Image 接到编码器，其余断开并删掉，避免 example.png 进模型。"""
    max_refs = _qwen_encoder_max_refs(nodes)
    used = max(0, min(max_refs, int(used_count)))
    drop_titles = {f"reference image {n}" for n in range(used + 1, max(QWEN_EDIT_SLOT_SCAN, max_refs) + 1)}
    for nid in [
        nid
        for nid, node in list(nodes.items())
        if str((node.get("_meta") or {}).get("title", "")).lower() in drop_titles
    ]:
        nodes.pop(nid, None)
    for n in range(used + 1, QWEN_EDIT_SLOT_SCAN + 1):
        extra_id = (slot_ids or {}).get(n)
        if extra_id:
            nodes.pop(extra_id, None)

    for node in nodes.values():
        if not _node_has_qwen_image_refs(node):
            continue
        inputs = node.setdefault("inputs", {})
        class_type = str(node.get("class_type", "")).lower()
        use_dotted = "textencodeqwenimage21" in class_type
        for n in range(1, QWEN_EDIT_SLOT_SCAN + 1):
            nid = (slot_ids or {}).get(n)
            keys = _qwen_image_input_keys(n)
            primary = keys[0] if use_dotted else keys[1]
            for key in keys:
                inputs.pop(key, None)
            if n <= used and nid and nid in nodes:
                inputs[primary] = [_qwen_encoder_image_source(nodes, nid), 0]


def normalize_comfy_base(base_url: str) -> str:
    base = (base_url or "").strip().rstrip("/")
    for suffix in ("/prompt", "/history", "/view", "/upload/image"):
        if base.lower().endswith(suffix):
            base = base[: -len(suffix)]
    return base.rstrip("/")


def resolve_comfy_base(registry: dict[str, Any], model_id: str | None, kind: str) -> str:
    model = _pick_model(registry, model_id, kind)
    provider = _provider_for_model(registry, model)
    # 模型卡片允许为单个 ComfyUI 模型配置独立地址（model.baseUrl）。
    # 旧逻辑只看 endpoint/provider.baseUrl，导致界面保存的 Tailscale 地址
    # 被忽略，Worker 最终总是回退到 provider 的 127.0.0.1:8188。
    endpoint = (
        model.get("baseUrl")
        or model.get("endpoint")
        or provider.get("baseUrl")
        or ""
    ).strip()
    if endpoint.startswith("http"):
        normalized = normalize_comfy_base(endpoint)
        # 旧注册表可能持久化了本机默认值；部署配置明确使用远程 ComfyUI 时，
        # 不要让这个陈旧默认值遮蔽 COMFYUI_BASE_URL。
        deployment_base = normalize_comfy_base(get_settings().comfyui_base_url)
        if normalized in {"http://127.0.0.1:8188", "http://localhost:8188"} and deployment_base not in {
            "",
            "http://127.0.0.1:8188",
            "http://localhost:8188",
        }:
            return deployment_base
        return normalized
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


async def _run_nano_banana_sdk(
    registry: dict[str, Any],
    model: dict[str, Any],
    payload: dict[str, Any],
    *,
    user_id: int | None,
) -> dict[str, str]:
    """Run Nano Banana API-node workflows through Comfy's API v2 SDK.

    Nano Banana is a Comfy partner node. It must be submitted to Comfy Cloud
    with the SDK so the workflow receives both the authenticated job request
    and ``extra_data.api_key_comfy_org`` for the partner node.
    """
    try:
        from comfy_sdk import AsyncComfy
    except ImportError as exc:
        raise AiConfigError("Nano Banana 需要安装 comfy-sdk，请先执行 uv sync") from exc

    params = model.get("params") or {}
    references = _collect_reference_images(payload)
    workflow_name = str(
        params.get("referenceWorkflowName") if references else params.get("workflowName")
    ).strip()
    if not workflow_name:
        raise AiConfigError("Nano Banana 未配置 workflowName")

    aspect_ratio = payload.get("aspectRatio") or "16:9"
    width, height = _aspect_ratio_size(aspect_ratio, video=False)
    workflow = load_workflow_template(workflow_name)
    patched = patch_image_workflow(
        workflow,
        prompt=str(payload.get("prompt") or ""),
        negative_prompt=payload.get("negativePrompt") or payload.get("negative_prompt"),
        width=width,
        height=height,
        seed=int(payload.get("seed") or random.getrandbits(63)),
        steps=int(payload.get("steps") or 1),
        aspect_ratio=str(aspect_ratio),
    )

    api_key = str(
        model.get("apiKey")
        or (_provider_for_model(registry, model).get("apiKey") if model else "")
        or registry.get("globalApiKey")
        or os.getenv("COMFY_API_KEY")
        or ""
    ).strip()
    if not api_key:
        raise AiConfigError("Nano Banana 需要配置 COMFY_API_KEY")

    # AsyncComfy reads COMFY_BASE_URL when constructed. Keep the worker's
    # existing environment intact after constructing this request client.
    base = resolve_comfy_base(registry, model.get("id"), "image")
    previous_base = os.environ.get("COMFY_BASE_URL")
    os.environ["COMFY_BASE_URL"] = base
    temp_paths: list[str] = []
    try:
        async with AsyncComfy(api_key=api_key) as client:
            workflow_client = client.workflows.from_json(patched)
            if references:
                load_nodes = [
                    (str(node_id), node)
                    for node_id, node in patched.items()
                    if str(node.get("class_type", "")).lower() == "loadimage"
                ]
                if not load_nodes:
                    raise AiConfigError("Nano Banana Edit workflow 未找到 LoadImage 节点")
                # The supplied official Edit template currently exposes one
                # image input. Use the first reference and reject silent loss.
                if len(references) > 1:
                    logger.info("Nano Banana Edit 当前 workflow 仅消费 1 张参考图，已忽略其余参考图")
                raw, _ = await _load_media_source(references[0])
                temp = tempfile.NamedTemporaryFile(prefix="nano-banana-ref-", suffix=".png", delete=False)
                temp.write(raw)
                temp.close()
                temp_paths.append(temp.name)
                asset = client.assets.from_file(temp.name)
                workflow_client.set_input(load_nodes[0][0], "image", asset)

            job = await client.run(workflow_client, api_key=api_key)
            outputs = job.get_outputs("9")
            output = outputs[0] if outputs else None
            if output is None:
                raise AiConfigError("Nano Banana workflow 未返回图片输出")
            content = await output.to_bytes()
    except AiConfigError:
        raise
    except Exception as exc:
        logger.warning("Nano Banana SDK generation failed: %s", exc)
        raise AiConfigError(f"Nano Banana 生成失败: {exc}") from exc
    finally:
        for path in temp_paths:
            try:
                os.unlink(path)
            except OSError:
                pass
        if previous_base is None:
            os.environ.pop("COMFY_BASE_URL", None)
        else:
            os.environ["COMFY_BASE_URL"] = previous_base

    stored = _store_generated_media(content, user_id=user_id, suffix=".png", content_type="image/png")
    result: dict[str, str] = {"image_url": stored["url"], "image_data_url": stored["url"]}
    if "media_key" in stored:
        result["media_key"] = stored["media_key"]
    if "base64" in stored:
        result["image_base64"] = stored["base64"]
    return result


def _resize_image_bytes(
    image_bytes: bytes,
    width: int,
    height: int,
    *,
    fit: str = "auto",
) -> bytes:
    try:
        from PIL import Image
    except ImportError:
        return image_bytes

    img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    src_ratio = img.width / max(img.height, 1)
    dst_ratio = width / max(height, 1)
    if fit == "auto":
        # 9:16 定妆灌进 16:9 首帧时，cover 会切掉头脚，身份锁失效
        fit = "contain" if abs(src_ratio - dst_ratio) / dst_ratio > 0.2 else "cover"

    if fit == "contain":
        scale = min(width / img.width, height / img.height)
        new_size = (max(1, int(img.width * scale)), max(1, int(img.height * scale)))
        resized = img.resize(new_size, Image.Resampling.LANCZOS)
        canvas = Image.new("RGB", (width, height), (176, 172, 166))
        canvas.paste(resized, ((width - new_size[0]) // 2, (height - new_size[1]) // 2))
        out = io.BytesIO()
        canvas.save(out, format="PNG")
        return out.getvalue()

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
        # 图片资产与 MiniMax H3 共用 768p 画布，避免首尾帧在送入视频工作流前
        # 从 1024x576 再放大到 1344x768，减少一次无效插值造成的细节损失。
        mapping = {"16:9": (1344, 768), "9:16": (768, 1344), "1:1": (768, 768)}
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
    aspect_ratio: str = "16:9",
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
    slot_ids: dict[int, str] = {}
    for nid, node in nodes.items():
        inputs = node.get("inputs") or {}
        class_type = str(node.get("class_type", "")).lower()
        title = str((node.get("_meta") or {}).get("title", "")).lower()
        if class_type != "loadimage":
            continue
        slot_match = re.search(r"reference\s*image\s*(\d+)", title)
        if slot_match:
            slot = int(slot_match.group(1))
            slot_nodes[slot] = inputs
            slot_ids[slot] = str(nid)

    if _is_qwen_edit_workflow(nodes):
        for slot, nid in _infer_qwen_slot_ids(nodes).items():
            slot_ids.setdefault(slot, nid)
            if slot not in slot_nodes:
                slot_nodes[slot] = (nodes.get(nid) or {}).get("inputs") or {}

    patched_slots: set[int] = set()
    for slot, name in enumerate(ref_names, start=1):
        if slot in slot_nodes and isinstance(slot_nodes[slot].get("image"), str):
            slot_nodes[slot]["image"] = name
            reference_patched = True
            patched_slots.add(slot)

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
            elif "negative_prompt" in inputs and isinstance(inputs["negative_prompt"], str):
                # TextEncodeQwenImage21 等同节点同时带 prompt / negative_prompt
                inputs["negative_prompt"] = negative_prompt

        if class_type == "resolutionselector" and isinstance(inputs.get("aspect_ratio"), str):
            inputs["aspect_ratio"] = _resolution_selector_aspect(aspect_ratio)

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
        if (
            class_type == "primitiveboolean"
            and "4step" in title
            and "lora" in title
            and isinstance(inputs.get("value"), bool)
        ):
            inputs["value"] = steps <= 8
        if denoise is not None and "denoise" in inputs and isinstance(inputs["denoise"], int | float):
            inputs["denoise"] = denoise

        # Qwen Edit FLF / turnaround 等图片工作流通常用一个布尔开关
        # 在完整模型（40 steps）和 Lightning（4 steps）之间切换。
        # 不能依赖 JSON 模板的默认值，否则请求 40 步时可能仍挂着 4-step LoRA。
        if class_type == "primitiveboolean" and any(
            marker in title for marker in ("4step", "4steps", "lightning", "turbo")
        ) and isinstance(inputs.get("value"), bool):
            inputs["value"] = steps <= 8

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

    if _is_qwen_edit_workflow(nodes):
        used = len(patched_slots) if patched_slots else len(ref_names)
        _trim_qwen_reference_slots(nodes, used, slot_ids)
        used_load_ids = {slot_ids[n] for n in patched_slots if n in slot_ids}
        for nid, node in list(nodes.items()):
            if str(node.get("class_type", "")).lower() != "loadimage":
                continue
            if nid in used_load_ids:
                continue
            image_name = str((node.get("inputs") or {}).get("image") or "")
            if _is_placeholder_ref_name(image_name):
                nodes.pop(nid, None)
    elif slot_nodes:
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
    reference_image_names: list[str] | None = None,
    reference_video_names: list[str] | None = None,
    reference_audio_names: list[str] | None = None,
    audio_name: str | None = None,
    enable_stage2_upscaling: bool | None = None,
) -> dict[str, Any]:
    patched = copy.deepcopy(workflow)
    nodes = patched.get("prompt") or patched
    if not isinstance(nodes, dict):
        raise AiConfigError("ComfyUI 视频工作流格式无效")

    uses_primitive = any(
        "prompt" in str(n.get("_meta", {}).get("title", "")).lower()
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

        if "prompt" in title and class_type == "primitivestringmultiline" and isinstance(inputs.get("value"), str):
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
            if isinstance(inputs.get("megapixels"), int | float) and width > 0 and height > 0:
                inputs["megapixels"] = round(width * height / 1_000_000, 2)
        if class_type == "primitiveboolean" and (
            "turbo" in title or "lightning" in title
        ) and isinstance(inputs.get("value"), bool):
            inputs["value"] = steps <= 8
        if (
            class_type == "primitiveboolean"
            and "enable stage 2 second upscaling" in title
            and enable_stage2_upscaling is not None
            and isinstance(inputs.get("value"), bool)
        ):
            previous_value = inputs.get("value")
            inputs["value"] = enable_stage2_upscaling
            logger.info(
                "ComfyUI H3 quality patch title=%r previous=%s enableStage2Upscaling=%s",
                node.get("_meta", {}).get("title") or title,
                previous_value,
                enable_stage2_upscaling,
            )
        if class_type == "primitiveint" and "steps full" in title and isinstance(inputs.get("value"), int | float):
            inputs["value"] = steps if steps > 8 else 20
        if class_type == "primitiveint" and "steps turbo" in title and isinstance(inputs.get("value"), int | float):
            inputs["value"] = steps if steps <= 8 else 8
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
    ref2v_id = None
    last_loader_id = None
    for node_id, node in nodes.items():
        class_type = str(node.get("class_type", "")).lower()
        title = str(node.get("_meta", {}).get("title", "")).lower()
        if class_type == "minimaxh3imagetovideo":
            minimax_id = node_id
        if class_type == "minimaxh3referencetovideo":
            ref2v_id = node_id
        if class_type == "loadimage" and "last" in title:
            last_loader_id = node_id
    if minimax_id:
        minimax_inputs = nodes[minimax_id].setdefault("inputs", {})
        if not last_loader_id:
            existing_last = minimax_inputs.get("last_frame")
            if isinstance(existing_last, list) and existing_last:
                last_loader_id = str(existing_last[0])
        if end_image_name and last_loader_id:
            minimax_inputs["last_frame"] = [last_loader_id, 0]
        else:
            minimax_inputs.pop("last_frame", None)
    if ref2v_id and reference_image_names is not None:
        ref_inputs = nodes[ref2v_id].setdefault("inputs", {})
        ref_slots = sorted(
            (key for key in ref_inputs if key.startswith("ref_images.ref_image_")),
            key=lambda key: int(key.rsplit("_", 1)[-1]),
        )
        if len(reference_image_names) > len(ref_slots):
            raise AiConfigError(
                f"R2V 工作流只声明了 {len(ref_slots)} 个参考图槽位，"
                f"但请求注入了 {len(reference_image_names)} 张；请更新工作流后重试。"
            )
        for index, slot in enumerate(ref_slots):
            link = ref_inputs.get(slot)
            linked_node = nodes.get(str(link[0])) if isinstance(link, list) and link else None
            if index < len(reference_image_names) and linked_node is not None:
                linked_node.setdefault("inputs", {})["image"] = reference_image_names[index]
            else:
                ref_inputs.pop(slot, None)
    if ref2v_id:
        ref_inputs = nodes[ref2v_id].setdefault("inputs", {})
        for prefix, names, field in (
            ("ref_videos.ref_video_", reference_video_names or [], "video"),
            ("ref_audios.ref_audio_", reference_audio_names or [], "audio"),
        ):
            slots = sorted((key for key in ref_inputs if key.startswith(prefix)), key=lambda key: int(key.rsplit("_", 1)[-1]))
            if len(names) > len(slots):
                media_label = "视频" if field == "video" else "音频"
                raise AiConfigError(
                    f"R2V 工作流只声明了 {len(slots)} 个参考{media_label}槽位，"
                    f"但请求注入了 {len(names)} 个；请更新工作流后重试。"
                )
            for index, slot in enumerate(slots):
                link = ref_inputs.get(slot)
                linked_node = nodes.get(str(link[0])) if isinstance(link, list) and link else None
                if index < len(names) and linked_node is not None:
                    linked_node.setdefault("inputs", {})[field] = names[index]
                else:
                    ref_inputs.pop(slot, None)

    removed_placeholders = _purge_unlinked_r2v_placeholder_loaders(nodes)
    if removed_placeholders:
        logger.info(
            "ComfyUI R2V removed %s unused placeholder loader(s): %s",
            len(removed_placeholders),
            ", ".join(removed_placeholders),
        )

    # Stage 2 关闭时，最终保存节点直接收集 Stage 1 已解码的视频和音频。
    # 这样即使某些 ComfySwitch 版本不会惰性跳过未选支路，最终成片也不会丢失。
    if enable_stage2_upscaling is False:
        final_combine = next(
            (
                node for node in nodes.values()
                if str(node.get("class_type", "")).lower() == "vhs_videocombine"
                and (node.get("inputs") or {}).get("save_output") is True
            ),
            None,
        )
        if final_combine:
            final_inputs = final_combine.setdefault("inputs", {})
            final_inputs["images"] = ["42", 0]
            final_inputs["audio"] = ["41", 0]
            logger.info(
                "ComfyUI H3 quality fallback: Stage2 OFF, final save wired to Stage1 outputs "
                "(images<-42, audio<-41)"
            )

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
# ComfyUI 会推 JPEG/未编码预览，默认 1MB 上限会直接掐掉 websocket。
_COMFY_WS_MAX_SIZE = 32 * 1024 * 1024


def _as_progress_int(value: Any) -> int:
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return 0


def _is_expected_sampler_max(maximum: int, expected_steps: int | None) -> bool:
    """Flux / Lightning 的采样条 max 会等于 steps，偶尔差 1。"""
    if not expected_steps or expected_steps < _SAMPLER_PROGRESS_MIN_STEPS:
        return False
    return abs(maximum - expected_steps) <= 1


def _is_plausible_sampler_max(maximum: int, expected_steps: int | None) -> bool:
    """Turbo 实际步数常小于模型配置（例如配置 20、采样条 8）。"""
    if maximum < _SAMPLER_PROGRESS_MIN_STEPS or maximum > 40:
        return False
    if not expected_steps:
        return True
    return maximum <= max(expected_steps, 32)


def _progress_candidate_score(
    maximum: int,
    *,
    expected_steps: int | None,
) -> int:
    """越大越像采样 tqdm。CLIP/加载条的 max 通常远大于 steps。"""
    if maximum < _SAMPLER_PROGRESS_MIN_STEPS:
        return -1
    if _is_expected_sampler_max(maximum, expected_steps):
        return 100
    if _is_plausible_sampler_max(maximum, expected_steps):
        return 80
    if expected_steps and expected_steps >= _SAMPLER_PROGRESS_MIN_STEPS:
        return -1
    if maximum <= 80:
        return 10
    return -1


def _as_step_progress(
    value: int,
    maximum: int,
    *,
    sampling_started: bool,
    locked_max: int | None = None,
    expected_steps: int | None = None,
) -> tuple[int, int, str] | None:
    if _progress_candidate_score(maximum, expected_steps=expected_steps) < 0:
        return None
    if locked_max is not None and maximum != locked_max:
        # 已锁到采样条后忽略 CLIP/加载；尚未锁到采样条时允许切换过来。
        if not _is_plausible_sampler_max(maximum, expected_steps):
            return None
        if _is_plausible_sampler_max(locked_max, expected_steps) and locked_max != maximum:
            return None
    if not sampling_started and not _is_plausible_sampler_max(maximum, expected_steps):
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
    expected_steps: int | None = None,
) -> tuple[int, int, str] | None:
    data = message.get("data") if isinstance(message.get("data"), dict) else {}
    incoming_id = data.get("prompt_id")
    if prompt_id and incoming_id and str(incoming_id) != str(prompt_id):
        return None

    msg_type = message.get("type")
    if msg_type == "progress":
        return _as_step_progress(
            _as_progress_int(data.get("value")),
            _as_progress_int(data.get("max")),
            sampling_started=sampling_started,
            locked_max=locked_max,
            expected_steps=expected_steps,
        )

    if msg_type == "progress_state":
        nodes = data.get("nodes") if isinstance(data.get("nodes"), dict) else {}
        best: tuple[int, int, int] | None = None
        for node in nodes.values():
            if not isinstance(node, dict):
                continue
            state = str(node.get("state") or "").lower()
            if state in {"finished", "pending", "idle", "error"}:
                continue
            value = _as_progress_int(node.get("value"))
            maximum = _as_progress_int(node.get("max"))
            parsed = _as_step_progress(
                value,
                maximum,
                sampling_started=sampling_started,
                locked_max=locked_max,
                expected_steps=expected_steps,
            )
            if not parsed:
                continue
            score = _progress_candidate_score(maximum, expected_steps=expected_steps)
            # 同分时取更靠后的步数：子图里可能同时有一条停在 1/20 的条。
            if best is None or score > best[2] or (score == best[2] and value > best[0]):
                best = (value, maximum, score)
        if not best:
            return None
        return _as_step_progress(
            best[0],
            best[1],
            sampling_started=sampling_started,
            locked_max=locked_max,
            expected_steps=expected_steps,
        )

    return None


def _comfy_ws_text(raw: Any) -> str | None:
    """只解析 JSON 文本；ComfyUI 的二进制预览帧直接丢掉。"""
    if isinstance(raw, str):
        stripped = raw.lstrip()
        return stripped if stripped.startswith("{") or stripped.startswith("[") else None
    if isinstance(raw, (bytes, bytearray)):
        stripped = raw.lstrip()
        if stripped.startswith(b"{") or stripped.startswith(b"["):
            try:
                return stripped.decode("utf-8")
            except UnicodeDecodeError:
                return None
    return None


async def _listen_comfy_progress(
    base: str,
    client_id: str,
    prompt_id: str | None,
    on_progress: Any | None,
    *,
    expected_steps: int | None = None,
    ready: asyncio.Event | None = None,
) -> None:
    if on_progress is None:
        if ready:
            ready.set()
        return
    try:
        import websockets
    except ImportError:
        if ready:
            ready.set()
        return

    sampling_started = False
    locked_max: int | None = None
    last_percent = -1
    ws_url = _comfy_ws_url(base, client_id)
    try:
        while True:
            try:
                async with websockets.connect(
                    ws_url,
                    open_timeout=5,
                    close_timeout=2,
                    max_size=_COMFY_WS_MAX_SIZE,
                    ping_interval=20,
                    ping_timeout=60,
                ) as ws:
                    if ready and not ready.is_set():
                        ready.set()
                    async for raw in ws:
                        text = _comfy_ws_text(raw)
                        if text is None:
                            continue
                        try:
                            message = json.loads(text)
                        except Exception:
                            continue
                        if not isinstance(message, dict):
                            continue
                        try:
                            parsed = _progress_from_comfy_message(
                                message,
                                prompt_id,
                                sampling_started=sampling_started,
                                locked_max=locked_max,
                                expected_steps=expected_steps,
                            )
                        except Exception:
                            continue
                        if not parsed:
                            continue
                        percent, new_max, label = parsed
                        if sampling_started and new_max == locked_max and percent < last_percent:
                            continue
                        locked_max = new_max
                        last_percent = percent
                        sampling_started = True
                        try:
                            on_progress(percent, label)
                        except Exception as exc:
                            if type(exc).__name__ == "JobCancelled":
                                return
                            logger.debug("ComfyUI 进度回调失败", exc_info=True)
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.warning("ComfyUI websocket 进度订阅中断，稍后重连", exc_info=True)
            if ready and not ready.is_set():
                ready.set()
            await asyncio.sleep(1)
    finally:
        if ready and not ready.is_set():
            ready.set()


async def _queue_and_poll(
    client: httpx.AsyncClient,
    base: str,
    prompt: dict[str, Any],
    *,
    max_polls: int,
    poll_interval: float,
    on_progress: Any | None = None,
    expected_steps: int | None = None,
) -> bytes:
    client_id = f"bigbanana-{uuid.uuid4().hex[:12]}"
    prompt_url = f"{base}/prompt"
    if on_progress:
        on_progress(0, "ComfyUI 已入队")

    # httpx 每次请求都会打一条 INFO，2 分钟的任务就刷上百行；轮询期间只保留告警级别
    httpx_logger = logging.getLogger("httpx")
    previous_httpx_level = httpx_logger.level
    httpx_logger.setLevel(logging.WARNING)
    ws_ready = asyncio.Event()
    # 先挂上 websocket 再 POST：progress_state 只发给 client_id，晚连会丢采样条。
    listener = asyncio.create_task(
        _listen_comfy_progress(
            base,
            client_id,
            None,
            on_progress,
            expected_steps=expected_steps,
            ready=ws_ready,
        )
    )
    try:
        await asyncio.wait_for(ws_ready.wait(), timeout=3)
    except TimeoutError:
        logger.debug("ComfyUI websocket 未在 3s 内就绪，继续提交 prompt")

    logger.info("ComfyUI POST %s (nodes=%s)", prompt_url, len(prompt))
    res = await client.post(prompt_url, json={"prompt": prompt, "client_id": client_id}, timeout=60)
    if not res.is_success:
        listener.cancel()
        raise AiConfigError(f"ComfyUI 提交失败 ({prompt_url}): {res.text}")
    prompt_id = res.json().get("prompt_id")
    if not prompt_id:
        listener.cancel()
        raise AiConfigError(f"ComfyUI 未返回 prompt_id ({prompt_url})")
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
    network_error_streak = 0
    for poll_index in range(max_polls):
        await asyncio.sleep(poll_interval)
        poll_url = f"{base}/history/{prompt_id}"
        try:
            history_res = await client.get(poll_url, timeout=30)
            network_error_streak = 0
        except (httpx.TimeoutException, httpx.NetworkError, httpx.RemoteProtocolError) as exc:
            # ComfyUI 任务是由服务端持有的；轮询期间短暂断网不代表任务失败。
            # 保持 Celery 任务存活，下一轮继续查询，避免把可恢复的网络抖动写成 failed。
            network_error_streak += 1
            if network_error_streak == 1 or network_error_streak % COMFYUI_NETWORK_RETRY_LOG_EVERY == 0:
                logger.warning(
                    "ComfyUI history 暂时不可达，继续等待 (%s 次): %s",
                    network_error_streak,
                    exc,
                )
            continue
        if not history_res.is_success:
            if history_res.status_code >= 500:
                network_error_streak += 1
                if network_error_streak == 1 or network_error_streak % COMFYUI_NETWORK_RETRY_LOG_EVERY == 0:
                    logger.warning(
                        "ComfyUI history 暂时返回 %s，继续等待 (%s 次)",
                        history_res.status_code,
                        network_error_streak,
                    )
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
    model = _pick_model(registry, model_id, "image")
    if model.get("id") == "comfyui-nano-banana-2":
        return await _run_nano_banana_sdk(registry, model, payload, user_id=user_id)
    base = resolve_comfy_base(registry, model_id, "image")
    model_params = model.get("params") or {}
    requested_workflow = (payload.get("workflowName") or "").strip()
    default_workflow = model_params.get("workflowName") or DEFAULT_IMAGE_WORKFLOW_NAME
    aspect_ratio = payload.get("aspectRatio") or "16:9"
    width, height = _aspect_ratio_size(aspect_ratio, video=False)

    source, mode = _pick_img2img_source(
        payload.get("continuityReferenceImage"),
        payload.get("characterReferenceImage"),
    )
    reference_sources = _collect_reference_images(payload)
    use_reference = bool(reference_sources) or bool(source)
    reference_workflow = str(model_params.get("referenceWorkflowName") or "").strip()
    use_reference_workflow = bool(
        use_reference
        and reference_workflow
        and (not requested_workflow or requested_workflow == default_workflow)
    )
    workflow_name = reference_workflow if use_reference_workflow else (requested_workflow or default_workflow)
    if use_reference_workflow and model_params.get("referenceSteps") is not None:
        steps = int(model_params["referenceSteps"])
    else:
        steps = int(model_params.get("steps") or payload.get("steps") or 20)
        if payload.get("steps") is not None:
            steps = int(payload["steps"])
    # 角色/参考图定妆默认使用完整 Qwen Edit 路径。旧版前端可能仍会在
    # payload 中带 steps=4；不能让这个请求级值绕过质量优先的模型配置，
    # 否则 UI 显示 40 steps，但实际会启用 Lightning LoRA。
    if use_reference_workflow and steps <= 8:
        steps = max(int(model_params.get("referenceSteps") or 40), 40)
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

    reference_capacity = _reference_workflow_capacity(workflow) if use_reference else 0
    if use_reference and reference_capacity <= 0:
        raise AiConfigError(
            f"工作流 {effective_workflow} 不支持参考图输入。请为当前图片模型配置 referenceWorkflowName，"
            "并选择包含 Reference Image 槽位的编辑工作流。"
        )
    if reference_sources and len(reference_sources) > reference_capacity:
        logger.info(
            "ComfyUI reference images capped workflow=%s capacity=%s requested=%s",
            effective_workflow,
            reference_capacity,
            len(reference_sources),
        )
        reference_sources = reference_sources[:reference_capacity]

    reference_name = None
    reference_names: list[str] = []
    upload_url = f"{base}/upload/image"
    prompt_url = f"{base}/prompt"
    logger.info(
        "ComfyUI image start model_id=%s workflow=%s effective=%s route=%s "
        "comfy_base=%s upload=%s prompt=%s size=%sx%s steps=%s seed=%s has_ref=%s ref_count=%s",
        model_id,
        workflow_name,
        effective_workflow,
        "reference-workflow" if use_reference_workflow else "requested-or-text-workflow",
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
                    # 比例差大时 contain，避免 9:16 定妆被 16:9 首帧裁掉头
                    raw = _resize_image_bytes(raw, width, height, fit="auto")
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
                    aspect_ratio=str(aspect_ratio),
                )
                content = await _queue_and_poll(
                    client,
                    base,
                    prompt_nodes,
                    max_polls=COMFYUI_MAX_POLLS_IMAGE,
                    poll_interval=COMFYUI_POLL_INTERVAL_SEC,
                    on_progress=on_progress,
                    expected_steps=steps,
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
    workflow_name = (
        (payload.get("workflowName") or params.get("workflowName") or "").strip()
        or DEFAULT_VIDEO_WORKFLOW_NAME
    )
    # 内置 R2V 始终使用受支持的 Ref2VA 多参考图模板，避免被旧的持久化
    # 配置或客户端请求覆盖到 FLF2V/旧 R2V 工作流。
    if model_id == "comfyui-minimax-h3-r2v" or model.get("id") == "comfyui-minimax-h3-r2v":
        workflow_name = MINIMAX_H3_R2V_WORKFLOW_NAME
    steps = int(params.get("steps") or payload.get("steps") or 20)
    if payload.get("steps") is not None:
        steps = int(payload["steps"])
    is_h3_ref2va = model_id == "comfyui-minimax-h3-r2v" or model.get("id") == "comfyui-minimax-h3-r2v"
    # 高质量工作流的采样计划固定为 Stage 1=8 + Stage 2=4；质量开关只控制
    # 是否启用二次上采样，不能把 4/20 当作工作流采样步数写回。
    if is_h3_ref2va:
        steps = 12
    raw_enable_stage2 = payload.get("enableStage2Upscaling")
    enable_stage2_upscaling = raw_enable_stage2
    if is_h3_ref2va and enable_stage2_upscaling is None:
        enable_stage2_upscaling = True
    h3_quality_mode = (
        "high"
        if enable_stage2_upscaling is True
        else "preview"
        if enable_stage2_upscaling is False
        else "unset"
    )
    aspect_ratio = payload.get("aspectRatio") or params.get("defaultAspectRatio") or "16:9"
    duration = float(payload.get("duration") or params.get("defaultDuration") or 5)
    is_minimax = "minimax" in f"{workflow_name} {model_id or ''} {model.get('id') or ''} {model.get('apiModel') or ''}".lower()
    normalized_workflow_context = f"{workflow_name} {model_id or ''} {model.get('id') or ''} {model.get('apiModel') or ''}".lower()
    is_ref2v = (
        "r2v" in normalized_workflow_context
        or "ref2va" in normalized_workflow_context
        or params.get("supportsReferenceImages") is True
    )
    width, height = _aspect_ratio_size(aspect_ratio, video=True, minimax=is_minimax)
    seed = random.randint(0, 2**31 - 1)

    start_image = payload.get("startImage")
    if not start_image and not is_ref2v:
        raise AiConfigError("ComfyUI 图生视频需要首帧图片")
    if is_ref2v and not (payload.get("referenceImages") or []):
        raise AiConfigError("MiniMax H3 Ref2VA 至少需要一张角色、场景或道具参考图")

    workflow = load_workflow_template(workflow_name)
    logger.info(
        "ComfyUI video start model_id=%s workflow=%s comfy_base=%s "
        "upload=%s/upload/image prompt=%s/prompt size=%sx%s "
        "duration=%s steps=%s quality_mode=%s enableStage2Upscaling=%s "
        "(payload_raw=%s)",
        model_id,
        workflow_name,
        base,
        base,
        base,
        width,
        height,
        duration,
        steps,
        h3_quality_mode,
        enable_stage2_upscaling,
        raw_enable_stage2,
    )
    async with _comfyui_gpu_lock():
        async with httpx.AsyncClient(trust_env=False, timeout=7200) as client:
            start_name = None
            if start_image:
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
            reference_names: list[str] = []
            reference_values = payload.get("referenceImages") or []
            if isinstance(reference_values, list):
                for index, reference in enumerate(reference_values[: int(params.get("maxReferenceImages") or 9)]):
                    raw, mime = await _load_media_source(reference)
                    if is_minimax:
                        raw = _resize_image_bytes(raw, width, height)
                        mime = "image/png"
                    reference_names.append(await _upload_file(
                        client, base, "/upload/image", "image", f"ref-{seed}-{index + 1}.png", raw, mime
                    ))
            reference_video_names: list[str] = []
            for index, reference in enumerate((payload.get("referenceVideos") or [])[:1]):
                raw, mime = await _load_media_source(reference)
                reference_video_names.append(await _upload_file(
                    client, base, "/upload/image", "image", f"ref-video-{seed}-{index + 1}.mp4", raw, mime
                ))
            reference_audio_names: list[str] = []
            for index, reference in enumerate((payload.get("referenceAudios") or [])[:1]):
                reference_audio_names.append(await _upload_audio(
                    client, base, reference, f"ref-audio-{seed}-{index + 1}.wav"
                ))
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
                reference_image_names=reference_names,
                reference_video_names=reference_video_names,
                reference_audio_names=reference_audio_names,
                audio_name=audio_name,
                enable_stage2_upscaling=enable_stage2_upscaling,
            )
            content = await _queue_and_poll(
                client,
                base,
                prompt_nodes,
                max_polls=COMFYUI_MAX_POLLS_VIDEO,
                poll_interval=2.0,
                on_progress=on_progress,
                expected_steps=steps,
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
