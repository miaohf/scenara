import json
import re
import base64
import mimetypes
from typing import Any

import httpx

from app.core.config import LOCAL_PROVIDER_IDS, get_settings
from app.services.storage import (
    MediaStoreError,
    media_content_type,
    parse_media_url,
    read_media_bytes,
)


class AiConfigError(Exception):
    pass


def format_http_api_error(
    status_code: int,
    body: str | bytes | None,
    *,
    api_label: str = "Image API",
) -> str:
    """把上游 HTTP 错误整理成可读文案；响应体若是 JSON 则缩进格式化。"""
    raw = body.decode("utf-8", errors="replace") if isinstance(body, bytes) else str(body or "")
    raw = raw.strip()

    pretty_body = raw
    message = ""
    if raw:
        try:
            parsed = json.loads(raw)
            pretty_body = json.dumps(parsed, ensure_ascii=False, indent=2)
            err = parsed.get("error") if isinstance(parsed, dict) else None
            if isinstance(err, dict):
                message = str(err.get("message") or err.get("localized_message") or "").strip()
            elif isinstance(err, str):
                message = err.strip()
            elif isinstance(parsed, dict):
                message = str(parsed.get("message") or parsed.get("detail") or "").strip()
        except Exception:
            pretty_body = raw

    lines = [f"{api_label} 错误 ({status_code}):"]
    if message:
        lines.append(message)
    if pretty_body:
        lines.append(pretty_body)
    else:
        lines.append("(无响应正文)")
    return "\n".join(lines)


async def _load_reference_image(value: str) -> tuple[bytes, str]:
    """解析参考图：媒体签名 URL、http(s)、data URL、裸 base64。

    资产落盘后剧集里存的是 /api/v1/media/raw/...，不能再只认 data:。
    """
    text = (value or "").strip()
    if not text:
        raise AiConfigError("参考图为空，请重新上传后重试")

    media_key = parse_media_url(text)
    if media_key:
        try:
            return read_media_bytes(media_key), media_content_type(media_key)
        except MediaStoreError as exc:
            raise AiConfigError(f"参考图读取失败，请重新生成或上传后重试") from exc

    if text.startswith(("http://", "https://")):
        async with httpx.AsyncClient(trust_env=False, timeout=120) as client:
            res = await client.get(text)
        if not res.is_success:
            raise AiConfigError(f"参考图下载失败 (HTTP {res.status_code})")
        mime = res.headers.get("content-type") or "image/png"
        return res.content, mime.split(";")[0].strip() or "image/png"

    match = re.match(r"^data:([^;]+);base64,(.+)$", text, re.S)
    if match:
        try:
            return base64.b64decode(match.group(2), validate=True), match.group(1)
        except ValueError as exc:
            raise AiConfigError("参考图数据无效，请重新上传后重试") from exc

    if re.match(r"^[A-Za-z0-9+/=\s]+$", text) and len(text) > 64:
        try:
            return base64.b64decode(text, validate=True), "image/png"
        except ValueError as exc:
            raise AiConfigError("参考图数据无效，请重新上传后重试") from exc

    raise AiConfigError("参考图格式无效，请使用已生成的资产图或重新上传后重试")


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


def _is_volcengine_seedream_image(
    model: dict[str, Any],
    provider: dict[str, Any],
    endpoint: str,
) -> bool:
    if (provider.get("id") or "") == "volcengine":
        return True
    if "/api/v3/images" in (endpoint or "").lower():
        return True
    identity = f"{model.get('id') or ''} {model.get('apiModel') or ''} {model.get('name') or ''}".lower()
    return "seedream" in identity


def _seedream_size_for_aspect(aspect_ratio: str, resolution: str) -> str:
    """Seedream size：精确像素选项原样使用；档位按画幅映射。"""
    raw = (resolution or "2K").strip()
    exact = re.match(r"^(\d+)\s*[xX×]\s*(\d+)$", raw)
    ratio = aspect_ratio or "16:9"
    if exact:
        width, height = int(exact.group(1)), int(exact.group(2))
        if ratio == "9:16":
            return f"{height}x{width}"
        if ratio == "1:1":
            side = min(width, height)
            return f"{side}x{side}"
        return f"{width}x{height}"

    tier = raw.upper()
    if tier == "4K":
        return {"9:16": "2304x4096", "1:1": "4096x4096", "16:9": "4096x2304"}.get(ratio, "4096x2304")
    if tier == "1K":
        return {"9:16": "1024x1792", "1:1": "1024x1024", "16:9": "1792x1024"}.get(ratio, "1792x1024")
    return {"9:16": "1440x2560", "1:1": "2048x2048", "16:9": "2560x1440"}.get(ratio, "2560x1440")


def _openai_image_size_for_aspect(aspect_ratio: str, resolution: str) -> str:
    """gpt-image / OpenAI Images size：精确像素原样；档位对齐 API易预设。"""
    raw = (resolution or "1344x768").strip()
    exact = re.match(r"^(\d+)\s*[xX×]\s*(\d+)$", raw)
    ratio = aspect_ratio or "16:9"
    if exact:
        width, height = int(exact.group(1)), int(exact.group(2))
        if ratio == "9:16":
            return f"{height}x{width}"
        if ratio == "1:1":
            side = min(width, height)
            return f"{side}x{side}"
        return f"{width}x{height}"

    tier = raw.upper()
    if tier == "4K":
        return {"9:16": "2160x3840", "1:1": "2048x2048", "16:9": "3840x2160"}.get(ratio, "3840x2160")
    if tier == "2K":
        return {"9:16": "1152x2048", "1:1": "2048x2048", "16:9": "2048x1152"}.get(ratio, "2048x1152")
    return {"9:16": "768x1344", "1:1": "1024x1024", "16:9": "1344x768"}.get(ratio, "1344x768")


def _openai_image_param_profile(model: dict[str, Any]) -> str:
    """official | per_request_all | per_request_vip"""
    identity = f"{model.get('id') or ''} {model.get('apiModel') or ''}".lower()
    if "-all" in identity:
        return "per_request_all"
    if "-vip" in identity or identity.endswith("vip"):
        return "per_request_vip"
    return "official"


def _apiyi_vip_size_for_aspect(aspect_ratio: str, resolution: str) -> str:
    """API易 *-vip 30 档常用 size。"""
    raw = (resolution or "2K").strip()
    exact = re.match(r"^(\d+)\s*[xX×]\s*(\d+)$", raw)
    ratio = aspect_ratio or "16:9"
    if exact:
        width, height = int(exact.group(1)), int(exact.group(2))
        if (width, height) in {(1344, 768), (768, 1344)}:
            return "1024x1536" if ratio == "9:16" else "1536x1024"
        if ratio == "9:16":
            return f"{height}x{width}"
        if ratio == "1:1":
            side = min(width, height)
            return f"{side}x{side}"
        return f"{width}x{height}"

    tier = raw.upper()
    if tier == "4K":
        return {"9:16": "2160x3840", "1:1": "2048x2048", "16:9": "3840x2160"}.get(ratio, "3840x2160")
    if tier == "1K":
        return {"9:16": "1024x1536", "1:1": "1024x1024", "16:9": "1536x1024"}.get(ratio, "1536x1024")
    return {"9:16": "1152x2048", "1:1": "2048x2048", "16:9": "2048x1152"}.get(ratio, "2048x1152")


def _prepend_aspect_hint_for_all(prompt: str, aspect_ratio: str, resolution: str) -> str:
    trimmed = (prompt or "").strip()
    tier = (resolution or "1K").strip().upper()
    size_label = "4K" if tier == "4K" else "2K" if tier == "2K" else "1K"
    if "X" in tier or "×" in tier:
        size_label = tier.lower()
    ratio = aspect_ratio or "16:9"
    if ratio == "9:16":
        hint = f"竖版 9:16 {size_label}"
    elif ratio == "1:1":
        hint = f"方形 1:1 {size_label}"
    else:
        hint = f"横版 16:9 {size_label}"
    if not trimmed:
        return f"{hint} 电影画幅"
    if re.search(r"横版|竖版|方形|16:9|9:16|1:1|\d+\s*[xX×]\s*\d+", trimmed):
        return trimmed
    return f"{hint} 电影画幅，{trimmed}"


async def _reference_as_data_uri(value: str) -> str:
    text = (value or "").strip()
    if text.startswith("data:") and ";base64," in text:
        return text
    content, mime = await _load_reference_image(text)
    if not mime.startswith("image/"):
        mime = "image/png"
    return f"data:{mime};base64,{base64.b64encode(content).decode('ascii')}"


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
    if (model.get("params") or {}).get("apiFormat") in {"cursor-sdk", "cursor-acp"}:
        from app.services.ai.cursor_acp import generate_image_cursor_acp

        return await generate_image_cursor_acp(
            prompt=f"{prompt}\nCanvas aspect ratio: {aspect_ratio}.",
            reference_images=reference_images,
            reference_annotations=reference_annotations,
            api_key=str(model.get("apiKey") or provider.get("apiKey") or "") or None,
        )
    api_key = _api_key_for_model(registry, model, provider)

    # gpt-image 支持自定义 WIDTHxHEIGHT（须整除 16）。按模型 outputResolution
    # 映射到 API易 / OpenAI 兼容尺寸；1344x768 与 MiniMax H3 画布对齐。
    resolution_raw = str((model.get("params") or {}).get("outputResolution") or "1344x768").strip()
    gemini_image_size = resolution_raw.upper() if resolution_raw.upper() in {"1K", "2K", "4K"} else "1K"
    param_profile = _openai_image_param_profile(model)
    size = (
        _apiyi_vip_size_for_aspect(aspect_ratio, resolution_raw)
        if param_profile == "per_request_vip"
        else _openai_image_size_for_aspect(aspect_ratio, resolution_raw)
    )
    request_prompt = (
        _prepend_aspect_hint_for_all(prompt, aspect_ratio, resolution_raw)
        if param_profile == "per_request_all"
        else prompt
    )
    # 模型级地址优先；否则用户在模型卡片里改的 Base URL 会被旧逻辑忽略。
    base_url = (model.get("baseUrl") or provider.get("baseUrl") or "").rstrip("/")
    if not base_url:
        raise AiConfigError("API Base URL 未配置，请在模型设置中填写")
    references = [item for item in (reference_images or []) if item]
    annotations = [str(item or "").strip() for item in (reference_annotations or [])]
    configured_endpoint = model.get("endpoint") or "/v1/images/generations"
    endpoint = configured_endpoint
    is_seedream = _is_volcengine_seedream_image(model, provider, endpoint)
    # Seedream 参考图仍走 generations + JSON image，不要切到 OpenAI edits。
    if references and (not is_seedream) and endpoint.rstrip("/").endswith("/images/generations"):
        endpoint = endpoint.rstrip("/")[: -len("generations")] + "edits"
    if not endpoint.startswith("/"):
        endpoint = f"/{endpoint}"
    api_model = model.get("apiModel") or model.get("id")

    url = f"{base_url}{endpoint}"
    # high + 2K/4K 在 API易上可能需数分钟
    async with httpx.AsyncClient(timeout=600, trust_env=False) as client:
        # Gemini 原生 generateContent（New API 可透传该协议）。这条分支必须
        # 在 OpenAI images/generations 之前处理，否则会把 contents 当成 prompt。
        if "generatecontent" in endpoint.lower():
            parts: list[dict[str, Any]] = [{"text": prompt}]
            for index, image in enumerate(references):
                content, mime = await _load_reference_image(image)
                label = annotations[index] if index < len(annotations) else f"Reference image {index + 1}"
                parts.append({"text": f"{label}. Use this image only for the described identity/reference."})
                parts.append({
                    "inlineData": {
                        "mimeType": mime if mime.startswith("image/") else "image/png",
                        "data": base64.b64encode(content).decode("ascii"),
                    }
                })
            native_body = {
                "contents": [{"role": "user", "parts": parts}],
                "generationConfig": {
                    "responseModalities": ["TEXT", "IMAGE"],
                    "imageConfig": {"aspectRatio": aspect_ratio, "imageSize": gemini_image_size},
                },
            }
            res = await client.post(
                url,
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                json=native_body,
            )
            if not res.is_success:
                raise AiConfigError(
                    format_http_api_error(res.status_code, res.text[:2000], api_label="Gemini Image API")
                )
            data = res.json()
            for candidate in data.get("candidates", []):
                for part in candidate.get("content", {}).get("parts", []):
                    inline = part.get("inlineData") or part.get("inline_data")
                    if inline and inline.get("data"):
                        return str(inline["data"])
            raise AiConfigError("Gemini Image API 未返回图片数据")

        if is_seedream:
            body: dict[str, Any] = {
                "model": api_model,
                "prompt": prompt,
                "size": _seedream_size_for_aspect(aspect_ratio, resolution_raw or "2K"),
                "response_format": "b64_json",
                "watermark": False,
            }
            # 组图仅 Seedream 4.x / 5.0 Lite 支持；5.0 Pro 传了会 400。
            api_model_l = str(api_model or "").lower()
            if "seedream" in api_model_l and "pro" not in api_model_l:
                body["sequential_image_generation"] = "disabled"
            if references:
                data_uris = [await _reference_as_data_uri(item) for item in references]
                body["image"] = data_uris[0] if len(data_uris) == 1 else data_uris
            res = await client.post(
                url,
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                json=body,
            )
            if not res.is_success:
                raise AiConfigError(
                    format_http_api_error(res.status_code, res.text[:2000], api_label="Seedream Image API")
                )
            data = res.json()
            item = (data.get("data") or [{}])[0] or {}
            b64 = item.get("b64_json")
            if b64:
                return str(b64)
            image_url = item.get("url")
            if image_url:
                fetched = await client.get(str(image_url))
                if not fetched.is_success:
                    raise AiConfigError(f"Seedream 返回了 URL，但下载失败 ({fetched.status_code})")
                return base64.b64encode(fetched.content).decode("ascii")
            raise AiConfigError("Seedream Image API 未返回 b64_json 或 url")

        # 与前端 imageAdapter OpenAI 分支对齐。
        # - official：quality/output_format（勿带 DALL·E response_format，部分网关会 500）
        # - *-all 按次：只传 model/prompt/response_format
        # - *-vip 按次：可传 size（+ quality），勿传 n
        common: dict[str, Any] = {
            "model": api_model,
            "prompt": request_prompt,
            "response_format": "b64_json",
        }
        if param_profile == "official":
            common.update(
                {
                    "size": size,
                    "quality": "medium",
                    "output_format": "png",
                    "output_compression": 100,
                    "n": 1,
                }
            )
            # 官转 gpt-image 不需要 response_format（部分网关会 500）
            common.pop("response_format", None)
        elif param_profile == "per_request_vip":
            common.update({"size": size, "quality": "medium"})
        if references:
            files: list[tuple[str, tuple[str, bytes, str]]] = []
            for index, image in enumerate(references):
                content, mime = await _load_reference_image(image)
                if not mime.startswith("image/"):
                    mime = "image/png"
                extension = mimetypes.guess_extension(mime) or ".png"
                files.append(("image[]", (f"reference-{index + 1}{extension}", content, mime)))
            # multipart 表单字段需全部为字符串
            form_data = {key: str(value) for key, value in common.items()}
            res = await client.post(
                url,
                headers={"Authorization": f"Bearer {api_key}"},
                data=form_data,
                files=files,
            )
        else:
            res = await client.post(
                url,
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                json=common,
            )
        if not res.is_success:
            raise AiConfigError(format_http_api_error(res.status_code, res.text[:2000], api_label="Image API"))
        data = res.json()
        item = (data.get("data") or [{}])[0] or {}
        b64 = item.get("b64_json")
        if b64:
            text = str(b64)
            if text.startswith("data:") and ";base64," in text:
                text = text.split(",", 1)[1]
            return text
        image_url = item.get("url")
        if image_url:
            fetched = await client.get(str(image_url))
            if not fetched.is_success:
                raise AiConfigError(f"Image API 返回了 URL，但下载失败 ({fetched.status_code})")
            return base64.b64encode(fetched.content).decode("ascii")
        raise AiConfigError("Image API 未返回 b64_json 或 url")
