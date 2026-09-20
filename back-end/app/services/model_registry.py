"""服务端模型注册表：默认配置来自环境变量，持久化在 user_settings.model_registry。"""

from __future__ import annotations

import copy
import os
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

# 代码内置默认工作流名（不含 .json）；账号/前端已填写则不覆盖
DEFAULT_IMAGE_WORKFLOW_NAME = "image_qwen_image_2512"
DEFAULT_VIDEO_WORKFLOW_NAME = "default_video_generate"
MINIMAX_H3_R2V_WORKFLOW_NAME = "MiniMax_H3_Ref2VA_High-Quality_Multi-Reference.json"
NANO_BANANA_T2I_WORKFLOW_NAME = "api_google_nano_banana2_text_to_image.json"
NANO_BANANA_EDIT_WORKFLOW_NAME = "api_google_nano_banana2_image_edit.json"
QWEN_IMAGE_21_T2I_WORKFLOW_NAME = "image_qwen_image_2_1_t2i"
QWEN_IMAGE_21_EDIT_WORKFLOW_NAME = "image_qwen_image_2_1_image_edit"


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
            "id": "apiyi",
            "name": "API易",
            "baseUrl": (cfg.apiyi_base_url or "https://api.apiyi.com").rstrip("/"),
            "apiKey": cfg.apiyi_api_key or "",
            "isBuiltIn": True,
            "isDefault": False,
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
            "apiModel": "flux2-klein-9b",
            "name": "ComfyUI FLUX.2 Klein 9B (本地)",
            "type": "image",
            "providerId": "comfyui-local",
            "description": "默认定妆：Qwen Image 2512 T2I；带参考图定妆：Qwen Image Edit 2511（最多 3 张）；关键帧：FLUX.2 Klein 9B Image Edit（最多 4 张参考）；造型九宫格：Qwen Edit turnaround",
            "isBuiltIn": True,
            "isEnabled": True,
            "params": {
                "defaultAspectRatio": "16:9",
                "supportedAspectRatios": ["16:9", "9:16", "1:1"],
                "apiFormat": "comfyui",
                "workflowName": DEFAULT_IMAGE_WORKFLOW_NAME,
                "steps": 20,
                "referenceWorkflowName": "image_qwen_image_edit_2511_20260908",
                "referenceSteps": 40,
                "keyframeWorkflowName": "image_flux2_klein_image_edit_9b_base",
                "keyframeSteps": 20,
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
            "description": "Qwen Image 2512 文生图（定妆）；带参考图与关键帧走 Qwen Image Edit 2511；九宫格走 Qwen Edit turnaround",
            "isBuiltIn": True,
            "isEnabled": False,
            "params": {
                "defaultAspectRatio": "16:9",
                "supportedAspectRatios": ["16:9", "9:16", "1:1"],
                "apiFormat": "comfyui",
                "workflowName": DEFAULT_IMAGE_WORKFLOW_NAME,
                "steps": 20,
                "referenceWorkflowName": "image_qwen_image_edit_2511_20260908",
                "referenceSteps": 40,
                "keyframeWorkflowName": "image_qwen_image_edit_2511_20260908",
                "keyframeSteps": 40,
                "turnaroundWorkflowName": "qwen_image_edit_2511_fp8_character_turnaround",
                "turnaroundSteps": 4,
            },
        },
        {
            "id": "comfyui-minimax-h3-flft2v",
            "apiModel": "video_minimax_h3_fl2v",
            "name": "ComfyUI MiniMax H3 FL2V (video_minimax_h3_fl2v)",
            "type": "video",
            "providerId": "comfyui-local",
            "description": "工作流 video_minimax_h3_fl2v.json；首尾帧原生音视频；高质量 20 steps / 快速预览 8-step Lightning；24fps",
            "isBuiltIn": True,
            "isEnabled": True,
            "params": {
                "mode": "comfyui",
                "defaultAspectRatio": "16:9",
                "supportedAspectRatios": ["16:9", "9:16"],
                "defaultDuration": 5,
                "supportedDurations": [5, 10, 15],
                "workflowName": "video_minimax_h3_fl2v",
                "steps": 8,
                "supportsEndFrame": True,
                "supportsAudio": False,
                "supportsNativeAudio": True,
            },
        },
        {
            "id": "comfyui-nano-banana-2",
            "apiModel": "nano-banana-2",
            "name": "ComfyUI Nano Banana 2（本地）",
            "type": "image",
            "providerId": "comfyui-local",
            "description": "Nano Banana 2 文生图与参考图编辑；角色定妆、场景、道具及分镜参考修改",
            "isBuiltIn": True,
            "isEnabled": True,
            "params": {
                "defaultAspectRatio": "16:9",
                "supportedAspectRatios": ["16:9", "9:16", "1:1"],
                "apiFormat": "comfyui",
                "workflowName": NANO_BANANA_T2I_WORKFLOW_NAME,
                "referenceWorkflowName": NANO_BANANA_EDIT_WORKFLOW_NAME,
                "referenceSteps": 1,
            },
        },
        {
            "id": "comfyui-qwen-image-2-1",
            "apiModel": "qwen-image-2.1",
            "name": "ComfyUI Qwen Image 2.1（本地）",
            "type": "image",
            "providerId": "comfyui-local",
            "description": (
                "Qwen Image 2.1 文生图（image_qwen_image_2_1_t2i）；"
                "带参考图走 Image Edit（最多 10 张，image_qwen_image_2_1_image_edit）；默认 25 steps"
            ),
            "isBuiltIn": True,
            "isEnabled": True,
            "params": {
                "defaultAspectRatio": "16:9",
                "supportedAspectRatios": ["16:9", "9:16", "1:1"],
                "apiFormat": "comfyui",
                "workflowName": QWEN_IMAGE_21_T2I_WORKFLOW_NAME,
                "steps": 25,
                "referenceWorkflowName": QWEN_IMAGE_21_EDIT_WORKFLOW_NAME,
                "referenceSteps": 25,
                "keyframeWorkflowName": QWEN_IMAGE_21_EDIT_WORKFLOW_NAME,
                "keyframeSteps": 25,
            },
        },
        {
            "id": "gpt-image-2",
            "apiModel": "gpt-image-2",
            "name": "GPT Image 2.0（API易·按量）",
            "type": "image",
            "providerId": "apiyi",
            "endpoint": "/v1/images/generations",
            "description": (
                "API易官转按量：gpt-image-2（2.0）；"
                "OpenAI Images 文生图 / 参考图编辑；可选 1K / 2K / 4K / 1344x768"
            ),
            "isBuiltIn": True,
            "isEnabled": True,
            "params": {
                "defaultAspectRatio": "16:9",
                "supportedAspectRatios": ["16:9", "9:16", "1:1"],
                "apiFormat": "openai",
                "outputResolution": "1344x768",
                "supportedOutputResolutions": ["1K", "2K", "4K", "1344x768"],
            },
        },
        {
            "id": "gpt-image-2.5-flare",
            "apiModel": "gpt-image-2.5-flare",
            "name": "GPT Image 2.5 Flare（API易·按量）",
            "type": "image",
            "providerId": "apiyi",
            "endpoint": "/v1/images/generations",
            "description": (
                "API易官转按量：gpt-image-2.5-flare，速度优先；"
                "可选 1K / 2K / 4K / 1344x768"
            ),
            "isBuiltIn": True,
            "isEnabled": True,
            "params": {
                "defaultAspectRatio": "16:9",
                "supportedAspectRatios": ["16:9", "9:16", "1:1"],
                "apiFormat": "openai",
                "outputResolution": "2K",
                "supportedOutputResolutions": ["1K", "2K", "4K", "1344x768"],
            },
        },
        {
            "id": "gpt-image-2.5-sunburst",
            "apiModel": "gpt-image-2.5-sunburst",
            "name": "GPT Image 2.5 Sunburst（API易·按量）",
            "type": "image",
            "providerId": "apiyi",
            "endpoint": "/v1/images/generations",
            "description": (
                "API易官转按量：gpt-image-2.5-sunburst，画质与编辑精度优先；"
                "可选 1K / 2K / 4K / 1344x768"
            ),
            "isBuiltIn": True,
            "isEnabled": True,
            "params": {
                "defaultAspectRatio": "16:9",
                "supportedAspectRatios": ["16:9", "9:16", "1:1"],
                "apiFormat": "openai",
                "outputResolution": "2K",
                "supportedOutputResolutions": ["1K", "2K", "4K", "1344x768"],
            },
        },
        {
            "id": "gpt-image-2.5-all",
            "apiModel": "gpt-image-2.5-all",
            "name": "GPT Image 2.5 All（API易·按次）",
            "type": "image",
            "providerId": "apiyi",
            "endpoint": "/v1/images/generations",
            "description": (
                "API易按次固定价：gpt-image-2.5-all；"
                "尺寸写进提示词，不传 size/quality；适合快速出图"
            ),
            "isBuiltIn": True,
            "isEnabled": True,
            "params": {
                "defaultAspectRatio": "16:9",
                "supportedAspectRatios": ["16:9", "9:16", "1:1"],
                "apiFormat": "openai",
                "outputResolution": "2K",
                "supportedOutputResolutions": ["1K", "2K", "4K"],
            },
        },
        {
            "id": "gpt-image-2.5-vip",
            "apiModel": "gpt-image-2.5-vip",
            "name": "GPT Image 2.5 VIP（API易·按次）",
            "type": "image",
            "providerId": "apiyi",
            "endpoint": "/v1/images/generations",
            "description": (
                "API易按次固定价：gpt-image-2.5-vip（sunburst-vip）；"
                "可用 size 锁定分辨率，适合分镜/封面"
            ),
            "isBuiltIn": True,
            "isEnabled": True,
            "params": {
                "defaultAspectRatio": "16:9",
                "supportedAspectRatios": ["16:9", "9:16", "1:1"],
                "apiFormat": "openai",
                "outputResolution": "2K",
                "supportedOutputResolutions": ["1K", "2K", "4K"],
            },
        },
        {
            "id": "gpt-image-2.5-flare-vip",
            "apiModel": "gpt-image-2.5-flare-vip",
            "name": "GPT Image 2.5 Flare VIP（API易·按次）",
            "type": "image",
            "providerId": "apiyi",
            "endpoint": "/v1/images/generations",
            "description": "API易按次固定价：gpt-image-2.5-flare-vip；速度优先 + size 锁定",
            "isBuiltIn": True,
            "isEnabled": True,
            "params": {
                "defaultAspectRatio": "16:9",
                "supportedAspectRatios": ["16:9", "9:16", "1:1"],
                "apiFormat": "openai",
                "outputResolution": "2K",
                "supportedOutputResolutions": ["1K", "2K", "4K"],
            },
        },
        {
            "id": "gpt-image-2-all",
            "apiModel": "gpt-image-2-all",
            "name": "GPT Image 2.0 All（API易·按次）",
            "type": "image",
            "providerId": "apiyi",
            "endpoint": "/v1/images/generations",
            "description": "API易按次固定价：gpt-image-2-all；尺寸写进提示词，不传 size/quality",
            "isBuiltIn": True,
            "isEnabled": True,
            "params": {
                "defaultAspectRatio": "16:9",
                "supportedAspectRatios": ["16:9", "9:16", "1:1"],
                "apiFormat": "openai",
                "outputResolution": "1K",
                "supportedOutputResolutions": ["1K", "2K", "4K"],
            },
        },
        {
            "id": "gpt-image-2-vip",
            "apiModel": "gpt-image-2-vip",
            "name": "GPT Image 2.0 VIP（API易·按次）",
            "type": "image",
            "providerId": "apiyi",
            "endpoint": "/v1/images/generations",
            "description": "API易按次固定价：gpt-image-2-vip；可用 size 锁定分辨率（含 4K）",
            "isBuiltIn": True,
            "isEnabled": True,
            "params": {
                "defaultAspectRatio": "16:9",
                "supportedAspectRatios": ["16:9", "9:16", "1:1"],
                "apiFormat": "openai",
                "outputResolution": "2K",
                "supportedOutputResolutions": ["1K", "2K", "4K"],
            },
        },
        {
            "id": "doubao-seedream-5-0-pro-260628",
            "apiModel": "ep-20260919034202-p2zx8",
            "name": "Doubao Seedream 5.0 Pro",
            "type": "image",
            "providerId": "volcengine",
            "endpoint": "/api/v3/images/generations",
            "description": (
                "火山方舟 Seedream 5.0 Pro（接入点 ep-20260919034202-p2zx8）："
                "文生图 / 参考图编辑；可选 1K / 2K / 1344x768（对齐 MiniMax H3）"
            ),
            "isBuiltIn": True,
            "isEnabled": True,
            "params": {
                "defaultAspectRatio": "16:9",
                "supportedAspectRatios": ["16:9", "9:16", "1:1"],
                "apiFormat": "openai",
                "outputResolution": "1344x768",
                "supportedOutputResolutions": ["1K", "2K", "1344x768"],
            },
        },
        {
            # 保留历史卡片 id；apiModel 为 Seedance 1.0 Pro 方舟接入点
            "id": "doubao-seedance-1-5-pro-251215",
            "apiModel": "ep-20260919140814-hwwtt",
            "name": "Doubao Seedance 1.0 Pro",
            "type": "video",
            "providerId": "volcengine",
            "endpoint": "/api/v3/contents/generations/tasks",
            "description": (
                "火山方舟 Seedance 1.0 Pro（接入点 ep-20260919140814-hwwtt）："
                "异步任务 create + poll；支持首帧图生视频，时长 4/8/12 秒"
            ),
            "isBuiltIn": True,
            "isEnabled": True,
            "params": {
                "mode": "async",
                "defaultAspectRatio": "16:9",
                "supportedAspectRatios": ["16:9", "9:16"],
                "defaultDuration": 8,
                "supportedDurations": [4, 8, 12],
            },
        },
        {
            "id": "doubao-seedance-2-0-260128",
            "apiModel": "doubao-seedance-2-0-260128",
            "name": "Doubao Seedance 2.0",
            "type": "video",
            "providerId": "volcengine",
            "endpoint": "/api/v3/contents/generations/tasks",
            "description": "火山方舟直连异步任务（create + poll）；支持 5/10/15 秒",
            "isBuiltIn": True,
            "isEnabled": True,
            "params": {
                "mode": "async",
                "defaultAspectRatio": "16:9",
                "supportedAspectRatios": ["16:9", "9:16"],
                "defaultDuration": 5,
                "supportedDurations": [5, 10, 15],
            },
        },
        {
            "id": "comfyui-minimax-h3-r2v",
            "apiModel": "video_minimax_h3_r2v",
            "name": "ComfyUI MiniMax H3 Ref2VA（本地）",
            "type": "video",
            "providerId": "comfyui-local",
            "description": "本地 MiniMax H3 多参考图视频，最多 9 张参考图，支持原生音视频",
            "isBuiltIn": True,
            "isEnabled": True,
            "params": {
                "mode": "comfyui",
                "defaultAspectRatio": "16:9",
                "supportedAspectRatios": ["16:9", "9:16", "1:1"],
                "defaultDuration": 5,
                "supportedDurations": [5, 10, 15],
                "workflowName": MINIMAX_H3_R2V_WORKFLOW_NAME,
                # Stage 1 固定 8 steps + Stage 2 固定 4 steps。
                "steps": 12,
                "supportsEndFrame": False,
                "supportsAudio": False,
                "supportsNativeAudio": True,
                "supportsReferenceImages": True,
                "maxReferenceImages": 9,
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
                "workflowName": DEFAULT_VIDEO_WORKFLOW_NAME,
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
                "workflowName": DEFAULT_VIDEO_WORKFLOW_NAME,
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
    # 仅在部署环境明确提供变量时覆盖账号配置。
    # 不能把 Settings 的默认值（例如 127.0.0.1:8188）当成运维覆盖值，
    # 否则用户在界面保存的 Tailscale 地址会在服务端读取时被悄悄改回本机。
    overrides: dict[str, dict[str, str]] = {}
    if os.getenv("VLLM_BASE_URL"):
        overrides["vllm-local"] = {
            "baseUrl": settings.vllm_base_url.rstrip("/"),
        }
    if os.getenv("VLLM_API_KEY"):
        overrides.setdefault("vllm-local", {})["apiKey"] = settings.vllm_api_key
    if os.getenv("INDEXTTS_BASE_URL"):
        overrides["indextts-local"] = {
            "baseUrl": settings.indextts_base_url.rstrip("/"),
        }
    if os.getenv("INDEXTTS_API_KEY"):
        overrides.setdefault("indextts-local", {})["apiKey"] = settings.indextts_api_key
    if os.getenv("COMFYUI_BASE_URL"):
        overrides["comfyui-local"] = {
            "baseUrl": settings.comfyui_base_url.rstrip("/"),
        }
    # apiyi：baseUrl 仅在显式设置环境变量时覆盖；apiKey 有值则注入（默认空串不会误写）
    if os.getenv("APIYI_BASE_URL"):
        overrides["apiyi"] = {
            "baseUrl": settings.apiyi_base_url.rstrip("/"),
        }
    if (settings.apiyi_api_key or "").strip():
        overrides.setdefault("apiyi", {})["apiKey"] = settings.apiyi_api_key.strip()
    return overrides


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
    default_models = {m.get("id"): m for m in defaults.get("models") or [] if m.get("id")}
    models: list[dict[str, Any]] = []

    # Seedream 5.0 Lite → Pro（保留 Key / 启用状态）
    seedream_lite_id = "doubao-seedream-5-0-260128"
    seedream_pro_id = "doubao-seedream-5-0-pro-260628"
    raw_models = list(merged.get("models") or [])
    has_seedream_pro = any(m.get("id") == seedream_pro_id for m in raw_models)
    migrated_models: list[dict[str, Any]] = []
    for model in raw_models:
        mid = model.get("id") or ""
        if mid == seedream_lite_id:
            changed = True
            if has_seedream_pro:
                removed_model_ids.add(mid)
                continue
            builtin = default_models.get(seedream_pro_id) or {}
            params = {
                **(builtin.get("params") or {}),
                **(model.get("params") or {}),
            }
            if not params.get("supportedOutputResolutions"):
                params["supportedOutputResolutions"] = ["1K", "2K", "1344x768"]
            if not params.get("outputResolution"):
                params["outputResolution"] = "1344x768"
            model = {
                **model,
                "id": seedream_pro_id,
                "apiModel": builtin.get("apiModel") or "ep-20260919034202-p2zx8",
                "name": builtin.get("name") or "Doubao Seedream 5.0 Pro",
                "description": builtin.get("description") or model.get("description"),
                "endpoint": "/api/v3/images/generations",
                "providerId": "volcengine",
                "params": params,
            }
            # 旧卡片误填 NewAPI 地址时清掉，回退到 Volcengine provider baseUrl
            bad_base = (model.get("baseUrl") or "").strip().rstrip("/")
            if bad_base and ("192.168." in bad_base or bad_base.endswith(":3000")):
                model.pop("baseUrl", None)
            has_seedream_pro = True
        elif mid == seedream_pro_id:
            # 强制同步方舟接入点 ID（ep-...），预置模型名会 404
            builtin = default_models.get(seedream_pro_id) or {}
            desired_api = builtin.get("apiModel") or "ep-20260919034202-p2zx8"
            if model.get("apiModel") != desired_api:
                model = {
                    **model,
                    "apiModel": desired_api,
                    "endpoint": "/api/v3/images/generations",
                    "providerId": "volcengine",
                    "name": builtin.get("name") or model.get("name") or "Doubao Seedream 5.0 Pro",
                    "description": builtin.get("description") or model.get("description"),
                }
                changed = True
        elif mid == "doubao-seedance-1-5-pro-251215":
            # 1.5 Pro 下架 → 1.0 Pro 接入点；保留卡片 id 与 Key
            builtin = default_models.get(mid) or {}
            desired_api = builtin.get("apiModel") or "ep-20260919140814-hwwtt"
            desired_name = builtin.get("name") or "Doubao Seedance 1.0 Pro"
            if (
                model.get("apiModel") != desired_api
                or model.get("name") != desired_name
                or (model.get("providerId") or "") != "volcengine"
            ):
                model = {
                    **model,
                    "apiModel": desired_api,
                    "endpoint": "/api/v3/contents/generations/tasks",
                    "providerId": "volcengine",
                    "name": desired_name,
                    "description": builtin.get("description") or model.get("description"),
                }
                changed = True
        migrated_models.append(model)
    raw_models = migrated_models

    for model in raw_models:
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

        # 只补空工作流；内置 MiniMax H3 R2V 的旧默认值迁移到多参考图工作流。
        # 其他已填写的自定义工作流一律保留。
        if model.get("type") == "image":
            fallback = dict((default_models.get(mid) or {}).get("params") or {})
            params = dict(model.get("params") or {})
            filled = False
            if fallback.get("supportedOutputResolutions") and (
                params.get("supportedOutputResolutions") != fallback.get("supportedOutputResolutions")
            ):
                params["supportedOutputResolutions"] = list(fallback["supportedOutputResolutions"])
                filled = True
            supported = params.get("supportedOutputResolutions") or []
            if supported and params.get("outputResolution") not in supported:
                params["outputResolution"] = fallback.get("outputResolution") or supported[0]
                filled = True
            if not params.get("outputResolution"):
                params["outputResolution"] = fallback.get("outputResolution") or "1K"
                filled = True
            if not params.get("workflowName"):
                params["workflowName"] = fallback.get("workflowName") or DEFAULT_IMAGE_WORKFLOW_NAME
                if not params.get("steps") and fallback.get("steps"):
                    params["steps"] = fallback["steps"]
                filled = True
            if not params.get("referenceWorkflowName") and fallback.get("referenceWorkflowName"):
                params["referenceWorkflowName"] = fallback["referenceWorkflowName"]
                if params.get("referenceSteps") is None:
                    params["referenceSteps"] = fallback.get("referenceSteps")
                filled = True
            # 兼容用户此前手动添加的 Qwen 2512 文生图模型：为其补齐可实际消费参考图的 Edit 工作流。
            if (
                not params.get("referenceWorkflowName")
                and params.get("workflowName") in {"default_image_generate", "image_qwen_image_2512"}
            ):
                params["referenceWorkflowName"] = "image_qwen_image_edit_2511_20260908"
                if params.get("referenceSteps") is None:
                    params["referenceSteps"] = 40
                filled = True
            # 内置 Qwen Edit 参考图工作流曾默认 Lightning 4-step；质量优先时统一走完整 40-step 分支。
            try:
                reference_steps = int(params.get("referenceSteps") or 0)
            except (TypeError, ValueError):
                reference_steps = 0
            if (
                params.get("referenceWorkflowName") == "image_qwen_image_edit_2511_20260908"
                and reference_steps <= 8
            ):
                params["referenceSteps"] = 40
                filled = True
            if not params.get("turnaroundWorkflowName") and fallback.get("turnaroundWorkflowName"):
                params["turnaroundWorkflowName"] = fallback["turnaroundWorkflowName"]
                params["turnaroundSteps"] = params.get("turnaroundSteps") or fallback.get("turnaroundSteps") or 4
                filled = True
            if not params.get("keyframeWorkflowName") and fallback.get("keyframeWorkflowName"):
                params["keyframeWorkflowName"] = fallback["keyframeWorkflowName"]
                if params.get("keyframeSteps") is None:
                    params["keyframeSteps"] = fallback.get("keyframeSteps")
                filled = True
            if filled:
                model = {**model, "params": params}
                changed = True

        if model.get("type") == "video":
            fallback = dict((default_models.get(mid) or {}).get("params") or {})
            params = dict(model.get("params") or {})
            workflow_name = str(params.get("workflowName") or "").strip()
            is_minimax_r2v = mid == "comfyui-minimax-h3-r2v"
            is_minimax_flf2v = mid == "comfyui-minimax-h3-flft2v"
            is_legacy_minimax_r2v = (
                is_minimax_r2v
                and workflow_name.removesuffix(".json") == "video_minimax_h3_r2v"
            )
            if is_minimax_r2v:
                # Ref2VA 固定走多参考图模板；该模板实际声明最多 9 个图像输入槽。
                params["workflowName"] = MINIMAX_H3_R2V_WORKFLOW_NAME
                params["maxReferenceImages"] = 9
                model = {**model, "params": params}
                changed = True
            elif is_minimax_flf2v:
                # 首尾帧固定走 video_minimax_h3_fl2v，并同步展示名（清掉旧 768p Turbo 文案）。
                builtin = default_models.get(mid) or {}
                params["workflowName"] = "video_minimax_h3_fl2v"
                model = {
                    **model,
                    "params": params,
                    "apiModel": "video_minimax_h3_fl2v",
                    "name": builtin.get("name") or "ComfyUI MiniMax H3 FL2V (video_minimax_h3_fl2v)",
                    "description": builtin.get("description")
                    or "工作流 video_minimax_h3_fl2v.json；首尾帧原生音视频；高质量 20 steps / 快速预览 8-step Lightning；24fps",
                }
                changed = True
            elif not workflow_name or is_legacy_minimax_r2v:
                params["workflowName"] = fallback.get("workflowName") or DEFAULT_VIDEO_WORKFLOW_NAME
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
