/**
 * 图片模型适配器
 * 处理 Gemini Image API
 */

import { ImageModelDefinition, ImageGenerateOptions, AspectRatio } from '../../types/model';
import { getApiKeyForModel, getApiBaseUrlForModel, getActiveImageModel } from '../modelRegistry';
import {
  getImageApiFormat,
  getDefaultImageEndpoint,
  resolveOpenAiImageEndpoint,
  mapAspectRatioToOpenAiImageSize,
} from '../imageModelUtils';
import { ApiKeyError } from './chatAdapter';
import { resolveComfyApiBaseUrl, buildComfyApiUrl } from '../urlUtils';
import { isApiAiMode, apiCallImage, apiCallComfyImage, fetchComfyWorkflowTemplate } from '../aiApiAdapter';

/**
 * 重试操作
 */
const retryOperation = async <T>(
  operation: () => Promise<T>,
  maxRetries: number = 3,
  delay: number = 2000
): Promise<T> => {
  let lastError: Error | null = null;
  
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await operation();
    } catch (error: any) {
      lastError = error;
      const status = error?.status;
      // 400/401/403 错误不重试
      if (status === 400 ||
          status === 401 ||
          status === 403 ||
          error.message?.includes('400') || 
          error.message?.includes('401') || 
          error.message?.includes('403')) {
        throw error;
      }
      if (i < maxRetries - 1) {
        await new Promise(resolve => setTimeout(resolve, delay * (i + 1)));
      }
    }
  }
  
  throw lastError;
};

const parseHttpErrorBody = async (res: Response): Promise<string> => {
  let errorMessage = `HTTP 错误: ${res.status}`;
  try {
    const errorData = await res.json();
    errorMessage = errorData.error?.message || errorMessage;
  } catch (e) {
    const errorText = await res.text();
    if (errorText) errorMessage = errorText;
  }
  return errorMessage;
};

const buildImageApiError = (status: number, backendMessage?: string): Error => {
  const detail = backendMessage?.trim();
  const withDetail = (message: string): string => (detail ? `${message}（接口信息：${detail}）` : message);

  let message: string;
  if (status === 400) {
    message = withDetail('图片生成失败：提示词可能被风控拦截，请修改提示词后重试。');
  } else if (status === 500 || status === 503) {
    message = withDetail('图片生成失败：服务器繁忙，请稍后重试。');
  } else if (status === 429) {
    message = withDetail('图片生成失败：请求过于频繁，请稍后再试。');
  } else {
    message = withDetail(`图片生成失败：接口请求异常（HTTP ${status}）。`);
  }

  const err: any = new Error(message);
  err.status = status;
  return err;
};

const MAX_IMAGE_PROMPT_CHARS = 5000;
const OPENAI_IMAGE_QUALITY = 'medium';
const OPENAI_IMAGE_OUTPUT_FORMAT = 'png';
const OPENAI_IMAGE_OUTPUT_COMPRESSION = 100;
const COMFYUI_POLL_INTERVAL_MS = 1000;
const COMFYUI_MAX_POLLS = 180;
/** 尾帧以首帧为底图：需保留身份/场景，同时允许构图与动作明显变化 */
const COMFYUI_IMG2IMG_DENOISE_CONTINUITY = 0.65;
/** 首帧以角色参考图为底图：较高 denoise 以兼顾身份锁定与分镜差异 */
const COMFYUI_IMG2IMG_DENOISE_CHARACTER = 0.78;

const dataUrlToBlob = (dataUrl: string): Blob => {
  const match = dataUrl.match(/^data:([a-zA-Z0-9.+/-]+);base64,(.+)$/);
  if (!match) {
    throw new Error('ComfyUI 参考图格式无效，请重新上传后重试。');
  }
  const mimeType = match[1];
  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType });
};

const uploadComfyImage = async (apiBase: string, imageDataUrl: string, filename: string): Promise<string> => {
  const blob = dataUrlToBlob(imageDataUrl);
  const formData = new FormData();
  formData.append('image', blob, filename);
  formData.append('overwrite', 'true');
  const uploadUrl = buildComfyApiUrl(apiBase, '/upload/image');
  console.info('[ComfyUI Image] Upload reference image:', uploadUrl, filename);
  const response = await fetch(uploadUrl, {
    method: 'POST',
    body: formData,
  });
  if (!response.ok) {
    const backendMessage = await parseHttpErrorBody(response);
    throw new Error(`ComfyUI 参考图上传失败：${backendMessage}`);
  }
  const result = await response.json();
  return result?.name || filename;
};

const resizeDataUrlToSize = async (
  dataUrl: string,
  targetWidth: number,
  targetHeight: number
): Promise<string> =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('无法创建 canvas 上下文'));
        return;
      }
      const scale = Math.max(targetWidth / img.width, targetHeight / img.height);
      const scaledWidth = img.width * scale;
      const scaledHeight = img.height * scale;
      const offsetX = (targetWidth - scaledWidth) / 2;
      const offsetY = (targetHeight - scaledHeight) / 2;
      ctx.drawImage(img, offsetX, offsetY, scaledWidth, scaledHeight);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => reject(new Error('参考图加载失败'));
    img.src = dataUrl.startsWith('data:') ? dataUrl : `data:image/png;base64,${dataUrl}`;
  });

const resolveImg2ImgWorkflowName = (workflowName: string): string => {
  const trimmed = workflowName.trim();
  if (trimmed.endsWith('-img2img') || trimmed.endsWith('_img2img')) {
    return trimmed;
  }
  const baseName = trimmed.endsWith('.json') ? trimmed.slice(0, -5) : trimmed;
  return `${baseName}-img2img`;
};

const pickComfyImg2ImgSource = (
  continuityReferenceImage?: string,
  characterReferenceImage?: string
): { source?: string; mode: 'continuity' | 'character' | 'none' } => {
  if (continuityReferenceImage) {
    return { source: continuityReferenceImage, mode: 'continuity' };
  }
  if (characterReferenceImage) {
    return { source: characterReferenceImage, mode: 'character' };
  }
  return { mode: 'none' };
};

const resolveComfyImg2ImgDenoise = (
  mode: ReturnType<typeof pickComfyImg2ImgSource>['mode'],
  explicit?: number
): number => {
  if (typeof explicit === 'number' && explicit > 0 && explicit <= 1) {
    return explicit;
  }
  if (mode === 'continuity') return COMFYUI_IMG2IMG_DENOISE_CONTINUITY;
  if (mode === 'character') return COMFYUI_IMG2IMG_DENOISE_CHARACTER;
  return 1;
};

const truncatePromptToMaxChars = (
  input: string,
  maxChars: number
): { text: string; wasTruncated: boolean; originalLength: number } => {
  const chars = Array.from(input);
  const originalLength = chars.length;
  if (originalLength <= maxChars) {
    return { text: input, wasTruncated: false, originalLength };
  }
  return {
    text: chars.slice(0, maxChars).join(''),
    wasTruncated: true,
    originalLength,
  };
};

const dataUrlToImageFile = (dataUrl: string, filename: string): File | null => {
  const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) return null;

  try {
    const mimeType = match[1];
    const binary = atob(match[2]);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new File([bytes], filename, { type: mimeType });
  } catch {
    return null;
  }
};

const extractImageFromOpenAiResponse = (response: any): string | null => {
  const first = response?.data?.[0];
  if (!first) return null;
  if (first.b64_json) {
    const format = first.output_format || OPENAI_IMAGE_OUTPUT_FORMAT;
    return `data:image/${format};base64,${first.b64_json}`;
  }
  if (first.url) {
    return String(first.url);
  }
  return null;
};

const blobToDataUrl = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Failed to read image blob.'));
    reader.readAsDataURL(blob);
  });

const mapAspectRatioToComfySize = (aspectRatio: AspectRatio): { width: number; height: number } => {
  switch (aspectRatio) {
    case '9:16':
      return { width: 576, height: 1024 };
    case '1:1':
      return { width: 1024, height: 1024 };
    case '16:9':
    default:
      return { width: 1024, height: 576 };
  }
};

const loadComfyWorkflowTemplate = async (workflowName: string): Promise<any> => {
  console.info('[ComfyUI Image] Loading workflow template from backend:', workflowName);
  return fetchComfyWorkflowTemplate(workflowName);
};

const patchComfyWorkflow = (
  workflow: any,
  options: {
    prompt: string;
    negativePrompt?: string;
    width: number;
    height: number;
    seed: number;
    steps: number;
    referenceImageName?: string;
    denoise?: number;
  }
): any => {
  const patched = structuredClone(workflow);
  const nodes = patched?.prompt || patched;
  if (!nodes || typeof nodes !== 'object') {
    throw new Error('ComfyUI 工作流模板格式无效：需要 API Format JSON。');
  }

  let promptPatched = false;
  let referenceImagePatched = false;
  Object.values(nodes).forEach((node: any) => {
    const inputs = node?.inputs;
    if (!inputs || typeof inputs !== 'object') return;
    const classType = String(node.class_type || '').toLowerCase();
    const title = String(node._meta?.title || '').toLowerCase();
    const isNegative = classType.includes('clip') && title.includes('negative');

    if (
      title === 'prompt' &&
      classType === 'primitivestringmultiline' &&
      typeof inputs.value === 'string'
    ) {
      inputs.value = options.prompt;
      promptPatched = true;
    }

    if (!isNegative && 'text' in inputs && typeof inputs.text === 'string' && classType.includes('clip')) {
      inputs.text = options.prompt;
      promptPatched = true;
    }
    if (!isNegative && 'prompt' in inputs && typeof inputs.prompt === 'string') {
      inputs.prompt = options.prompt;
      promptPatched = true;
    }
    if (!isNegative && 'positive' in inputs && typeof inputs.positive === 'string') {
      inputs.positive = options.prompt;
      promptPatched = true;
    }
    if (classType === 'cliptextencodeflux') {
      if (typeof inputs.clip_l === 'string') {
        inputs.clip_l = options.prompt;
        promptPatched = true;
      }
      if (typeof inputs.t5xxl === 'string') {
        inputs.t5xxl = options.prompt;
        promptPatched = true;
      }
    }

    if (options.negativePrompt) {
      if (isNegative && 'text' in inputs && typeof inputs.text === 'string') {
        inputs.text = options.negativePrompt;
      } else if (title.includes('negative') && 'text' in inputs && typeof inputs.text === 'string') {
        inputs.text = options.negativePrompt;
      }
    }

    if ('width' in inputs && typeof inputs.width === 'number') inputs.width = options.width;
    if ('height' in inputs && typeof inputs.height === 'number') inputs.height = options.height;
    if ('seed' in inputs && typeof inputs.seed === 'number') inputs.seed = options.seed;
    if ('noise_seed' in inputs && typeof inputs.noise_seed === 'number') inputs.noise_seed = options.seed;
    if ('steps' in inputs && typeof inputs.steps === 'number') inputs.steps = options.steps;
    if (typeof options.denoise === 'number' && 'denoise' in inputs && typeof inputs.denoise === 'number') {
      inputs.denoise = options.denoise;
    }

    if (
      options.referenceImageName &&
      classType === 'loadimage' &&
      'image' in inputs &&
      typeof inputs.image === 'string' &&
      (title.includes('reference') || title.includes('load image') || !referenceImagePatched)
    ) {
      inputs.image = options.referenceImageName;
      referenceImagePatched = true;
    }
  });

  if (!promptPatched) {
    throw new Error('ComfyUI 工作流模板中没有找到可替换的 prompt 文本节点。');
  }

  return nodes;
};

const buildComfyViewUrl = (apiBase: string, image: any): string => {
  const params = new URLSearchParams();
  params.set('filename', String(image.filename || ''));
  if (image.subfolder) params.set('subfolder', String(image.subfolder));
  if (image.type) params.set('type', String(image.type));
  const baseViewUrl = buildComfyApiUrl(apiBase, '/view');
  const separator = baseViewUrl.includes('?') ? '&' : '?';
  return `${baseViewUrl}${separator}${params.toString()}`;
};

const callComfyImageApi = async (
  apiBase: string,
  workflowName: string,
  options: {
    prompt: string;
    negativePrompt?: string;
    aspectRatio: AspectRatio;
    steps: number;
    referenceImages?: string[];
    continuityReferenceImage?: string;
    characterReferenceImage?: string;
    img2imgDenoise?: number;
    seed?: number;
  }
): Promise<string> => {
  try {
    const { width, height } = mapAspectRatioToComfySize(options.aspectRatio);
    const img2imgPick = pickComfyImg2ImgSource(
      options.continuityReferenceImage,
      options.characterReferenceImage
    );
    const useImg2Img = !!img2imgPick.source;
    const effectiveWorkflowName = useImg2Img
      ? resolveImg2ImgWorkflowName(workflowName)
      : workflowName;
    const denoise = useImg2Img
      ? resolveComfyImg2ImgDenoise(img2imgPick.mode, options.img2imgDenoise)
      : undefined;
    const seed = typeof options.seed === 'number'
      ? options.seed
      : Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);

    console.info('[ComfyUI Image] Start generation:', {
      apiBase,
      workflowName: effectiveWorkflowName,
      mode: useImg2Img ? `img2img(${img2imgPick.mode})` : 'text2img',
      denoise,
    });

    let workflow: any;
    let referenceImageName: string | undefined;
    try {
      workflow = await loadComfyWorkflowTemplate(effectiveWorkflowName);
      if (useImg2Img && img2imgPick.source) {
        const resizedReference = await resizeDataUrlToSize(img2imgPick.source, width, height);
        referenceImageName = await uploadComfyImage(
          apiBase,
          resizedReference,
          `bigbanana-ref-${Date.now()}.png`
        );
      }
    } catch (loadError) {
      if (useImg2Img) {
        console.warn(
          '[ComfyUI Image] img2img 工作流未找到，回退为文生图（一致性可能下降）:',
          effectiveWorkflowName,
          loadError
        );
        workflow = await loadComfyWorkflowTemplate(workflowName);
        referenceImageName = undefined;
      } else {
        throw loadError;
      }
    }

    const prompt = patchComfyWorkflow(workflow, {
      prompt: options.prompt,
      negativePrompt: options.negativePrompt,
      width,
      height,
      seed,
      steps: options.steps,
      referenceImageName,
      denoise,
    });
    console.info('[ComfyUI Image] Workflow patched:', { width, height, seed, steps: options.steps, denoise });

    const clientId = `bigbanana-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const promptUrl = buildComfyApiUrl(apiBase, '/prompt');
    console.info('[ComfyUI Image] POST prompt:', promptUrl);
    const queueResponse = await fetch(promptUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, client_id: clientId }),
    });

    if (!queueResponse.ok) {
      const backendMessage = await parseHttpErrorBody(queueResponse);
      throw new Error(`ComfyUI 提交工作流失败：${backendMessage}`);
    }

    const queued = await queueResponse.json();
    const promptId = queued?.prompt_id;
    if (!promptId) {
      throw new Error('ComfyUI 未返回 prompt_id。');
    }
    console.info('[ComfyUI Image] Queued prompt:', promptId);

    for (let i = 0; i < COMFYUI_MAX_POLLS; i += 1) {
      await new Promise(resolve => setTimeout(resolve, COMFYUI_POLL_INTERVAL_MS));
      const historyUrl = buildComfyApiUrl(apiBase, `/history/${promptId}`);
      const historyResponse = await fetch(historyUrl);
      if (!historyResponse.ok) {
        if (i % 10 === 0) console.warn('[ComfyUI Image] History polling failed:', historyUrl, historyResponse.status);
        continue;
      }
      const history = await historyResponse.json();
      const record = history?.[promptId];
      const outputs = record?.outputs;
      if (!outputs) continue;

      for (const output of Object.values(outputs) as any[]) {
        const image = output?.images?.[0];
        if (!image?.filename) continue;
        const viewUrl = buildComfyViewUrl(apiBase, image);
        console.info('[ComfyUI Image] Fetch output:', viewUrl);
        const viewResponse = await fetch(viewUrl);
        if (!viewResponse.ok) {
          const backendMessage = await parseHttpErrorBody(viewResponse);
          throw new Error(`ComfyUI 图片读取失败：${backendMessage}`);
        }
        return blobToDataUrl(await viewResponse.blob());
      }
    }

    throw new Error('ComfyUI 图片生成超时，请检查队列或工作流输出节点。');
  } catch (error) {
    console.error('[ComfyUI Image] Generation failed:', error);
    throw error;
  }
};

/**
 * 调用图片生成 API
 */
export const callImageApi = async (
  options: ImageGenerateOptions,
  model?: ImageModelDefinition
): Promise<string> => {
  const activeModel = model || getActiveImageModel();
  if (!activeModel) {
    throw new Error('没有可用的图片模型');
  }

  const apiFormat = getImageApiFormat(activeModel);
  if (isApiAiMode() && apiFormat === 'comfyui') {
    const promptLimitResult = truncatePromptToMaxChars(options.prompt, MAX_IMAGE_PROMPT_CHARS);
    if (promptLimitResult.wasTruncated) {
      console.warn(
        `[ImagePrompt] Prompt exceeded ${MAX_IMAGE_PROMPT_CHARS} chars ` +
        `(${promptLimitResult.originalLength}). Truncated before ComfyUI request.`
      );
    }
    const aspectRatio = options.aspectRatio || activeModel.params.defaultAspectRatio;
    const workflowName = options.workflowName || activeModel.params.workflowName;
    // API 模式下 ComfyUI 由后端 Worker 直连（COMFYUI_BASE_URL），前端注册表里的地址不参与请求，
    // 打出来只会误导排查，因此这里不再输出。
    console.info('[ComfyUI Image] API 模式（异步任务）:', {
      jobType: 'comfyui_image',
      pollEndpoint: '/api/v1/jobs/{id}',
      modelId: activeModel.id,
      workflowName,
      steps: options.steps ?? activeModel.params.steps ?? 20,
    });
    try {
      return await apiCallComfyImage({
        ...options,
        prompt: promptLimitResult.text,
        negativePrompt: options.negativePrompt,
        modelId: activeModel.id,
        aspectRatio,
        steps: options.steps ?? activeModel.params.steps ?? 20,
        workflowName,
      });
    } catch (error) {
      console.error('[ComfyUI Image] 异步任务失败:', {
        workflowName,
        modelId: activeModel.id,
        // 直接打 Error 对象会被序列化成 [object Error]，丢掉真正的原因
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
  if (isApiAiMode() && apiFormat !== 'comfyui') {
    return apiCallImage(options);
  }

  const apiBase = getApiBaseUrlForModel(activeModel.id);
  const apiModel = activeModel.apiModel || activeModel.id;
  const endpointTemplate = activeModel.endpoint || getDefaultImageEndpoint(apiFormat, apiModel);
  const endpoint = endpointTemplate.replace('{model}', apiModel);
  
  // 确定宽高比
  const aspectRatio = options.aspectRatio || activeModel.params.defaultAspectRatio;

  // ComfyUI 走 img2img 底图约束，不再套云端多模态参考图文案
  if (apiFormat === 'comfyui') {
    const promptLimitResult = truncatePromptToMaxChars(options.prompt, MAX_IMAGE_PROMPT_CHARS);
    if (promptLimitResult.wasTruncated) {
      console.warn(
        `[ImagePrompt] Prompt exceeded ${MAX_IMAGE_PROMPT_CHARS} chars ` +
        `(${promptLimitResult.originalLength}). Truncated before ComfyUI request.`
      );
    }
    const workflowName = options.workflowName || activeModel.params.workflowName || apiModel;
    return callComfyImageApi(apiBase, workflowName, {
      prompt: promptLimitResult.text,
      negativePrompt: options.negativePrompt,
      aspectRatio,
      steps: options.steps ?? activeModel.params.steps ?? 20,
      referenceImages: options.referenceImages,
      continuityReferenceImage: options.continuityReferenceImage,
      characterReferenceImage: options.characterReferenceImage,
      img2imgDenoise: options.img2imgDenoise,
      seed: options.seed,
    });
  }
  
  // 构建提示词
  let finalPrompt = options.prompt;
  
  // 如果有参考图，添加一致性指令
  if (options.referenceImages && options.referenceImages.length > 0) {
    finalPrompt = `
      ⚠️⚠️⚠️ CRITICAL REQUIREMENTS - CHARACTER CONSISTENCY ⚠️⚠️⚠️
      
      Reference Images Information:
      - The FIRST image is the Scene/Environment reference.
      - Any subsequent images are Character references (Base Look or Variation).
      
      Task:
      Generate a cinematic shot matching this prompt: "${options.prompt}".
      
      ⚠️ ABSOLUTE REQUIREMENTS (NON-NEGOTIABLE):
      1. Scene Consistency:
         - STRICTLY maintain the visual style, lighting, and environment from the scene reference.
      
      2. Character Consistency - HIGHEST PRIORITY:
         If characters are present in the prompt, they MUST be IDENTICAL to the character reference images:
         • Facial Features: Eyes (color, shape, size), nose structure, mouth shape, facial contours must be EXACTLY the same
         • Hairstyle & Hair Color: Length, color, texture, and style must be PERFECTLY matched
         • Clothing & Outfit: Style, color, material, and accessories must be IDENTICAL
         • Body Type: Height, build, proportions must remain consistent
         
      ⚠️ DO NOT create variations or interpretations of the character - STRICT REPLICATION ONLY!
      ⚠️ Character appearance consistency is THE MOST IMPORTANT requirement!
    `;
  }

  const promptLimitResult = truncatePromptToMaxChars(finalPrompt, MAX_IMAGE_PROMPT_CHARS);
  if (promptLimitResult.wasTruncated) {
    console.warn(
      `[ImagePrompt] Prompt exceeded ${MAX_IMAGE_PROMPT_CHARS} chars ` +
      `(${promptLimitResult.originalLength}). Truncated before image request.`
    );
  }
  finalPrompt = promptLimitResult.text;

  // 获取 API 配置（ComfyUI 本地工作流不需要 API Key）
  const apiKey = getApiKeyForModel(activeModel.id);
  if (!apiKey) {
    throw new ApiKeyError('API Key 缺失，请在设置中配置 API Key');
  }

  if (apiFormat === 'openai') {
    const hasReferenceImages = Boolean(options.referenceImages?.length);
    const resolvedEndpoint = resolveOpenAiImageEndpoint(endpoint, hasReferenceImages);
    const openAiSize = mapAspectRatioToOpenAiImageSize(aspectRatio);

    const response = await retryOperation(async () => {
      let res: Response;
      if (hasReferenceImages) {
        const files = (options.referenceImages || [])
          .map((img, index) => dataUrlToImageFile(img, `reference-${index + 1}.png`))
          .filter((file): file is File => Boolean(file));

        if (files.length === 0) {
          throw new Error('图片生成失败：参考图格式无效，请上传图片后重试。');
        }

        const formData = new FormData();
        formData.append('model', apiModel);
        formData.append('prompt', finalPrompt);
        formData.append('size', openAiSize);
        formData.append('quality', OPENAI_IMAGE_QUALITY);
        formData.append('output_format', OPENAI_IMAGE_OUTPUT_FORMAT);
        formData.append('output_compression', String(OPENAI_IMAGE_OUTPUT_COMPRESSION));
        formData.append('n', '1');
        files.forEach(file => formData.append('image[]', file));

        res = await fetch(resolveEndpointUrl(apiBase, resolvedEndpoint), {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Accept': '*/*',
          },
          body: formData,
        });
      } else {
        const requestBody = {
          model: apiModel,
          prompt: finalPrompt,
          size: openAiSize,
          quality: OPENAI_IMAGE_QUALITY,
          output_format: OPENAI_IMAGE_OUTPUT_FORMAT,
          output_compression: OPENAI_IMAGE_OUTPUT_COMPRESSION,
          n: 1,
        };

        res = await fetch(resolveEndpointUrl(apiBase, resolvedEndpoint), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
            'Accept': '*/*',
          },
          body: JSON.stringify(requestBody),
        });
      }

      if (!res.ok) {
        const backendMessage = await parseHttpErrorBody(res);
        throw buildImageApiError(res.status, backendMessage);
      }

      return await res.json();
    });

    const imageData = extractImageFromOpenAiResponse(response);
    if (imageData) {
      return imageData;
    }

    throw new Error('图片生成失败：OpenAI Images 未返回有效图片数据。');
  }

  // Gemini generateContent protocol
  const parts: any[] = [{ text: finalPrompt }];
  if (options.referenceImages) {
    options.referenceImages.forEach((imgUrl) => {
      const match = imgUrl.match(/^data:(image\/[a-zA-Z]+);base64,(.+)$/);
      if (match) {
        parts.push({
          inlineData: {
            mimeType: match[1],
            data: match[2],
          },
        });
      }
    });
  }

  const requestBody: any = {
    contents: [{
      role: 'user',
      parts: parts,
    }],
    generationConfig: {
      responseModalities: ['TEXT', 'IMAGE'],
      imageConfig: {
        aspectRatio: aspectRatio,
      },
    },
  };

  const response = await retryOperation(async () => {
    const res = await fetch(resolveEndpointUrl(apiBase, endpoint), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Accept': '*/*',
      },
      body: JSON.stringify(requestBody),
    });

    if (!res.ok) {
      const backendMessage = await parseHttpErrorBody(res);
      throw buildImageApiError(res.status, backendMessage);
    }

    return await res.json();
  });

  const candidates = response.candidates || [];
  if (candidates.length > 0 && candidates[0].content && candidates[0].content.parts) {
    for (const part of candidates[0].content.parts) {
      if (part.inlineData) {
        return `data:image/png;base64,${part.inlineData.data}`;
      }
    }
  }

  const hasSafetyBlock =
    !!response?.promptFeedback?.blockReason ||
    candidates.some((candidate: any) => {
      const finishReason = String(candidate?.finishReason || '').toUpperCase();
      return finishReason.includes('SAFETY') || finishReason.includes('BLOCK');
    });

  if (hasSafetyBlock) {
    throw new Error('图片生成失败：提示词可能被风控拦截，请修改提示词后重试。');
  }

  throw new Error('图片生成失败：未返回有效图片数据，请重试或调整提示词。');
};

/**
 * 检查宽高比是否支持
 */
export const isAspectRatioSupported = (
  aspectRatio: AspectRatio,
  model?: ImageModelDefinition
): boolean => {
  const activeModel = model || getActiveImageModel();
  if (!activeModel) return false;
  
  return activeModel.params.supportedAspectRatios.includes(aspectRatio);
};
