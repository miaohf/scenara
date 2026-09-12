/**
 * Video prompt policy shared by cloud models and local ComfyUI workflows.
 *
 * The policy is intentionally separate from the narrative templates. Templates
 * describe what should happen; this module describes what the selected model
 * can reliably accept and what it must not render.
 */

export type VideoPromptPolicyFamily = 'sora' | 'veo' | 'comfyui' | 'generic';

export interface VideoPromptPolicy {
  family: VideoPromptPolicyFamily;
  supportsEndFrame: boolean;
  prefersStoryboardGrid: boolean;
  maxPromptChars: number;
  identityRules: string[];
  outputRules: string[];
}

const normalizeModelId = (modelId?: string): string =>
  String(modelId || '').trim().toLowerCase();

export const resolveVideoPromptPolicy = (
  modelId?: string,
  policyOverride?: VideoPromptPolicyFamily,
): VideoPromptPolicy => {
  const normalized = normalizeModelId(modelId);

  if (policyOverride) {
    const base = resolveVideoPromptPolicy(policyOverride);
    return { ...base, family: policyOverride };
  }

  if (normalized.includes('comfyui') || normalized.includes('comfy')) {
    return {
      family: 'comfyui',
      supportsEndFrame: true,
      prefersStoryboardGrid: false,
      maxPromptChars: 5000,
      identityRules: [
        'Use the supplied character, scene, and prop references as visual anchors.',
        'Keep identity, clothing, lighting, and prop appearance stable unless the action explicitly changes them.',
      ],
      outputRules: [
        'Follow the selected ComfyUI workflow input contract; do not invent unsupported inputs.',
        'Keep the shot as one coherent visual sequence unless the workflow explicitly requests storyboard panels.',
      ],
    };
  }

  if (normalized.includes('veo')) {
    return {
      family: 'veo',
      supportsEndFrame: true,
      prefersStoryboardGrid: true,
      maxPromptChars: 5000,
      identityRules: [
        'Preserve the identity, clothing, proportions, lighting, and environment from the supplied references.',
        'If a start and end frame are supplied, transition between their compositions without changing identity.',
      ],
      outputRules: [
        'Render one full-screen cinematic shot; do not show the storyboard grid as content.',
        'No split-screen, collage, picture-in-picture, multi-window layout, subtitles, or readable on-screen text.',
      ],
    };
  }

  if (normalized.includes('sora') || normalized.includes('doubao') || !normalized) {
    return {
      family: normalized.includes('doubao') ? 'sora' : 'sora',
      supportsEndFrame: false,
      prefersStoryboardGrid: true,
      maxPromptChars: 5000,
      identityRules: [
        'Use the supplied start frame as the exact opening composition.',
        'Preserve character identity, clothing, scene lighting, and prop appearance throughout the shot.',
      ],
      outputRules: [
        'Render one full-screen cinematic shot; storyboard panels are guidance only and must never be visible.',
        'No split-screen, grid lines, collage, picture-in-picture, multi-window layout, subtitles, or readable on-screen text.',
      ],
    };
  }

  return {
    family: 'generic',
    supportsEndFrame: true,
    prefersStoryboardGrid: false,
    maxPromptChars: 5000,
    identityRules: [
      'Preserve the supplied character, scene, lighting, and prop references throughout the shot.',
    ],
    outputRules: [
      'Render one coherent full-screen shot with motivated camera movement.',
      'Avoid accidental split-screen, collage, picture-in-picture, subtitles, and readable on-screen text.',
    ],
  };
};

export interface VideoPromptPolicyBlockOptions {
  modelId?: string;
  policyOverride?: VideoPromptPolicyFamily;
  language?: string;
  hasEndFrame?: boolean;
  hasStoryboardGrid?: boolean;
  panelCount?: number;
  durationSeconds?: number;
}

/** Build a short, deterministic policy block appended after the creative prompt. */
export const buildVideoPromptPolicyBlock = (
  options: VideoPromptPolicyBlockOptions = {},
): string => {
  const policy = resolveVideoPromptPolicy(options.modelId, options.policyOverride);
  const language = String(options.language || '').trim();
  const panelCount = Math.max(0, Math.floor(options.panelCount || 0));
  const duration = options.durationSeconds ? `${options.durationSeconds}s` : '';
  const lines = [
    `[VIDEO_PROMPT_POLICY_V1 family=${policy.family}]`,
    duration ? `Target duration: ${duration}. Keep the action achievable within this duration.` : '',
    ...policy.identityRules,
    ...policy.outputRules,
  ];

  if (options.hasEndFrame && !policy.supportsEndFrame) {
    lines.push('End-frame input is not supported by this model; follow the start-frame composition and describe a natural final state instead.');
  }

  if (options.hasStoryboardGrid && panelCount > 0 && policy.family !== 'comfyui') {
    lines.push(`The ${panelCount}-panel storyboard is shot-order guidance only; show one panel at a time in sequence, never the grid itself.`);
  }

  if (language) {
    lines.push(`If spoken dialogue is present, use ${language}; do not add narration or subtitles unless explicitly requested.`);
  }

  return lines.filter(Boolean).join('\n');
};

export const hasVideoPromptPolicy = (prompt?: string): boolean =>
  String(prompt || '').includes('[VIDEO_PROMPT_POLICY_V1');
