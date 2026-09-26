/**
 * Qwen Image 2.1 prompt compiler.
 *
 * The ComfyUI workflows already provide the model and image slots. This module
 * only turns Scenara's structured prompt + reference metadata into a concise,
 * model-oriented instruction. It deliberately does not ask an LLM to expand a
 * prompt at render time: a deterministic compiler keeps production renders
 * repeatable and preserves the user's locked story facts.
 */

export type QwenImageReferencePackType = 'shot' | 'character' | 'scene' | 'prop' | 'shape';
export type QwenImagePromptMode = 't2i' | 'edit';

export interface QwenImagePromptCompileInput {
  prompt: string;
  mode: QwenImagePromptMode;
  referencePackType: QwenImageReferencePackType;
  referenceAnnotations?: string[];
  referenceCount?: number;
  hasTurnaround?: boolean;
  isVariation?: boolean;
  hasContinuityReference?: boolean;
}

const normalize = (value: string): string => String(value || '')
  .replace(/\r/g, '')
  .replace(/\n{3,}/g, '\n\n')
  .replace(/[ \t]{2,}/g, ' ')
  .trim();

/** True only for the dedicated Qwen Image 2.1 ComfyUI graph/model. */
export const isQwenImage21Workflow = (workflowName?: string, modelIdentity?: string): boolean => {
  const identity = `${workflowName || ''} ${modelIdentity || ''}`.toLowerCase();
  return identity.includes('qwen_image_2_1') || identity.includes('qwen-image-2.1') || identity.includes('qwen image 2.1');
};

const describeReferenceRole = (
  index: number,
  input: QwenImagePromptCompileInput,
): string => {
  const explicit = String(input.referenceAnnotations?.[index - 1] || '').trim();
  if (explicit) return `<image${index}>: ${explicit}`;

  if (input.hasContinuityReference && index === (input.referenceCount || 0)) {
    return `<image${index}>: continuity canvas; preserve identity, environment, lighting, and spatial placement while changing only the requested moment.`;
  }

  switch (input.referencePackType) {
    case 'character':
      return `<image${index}>: character identity source; preserve face, hair, body plan, and any shown wardrobe.`;
    case 'scene':
      return `<image${index}>: environment-only source; preserve location layout, atmosphere, and lighting logic. Do not copy weapons, hero props, or prominent objects from this image as prop designs unless the matching prop reference is explicitly provided.`;
    case 'prop':
      return `<image${index}>: prop source; preserve silhouette, materials, colors, and distinguishing details.`;
    case 'shape':
      return `<image${index}>: shape-only source; use silhouette and proportions, but follow the text for rendering style, materials, color grading, and lighting.`;
    case 'shot':
    default:
      return `<image${index}>: reference source; use only for its named subject, scene, or prop role and do not merge identities.`;
  }
};

const buildReferenceRoles = (input: QwenImagePromptCompileInput): string => {
  const count = Math.max(0, input.referenceCount || 0);
  if (!count) return '';
  return Array.from({ length: count }, (_, index) => describeReferenceRole(index + 1, input)).join('\n');
};

const buildPreservationLocks = (input: QwenImagePromptCompileInput): string[] => {
  const locks = [
    'Preserve every identity-defining feature, count, named object, wardrobe fact, and spatial relationship that the request does not explicitly change.',
    'Do not add readable text, logos, watermarks, extra people, or unrelated objects unless the visual brief explicitly asks for them.',
    'Do not silently redesign the rendering medium, color grading, lighting, camera framing, or background when it is not an explicit requested change.',
  ];

  if (input.referencePackType === 'shape') {
    locks.push('Reference images are geometry-only; never inherit their rendering medium, palette, textures, or lighting.');
  }
  if (input.isVariation) {
    locks.push('Change the requested outfit or variation decisively, while keeping the referenced subject identity and body proportions unchanged.');
  }
  if (input.hasTurnaround) {
    locks.push('A turnaround sheet is one identity reference, not a collage layout to reproduce; use only the view matching the requested camera angle.');
  }
  if (input.referencePackType === 'shot') {
    locks.push('Scene references define environment only. A weapon or hero prop visible in a scene reference is not a required shot object; render it only when the shot explicitly calls for it, and use the matching prop reference as the sole design authority.');
  }
  return locks;
};

/**
 * Compile the final Qwen Image 2.1 text encoder prompt.
 *
 * T2I uses a compact observer-style visual brief. Edit uses explicit image
 * tags and attribute-disentanglement locks so multi-reference jobs do not
 * accidentally repaint unrequested parts of the canvas.
 */
export const compileQwenImage21Prompt = (input: QwenImagePromptCompileInput): string => {
  const visualBrief = normalize(input.prompt);
  if (!visualBrief) return '';

  if (input.mode === 't2i') {
    return normalize(`[QWEN_IMAGE_2_1_T2I_V1]
Generate one cohesive still image from the visual brief below. Treat explicitly named subjects, quantities, colors, written text, and spatial relations as fixed facts. Describe and render concrete observable details: subject, environment, composition across the frame, materials, and a physically coherent lighting setup. Keep the selected rendering style internally consistent. Do not invent logos, captions, watermarks, or extra subjects unless requested.

Visual brief:
${visualBrief}`);
  }

  const referenceRoles = buildReferenceRoles(input);
  const locks = buildPreservationLocks(input).map((lock) => `- ${lock}`).join('\n');
  return normalize(`[QWEN_IMAGE_2_1_EDIT_V1]
Perform the requested edit at full strength. Change only the attributes named in the visual brief; all unmentioned content remains faithful to its source image. Do not describe preserved elements in unnecessary detail, because that would repaint them.

${referenceRoles ? `Reference roles:\n${referenceRoles}\n` : ''}
Requested result:
${visualBrief}

Preservation locks:
${locks}`);
};
