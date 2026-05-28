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
from pathlib import Path
from typing import Any
from urllib.parse import urlencode

import httpx

from app.services.ai.chat import AiConfigError, _pick_model, _provider_for_model

BACKEND_ROOT = Path(__file__).resolve().parents[3]
WORKFLOW_DIRS = [
    BACKEND_ROOT / "workflows",
]

COMFYUI_POLL_INTERVAL_SEC = 1.0
COMFYUI_MAX_POLLS_IMAGE = 180
COMFYUI_MAX_POLLS_VIDEO = 600
IMG2IMG_DENOISE_CONTINUITY = 0.65
IMG2IMG_DENOISE_CHARACTER = 0.78


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
    raise AiConfigError(f"ComfyUI 工作流模板未找到: {workflow_name}")


def _decode_data_url(data_url: str) -> tuple[bytes, str]:
    match = re.match(r"^data:([a-zA-Z0-9.+/-]+);base64,(.+)$", data_url.strip())
    if not match:
        if re.match(r"^[A-Za-z0-9+/=]+$", data_url.strip()):
            return base64.b64decode(data_url), "image/png"
        raise AiConfigError("无效的图片 data URL")
    return base64.b64decode(match.group(2)), match.group(1)


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


def _aspect_ratio_size(aspect_ratio: str, *, video: bool = False) -> tuple[int, int]:
    if video:
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
    width: int,
    height: int,
    seed: int,
    steps: int,
    reference_image_name: str | None = None,
    denoise: float | None = None,
) -> dict[str, Any]:
    patched = copy.deepcopy(workflow)
    nodes = patched.get("prompt") or patched
    if not isinstance(nodes, dict):
        raise AiConfigError("ComfyUI 工作流格式无效")

    prompt_patched = False
    reference_patched = False
    for node in nodes.values():
        inputs = node.get("inputs") or {}
        class_type = str(node.get("class_type", "")).lower()
        title = str((node.get("_meta") or {}).get("title", "")).lower()

        if "text" in inputs and isinstance(inputs["text"], str) and "clip" in class_type:
            inputs["text"] = prompt
            prompt_patched = True
        if "prompt" in inputs and isinstance(inputs["prompt"], str):
            inputs["prompt"] = prompt
            prompt_patched = True
        if "positive" in inputs and isinstance(inputs["positive"], str):
            inputs["positive"] = prompt
            prompt_patched = True
        if "width" in inputs and isinstance(inputs["width"], int | float):
            inputs["width"] = width
        if "height" in inputs and isinstance(inputs["height"], int | float):
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
            reference_image_name
            and class_type == "loadimage"
            and "image" in inputs
            and isinstance(inputs["image"], str)
            and ("reference" in title or "load image" in title or not reference_patched)
        ):
            inputs["image"] = reference_image_name
            reference_patched = True

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
        if str(node.get("_meta", {}).get("title", "")).lower() == "frame rate":
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
        if title == "duration" and class_type == "primitivefloat" and isinstance(inputs.get("value"), int | float):
            inputs["value"] = duration
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
            if "first" in title or title == "load image":
                inputs["image"] = start_image_name
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
    raw, mime = _decode_data_url(data_url)
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
    res = await client.post(f"{base}/prompt", json={"prompt": prompt, "client_id": client_id}, timeout=60)
    if not res.is_success:
        raise AiConfigError(f"ComfyUI 提交失败: {res.text}")
    prompt_id = res.json().get("prompt_id")
    if not prompt_id:
        raise AiConfigError("ComfyUI 未返回 prompt_id")

    for i in range(max_polls):
        if on_progress:
            on_progress(min(10 + int(i / max_polls * 85), 95), f"ComfyUI 生成中 ({i + 1}/{max_polls})")
        await asyncio.sleep(poll_interval)
        history_res = await client.get(f"{base}/history/{prompt_id}", timeout=30)
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
                view_res = await client.get(view_url, timeout=120)
                if view_res.is_success:
                    return view_res.content
        # check failed status
        status = record.get("status", {})
        if status.get("status_str") == "error":
            raise AiConfigError(str(status.get("messages") or "ComfyUI 执行失败"))

    raise AiConfigError("ComfyUI 生成超时")


async def run_comfy_image(
    registry: dict[str, Any],
    payload: dict[str, Any],
    on_progress: Any | None = None,
) -> dict[str, str]:
    model_id = payload.get("modelId")
    base = resolve_comfy_base(registry, model_id, "image")
    model = _pick_model(registry, model_id, "image")
    workflow_name = (model.get("params") or {}).get("workflowName") or model.get("apiModel") or model.get("id")
    steps = int((model.get("params") or {}).get("steps") or payload.get("steps") or 20)
    aspect_ratio = payload.get("aspectRatio") or "16:9"
    width, height = _aspect_ratio_size(aspect_ratio, video=False)

    source, mode = _pick_img2img_source(
        payload.get("continuityReferenceImage"),
        payload.get("characterReferenceImage"),
    )
    use_img2img = bool(source)
    effective_workflow = _resolve_img2img_workflow_name(workflow_name) if use_img2img else workflow_name
    denoise = _resolve_denoise(mode, payload.get("img2imgDenoise")) if use_img2img else None
    seed = int(payload.get("seed") or random.randint(0, 2**31 - 1))

    try:
        workflow = load_workflow_template(effective_workflow)
    except AiConfigError:
        if use_img2img:
            workflow = load_workflow_template(workflow_name)
            source = None
            denoise = None
        else:
            raise

    reference_name = None
    async with httpx.AsyncClient() as client:
        if source:
            raw, _ = _decode_data_url(source)
            raw = _resize_image_bytes(raw, width, height)
            b64 = base64.b64encode(raw).decode("ascii")
            reference_name = await _upload_image(client, base, f"data:image/png;base64,{b64}", f"ref-{seed}.png")

        prompt_nodes = patch_image_workflow(
            workflow,
            prompt=payload.get("prompt", ""),
            width=width,
            height=height,
            seed=seed,
            steps=steps,
            reference_image_name=reference_name,
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

    b64_out = base64.b64encode(content).decode("ascii")
    mime = "image/png"
    return {"image_data_url": f"data:{mime};base64,{b64_out}", "image_base64": b64_out}


async def run_comfy_video(
    registry: dict[str, Any],
    payload: dict[str, Any],
    on_progress: Any | None = None,
) -> dict[str, str]:
    model_id = payload.get("modelId")
    base = resolve_comfy_base(registry, model_id, "video")
    model = _pick_model(registry, model_id, "video")
    params = model.get("params") or {}
    workflow_name = params.get("workflowName") or model.get("apiModel") or model.get("id")
    steps = int(params.get("steps") or 20)
    aspect_ratio = payload.get("aspectRatio") or params.get("defaultAspectRatio") or "16:9"
    duration = float(payload.get("duration") or params.get("defaultDuration") or 5)
    width, height = _aspect_ratio_size(aspect_ratio, video=True)
    seed = random.randint(0, 2**31 - 1)

    start_image = payload.get("startImage")
    if not start_image:
        raise AiConfigError("ComfyUI 图生视频需要首帧图片")

    workflow = load_workflow_template(workflow_name)
    async with httpx.AsyncClient(timeout=300) as client:
        start_name = await _upload_image(client, base, start_image, f"start-{seed}.png")
        end_name = None
        if payload.get("endImage"):
            end_name = await _upload_image(client, base, payload["endImage"], f"end-{seed}.png")
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

    b64_out = base64.b64encode(content).decode("ascii")
    return {"video_data_url": f"data:video/mp4;base64,{b64_out}", "video_base64": b64_out}
