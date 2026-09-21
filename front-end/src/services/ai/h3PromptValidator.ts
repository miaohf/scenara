export type H3PromptWorkflowKind = 'ref2va' | 'base';
export type H3PromptIssueSeverity = 'error' | 'warning' | 'info';

export interface H3PromptIssue {
  code: string;
  severity: H3PromptIssueSeverity;
  field?: string;
  message: string;
  suggestion?: string;
  autoFix?: string;
}

export interface H3PromptValidationContext {
  durationSeconds: number;
  expectedWorkflow: H3PromptWorkflowKind;
  referenceImageCount?: number;
  executionPlan?: {
    actionPhases?: Array<{
      startSeconds: number;
      endSeconds: number;
      action: string;
      camera?: string;
      sound?: string;
    }>;
    cameraPlan?: string;
    endState?: string;
    soundPlan?: string[];
  };
  audioIntent?: string;
}

export interface H3PromptValidationResult {
  prompt: string;
  issues: H3PromptIssue[];
  autoFixes: string[];
  errorCount: number;
  warningCount: number;
  canProceed: boolean;
}

const REF2VA_SECTIONS = [
  'subject_definitions',
  'summary',
  'retention_analysis',
  'detailed_description',
  'overall_soundscape',
  'non_diegetic_music',
] as const;

const BASE_SECTIONS = [
  'integrated_multimodal_description',
  'overall_soundscape',
  'non_diegetic_music',
] as const;

const ALL_SECTIONS = [...REF2VA_SECTIONS, ...BASE_SECTIONS];
const VISUAL_RETENTION_VALUES = new Set([
  'fully_preserved',
  'partially_preserved',
  'attribute_transfer',
  'weak_reference',
]);

interface ParsedSection {
  name: string;
  headerStart: number;
  contentStart: number;
  contentEnd: number;
  content: string;
}

const parseSections = (prompt: string): ParsedSection[] => {
  const escaped = ALL_SECTIONS.join('|');
  const pattern = new RegExp(`^(${escaped})\\s*:\\s*`, 'gmi');
  const matches = Array.from(prompt.matchAll(pattern));
  return matches.map((match, index) => {
    const contentStart = (match.index || 0) + match[0].length;
    const contentEnd = matches[index + 1]?.index ?? prompt.length;
    return {
      name: match[1].toLowerCase(),
      headerStart: match.index || 0,
      contentStart,
      contentEnd,
      content: prompt.slice(contentStart, contentEnd).trim(),
    };
  });
};

const getSection = (sections: ParsedSection[], name: string): ParsedSection | undefined =>
  sections.find((section) => section.name === name);

const replaceSectionContent = (prompt: string, section: ParsedSection, nextContent: string): string =>
  `${prompt.slice(0, section.contentStart)}${nextContent.trim()}\n\n${prompt.slice(section.contentEnd).replace(/^\s+/, '')}`.trim();

const maxExecutionPhasesForDuration = (durationSeconds: number): number => {
  if (durationSeconds <= 5) return 2;
  if (durationSeconds <= 8) return 3;
  if (durationSeconds <= 15) return 4;
  return 5;
};

const countActionTransitions = (value: string): number => {
  const chinese = value.match(
    /收起|收上|拖过|拖入|放下|抓起|拿起|举起|插入|插进|撑入|撑动|推动|加速|驶入|进入|离开|转身|抬头|低头|站起|坐下|停住|发现|望向|走向|跑向|跳下|打开|关闭|落下|移到|移动/gu,
  ) || [];
  const english = value.match(
    /\b(?:pulls?|drags?|drops?|grabs?|takes?|raises?|plants?|pushes?|accelerates?|enters?|exits?|turns?|looks?|stands?|sits?|stops?|notices?|walks?|runs?|jumps?|opens?|closes?|moves?)\b/gi,
  ) || [];
  return new Set([...chinese, ...english].map((item) => item.toLowerCase())).size;
};

const cameraMotionFamilies = (value: string): string[] => {
  const text = value.toLowerCase();
  const families: Array<[string, RegExp]> = [
    ['tracking', /tracking|跟拍|跟随/u],
    ['dolly', /\bdolly\b|推近|拉远|镜头后退|向前推进|轻微靠近/u],
    ['pan', /\bpan\b|摇摄|横摇/u],
    ['tilt', /\btilt\b|俯仰|上摇|下摇/u],
    ['orbit', /\borbit\b|环绕|绕行/u],
    ['zoom', /\bzoom\b|变焦/u],
    ['crane', /\bcrane\b|升降|吊臂/u],
    ['handheld', /handheld|手持/u],
  ];
  return families.filter(([, pattern]) => pattern.test(text)).map(([name]) => name);
};

interface PromptPhase {
  startSeconds: number;
  endSeconds: number;
  action: string;
  camera: string;
  sound: string;
}

const parsePromptPhases = (description: string): PromptPhase[] => {
  const marker = /^\[(\d+(?:\.\d+)?)\s*[–—-]\s*(\d+(?:\.\d+)?)s\]\s*$/gmu;
  const matches = Array.from(description.matchAll(marker));
  return matches.map((match, index) => {
    const blockStart = (match.index || 0) + match[0].length;
    const blockEnd = matches[index + 1]?.index ?? description.length;
    const block = description.slice(blockStart, blockEnd);
    return {
      startSeconds: Number(match[1]),
      endSeconds: Number(match[2]),
      action: block.match(/^Action:\s*(.+)$/mi)?.[1]?.trim() || '',
      camera: block.match(/^Camera:\s*(.+)$/mi)?.[1]?.trim() || '',
      sound: block.match(/^SFX:\s*(.+)$/mi)?.[1]?.trim() || '',
    };
  });
};

const noMusicPattern = /无音乐|不要音乐|禁止音乐|仅(?:保留|使用)?环境声|环境声主导|no\s+(?:background\s+|non[- ]?diegetic\s+)?music|without\s+(?:background\s+)?music|diegetic(?:\s+environmental)?\s+sound\s+only|music\s*:\s*n\/?a/iu;
const musicIsEmptyPattern = /^(?:n\/?a|none|无|不使用)$/iu;
const occludedEndPattern = /没入.{0,8}(?:浓雾|晨雾|黑暗)|驶入.{0,8}(?:浓雾|晨雾|黑暗)|进入.{0,8}(?:浓雾|晨雾|黑暗)|只剩.{0,12}轮廓|出画|消失|disappears?|vanishes?|only\s+(?:the\s+)?silhouette/iu;
const fineDetailVisiblePattern = /(?:桃花|花瓣|眼神|文字|刻痕|微小|细节).{0,16}(?:清晰|可见|可辨|辨认)|(?:清晰|可见|可辨).{0,16}(?:桃花|花瓣|眼神|文字|刻痕|微小|细节)|(?:small|tiny|fine)\s+detail.{0,20}(?:visible|readable|clear)/iu;

const uniqueIssues = (issues: H3PromptIssue[]): H3PromptIssue[] => {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = `${issue.code}|${issue.field || ''}|${issue.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

export const validateAndRepairH3Prompt = (
  sourcePrompt: string,
  context: H3PromptValidationContext,
): H3PromptValidationResult => {
  const issues: H3PromptIssue[] = [];
  const autoFixes: string[] = [];
  let prompt = String(sourcePrompt || '').trim();

  if (/&#x20;|&nbsp;/iu.test(prompt)) {
    prompt = prompt.replace(/&#x20;|&nbsp;/giu, ' ');
    autoFixes.push('removed-html-space-entities');
    issues.push({
      code: 'h3-html-entity-autofixed',
      severity: 'info',
      message: 'Removed leaked HTML space entities from the H3 prompt.',
      autoFix: 'Replaced &#x20;/&nbsp; with plain spaces.',
    });
  }

  let sections = parseSections(prompt);
  const sectionNames = sections.map((section) => section.name);
  const actualWorkflow: H3PromptWorkflowKind | 'unknown' = sectionNames.includes('subject_definitions')
    ? 'ref2va'
    : sectionNames.includes('integrated_multimodal_description')
      ? 'base'
      : 'unknown';

  if (actualWorkflow === 'unknown') {
    issues.push({
      code: 'h3-unrecognized-structure',
      severity: 'error',
      message: 'Prompt is not a recognized MiniMax H3 three-field or six-section prompt.',
      suggestion: 'Rebuild the prompt for the selected H3 workflow.',
    });
  } else if (actualWorkflow !== context.expectedWorkflow) {
    issues.push({
      code: 'h3-workflow-mismatch',
      severity: 'error',
      message: `Prompt shape is ${actualWorkflow}, but the selected workflow requires ${context.expectedWorkflow}.`,
      suggestion: 'Rebuild from the shot after selecting the intended video workflow.',
    });
  }

  const requiredSections = context.expectedWorkflow === 'ref2va' ? REF2VA_SECTIONS : BASE_SECTIONS;
  const missingSections = requiredSections.filter((name) => !sectionNames.includes(name));
  if (missingSections.length) {
    issues.push({
      code: 'h3-missing-sections',
      severity: 'error',
      message: `Missing H3 sections: ${missingSections.join(', ')}.`,
      suggestion: 'Rebuild the prompt so all official fields are present.',
    });
  } else {
    const actualOrder = sectionNames.filter((name) => (requiredSections as readonly string[]).includes(name));
    if (actualOrder.join('|') !== requiredSections.join('|')) {
      issues.push({
        code: 'h3-section-order',
        severity: 'error',
        message: `H3 section order is invalid: ${actualOrder.join(' → ')}.`,
        suggestion: `Use: ${requiredSections.join(' → ')}.`,
      });
    }
  }

  const duration = Math.max(1, Number(context.durationSeconds) || 5);
  const durationMentions = Array.from(prompt.matchAll(/(?:target video is a|duration is exactly|duration_seconds["']?\s*[:=])\s*(\d+(?:\.\d+)?)/giu))
    .map((match) => Number(match[1]))
    .filter(Number.isFinite);
  if (durationMentions.some((value) => Math.abs(value - duration) > 0.05)) {
    issues.push({
      code: 'h3-duration-mismatch',
      severity: 'error',
      field: 'detailed_description',
      message: `Prompt duration (${durationMentions.join(', ')}s) does not match selected duration ${duration}s.`,
      suggestion: 'Rebuild the prompt using the currently selected duration.',
    });
  }
  if (duration < 4 || duration > 15) {
    issues.push({
      code: 'h3-duration-out-of-range',
      severity: 'error',
      message: `MiniMax H3 duration ${duration}s is outside the supported 4–15 second range.`,
    });
  }

  const description = getSection(
    sections,
    context.expectedWorkflow === 'ref2va' ? 'detailed_description' : 'integrated_multimodal_description',
  )?.content || '';
  const promptPhases = parsePromptPhases(description);
  const planPhases = context.executionPlan?.actionPhases || [];
  const phases = promptPhases.length ? promptPhases : planPhases.map((phase) => ({
    ...phase,
    camera: phase.camera || '',
    sound: phase.sound || '',
  }));
  const maxPhases = maxExecutionPhasesForDuration(duration);
  if (phases.length > maxPhases) {
    issues.push({
      code: 'h3-too-many-action-phases',
      severity: 'error',
      field: 'detailed_description',
      message: `${duration}s shot has ${phases.length} action phases; maximum is ${maxPhases}.`,
      suggestion: 'Re-run the single-shot Agent and preserve one dominant action.',
    });
  }

  let previousEnd = 0;
  phases.forEach((phase, index) => {
    if (phase.startSeconds < previousEnd || phase.endSeconds <= phase.startSeconds || phase.endSeconds > duration + 0.05) {
      issues.push({
        code: 'h3-invalid-phase-timing',
        severity: 'error',
        field: 'detailed_description',
        message: `Action phase ${index + 1} has invalid or overlapping timing (${phase.startSeconds}–${phase.endSeconds}s).`,
      });
    }
    previousEnd = Math.max(previousEnd, phase.endSeconds);

    const phaseDuration = Math.max(0.1, phase.endSeconds - phase.startSeconds);
    const transitionCount = countActionTransitions(phase.action);
    const transitionLimit = phaseDuration <= 3 ? 3 : phaseDuration <= 5 ? 4 : 5;
    if (transitionCount > transitionLimit) {
      issues.push({
        code: 'h3-action-density',
        severity: 'error',
        field: `action_phase_${index + 1}`,
        message: `Action phase ${index + 1} contains about ${transitionCount} state-changing actions in ${phaseDuration.toFixed(1)}s.`,
        suggestion: 'Keep one dominant action and reduce setup actions to an already-established state.',
      });
    }

    const motionFamilies = cameraMotionFamilies(phase.camera);
    if (motionFamilies.length > 1) {
      issues.push({
        code: 'h3-multiple-camera-motions',
        severity: 'warning',
        field: `action_phase_${index + 1}.camera`,
        message: `Camera phase ${index + 1} mixes multiple movements: ${motionFamilies.join(', ')}.`,
        suggestion: 'Use one dominant camera movement for the continuous shot.',
      });
    }
  });

  const planCameraFamilies = cameraMotionFamilies(context.executionPlan?.cameraPlan || '');
  if (planCameraFamilies.length > 1) {
    issues.push({
      code: 'h3-multiple-camera-motions',
      severity: 'warning',
      field: 'cameraPlan',
      message: `Execution plan mixes multiple camera movements: ${planCameraFamilies.join(', ')}.`,
      suggestion: 'Normalize the plan to one motivated movement.',
    });
  }

  const endStateText = `${context.executionPlan?.endState || ''} ${description}`;
  if (occludedEndPattern.test(endStateText) && fineDetailVisiblePattern.test(endStateText)) {
    issues.push({
      code: 'h3-end-state-visibility-conflict',
      severity: 'warning',
      field: 'detailed_description',
      message: 'The ending hides or silhouettes the subject while also requiring a fine detail to remain clearly readable.',
      suggestion: 'Choose either the distant/occluded ending or the readable detail as the final visual payoff.',
    });
  }

  if (context.expectedWorkflow === 'ref2va') {
    const subjectDefinitions = getSection(sections, 'subject_definitions')?.content || '';
    const retention = getSection(sections, 'retention_analysis')?.content || '';
    const defined = new Set(
      Array.from(subjectDefinitions.matchAll(/<(Subject|Picture|Video|Audio)\s+(\d+)>/giu))
        .map((match) => `${match[1].toLowerCase()}:${match[2]}`),
    );
    const bodyWithoutDefinitions = sections
      .filter((section) => section.name !== 'subject_definitions')
      .map((section) => section.content)
      .join('\n');
    const used = new Set(
      Array.from(bodyWithoutDefinitions.matchAll(/<(Subject|Picture|Video|Audio)\s+(\d+)>/giu))
        .map((match) => `${match[1].toLowerCase()}:${match[2]}`),
    );
    const undefinedLabels = Array.from(used).filter((label) => !defined.has(label));
    if (undefinedLabels.length) {
      issues.push({
        code: 'h3-undefined-reference-label',
        severity: 'error',
        field: 'subject_definitions',
        message: `Undefined reference labels: ${undefinedLabels.join(', ')}.`,
      });
    }
    const detailedUsed = new Set(
      Array.from(description.matchAll(/<(Subject|Picture|Video|Audio)\s+(\d+)>/giu))
        .map((match) => `${match[1].toLowerCase()}:${match[2]}`),
    );
    const unusedSubjects = Array.from(defined)
      .filter((label) => label.startsWith('subject:') && !detailedUsed.has(label));
    if (unusedSubjects.length) {
      issues.push({
        code: 'h3-unused-subject-reference',
        severity: 'warning',
        field: 'subject_definitions',
        message: `Subjects defined but not used in the shot description: ${unusedSubjects.join(', ')}.`,
        suggestion: 'Remove or downgrade references that do not participate in this shot.',
      });
    }

    for (const match of retention.matchAll(/:\s*([a-z_]+)\s*-/giu)) {
      if (!VISUAL_RETENTION_VALUES.has(match[1].toLowerCase())) {
        issues.push({
          code: 'h3-invalid-retention-value',
          severity: 'error',
          field: 'retention_analysis',
          message: `Invalid visual retention value: ${match[1]}.`,
        });
      }
    }
    if (/\(S\d+\)/iu.test(retention)) {
      issues.push({
        code: 'h3-speaker-id-in-retention',
        severity: 'error',
        field: 'retention_analysis',
        message: 'Speaker IDs belong in detailed_description, not retention_analysis.',
      });
    }
  }

  if ((context.referenceImageCount || 0) > 9) {
    issues.push({
      code: 'h3-too-many-reference-images',
      severity: 'error',
      message: `Ref2VA received ${context.referenceImageCount} reference images; maximum is 9.`,
    });
  } else if ((context.referenceImageCount || 0) >= 7) {
    issues.push({
      code: 'h3-reference-pressure',
      severity: 'info',
      message: `${context.referenceImageCount} reference images are active; verify that every image is important to the visible beat.`,
    });
  }

  const audioIntentText = [
    context.audioIntent || '',
    ...(context.executionPlan?.soundPlan || []),
    ...(context.executionPlan?.actionPhases || []).map((phase) => phase.sound || ''),
    getSection(sections, 'overall_soundscape')?.content || '',
    ...phases.map((phase) => phase.sound),
  ].join(' ');
  const musicSection = getSection(sections, 'non_diegetic_music');
  if (musicSection && noMusicPattern.test(audioIntentText) && !musicIsEmptyPattern.test(musicSection.content.trim())) {
    prompt = replaceSectionContent(prompt, musicSection, 'N/A');
    autoFixes.push('forced-non-diegetic-music-na');
    issues.push({
      code: 'h3-music-conflict-autofixed',
      severity: 'warning',
      field: 'non_diegetic_music',
      message: 'The sound plan requires no music, but non_diegetic_music requested an underscore.',
      suggestion: 'Keep environmental and physical sound only.',
      autoFix: 'Set non_diegetic_music to N/A.',
    });
    sections = parseSections(prompt);
  }

  const finalIssues = uniqueIssues(issues);
  const errorCount = finalIssues.filter((issue) => issue.severity === 'error').length;
  const warningCount = finalIssues.filter((issue) => issue.severity === 'warning').length;
  return {
    prompt,
    issues: finalIssues,
    autoFixes,
    errorCount,
    warningCount,
    canProceed: errorCount === 0,
  };
};
