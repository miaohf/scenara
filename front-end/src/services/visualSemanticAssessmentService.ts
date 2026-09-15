import type {
  KeyframeVisualReview,
  ScriptData,
  Shot,
  VisualReviewIssue,
  VisualReviewIssueType,
} from '../types';
import { chatCompletionWithImages, parseJsonWithRecovery } from './ai/apiCore';
import { fetchMediaWithCorsFallback } from './mediaFetchService';
import { getConfiguredChatModelApiName } from './modelRegistry';
import { findSceneByIdCompat } from './storyboardIdUtils';

const REVIEW_VERSION = 1 as const;
const PASS_SCORE = 75;
const HARD_SIMILARITY_THRESHOLD = 0.92;
const ISSUE_TYPES = new Set<VisualReviewIssueType>([
  'structure',
  'shot_size',
  'composition',
  'character_count',
  'character_identity',
  'wardrobe',
  'subject_position',
  'prop_presence',
  'prop_scale',
  'prop_usage',
  'scene_match',
  'anatomy',
  'text_watermark',
  'motion_space',
  'adjacent_similarity',
  'other',
]);

interface RawVisualReview {
  score?: number;
  passed?: boolean;
  issues?: Array<Partial<VisualReviewIssue>>;
  repair_prompt?: string;
  repairPrompt?: string;
}

export interface AssessKeyframeVisualOptions {
  frameType?: 'start' | 'end';
  previousShot?: Shot;
  abortSignal?: AbortSignal;
  repairAttempt?: number;
}

interface ReviewImage {
  label: string;
  image: string;
}

const clampScore = (value: unknown, fallback = 0): number => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(100, Math.round(number))) : fallback;
};

const shorten = (value: unknown, limit = 420): string => {
  const text = String(value || '').trim();
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
};

const structureIssue = (
  message: string,
  severity: VisualReviewIssue['severity'] = 'high',
  repairInstruction?: string,
): VisualReviewIssue => ({ type: 'structure', severity, message, repairInstruction });

export const inspectKeyframeStructure = (
  shot: Shot,
  scriptData: ScriptData | null | undefined,
  imageUrl?: string,
  frameType: 'start' | 'end' = 'start',
): { score: number; issues: VisualReviewIssue[] } => {
  const issues: VisualReviewIssue[] = [];
  const keyframe = shot.keyframes?.find((frame) => frame.type === frameType);
  const scene = findSceneByIdCompat(scriptData?.scenes, shot.sceneId);

  if (!shot.actionSummary?.trim()) {
    issues.push(structureIssue('镜头缺少动作摘要。', 'high', '先补齐该镜头唯一、可见且可执行的动作。'));
  }
  if (!shot.cameraMovement?.trim()) {
    issues.push(structureIssue('镜头缺少机位或运镜要求。', 'medium', '明确景别、机位和运镜方向。'));
  }
  if (!keyframe?.visualPrompt?.trim()) {
    issues.push(structureIssue('关键帧提示词为空。', 'high', '根据镜头结构化要求重新生成关键帧提示词。'));
  }
  if (!imageUrl) {
    issues.push(structureIssue('关键帧图片不存在。', 'high', '先完成关键帧生成。'));
  }
  if (!scene) {
    issues.push(structureIssue(`场景 ID 无效：${shot.sceneId || 'empty'}`, 'high', '绑定有效场景资产。'));
  } else if (!scene.referenceImage) {
    issues.push(structureIssue(`场景“${scene.location}”缺少参考图。`, 'medium', '先生成或上传场景参考图。'));
  }

  (shot.characters || []).forEach((characterId) => {
    const character = scriptData?.characters.find((item) => String(item.id) === String(characterId));
    if (!character) {
      issues.push(structureIssue(`角色 ID 无效：${characterId}`, 'high', '删除无效角色或重新绑定角色资产。'));
      return;
    }
    const variationId = shot.characterVariations?.[characterId];
    const variation = variationId
      ? character.variations?.find((item) => String(item.id) === String(variationId))
      : undefined;
    if (variationId && !variation) {
      issues.push(structureIssue(`角色“${character.name}”的造型变体无效。`, 'high', '重新选择有效造型。'));
      return;
    }
    if (!(variation?.referenceImage || character.referenceImage || character.threeView?.imageUrl || character.turnaround?.imageUrl)) {
      issues.push(structureIssue(`角色“${character.name}”缺少参考图。`, 'medium', '先生成或上传角色定妆参考图。'));
    }
  });

  (shot.props || []).forEach((propId) => {
    const prop = scriptData?.props?.find((item) => String(item.id) === String(propId));
    if (!prop) {
      issues.push(structureIssue(`道具 ID 无效：${propId}`, 'high', '删除无效道具或重新绑定道具资产。'));
    } else if (!prop.referenceImage) {
      issues.push(structureIssue(`道具“${prop.name}”缺少参考图。`, 'medium', '先生成或上传道具参考图。'));
    }
  });

  const penalty = issues.reduce((sum, issue) => (
    sum + (issue.severity === 'high' ? 30 : issue.severity === 'medium' ? 12 : 4)
  ), 0);
  return { score: Math.max(0, 100 - penalty), issues };
};

const selectedCharacterReference = (shot: Shot, scriptData: ScriptData, characterId: string): string | undefined => {
  const character = scriptData.characters.find((item) => String(item.id) === String(characterId));
  if (!character) return undefined;
  const variationId = shot.characterVariations?.[characterId];
  const variation = variationId
    ? character.variations?.find((item) => String(item.id) === String(variationId))
    : undefined;
  return variation?.referenceImage || character.referenceImage || character.threeView?.imageUrl || character.turnaround?.imageUrl;
};

const collectReviewImages = (
  shot: Shot,
  scriptData: ScriptData,
  imageUrl: string,
  previousShot?: Shot,
): ReviewImage[] => {
  const images: ReviewImage[] = [{ label: 'TARGET_GENERATED_KEYFRAME', image: imageUrl }];
  const previousImage = previousShot?.keyframes?.find((frame) => frame.type === 'start' && frame.imageUrl)?.imageUrl
    || previousShot?.keyframes?.find((frame) => frame.type === 'end' && frame.imageUrl)?.imageUrl;
  if (previousImage) images.push({ label: 'PREVIOUS_SHOT_KEYFRAME', image: previousImage });

  const scene = findSceneByIdCompat(scriptData.scenes, shot.sceneId);
  if (scene?.referenceImage) images.push({ label: `SCENE_REFERENCE:${scene.location}`, image: scene.referenceImage });
  (shot.characters || []).forEach((characterId) => {
    const character = scriptData.characters.find((item) => String(item.id) === String(characterId));
    const image = selectedCharacterReference(shot, scriptData, characterId);
    if (character && image) images.push({ label: `CHARACTER_REFERENCE:${character.name}`, image });
  });
  (shot.props || []).forEach((propId) => {
    const prop = scriptData.props?.find((item) => String(item.id) === String(propId));
    if (prop?.referenceImage) images.push({ label: `PROP_REFERENCE:${prop.name}`, image: prop.referenceImage });
  });
  return images.slice(0, 8);
};

const blobToCompressedDataUrl = async (blob: Blob): Promise<string> => {
  if (typeof document === 'undefined' || typeof createImageBitmap === 'undefined') {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(reader.error || new Error('图片读取失败'));
      reader.readAsDataURL(blob);
    });
  }
  const bitmap = await createImageBitmap(blob);
  const maxSide = 896;
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('无法创建图片审核画布');
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL('image/jpeg', 0.78);
};

const prepareVisionImage = async (image: string): Promise<string> => {
  const response = await fetchMediaWithCorsFallback(image);
  if (!response.ok) throw new Error(`审核图片读取失败 (HTTP ${response.status})`);
  return blobToCompressedDataUrl(await response.blob());
};

const loadImage = (src: string): Promise<HTMLImageElement> => new Promise((resolve, reject) => {
  const image = new Image();
  image.onload = () => resolve(image);
  image.onerror = () => reject(new Error('无法解码审核图片'));
  image.src = src;
});

const averageHash = async (dataUrl: string): Promise<boolean[]> => {
  const image = await loadImage(dataUrl);
  const canvas = document.createElement('canvas');
  canvas.width = 8;
  canvas.height = 8;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('无法创建相似度检测画布');
  context.drawImage(image, 0, 0, 8, 8);
  const pixels = context.getImageData(0, 0, 8, 8).data;
  const values: number[] = [];
  for (let index = 0; index < pixels.length; index += 4) {
    values.push(pixels[index] * 0.299 + pixels[index + 1] * 0.587 + pixels[index + 2] * 0.114);
  }
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  return values.map((value) => value >= average);
};

export const computePerceptualImageSimilarity = async (left: string, right: string): Promise<number> => {
  if (typeof document === 'undefined') return 0;
  const [leftPrepared, rightPrepared] = await Promise.all([prepareVisionImage(left), prepareVisionImage(right)]);
  const [leftHash, rightHash] = await Promise.all([averageHash(leftPrepared), averageHash(rightPrepared)]);
  const matches = leftHash.reduce((count, value, index) => count + (value === rightHash[index] ? 1 : 0), 0);
  return Number((matches / leftHash.length).toFixed(3));
};

const buildReviewPrompt = (
  shot: Shot,
  scriptData: ScriptData,
  images: ReviewImage[],
  previousShot?: Shot,
): string => {
  const scene = findSceneByIdCompat(scriptData.scenes, shot.sceneId);
  const characters = (shot.characters || []).map((characterId) => {
    const character = scriptData.characters.find((item) => String(item.id) === String(characterId));
    const variationId = shot.characterVariations?.[characterId];
    const variation = character?.variations?.find((item) => String(item.id) === String(variationId));
    return {
      id: characterId,
      name: character?.name,
      species: character?.species,
      wardrobe: variation?.wardrobe || character?.wardrobe,
      identityFeatures: character?.coreFeatures,
    };
  });
  const props = (shot.props || []).map((propId) => {
    const prop = scriptData.props?.find((item) => String(item.id) === String(propId));
    return {
      id: propId,
      name: prop?.name,
      description: prop?.description,
      usage: shot.propUsages?.[propId] || {
        mode: prop?.presentationMode,
        note: prop?.presentationNote,
      },
    };
  });

  return [
    '你是影视分镜画面质检导演。审核生成图是否忠实执行镜头要求，而不是只检查字段是否存在。',
    '图片严格按下面的 IMAGE_ORDER 顺序提供。第 1 张永远是待审核生成图；其余只用于比对，不得把参考图自身当作成图缺陷。',
    '逐项检查：景别、机位和起始构图；人物数量；角色身份与服装；主体位置；道具存在、比例和使用方式；场景；重复人物、多余肢体、文字水印；运动空间；与上一镜头的叙事和构图差异。',
    '只有图中有可见证据时才报告缺陷。问题描述必须指出“要求与实际的差异”，repairInstruction 必须能直接追加到生图提示词。',
    '若存在任一 high 问题，passed 必须为 false。score 低于 75 时 passed 必须为 false。',
    '只输出 JSON：',
    '{"score":0-100,"passed":true|false,"issues":[{"type":"shot_size|composition|character_count|character_identity|wardrobe|subject_position|prop_presence|prop_scale|prop_usage|scene_match|anatomy|text_watermark|motion_space|adjacent_similarity|other","severity":"low|medium|high","message":"具体差异","repairInstruction":"可执行修复约束"}],"repair_prompt":"合并后的差异修复提示词；通过时为空"}',
    '',
    `IMAGE_ORDER:\n${images.map((item, index) => `${index + 1}. ${item.label}`).join('\n')}`,
    '',
    'CURRENT_SHOT_REQUIREMENTS:',
    JSON.stringify({
      id: shot.id,
      shotSize: shot.shotSize,
      cameraMovement: shot.cameraMovement,
      actionSummary: shot.actionSummary,
      dialogue: shot.dialogue,
      directorPurpose: shot.agent?.directorPurpose,
      visualHook: shot.agent?.visualHook,
      timeline: shot.agent?.timeline,
      continuity: shot.agent?.continuity,
      scene: scene ? { location: scene.location, time: scene.time, atmosphere: scene.atmosphere } : null,
      characters,
      props,
    }, null, 2),
    '',
    'PREVIOUS_SHOT_REQUIREMENTS:',
    previousShot ? JSON.stringify({
      id: previousShot.id,
      shotSize: previousShot.shotSize,
      cameraMovement: previousShot.cameraMovement,
      actionSummary: previousShot.actionSummary,
      directorPurpose: previousShot.agent?.directorPurpose,
    }, null, 2) : 'NONE',
  ].join('\n');
};

const normalizeIssue = (raw: Partial<VisualReviewIssue>): VisualReviewIssue | null => {
  const message = shorten(raw.message, 500);
  if (!message) return null;
  const type = ISSUE_TYPES.has(raw.type as VisualReviewIssueType) ? raw.type as VisualReviewIssueType : 'other';
  const severity = raw.severity === 'high' || raw.severity === 'medium' || raw.severity === 'low'
    ? raw.severity
    : 'medium';
  return {
    type,
    severity,
    message,
    repairInstruction: shorten(raw.repairInstruction, 500) || undefined,
  };
};

const differentShotIntent = (shot: Shot, previousShot?: Shot): boolean => {
  if (!previousShot) return false;
  return String(shot.shotSize || '').trim() !== String(previousShot.shotSize || '').trim()
    || String(shot.cameraMovement || '').trim() !== String(previousShot.cameraMovement || '').trim()
    || String(shot.agent?.directorPurpose || '').trim() !== String(previousShot.agent?.directorPurpose || '').trim();
};

export const buildVisualRepairPrompt = (originalPrompt: string, review: KeyframeVisualReview): string => {
  const directives = review.issues
    .filter((issue) => issue.severity !== 'low')
    .map((issue) => issue.repairInstruction || issue.message)
    .filter(Boolean);
  const repair = review.repairPrompt || directives.join('；');
  return [
    originalPrompt.trim(),
    '',
    '【画面差异修复，优先级最高】',
    repair || '严格重新执行镜头结构化要求，并纠正上一版构图偏差。',
    '保持原角色、服装、场景和道具参考身份不变；不要复刻上一版错误构图。',
  ].join('\n');
};

export const assessKeyframeVisualSemantics = async (
  shot: Shot,
  scriptData: ScriptData,
  imageUrl: string,
  options: AssessKeyframeVisualOptions = {},
): Promise<KeyframeVisualReview> => {
  const frameType = options.frameType || 'start';
  const structure = inspectKeyframeStructure(shot, scriptData, imageUrl, frameType);
  const images = collectReviewImages(shot, scriptData, imageUrl, options.previousShot);
  let preparedImages: string[] = [];
  let similarity: number | undefined;

  try {
    preparedImages = await Promise.all(images.map((item) => prepareVisionImage(item.image)));
    if (images[1]?.label === 'PREVIOUS_SHOT_KEYFRAME') {
      const [targetHash, previousHash] = await Promise.all([
        averageHash(preparedImages[0]),
        averageHash(preparedImages[1]),
      ]);
      const matches = targetHash.reduce((count, value, index) => count + (value === previousHash[index] ? 1 : 0), 0);
      similarity = Number((matches / targetHash.length).toFixed(3));
    }

    const model = getConfiguredChatModelApiName();
    const rawText = await chatCompletionWithImages(
      buildReviewPrompt(shot, scriptData, images, options.previousShot),
      preparedImages,
      model,
      0.1,
      4096,
      'json_object',
      300000,
      options.abortSignal,
    );
    const raw = parseJsonWithRecovery<RawVisualReview>(rawText, {});
    const semanticIssues = (raw.issues || [])
      .map(normalizeIssue)
      .filter((issue): issue is VisualReviewIssue => Boolean(issue));

    if (
      similarity !== undefined
      && similarity >= HARD_SIMILARITY_THRESHOLD
      && differentShotIntent(shot, options.previousShot)
      && !semanticIssues.some((issue) => issue.type === 'adjacent_similarity')
    ) {
      semanticIssues.push({
        type: 'adjacent_similarity',
        severity: 'high',
        message: `与上一镜头的感知相似度为 ${Math.round(similarity * 100)}%，但两个镜头的景别、运镜或叙事目的不同。`,
        repairInstruction: '显著改变景别、机位、主体位置和视觉重心，不要复用上一镜头构图。',
      });
    }

    const semanticScore = clampScore(raw.score, 50);
    const issues = [...structure.issues, ...semanticIssues];
    const combinedScore = Math.round(structure.score * 0.3 + semanticScore * 0.7);
    const hasHighIssue = issues.some((issue) => issue.severity === 'high');
    const passed = combinedScore >= PASS_SCORE && !hasHighIssue && raw.passed !== false;
    return {
      version: REVIEW_VERSION,
      status: passed ? 'passed' : 'failed',
      score: combinedScore,
      passed,
      structureScore: structure.score,
      semanticScore,
      issues,
      repairPrompt: shorten(raw.repair_prompt || raw.repairPrompt, 1400) || undefined,
      previousShotSimilarity: similarity,
      reviewedImageUrl: imageUrl,
      reviewedAt: Date.now(),
      model,
      repairAttempt: options.repairAttempt || 0,
    };
  } catch (error) {
    return {
      version: REVIEW_VERSION,
      status: 'error',
      score: structure.score,
      passed: false,
      structureScore: structure.score,
      issues: structure.issues,
      previousShotSimilarity: similarity,
      reviewedImageUrl: imageUrl,
      reviewedAt: Date.now(),
      repairAttempt: options.repairAttempt || 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

export const isVisualReviewCurrent = (
  imageUrl: string | undefined,
  review: KeyframeVisualReview | undefined,
): boolean => Boolean(imageUrl && review?.reviewedImageUrl === imageUrl && review.status === 'passed' && review.passed);
