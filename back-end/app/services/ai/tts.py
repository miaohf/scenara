"""OpenAI-compatible TTS (/v1/audio/speech), e.g. IndexTTS."""

from __future__ import annotations

from typing import Any

import httpx

from app.core.config import LOCAL_PROVIDER_IDS, get_settings
from app.services.ai.chat import AiConfigError, _pick_model, _provider_for_model


def _api_key_for_model(registry: dict[str, Any], model: dict[str, Any], provider: dict[str, Any]) -> str:
    settings = get_settings()
    per_model = (model.get("apiKey") or "").strip()
    if per_model:
        return per_model
    per_provider = (provider.get("apiKey") or "").strip()
    if per_provider:
        return per_provider
    global_key = (registry.get("globalApiKey") or settings.default_api_key or "").strip()
    if global_key:
        return global_key
    provider_id = provider.get("id") or ""
    if provider_id in LOCAL_PROVIDER_IDS:
        return "local"
    raise AiConfigError("API Key 缺失，请在设置中配置 TTS 提供商密钥")


def _resolve_speech_endpoint(base_url: str, endpoint: str | None) -> tuple[str, str]:
    url = (base_url or "").rstrip("/")
    if not url:
        raise AiConfigError("TTS API Base URL 未配置")
    path = endpoint or "/v1/audio/speech"
    if not path.startswith("/"):
        path = f"/{path}"
    return url, path


def _mime_for_format(fmt: str) -> str:
    if fmt == "mp3":
        return "audio/mpeg"
    if fmt == "opus":
        return "audio/opus"
    return "audio/wav"


async def generate_speech(
    registry: dict[str, Any],
    *,
    text: str,
    model_id: str | None = None,
    voice: str | None = None,
    response_format: str = "opus",
    timeout: int = 120,
) -> dict[str, str]:
    model = _pick_model(registry, model_id, "audio")
    provider = _provider_for_model(registry, model)
    api_key = _api_key_for_model(registry, model, provider)

    base_url, endpoint = _resolve_speech_endpoint(provider.get("baseUrl", ""), model.get("endpoint"))
    api_model = model.get("apiModel") or model.get("id")
    params = model.get("params") or {}
    used_voice = (voice or params.get("defaultVoice") or "alloy").strip()
    used_format = (response_format or params.get("outputFormat") or "wav").strip()

    body = {
        "model": api_model,
        "voice": used_voice,
        "input": text,
        "response_format": used_format,
    }

    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    url = f"{base_url}{endpoint}"
    async with httpx.AsyncClient(timeout=timeout, trust_env=False) as client:
        res = await client.post(url, headers=headers, json=body)
        if not res.is_success:
            detail = res.text
            try:
                detail = res.json().get("error", {}).get("message", detail)
            except Exception:
                pass
            raise AiConfigError(f"TTS API 错误: {detail}")

        content_type = res.headers.get("content-type", "")
        mime = _mime_for_format(used_format)
        if "application/json" in content_type:
            payload = res.json()
            import base64

            b64 = payload.get("audio") or payload.get("data") or ""
            if not b64:
                raise AiConfigError("TTS API 未返回音频数据")
            return {
                "audio_base64": b64,
                "audio_data_url": f"data:{mime};base64,{b64}",
                "mime_type": mime,
            }

        import base64

        raw = res.content
        b64 = base64.b64encode(raw).decode("ascii")
        return {
            "audio_base64": b64,
            "audio_data_url": f"data:{mime};base64,{b64}",
            "mime_type": mime,
        }
