import json
import re
from typing import Any

import httpx

from app.core.config import LOCAL_PROVIDER_IDS, get_settings


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


def _resolve_api_base_url(model: dict[str, Any], provider: dict[str, Any]) -> str:
    """模型级 baseUrl 优先于提供商（与前端 modelRegistry 一致）。"""
    provider_id = provider.get("id") or ""
    if provider_id == "comfyui-local":
        raise AiConfigError(
            "ComfyUI 提供商仅用于图片/视频工作流，不能作为 LLM 对话端点。"
            "请在分镜脚本处选择 vLLM 对话模型，或在模型配置中切换激活的对话模型。"
        )
    model_base = (model.get("baseUrl") or "").strip().rstrip("/")
    if model_base:
        return model_base
    provider_base = (provider.get("baseUrl") or "").strip().rstrip("/")
    if provider_base:
        return provider_base
    raise AiConfigError("API Base URL 未配置，请在模型设置中填写")


def _api_key_for_model(registry: dict[str, Any], model: dict[str, Any], provider: dict[str, Any]) -> str:
    """解析 API Key：模型级 > 提供商级 > 全局 Key > .env；忽略占位符 VLLM_API_KEY。"""
    settings = get_settings()
    placeholder = "VLLM_API_KEY"

    def _usable(key: str) -> str:
        value = (key or "").strip()
        return "" if value == placeholder else value

    per_model = _usable(model.get("apiKey") or "")
    if per_model:
        return per_model

    per_provider = _usable(provider.get("apiKey") or "")
    if per_provider:
        return per_provider

    global_key = _usable(registry.get("globalApiKey") or "") or _usable(settings.default_api_key or "")
    if global_key:
        return global_key

    # 部署层兜底：仅当 .env 显式配置了非占位符密钥时使用
    provider_id = provider.get("id") or ""
    if provider_id == "vllm-local":
        env_key = _usable(settings.vllm_api_key or "")
        if env_key:
            return env_key

    if provider_id in LOCAL_PROVIDER_IDS:
        return "local"
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

    base_url = _resolve_api_base_url(model, provider)
    _, endpoint = _resolve_chat_endpoint(base_url, model.get("endpoint"))
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
    try:
        # trust_env=False：避免本机 HTTP(S)_PROXY 劫持内网 vLLM 请求
        async with httpx.AsyncClient(timeout=timeout, trust_env=False) as client:
            res = await client.post(
                url,
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                json=body,
            )
    except httpx.HTTPError as exc:
        raise AiConfigError(f"无法连接 LLM 服务 ({base_url}): {exc}") from exc

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
    async with httpx.AsyncClient(timeout=300, trust_env=False) as client:
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
