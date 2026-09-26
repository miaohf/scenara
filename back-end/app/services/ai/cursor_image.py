"""Cursor SDK image generation adapter.

The Cursor Python SDK drives Cursor Agent's native image-generation capability.
It is intentionally isolated from the HTTP image adapters: the SDK is a local
agent runtime, not an OpenAI-compatible image endpoint.
"""

from __future__ import annotations

import asyncio
import base64
import re
import tempfile
from dataclasses import asdict, is_dataclass
from pathlib import Path
from typing import Any

from app.core.config import get_settings
from app.services.ai.chat import AiConfigError, _load_reference_image


def _as_payload(value: Any) -> Any:
    if is_dataclass(value):
        return asdict(value)
    if isinstance(value, dict):
        return value
    if hasattr(value, "__dict__"):
        return vars(value)
    return value


def _extract_image_data(value: Any) -> bytes | None:
    """Read imageData returned by cursor/generate_image when no file was written."""
    value = _as_payload(value)
    if isinstance(value, dict):
        for key in ("imageData", "image_data"):
            raw = value.get(key)
            if isinstance(raw, str) and raw:
                encoded = raw.split(",", 1)[1] if raw.startswith("data:image/") and "," in raw else raw
                try:
                    return base64.b64decode(encoded, validate=True)
                except (ValueError, TypeError):
                    pass
        for child in value.values():
            image = _extract_image_data(child)
            if image:
                return image
    elif isinstance(value, (list, tuple)):
        for child in value:
            image = _extract_image_data(child)
            if image:
                return image
    return None


def _find_generated_image(workdir: Path, expected: Path, result: Any, events: list[Any]) -> Path | None:
    candidates: list[Path] = []
    if expected.is_file():
        candidates.append(expected)

    # Some SDK/agent versions report the generated path in the terminal result
    # instead of honoring the requested path.
    rendered = repr([result, *events])
    for raw in re.findall(r"(?:[A-Za-z]:)?[/\\][^\s'\"]+\.(?:png|jpe?g|webp)", rendered, re.I):
        path = Path(raw.rstrip(".,;:)]}"))
        if path.is_file():
            candidates.append(path)

    for path in workdir.rglob("*"):
        if (
            path.is_file()
            and not path.name.startswith("reference-")
            and path.suffix.lower() in {".png", ".jpg", ".jpeg", ".webp"}
        ):
            candidates.append(path)

    seen: set[Path] = set()
    unique: list[Path] = []
    for item in candidates:
        if item not in seen:
            seen.add(item)
            unique.append(item)
    if not unique:
        return None
    return max(unique, key=lambda item: item.stat().st_mtime_ns)


def _run_error_detail(result: Any, events: list[Any]) -> str:
    status = str(getattr(result, "status", "") or "unknown")
    detail = str(getattr(result, "result", "") or "").strip()
    if not detail:
        # The terminal `done` event normally has result=None. Prefer an
        # earlier error/tool event so quota and unsupported-tool errors are not
        # hidden behind the final marker.
        useful = [
            event
            for event in events
            if "done=" not in repr(event).lower() and "result=None" not in repr(event)
        ]
        detail = repr(useful[-1] if useful else (events[-1] if events else result))
    usage = getattr(result, "usage", None)
    usage_text = f"；usage={usage}" if usage is not None else ""
    return f"status={status}{usage_text}: {detail}"


def _friendly_cursor_error(detail: str) -> str:
    if re.search(r"quota|credit|usage.?limit|rate.?limit|token.?limit|insufficient", detail, re.I):
        return f"Cursor SDK 配额或额度不足：{detail}"
    return f"Cursor SDK 生图调用失败：{detail}"


def _run_cursor_agent(
    *,
    workdir: Path,
    output_path: Path,
    prompt: str,
    model: str,
    api_key: str,
    reference_paths: list[Path],
) -> bytes:
    try:
        from cursor_sdk import Agent, LocalAgentOptions
    except ImportError as exc:  # pragma: no cover - exercised in deployment
        raise AiConfigError("未安装 cursor-sdk，请先在后端环境执行 uv sync") from exc

    references = ""
    if reference_paths:
        references = "\n参考图文件（请用于一致性控制）：\n" + "\n".join(
            f"- {path}" for path in reference_paths
        )
    instruction = f"""Use Cursor's native image generation capability to generate exactly one image.
Prompt: {prompt}
Aspect ratio: preserve {prompt!r} as the visual intent; the requested canvas is supplied by the caller.
Save the final generated image as PNG at this exact path: {output_path}
Do not only describe an image in text. Do not create multiple variants.{references}
"""
    try:
        options: dict[str, Any] = {
            "model": model,
            "local": LocalAgentOptions(cwd=str(workdir)),
        }
        if api_key:
            options["api_key"] = api_key
        with Agent.create(**options) as agent:
            run = agent.send(instruction)
            result = run.wait()
            # Read the completed transcript after wait(). The last event is
            # often only `done(result=None)`; the actual tool/API error is in
            # an earlier event or SDK message.
            events = list(run.events())
            try:
                transcript = run.text()
                if transcript:
                    events.append(transcript)
            except Exception:
                pass
            try:
                events.extend(list(run.messages()))
            except Exception:
                pass
            try:
                # wait() consumes the live event stream. The durable
                # conversation is the remaining source for tool/model errors.
                events.extend(run.conversation())
            except Exception:
                pass
    except Exception as exc:  # SDK exposes several runtime-specific error types
        raise AiConfigError(_friendly_cursor_error(str(exc))) from exc

    image_data = _extract_image_data([result, *events])
    if image_data:
        return image_data

    if str(getattr(result, "status", "") or "").lower() in {"error", "cancelled", "expired"}:
        raise AiConfigError(_friendly_cursor_error(_run_error_detail(result, events)))

    generated = _find_generated_image(workdir, output_path, result, events)
    if generated is None:
        if str(getattr(result, "status", "") or "").lower() == "error" and not getattr(result, "result", ""):
            raise AiConfigError(
                "Cursor Python SDK 返回空的 Run error，当前 cursor-sdk 不能直接接收 "
                "Cursor ACP 的 cursor/generate_image 生图扩展通知；这不是可确认的额度错误。"
                "如需 Cursor 原生生图，请改用 ACP 客户端适配，或配置 OpenAI/ComfyUI 图片模型。"
            )
        raise AiConfigError(
            "Cursor SDK 已完成调用，但没有找到生成图片；"
            f"{_run_error_detail(result, events)}。请确认当前 Cursor Agent/SDK 支持原生生图，"
            "并允许写入本地工作目录。"
        )
    try:
        return generated.read_bytes()
    except OSError as exc:
        raise AiConfigError(f"读取 Cursor SDK 生成图片失败: {exc}") from exc


async def generate_image_cursor_sdk(
    *,
    prompt: str,
    aspect_ratio: str = "16:9",
    reference_images: list[str] | None = None,
    model: str | None = None,
    api_key: str | None = None,
) -> str:
    """Generate an image through cursor_sdk and return base64 PNG data."""
    settings = get_settings()
    selected_model = (model or settings.cursor_sdk_model or "composer-2.5").strip()
    selected_key = (api_key or settings.cursor_api_key or "").strip()
    references = [item for item in (reference_images or []) if item]

    with tempfile.TemporaryDirectory(prefix="scenara-cursor-image-") as temp_dir:
        workdir = Path(temp_dir)
        output_path = workdir / "generated.png"
        reference_paths: list[Path] = []
        for index, value in enumerate(references):
            content, mime = await _load_reference_image(value)
            suffix = ".jpg" if "jpeg" in mime else ".webp" if "webp" in mime else ".png"
            path = workdir / f"reference-{index + 1}{suffix}"
            path.write_bytes(content)
            reference_paths.append(path)

        # Agent SDK is synchronous by default; keep the FastAPI event loop free.
        image_bytes = await asyncio.to_thread(
            _run_cursor_agent,
            workdir=workdir,
            output_path=output_path,
            prompt=f"{prompt}\nCanvas aspect ratio: {aspect_ratio}.",
            model=selected_model,
            api_key=selected_key,
            reference_paths=reference_paths,
        )
    if not image_bytes:
        raise AiConfigError("Cursor SDK 返回了空图片")
    return base64.b64encode(image_bytes).decode("ascii")
