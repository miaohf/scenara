import {
  Shot,
  ProjectState,
  Keyframe,
  NineGridPanel,
  NineGridData,
  PromptTemplateConfig,
  PropPresentationMode,
  ShotPropUsage,
  Character,
  DubbingMode,
  ShotReferencePolicyItem,
  ShotCharacterBlocking,
  ShotPropFrameState,
} from '../../types';
import {
  VISUAL_STYLE_PROMPTS,
  getStoryboardPositionLabel,
  resolveStoryboardGridLayout,
} from './constants';
import { getCameraMovementCompositionGuide } from './cameraMovementGuides';
import { enhanceKeyframePrompt } from '../../services/aiService';
import {
  DEFAULT_PROMPT_TEMPLATE_CONFIG,
  renderPromptTemplate,
  resolvePromptTemplateConfig,
  withTemplateFallback,
} from '../../services/promptTemplateService';
import { getActiveVideoModel, getModelById, getVideoModels } from '../../services/modelRegistry';
import { findSceneByIdCompat } from '../../services/storyboardIdUtils';
import { VideoModelParams } from '../../types/model';
import {
  buildVideoPromptPolicyBlock,
  hasVideoPromptPolicy,
} from '../../services/ai/videoPromptPolicy';
import {
  resolveCharacterDisplayImage,
  resolveCharacterImageView,
} from '../../services/characterImageHistory';
import { ReferenceImageEntry } from '../../services/referenceImagePack';
import { resolveShotReferencePolicy } from '../../services/referencePolicyService';
import { formatProductionBibleForPrompt } from '../../services/productionBibleService';
import { formatContinuityLedgerForPrompt } from '../../services/continuityLedgerService';

const KEYFRAME_META_SPLITTER = '\n\n---PROMPT_META_START---';

/**
 * getRefImagesForShot 的返回类型
 * hasTurnaround 标记当前参考包是否使用了角色九宫格/三视图，
 * 用于在提示词中告知 AI 如何正确解读多视角参考。
 */
export interface RefImagesResult {
  images: string[];
  /** 保留图片的业务类型、名称与说明，供槽位合并和提示词映射使用。 */
  entries: ReferenceImageEntry[];
  /** 与 images 下标对齐，便于提交前核对每个参考图槽位的业务角色。 */
  imageRoles: string[];
  hasTurnaround: boolean;
  selectedTurnaroundCount: number;
  droppedTurnaroundCount: number;
  sceneFirst: boolean;
  policyDecisions: ShotReferencePolicyItem[];
}

export const isQwenEditKeyframeWorkflow = (workflowName?: string): boolean => {
  const name = String(workflowName || '').toLowerCase();
  if (name.includes('turnaround')) return false;
  return (
    name.includes('qwen_image_edit')
    || name.includes('qwen_image_2_1_image_edit')
    || name.includes('image_qwen_image_2_1_image_edit')
  );
};

/** Qwen Edit 2511 最多 3 张；Qwen Image 2.1 Edit 官方最多 10 张。 */
export const qwenEditKeyframeMaxReferences = (workflowName?: string): number => {
  const name = String(workflowName || '').toLowerCase();
  if (name.includes('qwen_image_2_1')) return 10;
  return 3;
};

export type QwenShotComplexity = 'simple' | 'standard' | 'complex';

/** 依据镜头事实数量决定提示词细度和参考图预算；旧镜头无需手工补字段。 */
export const inferQwenShotComplexity = (shot: Shot): QwenShotComplexity => {
  if (shot.visualComplexity) return shot.visualComplexity;
  const characterCount = shot.characters?.length || 0;
  const propCount = shot.props?.length || 0;
  const phaseCount = shot.agent?.executionPlan?.actionPhases?.length || 0;
  const hasStructuredBlocking = Boolean(
    shot.frameDirections?.start?.characterBlocking?.length
      || shot.frameDirections?.end?.characterBlocking?.length,
  );
  if (characterCount <= 1 && propCount === 0 && phaseCount <= 1 && !hasStructuredBlocking) return 'simple';
  if (characterCount >= 3 || propCount >= 2 || phaseCount >= 3 || hasStructuredBlocking) return 'complex';
  return 'standard';
};

export const qwenEditReferenceBudget = (shot: Shot, workflowName?: string): number => {
  const workflowLimit = qwenEditKeyframeMaxReferences(workflowName);
  const complexity = inferQwenShotComplexity(shot);
  const requested = complexity === 'simple' ? 3 : complexity === 'complex' ? workflowLimit : 5;
  return Math.min(workflowLimit, requested);
};

/** 参考图说明只留外观，去掉“最终劈开/曾被撞乱”这类后文剧情。 */
const shortenPropAppearanceDetail = (detail: string): string => {
  const firstSentence = String(detail || '').split(/[。！？]/u)[0] || '';
  const visual = firstSentence
    .replace(/(?:，|,)?(?:能够|可以|曾被|最终|并在最终|后来)[^，,。]*/gu, '')
    .replace(/[，,]\s*$/u, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  if (!visual) return '';
  return visual.length > 42 ? `${visual.slice(0, 42)}…` : visual;
};

/** Keep the saved keyframe prompt aligned with the exact references submitted for this generation. */
export const buildReferenceImageRoleGuide = (entries: ReferenceImageEntry[]): string => {
  if (!entries.length) return '';
  const lines = entries.map((entry, index) => {
    // Qwen Image 2.1 resolves these explicit multimodal tokens; other image
    // backends treat them as harmless role labels.
    const imageLabel = `Image ${index + 1} (<image${index + 1}>)`;
    const sourceDetail = [entry.detailZh, entry.detail, entry.detailEn]
      .map((value) => String(value || '').trim())
      .find(Boolean);
    if (entry.type === 'scene') {
      return `- ${imageLabel}: 场景参考图 “${entry.label}”。只负责场所、建筑/环境布局、空间透视、光照和氛围；${sourceDetail ? `补充信息：${sourceDetail}。` : ''}场景图中偶然出现的角色、兵器或道具，不得替代对应的角色/道具参考图，也不要把场景图改造成定妆照。`;
    }
    const sheetKind = /三视图/.test(`${entry.detail || ''} ${entry.detailZh || ''}`)
      ? '三视图定妆照'
      : /九宫格/.test(`${entry.detail || ''} ${entry.detailZh || ''}`)
        ? '九宫格定妆照'
        : '';
    if (entry.type === 'turnaround' || sheetKind) {
      const primaryIndex = entries.findIndex((item, itemIndex) => (
        itemIndex < index
        && item.type === 'character'
        && item.label === entry.label
        && !/三视图|九宫格/.test(`${item.detail || ''} ${item.detailZh || ''}`)
      ));
      const sheetName = sheetKind || '多角度定妆照';
      if (primaryIndex >= 0) {
        return `- ${imageLabel}: 仍是“${entry.label}”的${sheetName}，身份与服装以 Image ${primaryIndex + 1} 为准。只取与本帧机位相符的一个角度，不要画出拼图版式，也不要多画一个${entry.label}。`;
      }
      return `- ${imageLabel}: “${entry.label}”的${sheetName}。只锁定该角色的身份和服装，只取一个角度，不要画出拼图版式或棚拍背景。`;
    }
    if (entry.type === 'character') {
      return `- ${imageLabel}: 角色参考图 “${entry.label}”。这张图只属于 ${entry.label}；只锁定该角色的脸部、毛发、身体比例、发型、服装和身份，不得把其脸、服装、颜色或体态转移给其他角色。${sourceDetail ? `参考图类型/补充信息：${sourceDetail}。` : ''}将角色自然放入场景，不复制棚拍背景或原始姿势。`;
    }
    if (entry.type === 'prop') {
      const appearance = sourceDetail ? shortenPropAppearanceDetail(sourceDetail) : '';
      return `- ${imageLabel}: 道具参考图 “${entry.label}”。这是本镜头的动作相关道具；只要本帧描述提到它，就必须出现。只锁定它的形状、比例、材质、颜色、纹饰和端部细节；不得替换成其他兵器，不得从场景图或角色图重新发明道具。${appearance ? `外观：${appearance}。` : ''}是否持握、放置或处于其他状态，以本帧的道具状态为准，不要提前画成后续镜头里的结果。`;
    }
    return `- ${imageLabel}: reference “${entry.label}”. Follow its role as described; do not create a collage, split screen, or duplicate subjects.`;
  });
  return `【本次参考图映射】REFERENCE IMAGE MAPPING — exactly ${entries.length} supplied image${entries.length === 1 ? '' : 's'}\n${lines.join('\n')}`;
};

const dedupeImageRefs = (images: string[]): string[] => {
  const output: string[] = [];
  const seen = new Set<string>();
  images.forEach((img) => {
    const normalized = String(img || '').trim();
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    output.push(normalized);
  });
  return output;
};

const GARMENT_NAME_PATTERN = /\b(coat|jacket|shirt|sweater|hoodie|trousers|pants|dress|skirt|scarf|boots|shoes|sneakers|hat|helmet|raincoat)\b|服装|衣服|外套|上衣|毛衣|裤|裙|围巾|靴|鞋|帽|雨衣/i;
const WEARING_CONTEXT_PATTERN = /\b(worn|wearing|wears|dressed|outfit|wardrobe|costume|attire)\b|穿着|身穿|佩戴|换装|造型|服饰/i;

/**
 * 兼容旧项目：新数据以 isWearable 为准；旧数据只有在“衣物名称 + 穿戴语境”
 * 或已进入当前角色的基础/变体服装描述时，才按服装处理。避免误删手持头盔、
 * 橱窗服装等真正需要独立参考图的道具。
 */
const isWornGarmentForShot = (
  prop: NonNullable<ProjectState['scriptData']>['props'][number],
  shot: Shot,
  scriptData: NonNullable<ProjectState['scriptData']>,
): boolean => {
  if (prop.isWearable) return true;

  const identityText = `${prop.name || ''} ${prop.category || ''}`;
  if (!GARMENT_NAME_PATTERN.test(identityText)) return false;

  const description = `${prop.description || ''} ${prop.visualPrompt || ''}`;
  if (WEARING_CONTEXT_PATTERN.test(description)) return true;

  const normalizedPropName = String(prop.name || '').trim().toLowerCase();
  if (!normalizedPropName) return false;

  return (shot.characters || []).some((characterId) => {
    const character = scriptData.characters.find(c => String(c.id) === String(characterId));
    if (!character) return false;
    const selectedVariationId = shot.characterVariations?.[characterId];
    const selectedVariation = selectedVariationId
      ? character.variations?.find(v => String(v.id) === String(selectedVariationId))
      : undefined;
    const wardrobeText = `${selectedVariation?.wardrobe || selectedVariation?.visualPrompt || ''} ${character.wardrobe || ''}`.toLowerCase();
    if (wardrobeText.includes(normalizedPropName)) return true;

    const normalizedDescription = description.toLowerCase();
    const normalizedCharacterName = String(character.name || '').trim().toLowerCase();
    if (!normalizedCharacterName) return false;
    return normalizedDescription.includes(`${normalizedCharacterName}'s`)
      || normalizedDescription.includes(`${normalizedCharacterName}’s`)
      || normalizedDescription.includes(`${normalizedCharacterName}的`);
  });
};

export const isMiniMaxH3VideoModel = (modelId: string): boolean =>
  resolveVideoModelRouting(modelId).normalizedModelId.includes('minimax-h3');

export type VideoModelFamily =
  | 'sora'
  | 'doubao-task'
  | 'veo-fast'
  | 'comfyui-ltx'
  | 'unknown';

const buildMiniMaxTimelineDurations = (videoDuration?: number) => {
  const totalDuration = Math.max(5, videoDuration || 5);
  const midDuration = (totalDuration / 2).toFixed(1);
  return { totalDuration, midDuration };
};

export interface VideoModelRouting {
  family: VideoModelFamily;
  normalizedModelId: string;
  supportsStartFrame: boolean;
  supportsEndFrame: boolean;
  prefersNineGridStoryboard: boolean;
}

export interface VideoPromptContext {
  hasStartFrame?: boolean;
  hasEndFrame?: boolean;
  dialogue?: string;
  nativeAudio?: {
    mode?: DubbingMode;
    text?: string;
    speakerName?: string;
  };
}

const VOICE_CHARACTER_NAME_PATTERN = /voice|narrator|speaker|radio|child|human|声音|旁白|无线电|回应/i;

/** 兼容旧剧本：没有 role 字段时，从声音角色的命名特征保守推断。 */
export const isVoiceCharacter = (character: Pick<Character, 'name' | 'role'>): boolean =>
  character.role === 'voice' || (
    !character.role && VOICE_CHARACTER_NAME_PATTERN.test(String(character.name || ''))
  );

/** 从镜头文本中解析声音角色，无法唯一确定时返回 undefined，避免错误绑定。 */
export const resolveShotVoiceSpeakerName = (
  shot: Shot,
  scriptData: ProjectState['scriptData'],
  text?: string,
): string | undefined => {
  const characters = scriptData?.characters || [];
  const dialogueText = `${shot.dialogue || ''}\n${text || ''}`.toLocaleLowerCase();
  const mentioned = characters.filter((character) =>
    isVoiceCharacter(character) &&
    character.name &&
    dialogueText.includes(String(character.name).toLocaleLowerCase())
  );
  if (mentioned.length > 0) return mentioned.map((character) => character.name).join(' & ');

  const onScreenCharacter = (shot.characters || [])
    .map((id) => characters.find((character) => String(character.id) === String(id)))
    .find((character) => character && !isVoiceCharacter(character));
  if (onScreenCharacter && (shot.characters || []).length === 1) return onScreenCharacter.name;

  const voiceCharacters = characters.filter(isVoiceCharacter);
  return voiceCharacters.length === 1 ? voiceCharacters[0].name : undefined;
};

/** 从镜头结构化配音字段生成 H3 原生音频上下文，不上传 audioUrl。 */
export const buildShotNativeAudioContext = (
  shot: Shot,
  scriptData: ProjectState['scriptData'],
): VideoPromptContext['nativeAudio'] => {
  const text = String(shot.dubbing?.text || shot.dialogue || '').trim();
  const mode = shot.dubbing?.mode || (shot.dialogue?.trim() ? 'dialogue' : undefined);
  if (!text && !mode) return undefined;
  return {
    mode,
    text,
    speakerName: shot.dubbing?.speakerName || resolveShotVoiceSpeakerName(shot, scriptData, text),
  };
};

const NATIVE_AUDIO_DIRECTIVE_MARKER = '[NATIVE_AUDIO_DIRECTIVE_V1]';
const NATIVE_AUDIO_DIRECTIVE_PATTERN = /\n\n\[NATIVE_AUDIO_DIRECTIVE_V1\][\s\S]*$/u;

/** 为 H3 原生音频工作流生成稳定、可重复的对白/旁白指令。 */
export const buildNativeAudioDirective = (
  audio: VideoPromptContext['nativeAudio'],
  language: string,
): string => {
  void language;
  const text = String(audio?.text || '').trim();
  if (audio?.mode === 'narration' && text) {
    return `${NATIVE_AUDIO_DIRECTIVE_MARKER}\nAudio: Generate one restrained narrator voice. The narrator must say exactly the quoted text in its original language. Do not translate, paraphrase, or add words: "${text}". No other spoken dialogue, no subtitles, and no on-screen text.`;
  }
  if (audio?.mode === 'dialogue' && text) {
    const speaker = audio.speakerName?.includes(' & ')
      ? `Use the explicitly labeled speakers ${audio.speakerName}. Each speaker must say only the line associated with that speaker label`
      : audio.speakerName
        ? `The voice belongs to ${audio.speakerName}`
      : 'Use one clearly distinguished off-screen or in-scene speaker';
    return `${NATIVE_AUDIO_DIRECTIVE_MARKER}\nAudio: ${speaker}. The speaker must say exactly the quoted text in its original language. Do not translate, paraphrase, or add words: "${text}". Lip-sync only if the speaker is visible. No other spoken dialogue, no narrator voiceover, no subtitles, and no on-screen text.`;
  }
  return `${NATIVE_AUDIO_DIRECTIVE_MARKER}\nAudio: Generate environmental sound effects only. Absolutely no human voice, speech, dialogue, narration, singing, humming, whispering, murmuring, vocalization, or speech-like/gibberish sounds. No subtitles and no on-screen text.`;
};

const H3_SKILL_SOUNDSCAPE_PATTERN =
  /\noverall_soundscape:\n[\s\S]*?(?=\nnon_diegetic_music:|\s*$)/u;
const H3_SKILL_MUSIC_PATTERN = /\nnon_diegetic_music:\n[\s\S]*$/u;

const dialogueLanguageTag = (language: string): string => {
  const value = String(language || '').trim();
  if (!value) return 'Chinese';
  if (/中文|chinese|^zh\b/i.test(value)) return 'Chinese';
  if (/english|英文|^en\b/i.test(value)) return 'English';
  return value;
};

const isOfficialH3SkillPrompt = (prompt: string): boolean =>
  /^\s*subject_definitions:/m.test(prompt)
  || /^\s*integrated_multimodal_description:/m.test(prompt);

/** Rewrite FLF2V/base skill audio sections; Ref2VA already embeds speech in detailed_description. */
const finalizeOfficialH3SkillAudio = (
  prompt: string,
  audio: VideoPromptContext['nativeAudio'],
  language: string,
): string => {
  const spoken = String(audio?.text || '').trim();
  const isRef2VA = /^\s*subject_definitions:/m.test(prompt);

  let next = prompt.replace(NATIVE_AUDIO_DIRECTIVE_PATTERN, '').replace(WORKFLOW_AUDIO_BLOCK_PATTERN, '').trimEnd();

  if (!isRef2VA && spoken) {
    const dialogue = `<d>[${dialogueLanguageTag(language)}] ${spoken}</d>`;
    const speechSentence = audio?.mode === 'narration'
      ? ` A restrained off-screen narrator says ${dialogue}, while on-screen lips remain closed.`
      : audio?.speakerName
        ? ` ${audio.speakerName} (S1) says ${dialogue}, with natural lip sync if visible.`
        : ` A clearly identified speaker (S1) says ${dialogue}.`;
    if (!next.includes('<d>[')) {
      next = next.replace(
        /\n\noverall_soundscape:/,
        `${speechSentence}\n\noverall_soundscape:`,
      );
    }
  }

  const existingSoundscape = (next.match(H3_SKILL_SOUNDSCAPE_PATTERN)?.[0] || '')
    .replace(/^\noverall_soundscape:\n?/i, '')
    .trim();
  const existingMusic = (next.match(H3_SKILL_MUSIC_PATTERN)?.[0] || '')
    .replace(/^\nnon_diegetic_music:\n?/i, '')
    .trim();

  // Only fill missing / empty audio sections. Never overwrite compiler-written
  // concrete SFX / music with the old generic “restrained ambience / N/A” stub —
  // that stub was collapsing native audio toward near-silence.
  const needsSpeechBed = audio?.mode === 'narration' || audio?.mode === 'dialogue' || Boolean(spoken);
  const fallbackSoundscape = needsSpeechBed
    ? 'Keep diegetic ambience audible but low under the spoken line: soft environmental texture, fabric/object contact, and room tone. No extra voices.'
    : 'Continuous diegetic ambience with soft wind, distant water or room tone, and physical contact sounds clearly audible and synced to the action. No human speech, narration, singing, or speech-like vocalization.';

  if (!existingSoundscape) {
    if (H3_SKILL_SOUNDSCAPE_PATTERN.test(next)) {
      next = next.replace(H3_SKILL_SOUNDSCAPE_PATTERN, `\noverall_soundscape:\n${fallbackSoundscape}`);
    } else {
      next = `${next}\n\noverall_soundscape:\n${fallbackSoundscape}`;
    }
  }

  if (!existingMusic) {
    if (H3_SKILL_MUSIC_PATTERN.test(next)) {
      next = next.replace(H3_SKILL_MUSIC_PATTERN, '\nnon_diegetic_music:\nN/A');
    } else {
      next = `${next}\n\nnon_diegetic_music:\nN/A`;
    }
  }

  return fitVideoPromptLength(next);
};

/** H3 prompts: prefer official skill audio fields; legacy prompts keep NATIVE_AUDIO_DIRECTIVE. */
export const finalizeMiniMaxH3VideoPrompt = (
  prompt: string,
  audio: VideoPromptContext['nativeAudio'],
  language: string,
  durationSeconds?: number,
): string => {
  const totalDuration = Math.max(5, durationSeconds || 5);
  const midDuration = (totalDuration / 2).toFixed(1);
  const basePrompt = String(prompt || '')
    .replace(NATIVE_AUDIO_DIRECTIVE_PATTERN, '')
    .replace(WORKFLOW_AUDIO_BLOCK_PATTERN, '')
    .replace(/\{duration\}/g, String(totalDuration))
    .replace(/\{midDuration\}/g, midDuration)
    .trimEnd();

  if (isOfficialH3SkillPrompt(basePrompt)) {
    return finalizeOfficialH3SkillAudio(basePrompt, audio, language);
  }

  const directive = buildNativeAudioDirective(audio, language);
  const budget = Math.max(400, MAX_VIDEO_PROMPT_CHARS - Array.from(directive).length - 2);
  return `${fitVideoPromptLength(basePrompt, budget)}\n\n${directive}`;
};

/** 单角色镜头的构图锁，防止“越肩镜头”被模型误解成两个相同角色。群演按 count 写明人数。 */
export const appendCharacterCompositionConstraints = (
  prompt: string,
  shot: Shot,
  scriptData: ProjectState['scriptData'],
): string => {
  if (String(prompt || '').includes('[LOCKED CHARACTER COUNT — DO NOT CHANGE]')) return prompt;
  const names = (shot.characters || [])
    .map((id) => scriptData?.characters.find((character) => String(character.id) === String(id)))
    .filter((character): character is NonNullable<typeof character> => !!character)
    .map((character) => character.name)
    .filter(Boolean);
  if (names.length === 0) return prompt;
  const countByName = new Map<string, number>();
  for (const frame of Object.values(shot.frameDirections || {})) {
    for (const item of frame?.characterBlocking || []) {
      const name = scriptData?.characters.find((character) => String(character.id) === String(item.characterId))?.name;
      const count = Number(item.count) || 1;
      if (name && count > 1) countByName.set(name, Math.max(countByName.get(name) || 1, count));
    }
  }
  const subjectRule = names.length === 1 && !countByName.has(names[0])
    ? `- EXACTLY ONE visible human/character: ${names[0]}. Do not create a second copy, clone, duplicate, reflection, portrait, silhouette, or background version of ${names[0]}.
- If this is an over-the-shoulder or rear view, it is still the same single ${names[0]}; do not add another foreground or background body.`
    : names.map((name) => {
      const count = countByName.get(name);
      return count && count > 1
        ? `- Show exactly ${count} separate people of “${name}”. They are a counted group, not one merged person and not an unlimited crowd.`
        : `- Show exactly one “${name}”. Do not duplicate ${name}.`;
    }).join('\n');
  return `${prompt.trim()}\n\n[LOCKED CHARACTER COUNT — DO NOT CHANGE]\n${subjectRule}\n- Keep the composition as one coherent shot; no split-screen, collage, mirror duplication, or multi-exposure.`;
};

const WORKFLOW_AUDIO_BLOCK_PATTERN =
  /\n\nAudio[\s\S]*$/iu;

/** ComfyUI 原生音视频工作流：注入角色对话块，禁止旁白 */
export const finalizeComfyUiVideoWorkflowPrompt = (
  prompt: string,
  dialogue: string | undefined,
  language: string
): string => {
  const trimmedDialogue = (dialogue || '').trim();
  const isChinese = isChineseLanguage(language);
  const basePrompt = prompt.replace(WORKFLOW_AUDIO_BLOCK_PATTERN, '').trimEnd();

  if (!trimmedDialogue) {
    const noSpeechNote = '\n\nAudio: No character dialogue in this shot; ambient sound only. No human voice or speech-like vocalization, no narrator voiceover, no subtitles or on-screen text.';
    return fitVideoPromptLength(`${basePrompt}${noSpeechNote}`);
  }

  const block = isChinese
    ? `\n\nAudio（角色对话，需口型同步）：\n「${trimmedDialogue}」\n画面中角色用台词原本的语言，逐字清晰说出以上台词。不要翻译、改写或添加内容。禁止旁白配音，禁止字幕与画面文字。`
    : `\n\nAudio (character dialogue, lip-sync required):\n"${trimmedDialogue}"\nThe on-screen character speaks this line clearly in the original language of the line. Do not translate, paraphrase, or add words. No narrator voiceover, no subtitles or on-screen text.`;
  return fitVideoPromptLength(`${basePrompt}${block}`);
};

const normalizeVideoModelIdForRouting = (videoModel: string): string => {
  const raw = (videoModel || '').trim();
  if (!raw) return 'sora-2';

  const normalized = raw.toLowerCase();

  if (normalized === 'veo_3_1-fast-4k') {
    return 'veo_3_1-fast';
  }

  if (
    normalized === 'veo' ||
    normalized === 'veo_3_1' ||
    normalized === 'veo-r2v' ||
    normalized.startsWith('veo_3_0_r2v')
  ) {
    return 'veo_3_1-fast';
  }

  return raw;
};

const SORA_COMPATIBLE_MODELS = new Set([
  'sora-2',
  'doubao-seedance-1-5-pro',
]);

/** 工作台/关键帧 UI 与视频生成共用：优先全局激活模型，其次镜头覆盖。 */
export const resolveEffectiveVideoModelId = (shotVideoModel?: string): string => {
  const enabled = getVideoModels().filter((model) => model.isEnabled);
  const active = getActiveVideoModel();
  if (active?.id && enabled.some((model) => model.id === active.id)) {
    return active.id;
  }

  const perShot = (shotVideoModel || '').trim();
  if (perShot && enabled.some((model) => model.id === perShot)) {
    return perShot;
  }

  return enabled[0]?.id || 'sora-2';
};

export const resolveVideoModelRouting = (videoModel: string): VideoModelRouting => {
  const normalizedModelId = normalizeVideoModelIdForRouting(videoModel);
  const id = normalizedModelId.toLowerCase();

  if (SORA_COMPATIBLE_MODELS.has(id) || id.startsWith('sora')) {
    return {
      family: 'sora',
      normalizedModelId,
      supportsStartFrame: true,
      supportsEndFrame: false,
      prefersNineGridStoryboard: true,
    };
  }

  if (id.startsWith('doubao-seedance')) {
    return {
      family: 'doubao-task',
      normalizedModelId,
      supportsStartFrame: true,
      supportsEndFrame: false,
      prefersNineGridStoryboard: true,
    };
  }

  if (
    id.startsWith('veo_3_1-fast') ||
    id.startsWith('veo_3_1_t2v_fast') ||
    id.startsWith('veo_3_1_i2v_s_fast')
  ) {
    return {
      family: 'veo-fast',
      normalizedModelId,
      supportsStartFrame: true,
      supportsEndFrame: true,
      prefersNineGridStoryboard: true,
    };
  }

  const registryModel = getModelById(normalizedModelId);
  if (registryModel?.type === 'video' && registryModel.providerId === 'comfyui-local') {
    const params = registryModel.params as VideoModelParams;
    return {
      family: 'comfyui-ltx',
      normalizedModelId,
      supportsStartFrame: true,
      supportsEndFrame: params.supportsEndFrame ?? false,
      prefersNineGridStoryboard: false,
    };
  }

  return {
    family: 'unknown',
    normalizedModelId,
    supportsStartFrame: true,
    supportsEndFrame: true,
    prefersNineGridStoryboard: false,
  };
};

export const routeVideoFrameInputs = (
  videoModel: string,
  startImage?: string,
  endImage?: string,
  videoInputMode: 'keyframes' | 'storyboard-grid' = 'keyframes'
): {
  startImage?: string;
  endImage?: string;
  routing: VideoModelRouting;
  ignoredEndFrame: boolean;
} => {
  const routing = resolveVideoModelRouting(videoModel);
  const routedStartImage = startImage;
  const shouldIgnoreEndFrame =
    !!endImage && (!routing.supportsEndFrame || videoInputMode === 'storyboard-grid');
  const routedEndImage = shouldIgnoreEndFrame ? undefined : endImage;

  return {
    startImage: routedStartImage,
    endImage: routedEndImage,
    routing,
    ignoredEndFrame: shouldIgnoreEndFrame,
  };
};

/**
 * 获取镜头的参考图片。
 * 首尾帧使用定妆主图作为第一张；三视图和九宫格只在主图之后补进剩余槽位。
 */
export const getRefImagesForShot = (
  shot: Shot,
  scriptData: ProjectState['scriptData'],
  options?: { sceneFirst?: boolean; characterMainFirst?: boolean },
): RefImagesResult => {
  const characterImages: string[] = [];
  const sceneImages: string[] = [];
  const propImages: string[] = [];
  const selectedMultiViewImages = new Set<string>();
  const imageRoleByUrl = new Map<string, string>();
  const sceneFirst = options?.sceneFirst === true;
  const characterMainFirst = options?.characterMainFirst === true;

  if (!scriptData) {
    return {
      images: [],
      entries: [],
      imageRoles: [],
      hasTurnaround: false,
      selectedTurnaroundCount: 0,
      droppedTurnaroundCount: 0,
      sceneFirst,
      policyDecisions: [],
    };
  }

  const extraCharacterImages: string[] = [];
  const multiViewImages: string[] = [];
  const entryByUrl = new Map<string, ReferenceImageEntry>();
  const rememberImage = (
    list: string[],
    image: string,
    entry: ReferenceImageEntry,
    role: string,
  ) => {
    const normalizedImage = image.trim();
    if (!normalizedImage || entryByUrl.has(normalizedImage)) return;
    imageRoleByUrl.set(normalizedImage, role);
    entryByUrl.set(normalizedImage, { ...entry, image: normalizedImage });
    list.push(normalizedImage);
  };

  if (shot.characters) {
    shot.characters.forEach(charId => {
      const char = scriptData.characters.find(c => String(c.id) === String(charId));
      if (!char) return;

      const varId = shot.characterVariations?.[charId];
      const variation = varId ? char.variations?.find(v => v.id === varId) : undefined;
      const variationImage = variation?.referenceImage;
      const mainImage = characterMainFirst
        ? (variationImage || char.referenceImage)
        : (variationImage || resolveCharacterDisplayImage(char));
      const sheets = characterMainFirst
        ? [
            char.threeView?.imageUrl ? { image: char.threeView.imageUrl, detail: '三视图定妆照', view: 'threeView' } : undefined,
            char.turnaround?.imageUrl ? { image: char.turnaround.imageUrl, detail: '九宫格定妆照', view: 'turnaround' } : undefined,
          ].filter((item): item is { image: string; detail: string; view: string } => Boolean(item?.image))
        : [];
      const primaryImage = mainImage || sheets[0]?.image;
      if (primaryImage) {
        const usesSheetAsPrimary = !mainImage;
        const primarySheet = usesSheetAsPrimary ? sheets[0] : undefined;
        rememberImage(
          characterImages.length === 0 ? characterImages : extraCharacterImages,
          primaryImage,
          {
            image: primaryImage,
            type: 'character',
            label: char.name || char.id,
            assetId: String(char.id),
            detail: variationImage
              ? `服装变体：${variation?.name || '未命名'}`
              : primarySheet?.detail || '基础定妆照',
          },
          `character:${char.name || char.id}:${variationImage ? 'variation' : primarySheet?.view || 'casting'}`,
        );
        if (usesSheetAsPrimary) selectedMultiViewImages.add(primaryImage.trim());
      }
      if (!characterMainFirst) return;
      sheets.forEach((sheet) => {
        const before = entryByUrl.size;
        rememberImage(
          multiViewImages,
          sheet.image,
          {
            image: sheet.image,
            type: 'turnaround',
            label: char.name || char.id,
            assetId: String(char.id),
            detail: sheet.detail,
          },
          `character:${char.name || char.id}:${sheet.view}`,
        );
        if (entryByUrl.size > before) selectedMultiViewImages.add(sheet.image.trim());
      });
    });
  }

  const scene = findSceneByIdCompat(scriptData.scenes, shot.sceneId);
  if (scene?.referenceImage) {
    sceneImages.push(scene.referenceImage);
    const normalizedImage = scene.referenceImage.trim();
    imageRoleByUrl.set(normalizedImage, `scene:${scene.location || scene.id}`);
    entryByUrl.set(normalizedImage, {
      image: normalizedImage,
      type: 'scene',
      label: scene.location || scene.id,
      assetId: String(scene.id),
      detail: [scene.time, scene.atmosphere].filter(Boolean).join('，'),
    });
  }

  if (shot.props && scriptData.props) {
    shot.props.forEach(propId => {
      const prop = scriptData.props.find(p => String(p.id) === String(propId));
      // Worn garments belong to the character identity. Passing their standalone
      // product images beside the character lookbook creates contradictory outfit
      // references and can make the model copy the garment image instead.
      if (prop && isWornGarmentForShot(prop, shot, scriptData)) return;
      if (prop?.referenceImage) {
        propImages.push(prop.referenceImage);
        const normalizedImage = prop.referenceImage.trim();
        imageRoleByUrl.set(normalizedImage, `prop:${prop.name || prop.id}`);
        entryByUrl.set(normalizedImage, {
          image: normalizedImage,
          type: 'prop',
          label: prop.name || prop.id,
          assetId: String(prop.id),
          detail: prop.description || prop.visualPrompt,
        });
      }
    });
  }

  // 首尾帧：定妆主图在第一位，场景和道具随后，三视图/九宫格只占用剩余槽位。
  // 其他场景画布任务仍把场景放在 Image 1。
  const orderedPrimary = characterMainFirst
    ? [...characterImages, ...extraCharacterImages, ...sceneImages, ...propImages, ...multiViewImages]
    : sceneFirst
      ? [...sceneImages, ...characterImages, ...propImages, ...extraCharacterImages]
      : [...characterImages, ...extraCharacterImages, ...sceneImages, ...propImages];
  const dedupedPrimary = dedupeImageRefs(orderedPrimary);
  const candidateEntries = dedupedPrimary
    .map((img) => entryByUrl.get(img))
    .filter((entry): entry is ReferenceImageEntry => !!entry);
  const resolvedPolicy = resolveShotReferencePolicy(shot, candidateEntries, 9);
  const images = resolvedPolicy.entries.map((entry) => entry.image);
  const selectedTurnaroundCount = images.filter((img) => selectedMultiViewImages.has(img)).length;
  const totalMultiViewCount = dedupedPrimary.filter((img) => selectedMultiViewImages.has(img)).length;

  return {
    images,
    entries: resolvedPolicy.entries,
    imageRoles: images.map((img) => imageRoleByUrl.get(img) || 'unknown'),
    hasTurnaround: selectedTurnaroundCount > 0,
    selectedTurnaroundCount,
    droppedTurnaroundCount: Math.max(0, totalMultiViewCount - selectedTurnaroundCount),
    sceneFirst,
    policyDecisions: resolvedPolicy.decisions,
  };
};

/**
 * 获取镜头关联的道具信息（用于提示词注入）
 * hasImage 标记该道具是否有参考图，用于提示词中区分"参考图一致性"和"文字描述约束"
 */
export interface ShotPropPromptInfo {
  id?: string;
  name: string;
  description: string;
  hasImage: boolean;
  /** 仅在当前镜头确实需要关系约束时生成的短句。 */
  presentationConstraint?: string;
  /** 仅对有明确排除关系的道具追加，避免污染普通道具的负面提示词。 */
  presentationNegativePrompt?: string;
}

const PROP_PRESENTATION_MODES = new Set<PropPresentationMode>([
  'handheld',
  'worn',
  'placed',
  'mounted',
  'background',
  'used',
  'unknown',
]);

const normalizePropPresentationMode = (value: unknown): PropPresentationMode | undefined => {
  const mode = String(value || '').trim().toLowerCase() as PropPresentationMode;
  return PROP_PRESENTATION_MODES.has(mode) ? mode : undefined;
};

/**
 * 兼容旧项目：没有结构化字段时只做保守推断，不把所有道具都强行标成“手持”。
 * 明确的结构化值和镜头覆盖值始终优先于推断。
 */
export const inferPropPresentationMode = (
  prop: {
    name?: string;
    category?: string;
    description?: string;
    visualPrompt?: string;
    isWearable?: boolean;
    presentationMode?: PropPresentationMode;
  },
): PropPresentationMode => {
  const explicit = normalizePropPresentationMode(prop.presentationMode);
  if (explicit && explicit !== 'unknown') return explicit;

  const text = `${prop.name || ''} ${prop.category || ''} ${prop.description || ''} ${prop.visualPrompt || ''}`
    .toLowerCase();
  if (/backpack|rucksack|背包|双肩包|肩背/.test(text)) return 'worn';
  if (prop.isWearable || /worn|wearing|穿戴|佩戴/.test(text)) return 'worn';
  if (/mounted|attached|installed|fixed|挂在墙|安装|固定/.test(text)) return 'mounted';
  if (/background prop|background only|背景道具|背景中/.test(text)) return 'background';
  if (/placed on|on the table|on a table|on the desk|on the ground|on the floor|放在桌|放在地|置于/.test(text)) {
    return 'placed';
  }
  if (/tool bag|canvas bag|briefcase|suitcase|handbag|hand-held|handheld|hand-carried|carried by hand|提包|工具包|手提|手持|握住|拿着/.test(text)) {
    return 'handheld';
  }
  if (/use|operate|press|turn|打开|操作|使用|按下|拨动/.test(text)) return 'used';
  return 'unknown';
};

const resolvePropActorName = (shot: Shot, scriptData: ProjectState['scriptData'], usage?: ShotPropUsage): string => {
  const actorId = usage?.actorId || shot.characters?.[0];
  const actor = actorId
    ? scriptData?.characters.find((character) => String(character.id) === String(actorId))
    : undefined;
  return actor?.name || 'the character';
};

const buildPropPresentationConstraint = (
  prop: NonNullable<ProjectState['scriptData']>['props'][number],
  shot: Shot,
  scriptData: ProjectState['scriptData'],
): string | undefined => {
  const usage = shot.propUsages?.[String(prop.id)];
  const mode = normalizePropPresentationMode(usage?.mode) || inferPropPresentationMode(prop);
  if (mode === 'unknown') return undefined;

  const actor = resolvePropActorName(shot, scriptData, usage);
  const hand = usage?.hand && usage.hand !== 'either' ? ` in the ${usage.hand} hand` : '';
  const position = usage?.position?.trim();
  const action = usage?.action?.trim();
  const note = prop.presentationNote?.trim();
  const customForbidden = [
    ...(prop.forbiddenPresentationModes || []),
    ...(usage?.forbiddenModes || []),
  ].filter(Boolean);

  if (mode === 'handheld') {
    const objectPosition = position || (/bag|case|kit|包|箱/.test(`${prop.name} ${prop.description}`.toLowerCase())
      ? 'beside the character, clearly separate from the back'
      : 'clearly in the character\'s hand');
    const verb = action || 'holds it by its handle';
    const forbidden = customForbidden.length > 0
      ? customForbidden.join(', ')
      : 'backpack, rucksack, shoulder-worn, crossbody, or straps crossing the shoulders';
    return `${actor} ${verb}${hand}; the ${prop.name} is hand-carried at ${objectPosition}. It is not worn on the body. Do not turn it into ${forbidden}.${note ? ` ${note}` : ''}`;
  }
  if (mode === 'worn') {
    return `${actor} wears the ${prop.name} on the body as specified${position ? ` (${position})` : ''}; do not place it in the hands.${note ? ` ${note}` : ''}`;
  }
  if (mode === 'placed') {
    return `The ${prop.name} remains placed ${position || 'in the specified location'} and is not carried by a character.${note ? ` ${note}` : ''}`;
  }
  if (mode === 'mounted') {
    return `The ${prop.name} stays mounted or attached ${position ? `at ${position}` : 'to its specified surface'}; do not show it as a handheld object.${note ? ` ${note}` : ''}`;
  }
  if (mode === 'background') {
    return `The ${prop.name} is background-only ${position ? `at ${position}` : ''}; do not promote it into a foreground carried object.${note ? ` ${note}` : ''}`;
  }
  return `${actor} actively uses the ${prop.name}${position ? ` at ${position}` : ''}${action ? `: ${action}` : ''}.${note ? ` ${note}` : ''}`;
};

const buildPropPresentationNegativePrompt = (
  prop: NonNullable<ProjectState['scriptData']>['props'][number],
  shot: Shot,
): string | undefined => {
  const usage = shot.propUsages?.[String(prop.id)];
  const mode = normalizePropPresentationMode(usage?.mode) || inferPropPresentationMode(prop);
  if (mode !== 'handheld') return undefined;
  const customForbidden = [
    ...(prop.forbiddenPresentationModes || []),
    ...(usage?.forbiddenModes || []),
  ].filter(Boolean);
  return customForbidden.length > 0
    ? customForbidden.join(', ')
    : 'backpack, rucksack, shoulder-worn bag, sling bag, crossbody bag, bag worn on back, shoulder straps crossing the shoulders';
};

export const getPropsInfoForShot = (shot: Shot, scriptData: ProjectState['scriptData']): ShotPropPromptInfo[] => {
  if (!scriptData || !shot.props || !scriptData.props) return [];
  
  return shot.props
    .map(propId => scriptData.props.find(p => String(p.id) === String(propId)))
    .filter((p): p is NonNullable<typeof p> => !!p && !isWornGarmentForShot(p, shot, scriptData))
    .map(p => ({
      id: String(p.id),
      name: p.name,
      description: p.description || p.visualPrompt || '',
      hasImage: !!p.referenceImage,
      presentationConstraint: buildPropPresentationConstraint(p, shot, scriptData),
      presentationNegativePrompt: buildPropPresentationNegativePrompt(p, shot),
    }));
};

/**
 * AI 增强后再次追加锁定事实，防止重写模型把“手提”压缩成泛化的 bag。
 * 只追加存在关系约束的道具，普通静态道具不会增加提示词噪声。
 */
export const appendLockedPropConstraints = (
  prompt: string,
  propsInfo?: ShotPropPromptInfo[],
): string => {
  const constraints = (propsInfo || [])
    .map((prop) => prop.presentationConstraint?.trim())
    .filter(Boolean);
  if (constraints.length === 0) return prompt;
  return `${prompt.trim()}\n\n[LOCKED PROP PRESENTATION — DO NOT CHANGE]\n${constraints.map((item) => `- ${item}`).join('\n')}`;
};

/**
 * 获取镜头主角色参考图（变体优先，其次角色当前选中的定妆图）
 */
export const pickPrimaryCharacterReference = (
  shot: Shot,
  scriptData: ProjectState['scriptData']
): string | undefined => {
  if (!scriptData || !shot.characters?.length) return undefined;

  for (const charId of shot.characters) {
    const char = scriptData.characters.find(c => String(c.id) === String(charId));
    if (!char) continue;

    const varId = shot.characterVariations?.[charId];
    if (varId) {
      const variation = char.variations?.find(v => v.id === varId);
      if (variation?.referenceImage) return variation.referenceImage;
    }

    const selectedImage = resolveCharacterDisplayImage(char);
    if (selectedImage) return selectedImage;
  }
  return undefined;
};

/**
 * 从剧本/分镜数据组装当前镜头、当前帧的文字上下文。
 * 优先使用分镜阶段为 start/end 分别生成的 visualPrompt，再回落到 actionSummary 等字段。
 */
export const buildShotScriptContext = (
  shot: Shot,
  scriptData: ProjectState['scriptData'],
  frameType: 'start' | 'end'
): string => {
  const lines: string[] = [];
  const frameKf = shot.keyframes?.find(k => k.type === frameType);
  const frameVisual = cutKeyframeImagePromptTail(String(frameKf?.visualPrompt || '').trim());
  const hasRenderedMeta = frameVisual.includes(KEYFRAME_META_SPLITTER);
  if (/<image\d+>/i.test(frameVisual)) return frameVisual;

  if (frameVisual && !hasRenderedMeta) {
    lines.push(frameVisual);
  } else {
    const action = String(shot.actionSummary || '').trim();
    if (action) {
      lines.push(
        frameType === 'start'
          ? `${action}（起始瞬间：动作尚未完成，建立初始构图）`
          : `${action}（结束瞬间：动作结果已呈现，构图收束）`
      );
    }
  }

  if (shot.shotSize?.trim()) {
    lines.push(`景别：${shot.shotSize.trim()}`);
  }
  if (shot.cameraMovement?.trim()) {
    lines.push(`运镜：${shot.cameraMovement.trim()}`);
  }
  if (shot.dialogue?.trim()) {
    lines.push(`对白：${shot.dialogue.trim()}`);
  }
  const continuityLedger = formatContinuityLedgerForPrompt(shot.agent?.continuityLedger);
  if (continuityLedger) lines.push(`结构化连续性状态：${continuityLedger}`);

  if (scriptData) {
    const productionBible = formatProductionBibleForPrompt(scriptData);
    if (productionBible) lines.push(productionBible);
    const scene = findSceneByIdCompat(scriptData.scenes, shot.sceneId);
    if (scene) {
      const sceneParts = [scene.location, scene.time, scene.atmosphere]
        .map(v => String(v || '').trim())
        .filter(Boolean);
      if (sceneParts.length > 0) {
        lines.push(`场景：${sceneParts.join('，')}`);
      }
      if (scene.spatialTopology) {
        lines.push(`场景拓扑：${JSON.stringify(scene.spatialTopology)}`);
      }
    }

    if (shot.characters?.length) {
      const names = shot.characters
        .map(charId => scriptData.characters.find(c => String(c.id) === String(charId)))
        .filter((char): char is NonNullable<typeof char> => !!char);
      if (names.length > 0) {
        lines.push(`出镜角色：${names.map(c => c.name).join('、')}`);
        names.forEach(char => {
          const variationId = shot.characterVariations?.[char.id];
          const variation = variationId
            ? char.variations?.find(item => String(item.id) === String(variationId))
            : undefined;
          const wardrobe = String(
            variation?.wardrobe || variation?.visualPrompt || char.wardrobe || ''
          ).trim();
          if (wardrobe) {
            lines.push(
              `${char.name}服装锁定${variation ? `（${variation.name}）` : '（基础造型）'}：${wardrobe.slice(0, 360)}。该描述优先于旧分镜提示词中的冲突服装信息。`
            );
          }
          // 已有定妆图时不要把 visualPrompt 再写进镜头：文字发型/服装会和照片打架
          if (char.referenceImage) return;
          const look = String(char.visualPrompt || char.coreFeatures || '').trim();
          if (look) {
            lines.push(`${char.name}外观：${look.slice(0, 280)}`);
          }
        });
      }
    }
  }

  return lines.join('\n').trim() || '镜头画面';
};

/**
 * 构建关键帧提示词 - 简化版
 * 为起始帧和结束帧生成基础的视觉描述
 * @param propsInfo - 可选，镜头关联的道具信息列表
 */
export const buildKeyframePrompt = (
  basePrompt: string,
  visualStyle: string,
  cameraMovement: string,
  frameType: 'start' | 'end',
  propsInfo?: ShotPropPromptInfo[],
  promptTemplates?: PromptTemplateConfig,
  sceneFirst: boolean = false,
): string => {
  const templates = promptTemplates || resolvePromptTemplateConfig();
  const stylePrompt = VISUAL_STYLE_PROMPTS[visualStyle] || visualStyle;
  const cameraGuide = getCameraMovementCompositionGuide(cameraMovement, frameType);
  const startFrameGuideTemplate = withTemplateFallback(
    templates.keyframe.startFrameGuide,
    DEFAULT_PROMPT_TEMPLATE_CONFIG.keyframe.startFrameGuide
  );
  const endFrameGuideTemplate = withTemplateFallback(
    templates.keyframe.endFrameGuide,
    DEFAULT_PROMPT_TEMPLATE_CONFIG.keyframe.endFrameGuide
  );
  const characterConsistencyTemplate = sceneFirst
    ? `【角色一致性要求】CHARACTER CONSISTENCY REQUIREMENTS - CRITICAL
⚠️ Refer to the generated REFERENCE IMAGE MAPPING below for the actual image count, order, and role. Do not assume a fixed Image 1/Image 2 layout.
• Scene references establish the place, lighting, and spatial layout; never render a studio portrait or arrange characters against a neutral background.
• Every character reference locks only that named character’s face, hair, body, and wardrobe. Do not merge identities, duplicate subjects, or copy a studio pose.
• Add a listed carried prop from its prop reference when present; its absence from a character reference never forbids it.`
    : withTemplateFallback(
        templates.keyframe.characterConsistencyGuide,
        DEFAULT_PROMPT_TEMPLATE_CONFIG.keyframe.characterConsistencyGuide
      );
  const propWithImageTemplate = withTemplateFallback(
    templates.keyframe.propWithImageGuide,
    DEFAULT_PROMPT_TEMPLATE_CONFIG.keyframe.propWithImageGuide
  );
  const propWithoutImageTemplate = withTemplateFallback(
    templates.keyframe.propWithoutImageGuide,
    DEFAULT_PROMPT_TEMPLATE_CONFIG.keyframe.propWithoutImageGuide
  );
  
  // 针对起始帧和结束帧的特定指导
  const frameSpecificGuide = frameType === 'start'
    ? startFrameGuideTemplate
    : endFrameGuideTemplate;

  // 角色一致性要求（定妆不含英雄道具，镜头阶段再按参考图加入）
  const characterConsistencyGuide = `${characterConsistencyTemplate}

【定妆说明】定妆图锁定主体外观和身体结构，不含英雄道具。若本镜头列出了道具，按道具参考图加入；未列出则不要发明随身道具。不要因为定妆图没有某件道具就禁止它出现，也不要另发明一件不同的道具。`;

  // 道具一致性要求（仅在有道具时添加）
  let propConsistencyGuide = '';
  if (propsInfo && propsInfo.length > 0) {
    const propsWithImage = propsInfo.filter(p => p.hasImage);
    const propsWithoutImage = propsInfo.filter(p => !p.hasImage);

    let sections: string[] = [];

    // 有参考图的道具：要求严格遵循参考图
    if (propsWithImage.length > 0) {
      const list = propsWithImage
        .map(p => `- ${p.name}: ${p.description}${p.presentationConstraint ? `\n  Presentation lock: ${p.presentationConstraint}` : ''}`)
        .join('\n');
      sections.push(
        renderPromptTemplate(propWithImageTemplate, { propList: list })
      );
    }

    // 无参考图的道具：仅文字描述约束
    if (propsWithoutImage.length > 0) {
      const list = propsWithoutImage
        .map(p => `- ${p.name}: ${p.description}${p.presentationConstraint ? `\n  Presentation lock: ${p.presentationConstraint}` : ''}`)
        .join('\n');
      sections.push(
        renderPromptTemplate(propWithoutImageTemplate, { propList: list })
      );
    }

    propConsistencyGuide = `

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
【道具一致性要求】PROP CONSISTENCY REQUIREMENTS
${sections.join('\n\n')}`;
  }

  return `${basePrompt}${KEYFRAME_META_SPLITTER}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
【视觉风格】Visual Style
${stylePrompt}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
【镜头运动】Camera Movement
${cameraMovement} (${frameType === 'start' ? 'Initial Frame 起始帧' : 'Final Frame 结束帧'})

【构图指导】Composition Guide
${cameraGuide}

${frameSpecificGuide}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${characterConsistencyGuide}${propConsistencyGuide}`;
};

const COMPILED_FRAME_MARKER = '【本帧画面描述】';
const KEYFRAME_PROMPT_TAIL = /\n(?:景别：|运镜：|结构化连续性状态：|\[PRODUCTION BIBLE)/;

/** 编辑框回退时会把景别、运镜、全剧圣经和参考图映射接在静帧提示词后面，这里切掉。 */
export const cutKeyframeImagePromptTail = (value: string): string => {
  let current = String(value || '').trim();
  const mappingStart = current.search(/(?:^|\n)\s*(?:【本次参考图映射】|REFERENCE IMAGE MAPPING)/i);
  if (mappingStart === 0) return '';
  if (mappingStart > 0) current = current.slice(0, mappingStart).trim();
  const tail = current.search(KEYFRAME_PROMPT_TAIL);
  if (tail > 0) current = current.slice(0, tail).trim();
  return current;
};
const LOCKED_CHARACTER_BLOCK = /\n*\[LOCKED CHARACTER COUNT — DO NOT CHANGE\][\s\S]*$/i;
const COMPILED_SECTION_AFTER_DESCRIPTION = /(?:^|\s)【(?:必须出现|本帧结构化|本帧关键道具|关键道具|必须满足|禁止自动|镜头与构图|视觉风格|首帧要求|尾帧要求|连续性锁定|画面限制|构图站位锁定|人物表情|人物站位|本帧剧情|任务)】/u;
const START_FRAME_RESULT_CONSTRAINT = /回到|收回|落入|锁定|穿过|穿入|劈开|裂开|悬停|已经完成|returns?\b|already\b|locks?\b/iu;

const BLOCKING_WORDS: Record<string, string> = {
  left: '画面左侧',
  right: '画面右侧',
  center: '画面中央',
  middle: '画面中央',
  foreground: '前景',
  midground: '中景',
  background: '后景',
};

/** 把分镜模型留下的 left/foreground/toward 收成中文方位，长句只替换明确方位词。 */
const localizeBlockingPhrase = (value?: string): string => {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';
  const exact = BLOCKING_WORDS[trimmed.toLowerCase()];
  if (exact) return exact;
  return trimmed
    .replace(/\btoward screen upper right\b/gi, '画面右上方')
    .replace(/\btoward screen upper left\b/gi, '画面左上方')
    .replace(/\btoward screen right\b/gi, '画面右侧')
    .replace(/\btoward screen left\b/gi, '画面左侧')
    .replace(/\btoward\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
};

/**
 * 再次生图时，上一份 Qwen 编译结果不能再当作画面描述。
 * 只留下最内层【本帧画面描述】；映射和角色数量锁由调用方重新附加。
 */
export const unwrapCompiledKeyframeDescription = (fullPrompt: string): string => {
  let current = cutKeyframeImagePromptTail(fullPrompt);
  if (!current) return '';
  const mappingStart = current.search(/(?:^|\n)\s*(?:【本次参考图映射】|REFERENCE IMAGE MAPPING)/i);
  if (mappingStart === 0) return '';
  if (mappingStart > 0) current = current.slice(0, mappingStart).trim();
  current = current.replace(LOCKED_CHARACTER_BLOCK, '').trim();
  if (!current.includes('【任务】') && !current.includes(COMPILED_FRAME_MARKER)) return current;

  for (let depth = 0; depth < 8; depth += 1) {
    const markerAt = current.lastIndexOf(COMPILED_FRAME_MARKER);
    if (markerAt < 0) break;
    let body = current.slice(markerAt + COMPILED_FRAME_MARKER.length).trim();
    if (!body.includes(COMPILED_FRAME_MARKER)) {
      const nextSection = body.search(COMPILED_SECTION_AFTER_DESCRIPTION);
      if (nextSection > 0) body = body.slice(0, nextSection).trim();
    }
    current = body.replace(LOCKED_CHARACTER_BLOCK, '').trim();
    if (!current.includes(COMPILED_FRAME_MARKER) && !current.startsWith('【任务】')) break;
  }
  if (!current || current.startsWith('【任务】') || current.includes(COMPILED_FRAME_MARKER)) return '';
  return current;
};

/** 整镜 required 里描述动作结果的条目只留给尾帧，避免首帧被要求提前完成。 */
const constraintsForFrame = (required: string[], frameType: 'start' | 'end'): string[] => {
  if (frameType === 'end') return required;
  return required.filter((item) => !START_FRAME_RESULT_CONSTRAINT.test(item));
};

const propHandLabel = (hand?: string): string => {
  if (hand === 'left') return '左手';
  if (hand === 'right') return '右手';
  if (hand === 'both') return '双手';
  return '';
};

export interface QwenImage21KeyframeBrief {
  frameLabel: '首帧' | '尾帧';
  storyState: string;
  frameSentence: string;
  characters: Array<{
    name: string;
    count: number;
    position: string;
    depth: string;
    facing: string;
    gaze: string;
    action: string;
    expression: string;
  }>;
  props: Array<{
    name: string;
    hasReference: boolean;
    holder: string;
    hand: string;
    position: string;
    state: string;
    appearance: string;
  }>;
  requiredFacts: string[];
  forbiddenProps: string[];
  framing: string;
  style: string;
  references: Array<{
    tag: string;
    role: 'scene' | 'character' | 'prop' | 'continuity' | 'turnaround';
    name: string;
    note: string;
  }>;
}

const staticFraming = (shotSize?: string, cameraMovement?: string): string => {
  const size = String(shotSize || '').trim();
  const angle = String(cameraMovement || '')
    .replace(/\b(slow\s+)?(push\s+in|pull\s+out|dolly|pan|tilt|zoom|track|crane|whip)\b/gi, '')
    .replace(/缓慢|推近|推进|拉远|拉出|横摇|摇镜|跟拍|变焦/g, '')
    .replace(/\s*\+\s*/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return [size, angle].filter(Boolean).join('，');
};

/**
 * 只抽出这一帧必须遵守的事实，不写成会互相打架的提示词。
 * 参考图顺序必须与实际提交顺序一致。
 */
export const buildQwenImage21KeyframeBrief = (
  basePrompt: string,
  shot: Shot,
  frameType: 'start' | 'end',
  visualStyle: string,
  references: Array<{ type?: string; label?: string; detail?: string }>,
  propsInfo?: ShotPropPromptInfo[],
  characterLabels?: Record<string, string>,
  propLabels?: Record<string, string>,
): QwenImage21KeyframeBrief => {
  const frameDirection = shot.frameDirections?.[frameType];
  const unwrapped = unwrapCompiledKeyframeDescription(basePrompt);
  const frameSentence = unwrapped && !unwrapped.includes('【任务】') && unwrapped.length <= 900
    ? unwrapped
    : '';
  const labelForCharacter = (characterId?: string): string => {
    if (!characterId) return '';
    return characterLabels?.[String(characterId)] || (String(characterId).startsWith('char-') ? '' : String(characterId));
  };
  const labelForProp = (propId: string): string => propLabels?.[propId] || (propsInfo || []).find((prop) => prop.id === propId)?.name || '';
  const structuredByName = new Map(Object.entries(frameDirection?.propStates || {}).map(([propId, state]) => {
    const name = labelForProp(propId);
    return [name, state] as const;
  }).filter(([name]) => Boolean(name)));
  const listedProps = (propsInfo || []).map((prop) => {
    const state = structuredByName.get(prop.name);
    return {
      name: prop.name,
      hasReference: prop.hasImage,
      holder: labelForCharacter(state?.holderCharacterId),
      hand: propHandLabel(state?.hand),
      position: localizeBlockingPhrase(state?.position),
      state: String(state?.state || '').trim(),
      appearance: shortenPropAppearanceDetail(prop.description),
    };
  });
  const referenceFacts = references.map((entry, index) => {
    const type = String(entry.type || '');
    const role: QwenImage21KeyframeBrief['references'][number]['role'] =
      type === 'scene' || type === 'character' || type === 'prop' || type === 'continuity' || type === 'turnaround'
        ? type
        : 'character';
    return {
      tag: `<image${index + 1}>`,
      role,
      name: String(entry.label || '').trim(),
      note: shortenPropAppearanceDetail(entry.detail || ''),
    };
  });
  return {
    frameLabel: frameType === 'start' ? '首帧' : '尾帧',
    storyState: String(frameDirection?.storyState || '').trim(),
    frameSentence,
    characters: (frameDirection?.characterBlocking || []).map((item) => ({
      name: labelForCharacter(item.characterId) || String(item.characterId),
      count: item.count && item.count > 1 ? item.count : 1,
      position: localizeBlockingPhrase(item.position),
      depth: localizeBlockingPhrase(item.depth),
      facing: localizeBlockingPhrase(item.facing),
      gaze: localizeBlockingPhrase(item.gaze),
      action: String(item.action || '').trim(),
      expression: String(item.expression || '').trim(),
    })).filter((item) => item.name),
    props: listedProps,
    requiredFacts: constraintsForFrame((shot.constraintPolicy?.required || []).filter(Boolean), frameType),
    forbiddenProps: (shot.constraintPolicy?.forbiddenProps || []).map((propId) => labelForProp(String(propId)) || String(propId)).filter(Boolean),
    framing: staticFraming(shot.shotSize, shot.cameraMovement),
    style: String(visualStyle || '').trim(),
    references: referenceFacts,
  };
};

/**
 * Qwen Image Edit 的首尾帧编译器。
 *
 * Qwen 对“本帧发生什么、人物怎样站、看向哪里、道具与谁发生关系”的直接描述
 * 比通用模型使用的大段元规则更稳定。这里消费分镜 Agent 已有的执行计划；旧分镜
 * 没有这些字段时仍会回退到 actionSummary / visualPrompt，因此无需迁移旧数据。
 * 参考图槽位映射由调用方按实际提交图片追加，避免在这里写死 Image 1/2 顺序。
 */
export const buildQwenKeyframePrompt = (
  basePrompt: string,
  shot: Shot,
  frameType: 'start' | 'end',
  visualStyle: string,
  propsInfo?: ShotPropPromptInfo[],
  characterLabels?: Record<string, string>,
  propLabels?: Record<string, string>,
): string => {
  const continuity = shot.agent?.continuity;
  const frameDirection = shot.frameDirections?.[frameType];
  const frameLabel = frameType === 'start' ? '首帧' : '尾帧';
  const sourcePrompt = unwrapCompiledKeyframeDescription(basePrompt) || basePrompt;
  // visualPrompt 是当前帧最可靠的静态事实。executionPlan / subjectBlocking 可能
  // 描述完整运动过程，不能直接写进首帧或尾帧，否则会出现“尚未拿起但已手持”的矛盾。
  const frameState = frameDirection?.storyState?.trim();
  const blockingLines = (frameDirection?.characterBlocking || [])
    .map((item: ShotCharacterBlocking) => {
      const count = item.count && item.count > 1 ? `，数量${item.count}` : '';
      const label = characterLabels?.[String(item.characterId)] || item.characterId;
      return `- ${label}${count}：${[
        localizeBlockingPhrase(item.position),
        localizeBlockingPhrase(item.depth),
        item.facing ? `朝向${localizeBlockingPhrase(item.facing)}` : '',
        item.gaze ? `视线${localizeBlockingPhrase(item.gaze)}` : '',
        item.action,
        item.expression ? `表情${item.expression}` : '',
      ].filter(Boolean).join('，')}`;
    })
    .join('\n');
  const blockingConstraint = blockingLines
    ? '【构图站位锁定】严格遵循上方人物的屏幕左右位置、前景/中景/后景层次、彼此距离与朝向；不得因为参考图中的原始构图而交换人物左右位置，不得把配角放到主角的站位。'
    : /(?:左侧|左前景|左中景|画面左|右侧|右前景|右中景|画面右)/u.test(sourcePrompt)
      ? '【构图站位锁定】严格遵循本帧画面描述中已经指定的屏幕左右位置、前中后景层次和人物之间的距离；不得因为参考图中的原始构图而交换人物左右位置，不得把配角放到主角的站位。'
      : '';
  const continuityText = (continuity?.mustPreserve || []).join(' ');
  const baseIndicatesPreUse = frameType === 'start' && /尚未|未(?:完全)?(?:拿起|握住|持有|抬起)|探向|靠在|树旁|正要|还没有|not yet|reaching for|beside the tree|starts beside|on the ground|not held/i.test(`${sourcePrompt} ${continuityText}`);
  const frameDescription = baseIndicatesPreUse
    ? sourcePrompt
        .replace(/手已(?:扣住|握住|握紧)棒柄[，,、；;]?\s*棒身斜靠肩侧/gu, '手正伸向树旁的金箍棒，尚未握住棒柄；棒身仍位于树旁地面')
        .replace(/(?:已|已经)握住(?:金箍棒|棒柄)[，,、；;]?\s*棒身(?:斜靠|靠在)肩侧/gu, '手尚未握住金箍棒，金箍棒仍位于树旁地面')
        .replace(/holds?\s+(?:the\s+)?(?:golden\s+)?cudgel[^.]*?(?:shoulder|held)/giu, 'reaches toward the cudgel beside the tree; the cudgel remains on the ground and is not held')
    : sourcePrompt;
  const propLines = (propsInfo || [])
    .map((prop) => {
      const relationship = baseIndicatesPreUse ? undefined : prop.presentationConstraint?.trim();
      if (relationship) return `- ${prop.name}：${relationship}`;
      return `- ${prop.name}：${shortenPropAppearanceDetail(prop.description) || '按本帧状态出现，不要提前画成后续镜头的结果。'}`;
    })
    .join('\n');
  const labelForProp = (propId: string): string => propLabels?.[propId] || (propsInfo || []).find((prop) => prop.id === propId)?.name || propId;
  const labelForCharacter = (characterId?: string): string => {
    if (!characterId) return '';
    return characterLabels?.[String(characterId)] || (String(characterId).startsWith('char-') ? '' : String(characterId));
  };
  const structuredPropLines = Object.entries(frameDirection?.propStates || {})
    .map(([propId, state]: [string, ShotPropFrameState]) => `- ${labelForProp(propId)}：${[
      labelForCharacter(state.holderCharacterId) ? `持有者${labelForCharacter(state.holderCharacterId)}` : '',
      propHandLabel(state.hand),
      localizeBlockingPhrase(state.position),
      state.state,
      state.visible === false ? '本帧不可见' : state.visible === true ? '本帧必须可见' : '',
    ].filter(Boolean).join('，')}`)
    .join('\n');
  const requiredConstraints = constraintsForFrame((shot.constraintPolicy?.required || []).filter(Boolean), frameType);
  const forbiddenProps = (shot.constraintPolicy?.forbiddenProps || [])
    .filter(Boolean)
    .map((item) => propLabels?.[item] || item);
  const requiredCharacterNames = (shot.characters || [])
    .map((id) => characterLabels?.[String(id)] || String(id))
    .filter(Boolean);
  const countFacts = (frameDirection?.characterBlocking || [])
    .filter((item) => Number(item.count) > 1)
    .map((item) => `${characterLabels?.[String(item.characterId)] || item.characterId}必须出现${item.count}名`);
  const inferredCount = sourcePrompt.match(/(?:两名|两位|两个)\s*([\u4e00-\u9fff]{1,8})/u);
  if (!countFacts.length && inferredCount?.[1]) countFacts.push(`${inferredCount[1]}必须出现两名`);
  const propsWithImage = (propsInfo || []).filter((prop) => prop.hasImage).map((prop) => prop.name).filter(Boolean);
  const propsWithoutImage = (propsInfo || []).filter((prop) => !prop.hasImage).map((prop) => prop.name).filter(Boolean);
  const requiredPropSentence = [
    propsWithImage.length ? `有参考图、必须出现：${propsWithImage.join('、')}。这些道具严格遵循对应参考图。` : '',
    propsWithoutImage.length ? `没有参考图、仍必须按本帧文字状态出现：${propsWithoutImage.join('、')}。不要另发明一件。` : '',
  ].filter(Boolean).join('');
  const mustPreserveItems = (continuity?.mustPreserve || [])
    .filter(Boolean)
    .filter((item) => {
      // 这些是首帧进入状态，不应原样带入尾帧；尾帧的 propState/画面描述
      // 会提供动作完成后的状态。
      if (frameType !== 'end') return true;
      return !/starts?\s+(?:beside|near)\s+the\s+tree|树旁|地面|尚未(?:拿起|握住)|not held|not yet|未使用/i.test(item);
    });
  const mustPreserve = mustPreserveItems.join('、');
  const camera = `${shot.shotSize || '合适景别'}，${shot.cameraMovement || '稳定机位'}`;
  const style = VISUAL_STYLE_PROMPTS[visualStyle] || visualStyle;

  const sections = [
    `【任务】根据提供的参考图生成一张${frameLabel}，用于同一镜头的连续叙事。严格按照参考图映射分配身份，禁止角色之间交换脸部、服装、颜色或道具属性。`,
    // 只有明确保存的帧级状态才单列。否则 visualPrompt 已是该帧的完整事实，
    // 重复一次会浪费提示词预算，也可能让全镜头的抽象剧情意图覆盖静态画面。
    frameState ? `【本帧剧情状态】${frameState}` : '',
    blockingLines ? `【人物站位、朝向与动作】\n${blockingLines}` : frameDirection?.blocking ? `【人物站位、朝向与动作】${frameDirection.blocking}` : '',
    blockingConstraint,
    frameDirection?.performance ? `【人物表情与表演】${frameDirection.performance}` : '',
    `【本帧画面描述】${frameDescription.trim()}`,
    requiredCharacterNames.length
      ? `【必须出现的角色】画面中必须出现：${requiredCharacterNames.join('、')}。${countFacts.length ? `${countFacts.join('；')}。未标数量的角色各出现一名，不得把群演合并成一个人，也不得复制未标数量的角色。` : '每个角色只出现一名，不得省略、合并或复制。'}`
      : '',
    requiredPropSentence ? `【必须出现的道具】${requiredPropSentence}每件道具只按本帧状态出现，不得替换为其他物体。` : '',
    structuredPropLines ? `【本帧结构化道具状态】\n${structuredPropLines}` : frameDirection?.propState
      ? `【本帧关键道具状态】${frameDirection.propState}`
      : baseIndicatesPreUse && propsInfo?.length
      ? `【本帧关键道具状态】${propsInfo.map((prop) => `${prop.name}保持本帧和连续性锁定所述的树旁/地面/未使用状态，完整横卧在地面并与人物身体保持间隔，不能竖立、漂浮、悬挂或提前被拿起；若其他描述与此冲突，以本帧静态状态为准；外观严格遵循对应道具参考图。`).join(' ')}`
        : propLines ? `【关键道具关系】\n${propLines}` : '',
    requiredConstraints.length ? `【必须满足】\n${requiredConstraints.map((item) => `- ${item}`).join('\n')}` : '',
    forbiddenProps.length ? `【禁止自动添加】${forbiddenProps.join('、')}` : '',
    `【镜头与构图】${camera}`,
    `【视觉风格与光影】${style}`,
    frameType === 'start'
      ? '【首帧要求】清楚呈现动作发生前或刚开始的可读状态、人物视线和下一步动作的动势；不要提前表现动作结果。'
      : '【尾帧要求】清楚呈现本镜头动作完成后的结果、人物关系和情绪变化；必须与首帧保持同一角色、服装、道具、场景锚点和光照逻辑。',
    mustPreserve ? `【连续性锁定】${mustPreserve}` : '',
    '【画面限制】保持单一连贯电影画面；不要拼贴、分屏、镜像、重复人物、文字、字幕或水印。未列入本镜头的道具不要自行添加。',
  ].filter(Boolean);

  let compiled = sections.join('\n\n');
  // 最终防线：旧镜头或 AI 优化结果可能在画面描述、连续性描述之外再次出现
  // “已扣住/斜靠肩侧”。首帧既然锁定为未取棒，这些表述不能留在最终请求中。
  if (baseIndicatesPreUse) {
    compiled = compiled
      .replace(/手已(?:扣住|握住|握紧)棒柄/gu, '手正伸向树旁金箍棒，尚未握住棒柄')
      .replace(/棒身斜靠肩侧/gu, '金箍棒仍位于树旁地面')
      .replace(/(?:已经|已)握住(?:金箍棒|棒柄)/gu, '尚未握住金箍棒')
      .replace(/(?:holds?|grips?)\s+(?:the\s+)?(?:golden\s+)?cudgel/giu, 'reaches toward the cudgel beside the tree; does not hold it');
  }
  return compiled;
};

/**
 * 构建关键帧提示词 - AI增强版
 * 使用LLM动态生成详细的技术规格和视觉细节
 * @param basePrompt - 基础提示词
 * @param visualStyle - 视觉风格
 * @param cameraMovement - 镜头运动
 * @param frameType - 帧类型
 * @param enhanceWithAI - 是否使用AI增强(默认true)
 * @param propsInfo - 可选，镜头关联的道具信息列表
 * @returns 返回完整的提示词或Promise
 */
export const buildKeyframePromptWithAI = async (
  basePrompt: string,
  visualStyle: string,
  cameraMovement: string,
  frameType: 'start' | 'end',
  enhanceWithAI: boolean = true,
  propsInfo?: ShotPropPromptInfo[],
  promptTemplates?: PromptTemplateConfig,
  sceneFirst: boolean = false,
): Promise<string> => {
  // 先构建基础提示词
  const basicPrompt = buildKeyframePrompt(
    basePrompt,
    visualStyle,
    cameraMovement,
    frameType,
    propsInfo,
    promptTemplates,
    sceneFirst,
  );
  
  // 如果不需要AI增强,直接返回基础提示词
  if (!enhanceWithAI) {
    return appendLockedPropConstraints(basicPrompt, propsInfo);
  }
  
  // Use direct import from aiService; keep fallback behavior if enhancement fails.
  try {
    const enhanced = await enhanceKeyframePrompt(basicPrompt, visualStyle, cameraMovement, frameType, undefined, promptTemplates);
    return appendLockedPropConstraints(enhanced, propsInfo);
  } catch (error) {
    console.error('AI增强失败,使用基础提示词:', error);
    return appendLockedPropConstraints(basicPrompt, propsInfo);
  }
};

/**
 * 构建视频生成提示词
 * @param visualStyle - 项目视觉风格，用于给视频生成添加风格锚点
 * @param nineGrid - 可选，如果首帧来自九宫格整图，则使用九宫格分镜模式的视频提示词
 * @param videoDuration - 视频总时长（秒），用于计算九宫格模式下每个面板的停留时间
 */
const MAX_VIDEO_PROMPT_CHARS = 5000;
const NINE_GRID_VIDEO_GUARDRAIL_MARKER = '[NINE_GRID_FULLSCREEN_SEQUENCE_RULES_V2]';

const normalizePromptField = (input: string): string =>
  String(input || '')
    .replace(/\r/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const isChineseLanguage = (language: string): boolean => {
  const normalized = String(language || '').trim().toLowerCase();
  return normalized === '中文' || normalized === 'chinese' || normalized.startsWith('zh');
};

const compactPromptField = (
  input: string,
  maxChars: number,
  maxWords: number
): string => {
  const normalized = normalizePromptField(input);
  if (!normalized) return '';

  let candidate = normalized;
  const words = candidate.split(/\s+/).filter(Boolean);
  if (words.length > maxWords) {
    candidate = words.slice(0, maxWords).join(' ');
  }

  const chars = Array.from(candidate);
  if (chars.length > maxChars) {
    candidate = chars.slice(0, maxChars).join('');
  }

  candidate = candidate.replace(/[,\s;:.!?]+$/g, '');
  return candidate.length < normalized.length ? `${candidate}...` : candidate;
};

const buildNineGridVideoGuardrails = (
  panelCount: number,
  language: string,
  promptTemplates?: PromptTemplateConfig
): string => {
  const count = Math.max(1, Math.floor(panelCount || 1));
  const templates = promptTemplates || resolvePromptTemplateConfig();
  const template = isChineseLanguage(language)
    ? withTemplateFallback(
        templates.video.nineGridGuardrailsChinese,
        DEFAULT_PROMPT_TEMPLATE_CONFIG.video.nineGridGuardrailsChinese
      )
    : withTemplateFallback(
        templates.video.nineGridGuardrailsEnglish,
        DEFAULT_PROMPT_TEMPLATE_CONFIG.video.nineGridGuardrailsEnglish
      );

  const guardrails = renderPromptTemplate(template, { panelCount: count });
  return `${NINE_GRID_VIDEO_GUARDRAIL_MARKER}
${guardrails}`;
};

export const ensureNineGridVideoPromptGuardrails = (
  prompt: string,
  panelCount: number,
  language: string,
  promptTemplates?: PromptTemplateConfig
): string => {
  const base = String(prompt || '').trim();
  if (!base) return base;
  if (base.includes(NINE_GRID_VIDEO_GUARDRAIL_MARKER)) return base;
  return `${base}

${buildNineGridVideoGuardrails(panelCount, language, promptTemplates)}`;
};

const buildNineGridPanelDescriptionsWithBudget = (
  panels: NineGridPanel[],
  budgetChars: number
): string => {
  if (!panels.length) return '';

  const prefixes = panels.map((panel, idx) => {
    const shotSize = normalizePromptField(panel.shotSize) || 'shot';
    const cameraAngle = normalizePromptField(panel.cameraAngle) || 'angle';
    return `${idx + 1}. [FULLSCREEN] ${shotSize}/${cameraAngle} - `;
  });

  const overhead = prefixes.reduce((sum, prefix) => sum + Array.from(prefix).length, 0) + Math.max(0, panels.length - 1);
  const availableForDescriptions = Math.max(9 * 28, budgetChars - overhead);
  const perPanelChars = Math.max(28, Math.floor(availableForDescriptions / panels.length));
  const perPanelWords = Math.max(8, Math.min(24, Math.floor(perPanelChars / 5)));

  return panels
    .map((panel, idx) => {
      const description = compactPromptField(panel.description, perPanelChars, perPanelWords);
      return `${prefixes[idx]}${description || 'subject action and composition continuity.'}`;
    })
    .join('\n');
};

const fitVideoPromptLength = (input: string, maxChars: number = MAX_VIDEO_PROMPT_CHARS): string => {
  let prompt = String(input || '')
    .replace(/\r/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  const length = () => Array.from(prompt).length;
  if (length() <= maxChars) return prompt;

  prompt = prompt
    .split('\n')
    .map((line) => {
      if (Array.from(line).length <= 220) return line;
      return compactPromptField(line, 200, 42);
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (length() <= maxChars) return prompt;

  const chars = Array.from(prompt);
  const hardCut = chars.slice(0, maxChars).join('');
  const breakpoints = ['\n\n', '\n', '. ', '; '];
  let best = -1;
  breakpoints.forEach((marker) => {
    const idx = hardCut.lastIndexOf(marker);
    if (idx > best) best = idx;
  });

  if (best > Math.floor(maxChars * 0.6)) {
    return hardCut.slice(0, best).trimEnd();
  }

  return hardCut.trimEnd();
};

export const buildVideoPrompt = (
  actionSummary: string,
  cameraMovement: string,
  videoModel: string,
  language: string,
  visualStyle: string,
  nineGrid?: NineGridData,
  videoDuration?: number,
  context?: VideoPromptContext,
  promptTemplates?: PromptTemplateConfig
): string => {
  const templates = promptTemplates || resolvePromptTemplateConfig();
  const isChinese = isChineseLanguage(language);
  const stylePrompt = VISUAL_STYLE_PROMPTS[visualStyle] || visualStyle;
  const visualStyleAnchor = compactPromptField(`${visualStyle} (${stylePrompt})`, 220, 40);
  const compactActionSummary = compactPromptField(actionSummary, 900, 160);
  const compactCameraMovement = compactPromptField(cameraMovement, 220, 48);
  
  const routing = resolveVideoModelRouting(videoModel);
  const hasUsableEndFrame = !!context?.hasEndFrame && routing.supportsEndFrame;
  const hasIgnoredEndFrame = !!context?.hasEndFrame && !routing.supportsEndFrame;

  const endFrameConstraintTemplate = withTemplateFallback(
    templates.video.endFrameConstraintNote,
    DEFAULT_PROMPT_TEMPLATE_CONFIG.video.endFrameConstraintNote
  );
  const ignoredEndFrameTemplate = withTemplateFallback(
    templates.video.ignoredEndFrameNote,
    DEFAULT_PROMPT_TEMPLATE_CONFIG.video.ignoredEndFrameNote
  );

  const appendCapabilityNotes = (prompt: string): string => {
    const endFrameConstraint = hasUsableEndFrame
      ? `

${renderPromptTemplate(endFrameConstraintTemplate, {})}`
      : '';
    const ignoredEndFrameNote = hasIgnoredEndFrame
      ? `

${renderPromptTemplate(ignoredEndFrameTemplate, {})}`
      : '';
    const withCapabilityNotes = `${prompt}${endFrameConstraint}${ignoredEndFrameNote}`;
    // H3 accepts its official skill fields only. Appending the generic policy
    // block after those fields makes the prompt less canonical and can cause
    // later audio normalization to treat trailing policy text as music content.
    if (isMiniMaxH3VideoModel(videoModel)) {
      const h3CapabilityNotes = [
        hasUsableEndFrame ? renderPromptTemplate(endFrameConstraintTemplate, {}) : '',
        hasIgnoredEndFrame ? renderPromptTemplate(ignoredEndFrameTemplate, {}) : '',
      ].filter(Boolean).join(' ');
      const h3Prompt = h3CapabilityNotes
        ? prompt.replace(
            /\n\s*\noverall_soundscape:/u,
            ` ${h3CapabilityNotes}\n\noverall_soundscape:`,
          )
        : prompt;
      return fitVideoPromptLength(
        finalizeMiniMaxH3VideoPrompt(h3Prompt, context?.nativeAudio, language),
      );
    }
    const selectedModel = getModelById(videoModel);
    const policyBlock = buildVideoPromptPolicyBlock({
      modelId: videoModel,
      policyOverride:
        selectedModel?.type === 'video' ? selectedModel.params.promptPolicy : undefined,
      language,
      hasEndFrame: !!context?.hasEndFrame,
      hasStoryboardGrid: !!nineGrid,
      panelCount: nineGrid?.panels?.length,
      durationSeconds: videoDuration,
    });
    const policyAwarePrompt = hasVideoPromptPolicy(withCapabilityNotes)
      ? withCapabilityNotes
      : `${withCapabilityNotes}\n\n${policyBlock}`;
    return fitVideoPromptLength(
      policyAwarePrompt,
    );
  };

  // 网格分镜模式：按总预算动态压缩每个 panel 描述，保留顺序与镜头意图
  if (nineGrid && nineGrid.panels.length > 0 && routing.prefersNineGridStoryboard) {
    const layout = resolveStoryboardGridLayout(nineGrid.layout?.panelCount, nineGrid.panels.length);
    const panelCount = Math.max(1, Math.min(layout.panelCount, nineGrid.panels.length));
    const orderedPanels = nineGrid.panels.slice(0, panelCount);
    const gridLayoutText = `${layout.cols}x${layout.rows}`;
    const totalDuration = Math.max(1, videoDuration || 8);
    // Keep per-panel pacing compatible with very short durations (e.g. 4s) without exceeding total duration.
    const secondsPerPanel = Math.max(0.2, Math.floor((totalDuration / panelCount) * 100) / 100);
    
    const template = isChinese
      ? withTemplateFallback(
          templates.video.sora2NineGridChinese,
          DEFAULT_PROMPT_TEMPLATE_CONFIG.video.sora2NineGridChinese
        )
      : withTemplateFallback(
          templates.video.sora2NineGridEnglish,
          DEFAULT_PROMPT_TEMPLATE_CONFIG.video.sora2NineGridEnglish
        );
    const promptWithoutPanels = template
      .replace('{actionSummary}', compactActionSummary)
      .replace('{panelDescriptions}', '')
      .replace(/\{gridLayout\}/g, gridLayoutText)
      .replace(/\{panelCount\}/g, String(panelCount))
      .replace(/\{secondsPerPanel\}/g, String(secondsPerPanel))
      .replace('{cameraMovement}', compactCameraMovement)
      .replace('{visualStyle}', visualStyleAnchor)
      .replace('{language}', language);
    const panelBudget = Math.max(900, MAX_VIDEO_PROMPT_CHARS - Array.from(promptWithoutPanels).length - 180);
    const panelDescriptions = buildNineGridPanelDescriptionsWithBudget(orderedPanels, panelBudget);
    
    const routedPrompt = template
      .replace('{actionSummary}', compactActionSummary)
      .replace('{panelDescriptions}', panelDescriptions)
      .replace(/\{gridLayout\}/g, gridLayoutText)
      .replace(/\{panelCount\}/g, String(panelCount))
      .replace(/\{secondsPerPanel\}/g, String(secondsPerPanel))
      .replace('{cameraMovement}', compactCameraMovement)
      .replace('{visualStyle}', visualStyleAnchor)
      .replace('{language}', language);
    return appendCapabilityNotes(
      ensureNineGridVideoPromptGuardrails(routedPrompt, panelCount, language, promptTemplates)
    );
  }
  
  // 普通模式
  if (routing.family === 'sora' || routing.family === 'doubao-task') {
    const template = isChinese
      ? withTemplateFallback(
          templates.video.sora2Chinese,
          DEFAULT_PROMPT_TEMPLATE_CONFIG.video.sora2Chinese
        )
      : withTemplateFallback(
          templates.video.sora2English,
          DEFAULT_PROMPT_TEMPLATE_CONFIG.video.sora2English
        );
    
    const routedPrompt = template
      .replace('{actionSummary}', compactActionSummary)
      .replace('{cameraMovement}', compactCameraMovement)
      .replace('{visualStyle}', visualStyleAnchor)
      .replace('{language}', language);
    return appendCapabilityNotes(routedPrompt);
  }

  if (isMiniMaxH3VideoModel(videoModel)) {
    const { totalDuration, midDuration } = buildMiniMaxTimelineDurations(videoDuration);
    const template = hasUsableEndFrame
      ? withTemplateFallback(
          templates.video.minimaxH3StartEnd,
          DEFAULT_PROMPT_TEMPLATE_CONFIG.video.minimaxH3StartEnd
        )
      : withTemplateFallback(
          templates.video.minimaxH3StartOnly,
          DEFAULT_PROMPT_TEMPLATE_CONFIG.video.minimaxH3StartOnly
        );
    const routedPrompt = template
      .replace('{actionSummary}', compactActionSummary)
      .replace('{cameraMovement}', compactCameraMovement)
      .replace('{visualStyle}', visualStyleAnchor)
      .replace(/\{duration\}/g, String(totalDuration))
      .replace(/\{midDuration\}/g, midDuration);
    return appendCapabilityNotes(routedPrompt);
  }

  const fallbackStartOnly = `Use the provided start frame as the exact opening composition.
Action: {actionSummary}
Camera Movement: {cameraMovement}
Visual Style Anchor: {visualStyle}
Keep identity, scene lighting, and prop details consistent throughout the shot.
Any spoken audio must be in-scene character dialogue only; no narrator voiceover.`;
  const fallbackStartEnd = `Use the provided START and END frames as hard constraints.
Action: {actionSummary}
Camera Movement: {cameraMovement}
Visual Style Anchor: {visualStyle}
The video must start from the start frame composition and progress naturally to a final state that matches the end frame.
Any spoken audio must be in-scene character dialogue only; no narrator voiceover.`;
  const template = hasUsableEndFrame
    ? withTemplateFallback(
        templates.video.veoStartEnd,
        withTemplateFallback(
          DEFAULT_PROMPT_TEMPLATE_CONFIG.video.veoStartEnd,
          fallbackStartEnd
        )
      )
    : withTemplateFallback(
        templates.video.veoStartOnly,
        withTemplateFallback(
          DEFAULT_PROMPT_TEMPLATE_CONFIG.video.veoStartOnly,
          fallbackStartOnly
        )
      );

  const routedPrompt = template
      .replace('{actionSummary}', compactActionSummary)
      .replace('{cameraMovement}', compactCameraMovement)
      .replace('{visualStyle}', visualStyleAnchor)
      .replace('{language}', isChinese ? '中文' : language);
  return appendCapabilityNotes(routedPrompt);
};

const LIVE_ACTION_STYLE_NOISE: RegExp[] = [
  /live-action\s+cinematic\s+framing\s+translated\s+into\s+premium\s+hand-drawn\s+2d\s+animation/gi,
  /premium\s+hand-drawn\s+2d\s+animation(?:\s+with\s+live-action\s+cinematic\s+\w+)?/gi,
  /\bhand-drawn(?:\s+style)?\b/gi,
  /\b2d\s+animation\b/gi,
  /\bcel[-\s]?shad(?:ed|ing)\b/gi,
  /\bwatercolor(?:\s+paper)?(?:\s+grain|\s+washes)?\b/gi,
  /\b(?:pixar|dreamworks)(?:\s*\/\s*(?:pixar|dreamworks))?\b/gi,
  /\bsix-head(?:-tall)?\b/gi,
  /\brounded\s+(?:brown-gray\s+)?linework\b/gi,
  /\bcartoon\b/gi,
];

/** 换风格后分镜 visualPrompt 常残留旧介质词，和当前风格、定妆照片冲突。 */
export const sanitizeKeyframeBasePrompt = (text: string, visualStyle: string): string => {
  let next = String(text || '');
  if (visualStyle === 'live-action') {
    for (const pattern of LIVE_ACTION_STYLE_NOISE) {
      next = next.replace(pattern, '');
    }
  }
  return next
    .replace(/\s*,\s*,+/g, ',')
    .replace(/^[,\s;，；]+|[,\s;，；]+$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
};

/**
 * 从现有提示词中提取基础部分（移除追加的样式信息）
 */
export const extractBasePrompt = (fullPrompt: string, fallback: string): string => {
  const sourcePrompt = (fullPrompt || '').trim();
  if (!sourcePrompt) {
    return fallback;
  }

  const splitters = [
    KEYFRAME_META_SPLITTER,
    '\n\n【视觉风格】Visual Style',
    '\n\nVisual Style:'
  ];

  // 参考图映射和上一轮 Qwen 编译结果都不是可再次嵌入的画面描述。
  const unwrapped = unwrapCompiledKeyframeDescription(sourcePrompt);
  const promptForSplit = unwrapped || (
    sourcePrompt.includes('【任务】')
    || sourcePrompt.includes('【本次参考图映射】')
    || /REFERENCE IMAGE MAPPING/i.test(sourcePrompt)
      ? ''
      : sourcePrompt
  );
  if (!promptForSplit) return fallback;

  for (const splitter of splitters) {
    const splitIndex = promptForSplit.indexOf(splitter);
    if (splitIndex > 0) {
      return promptForSplit.substring(0, splitIndex);
    }
  }

  return promptForSplit;
};

/**
 * 生成唯一ID
 */
export const generateId = (prefix: string): string => {
  return `${prefix}-${Date.now()}`;
};

/**
 * 延迟执行
 */
export const delay = (ms: number): Promise<void> => {
  return new Promise(resolve => setTimeout(resolve, ms));
};

/**
 * 图片文件转base64
 */
export const convertImageToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      resolve(event.target?.result as string);
    };
    reader.onerror = () => {
      reject(new Error('读取文件失败'));
    };
    reader.readAsDataURL(file);
  });
};

/**
 * 创建关键帧对象
 */
export const createKeyframe = (
  id: string,
  type: 'start' | 'end',
  visualPrompt: string,
  imageUrl?: string,
  status: 'pending' | 'generating' | 'completed' | 'failed' = 'pending',
  generationId?: string,
): Keyframe => {
  return {
    id,
    type,
    generationId,
    visualPrompt,
    imageUrl,
    status
  };
};

/**
 * 更新镜头中的关键帧
 */
export const updateKeyframeInShot = (
  shot: Shot,
  type: 'start' | 'end',
  keyframe: Keyframe
): Shot => {
  const newKeyframes = [...(shot.keyframes || [])];
  const idx = newKeyframes.findIndex(k => k.type === type);
  
  if (idx >= 0) {
    const previous = newKeyframes[idx];
    newKeyframes[idx] =
      keyframe.promptVersions === undefined
        ? { ...keyframe, promptVersions: previous.promptVersions }
        : keyframe;
  } else {
    newKeyframes.push(keyframe);
  }
  
  return { ...shot, keyframes: newKeyframes };
};

/**
 * 生成子镜头ID数组
 * @param originalShotId - 原始镜头ID（如 "shot-1"）
 * @param count - 子镜头数量
 * @returns 子镜头ID数组（如 ["shot-1-1", "shot-1-2", "shot-1-3"]）
 */
export const generateSubShotIds = (originalShotId: string, count: number): string[] => {
  const ids: string[] = [];
  for (let i = 1; i <= count; i++) {
    ids.push(`${originalShotId}-${i}`);
  }
  return ids;
};

/**
 * 创建子镜头对象
 * @param originalShot - 原始镜头对象
 * @param subShotData - AI返回的子镜头数据
 * @param subShotId - 子镜头ID
 * @returns 新的Shot对象
 */
export const createSubShot = (
  originalShot: Shot,
  subShotData: any,
  subShotId: string
): Shot => {
  // 处理关键帧数组
  const keyframes: any[] = [];
  if (subShotData.keyframes && Array.isArray(subShotData.keyframes)) {
    subShotData.keyframes.forEach((kf: any) => {
      if (kf.type && kf.visualPrompt) {
        keyframes.push({
          id: `${subShotId}-${kf.type}`, // 如 "shot-1-1-start", "shot-1-1-end"
          type: kf.type,
          visualPrompt: kf.visualPrompt,
          status: 'pending' // 初始状态为pending，等待用户生成图像
        });
      }
    });
  }
  
  return {
    id: subShotId,
    sceneId: originalShot.sceneId, // 继承原镜头的场景ID
    actionSummary: subShotData.actionSummary, // 使用AI生成的动作描述
    dialogue: undefined, // 不继承对白 - 对白通常只在特定子镜头中出现，由AI在actionSummary中体现
    cameraMovement: subShotData.cameraMovement, // 使用AI生成的镜头运动
    shotSize: subShotData.shotSize, // 使用AI生成的景别
    characters: [...originalShot.characters], // 继承角色列表
    characterVariations: { ...originalShot.characterVariations }, // 继承角色变体映射
    keyframes: keyframes, // 使用AI生成的关键帧（包含visualPrompt）
    videoModel: originalShot.videoModel // 继承视频模型设置
  };
};

/**
 * 用子镜头数组替换原镜头
 * @param shots - 原始镜头数组
 * @param originalShotId - 要替换的原镜头ID
 * @param subShots - 子镜头数组
 * @returns 更新后的镜头数组
 */
export const replaceShotWithSubShots = (
  shots: Shot[],
  originalShotId: string,
  subShots: Shot[]
): Shot[] => {
  const originalIndex = shots.findIndex(s => s.id === originalShotId);
  
  if (originalIndex === -1) {
    console.error(`未找到ID为 ${originalShotId} 的镜头`);
    return shots;
  }
  
  // 创建新数组，在原位置插入子镜头
  const newShots = [
    ...shots.slice(0, originalIndex),
    ...subShots,
    ...shots.slice(originalIndex + 1)
  ];
  
  return newShots;
};

// ============================================
// 九宫格分镜预览工具函数（高级功能）
// ============================================

/**
 * 将选中的九宫格面板描述转换为首帧提示词
 * 将九宫格中选定的视角信息融合到首帧提示词中
 * @param panel - 选中的九宫格面板
 * @param actionSummary - 原始动作描述
 * @param visualStyle - 视觉风格
 * @param cameraMovement - 原始镜头运动
 * @returns 构建好的首帧提示词
 */
export const buildPromptFromNineGridPanel = (
  panel: NineGridPanel,
  actionSummary: string,
  visualStyle: string,
  cameraMovement: string,
  propsInfo?: ShotPropPromptInfo[],
  layout?: NineGridData['layout'],
  promptTemplates?: PromptTemplateConfig
): string => {
  const templates = promptTemplates || resolvePromptTemplateConfig();
  const stylePrompt = VISUAL_STYLE_PROMPTS[visualStyle] || visualStyle;
  const characterConsistencyTemplate = withTemplateFallback(
    templates.keyframe.characterConsistencyGuide,
    DEFAULT_PROMPT_TEMPLATE_CONFIG.keyframe.characterConsistencyGuide
  );
  const propWithImageTemplate = withTemplateFallback(
    templates.keyframe.propWithImageGuide,
    DEFAULT_PROMPT_TEMPLATE_CONFIG.keyframe.propWithImageGuide
  );
  const propWithoutImageTemplate = withTemplateFallback(
    templates.keyframe.propWithoutImageGuide,
    DEFAULT_PROMPT_TEMPLATE_CONFIG.keyframe.propWithoutImageGuide
  );
  const nineGridSourceMetaTemplate = withTemplateFallback(
    templates.keyframe.nineGridSourceMeta,
    DEFAULT_PROMPT_TEMPLATE_CONFIG.keyframe.nineGridSourceMeta
  );
  const sourceLabel = getStoryboardPositionLabel(
    panel.index,
    layout?.panelCount,
    layout?.panelCount
  );
  
  // 角色一致性要求（定妆不含英雄道具，镜头阶段再按参考图加入）
  const characterConsistencyGuide = `${characterConsistencyTemplate}

【定妆说明】定妆图锁定主体外观和身体结构，不含英雄道具。若本镜头列出了道具，按道具参考图加入；未列出则不要发明随身道具。不要因为定妆图没有某件道具就禁止它出现，也不要另发明一件不同的道具。`;

  // 道具一致性要求（仅在有道具时添加）
  let propConsistencyGuide = '';
  if (propsInfo && propsInfo.length > 0) {
    const propsWithImage = propsInfo.filter(p => p.hasImage);
    const propsWithoutImage = propsInfo.filter(p => !p.hasImage);

    let sections: string[] = [];

    if (propsWithImage.length > 0) {
      const list = propsWithImage
        .map(p => `- ${p.name}: ${p.description}${p.presentationConstraint ? `\n  Presentation lock: ${p.presentationConstraint}` : ''}`)
        .join('\n');
      sections.push(
        renderPromptTemplate(propWithImageTemplate, { propList: list })
      );
    }

    if (propsWithoutImage.length > 0) {
      const list = propsWithoutImage
        .map(p => `- ${p.name}: ${p.description}${p.presentationConstraint ? `\n  Presentation lock: ${p.presentationConstraint}` : ''}`)
        .join('\n');
      sections.push(
        renderPromptTemplate(propWithoutImageTemplate, { propList: list })
      );
    }

    propConsistencyGuide = `

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
【道具一致性要求】PROP CONSISTENCY REQUIREMENTS
${sections.join('\n\n')}`;
  }

  return `${panel.description}${KEYFRAME_META_SPLITTER}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${renderPromptTemplate(nineGridSourceMetaTemplate, {
  sourceLabel,
  shotSize: panel.shotSize,
  cameraAngle: panel.cameraAngle,
  actionSummary,
})}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
【视觉风格】Visual Style
${stylePrompt}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
【镜头运动】Camera Movement
${cameraMovement}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${characterConsistencyGuide}${propConsistencyGuide}`;
};

/**
 * 从网格分镜图中裁剪出指定面板的图片
 * 支持 2x2 / 3x2 / 3x3 网格布局
 * @param nineGridImageUrl - 网格整图 (base64)
 * @param panelIndex - 面板索引 (0-(panelCount-1))
 * @param layout - 网格布局（可选，默认按 3x3 兼容）
 * @returns 裁剪后的 base64 图片
 */
export const cropPanelFromNineGrid = (
  nineGridImageUrl: string,
  panelIndex: number,
  layout?: NineGridData['layout']
): Promise<string> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        const resolvedLayout = resolveStoryboardGridLayout(layout?.panelCount, layout?.panelCount);
        if (panelIndex < 0 || panelIndex >= resolvedLayout.panelCount) {
          reject(new Error(`面板索引越界: ${panelIndex}`));
          return;
        }

        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('无法创建 Canvas 上下文'));
          return;
        }
        
        // 计算裁剪区域：动态网格（2x2 / 3x2 / 3x3）
        const col = panelIndex % resolvedLayout.cols;
        const row = Math.floor(panelIndex / resolvedLayout.cols);
        
        const panelWidth = img.width / resolvedLayout.cols;
        const panelHeight = img.height / resolvedLayout.rows;
        
        const sx = col * panelWidth;
        const sy = row * panelHeight;
        
        // 设置输出 canvas 尺寸为单个面板大小
        canvas.width = Math.round(panelWidth);
        canvas.height = Math.round(panelHeight);
        
        // 裁剪并绘制
        ctx.drawImage(
          img,
          Math.round(sx), Math.round(sy),   // 源坐标
          Math.round(panelWidth), Math.round(panelHeight), // 源尺寸
          0, 0,                               // 目标坐标
          canvas.width, canvas.height          // 目标尺寸
        );
        
        // 转换为 base64
        const croppedBase64 = canvas.toDataURL('image/png');
        resolve(croppedBase64);
      } catch (err) {
        reject(err);
      }
    };
    img.onerror = () => {
      reject(new Error('网格分镜图片加载失败'));
    };
    img.src = nineGridImageUrl;
  });
};
