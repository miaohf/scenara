import { AspectRatio, ShotExecutionPlan, VideoDuration } from '../types';
import {
  validateAndRepairH3Prompt,
  type H3PromptWorkflowKind,
} from './ai/h3PromptValidator';

export type PromptLintSeverity = 'error' | 'warning' | 'info';

export interface PromptLintIssue {
  code: string;
  severity: PromptLintSeverity;
  message: string;
  suggestion?: string;
}

export interface PromptLintResult {
  issues: PromptLintIssue[];
  errorCount: number;
  warningCount: number;
  canProceed: boolean;
  /** Prompt after deterministic, safe preflight fixes. */
  normalizedPrompt?: string;
  /** Machine-readable fixes applied before generation. */
  autoFixes?: string[];
}

export interface KeyframePreflightInput {
  prompt: string;
  negativePrompt?: string;
  hasCharacters: boolean;
  frameType: 'start' | 'end';
  hasStartFrameImage: boolean;
  referenceImageCount: number;
  aspectRatio: AspectRatio;
  supportedAspectRatios?: AspectRatio[];
  productionIssues?: PromptLintIssue[];
  expectedCharacterNames?: string[];
}

export interface VideoPreflightInput {
  prompt: string;
  hasStartFrame: boolean;
  /** FLF2V 需要首帧；R2V 等参考图工作流不需要首帧。 */
  requiresStartFrame?: boolean;
  hasEndFrame: boolean;
  modelId: string;
  supportsEndFrame: boolean;
  aspectRatio: AspectRatio;
  supportedAspectRatios?: AspectRatio[];
  duration: VideoDuration;
  supportedDurations?: VideoDuration[];
  productionIssues?: PromptLintIssue[];
  requiresNativeAudioDirective?: boolean;
  h3WorkflowKind?: H3PromptWorkflowKind;
  h3ExecutionPlan?: ShotExecutionPlan;
  h3AudioIntent?: string;
  referenceImageCount?: number;
}

/** Legacy marker or official MiniMax H3 skill audio sections both satisfy native-audio preflight. */
export const hasH3NativeAudioCoverage = (prompt?: string): boolean => {
  const normalized = normalizePrompt(prompt);
  if (!normalized) return false;
  if (normalized.includes('[NATIVE_AUDIO_DIRECTIVE_V1]')) return true;
  // Official Ref2VA / FLF2V skill: soundscape (+ music) replace the legacy directive block.
  if (/^overall_soundscape:/m.test(normalized) || /\noverall_soundscape:/m.test(normalized)) {
    return true;
  }
  // FLF2V spoken line tag inside multimodal description
  if (/<d>\[[^\]]+\]/.test(normalized)) return true;
  return false;
};

const HUMAN_EXCLUSION_TERMS = [
  'person',
  'people',
  'human',
  'man',
  'woman',
  'child',
  'character',
  'silhouette',
  'crowd',
  'pedestrian',
];

const PLACEHOLDER_PATTERNS = [
  /\bTODO\b/i,
  /\bTBD\b/i,
  /\bto be filled\b/i,
  /未设置/,
  /待补充/,
  /待填写/,
];

const REPEATED_SYMBOLS_PATTERN = /([,.!?;:])\1{2,}/;

const normalizePrompt = (prompt?: string) => (prompt || '').trim();

const splitBySeparators = (value?: string): string[] => {
  if (!value) return [];
  return value
    .split(/[,;，；\n]+/)
    .map((item) => item.trim())
    .filter(Boolean);
};

export const hasHumanExclusionTerms = (negativePrompt?: string): boolean => {
  if (!negativePrompt) return false;
  const tokens = splitBySeparators(negativePrompt.toLowerCase());
  return tokens.some((token) =>
    HUMAN_EXCLUSION_TERMS.some((keyword) => token.includes(keyword))
  );
};

export const lintPromptText = (
  prompt: string,
  options?: {
    minLength?: number;
    maxLength?: number;
    allowEmpty?: boolean;
  }
): PromptLintResult => {
  const minLength = options?.minLength ?? 16;
  const maxLength = options?.maxLength ?? 2200;
  const allowEmpty = options?.allowEmpty ?? false;

  const normalized = normalizePrompt(prompt);
  const issues: PromptLintIssue[] = [];

  if (!normalized) {
    if (!allowEmpty) {
      issues.push({
        code: 'empty-prompt',
        severity: 'error',
        message: 'Prompt is empty.',
        suggestion: 'Provide a clear visual/action description before generating.',
      });
    }
    return buildLintResult(issues);
  }

  if (normalized.length < minLength) {
    issues.push({
      code: 'prompt-too-short',
      severity: 'warning',
      message: `Prompt is very short (${normalized.length} chars).`,
      suggestion: 'Add scene details, subject action, and composition clues.',
    });
  }

  if (normalized.length > maxLength) {
    issues.push({
      code: 'prompt-too-long',
      severity: 'warning',
      message: `Prompt is very long (${normalized.length} chars).`,
      suggestion: 'Remove duplicated phrases and keep only actionable details.',
    });
  }

  if (PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(normalized))) {
    issues.push({
      code: 'placeholder-text',
      severity: 'warning',
      message: 'Prompt still contains placeholder text.',
      suggestion: 'Replace placeholders with concrete visual instructions.',
    });
  }

  if (REPEATED_SYMBOLS_PATTERN.test(normalized)) {
    issues.push({
      code: 'repeated-symbols',
      severity: 'info',
      message: 'Prompt has repeated punctuation symbols.',
      suggestion: 'Clean punctuation to improve prompt readability.',
    });
  }

  return buildLintResult(issues);
};

export const runKeyframePreflight = (input: KeyframePreflightInput): PromptLintResult => {
  const promptLint = lintPromptText(input.prompt);
  const issues: PromptLintIssue[] = [...promptLint.issues, ...(input.productionIssues || [])];
  const normalizedPrompt = normalizePrompt(input.prompt);

  if (
    input.supportedAspectRatios?.length &&
    !input.supportedAspectRatios.includes(input.aspectRatio)
  ) {
    issues.push({
      code: 'unsupported-aspect-ratio',
      severity: 'error',
      message: `Aspect ratio ${input.aspectRatio} is not supported by current image model.`,
      suggestion: `Use one of: ${input.supportedAspectRatios.join(', ')}`,
    });
  }

  if (input.hasCharacters && hasHumanExclusionTerms(input.negativePrompt)) {
    issues.push({
      code: 'negative-conflict-human',
      severity: 'warning',
      message: 'Negative prompt contains human-exclusion terms while shot has characters.',
      suggestion: 'Remove person/human exclusion tokens for character shots.',
    });
  }

  if (input.referenceImageCount === 0) {
    issues.push({
      code: 'no-reference-images',
      severity: 'warning',
      message: 'No reference images provided for this keyframe.',
      suggestion: 'Attach scene/character/prop references to improve consistency.',
    });
  }

  if (input.frameType === 'end' && !input.hasStartFrameImage) {
    issues.push({
      code: 'end-without-start-image',
      severity: 'warning',
      message: 'Generating end frame without an existing start-frame image.',
      suggestion: 'Generate or upload start frame first for better continuity.',
    });
  }

  if (input.expectedCharacterNames?.length === 1) {
    if (!normalizedPrompt.includes('[LOCKED CHARACTER COUNT — DO NOT CHANGE]')) {
      issues.push({
        code: 'missing-single-character-lock',
        severity: 'error',
        message: 'Single-character shot is missing the deterministic character-count lock.',
        suggestion: 'Regenerate the prompt so a rear or over-the-shoulder view cannot be reinterpreted as a duplicate character.',
      });
    }
    const expectedName = input.expectedCharacterNames[0].trim();
    if (expectedName && !normalizedPrompt.toLocaleLowerCase().includes(expectedName.toLocaleLowerCase())) {
      issues.push({
        code: 'missing-character-name',
        severity: 'warning',
        message: `Prompt does not explicitly name the only visible character (${expectedName}).`,
        suggestion: 'Keep the named character in the composition lock and reference prompt.',
      });
    }
  }

  return buildLintResult(issues);
};

export const runVideoPreflight = (input: VideoPreflightInput): PromptLintResult => {
  const h3Validation = input.h3WorkflowKind
    ? validateAndRepairH3Prompt(input.prompt, {
        durationSeconds: Number(input.duration),
        expectedWorkflow: input.h3WorkflowKind,
        referenceImageCount: input.referenceImageCount,
        executionPlan: input.h3ExecutionPlan,
        audioIntent: input.h3AudioIntent,
      })
    : undefined;
  const normalizedPrompt = h3Validation?.prompt || input.prompt;
  // H3 skill prompts are structured six-section / multimodal blocks; 2600 is too tight and
  // only produces noise warnings. Align soft limit with fitVideoPromptLength (5000).
  const maxLength = input.requiresNativeAudioDirective ? 5000 : 2600;
  const promptLint = lintPromptText(normalizedPrompt, { minLength: 20, maxLength });
  const issues: PromptLintIssue[] = [
    ...promptLint.issues,
    ...(h3Validation?.issues || []),
    ...(input.productionIssues || []),
  ];

  if (input.requiresStartFrame !== false && !input.hasStartFrame) {
    issues.push({
      code: 'missing-start-frame',
      severity: 'error',
      message: 'Missing start frame image.',
      suggestion: 'Generate or upload a start frame before video generation.',
    });
  }

  if (
    input.supportedAspectRatios?.length &&
    !input.supportedAspectRatios.includes(input.aspectRatio)
  ) {
    issues.push({
      code: 'unsupported-video-aspect-ratio',
      severity: 'error',
      message: `Aspect ratio ${input.aspectRatio} is not supported by model ${input.modelId}.`,
      suggestion: `Use one of: ${input.supportedAspectRatios.join(', ')}`,
    });
  }

  if (
    input.supportedDurations?.length &&
    !input.supportedDurations.includes(input.duration)
  ) {
    issues.push({
      code: 'unsupported-video-duration',
      severity: 'error',
      message: `Duration ${input.duration}s is not supported by model ${input.modelId}.`,
      suggestion: `Use one of: ${input.supportedDurations.join(', ')} seconds`,
    });
  }

  if (input.hasEndFrame && !input.supportsEndFrame) {
    issues.push({
      code: 'end-frame-ignored',
      severity: 'info',
      message: `Model ${input.modelId} uses start-frame only; end frame will be ignored.`,
    });
  }

  if (input.requiresNativeAudioDirective && !hasH3NativeAudioCoverage(normalizedPrompt)) {
    issues.push({
      code: 'missing-native-audio-directive',
      severity: 'error',
      message: 'Native-audio video prompt is missing the H3 audio directive.',
      suggestion: 'Rebuild the video prompt so overall_soundscape (skill format) or [NATIVE_AUDIO_DIRECTIVE_V1] is present.',
    });
  }

  return buildLintResult(issues, normalizedPrompt, h3Validation?.autoFixes);
};

export const formatLintIssues = (issues: PromptLintIssue[]): string =>
  issues.map((issue) => `- [${issue.severity}] ${issue.message}`).join('\n');

const buildLintResult = (
  issues: PromptLintIssue[],
  normalizedPrompt?: string,
  autoFixes?: string[],
): PromptLintResult => {
  const errorCount = issues.filter((issue) => issue.severity === 'error').length;
  const warningCount = issues.filter((issue) => issue.severity === 'warning').length;
  return {
    issues,
    errorCount,
    warningCount,
    canProceed: errorCount === 0,
    ...(normalizedPrompt !== undefined ? { normalizedPrompt } : {}),
    ...(autoFixes?.length ? { autoFixes } : {}),
  };
};
