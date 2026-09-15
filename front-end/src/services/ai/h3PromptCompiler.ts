import type { AspectRatio, ScriptData, Shot } from '../../types';
import type { ReferenceImageEntry } from '../referenceImagePack';
import { formatProductionBibleForPrompt } from '../productionBibleService';

const MAX_H3_PROMPT_CHARS = 4700;

const clean = (value: unknown, maxLength = 900): string => {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1).trimEnd()}…`;
};

const cleanLines = (value: unknown, maxLength: number): string => {
  const text = String(value ?? '')
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n');
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1).trimEnd()}…`;
};

const fitPrompt = (value: string): string => {
  const chars = Array.from(value);
  if (chars.length <= MAX_H3_PROMPT_CHARS) return value;
  return `${chars.slice(0, MAX_H3_PROMPT_CHARS - 1).join('').trimEnd()}…`;
};

export const isMiniMaxH3Ref2VAModel = (modelId: string): boolean => {
  const normalized = String(modelId || '').toLowerCase();
  return normalized.includes('minimax-h3') && (normalized.includes('r2v') || normalized.includes('ref2v'));
};

export interface MiniMaxH3Ref2VAPromptOptions {
  durationSeconds: number;
  aspectRatio?: AspectRatio;
  referenceEntries?: ReferenceImageEntry[];
  referenceAnnotations?: string[];
}

const describeReference = (
  entry: ReferenceImageEntry,
  index: number,
  annotation?: string,
): string => {
  const role = entry.type === 'scene'
    ? 'SCENE IDENTITY'
    : entry.type === 'prop'
      ? 'PROP IDENTITY'
      : 'CHARACTER IDENTITY';
  const composite = entry.isComposite && entry.includedLabels?.length
    ? `; left-to-right subjects: ${entry.includedLabels.join(', ')}`
    : '';
  const detail = clean(annotation || entry.detailEn || entry.detail || '', 360);
  return `- Image ${index + 1} — ${role}: ${clean(entry.label, 160)}${composite}${detail ? `. ${detail}` : '.'}`;
};

/**
 * 把 Agent 的结构化镜头意图编译为 MiniMax H3 Ref2VA 可执行提示词。
 * 参考图只承担身份/场景/道具约束，不被误写成首帧或尾帧。
 */
export const buildMiniMaxH3Ref2VAPrompt = (
  shot: Shot,
  scriptData: ScriptData | null | undefined,
  options: MiniMaxH3Ref2VAPromptOptions,
): string => {
  const duration = Math.max(1, Number(options.durationSeconds) || 5);
  const aspectRatio = options.aspectRatio || '16:9';
  const agent = shot.agent;
  const scene = scriptData?.scenes.find((item) => String(item.id) === String(shot.sceneId));
  const characters = (shot.characters || [])
    .map((characterId) => {
      const character = scriptData?.characters.find((item) => String(item.id) === String(characterId));
      if (!character) return null;
      const variationId = shot.characterVariations?.[characterId];
      const variation = variationId
        ? character.variations?.find((item) => String(item.id) === String(variationId))
        : undefined;
      return {
        name: character.name,
        identity: clean(character.creativeDirection?.silhouette || character.coreFeatures || character.species, 260),
        wardrobe: clean(variation?.wardrobe || character.wardrobe, 360),
        performance: clean(character.creativeDirection?.performanceNotes, 320),
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
  const props = (shot.props || [])
    .map((propId) => {
      const prop = scriptData?.props.find((item) => String(item.id) === String(propId));
      return prop ? { prop, usage: shot.propUsages?.[propId] } : null;
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .map(({ prop, usage }) => {
      const usageText = usage
        ? clean([usage.mode, usage.position, usage.action].filter(Boolean).join(' | '), 240)
        : clean([prop.presentationMode, prop.presentationNote].filter(Boolean).join(' | '), 240);
      return `${prop.name}: ${clean(prop.description, 280)}${usageText ? `; use: ${usageText}` : ''}`;
    });

  const referenceEntries = (options.referenceEntries || []).slice(0, 9);
  const referenceMap = referenceEntries.length
    ? referenceEntries.map((entry, index) =>
        describeReference(entry, index, options.referenceAnnotations?.[index]),
      ).join('\n')
    : '- Use the supplied reference images in order as identity/style anchors.';
  const timeline = agent?.timeline?.length
    ? agent.timeline.map((beat) => {
        const camera = clean(beat.camera, 200);
        const sound = clean(beat.sound, 220);
        return `- ${beat.startSeconds.toFixed(1)}-${beat.endSeconds.toFixed(1)}s: ${clean(beat.action, 420)}${camera ? ` Camera: ${camera}.` : ''}${sound ? ` Sound: ${sound}.` : ''}`;
      }).join('\n')
    : `- 0.0-${duration.toFixed(1)}s: ${clean(shot.actionSummary, 900)} Camera: ${clean(shot.cameraMovement, 260)}.`;
  const characterBlock = characters.length
    ? characters.map((character) =>
        `- ${character.name}: identity ${character.identity || 'match its labeled reference'}; wardrobe ${character.wardrobe || 'match the established reference exactly'}; performance ${character.performance || 'follow the shot emotional beat'}.`,
      ).join('\n')
    : '- No visible character unless explicitly required by the shot action.';
  const continuity = agent?.continuity;
  const productionBible = scriptData
    ? cleanLines(formatProductionBibleForPrompt(scriptData), 1200)
    : '';

  const prompt = `[MINIMAX H3 REF2VA — EXECUTION PROMPT]
Mode: multi-reference image-to-video with native synchronized audio, ${duration}s, ${aspectRatio}.

[REFERENCE ROLE MAP]
${referenceMap}
Reference images are identity, wardrobe, scene-layout, material, and style anchors. They are NOT literal opening frames or ending frames. Do not reproduce a contact sheet, split screen, collage, turnaround sheet, neutral studio pose, or reference-image background in the final video.

[STORY PURPOSE]
Director purpose: ${clean(agent?.directorPurpose || shot.actionSummary, 700)}
Emotional beat: ${clean(agent?.emotionalBeat || scene?.creativeDirection?.emotionalTurn, 520)}
Visual hook: ${clean(agent?.visualHook || scene?.creativeDirection?.visualMotif, 520)}
${productionBible ? `\n[PRODUCTION BIBLE]\n${productionBible}` : ''}

[SCENE]
Location/time/atmosphere: ${clean([scene?.location, scene?.time, scene?.atmosphere].filter(Boolean).join(' | '), 620)}

[IDENTITY AND WARDROBE LOCK]
${characterBlock}
${props.length ? `Visible props:\n${props.map((prop) => `- ${prop}`).join('\n')}` : 'Visible props: none beyond established scene dressing.'}

[TIME-CODED ACTION]
${timeline}

[CAMERA]
Shot size: ${clean(shot.shotSize, 180) || 'motivated cinematic framing'}.
Movement: ${clean(shot.cameraMovement, 320) || 'stable motivated camera'}.
Preserve readable geography, eyelines, body mechanics, and screen direction. Do not add unplanned cuts or montage transitions.

[CONTINUITY]
Entry state: ${clean(continuity?.entryState, 520) || 'preserve the established incoming physical state'}.
Exit state: ${clean(continuity?.exitState, 520) || 'finish on the planned readable state change'}.
Screen direction: ${clean(continuity?.screenDirection, 260) || 'preserve established eyelines and movement direction'}.
Must preserve: ${continuity?.mustPreserve?.length ? continuity.mustPreserve.map((item) => clean(item, 180)).join('; ') : 'identity, exact wardrobe, prop identity, scene layout, lighting direction'}.
H3 feasibility: ${clean(agent?.h3FeasibilityNotes, 520) || `one dominant physically achievable action within ${duration}s`}.

[AUDIO INTENT]
${clean(agent?.audioIntent || (shot.dialogue ? `Original-language dialogue: ${shot.dialogue}` : 'Diegetic ambience only; no speech or narration.'), 620)}

[OUTPUT LOCK]
One coherent cinematic shot. Preserve each referenced subject separately; no identity mixing, wardrobe mixing, duplicate subjects, morphing, extra limbs, subtitles, captions, logos, watermarks, or on-screen text.`;

  return fitPrompt(prompt);
};
