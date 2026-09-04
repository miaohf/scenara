"""服务端模型注册表：默认配置来自环境变量，持久化在 user_settings.model_registry。"""

from __future__ import annotations

import copy
from typing import Any

from app.core.config import Settings, get_settings

LOCAL_PROVIDER_ENV_KEYS = (
    "vllm-local",
    "indextts-local",
    "comfyui-local",
)

# ComfyUI 仅用于 image/video workflow，不能作为 LLM 端点
INVALID_CHAT_PROVIDER_IDS = frozenset({"comfyui-local"})
DEPRECATED_PROVIDER_IDS = frozenset({"ollama-local"})


def build_default_registry(settings: Settings | None = None) -> dict[str, Any]:
    """从环境变量构建默认 model_registry（新用户注册或空配置时使用）。"""
    cfg = settings or get_settings()

    providers: list[dict[str, Any]] = [
        {
            "id": "default",
            "name": "OpenAI 兼容 API",
            "baseUrl": "",
            "isBuiltIn": True,
            "isDefault": True,
        },
        {
            "id": "vllm-local",
            "name": "vLLM (本地 OpenAI API)",
            "baseUrl": cfg.vllm_base_url.rstrip("/"),
            "apiKey": cfg.vllm_api_key,
            "isBuiltIn": True,
            "isDefault": False,
        },
        {
            "id": "indextts-local",
            "name": "IndexTTS (本地 Speech API)",
            "baseUrl": cfg.indextts_base_url.rstrip("/"),
            "apiKey": cfg.indextts_api_key,
            "isBuiltIn": True,
            "isDefault": False,
        },
        {
            "id": "comfyui-local",
            "name": "ComfyUI (本地)",
            "baseUrl": cfg.comfyui_base_url.rstrip("/"),
            "isBuiltIn": True,
            "isDefault": False,
        },
        {
            "id": "volcengine",
            "name": "Volcengine Ark",
            "baseUrl": "https://ark.cn-beijing.volces.com",
            "isBuiltIn": True,
            "isDefault": False,
        },
    ]

    models: list[dict[str, Any]] = [
        {
            "id": "qwen3-8-27b-fp8-vllm",
            "apiModel": cfg.vllm_model_id,
            "name": "Qwen3.8-27B-FP8 (vLLM 本地)",
            "type": "chat",
            "providerId": "vllm-local",
            "description": "vLLM OpenAI 兼容接口，配置由服务端 .env 管理",
            "isBuiltIn": True,
            "isEnabled": True,
            "params": {"temperature": 0.7, "maxTokens": cfg.vllm_max_tokens},
        },
        {
            "id": "comfyui-flux-dev-fp8",
            "apiModel": "qwen-image-2512",
            "name": "ComfyUI Qwen Image 2512 (本地)",
            "type": "image",
            "providerId": "comfyui-local",
            "description": "默认定妆：Qwen-Image-2512 全量步数（默认关 Lightning）；造型九宫格走 Qwen Edit",
            "isBuiltIn": True,
            "isEnabled": True,
            "params": {
                "defaultAspectRatio": "16:9",
                "supportedAspectRatios": ["16:9", "9:16", "1:1"],
                "apiFormat": "comfyui",
                "workflowName": "image_qwen_Image_2512",
                "steps": 50,
                "turnaroundWorkflowName": "qwen_image_edit_2511_fp8_character_turnaround",
                "turnaroundSteps": 4,
            },
        },
        {
            "id": "comfyui-flux-dev-fp8-legacy",
            "apiModel": "flux1-dev-fp8",
            "name": "ComfyUI Flux Dev1 FP8 (本地·备用)",
            "type": "image",
            "providerId": "comfyui-local",
            "description": "Flux1-Dev FP8 文生图；英文短提示更稳，与 Qwen 中文长描述定妆风格差异较大",
            "isBuiltIn": True,
            "isEnabled": False,
            "params": {
                "defaultAspectRatio": "16:9",
                "supportedAspectRatios": ["16:9", "9:16", "1:1"],
                "apiFormat": "comfyui",
                "workflowName": "flux_dev1_fp8_text_to_image",
                "steps": 20,
                "turnaroundWorkflowName": "qwen_image_edit_2511_fp8_character_turnaround",
                "turnaroundSteps": 4,
            },
        },
        {
            "id": "comfyui-minimax-h3-flft2v",
            "apiModel": "video_minimax_h3_flft2v",
            "name": "ComfyUI MiniMax H3 FLF2V (本地)",
            "type": "video",
            "providerId": "comfyui-local",
            "description": "本地 MiniMax H3 首尾帧图生视频，原生立体声音频",
            "isBuiltIn": True,
            "isEnabled": True,
            "params": {
                "mode": "comfyui",
                "defaultAspectRatio": "16:9",
                "supportedAspectRatios": ["16:9", "9:16"],
                "defaultDuration": 5,
                "supportedDurations": [5, 10, 15],
                "workflowName": "video_minimax_h3_flft2v",
                "steps": 20,
                "supportsEndFrame": True,
                "supportsAudio": False,
            },
        },
        {
            "id": "comfyui-ltx2-5-flf2v",
            "apiModel": "video_ltx2_5_flf2v",
            "name": "ComfyUI LTX 2.5 FLF2V (本地)",
            "type": "video",
            "providerId": "comfyui-local",
            "description": "本地 ComfyUI LTX 2.5 首尾帧图生视频，内置音视频同步；24fps",
            "isBuiltIn": True,
            "isEnabled": True,
            "params": {
                "mode": "comfyui",
                "defaultAspectRatio": "16:9",
                "supportedAspectRatios": ["16:9", "9:16"],
                "defaultDuration": 5,
                "supportedDurations": [5, 10, 15],
                "workflowName": "video_ltx2_5_flf2v",
                "steps": 20,
                "supportsEndFrame": True,
                "supportsAudio": False,
            },
        },
        {
            "id": "comfyui-ltx2-3-i2v",
            "apiModel": "video_ltx2_3_i2v",
            "name": "ComfyUI LTX 2.3 I2V (本地)",
            "type": "video",
            "providerId": "comfyui-local",
            "description": "本地 ComfyUI 图生视频",
            "isBuiltIn": True,
            "isEnabled": True,
            "params": {
                "mode": "comfyui",
                "defaultAspectRatio": "16:9",
                "supportedAspectRatios": ["16:9", "9:16"],
                "defaultDuration": 5,
                "supportedDurations": [5, 10, 15],
                "workflowName": "video_ltx2_3_i2v",
                "steps": 20,
                "supportsEndFrame": False,
                "supportsAudio": False,
            },
        },
        {
            "id": "indextts-local",
            "apiModel": cfg.indextts_model_id,
            "name": "IndexTTS (本地 OpenAI Speech)",
            "type": "audio",
            "providerId": "indextts-local",
            "endpoint": "/v1/audio/speech",
            "description": "OpenAI 兼容 /v1/audio/speech，配置由服务端 .env 管理",
            "isBuiltIn": True,
            "isEnabled": True,
            "params": {
                "defaultVoice": cfg.indextts_default_voice,
                "outputFormat": cfg.indextts_response_format,
                "speechInputMode": "plain",
                "timeoutMs": cfg.indextts_timeout_ms,
            },
        },
    ]

    registry: dict[str, Any] = {
        "providers": providers,
        "models": models,
        "activeModels": {
            "chat": cfg.default_chat_model_id,
            "image": cfg.default_image_model_id,
            "video": cfg.default_video_model_id,
            "audio": cfg.default_audio_model_id,
        },
    }
    if cfg.default_api_key:
        registry["globalApiKey"] = cfg.default_api_key
    return registry


def _provider_env_overrides(settings: Settings) -> dict[str, dict[str, str]]:
    return {
        "vllm-local": {
            "baseUrl": settings.vllm_base_url.rstrip("/"),
            "apiKey": settings.vllm_api_key,
        },
        "indextts-local": {
            "baseUrl": settings.indextts_base_url.rstrip("/"),
            "apiKey": settings.indextts_api_key,
        },
        "comfyui-local": {
            "baseUrl": settings.comfyui_base_url.rstrip("/"),
        },
    }


def apply_deployment_overrides(registry: dict[str, Any], settings: Settings | None = None) -> dict[str, Any]:
    """将 .env 中的基础设施地址/密钥合并到注册表（部署层覆盖，不写入 DB）。

    规则：
    - baseUrl：有值则覆盖（便于运维统一改地址）
    - apiKey：仅当用户未配置有效密钥，且 .env 不是占位符时才写入
    """
    cfg = settings or get_settings()
    merged = copy.deepcopy(registry or {})
    overrides = _provider_env_overrides(cfg)
    placeholder_keys = {"VLLM_API_KEY"}

    providers = list(merged.get("providers") or [])
    for provider in providers:
        pid = provider.get("id")
        if pid not in overrides:
            continue
        for key, value in overrides[pid].items():
            if not value:
                continue
            if key == "apiKey":
                existing = (provider.get("apiKey") or "").strip()
                if existing and existing not in placeholder_keys:
                    continue
                if value in placeholder_keys:
                    continue
            provider[key] = value
    merged["providers"] = providers

    # 同步本地模型参数（随 .env 变更）
    model_patches: dict[str, dict[str, Any]] = {
        "qwen3-8-27b-fp8-vllm": {
            "apiModel": cfg.vllm_model_id,
            "params": {"temperature": 0.7, "maxTokens": cfg.vllm_max_tokens},
        },
        "indextts-local": {
            "apiModel": cfg.indextts_model_id,
            "params": {
                "defaultVoice": cfg.indextts_default_voice,
                "outputFormat": cfg.indextts_response_format,
                "speechInputMode": "plain",
                "timeoutMs": cfg.indextts_timeout_ms,
            },
        },
    }
    models = list(merged.get("models") or [])
    for model in models:
        patch = model_patches.get(model.get("id", ""))
        if not patch:
            continue
        if patch.get("apiModel"):
            model["apiModel"] = patch["apiModel"]
        if patch.get("params"):
            model["params"] = {**(model.get("params") or {}), **patch["params"]}
    merged["models"] = models

    if cfg.default_api_key and not merged.get("globalApiKey"):
        merged["globalApiKey"] = cfg.default_api_key

    return merged


def is_registry_usable(registry: dict[str, Any] | None) -> bool:
    if not registry or not isinstance(registry, dict):
        return False
    return bool(registry.get("providers") or registry.get("models") or registry.get("activeModels"))


def sanitize_registry(
    registry: dict[str, Any],
    settings: Settings | None = None,
) -> tuple[dict[str, Any], bool]:
    """移除无效/废弃模型与提供商，并修正 activeModels 引用。"""
    cfg = settings or get_settings()
    merged = copy.deepcopy(registry or {})
    changed = False
    defaults = build_default_registry(cfg)
    default_active = defaults.get("activeModels") or {}

    providers = [
        p for p in merged.get("providers") or []
        if p.get("id") not in DEPRECATED_PROVIDER_IDS
    ]
    if len(providers) != len(merged.get("providers") or []):
        changed = True
    merged["providers"] = providers

    removed_model_ids: set[str] = set()
    models: list[dict[str, Any]] = []
    for model in merged.get("models") or []:
        mid = model.get("id") or ""
        provider_id = model.get("providerId") or ""
        if model.get("type") == "chat" and provider_id in INVALID_CHAT_PROVIDER_IDS:
            removed_model_ids.add(mid)
            changed = True
            continue
        if provider_id in DEPRECATED_PROVIDER_IDS:
            removed_model_ids.add(mid)
            changed = True
            continue

        # 默认图片模型定妆：Flux / 2steps → image_qwen_Image_2512（全量步数）
        if mid == "comfyui-flux-dev-fp8" and model.get("type") == "image":
            params = dict(model.get("params") or {})
            casting = params.get("workflowName") or "flux-dev-fp8"
            if casting in {
                "flux-dev-fp8",
                "flux_dev1_fp8_text_to_image",
                "image_qwen_image_2512_with_2steps_lora",
            }:
                params.update(
                    {
                        "apiFormat": "comfyui",
                        "workflowName": "image_qwen_Image_2512",
                        "steps": 50,
                    }
                )
                model = {
                    **model,
                    "apiModel": "qwen-image-2512",
                    "name": "ComfyUI Qwen Image 2512 (本地)",
                    "params": params,
                }
                changed = True
            # 补齐九宫格专用工作流配置
            params = dict(model.get("params") or {})
            if not params.get("turnaroundWorkflowName"):
                params["turnaroundWorkflowName"] = "qwen_image_edit_2511_fp8_character_turnaround"
                params["turnaroundSteps"] = params.get("turnaroundSteps") or 4
                model = {**model, "params": params}
                changed = True

        models.append(model)
    merged["models"] = models

    active = dict(merged.get("activeModels") or {})
    for kind, fallback in default_active.items():
        current = active.get(kind)
        if current in removed_model_ids or not current:
            if fallback and active.get(kind) != fallback:
                active[kind] = fallback
                changed = True
    merged["activeModels"] = active

    return merged, changed


def merge_registry(stored: dict[str, Any], defaults: dict[str, Any]) -> dict[str, Any]:
    """合并 DB 存储与默认项：保留用户自定义，补齐缺失的内置 providers/models。"""
    merged = copy.deepcopy(stored or {})
    default = copy.deepcopy(defaults)

    stored_providers = {p.get("id"): p for p in merged.get("providers") or [] if p.get("id")}
    for provider in default.get("providers") or []:
        pid = provider.get("id")
        if pid and pid not in stored_providers:
            stored_providers[pid] = provider
    merged["providers"] = list(stored_providers.values())

    stored_models = {m.get("id"): m for m in merged.get("models") or [] if m.get("id")}
    for model in default.get("models") or []:
        mid = model.get("id")
        if mid and mid not in stored_models:
            stored_models[mid] = model
    merged["models"] = list(stored_models.values())

    merged["activeModels"] = {
        **(default.get("activeModels") or {}),
        **(merged.get("activeModels") or {}),
    }
    return merged
