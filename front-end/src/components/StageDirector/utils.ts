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
import { formatProductionBibleForPrompt } from '../../services/productionBibleService';

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

/** 单角色镜头的构图锁，防止“越肩镜头”被模型误解成两个相同角色。 */
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
  const subjectRule = names.length === 1
    ? `- EXACTLY ONE visible human/character: ${names[0]}. Do not create a second copy, clone, duplicate, reflection, portrait, silhouette, or background version of ${names[0]}.
- If this is an over-the-shoulder or rear view, it is still the same single ${names[0]}; do not add another foreground or background body.`
    : `- Show exactly these named characters and no duplicate copies: ${names.join(', ')}.`;
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
 * 获取镜头的参考图片
 * 每个角色只占用一个主参考槽位：镜头服装变体优先，否则使用角色当前选中的
 * 普通定妆照、九宫格或三视图。多视图不再作为额外图片重复追加。
 */
export const getRefImagesForShot = (
  shot: Shot,
  scriptData: ProjectState['scriptData'],
  options?: { sceneFirst?: boolean },
): RefImagesResult => {
  const characterImages: string[] = [];
  const sceneImages: string[] = [];
  const propImages: string[] = [];
  const selectedMultiViewImages = new Set<string>();
  const imageRoleByUrl = new Map<string, string>();
  const sceneFirst = options?.sceneFirst === true;

  if (!scriptData) {
    return {
      images: [],
      entries: [],
      imageRoles: [],
      hasTurnaround: false,
      selectedTurnaroundCount: 0,
      droppedTurnaroundCount: 0,
      sceneFirst,
    };
  }

  const extraCharacterImages: string[] = [];
  const entryByUrl = new Map<string, ReferenceImageEntry>();

  // Klein：主定妆 = Image 1，避免群像插在场景前改发型。
  // Qwen Edit：Image 1 会当成构图底图，定妆棚拍必须让路给场景。
  if (shot.characters) {
    shot.characters.forEach(charId => {
      const char = scriptData.characters.find(c => String(c.id) === String(charId));
      if (!char) return;

      const varId = shot.characterVariations?.[charId];
      const variationImage = varId
        ? char.variations?.find(v => v.id === varId)?.referenceImage
        : undefined;
      const selectedCharacterImage = variationImage || resolveCharacterDisplayImage(char);
      if (selectedCharacterImage) {
        const view = variationImage ? 'variation' : resolveCharacterImageView(char);
        const normalizedImage = selectedCharacterImage.trim();
        imageRoleByUrl.set(normalizedImage, `character:${char.name || char.id}:${view}`);
        entryByUrl.set(normalizedImage, {
          image: normalizedImage,
          // 九宫格/三视图仍是该角色的唯一主参考，不单独占第二个类型槽位。
          // 多视图语义通过 detail 与 hasTurnaround 传递。
          type: 'character',
          label: char.name || char.id,
          detail: variationImage
            ? `服装变体：${char.variations?.find(v => v.id === varId)?.name || '未命名'}`
            : view === 'turnaround'
              ? '九宫格定妆照'
              : view === 'threeView'
                ? '三视图定妆照'
                : '基础定妆照',
        });
        if (characterImages.length === 0) {
          characterImages.push(selectedCharacterImage);
        } else {
          extraCharacterImages.push(selectedCharacterImage);
        }
        if (!variationImage && resolveCharacterImageView(char) !== 'casting') {
          selectedMultiViewImages.add(normalizedImage);
        }
      }
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
          detail: prop.description || prop.visualPrompt,
        });
      }
    });
  }

  const orderedPrimary = sceneFirst
    ? [...sceneImages, ...characterImages, ...extraCharacterImages, ...propImages]
    : [...characterImages, ...extraCharacterImages, ...sceneImages, ...propImages];
  const dedupedPrimary = dedupeImageRefs(orderedPrimary);
  const images = dedupedPrimary;
  const selectedTurnaroundCount = images.filter((img) => selectedMultiViewImages.has(img)).length;
  const totalMultiViewCount = dedupedPrimary.filter((img) => selectedMultiViewImages.has(img)).length;

  return {
    images,
    entries: images
      .map((img) => entryByUrl.get(img))
      .filter((entry): entry is ReferenceImageEntry => !!entry),
    imageRoles: images.map((img) => imageRoleByUrl.get(img) || 'unknown'),
    hasTurnaround: selectedTurnaroundCount > 0,
    selectedTurnaroundCount,
    droppedTurnaroundCount: Math.max(0, totalMultiViewCount - selectedTurnaroundCount),
    sceneFirst,
  };
};

/**
 * 获取镜头关联的道具信息（用于提示词注入）
 * hasImage 标记该道具是否有参考图，用于提示词中区分"参考图一致性"和"文字描述约束"
 */
export interface ShotPropPromptInfo {
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
  const frameVisual = String(frameKf?.visualPrompt || '').trim();
  const hasRenderedMeta = frameVisual.includes(KEYFRAME_META_SPLITTER);

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
⚠️ Image 1 是场景/环境参考，用它作为地点、光线和空间。不要画成棚拍定妆棚，也不要把人物并排摆在灰背景前。
⚠️ Image 2 是主角色定妆照片：只抄五官、发型、体型、衣着；丢掉定妆棚背景、台子和棚拍姿势。
• 更后面的图才是道具或路人/配角定妆；路人要出现在场景里，不是第二名棚拍主角
• 随身道具按道具参考图加入；不要因为定妆图里没有某件道具就禁止它出现`
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
    const withNativeAudio = isMiniMaxH3VideoModel(videoModel)
      ? finalizeMiniMaxH3VideoPrompt(
          policyAwarePrompt,
          context?.nativeAudio,
          language,
        )
      : policyAwarePrompt;
    return fitVideoPromptLength(
      withNativeAudio,
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

  for (const splitter of splitters) {
    const splitIndex = sourcePrompt.indexOf(splitter);
    if (splitIndex > 0) {
      return sourcePrompt.substring(0, splitIndex);
    }
  }

  return sourcePrompt;
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
