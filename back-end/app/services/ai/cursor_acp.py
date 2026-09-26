"""Minimal Cursor ACP client for image generation.

ACP is a JSON-RPC 2.0 line protocol exposed by Cursor's ``agent acp`` CLI.
The image result is delivered as the ``cursor/generate_image`` notification,
not as a regular SDK Run result.
"""

from __future__ import annotations

import base64
import json
import os
import selectors
import shlex
import shutil
import subprocess
import time
from pathlib import Path
from typing import Any

from app.core.config import get_settings
from app.services.ai.chat import AiConfigError


def _decode_image_data(value: Any) -> bytes | None:
    if not isinstance(value, str) or not value:
        return None
    encoded = value.split(",", 1)[1] if value.startswith("data:image/") and "," in value else value
    try:
        return base64.b64decode(encoded, validate=True)
    except (ValueError, TypeError):
        return None


def _image_from_notification(params: dict[str, Any], cwd: Path) -> bytes | None:
    outcome = params.get("outcome") if isinstance(params.get("outcome"), dict) else params
    if not isinstance(outcome, dict):
        return None
    image = _decode_image_data(outcome.get("imageData") or outcome.get("image_data"))
    if image:
        return image
    file_path = outcome.get("filePath") or outcome.get("file_path")
    if not file_path:
        return None
    path = Path(str(file_path))
    if not path.is_absolute():
        path = cwd / path
    try:
        return path.read_bytes() if path.is_file() else None
    except OSError:
        return None


class _AcpSession:
    def __init__(self, command: str, cwd: Path, api_key: str, timeout: int) -> None:
        self.cwd = cwd
        self.timeout = max(30, timeout)
        self.next_id = 1
        self.proc = self._start(command, cwd, api_key)
        self.selector = selectors.DefaultSelector()
        assert self.proc.stdout is not None
        self.selector.register(self.proc.stdout, selectors.EVENT_READ)
        self.notifications: list[dict[str, Any]] = []
        self.updates: list[dict[str, Any]] = []
        self.assistant_text = ""

    @staticmethod
    def _start(command: str, cwd: Path, api_key: str) -> subprocess.Popen[str]:
        argv = shlex.split(command or "agent")
        if not argv:
            argv = ["agent"]
        if not Path(argv[0]).is_absolute() and shutil.which(argv[0]) is None:
            user_agent = Path.home() / ".local" / "bin" / argv[0]
            if user_agent.is_file() and user_agent.stat().st_mode & 0o111:
                argv[0] = str(user_agent)
        if argv[-1] != "acp":
            argv.append("acp")
        env = os.environ.copy()
        if api_key:
            env["CURSOR_API_KEY"] = api_key
        try:
            return subprocess.Popen(
                argv,
                cwd=str(cwd),
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                bufsize=1,
                env=env,
            )
        except FileNotFoundError as exc:
            raise AiConfigError(
                f"找不到 Cursor ACP 命令 `{argv[0]}`。请安装 Cursor Agent CLI，"
                "或设置 CURSOR_ACP_COMMAND 指向 `agent` 可执行文件。"
            ) from exc
        except OSError as exc:
            raise AiConfigError(f"启动 Cursor ACP 失败: {exc}") from exc

    def send(self, method: str, params: dict[str, Any]) -> dict[str, Any]:
        if self.proc.stdin is None:
            raise AiConfigError("Cursor ACP stdin 不可用")
        request_id = self.next_id
        self.next_id += 1
        self.proc.stdin.write(json.dumps({"jsonrpc": "2.0", "id": request_id, "method": method, "params": params}) + "\n")
        self.proc.stdin.flush()
        return self._read_response(request_id)

    def _read_response(self, request_id: int) -> dict[str, Any]:
        deadline = time.monotonic() + self.timeout
        while time.monotonic() < deadline:
            remaining = max(0.1, deadline - time.monotonic())
            ready = self.selector.select(remaining)
            if not ready:
                continue
            line = ready[0][0].fileobj.readline()
            if not line:
                stderr = self.proc.stderr.read() if self.proc.stderr else ""
                raise AiConfigError(f"Cursor ACP 进程提前退出: {stderr.strip() or '无错误输出'}")
            try:
                message = json.loads(line)
            except json.JSONDecodeError:
                continue
            if message.get("method"):
                self._handle_notification(message)
            if message.get("id") == request_id:
                if message.get("error"):
                    error = message["error"]
                    raise AiConfigError(f"Cursor ACP {error.get('code', 'error')}: {error.get('message', error)}")
                return message.get("result") or {}
        raise AiConfigError(f"Cursor ACP 等待 `{request_id}` 超时（{self.timeout}s）")

    def drain(self, duration: float = 2.0) -> None:
        """Read late notifications emitted just after the prompt response."""
        deadline = time.monotonic() + max(0.0, duration)
        while time.monotonic() < deadline:
            ready = self.selector.select(max(0.0, deadline - time.monotonic()))
            if not ready:
                return
            line = ready[0][0].fileobj.readline()
            if not line:
                return
            try:
                message = json.loads(line)
            except json.JSONDecodeError:
                continue
            if message.get("method"):
                self._handle_notification(message)

    def _handle_notification(self, message: dict[str, Any]) -> None:
        method = message.get("method")
        params = message.get("params") or {}
        if method == "cursor/generate_image":
            self.notifications.append(message)
            return
        if method == "session/request_permission" and message.get("id") is not None:
            if self.proc.stdin is not None:
                self.proc.stdin.write(json.dumps({
                    "jsonrpc": "2.0",
                    "id": message["id"],
                    "result": {"outcome": {"outcome": "selected", "optionId": "allow-once"}},
                }) + "\n")
                self.proc.stdin.flush()
        elif method == "session/update":
            update = params.get("update") if isinstance(params, dict) else None
            if isinstance(update, dict):
                self.updates.append(update)
                if update.get("sessionUpdate") == "agent_message_chunk":
                    content = update.get("content")
                    if isinstance(content, dict) and isinstance(content.get("text"), str):
                        self.assistant_text += content["text"]
            if isinstance(update, dict) and update.get("sessionUpdate") == "cursor/generate_image":
                self.notifications.append({"method": "cursor/generate_image", "params": update})

    def close(self) -> None:
        try:
            self.selector.close()
            if self.proc.stdin:
                self.proc.stdin.close()
            self.proc.terminate()
            self.proc.wait(timeout=3)
        except (OSError, subprocess.TimeoutExpired):
            self.proc.kill()


def _run_acp_image(
    *,
    cwd: Path,
    prompt: str,
    reference_paths: list[Path],
    reference_annotations: list[str],
    api_key: str,
) -> bytes:
    settings = get_settings()
    session = _AcpSession(settings.cursor_acp_command, cwd, api_key, settings.cursor_acp_timeout)
    try:
        session.send("initialize", {
            "protocolVersion": 1,
            "clientCapabilities": {"fs": {"readTextFile": False, "writeTextFile": False}, "terminal": False},
            "clientInfo": {"name": "scenara", "version": "0.1.0"},
        })
        session.send("authenticate", {"methodId": "cursor_login"})
        created = session.send("session/new", {"cwd": str(cwd), "mcpServers": []})
        session_id = created.get("sessionId")
        if not session_id:
            raise AiConfigError(f"Cursor ACP session/new 未返回 sessionId: {created}")
        reference_mapping = "\n".join(
            f"- Image {index + 1}: {path}"
            + (f" — {reference_annotations[index]}" if index < len(reference_annotations) and reference_annotations[index] else "")
            for index, path in enumerate(reference_paths)
        )
        prompt_result = session.send("session/prompt", {
            "sessionId": session_id,
            "prompt": [{"type": "text", "text": (
                "Generate the requested image now using Cursor's native image generation tool. "
                "This is an image-generation task, not a coding or explanation task. "
                "Do not merely describe the image and do not answer with text. "
                f"Use {cwd / 'generated.png'} as the output file path. Prompt: {prompt}. "
                "Reference images are authoritative and must remain paired with their numbered roles. "
                "When a reference is a named prop, reproduce its exact shape, material, color, proportions, and defining details; never substitute or redesign it. "
                f"Reference image mapping:\n{reference_mapping}"
            )}],
        })
        session.drain()
        for notification in session.notifications:
            image = _image_from_notification(notification.get("params") or {}, cwd)
            if image:
                return image
        output = cwd / "generated.png"
        if output.is_file():
            return output.read_bytes()
        update_shapes = [
            {
                "kind": update.get("sessionUpdate"),
                "keys": sorted(str(key) for key in update.keys()),
            }
            for update in session.updates[-8:]
        ]
        stop_reason = prompt_result.get("stopReason") if isinstance(prompt_result, dict) else None
        assistant_text = " ".join(session.assistant_text.split())[:500]
        raise AiConfigError(
            "Cursor ACP 完成会话但未收到 cursor/generate_image 图片通知；"
            f"stopReason={stop_reason!r}, updates={update_shapes!r}, "
            f"agentMessage={assistant_text!r}。"
            "请确认 Cursor Agent CLI 版本支持生图，并且已登录。"
        )
    finally:
        session.close()


async def generate_image_cursor_acp(
    *,
    prompt: str,
    reference_images: list[str] | None = None,
    reference_annotations: list[str] | None = None,
    api_key: str | None = None,
) -> str:
    """Run Cursor ACP in a worker thread and return base64 PNG data."""
    import asyncio
    import tempfile

    from app.services.ai.chat import _load_reference_image

    selected_key = (api_key or get_settings().cursor_api_key or "").strip()
    with tempfile.TemporaryDirectory(prefix="scenara-cursor-acp-") as temp_dir:
        cwd = Path(temp_dir)
        reference_paths: list[Path] = []
        for index, value in enumerate(item for item in (reference_images or []) if item):
            content, mime = await _load_reference_image(value)
            suffix = ".jpg" if "jpeg" in mime else ".webp" if "webp" in mime else ".png"
            path = cwd / f"reference-{index + 1}{suffix}"
            path.write_bytes(content)
            reference_paths.append(path)
        image_bytes = await asyncio.to_thread(
            _run_acp_image,
            cwd=cwd,
            prompt=prompt,
            reference_paths=reference_paths,
            reference_annotations=[str(item or '').strip() for item in (reference_annotations or [])],
            api_key=selected_key,
        )
    return base64.b64encode(image_bytes).decode("ascii")
