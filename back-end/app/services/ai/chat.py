import json
import re
from typing import Any

import httpx

from app.core.config import get_settings


class AiConfigError(Exception):
    pass


def _resolve_chat_endpoint(base_url: str, endpoint: str | None) -> tuple[str, str]:
    url = (base_url or "").rstrip("/")
    if not url:
        raise AiConfigError("API Base URL 未配置，请在模型设置中填写")
    path = endpoint or ("/chat/completions" if url.endswith("/v1") else "/v1/chat/completions")
    if not path.startswith("/"):
        path = f"/{path}"
    return url, path


def _clean_json_response(text: str) -> str:
    cleaned = (text or "").strip()
    fenced = re.search(r"```(?:json)?\s*([\s\S]*?)```", cleaned, re.I)
    if fenced:
        return fenced.group(1).strip()
    cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned, flags=re.I)
    cleaned = re.sub(r"```\s*$", "", cleaned)
    return cleaned.strip()


def _pick_model(registry: dict[str, Any], model_id: str | None, kind: str) -> dict[str, Any]:
    models = registry.get("models") or []
    if model_id:
        found = next((m for m in models if m.get("id") == model_id), None)
        if found:
            return found
    active_models = registry.get("activeModels") or {}
    active_id = active_models.get(kind)
    if active_id:
        found = next((m for m in models if m.get("id") == active_id), None)
        if found:
            return found
    fallback = next((m for m in models if m.get("type") == kind), None)
    if fallback:
        return fallback
    raise AiConfigError(f"没有可用的 {kind} 模型，请先在设置中配置")


def _provider_for_model(registry: dict[str, Any], model: dict[str, Any]) -> dict[str, Any]:
    provider_id = model.get("providerId")
    providers = registry.get("providers") or []
    provider = next((p for p in providers if p.get("id") == provider_id), None)
    if not provider:
        raise AiConfigError(f"找不到模型提供商: {provider_id}")
    return provider


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
    raise AiConfigError("API Key 缺失，请在设置中配置或在服务端设置 DEFAULT_API_KEY")


async def chat_completion(
    registry: dict[str, Any],
    *,
    prompt: str,
    system_prompt: str | None = None,
    model_id: str | None = None,
    response_format: str | None = None,
    timeout: int = 600,
) -> str:
    model = _pick_model(registry, model_id, "chat")
    provider = _provider_for_model(registry, model)
    api_key = _api_key_for_model(registry, model, provider)

    base_url, endpoint = _resolve_chat_endpoint(provider.get("baseUrl", ""), model.get("endpoint"))
    api_model = model.get("apiModel") or model.get("id")
    params = model.get("params") or {}

    messages: list[dict[str, str]] = []
    if system_prompt:
        messages.append({"role": "system", "content": system_prompt})
    messages.append({"role": "user", "content": prompt})

    body: dict[str, Any] = {
        "model": api_model,
        "messages": messages,
        "temperature": params.get("temperature", 0.7),
    }
    if params.get("maxTokens") is not None:
        body["max_tokens"] = params["maxTokens"]
    if response_format == "json":
        body["response_format"] = {"type": "json_object"}

    url = f"{base_url}{endpoint}"
    async with httpx.AsyncClient(timeout=timeout) as client:
        res = await client.post(
            url,
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json=body,
        )
        if not res.is_success:
            detail = res.text
            try:
                detail = res.json().get("error", {}).get("message", detail)
            except Exception:
                pass
            raise AiConfigError(f"Chat API 错误: {detail}")

        data = res.json()
        content = data.get("choices", [{}])[0].get("message", {}).get("content", "")
        if response_format == "json":
            return _clean_json_response(content)
        return content


async def generate_image_openai_compatible(
    registry: dict[str, Any],
    *,
    prompt: str,
    model_id: str | None = None,
    aspect_ratio: str = "16:9",
) -> str:
    model = _pick_model(registry, model_id, "image")
    provider = _provider_for_model(registry, model)
    api_key = _api_key_for_model(registry, model, provider)

    size_map = {"16:9": "1792x1024", "9:16": "1024x1792", "1:1": "1024x1024"}
    size = size_map.get(aspect_ratio, "1024x1024")
    base_url = (provider.get("baseUrl") or "").rstrip("/")
    if not base_url:
        raise AiConfigError("API Base URL 未配置，请在模型设置中填写")
    endpoint = model.get("endpoint") or "/v1/images/generations"
    if not endpoint.startswith("/"):
        endpoint = f"/{endpoint}"
    api_model = model.get("apiModel") or model.get("id")

    body = {
        "model": api_model,
        "prompt": prompt,
        "size": size,
        "response_format": "b64_json",
        "n": 1,
    }

    url = f"{base_url}{endpoint}"
    async with httpx.AsyncClient(timeout=300) as client:
        res = await client.post(
            url,
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json=body,
        )
        if not res.is_success:
            raise AiConfigError(f"Image API 错误: {res.text}")
        data = res.json()
        item = data.get("data", [{}])[0]
        b64 = item.get("b64_json")
        if not b64:
            raise AiConfigError("Image API 未返回 b64_json")
        return b64
