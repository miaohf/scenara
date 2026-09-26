import type { AspectRatio, ScriptData, Shot } from '../../types';
import type { ReferenceImageEntry } from '../referenceImagePack';
import { formatContinuityLedgerForPrompt } from '../continuityLedgerService';
import { isWearableProp } from './promptConstants';
import { chatCompletion, getActiveChatModelName } from './apiCore';
import { validateAndRepairH3Prompt, type H3PromptWorkflowKind } from './h3PromptValidator';

const MAX_H3_PROMPT_CHARS = 4700;
const CJK_RE = /[\u3400-\u9fff]/;

const stripDialogueBlocks = (value: string): string =>
  String(value || '').replace(/<d>[\s\S]*?<\/d>/giu, '');

/** H3 skill prose must be English; only literal dialogue may retain its source language. */
export const hasH3NonDialogueCjk = (value?: string): boolean =>
  CJK_RE.test(stripDialogueBlocks(String(value || '')));

const clean = (value: unknown, maxLength = 900): string => {
  const text = String(value ?? '')
    .replace(/&#x20;|&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1).trimEnd()}…`;
};

const fitPrompt = (value: string): string => {
  const chars = Array.from(value);
  if (chars.length <= MAX_H3_PROMPT_CHARS) return value;
  return `${chars.slice(0, MAX_H3_PROMPT_CHARS - 1).join('').trimEnd()}…`;
};

/**
 * Preserve production facts during deterministic compilation. The mandatory
 * H3 polish pass translates any non-dialogue CJK into English before submit.
 * Dialogue/lyrics stay fully original via <d> tags elsewhere.
 */
const toSkillEnglish = (
  value: string,
  role: 'action' | 'state' | 'sound' | 'identity' | 'mood' | 'purpose' | 'note' | 'atmosphere' | 'wardrobe',
): string => {
  const text = clean(value, 900);
  if (!text) return '';
  if (!CJK_RE.test(text)) return text;
  switch (role) {
    // Keep locked production facts in their original language, but do not
    // leak Scenara's internal field names into the H3 prompt.
    case 'action':
    case 'state':
    case 'sound':
    case 'identity':
    case 'mood':
    case 'purpose':
    case 'atmosphere':
    case 'wardrobe':
    case 'note':
      return `"${text}"`;
    default:
      return `"${text}"`;
  }
};

/** Strip asset-pack Chinese boilerplate that duplicates Subject/Picture locks. */
const stripAssetBoilerplate = (value: string): string =>
  clean(
    value
      .replace(/角色参考图[：:].*/u, '')
      .replace(/场景参考图[：:].*/u, '')
      .replace(/道具参考图[：:].*/u, '')
      .replace(/锁定人物身份[^。]*。?/gu, '')
      .replace(/锁定环境[^。]*。?/gu, '')
      .replace(/锁定造型[^。]*。?/gu, ''),
    280,
  );

const isDistinctFact = (candidate: string, existing: string[]): boolean => {
  const normalize = (value: string) => clean(value, 500)
    .toLowerCase()
    .replace(/[\s\u3000.,，。;；:："“”'‘’()（）\[\]【】]/g, '');
  const normalizedCandidate = normalize(candidate);
  if (!normalizedCandidate) return false;
  return !existing.some((value) => {
    const normalizedExisting = normalize(value);
    return normalizedExisting && (
      normalizedCandidate === normalizedExisting
      || normalizedCandidate.includes(normalizedExisting)
      || normalizedExisting.includes(normalizedCandidate)
    );
  });
};

/**
 * Soften silence-seeking audioIntent so native H3 audio is not collapsed to mute,
 * while preserving concrete SFX phrases.
 */
const normalizeAudioCue = (value: unknown): string => {
  let text = clean(value, 240);
  if (!text) return '';
  const silenceHeavy = /静音|无声|绝对安静|极度安静|silent\b|mute\b/i.test(text);
  if (silenceHeavy) {
    text = text
      .replace(/静音或?/g, '')
      .replace(/极细微的环境音[，,]?/g, '')
      .replace(/极轻微的环境白噪音[，,]?/g, '')
      .replace(/突出触觉[。.]?/g, '')
      .replace(/突出心理活动[。.]?/g, '')
      .replace(/绝对安静|极度安静|无声/g, '')
      .replace(/^[，,;；、\s]+|[，,;；、\s]+$/g, '')
      .trim();
    if (!text) {
      text = 'soft tactile contact and restrained room tone, still clearly audible';
    } else if (!/contact|ambience|SFX|风|水|心跳|摩擦|水流/i.test(text)) {
      text = `soft audible contact ambience; ${text}`;
    }
  }
  return toSkillEnglish(text, 'sound');
};

export const isMiniMaxH3Ref2VAModel = (modelId: string): boolean => {
  const normalized = String(modelId || '').toLowerCase();
  return normalized.includes('minimax-h3') && (normalized.includes('r2v') || normalized.includes('ref2v'));
};

/** Detect Ref2VA six-section skill prompt (subject_definitions / Picture N). */
export const isMiniMaxH3Ref2VAPrompt = (prompt?: string): boolean =>
  /^\s*subject_definitions:/m.test(String(prompt || ''));

/** Detect MiniMax official skill prompt shape (Ref2VA six-section or base three-field). */
export const isMiniMaxH3OfficialSkillPrompt = (prompt?: string): boolean => {
  const text = String(prompt || '');
  return (
    isMiniMaxH3Ref2VAPrompt(text)
    || /^\s*integrated_multimodal_description:/m.test(text)
  );
};

export interface MiniMaxH3NativeAudioOptions {
  mode?: 'dialogue' | 'narration' | string;
  text?: string;
  speakerName?: string;
}

export interface H3SkillGenerationOptions {
  prompt: string;
  durationSeconds: number;
  expectedWorkflow: H3PromptWorkflowKind;
  dialogue?: string;
  audioMode?: 'dialogue' | 'narration';
  model?: string;
}

export interface H3SkillGenerationResult {
  prompt: string;
  generated: boolean;
  reason: 'generated' | 'invalid-output' | 'request-failed';
}

/**
 * H3 Prompt Agent. The deterministic compiler provides a lossless production
 * brief; the agent generates the final English official H3 skill prompt from it.
 * Validation verifies the generated result and never acts as the primary writer.
 */
export const generateMiniMaxH3SkillPrompt = async (
  options: H3SkillGenerationOptions,
): Promise<H3SkillGenerationResult> => {
  const source = String(options.prompt || '').trim();
  if (!source) return { prompt: source, generated: false, reason: 'invalid-output' };

  const sectionOrder = options.expectedWorkflow === 'ref2va'
    ? 'subject_definitions, summary, retention_analysis, detailed_description, overall_soundscape, non_diegetic_music'
    : 'integrated_multimodal_description, overall_soundscape, non_diegetic_music';
  const instruction = `You are the H3 Prompt Agent for a cinematic video production. Generate the final MiniMax H3 video prompt from the production brief below.

Hard requirements:
1. Output ONLY the final prompt. No markdown fences, explanation, comments, policy blocks, or extra headings.
2. Use each required section exactly once and in this exact order: ${sectionOrder}.
3. All non-dialogue prose must be English. Translate every Chinese production fact accurately; do not leave Chinese names, action notes, camera notes, scene notes, or sound notes outside dialogue tags.
4. Preserve dialogue text exactly and keep it only inside official tags of the form <d>[Chinese] original dialogue</d>. Do not translate dialogue.
5. Preserve all supplied story facts, timing, reference anchors, camera direction, character/prop continuity, end-frame constraints, and audio intent. Do not invent new events, characters, dialogue, camera moves, or music.
6. Keep one continuous executable shot. Preserve "N/A" for non_diegetic_music when the source requires no music.
7. Do not emit duplicate overall_soundscape or non_diegetic_music sections.

Production brief:
${source}`;

  try {
    let feedback = '';
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const request = feedback
        ? `${instruction}\n\nThe previous draft failed acceptance:\n${feedback}\nRegenerate the complete prompt. Do not explain the changes.`
        : instruction;
      const candidate = String(await chatCompletion(
        request,
        options.model || getActiveChatModelName(),
        0.1,
        4096,
        undefined,
        90000,
      ) || '').trim();
      const validation = validateAndRepairH3Prompt(candidate, {
        durationSeconds: options.durationSeconds,
        expectedWorkflow: options.expectedWorkflow,
        dialogue: options.dialogue,
        audioMode: options.audioMode,
      });
      const accepted = Boolean(candidate)
        && validation.canProceed
        && validation.autoFixes.length === 0
        && !hasH3NonDialogueCjk(candidate);
      if (accepted) {
        // Return the Agent's raw output. Validation is an acceptance gate, not
        // a post-generation rewriter for the final H3 prompt.
        return { prompt: candidate, generated: true, reason: 'generated' };
      }
      feedback = validation.issues.map((issue) => `- ${issue.message}`).join('\n')
        || 'Output was empty or contained non-dialogue Chinese.';
    }
    return { prompt: source, generated: false, reason: 'invalid-output' };
  } catch {
    return { prompt: source, generated: false, reason: 'request-failed' };
  }
};

export interface MiniMaxH3Ref2VAPromptOptions {
  durationSeconds: number;
  aspectRatio?: AspectRatio;
  referenceEntries?: ReferenceImageEntry[];
  referenceAnnotations?: string[];
  hasReferenceVideo?: boolean;
  hasReferenceAudio?: boolean;
  language?: string;
  visualStyle?: string;
  nativeAudio?: MiniMaxH3NativeAudioOptions;
}

const dialogueLanguageTag = (language?: string): string => {
  const value = String(language || '').trim();
  if (!value) return 'Chinese';
  if (/中文|chinese|^zh\b/i.test(value)) return 'Chinese';
  if (/english|英文|^en\b/i.test(value)) return 'English';
  return value;
};

const styleOpening = (visualStyle?: string): string => {
  const style = clean(visualStyle, 80) || 'cinematic';
  if (/3d|pixar|cgi|动画/i.test(style)) {
    return `The target video uses a polished 3D CG cinematic look (${style}) with coherent lighting and material detail.`;
  }
  if (/2d|anime|动画/i.test(style)) {
    return `The target video uses a 2D-animated cinematic look (${style}) with clean readable staging.`;
  }
  if (/live|写实|真人/i.test(style)) {
    return `The target video uses a live-action cinematic look (${style}) with naturalistic lighting.`;
  }
  return `The target video uses a cinematic look anchored to the project style (${style}).`;
};

const normalizeShotSize = (shotSize?: string): string => {
  const raw = clean(shotSize, 80);
  if (!raw) return '';
  if (/大特写|extreme\s*close/i.test(raw)) return 'Extreme Close-up';
  if (/特写|close[- ]?up/i.test(raw)) return 'Close-up';
  if (/中近景|medium\s*close/i.test(raw)) return 'Medium Close-up';
  if (/中全景|medium\s*wide|中远/i.test(raw)) return 'Medium Wide Shot';
  if (/中景|medium/i.test(raw)) return 'Medium Shot';
  if (/全景|wide/i.test(raw)) return 'Wide Shot';
  if (/远景|extreme\s*wide|long\s*shot/i.test(raw)) return 'Extreme Wide Shot';
  if (/俯拍|bird|overhead|top[- ]?down/i.test(raw)) return 'High-angle Shot';
  if (/仰拍|low[- ]?angle/i.test(raw)) return 'Low-angle Shot';
  if (/pov/i.test(raw)) return 'POV Shot';
  return raw;
};

/** Map free-form camera labels into official type + amplitude + speed English. */
export const formatH3CameraMotion = (cameraMovement?: string, shotSize?: string): string => {
  const raw = clean(cameraMovement, 220);
  const size = normalizeShotSize(shotSize);
  const sizeClause = size ? ` framing as ${size}` : '';
  if (!raw) {
    return `The camera holds a static shot${sizeClause}.`;
  }

  const lower = raw.toLowerCase();
  const slow = /slow|缓慢|慢/i.test(raw);
  const fast = /fast|quick|急|快/i.test(raw);
  const large = /large|wide|大/i.test(raw);
  const small = /small|slight|subtle|轻|小/i.test(raw);
  const speed = slow ? ' at slow speed' : fast ? ' at fast speed' : '';
  const amplitude = large ? ' with large amplitude' : small ? ' with small amplitude' : '';

  if (/static|hold|固定|静止/i.test(raw)) {
    return `The camera holds a static shot${sizeClause}.`;
  }
  if (/zoom\s*in|推近|变焦推/i.test(lower) || (/zoom/i.test(lower) && /in|近/i.test(raw))) {
    return `The camera zooms in${amplitude || ' with small amplitude'}${speed || ' at slow speed'}${sizeClause}.`;
  }
  if (/zoom\s*out|拉远|变焦拉/i.test(lower)) {
    return `The camera zooms out${amplitude || ' with small amplitude'}${speed || ' at slow speed'}${sizeClause}.`;
  }
  if (/push\s*in|dolly\s*in|推进/i.test(lower)) {
    return `The camera pushes in${amplitude || ' with small amplitude'}${speed || ' at slow speed'}${sizeClause}.`;
  }
  if (/pull\s*out|dolly\s*out|拉出/i.test(lower)) {
    return `The camera pulls out${amplitude || ' with small amplitude'}${speed || ' at slow speed'}${sizeClause}.`;
  }
  if (/pan\s*left|左摇|左移/i.test(lower)) {
    return `The camera pans left${amplitude}${speed}${sizeClause}.`;
  }
  if (/pan\s*right|右摇|右移/i.test(lower)) {
    return `The camera pans right${amplitude}${speed}${sizeClause}.`;
  }
  if (/pan\s*up|向上平移|上摇|仰视/i.test(lower) || (/pan/i.test(lower) && /上|仰/i.test(raw))) {
    return `The camera tilts up${amplitude}${speed}${sizeClause}.`;
  }
  if (/tilt\s*up|上仰/i.test(lower)) {
    return `The camera tilts up${amplitude}${speed}${sizeClause}.`;
  }
  if (/tilt\s*down|下俯/i.test(lower)) {
    return `The camera tilts down${amplitude}${speed}${sizeClause}.`;
  }
  if (/track|跟随|跟拍|低角度跟随/i.test(lower)) {
    return `The camera follows with a tracking shot${amplitude}${speed}${sizeClause}.`;
  }
  if (/truck\s*left/i.test(lower)) {
    return `The camera trucks left${amplitude}${speed}${sizeClause}.`;
  }
  if (/truck\s*right/i.test(lower)) {
    return `The camera trucks right${amplitude}${speed}${sizeClause}.`;
  }
  if (/crane|升降/i.test(lower)) {
    return `The camera moves on a crane${amplitude}${speed}${sizeClause}.`;
  }
  if (/arc/i.test(lower)) {
    return `The camera moves in an arc shot${amplitude}${speed}${sizeClause}.`;
  }
  if (/pov/i.test(lower)) {
    return `The camera holds a POV shot${sizeClause}.`;
  }
  // Avoid dumping raw Chinese camera labels into the English skill body.
  const moveLabel = CJK_RE.test(raw) ? 'a motivated cinematic move' : raw;
  return `The camera performs ${moveLabel}${amplitude}${speed}${sizeClause}.`;
};

const sanitizeWardrobe = (wardrobe: string | undefined, excludeNames: string[]): string => {
  const raw = clean(wardrobe, 420);
  if (!raw) return '';
  const excludes = excludeNames.map((name) => name.trim()).filter(Boolean);
  const parts = raw
    .split(/[;；|/]+/g)
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => {
      // Explicit handheld/weapon props must never ride along as wardrobe.
      if (/^(短刀|腰刀|佩刀|匕首|剑|刀)$/u.test(part)) return false;
      const lower = part.toLowerCase();
      return !excludes.some((name) => {
        const n = name.toLowerCase();
        return lower === n || lower.includes(n) || n.includes(lower);
      });
    });
  return Array.from(new Set(parts)).join('; ');
};

const formatDialogueBlock = (
  text: string,
  language: string | undefined,
): string => {
  const line = clean(text, 500);
  if (!line) return '';
  return `<d>[${dialogueLanguageTag(language)}] ${line}</d>`;
};

type SubjectRole = 'character' | 'scene' | 'prop' | 'storyboard' | 'video' | 'audio';

interface SubjectDef {
  label: string; // <Subject N> or <Picture N>
  role: SubjectRole;
  pictureIndex?: number;
  definition: string;
  retention: string;
  name?: string;
}

/**
 * Compile shot intent into MiniMax H3 Ref2VA official six-section skill format.
 * Reference images are identity / storyboard anchors, never literal first/last frames.
 */
export const buildMiniMaxH3Ref2VAPrompt = (
  shot: Shot,
  scriptData: ScriptData | null | undefined,
  options: MiniMaxH3Ref2VAPromptOptions,
): string => {
  const duration = Math.max(1, Number(options.durationSeconds) || 5);
  const aspectRatio = options.aspectRatio || '16:9';
  const language = options.language || scriptData?.language || '中文';
  const visualStyle = options.visualStyle || scriptData?.visualStyle || 'cinematic';
  const agent = shot.agent;
  const scene = scriptData?.scenes.find((item) => String(item.id) === String(shot.sceneId));
  const referenceEntries = (options.referenceEntries || []).slice(0, 9);
  const annotations = options.referenceAnnotations || [];

  const shotPropNames = (shot.props || [])
    .map((propId) => scriptData?.props.find((item) => String(item.id) === String(propId))?.name)
    .filter((name): name is string => Boolean(name));
  const wearablePropNames = (scriptData?.props || [])
    .filter((prop) => isWearableProp(prop))
    .map((prop) => prop.name)
    .filter((name): name is string => Boolean(name));
  const wardrobeExcludeNames = Array.from(new Set([...shotPropNames, ...wearablePropNames]));

  const characters = (shot.characters || [])
    .map((characterId) => {
      const character = scriptData?.characters.find((item) => String(item.id) === String(characterId));
      if (!character) return null;
      const variationId = shot.characterVariations?.[characterId];
      const variation = variationId
        ? character.variations?.find((item) => String(item.id) === String(variationId))
        : undefined;
      return {
        id: characterId,
        name: character.name,
        identity: clean(
          character.creativeDirection?.silhouette || character.coreFeatures || character.species,
          220,
        ),
        wardrobe: sanitizeWardrobe(variation?.wardrobe || character.wardrobe, wardrobeExcludeNames),
        performance: clean(character.creativeDirection?.performanceNotes, 260),
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));

  const props = (shot.props || [])
    .map((propId) => {
      const prop = scriptData?.props.find((item) => String(item.id) === String(propId));
      if (!prop) return null;
      // Wearables belong on wardrobe / character identity, not as independent prop subjects.
      if (isWearableProp(prop)) return null;
      const usage = shot.propUsages?.[propId];
      const usageText = usage
        ? clean([usage.mode, usage.position, usage.action].filter(Boolean).join('; '), 200)
        : clean([prop.presentationMode, prop.presentationNote].filter(Boolean).join('; '), 200);
      return {
        id: propId,
        name: prop.name,
        description: clean(prop.description, 220),
        usage: usageText,
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));

  const subjects: SubjectDef[] = [];
  let subjectCount = 0;
  const pictureOnly: SubjectDef[] = [];

  const nextSubjectLabel = (): string => {
    subjectCount += 1;
    return `<Subject ${subjectCount}>`;
  };

  referenceEntries.forEach((entry, index) => {
    const pictureNo = index + 1;
    const pictureLabel = `<Picture ${pictureNo}>`;
    const rawAnnotation = stripAssetBoilerplate(
      annotations[index] || entry.detailEn || entry.detail || '',
    );
    const annotation = rawAnnotation ? toSkillEnglish(rawAnnotation, 'note') : '';
    const displayName = clean(entry.label, 120) || `reference ${pictureNo}`;

    if (entry.type === 'storyboard') {
      pictureOnly.push({
        label: pictureLabel,
        role: 'storyboard',
        pictureIndex: pictureNo,
        definition: `${pictureLabel} is a storyboard reference for [Shot 1], defining panel order and successive visual beats only. Follow panels left-to-right, top-to-bottom inside one continuous shot. Do not reproduce a contact sheet, split screen, collage, panel borders, or the reference-image background.`,
        retention: `${pictureLabel} ([Shot 1] storyboard guide): weak_reference - use only temporal beat order; never show the grid itself.`,
        name: displayName,
      });
      return;
    }

    const subjectLabel = nextSubjectLabel();
    if (entry.type === 'character') {
      const matched = characters.find((character) => character.name === displayName) || characters[0];
      const wardrobeRaw = matched?.wardrobe ? toSkillEnglish(matched.wardrobe, 'wardrobe') : '';
      const wardrobe = wardrobeRaw ? ` Wardrobe lock: ${wardrobeRaw}.` : '';
      const identity = matched?.identity
        ? ` Identity cues: ${toSkillEnglish(matched.identity, 'identity')}.`
        : '';
      subjects.push({
        label: subjectLabel,
        role: 'character',
        pictureIndex: pictureNo,
        name: matched?.name || displayName,
        definition: `${subjectLabel} is ${matched?.name || displayName} from ${pictureLabel}, preserving facial identity, body plan, and costume continuity.${identity}${wardrobe}${annotation ? ` Reference detail: ${annotation}.` : ''}`,
        retention: `${subjectLabel} (appears in [Shot 1]): fully_preserved - identity, proportions, and wardrobe from ${pictureLabel} stay consistent.`,
      });
      return;
    }

    if (entry.type === 'scene') {
      const location = clean(scene?.location || displayName, 160);
      const atmosphereRaw = clean([scene?.time, scene?.atmosphere].filter(Boolean).join('; '), 220);
      const atmosphere = atmosphereRaw ? toSkillEnglish(atmosphereRaw, 'atmosphere') : '';
      const distinctAnnotation = isDistinctFact(rawAnnotation, [atmosphereRaw]) ? annotation : '';
      const topology = scene?.spatialTopology
        ? ` Spatial topology: ${toSkillEnglish(JSON.stringify(scene.spatialTopology), 'note')}.`
        : '';
      subjects.push({
        label: subjectLabel,
        role: 'scene',
        pictureIndex: pictureNo,
        name: location,
        definition: `${subjectLabel} is the environment from ${pictureLabel} (${location}${atmosphere ? `; ${atmosphere}` : ''}), preserving layout, lighting direction, and material palette.${topology}${distinctAnnotation ? ` Reference detail: ${distinctAnnotation}.` : ''}`,
        retention: `${subjectLabel} (appears in [Shot 1]): fully_preserved - scene layout, lighting, and materials from ${pictureLabel} remain stable.`,
      });
      return;
    }

    if (entry.type === 'prop') {
      const matched = props.find((prop) => prop.name === displayName);
      // Skip wearable stills that slipped into reference pack as props.
      if (!matched && wearablePropNames.includes(displayName)) {
        subjectCount -= 1;
        return;
      }
      const description = matched?.description
        ? ` ${toSkillEnglish(matched.description, 'note')}.`
        : '';
      const usage = matched?.usage
        ? ` Intended use: ${toSkillEnglish(matched.usage, 'note')}.`
        : '';
      const distinctAnnotation = isDistinctFact(rawAnnotation, [matched?.description || '', matched?.usage || '']) ? annotation : '';
      subjects.push({
        label: subjectLabel,
        role: 'prop',
        pictureIndex: pictureNo,
        name: matched?.name || displayName,
        definition: `${subjectLabel} is the prop ${matched?.name || displayName} from ${pictureLabel}, preserving shape, material, and surface detail.${description}${usage}${distinctAnnotation ? ` Reference detail: ${distinctAnnotation}.` : ''}`,
        retention: `${subjectLabel} (appears in [Shot 1]): fully_preserved - prop identity and materials from ${pictureLabel} remain recognizable.`,
      });
      return;
    }

    // turnaround / other → treat as character-like identity subject
    subjects.push({
      label: subjectLabel,
      role: 'character',
      pictureIndex: pictureNo,
      name: displayName,
      definition: `${subjectLabel} is the reusable visual identity from ${pictureLabel} (${displayName}), preserving appearance and proportions.${annotation ? ` Reference detail: ${annotation}.` : ''}`,
      retention: `${subjectLabel} (appears in [Shot 1]): fully_preserved - referenced identity from ${pictureLabel} stays consistent.`,
    });
  });

  // Shot-bound characters/props with no dedicated reference still get subject lines for continuity text.
  characters.forEach((character) => {
    if (subjects.some((subject) => subject.role === 'character' && subject.name === character.name)) return;
    const subjectLabel = nextSubjectLabel();
    const identity = character.identity ? `, ${toSkillEnglish(character.identity, 'identity')}` : '';
    const wardrobe = character.wardrobe ? `, wardrobe ${toSkillEnglish(character.wardrobe, 'wardrobe')}` : '';
    subjects.push({
      label: subjectLabel,
      role: 'character',
      name: character.name,
      definition: `${subjectLabel} is ${character.name}${identity}${wardrobe}. No dedicated still is supplied; keep appearance consistent with production facts.`,
      retention: `${subjectLabel} (appears in [Shot 1]): partially_preserved - keep named identity consistent without a dedicated picture lock.`,
    });
  });
  props.forEach((prop) => {
    if (subjects.some((subject) => subject.role === 'prop' && subject.name === prop.name)) return;
    const subjectLabel = nextSubjectLabel();
    const description = prop.description ? `: ${toSkillEnglish(prop.description, 'note')}` : '';
    const usage = prop.usage ? ` Use: ${toSkillEnglish(prop.usage, 'note')}.` : '';
    subjects.push({
      label: subjectLabel,
      role: 'prop',
      name: prop.name,
      definition: `${subjectLabel} is ${prop.name}${description}${usage} No dedicated still is supplied; keep material identity stable.`,
      retention: `${subjectLabel} (appears in [Shot 1]): partially_preserved - keep prop identity consistent without a dedicated picture lock.`,
    });
  });

  if (options.hasReferenceVideo) {
    subjects.push({
      label: '<Video 1>',
      role: 'video',
      definition: '<Video 1> is an optional motion/camera reference. Borrow only rhythm and camera language; do not copy unrelated identities or content.',
      retention: '<Video 1> (camera/motion guide): weak_reference - reuse motion language only.',
    });
  }
  if (options.hasReferenceAudio) {
    subjects.push({
      label: '<Audio 1>',
      role: 'audio',
      definition: '<Audio 1> is the supplied audio reference for timing and audible speech/sound intent.',
      retention: '<Audio 1>: reference - follow timing and timbre intent without inventing unrelated narration.',
    });
  }

  const subjectByRole = (role: SubjectRole, name?: string): SubjectDef | undefined =>
    subjects.find((subject) => subject.role === role && (!name || subject.name === name));

  const primaryCharacter = subjects.find((subject) => subject.role === 'character');
  const primaryScene = subjects.find((subject) => subject.role === 'scene');
  const characterMentions = subjects
    .filter((subject) => subject.role === 'character')
    .map((subject) => subject.label)
    .join(', ');
  const propMentions = subjects
    .filter((subject) => subject.role === 'prop')
    .map((subject) => subject.label)
    .join(', ');

  const purpose = toSkillEnglish(clean(agent?.directorPurpose || shot.actionSummary, 360), 'purpose');
  const emotionalBeat = toSkillEnglish(
    clean(agent?.emotionalBeat || scene?.creativeDirection?.emotionalTurn, 220),
    'mood',
  );
  const visualHook = toSkillEnglish(
    clean(agent?.visualHook || scene?.creativeDirection?.visualMotif, 220),
    'note',
  );
  const action = toSkillEnglish(clean(shot.actionSummary, 700), 'action');
  const entryState = toSkillEnglish(clean(agent?.continuity?.entryState, 280), 'state');
  const exitState = toSkillEnglish(clean(agent?.continuity?.exitState, 280), 'state');
  const structuredContinuity = toSkillEnglish(
    clean(formatContinuityLedgerForPrompt(agent?.continuityLedger), 520),
    'state',
  );
  const mustPreserve = (agent?.continuity?.mustPreserve || [])
    .map((item) => toSkillEnglish(clean(item, 120), 'note'))
    .filter(Boolean)
    .slice(0, 6);
  const feasibilityNotes = clean(agent?.h3FeasibilityNotes, 260);
  const feasibility = feasibilityNotes
    ? toSkillEnglish(feasibilityNotes, 'note')
    : `Keep one dominant physically achievable action within ${duration}s.`;
  const framingSize = normalizeShotSize(shot.shotSize) || 'Motivated cinematic framing';
  const cameraSentence = formatH3CameraMotion(shot.cameraMovement, shot.shotSize);

  // Keep compiler output aligned with the execution Agent and final H3 gate.
  // Short clips cannot reliably execute three setup/action/transition phases.
  const maxTimelineBeats = duration <= 5 ? 2 : duration <= 8 ? 3 : duration <= 15 ? 4 : 5;
  // The execution plan is the authoritative, preflighted action budget. Keep
  // timeline as a backward-compatible fallback for older shots.
  const sourceTimeline = agent?.executionPlan?.actionPhases?.length
    ? agent.executionPlan.actionPhases
    : agent?.timeline || [];
  const timelineBeats = sourceTimeline.length <= maxTimelineBeats
    ? sourceTimeline
    : Array.from({ length: maxTimelineBeats }, (_, index) =>
        sourceTimeline[Math.round(index * (sourceTimeline.length - 1) / Math.max(1, maxTimelineBeats - 1))],
      );

  const nativeAudio = options.nativeAudio;
  const spokenText = clean(nativeAudio?.text || shot.dialogue || shot.dubbing?.text, 500);
  const dialogueXml = spokenText ? formatDialogueBlock(spokenText, language) : '';
  const speakerName = clean(nativeAudio?.speakerName, 80);
  const speakingSubject = speakerName
    ? subjectByRole('character', speakerName) || primaryCharacter
    : primaryCharacter;

  const subjectDefinitions = [
    ...subjects.map((subject) => subject.definition),
    ...pictureOnly.map((item) => item.definition),
  ].join('\n');

  const summaryContext = primaryScene
    ? `Inside ${primaryScene.label}, ${primaryCharacter?.label || 'the referenced subjects'} performs one readable beat${propMentions ? ` involving ${propMentions}` : ''}`
    : `${primaryCharacter?.label || 'The referenced subjects'} perform one readable beat${propMentions ? ` involving ${propMentions}` : ''}`;
  const summary = `[reference generation] The target video is a ${duration}-second, ${aspectRatio} continuous shot. ${summaryContext}${purpose ? ` that advances the story through ${purpose}` : ''}.${emotionalBeat ? ` The visible emotional change is ${emotionalBeat}.` : ''}${visualHook ? ` The visual focus is ${visualHook}.` : ''} Reference stills provide identity and style anchors only; they are not literal opening or ending frames.`;

  const retentionAnalysis = [
    ...subjects.map((subject) => subject.retention),
    ...pictureOnly.map((item) => item.retention),
  ].join('\n') || 'No external references were supplied; preserve internal continuity only.';

  // Camera is appended once at shot level — do not embed per-beat camera (was duplicating).
  const beatNarration = timelineBeats.length > 0
    ? timelineBeats.map((beat) => {
        const beatAction = toSkillEnglish(clean(beat.action, 280), 'action');
        const beatSound = normalizeAudioCue(beat.sound);
        const beatCamera = clean(beat.camera, 180);
        const soundText = beatSound.replace(/^SFX\s+/i, '').trim();
        return [
          `[${beat.startSeconds.toFixed(1)}–${beat.endSeconds.toFixed(1)}s]`,
          `Action: ${beatAction}.`,
          beatCamera ? `Camera: ${toSkillEnglish(beatCamera, 'note')}.` : '',
          soundText ? `SFX: ${soundText}.` : '',
        ].filter(Boolean).join('\n');
      }).join('\n\n')
    : action;
  const timelineHasCamera = timelineBeats.some((beat) => Boolean(clean(beat.camera, 180)));
  const shotCameraClause = timelineHasCamera ? '' : ` ${cameraSentence}`;

  let speechClause = '';
  if (dialogueXml && nativeAudio?.mode === 'narration') {
    speechClause = ` A restrained off-screen narrator voice says ${dialogueXml}, while on-screen lips remain closed.`;
  } else if (dialogueXml && speakingSubject) {
    speechClause = ` ${speakingSubject.label} (S1) speaks in the original language and says ${dialogueXml}, with natural lip sync if the mouth is visible.`;
  } else if (dialogueXml) {
    speechClause = ` A clearly identified speaker (S1) says ${dialogueXml}.`;
  }

  const dialogueTiming = clean(agent?.executionPlan?.dialogueTiming, 320);
  const dialogueTimingClause = dialogueXml
    ? ` Dialogue timing: ${toSkillEnglish(dialogueTiming || 'Deliver the line during the clearest performance beat; preserve a short readable pause after it.', 'note')}.`
    : '';
  const endStateClause = clean(agent?.executionPlan?.endState, 320);

  const detailedDescription = `${styleOpening(visualStyle)} Total duration is exactly ${duration} seconds. No subtitles, captions, logos, watermarks, or on-screen text.

[Shot 1] ${framingSize} opens on the referenced stage. ${entryState ? `Entry state: ${entryState}. ` : ''}${structuredContinuity ? `Continuity ledger: ${structuredContinuity}. ` : ''}${characterMentions ? `${characterMentions} remain identity-locked. ` : ''}${propMentions ? `${propMentions} stay materially consistent. ` : ''}${primaryScene ? `${primaryScene.label} anchors the environment. ` : ''}
Action timeline:
${beatNarration}
${shotCameraClause}${exitState ? ` The shot lands on: ${exitState}.` : ''}${endStateClause && endStateClause !== exitState ? ` Planned end state: ${toSkillEnglish(endStateClause, 'state')}.` : ''}${mustPreserve.length ? ` Must preserve: ${mustPreserve.join('; ')}.` : ''} ${feasibility}${speechClause}${dialogueTimingClause} Keep one coherent full-screen shot with no montage cuts, split-screen, collage, contact sheet, or grid panels visible.`;

  const diegeticCues = [
    normalizeAudioCue(agent?.audioIntent),
    ...(agent?.executionPlan?.soundPlan || []).map((cue) => normalizeAudioCue(cue)),
    ...timelineBeats.map((beat) => normalizeAudioCue(beat.sound)),
  ].filter(Boolean).filter((cue, index, all) =>
    all.findIndex((other) => other === cue || other.includes(cue) || cue.includes(other)) === index
  );
  const continuousSound = normalizeAudioCue(agent?.audioIntent)
    || 'soft natural ambience matching the scene, kept audible but subordinate to the action';
  const timedSoundCues = timelineBeats
    .filter((beat) => Boolean(clean(beat.sound, 260)))
    .map((beat) => `[${beat.startSeconds.toFixed(1)}–${beat.endSeconds.toFixed(1)}s] ${normalizeAudioCue(beat.sound)}`);
  const timedSoundBlock = timedSoundCues.length
    ? ` Timed sound cues:\n${timedSoundCues.join('\n')}`
    : '';

  let overallSoundscape: string;
  if (options.hasReferenceAudio) {
    overallSoundscape = 'Follow the timing and audible layers guided by <Audio 1>; keep additional ambience subtle and synchronized. No unrelated narration.';
  } else if (nativeAudio?.mode === 'narration' || nativeAudio?.mode === 'dialogue' || spokenText) {
    overallSoundscape = `${timedSoundCues.length ? 'Overall sound intent' : 'Continuous ambience'} under the spoken line: ${continuousSound}.${timedSoundBlock} No extra voices.`;
  } else if (diegeticCues.length) {
    overallSoundscape = `${timedSoundCues.length ? 'Overall sound intent' : 'Continuous ambience'}: ${continuousSound}. Keep it synchronized with the action.${timedSoundBlock} No human speech, narration, singing, or speech-like vocalization.`;
  } else {
    const sceneHint = clean(primaryScene?.name || primaryScene?.label || '', 180);
    overallSoundscape = sceneHint
      ? `Continuous natural ambience matching ${sceneHint}: soft wind, distant flowing water, light fabric/object contact, and quiet outdoor air, clearly audible and synced to motion. No human speech, narration, singing, or speech-like vocalization.`
      : 'Continuous diegetic ambience with soft wind, distant water or room tone, and physical contact sounds clearly audible and synced to the action. No human speech, narration, singing, or speech-like vocalization.';
  }

  const audioSourceText = [
    agent?.audioIntent || '',
    ...(agent?.executionPlan?.soundPlan || []),
    ...timelineBeats.map((beat) => beat.sound || ''),
  ].join(' ');
  const explicitlyNoMusic = /无音乐|不要音乐|禁止音乐|no\s+(?:background\s+)?music|without\s+(?:background\s+)?music|music\s*:\s*n\/a/i.test(audioSourceText);
  const nonDiegeticMusic = (explicitlyNoMusic || options.hasReferenceAudio || spokenText || nativeAudio?.mode === 'narration' || nativeAudio?.mode === 'dialogue')
    ? 'N/A'
    : 'A very low, sparse atmospheric underscore with soft sustained tones; keep it subordinate to diegetic ambience and end cleanly with the shot.';

  const prompt = `subject_definitions:
${subjectDefinitions || 'No external reference subjects were supplied for this shot.'}

summary:
${summary}

retention_analysis:
${retentionAnalysis}

detailed_description:
${detailedDescription}

overall_soundscape:
${overallSoundscape}

non_diegetic_music:
${nonDiegeticMusic}`;

  return fitPrompt(prompt);
};
