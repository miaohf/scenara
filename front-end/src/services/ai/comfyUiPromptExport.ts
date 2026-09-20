/**
 * Convert Scenara-stored video prompts into paste-ready text for ComfyUI H3 nodes.
 * Supports both FLF2V (base skill) and Ref2VA (six-section) formats by stripping
 * Scenara-only policy / guardrail / legacy directive blocks. No LLM rewrite.
 */

export type ComfyUiPromptWorkflowKind = 'flf2v' | 'ref2va' | 'unknown';

const POLICY_BLOCK_PATTERN = /\n*\[VIDEO_PROMPT_POLICY_V1[^\]]*\][\s\S]*$/u;
const NATIVE_AUDIO_BLOCK_PATTERN = /\n*\[NATIVE_AUDIO_DIRECTIVE_V1\][\s\S]*$/u;
const NINE_GRID_RULES_PATTERN = /\n*\[NINE_GRID_FULLSCREEN_SEQUENCE_RULES_V2\][\s\S]*$/u;
const WORKFLOW_AUDIO_BLOCK_PATTERN = /\n*\[WORKFLOW_AUDIO[^\]]*\][\s\S]*$/u;
const END_FRAME_NOTE_PATTERN = /\n*END FRAME CONSTRAINT:[^\n]*/gi;
const CAPABILITY_ROUTING_PATTERN = /\n*Capability routing:[^\n]*/gi;
const HARD_RULES_ZH_PATTERN = /\n*HARD RULES（最高优先级）：[\s\S]*?(?=\n\n\[|\n\n[A-Za-z]|\s*$)/u;
const HARD_RULES_EN_PATTERN = /\n*HARD RULES \(HIGHEST PRIORITY\):[\s\S]*?(?=\n\n\[|\n\n[A-Za-z]|\s*$)/u;

export const detectComfyUiPromptWorkflowKind = (prompt?: string): ComfyUiPromptWorkflowKind => {
  const text = String(prompt || '');
  if (/^\s*subject_definitions:/m.test(text)) return 'ref2va';
  if (
    /^\s*integrated_multimodal_description:/m.test(text)
    || /How the reference pictures align with the target video/i.test(text)
    || /For the target video, at 0\.00 seconds/i.test(text)
  ) {
    return 'flf2v';
  }
  return 'unknown';
};

/** Strip Scenara-only wrappers; keep official H3 skill fields for both FLF2V and Ref2VA. */
export const toComfyUiPastePrompt = (prompt?: string): string => {
  let next = String(prompt || '').replace(/\r\n/g, '\n');
  if (!next.trim()) return '';

  next = next
    .replace(POLICY_BLOCK_PATTERN, '')
    .replace(NATIVE_AUDIO_BLOCK_PATTERN, '')
    .replace(NINE_GRID_RULES_PATTERN, '')
    .replace(WORKFLOW_AUDIO_BLOCK_PATTERN, '')
    .replace(END_FRAME_NOTE_PATTERN, '')
    .replace(CAPABILITY_ROUTING_PATTERN, '')
    .replace(HARD_RULES_ZH_PATTERN, '')
    .replace(HARD_RULES_EN_PATTERN, '');

  return next.replace(/\n{3,}/g, '\n\n').trim();
};
