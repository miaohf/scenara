import { AspectRatio, ImageApiFormat, ImageModelDefinition, ImageResolution } from '../types/model';

const DEFAULT_GEMINI_IMAGE_ENDPOINT_TEMPLATE = '/v1beta/models/{model}:generateContent';
const DEFAULT_OPENAI_IMAGE_ENDPOINT = '/v1/images/generations';
const DEFAULT_VOLCENGINE_IMAGE_ENDPOINT = '/api/v3/images/generations';

export const getImageApiFormat = (
  model?: Partial<ImageModelDefinition> | null
): ImageApiFormat => {
  const explicitFormat = model?.params?.apiFormat;
  if (
    explicitFormat === 'gemini' ||
    explicitFormat === 'openai' ||
    explicitFormat === 'comfyui' ||
    explicitFormat === 'cursor-sdk' ||
    explicitFormat === 'cursor-acp'
  ) {
    return explicitFormat;
  }

  const endpoint = (model?.endpoint || '').toLowerCase();
  if (endpoint.includes('/prompt') || endpoint.includes('/history')) {
    return 'comfyui';
  }
  if (endpoint.includes('/images/generations') || endpoint.includes('/images/edits')) {
    return 'openai';
  }

  const identity = `${model?.id || ''} ${model?.apiModel || ''} ${model?.name || ''}`.toLowerCase();
  if (identity.includes('gpt-image') || identity.includes('seedream')) {
    return 'openai';
  }

  return 'gemini';
};

/** 火山方舟 Seedream：走 /api/v3/images/generations，参考图用 JSON image 字段，勿切 edits。 */
export const isVolcengineSeedreamImageModel = (
  model?: Partial<ImageModelDefinition> | null
): boolean => {
  if (!model) return false;
  if (model.providerId === 'volcengine') return true;
  const endpoint = (model.endpoint || '').toLowerCase();
  if (endpoint.includes('/api/v3/images')) return true;
  const identity = `${model.id || ''} ${model.apiModel || ''} ${model.name || ''}`.toLowerCase();
  return identity.includes('seedream');
};

/**
 * API易 / OpenAI Images 参数档位：
 * - official：官转按量（size + quality + output_format）
 * - per_request_all：按次 *-all（尺寸写进 prompt，勿传 size/quality/n）
 * - per_request_vip：按次 *-vip（可传 size，勿传 n；quality 可选）
 */
export type OpenAiImageParamProfile = 'official' | 'per_request_all' | 'per_request_vip';

export const getOpenAiImageParamProfile = (
  model?: Partial<ImageModelDefinition> | null
): OpenAiImageParamProfile => {
  const identity = `${model?.id || ''} ${model?.apiModel || ''}`.toLowerCase();
  if (/(^|[^a-z])all([^a-z]|$)/.test(identity) || identity.includes('-all')) {
    return 'per_request_all';
  }
  if (identity.includes('-vip') || identity.endsWith('vip')) {
    return 'per_request_vip';
  }
  return 'official';
};

/** 按次 *-all：把画幅写进 prompt 前缀（该渠道 size 字段无效）。 */
export const prependAspectHintForPerRequestAll = (
  prompt: string,
  aspectRatio: AspectRatio,
  resolution?: ImageResolution | string
): string => {
  const trimmed = (prompt || '').trim();
  const tier = String(resolution || '1K').trim().toUpperCase();
  const sizeLabel =
    tier === '4K' ? '4K' : tier === '2K' ? '2K' : tier.includes('X') ? tier.toLowerCase() : '1K';
  const ratioHint =
    aspectRatio === '9:16'
      ? `竖版 9:16 ${sizeLabel}`
      : aspectRatio === '1:1'
        ? `方形 1:1 ${sizeLabel}`
        : `横版 16:9 ${sizeLabel}`;
  if (!trimmed) return `${ratioHint} 电影画幅`;
  if (/横版|竖版|方形|16:9|9:16|1:1|\d+\s*[xX×]\s*\d+/.test(trimmed)) {
    return trimmed;
  }
  return `${ratioHint} 电影画幅，${trimmed}`;
};

/**
 * API易 *-vip 30 档常用 size（小写 x）。
 * 1344x768 不在官方表内，映射到最接近的 1536x1024。
 */
export const mapAspectRatioToApiyiVipImageSize = (
  aspectRatio: AspectRatio,
  resolution: ImageResolution | string = '2K'
): string => {
  const raw = String(resolution || '2K').trim();
  const exact = raw.match(/^(\d+)\s*[xX×]\s*(\d+)$/);
  if (exact) {
    const width = Number(exact[1]);
    const height = Number(exact[2]);
    // 对齐 MiniMax H3 的精确像素：vip 表内用 1536x1024 替代 1344x768
    if (
      (width === 1344 && height === 768) ||
      (width === 768 && height === 1344)
    ) {
      return aspectRatio === '9:16' ? '1024x1536' : '1536x1024';
    }
    if (aspectRatio === '9:16') return `${height}x${width}`;
    if (aspectRatio === '1:1') {
      const side = Math.min(width, height);
      return `${side}x${side}`;
    }
    return `${width}x${height}`;
  }

  const tier = raw.toUpperCase();
  if (tier === '4K') {
    switch (aspectRatio) {
      case '9:16':
        return '2160x3840';
      case '1:1':
        return '2048x2048';
      case '16:9':
      default:
        return '3840x2160';
    }
  }
  if (tier === '1K') {
    switch (aspectRatio) {
      case '9:16':
        return '1024x1536';
      case '1:1':
        return '1024x1024';
      case '16:9':
      default:
        return '1536x1024';
    }
  }
  // 2K / 默认
  switch (aspectRatio) {
    case '9:16':
      return '1152x2048';
    case '1:1':
      return '2048x2048';
    case '16:9':
    default:
      return '2048x1152';
  }
};

export const getDefaultImageEndpoint = (
  apiFormat: ImageApiFormat,
  apiModel: string,
  options?: { volcengine?: boolean }
): string => {
  if (options?.volcengine) {
    return DEFAULT_VOLCENGINE_IMAGE_ENDPOINT;
  }
  if (apiFormat === 'openai') {
    return DEFAULT_OPENAI_IMAGE_ENDPOINT;
  }
  if (apiFormat === 'comfyui') {
    return '';
  }

  return DEFAULT_GEMINI_IMAGE_ENDPOINT_TEMPLATE.replace('{model}', apiModel);
};

export const resolveOpenAiImageEndpoint = (
  endpoint: string | undefined,
  hasReferenceImages: boolean,
  options?: { keepGenerationsForReferences?: boolean }
): string => {
  const normalized = (endpoint || DEFAULT_OPENAI_IMAGE_ENDPOINT).trim() || DEFAULT_OPENAI_IMAGE_ENDPOINT;
  if (!hasReferenceImages || options?.keepGenerationsForReferences) {
    return normalized;
  }

  if (normalized.includes('/images/edits')) {
    return normalized;
  }

  if (normalized.includes('/images/generations')) {
    return normalized.replace('/images/generations', '/images/edits');
  }

  return normalized;
};

/**
 * gpt-image / OpenAI Images 尺寸映射。
 * - 精确像素（如 1344x768）：原样使用，竖屏交换宽高
 * - 档位对齐 API易预设：1K≈H3 画布、2K=2048x1152、4K=3840x2160
 */
export const mapAspectRatioToOpenAiImageSize = (
  aspectRatio: AspectRatio,
  resolution: ImageResolution | string = '1344x768'
): string => {
  const raw = String(resolution || '1344x768').trim();
  const exact = raw.match(/^(\d+)\s*[xX×]\s*(\d+)$/);
  if (exact) {
    const width = Number(exact[1]);
    const height = Number(exact[2]);
    if (aspectRatio === '9:16') return `${height}x${width}`;
    if (aspectRatio === '1:1') {
      const side = Math.min(width, height);
      return `${side}x${side}`;
    }
    return `${width}x${height}`;
  }

  const tier = raw.toUpperCase();
  if (tier === '4K') {
    switch (aspectRatio) {
      case '9:16':
        return '2160x3840';
      case '1:1':
        return '2048x2048';
      case '16:9':
      default:
        return '3840x2160';
    }
  }
  if (tier === '2K') {
    switch (aspectRatio) {
      case '9:16':
        return '1152x2048';
      case '1:1':
        return '2048x2048';
      case '16:9':
      default:
        return '2048x1152';
    }
  }
  // 1K / 默认：与 MiniMax H3 画布对齐
  switch (aspectRatio) {
    case '9:16':
      return '768x1344';
    case '1:1':
      return '1024x1024';
    case '16:9':
    default:
      return '1344x768';
  }
};

/**
 * Seedream size：
 * - 精确像素（如 1344x768）：按选项传给 API，9:16 时交换宽高
 * - 档位 1K/2K/4K：按画幅映射到推荐像素
 */
export const mapAspectRatioToSeedreamImageSize = (
  aspectRatio: AspectRatio,
  resolution: ImageResolution | string = '2K'
): string => {
  const raw = String(resolution || '2K').trim();
  const exact = raw.match(/^(\d+)\s*[xX×]\s*(\d+)$/);
  if (exact) {
    const width = Number(exact[1]);
    const height = Number(exact[2]);
    if (aspectRatio === '9:16') return `${height}x${width}`;
    if (aspectRatio === '1:1') {
      const side = Math.min(width, height);
      return `${side}x${side}`;
    }
    return `${width}x${height}`;
  }

  const tier = raw.toUpperCase();
  if (tier === '4K') {
    switch (aspectRatio) {
      case '9:16':
        return '2304x4096';
      case '1:1':
        return '4096x4096';
      case '16:9':
      default:
        return '4096x2304';
    }
  }
  if (tier === '1K') {
    switch (aspectRatio) {
      case '9:16':
        return '1024x1792';
      case '1:1':
        return '1024x1024';
      case '16:9':
      default:
        return '1792x1024';
    }
  }
  // 2K default
  switch (aspectRatio) {
    case '9:16':
      return '1440x2560';
    case '1:1':
      return '2048x2048';
    case '16:9':
    default:
      return '2560x1440';
  }
};
