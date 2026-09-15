import json
import re
import base64
import mimetypes
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
    image_urls: list[str] | None = None,
    model_id: str | None = None,
    response_format: str | None = None,
    timeout: int = 600,
) -> str:
    normalized_image_urls = [url for url in (image_urls or []) if url]
    if len(normalized_image_urls) > 8:
        raise AiConfigError("视觉审核单次最多支持 8 张图片")
    if sum(len(url) for url in normalized_image_urls) > 20_000_000:
        raise AiConfigError("视觉审核图片总数据过大，请压缩后重试")

    model = _pick_model(registry, model_id, "chat")
    provider = _provider_for_model(registry, model)
    api_key = _api_key_for_model(registry, model, provider)

    base_url = _resolve_api_base_url(model, provider)
    _, endpoint = _resolve_chat_endpoint(base_url, model.get("endpoint"))
    api_model = model.get("apiModel") or model.get("id")
    params = model.get("params") or {}

    messages: list[dict[str, Any]] = []
    if system_prompt:
        messages.append({"role": "system", "content": system_prompt})
    if normalized_image_urls:
        content: list[dict[str, Any]] = [{"type": "text", "text": prompt}]
        content.extend(
            {"type": "image_url", "image_url": {"url": image_url}}
            for image_url in normalized_image_urls
        )
        messages.append({"role": "user", "content": content})
    else:
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
    content_value = data.get("choices", [{}])[0].get("message", {}).get("content", "")
    if isinstance(content_value, list):
        content = "\n".join(
            str(item.get("text") or item.get("content") or "")
            for item in content_value
            if isinstance(item, dict)
        ).strip()
    else:
        content = str(content_value or "")
    if response_format == "json":
        return _clean_json_response(content)
    return content


async def generate_image_openai_compatible(
    registry: dict[str, Any],
    *,
    prompt: str,
    model_id: str | None = None,
    aspect_ratio: str = "16:9",
    reference_images: list[str] | None = None,
    reference_annotations: list[str] | None = None,
) -> str:
    model = _pick_model(registry, model_id, "image")
    provider = _provider_for_model(registry, model)
    api_key = _api_key_for_model(registry, model, provider)

    resolution = str((model.get("params") or {}).get("outputResolution") or "1K").upper()
    size_maps = {
        "1K": {"16:9": "1536x1024", "9:16": "1024x1536", "1:1": "1024x1024"},
        "2K": {"16:9": "2048x1152", "9:16": "1152x2048", "1:1": "2048x2048"},
        "4K": {"16:9": "4096x2304", "9:16": "2304x4096", "1:1": "4096x4096"},
    }
    size_map = size_maps.get(resolution, size_maps["1K"])
    size = size_map.get(aspect_ratio, "1024x1024")
    # 模型级地址优先；否则用户在模型卡片里改的 Base URL 会被旧逻辑忽略。
    base_url = (model.get("baseUrl") or provider.get("baseUrl") or "").rstrip("/")
    if not base_url:
        raise AiConfigError("API Base URL 未配置，请在模型设置中填写")
    references = [item for item in (reference_images or []) if item]
    annotations = [str(item or "").strip() for item in (reference_annotations or [])]
    configured_endpoint = model.get("endpoint") or "/v1/images/generations"
    endpoint = configured_endpoint
    if references and endpoint.rstrip("/").endswith("/images/generations"):
        endpoint = endpoint.rstrip("/")[:-len("generations")] + "edits"
    if not endpoint.startswith("/"):
        endpoint = f"/{endpoint}"
    api_model = model.get("apiModel") or model.get("id")

    url = f"{base_url}{endpoint}"
    async with httpx.AsyncClient(timeout=300, trust_env=False) as client:
        # Gemini 原生 generateContent（New API 可透传该协议）。这条分支必须
        # 在 OpenAI images/generations 之前处理，否则会把 contents 当成 prompt。
        if "generatecontent" in endpoint.lower():
            parts: list[dict[str, Any]] = [{"text": prompt}]
            for index, image in enumerate(references):
                match = re.match(r"^data:([^;]+);base64,(.+)$", image, re.S)
                if not match:
                    raise AiConfigError("Gemini 参考图必须是 data URL，请重新上传后重试")
                label = annotations[index] if index < len(annotations) else f"Reference image {index + 1}"
                parts.append({"text": f"{label}. Use this image only for the described identity/reference."})
                parts.append({"inlineData": {"mimeType": match.group(1), "data": match.group(2)}})
            native_body = {
                "contents": [{"role": "user", "parts": parts}],
                "generationConfig": {
                    "responseModalities": ["TEXT", "IMAGE"],
                    "imageConfig": {"aspectRatio": aspect_ratio, "imageSize": resolution},
                },
            }
            res = await client.post(
                url,
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                json=native_body,
            )
            if not res.is_success:
                raise AiConfigError(f"Gemini Image API 错误: {res.text}")
            data = res.json()
            for candidate in data.get("candidates", []):
                for part in candidate.get("content", {}).get("parts", []):
                    inline = part.get("inlineData") or part.get("inline_data")
                    if inline and inline.get("data"):
                        return str(inline["data"])
            raise AiConfigError("Gemini Image API 未返回图片数据")

        common = {"model": api_model, "prompt": prompt, "size": size, "n": "1"}
        if references:
            files: list[tuple[str, tuple[str, bytes, str]]] = []
            for index, image in enumerate(references):
                match = re.match(r"^data:([^;]+);base64,(.+)$", image, re.S)
                if not match:
                    raise AiConfigError("参考图必须是可上传的 data URL，请重新上传后重试")
                mime = match.group(1)
                try:
                    content = base64.b64decode(match.group(2), validate=True)
                except ValueError as exc:
                    raise AiConfigError("参考图数据无效，请重新上传后重试") from exc
                extension = mimetypes.guess_extension(mime) or ".png"
                files.append(("image[]", (f"reference-{index + 1}{extension}", content, mime)))
            res = await client.post(
                url,
                headers={"Authorization": f"Bearer {api_key}"},
                data=common,
                files=files,
            )
        else:
            res = await client.post(
                url,
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                json={**common, "response_format": "b64_json"},
            )
        if not res.is_success:
            raise AiConfigError(f"Image API 错误: {res.text}")
        data = res.json()
        item = data.get("data", [{}])[0]
        b64 = item.get("b64_json")
        if not b64:
            raise AiConfigError("Image API 未返回 b64_json")
        return b64
