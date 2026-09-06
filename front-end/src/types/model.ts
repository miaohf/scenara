/**
 * 模型抽象层类型定义
 * 定义模型注册、配置、适配器相关的所有类型
 */

// ============================================
// 基础类型
// ============================================

/**
 * 模型类型
 */
export type ModelType = 'chat' | 'image' | 'video' | 'audio';

/**
 * 横竖屏比例类型
 */
export type AspectRatio = '16:9' | '9:16' | '1:1';

/**
 * 图片模型 API 协议类型
 * gemini: Google generateContent 风格
 * openai: OpenAI Images API 风格
 * comfyui: ComfyUI workflow API 风格
 */
export type ImageApiFormat = 'gemini' | 'openai' | 'comfyui';

/**
 * 视频时长类型（仅异步视频模式支持）
 */
export type VideoDuration = 4 | 5 | 8 | 10 | 12 | 15;

/**
 * 视频生成模式
 */
export type VideoMode = 'sync' | 'async' | 'comfyui';

/**
 * 音频输出格式
 */
export type AudioOutputFormat = 'wav' | 'mp3' | 'opus';

// ============================================
// 模型参数配置
// ============================================

/**
 * 对话模型参数
 */
export interface ChatModelParams {
  temperature: number;           // 温度 0-2，默认 0.7
  maxTokens?: number;            // 最大 token，留空表示不限制
  topP?: number;                 // Top P，可选
  frequencyPenalty?: number;     // 频率惩罚，可选
  presencePenalty?: number;      // 存在惩罚，可选
}

/**
 * 图片模型参数
 */
export interface ImageModelParams {
  defaultAspectRatio: AspectRatio;
  supportedAspectRatios: AspectRatio[];
  apiFormat?: ImageApiFormat;
  /** 定妆/通用文生图 ComfyUI 工作流 */
  workflowName?: string;
  steps?: number;
  /** 镜头首尾帧专用 ComfyUI 工作流；未填则回退 workflowName */
  keyframeWorkflowName?: string;
  /** 镜头首尾帧 steps；未填则回退 steps */
  keyframeSteps?: number;
  /** 造型九宫格专用 ComfyUI 工作流（基于定妆参考图）；未填则回退 workflowName */
  turnaroundWorkflowName?: string;
  /** 造型九宫格 steps；未填则回退 steps */
  turnaroundSteps?: number;
}

/**
 * 视频模型参数
 */
export interface VideoModelParams {
  mode: VideoMode;                        // sync=Veo, async=Sora, comfyui=ComfyUI workflow
  defaultAspectRatio: AspectRatio;
  supportedAspectRatios: AspectRatio[];
  defaultDuration: VideoDuration;
  supportedDurations: VideoDuration[];
  workflowName?: string;
  steps?: number;
  supportsEndFrame?: boolean;             // 是否支持尾帧（首尾帧模式）
  supportsAudio?: boolean;                // 是否支持注入配音音频
}

/**
 * 配音模型参数
 */
export interface AudioModelParams {
  defaultVoice: string;                   // 默认音色
  outputFormat: AudioOutputFormat;        // 输出音频格式
  /** speech 接口是否直接使用原文（IndexTTS 等），否则包裹旁白/对白提示词 */
  speechInputMode?: 'plain' | 'prompt';
  timeoutMs?: number;
}

/**
 * 模型参数联合类型
 */
export type ModelParams = ChatModelParams | ImageModelParams | VideoModelParams | AudioModelParams;

// ============================================
// 模型定义
// ============================================

/**
 * 模型定义基础接口
 */
export interface ModelDefinitionBase {
  id: string;                    // 唯一标识，如 'gpt-5.1'
  apiModel?: string;             // API 实际模型名（可与其他模型重复）
  name: string;                  // 显示名称，如 'GPT-5.1'
  type: ModelType;               // 模型类型
  providerId: string;            // 提供商 ID
  baseUrl?: string;              // 模型专属 API 根地址（优先于提供商默认地址）
  endpoint?: string;             // API 路径端点（如 /v1/chat/completions）
  description?: string;          // 描述
  isBuiltIn: boolean;            // 是否内置（内置模型不可删除）
  isEnabled: boolean;            // 是否启用
  apiKey?: string;               // 模型专属 API Key（可选，为空时使用全局 Key）
}

/**
 * 对话模型定义
 */
export interface ChatModelDefinition extends ModelDefinitionBase {
  type: 'chat';
  params: ChatModelParams;
}

/**
 * 图片模型定义
 */
export interface ImageModelDefinition extends ModelDefinitionBase {
  type: 'image';
  params: ImageModelParams;
}

/**
 * 视频模型定义
 */
export interface VideoModelDefinition extends ModelDefinitionBase {
  type: 'video';
  params: VideoModelParams;
}

/**
 * 配音模型定义
 */
export interface AudioModelDefinition extends ModelDefinitionBase {
  type: 'audio';
  params: AudioModelParams;
}

/**
 * 模型定义联合类型
 */
export type ModelDefinition =
  | ChatModelDefinition
  | ImageModelDefinition
  | VideoModelDefinition
  | AudioModelDefinition;

// ============================================
// 提供商定义
// ============================================

/**
 * 模型提供商配置
 */
export interface ModelProvider {
  id: string;                    // 唯一标识
  name: string;                  // 显示名称
  baseUrl: string;               // API 基础 URL
  apiKey?: string;               // 独立 API Key（可选）
  isBuiltIn: boolean;            // 是否内置
  isDefault: boolean;            // 是否为默认提供商
}

// ============================================
// 注册中心状态
// ============================================

/**
 * 激活的模型配置
 */
export interface ActiveModels {
  chat: string;                  // 当前激活的对话模型 ID
  image: string;                 // 当前激活的图片模型 ID
  video: string;                 // 当前激活的视频模型 ID
  audio: string;                 // 当前激活的配音模型 ID
}

/**
 * 模型注册中心状态
 */
export interface ModelRegistryState {
  providers: ModelProvider[];
  models: ModelDefinition[];
  activeModels: ActiveModels;
  globalApiKey?: string;
  /** 全局配置中用于 API Key 验证的模型名，与 activeModels.chat 无关 */
  globalVerifyChatModelName?: string;
}

// ============================================
// 服务调用参数
// ============================================

/**
 * 对话服务调用参数
 */
export interface ChatOptions {
  prompt: string;
  systemPrompt?: string;
  responseFormat?: 'text' | 'json';
  timeout?: number;
  // 可选覆盖模型参数
  overrideParams?: Partial<ChatModelParams>;
}

/**
 * 图片生成调用参数
 */
export interface ImageGenerateOptions {
  prompt: string;
  /** ComfyUI 负面提示词，写入工作流 negative 节点而非拼进 positive */
  negativePrompt?: string;
  referenceImages?: string[];
  aspectRatio?: AspectRatio;
  /** 连贯性参考图（如首帧），ComfyUI img2img 时优先作为底图 */
  continuityReferenceImage?: string;
  /** 角色参考图，ComfyUI 首帧 img2img 时用于锁定面部/服装 */
  characterReferenceImage?: string;
  /** ComfyUI img2img 去噪强度，越低越贴近参考图 */
  img2imgDenoise?: number;
  /** 可选固定 seed，便于同一镜头多次生成保持风格接近 */
  seed?: number;
  /** 覆盖模型默认 workflowName（如造型九宫格专用工作流） */
  workflowName?: string;
  /** 覆盖模型默认 steps */
  steps?: number;
  /** 异步任务归属剧集；带上后离开页面仍可按剧集找回结果 */
  episodeId?: string;
  /** 写回目标：Worker 完成后据此更新剧集对应资产 */
  target?: GenerationTarget;
  /** 任务状态回调（排队位次 / 进度），用于恢复与队列提示 */
  onJobCreated?: (job: GenerationJobStatus) => void;
  /** false 时只入队，不挂 SSE 等出图；批量提交用，避免占满浏览器连接 */
  waitForResult?: boolean;
}

/** 生成结果写回剧集的目标定位 */
export type GenerationTarget =
  | { kind: "character" | "scene" | "prop"; id: string }
  | { kind: "variation"; characterId: string; id: string }
  | { kind: "turnaround"; characterId: string }
  | { kind: "keyframe"; shotId: string; type: "start" | "end" }
  | { kind: "video" | "nineGrid"; shotId: string };

/** 生成任务状态（服务端 `/v1/jobs` 形态的最小子集） */
export interface GenerationJobStatus {
  id: string;
  status: string;
  progress?: number;
  message?: string;
  queue_position?: number | null;
  queue_running?: boolean | null;
}

/**
 * 视频生成调用参数
 */
export interface VideoGenerateOptions {
  prompt: string;
  startImage?: string;
  endImage?: string;
  audioUrl?: string;
  aspectRatio?: AspectRatio;
  duration?: VideoDuration;
  /** 异步任务归属剧集 */
  episodeId?: string;
  target?: GenerationTarget;
  onJobCreated?: (job: GenerationJobStatus) => void;
}

// ============================================
// 默认值常量
// ============================================

/**
 * 默认对话模型参数
 */
export const DEFAULT_CHAT_PARAMS: ChatModelParams = {
  temperature: 0.7,
  maxTokens: undefined,
};

/**
 * 默认图片模型参数
 * 注意：Gemini 3 Pro Image 只支持横屏(16:9)和竖屏(9:16)，不支持方形(1:1)
 */
export const DEFAULT_IMAGE_PARAMS: ImageModelParams = {
  defaultAspectRatio: '16:9',
  supportedAspectRatios: ['16:9', '9:16'],
  apiFormat: 'gemini',
};

/**
 * OpenAI Images API 默认参数
 */
export const DEFAULT_IMAGE_PARAMS_OPENAI: ImageModelParams = {
  defaultAspectRatio: '16:9',
  supportedAspectRatios: ['16:9', '9:16', '1:1'],
  apiFormat: 'openai',
};

/**
 * ComfyUI Workflow 默认参数
 */
export const DEFAULT_IMAGE_PARAMS_COMFYUI: ImageModelParams = {
  defaultAspectRatio: '16:9',
  supportedAspectRatios: ['16:9', '9:16', '1:1'],
  apiFormat: 'comfyui',
  workflowName: 'image_flux2_text_to_image_9b',
  steps: 20,
  keyframeWorkflowName: 'image_flux2_klein_image_edit_9b_base',
  keyframeSteps: 20,
  turnaroundWorkflowName: 'qwen_image_edit_2511_fp8_character_turnaround',
  turnaroundSteps: 4,
};

/**
 * 默认视频模型参数 (Veo 首尾帧模式)
 */
export const DEFAULT_VIDEO_PARAMS_VEO: VideoModelParams = {
  mode: 'sync',
  defaultAspectRatio: '16:9',
  supportedAspectRatios: ['16:9', '9:16'],  // Veo 不支持 1:1
  defaultDuration: 8,
  supportedDurations: [8],  // Veo 固定时长
};

/**
 * 默认视频模型参数 (Sora)
 */
export const DEFAULT_VIDEO_PARAMS_SORA: VideoModelParams = {
  mode: 'async',
  defaultAspectRatio: '16:9',
  supportedAspectRatios: ['16:9', '9:16', '1:1'],
  defaultDuration: 8,
  supportedDurations: [4, 8, 12],
};

/**
 * 默认视频模型参数 (Veo 3.1 Fast)
 */
export const DEFAULT_VIDEO_PARAMS_VEO_FAST: VideoModelParams = {
  mode: 'async',
  defaultAspectRatio: '16:9',
  supportedAspectRatios: ['16:9', '9:16'],
  defaultDuration: 8,
  supportedDurations: [8],
};

/**
 * 默认视频模型参数 (豆包 Seedance 1.5 Pro)
 * 火山引擎任务接口，当前按固定时长使用
 */
export const DEFAULT_VIDEO_PARAMS_DOUBAO_SEEDANCE_1_5: VideoModelParams = {
  mode: 'async',
  defaultAspectRatio: '16:9',
  supportedAspectRatios: ['16:9', '9:16'],
  defaultDuration: 8,
  supportedDurations: [4, 8, 12],
};

// Backward-compatible export for existing imports.
export const DEFAULT_VIDEO_PARAMS_DOUBAO_SEEDANCE: VideoModelParams =
  DEFAULT_VIDEO_PARAMS_DOUBAO_SEEDANCE_1_5;

/**
 * Default video model params (Doubao Seedance 2.0)
 * Volcengine async task API, currently using fixed durations.
 */
export const DEFAULT_VIDEO_PARAMS_DOUBAO_SEEDANCE_2_0: VideoModelParams = {
  mode: 'async',
  defaultAspectRatio: '16:9',
  supportedAspectRatios: ['16:9', '9:16'],
  defaultDuration: 5,
  supportedDurations: [5, 10, 15],
};

/**
 * ComfyUI Workflow 默认视频参数
 */
export const DEFAULT_VIDEO_PARAMS_COMFYUI: VideoModelParams = {
  mode: 'comfyui',
  defaultAspectRatio: '16:9',
  supportedAspectRatios: ['16:9', '9:16', '1:1'],
  defaultDuration: 5,
  supportedDurations: [5, 10, 15],
  workflowName: 'video-workflow',
  steps: 20,
};

/**
 * 默认配音模型参数
 */
export const DEFAULT_AUDIO_PARAMS: AudioModelParams = {
  defaultVoice: 'alloy',
  outputFormat: 'wav',
};

// ============================================
// 内置模型定义
// ============================================

/**
 * 本地推理提供商（无需 API Key）
 */
export const LOCAL_PROVIDER_IDS = ['comfyui-local', 'indextts-local'] as const;

export type LocalProviderId = (typeof LOCAL_PROVIDER_IDS)[number];

export const isLocalProviderId = (providerId?: string | null): boolean =>
  !!providerId && (LOCAL_PROVIDER_IDS as readonly string[]).includes(providerId);

/**
 * 内置对话模型列表
 */
export const BUILTIN_CHAT_MODELS: ChatModelDefinition[] = [
  {
    id: 'qwen3-8-27b-fp8-vllm',
    apiModel: 'Qwen/Qwen3.8-27B-FP8',
    name: 'Qwen3.8-27B-FP8 (vLLM 本地)',
    type: 'chat',
    providerId: 'vllm-local',
    description: 'vLLM OpenAI 兼容接口，支持长上下文与推理；参考 OpenClaw vllm 配置',
    isBuiltIn: true,
    isEnabled: true,
    params: { ...DEFAULT_CHAT_PARAMS, temperature: 0.7, maxTokens: 32768 },
  },
  {
    id: 'gpt-5.2',
    name: 'GPT-5.2',
    type: 'chat',
    providerId: 'default',
    description: 'GPT-5 系列前沿模型：推理、编码与智能体任务表现更强，适合复杂工作流与高难度任务',
    isBuiltIn: true,
    isEnabled: true,
    params: { ...DEFAULT_CHAT_PARAMS },
  },
  {
    id: 'gpt-5.1',
    name: 'GPT-5.1',
    type: 'chat',
    providerId: 'default',
    description: '旗舰通用推理：指令遵循与工具调用稳定，适合长文本分析、结构化提取与日常生产任务',
    isBuiltIn: true,
    isEnabled: true,
    params: { ...DEFAULT_CHAT_PARAMS },
  },
 
  {
    id: 'gpt-5.4',
    name: 'GPT-5.4',
    type: 'chat',
    providerId: 'default',
    description: '高性价比稳健模型：指令遵循与代码能力强，支持超长上下文，适合规模化文本处理',
    isBuiltIn: true,
    isEnabled: true,
    params: { ...DEFAULT_CHAT_PARAMS },
  },
  {
    id: 'gpt-5.5',
    name: 'GPT-5.5',
    type: 'chat',
    providerId: 'default',
    description: '新一代旗舰模型：推理与生成能力更强，适合高质量剧本与分镜生成',
    isBuiltIn: true,
    isEnabled: true,
    params: { ...DEFAULT_CHAT_PARAMS },
  },
  {
    id: 'claude-sonnet-4-6',
    name: 'Claude Sonnet 4.6',
    type: 'chat',
    providerId: 'default',
    description: '速度与智能平衡优秀：支持自适应思考，适合代码、工具调用与常规 agent 场景',
    isBuiltIn: true,
    isEnabled: true,
    params: { ...DEFAULT_CHAT_PARAMS },
  },
  {
    id: 'claude-opus-4-6-20260205',
    name: 'Claude Opus 4.6',
    type: 'chat',
    providerId: 'default',
    description: 'Claude 顶级智能：复杂推理、长流程 agent 与高难编码任务表现更强，适合高质量优先场景',
    isBuiltIn: true,
    isEnabled: true,
    params: { ...DEFAULT_CHAT_PARAMS },
  },
  {
    id: 'claude-sonnet-4-5-20250929',
    name: 'Claude Sonnet 4.5',
    type: 'chat',
    providerId: 'default',
    description: '均衡长文模型：日常编码、分析与内容整理稳定，适合高频生产与成本敏感任务',
    isBuiltIn: true,
    isEnabled: true,
    params: { ...DEFAULT_CHAT_PARAMS },
  },
  {
    id: 'gemini-3.1-pro-preview',
    name: 'Gemini 3.1 Pro Preview',
    type: 'chat',
    providerId: 'default',
    description: '多模态预览模型：支持超长上下文与复杂推理，适合文档理解、研究分析与工具增强流程',
    isBuiltIn: true,
    isEnabled: true,
    params: { ...DEFAULT_CHAT_PARAMS },
  },
];

/**
 * 内置图片模型列表
 */
export const BUILTIN_IMAGE_MODELS: ImageModelDefinition[] = [
  {
    id: 'gemini-3-pro-image-preview',
    name: 'Gemini 3 Pro Image(Nano Banana Pro)',
    type: 'image',
    providerId: 'default',
    endpoint: '/v1beta/models/gemini-3-pro-image-preview:generateContent',
    description: '旗舰画质与高一致性：擅长复杂构图、精细文字与参考图控制，适合高要求角色与品牌场景（价格较高）',
    isBuiltIn: true,
    isEnabled: true,
    params: { ...DEFAULT_IMAGE_PARAMS },
  },
  {
    id: 'gemini-3.1-flash-image-preview',
    name: 'Gemini 3.1 Flash Image Preview(Nano Banana 2)',
    type: 'image',
    providerId: 'default',
    endpoint: '/v1beta/models/gemini-3.1-flash-image-preview:generateContent',
    description: '高性价比高速模型：为快速交互和高吞吐生成优化，适合批量出图与频繁迭代（成本低于 Pro）',
    isBuiltIn: true,
    isEnabled: true,
    params: { ...DEFAULT_IMAGE_PARAMS },
  },
  {
    id: 'gpt-image-1.5',
    apiModel: 'gpt-image-1.5',
    name: 'GPT Image 1.5',
    type: 'image',
    providerId: 'default',
    endpoint: '/v1/images/generations',
    description: '高质量通用模型：提示词遵循和文本渲染表现优秀，适合角色与场景创作；参考一致性弱于 Nano Banana Pro',
    isBuiltIn: true,
    isEnabled: true,
    params: { ...DEFAULT_IMAGE_PARAMS_OPENAI },
  },
  {
    id: 'gpt-image-1-mini',
    apiModel: 'gpt-image-1-mini',
    name: 'GPT Image 1 Mini',
    type: 'image',
    providerId: 'default',
    endpoint: '/v1/images/generations',
    description: '低成本模型：支持文图输入与图片输出，适合草图预览和大批量试错（细节与一致性弱于 GPT Image 1.5）',
    isBuiltIn: true,
    isEnabled: true,
    params: { ...DEFAULT_IMAGE_PARAMS_OPENAI },
  },
  {
    id: 'comfyui-flux-dev-fp8',
    apiModel: 'flux2-klein-9b',
    name: 'ComfyUI FLUX.2 Klein 9B (本地)',
    type: 'image',
    providerId: 'comfyui-local',
    description:
      '默认定妆：FLUX.2 Klein 9B T2I；关键帧：FLUX.2 Klein 9B Image Edit（最多 4 张参考）；造型九宫格：Qwen Edit turnaround。工作流读取 back-end/workflows/<名称>.json。',
    isBuiltIn: true,
    isEnabled: true,
    params: {
      ...DEFAULT_IMAGE_PARAMS_COMFYUI,
      workflowName: 'image_flux2_text_to_image_9b',
      steps: 20,
      keyframeWorkflowName: 'image_flux2_klein_image_edit_9b_base',
      keyframeSteps: 20,
      turnaroundWorkflowName: 'qwen_image_edit_2511_fp8_character_turnaround',
      turnaroundSteps: 4,
    },
  },
  {
    id: 'comfyui-flux-dev-fp8-legacy',
    apiModel: 'flux1-dev-fp8',
    name: 'ComfyUI Flux Dev1 FP8 (本地·备用)',
    type: 'image',
    providerId: 'comfyui-local',
    description: 'Flux1-Dev FP8 文生图（定妆）；关键帧可配 Qwen Edit FLF；九宫格走 Qwen Edit turnaround。',
    isBuiltIn: true,
    isEnabled: false,
    params: {
      ...DEFAULT_IMAGE_PARAMS_COMFYUI,
      workflowName: 'flux_dev1_fp8_text_to_image',
      steps: 20,
      keyframeWorkflowName: 'image_qwen_image_edit_2511_flf',
      keyframeSteps: 40,
      turnaroundWorkflowName: 'qwen_image_edit_2511_fp8_character_turnaround',
      turnaroundSteps: 4,
    },
  },
];

/**
 * 内置视频模型列表
 */
export const BUILTIN_VIDEO_MODELS: VideoModelDefinition[] = [
  {
    id: 'veo_3_1-fast',
    name: 'Veo 3.1 Fast',
    type: 'video',
    providerId: 'default',
    endpoint: '/v1/videos',
    description: '异步模式，支持横屏/竖屏、支持单图和首尾帧，固定 8 秒时长,价格便宜速度快',
    isBuiltIn: true,
    isEnabled: true,
    params: { ...DEFAULT_VIDEO_PARAMS_VEO_FAST },
  },
  {
    id: 'sora-2',
    name: 'Sora-2',
    type: 'video',
    providerId: 'default',
    endpoint: '/v1/videos',
    description: 'OpenAI Sora 视频生成，异步模式，支持多种时长',
    isBuiltIn: true,
    isEnabled: true,
    params: { ...DEFAULT_VIDEO_PARAMS_SORA },
  },
  {
    id: 'doubao-seedance-1-5-pro',
    apiModel: 'doubao-seedance-1-5-pro',
    name: 'Doubao Seedance 1.5 Pro (内置)',
    type: 'video',
    providerId: 'default',
    endpoint: '/v1/videos',
    description: 'Async video mode via /v1/videos with Sora-2-compatible request format, supporting 4/8/12 seconds.',
    isBuiltIn: true,
    isEnabled: true,
    params: { ...DEFAULT_VIDEO_PARAMS_SORA },
  },
  {
    id: 'doubao-seedance-1-5-pro-251215',
    apiModel: 'doubao-seedance-1-5-pro-251215',
    name: 'Doubao Seedance 1.5 Pro',
    type: 'video',
    providerId: 'volcengine',
    endpoint: '/api/v3/contents/generations/tasks',
    description: '火山引擎异步任务模式（create task + poll task），支持 4/8/12 秒',
    isBuiltIn: true,
    isEnabled: true,
    params: { ...DEFAULT_VIDEO_PARAMS_DOUBAO_SEEDANCE_1_5 },
  },
  {
    id: 'doubao-seedance-2-0-260128',
    apiModel: 'doubao-seedance-2-0-260128',
    name: 'Doubao Seedance 2.0',
    type: 'video',
    providerId: 'volcengine',
    endpoint: '/api/v3/contents/generations/tasks',
    description: '火山引擎异步任务模式（create task + poll task），支持 5/10/15 秒',
    isBuiltIn: true,
    isEnabled: true,
    params: { ...DEFAULT_VIDEO_PARAMS_DOUBAO_SEEDANCE_2_0 },
  },
  {
    id: 'comfyui-minimax-h3-flft2v',
    apiModel: 'video_minimax_h3_flft2v',
    name: 'ComfyUI MiniMax H3 FLF2V (本地)',
    type: 'video',
    providerId: 'comfyui-local',
    description: '本地 MiniMax H3 首尾帧图生视频，原生立体声音频；768p 基线，24fps，prompt 内描述对话/音效',
    isBuiltIn: true,
    isEnabled: true,
    params: {
      ...DEFAULT_VIDEO_PARAMS_COMFYUI,
      workflowName: 'video_minimax_h3_flft2v',
      defaultDuration: 5,
      supportedDurations: [5, 10, 15],
      supportedAspectRatios: ['16:9', '9:16'],
      defaultAspectRatio: '16:9',
      supportsEndFrame: true,
      supportsAudio: false,
      steps: 20,
    },
  },
  {
    id: 'comfyui-ltx2-5-flf2v',
    apiModel: 'video_ltx2_5_flf2v',
    name: 'ComfyUI LTX 2.5 FLF2V (本地)',
    type: 'video',
    providerId: 'comfyui-local',
    description: '本地 ComfyUI LTX 2.5 首尾帧图生视频，内置音视频同步；24fps，支持首帧/尾帧',
    isBuiltIn: true,
    isEnabled: true,
    params: {
      ...DEFAULT_VIDEO_PARAMS_COMFYUI,
      workflowName: 'video_ltx2_5_flf2v',
      defaultDuration: 5,
      supportedDurations: [5, 10, 15],
      supportedAspectRatios: ['16:9', '9:16'],
      defaultAspectRatio: '16:9',
      supportsEndFrame: true,
      supportsAudio: false,
    },
  },
  {
    id: 'comfyui-ltx2-3-i2v',
    apiModel: 'video_ltx2_3_i2v',
    name: 'ComfyUI LTX 2.3 I2V (本地)',
    type: 'video',
    providerId: 'comfyui-local',
    description: '本地 ComfyUI LTX 2.3 单图生视频（仅首帧，无音频）；工作流默认 25fps',
    isBuiltIn: true,
    isEnabled: true,
    params: {
      ...DEFAULT_VIDEO_PARAMS_COMFYUI,
      workflowName: 'video_ltx2_3_i2v',
      defaultDuration: 5,
      supportedDurations: [5, 10, 15],
      supportedAspectRatios: ['16:9', '9:16'],
      defaultAspectRatio: '16:9',
      supportsEndFrame: false,
      supportsAudio: false,
    },
  },
  {
    id: 'comfyui-ltx2-3-ia2v-flf2v',
    apiModel: 'video_ltx2_3_ia2v_flf2v',
    name: 'ComfyUI LTX 2.3 IA2V+首尾帧 (本地)',
    type: 'video',
    providerId: 'comfyui-local',
    description: '本地 ComfyUI LTX 2.3 图生视频+音频：支持首帧/尾帧与镜头配音；默认 24fps，时长按秒注入',
    isBuiltIn: true,
    isEnabled: false,
    params: {
      ...DEFAULT_VIDEO_PARAMS_COMFYUI,
      workflowName: 'video_ltx2_3_ia2v_flf2v',
      defaultDuration: 5,
      supportedDurations: [5, 10, 15],
      supportedAspectRatios: ['16:9', '9:16'],
      defaultAspectRatio: '16:9',
      supportsEndFrame: true,
      supportsAudio: true,
    },
  },
];

/**
 * 内置配音模型列表
 */
export const BUILTIN_AUDIO_MODELS: AudioModelDefinition[] = [
  {
    id: 'indextts-local',
    apiModel: 'indextts',
    name: 'IndexTTS (本地 OpenAI Speech)',
    type: 'audio',
    providerId: 'indextts-local',
    endpoint: '/v1/audio/speech',
    description: 'OpenAI 兼容 /v1/audio/speech，参考 OpenClaw IndexTTS 配置（opus + speakerVoice）',
    isBuiltIn: true,
    isEnabled: true,
    params: {
      defaultVoice: 'EL_Danielle_Gentle_Engaging',
      outputFormat: 'opus',
      speechInputMode: 'plain',
      timeoutMs: 120000,
    },
  },
  {
    id: 'gpt-audio-1.5',
    apiModel: 'gpt-audio-1.5',
    name: 'GPT Audio 1.5',
    type: 'audio',
    providerId: 'default',
    endpoint: '/v1/chat/completions',
    description: '高质量配音模型，适合情绪表达与影视旁白',
    isBuiltIn: true,
    isEnabled: true,
    params: { ...DEFAULT_AUDIO_PARAMS },
  },
  {
    id: 'gpt-audio-mini',
    apiModel: 'gpt-audio-mini',
    name: 'GPT Audio Mini',
    type: 'audio',
    providerId: 'default',
    endpoint: '/v1/chat/completions',
    description: '轻量配音模型，速度更快，适合快速迭代',
    isBuiltIn: true,
    isEnabled: true,
    params: { ...DEFAULT_AUDIO_PARAMS },
  },
];

/**
 * 内置提供商列表
 */
export const BUILTIN_PROVIDERS: ModelProvider[] = [
  {
    id: 'default',
    name: 'OpenAI 兼容 API',
    baseUrl: '',
    isBuiltIn: true,
    isDefault: true,
  },
  {
    id: 'volcengine',
    name: 'Volcengine Ark',
    baseUrl: 'https://ark.cn-beijing.volces.com',
    isBuiltIn: true,
    isDefault: false,
  },
  {
    id: 'vllm-local',
    name: 'vLLM (本地 OpenAI API)',
    baseUrl: '',
    isBuiltIn: true,
    isDefault: false,
  },
  {
    id: 'indextts-local',
    name: 'IndexTTS (本地 Speech API)',
    baseUrl: '',
    isBuiltIn: true,
    isDefault: false,
  },
  {
    id: 'comfyui-local',
    name: 'ComfyUI (本地)',
    baseUrl: '',
    isBuiltIn: true,
    isDefault: false,
  },
];

/**
 * 所有内置模型
 */
export const ALL_BUILTIN_MODELS: ModelDefinition[] = [
  ...BUILTIN_CHAT_MODELS,
  ...BUILTIN_IMAGE_MODELS,
  ...BUILTIN_VIDEO_MODELS,
  ...BUILTIN_AUDIO_MODELS,
];

/**
 * 默认激活模型
 */
export const DEFAULT_ACTIVE_MODELS: ActiveModels = {
  chat: 'qwen3-8-27b-fp8-vllm',
  image: 'comfyui-flux-dev-fp8',
  video: 'comfyui-minimax-h3-flft2v',
  audio: 'indextts-local',
};
