import {
  chatCompletion,
  chatCompletionStream,
  getActiveChatModelName,
  logScriptProgress,
  parseJsonWithRecovery,
  retryOperation,
} from './apiCore';
import {
  buildScreenwritingGuidance,
  type ScreenwritingModuleId,
} from './screenwritingModuleRouter';

type UnknownRecord = Record<string, unknown>;

export type ScriptRewriteAgentStage = 'planning' | 'rewriting' | 'reviewing' | 'repairing' | 'verifying' | 'completed';
export type ScriptRewriteAgentEventStatus = 'running' | 'success' | 'warning' | 'error' | 'info';

export interface ScriptRewritePlan {
  synopsis: string;
  rewriteGoals: string[];
  openingHook: string;
  centralConflict: string;
  escalation: string;
  climax: string;
  payoff: string;
  characterDirections: Array<{
    character: string;
    objective: string;
    emotionalArc: string;
    dialogueVoice: string;
  }>;
  continuityLocks: string[];
  visualStorytelling: string[];
  pacingPlan: string[];
  targetLength: string;
}

export interface ScriptRewriteIssue {
  severity: 'low' | 'medium' | 'high';
  category: string;
  location: string;
  problem: string;
  repairInstruction: string;
}

export interface ScriptRewriteReview {
  verdict: 'pass' | 'repair';
  overallScore: number;
  scores: {
    storyFidelity: number;
    causality: number;
    characterConsistency: number;
    dialogue: number;
    pacing: number;
    shootability: number;
  };
  summary: string;
  strengths: string[];
  issues: ScriptRewriteIssue[];
}

export interface ScriptRewriteAgentEvent {
  stage: ScriptRewriteAgentStage;
  status: ScriptRewriteAgentEventStatus;
  title: string;
  detail?: string;
  stableId: string;
}

export interface ScriptRewriteAgentOptions {
  instruction?: string;
  maxOutputChars?: number;
  targetDuration?: string;
  abortSignal?: AbortSignal;
  onEvent?: (event: ScriptRewriteAgentEvent) => void;
  onDraftUpdate?: (draft: string, stage: 'rewriting' | 'repairing') => void;
  /** Optional explicit module selection; otherwise modules are routed from the task. */
  screenwritingModules?: ScreenwritingModuleId[];
}

export interface ScriptRewriteAgentResult {
  script: string;
  firstDraft: string;
  plan: ScriptRewritePlan;
  review: ScriptRewriteReview;
  repaired: boolean;
  repairedIssueCount: number;
  degraded: boolean;
  warnings: string[];
  durationMs: number;
}

const asRecord = (value: unknown): UnknownRecord => (
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : {}
);

const asRecordArray = (value: unknown): UnknownRecord[] => (
  Array.isArray(value) ? value.map(asRecord) : []
);

const clean = (value: unknown, maxLength = 1200): string => {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1).trimEnd()}…`;
};

const cleanLines = (value: unknown): string => {
  let text = String(value ?? '').trim();
  text = text.replace(/^```(?:markdown|text)?\s*/i, '').replace(/```\s*$/i, '').trim();
  return text;
};

interface ScriptLengthTarget {
  minChars: number;
  maxChars: number;
  label: string;
}

const resolveDurationSeconds = (duration?: string): number | null => {
  const raw = String(duration || '').trim().toLowerCase();
  if (!raw || raw === 'custom') return null;
  const match = raw.match(/^(\d+(?:\.\d+)?)\s*(s|sec|secs|second|seconds|秒|m|min|mins|minute|minutes|分钟)?$/);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value <= 0) return null;
  return match[2] && /^(m|min|mins|minute|minutes|分钟)$/.test(match[2]) ? value * 60 : value;
};

const getScriptLengthTarget = (options: ScriptRewriteAgentOptions): ScriptLengthTarget | null => {
  const seconds = resolveDurationSeconds(options.targetDuration);
  if (!seconds) return null;
  const hardLimit = options.maxOutputChars || 20000;
  const minChars = Math.max(220, Math.round(seconds * 13));
  const maxChars = Math.min(hardLimit, Math.max(minChars + 200, Math.round(seconds * 30)));
  return {
    minChars,
    maxChars,
    label: `${options.targetDuration} 成片建议 ${minChars}–${maxChars} 字符（含场景与动作描述）`,
  };
};

const markdownFormatInstruction = `必须使用 Scenara 可识别的 Markdown 剧本结构：
# 《片名》
## 第 1 场
### 内景/外景 · 地点 · 时间
动作描述
**角色名**
对白
每个场次都必须有 ## 场次标题和 ### 场景标题；不要使用 Markdown 代码围栏。`;

const buildDeterministicIssues = (
  script: string,
  options: ScriptRewriteAgentOptions,
): ScriptRewriteIssue[] => {
  const issues: ScriptRewriteIssue[] = [];
  const replacementCount = (script.match(/\uFFFD/g) || []).length;
  const headingCount = (script.match(/^#{1,3}\s+.+$/gm) || []).length;
  const sceneCount = (script.match(/^##\s+.+$/gm) || []).length;
  const locationCount = (script.match(/^###\s+.+$/gm) || []).length;
  const hardLimit = options.maxOutputChars || 20000;

  if (script.trim().length < 80) {
    issues.push({
      severity: 'high',
      category: '完整性',
      location: '全文',
      problem: '输出为空或明显不完整。',
      repairInstruction: '重新输出从片名到结尾均完整的剧本。',
    });
  }
  if (replacementCount > 0) {
    issues.push({
      severity: 'high',
      category: '字符完整性',
      location: '全文',
      problem: `检测到 ${replacementCount} 个 Unicode 替换字符（U+FFFD），文本已损坏。`,
      repairInstruction: '从原始语义重新写出损坏的词句，终稿不得包含 Unicode U+FFFD 替换字符。',
    });
  }
  if (headingCount === 0 || sceneCount === 0 || locationCount === 0) {
    issues.push({
      severity: 'high',
      category: '下游兼容性',
      location: '全文结构',
      problem: '缺少 Scenara 可识别的 Markdown 片名、场次或场景标题。',
      repairInstruction: '按 # 片名、## 第 N 场、### 内/外景 · 地点 · 时间 的层级重排全文。',
    });
  }
  if (script.length > hardLimit) {
    issues.push({
      severity: 'high',
      category: '长度',
      location: '全文',
      problem: `输出 ${script.length} 字符，超过系统上限 ${hardLimit}。`,
      repairInstruction: `精简重复动作与说明，完整剧本不得超过 ${hardLimit} 字符。`,
    });
  }
  return issues;
};

const isLengthAdvisoryIssue = (issue: ScriptRewriteIssue): boolean => {
  const text = `${issue.category} ${issue.problem}`;
  if (/乱码|替换字符|U\+FFFD|文本损坏|输出截断|系统上限/i.test(text)) return false;
  return /成片时长|时长|篇幅|字数|字符区间|文本长度|duration|length/i.test(text);
};

/**
 * After bounded repair passes, preserve a structurally valid draft that has
 * passed the substantive score floor. Semantic review is intentionally
 * conservative and can continue surfacing editorial alternatives forever;
 * those should remain visible as warnings instead of causing a full rollback.
 */
const canRetainDraftWithEditorialWarnings = (
  review: ScriptRewriteReview,
  deterministicHighIssues: ScriptRewriteIssue[],
): boolean => (
  deterministicHighIssues.length === 0
  && review.overallScore >= 75
  && review.scores.storyFidelity >= 70
  && review.scores.causality >= 65
  && review.scores.characterConsistency >= 65
);

const normalizeIssuesAgainstScript = (
  issues: ScriptRewriteIssue[],
  script: string,
): ScriptRewriteIssue[] => {
  const containsReplacementCharacter = script.includes('\uFFFD');

  return issues.flatMap((issue) => {
    const text = `${issue.category} ${issue.problem}`;
    const claimsReplacementCorruption = /\uFFFD|乱码|替换字符|U\+FFFD|字符损坏|损坏字符|异常字符|残缺字符|编码损坏/i.test(text);

    // Unicode replacement characters are objectively detectable. Do not let a
    // semantic reviewer invent corruption that is absent from the actual draft.
    if (claimsReplacementCorruption && !containsReplacementCharacter) return [];

    // Duration estimates are useful editorial guidance, but never a reason by
    // themselves to reject an otherwise strong, structurally valid screenplay.
    if (isLengthAdvisoryIssue(issue)) {
      return [{
        ...issue,
        severity: 'low' as const,
        category: '节奏建议',
      }];
    }

    return [issue];
  });
};

const normalizeReviewSummaryAgainstScript = (summary: string, script: string): string => {
  if (script.includes('\uFFFD') || !/乱码|替换字符|字符损坏|异常字符|残缺字符/i.test(summary)) {
    return summary;
  }

  const verifiedSentences = summary
    .split(/(?<=[。！？])/)
    .filter((sentence) => !/乱码|替换字符|字符损坏|异常字符|残缺字符/i.test(sentence))
    .join('')
    .trim();
  return verifiedSentences || '语义质量复核已完成，确定性字符完整性检查通过。';
};

const mergeDeterministicIssues = (
  review: ScriptRewriteReview,
  script: string,
  options: ScriptRewriteAgentOptions,
): ScriptRewriteReview => {
  const deterministicIssues = buildDeterministicIssues(script, options);
  if (deterministicIssues.length === 0) return review;
  const categories = new Set(review.issues.map((issue) => `${issue.category}:${issue.location}`));
  const mergedIssues = [
    ...review.issues,
    ...deterministicIssues.filter((issue) => !categories.has(`${issue.category}:${issue.location}`)),
  ].slice(0, 10);
  return {
    ...review,
    verdict: 'repair',
    overallScore: Math.min(review.overallScore, 69),
    issues: mergedIssues,
  };
};

const assertFinalScriptIntegrity = (
  script: string,
  options: ScriptRewriteAgentOptions,
): void => {
  const issues = buildDeterministicIssues(script, options);
  if (issues.length > 0) {
    throw new Error(`终稿质量闸门未通过：${issues.map((issue) => issue.problem).join('；')}`);
  }
};

const assertGeneratedDraftIntegrity = (
  script: string,
  options: ScriptRewriteAgentOptions,
): void => {
  const fatalIssues = buildDeterministicIssues(script, options)
    .filter((issue) => issue.category !== '成片时长');
  if (fatalIssues.length > 0) {
    throw new Error(fatalIssues.map((issue) => issue.problem).join('；'));
  }
};

const cleanStringArray = (value: unknown, maxItems = 10, maxLength = 260): string[] => {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map((item) => clean(item, maxLength)).filter(Boolean))).slice(0, maxItems);
};

const clampScore = (value: unknown, fallback = 70): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.min(100, Math.round(parsed)));
};

const errorMessage = (error: unknown): string => (
  error instanceof Error ? error.message : String(error || '未知错误')
);

const isAbortError = (error: unknown, signal?: AbortSignal): boolean => {
  if (signal?.aborted) return true;
  return /abort|cancel|取消/i.test(errorMessage(error));
};

const emit = (
  options: ScriptRewriteAgentOptions,
  event: ScriptRewriteAgentEvent,
): void => {
  if (options.onEvent) {
    options.onEvent(event);
    return;
  }
  logScriptProgress(`改写 Agent：${event.title}${event.detail ? `｜${clean(event.detail, 260)}` : ''}`);
};

const fallbackPlan = (
  originalScript: string,
  options: ScriptRewriteAgentOptions,
): ScriptRewritePlan => {
  const lengthTarget = getScriptLengthTarget(options);
  return {
    synopsis: clean(originalScript, 420),
    rewriteGoals: [
      options.instruction?.trim() || '强化开场钩子、因果关系、冲突升级、角色表演和结尾回报',
      '保留原故事事实、角色身份、关键道具、对白语言和结局',
      '将抽象描述改成可拍摄、可分镜的动作与反应',
    ],
    openingHook: '尽快呈现最具视觉吸引力且能触发核心冲突的事件。',
    centralConflict: '保持原稿核心冲突，通过可见选择和后果使其更清晰。',
    escalation: '逐场提高风险、缩短决策时间，并让每个行动产生下一步后果。',
    climax: '把不可逆的关键选择安排在视觉和情绪最强的位置。',
    payoff: '用明确的角色状态和视觉回响回应开场承诺。',
    characterDirections: [],
    continuityLocks: ['角色身份、关系、服装、关键道具、场景顺序、对白语言与故事结局不得无故改变。'],
    visualStorytelling: ['优先使用动作、表情、构图、空间关系和环境变化表达剧情。'],
    pacingPlan: ['快速建立事件', '逐步升级阻力', '集中呈现关键选择', '留出短暂结尾回响'],
    targetLength: lengthTarget?.label || (options.maxOutputChars
      ? `完整剧本不超过 ${options.maxOutputChars} 字符`
      : '与原稿体量相近，必要时适度扩写'),
  };
};

const normalizePlan = (
  rawValue: unknown,
  originalScript: string,
  options: ScriptRewriteAgentOptions,
): ScriptRewritePlan => {
  const raw = asRecord(rawValue);
  const fallback = fallbackPlan(originalScript, options);
  const characterDirections = asRecordArray(raw.characterDirections).map((item) => ({
    character: clean(item.character, 120),
    objective: clean(item.objective, 320),
    emotionalArc: clean(item.emotionalArc, 420),
    dialogueVoice: clean(item.dialogueVoice, 320),
  })).filter((item) => item.character).slice(0, 12);

  return {
    synopsis: clean(raw.synopsis, 600) || fallback.synopsis,
    rewriteGoals: cleanStringArray(raw.rewriteGoals, 8, 320).length
      ? cleanStringArray(raw.rewriteGoals, 8, 320)
      : fallback.rewriteGoals,
    openingHook: clean(raw.openingHook, 500) || fallback.openingHook,
    centralConflict: clean(raw.centralConflict, 600) || fallback.centralConflict,
    escalation: clean(raw.escalation, 700) || fallback.escalation,
    climax: clean(raw.climax, 600) || fallback.climax,
    payoff: clean(raw.payoff, 600) || fallback.payoff,
    characterDirections,
    continuityLocks: cleanStringArray(raw.continuityLocks, 12, 360).length
      ? cleanStringArray(raw.continuityLocks, 12, 360)
      : fallback.continuityLocks,
    visualStorytelling: cleanStringArray(raw.visualStorytelling, 8, 360).length
      ? cleanStringArray(raw.visualStorytelling, 8, 360)
      : fallback.visualStorytelling,
    pacingPlan: cleanStringArray(raw.pacingPlan, 10, 360).length
      ? cleanStringArray(raw.pacingPlan, 10, 360)
      : fallback.pacingPlan,
    targetLength: getScriptLengthTarget(options)?.label || clean(raw.targetLength, 240) || fallback.targetLength,
  };
};

const formatPlanForDisplay = (plan: ScriptRewritePlan): string => [
  `开场钩子：${plan.openingHook}`,
  `核心冲突：${plan.centralConflict}`,
  `升级路径：${plan.escalation}`,
  `高潮：${plan.climax}`,
  `结尾回报：${plan.payoff}`,
  `长度目标：${plan.targetLength}`,
  plan.rewriteGoals.length ? `改写目标：${plan.rewriteGoals.join('；')}` : '',
].filter(Boolean).join('\n').slice(0, 1800);

const fallbackReview = (script: string): ScriptRewriteReview => {
  const hasContent = script.trim().length >= 80;
  const hasHeadings = /^#{1,3}\s+.+$/m.test(script);
  const score = hasContent ? (hasHeadings ? 72 : 66) : 25;
  return {
    verdict: hasContent ? 'pass' : 'repair',
    overallScore: score,
    scores: {
      storyFidelity: score,
      causality: score,
      characterConsistency: score,
      dialogue: score,
      pacing: score,
      shootability: score,
    },
    summary: hasContent
      ? '语义审稿调用失败，已通过确定性完整性检查保留当前改写稿。'
      : '改写稿内容不足，需要重新生成。',
    strengths: hasContent ? ['改写稿非空且达到基本可用长度。'] : [],
    issues: hasContent ? [] : [{
      severity: 'high',
      category: '完整性',
      location: '全文',
      problem: '改写稿内容过短或为空。',
      repairInstruction: '重新生成完整剧本。',
    }],
  };
};

const normalizeReview = (rawValue: unknown, script: string): ScriptRewriteReview => {
  const raw = asRecord(rawValue);
  const rawScores = asRecord(raw.scores);
  const fallback = fallbackReview(script);
  const scores = {
    storyFidelity: clampScore(rawScores.storyFidelity, fallback.scores.storyFidelity),
    causality: clampScore(rawScores.causality, fallback.scores.causality),
    characterConsistency: clampScore(rawScores.characterConsistency, fallback.scores.characterConsistency),
    dialogue: clampScore(rawScores.dialogue, fallback.scores.dialogue),
    pacing: clampScore(rawScores.pacing, fallback.scores.pacing),
    shootability: clampScore(rawScores.shootability, fallback.scores.shootability),
  };
  const calculatedOverall = Math.round(Object.values(scores).reduce((sum, value) => sum + value, 0) / 6);
  const issues = normalizeIssuesAgainstScript(asRecordArray(raw.issues).map((item) => ({
    severity: ['low', 'medium', 'high'].includes(String(item.severity))
      ? String(item.severity) as ScriptRewriteIssue['severity']
      : 'medium',
    category: clean(item.category, 120) || '综合质量',
    location: clean(item.location, 180) || '未定位',
    problem: clean(item.problem, 500),
    repairInstruction: clean(item.repairInstruction, 500),
  })).filter((item) => item.problem && item.repairInstruction).slice(0, 8), script);
  const requestedRepair = String(raw.verdict || '').toLowerCase() === 'repair';
  const actionableIssues = issues.filter((issue) => !isLengthAdvisoryIssue(issue));
  const hasActionableIssue = actionableIssues.some((issue) => issue.severity === 'medium' || issue.severity === 'high');
  const requestedRepairWithEvidence = requestedRepair && hasActionableIssue;
  const verdict = requestedRepairWithEvidence || hasActionableIssue || calculatedOverall < 75 ? 'repair' : 'pass';
  if (verdict === 'repair' && issues.length === 0) {
    issues.push({
      severity: calculatedOverall < 60 ? 'high' : 'medium',
      category: '综合质量',
      location: '全文',
      problem: `综合评分 ${calculatedOverall}/100，尚未达到终稿标准。`,
      repairInstruction: '在不改变故事事实的前提下，针对最低分维度修订全文，并保留完整 Markdown 剧本结构。',
    });
  }

  const normalizedSummary = normalizeReviewSummaryAgainstScript(
    clean(raw.summary, 700) || fallback.summary,
    script,
  );

  return {
    verdict,
    overallScore: clampScore(raw.overallScore, calculatedOverall),
    scores,
    summary: normalizedSummary,
    strengths: cleanStringArray(raw.strengths, 6, 320),
    issues,
  };
};

const formatReviewForDisplay = (review: ScriptRewriteReview): string => {
  const scoreLine = [
    `忠实度 ${review.scores.storyFidelity}`,
    `因果 ${review.scores.causality}`,
    `角色 ${review.scores.characterConsistency}`,
    `对白 ${review.scores.dialogue}`,
    `节奏 ${review.scores.pacing}`,
    `可拍摄性 ${review.scores.shootability}`,
  ].join(' · ');
  const issueLines = review.issues.slice(0, 5).map((issue, index) => (
    `${index + 1}. [${issue.severity}] ${issue.location}：${issue.problem}`
  ));
  return [
    `总分 ${review.overallScore}/100 · ${scoreLine}`,
    review.summary,
    ...issueLines,
  ].filter(Boolean).join('\n').slice(0, 2000);
};

const parseReviewResponse = (rawText: string, script: string): ScriptRewriteReview => {
  const parsed = parseJsonWithRecovery<UnknownRecord>(rawText, {});
  const record = asRecord(parsed);
  if (!record.verdict || !record.scores || !Array.isArray(record.issues)) {
    throw new Error('审稿模型未返回完整的结构化质量报告');
  }
  return normalizeReview(record, script);
};

const buildPlanningPrompt = (
  originalScript: string,
  language: string,
  options: ScriptRewriteAgentOptions,
): string => `你是短视频项目的首席编剧与剧本统筹。先分析原稿并给出可公开展示、可执行的改写方案；不要输出隐藏推理过程。
${buildScreenwritingGuidance({ script: originalScript, instruction: options.instruction, targetDuration: options.targetDuration, requestedModules: options.screenwritingModules, mode: 'diagnose' })}

目标：提高开场钩子、叙事因果、冲突升级、角色弧光、对白辨识度、视觉叙事、节奏和结尾回报，同时让后续分镜 Agent 可以直接消费。

硬性约束：
- 保留原故事核心、人物身份与关系、关键道具、既定服装、世界规则、对白语言和结局；除非用户明确要求改变。
- 不随意增加角色、道具、地点或支线。
- 方案必须具体，使用制作决策，不写思维过程。
- 目标输出语言：${language}。
- 目标时长：${options.targetDuration || '沿用原稿'}。
- 时长长度建议：${getScriptLengthTarget(options)?.label || '保持与原稿体量相近'}；这是节奏参考，不得牺牲剧情、角色和镜头质量来机械凑字数。
- 字符上限：${options.maxOutputChars || '未指定'}。
- 用户额外要求：${options.instruction?.trim() || '无'}。

只输出 JSON：
{
  "synopsis": "原稿事实摘要",
  "rewriteGoals": ["具体目标"],
  "openingHook": "开场方案",
  "centralConflict": "核心冲突",
  "escalation": "升级路径",
  "climax": "高潮安排",
  "payoff": "结尾回报",
  "characterDirections": [{"character":"角色名","objective":"外在目标","emotionalArc":"情绪变化","dialogueVoice":"对白特征"}],
  "continuityLocks": ["不得改变的事实"],
  "visualStorytelling": ["可视化表达策略"],
  "pacingPlan": ["按顺序的节奏节点"],
  "targetLength": "长度策略"
}

原稿：
${originalScript.slice(0, 30000)}`;

const buildRewritePrompt = (
  originalScript: string,
  plan: ScriptRewritePlan,
  language: string,
  options: ScriptRewriteAgentOptions,
): string => `你是执行改写的资深编剧。严格依据“已批准改写方案”改写原稿。
${buildScreenwritingGuidance({ script: originalScript, instruction: options.instruction, targetDuration: options.targetDuration, requestedModules: options.screenwritingModules, mode: 'rewrite' })}

要求：
- 只输出完整改写剧本，不要解释、总结、JSON、Markdown 代码围栏或隐藏推理。
- 保留原故事事实、角色身份关系、关键道具、既定服装、世界规则、对白语言和结局。
- 让动作、表情、空间关系、声音和环境变化可拍摄、可分镜；减少抽象心理说明。
- ${markdownFormatInstruction}
- 输出语言：${language}。
- 时长长度建议：${getScriptLengthTarget(options)?.label || '保持与原稿体量相近'}；优先保证剧情、角色与镜头质量，不需要机械凑字数。
- 完整输出不超过 ${options.maxOutputChars || 20000} 字符。
- 逐字检查输出，不得出现 Unicode U+FFFD 替换字符或残缺词语。
- 用户额外要求：${options.instruction?.trim() || '无'}。

已批准改写方案：
${JSON.stringify(plan, null, 2)}

原稿：
${originalScript.slice(0, 30000)}`;

const buildReviewPrompt = (
  originalScript: string,
  rewrittenScript: string,
  plan: ScriptRewritePlan,
  language: string,
  options: ScriptRewriteAgentOptions,
): string => `你是独立剧本审稿 Agent。比较原稿、改写方案和改写稿，输出可公开展示的质量报告；不要输出隐藏推理。
${buildScreenwritingGuidance({ script: rewrittenScript, instruction: options.instruction, targetDuration: options.targetDuration, requestedModules: options.screenwritingModules, mode: 'diagnose' })}

检查：故事事实忠实度、因果完整性、角色一致性、对白语言与辨识度、节奏与钩子、视觉可拍摄性、结尾回报、字符完整性和 Markdown 场次结构。只有会明显影响质量或后续分镜的具体问题才要求修复。

判定原则：
- 时长和字符区间只是剪辑节奏参考，不能单独作为 repair 或拒绝终稿的理由。
- 不得凭空声称存在乱码、替换字符或缺失结构；此类客观问题必须以“改写稿”中的实际文本为依据。
- 优先评价故事、角色、画面材质、镜头可执行性和情绪回报。
- 只有能指出改写稿中具体互相矛盾的文本、丢失的既定事实，或会直接让分镜无法执行的问题，才标为 high。可选的铺垫、替代表达、节奏微调均为 medium 或 low。
- 若改写稿结构完整、没有客观错误且总分达到 75，请给出 pass；仍可在 issues 中保留不阻断的编辑建议。

目标语言：${language}
目标时长：${options.targetDuration || '沿用原稿'}
时长长度建议：${getScriptLengthTarget(options)?.label || '保持与原稿体量相近'}（仅供参考，不作为硬性否决条件）
字符上限：${options.maxOutputChars || 20000}

只输出 JSON：
{
  "verdict": "pass 或 repair",
  "overallScore": 0,
  "scores": {"storyFidelity":0,"causality":0,"characterConsistency":0,"dialogue":0,"pacing":0,"shootability":0},
  "summary": "简洁结论",
  "strengths": ["具体优点"],
  "issues": [{"severity":"low|medium|high","category":"类别","location":"场次或段落","problem":"具体问题","repairInstruction":"局部修复指令"}]
}

原稿：
${originalScript.slice(0, 30000)}

改写方案：
${JSON.stringify(plan, null, 2)}

改写稿：
${rewrittenScript.slice(0, 30000)}`;

const buildRepairPrompt = (
  originalScript: string,
  rewrittenScript: string,
  plan: ScriptRewritePlan,
  review: ScriptRewriteReview,
  language: string,
  options: ScriptRewriteAgentOptions,
): string => `你是终稿修订 Agent。根据审稿问题对改写稿做定点修复。
${buildScreenwritingGuidance({ script: rewrittenScript, instruction: options.instruction, targetDuration: options.targetDuration, requestedModules: options.screenwritingModules, mode: 'rewrite' })}

要求：
- 只输出修复后的完整剧本，不要解释、报告、JSON、代码围栏或隐藏推理。
- 只修改审稿报告指出的问题，保留已经通过的段落和表达。
- 不改变原稿核心事实、角色身份关系、关键道具、既定服装、对白语言和结局。
- ${markdownFormatInstruction}
- 输出语言：${language}；完整输出不超过 ${options.maxOutputChars || 20000} 字符。
- 时长长度建议：${getScriptLengthTarget(options)?.label || '保持与原稿体量相近'}；优先修复故事与镜头质量，不得为凑字数破坏已通过内容。
- 逐字检查输出，不得出现 Unicode U+FFFD 替换字符或残缺词语。

改写方案：
${JSON.stringify(plan, null, 2)}

审稿报告：
${JSON.stringify(review, null, 2)}

原稿事实依据：
${originalScript.slice(0, 30000)}

待修复改写稿：
${rewrittenScript.slice(0, 30000)}`;

const generateDraft = async (
  prompt: string,
  model: string,
  stage: 'rewriting' | 'repairing',
  options: ScriptRewriteAgentOptions,
): Promise<{ text: string; usedFallback: boolean }> => {
  let streamed = '';
  const stableId = stage === 'rewriting' ? 'rewriting-draft' : 'rewrite-repair';
  const maxOutputChars = options.maxOutputChars || 20000;
  try {
    const raw = await chatCompletionStream(
      prompt,
      model,
      0.68,
      undefined,
      600000,
      (delta) => {
        streamed += delta;
        options.onDraftUpdate?.(
          cleanLines(streamed).slice(0, maxOutputChars),
          stage,
        );
      },
      options.abortSignal,
    );
    const text = cleanLines(raw || streamed);
    assertGeneratedDraftIntegrity(text, options);
    return { text, usedFallback: false };
  } catch (error) {
    if (isAbortError(error, options.abortSignal)) throw error;
    emit(options, {
      stage,
      status: 'warning',
      title: '主生成请求未通过，正在启动完整恢复请求',
      detail: errorMessage(error),
      stableId,
    });
    const recoveryPrompt = `${prompt}\n\n恢复请求硬性要求：上一次输出失败或未通过字符/结构检查。请从头重新输出完整剧本，严格保留所有 Markdown 标题，不得出现 Unicode U+FFFD 替换字符，不要截断，不要解释。`;
    const raw = await retryOperation(
      () => chatCompletion(recoveryPrompt, model, 0.58, 8192, undefined, 600000, options.abortSignal),
      2,
      1200,
      options.abortSignal,
    );
    const text = cleanLines(raw);
    assertGeneratedDraftIntegrity(text, options);
    options.onDraftUpdate?.(text.slice(0, maxOutputChars), stage);
    return { text, usedFallback: true };
  }
};

/**
 * 多阶段剧本改写 Agent：公开策划产物 → 流式改写 → 独立审稿 → 必要时定点修复。
 * 每个阶段都是独立模型调用或确定性校验，并通过事件回调向前端报告。
 */
export const runScriptRewriteAgent = async (
  originalScript: string,
  language: string = '中文',
  model: string = getActiveChatModelName(),
  options: ScriptRewriteAgentOptions = {},
): Promise<ScriptRewriteAgentResult> => {
  const startedAt = Date.now();
  const warnings: string[] = [];
  let degraded = false;

  emit(options, {
    stage: 'planning',
    status: 'running',
    title: '正在分析原稿并制定改写方案',
    detail: `原稿 ${originalScript.length} 字 · ${options.targetDuration || '沿用原时长'}`,
    stableId: 'rewrite-planning',
  });

  let plan: ScriptRewritePlan;
  try {
    const rawPlan = await retryOperation(
      () => chatCompletion(
        buildPlanningPrompt(originalScript, language, options),
        model,
        0.35,
        4096,
        'json_object',
        600000,
        options.abortSignal,
      ),
      2,
      1200,
      options.abortSignal,
    );
    plan = normalizePlan(parseJsonWithRecovery<UnknownRecord>(rawPlan, {}), originalScript, options);
    emit(options, {
      stage: 'planning',
      status: 'success',
      title: '改写方案已完成',
      detail: formatPlanForDisplay(plan),
      stableId: 'rewrite-planning',
    });
  } catch (error) {
    if (isAbortError(error, options.abortSignal)) throw error;
    plan = fallbackPlan(originalScript, options);
    degraded = true;
    warnings.push(`策划阶段降级：${errorMessage(error)}`);
    emit(options, {
      stage: 'planning',
      status: 'warning',
      title: '策划调用失败，已使用保守改写方案继续',
      detail: formatPlanForDisplay(plan),
      stableId: 'rewrite-planning',
    });
  }

  emit(options, {
    stage: 'rewriting',
    status: 'running',
    title: '改写 Agent 正在依据方案生成完整初稿',
    detail: '支持流式模型时逐段显示；服务端代理模式在单阶段完成后回填编辑器。',
    stableId: 'rewriting-draft',
  });
  const firstDraftResult = await generateDraft(
    buildRewritePrompt(originalScript, plan, language, options),
    model,
    'rewriting',
    options,
  );
  const firstDraft = firstDraftResult.text;
  if (firstDraftResult.usedFallback) {
    degraded = true;
    warnings.push('初稿主生成请求未通过，已通过完整恢复请求完成。');
  }
  emit(options, {
    stage: 'rewriting',
    status: firstDraftResult.usedFallback ? 'warning' : 'success',
    title: '完整改写初稿已生成',
    detail: `原稿 ${originalScript.length} 字 → 初稿 ${firstDraft.length} 字`,
    stableId: 'rewriting-draft',
  });

  emit(options, {
    stage: 'reviewing',
    status: 'running',
    title: '独立审稿 Agent 正在检查质量',
    detail: '检查故事忠实度、因果、角色、对白、节奏与可拍摄性。',
    stableId: 'rewrite-review',
  });

  let review: ScriptRewriteReview;
  try {
    const semanticReview = await retryOperation(
      async () => parseReviewResponse(await chatCompletion(
          buildReviewPrompt(originalScript, firstDraft, plan, language, options),
          model,
          0.2,
          4096,
          'json_object',
          600000,
          options.abortSignal,
        ), firstDraft),
      2,
      1200,
      options.abortSignal,
    );
    review = mergeDeterministicIssues(
      semanticReview,
      firstDraft,
      options,
    );
    emit(options, {
      stage: 'reviewing',
      status: review.verdict === 'pass' ? 'success' : 'warning',
      title: review.verdict === 'pass' ? '审稿通过' : `发现 ${review.issues.length} 项需要定点修复`,
      detail: formatReviewForDisplay(review),
      stableId: 'rewrite-review',
    });
  } catch (error) {
    if (isAbortError(error, options.abortSignal)) throw error;
    emit(options, {
      stage: 'reviewing',
      status: 'error',
      title: '语义审稿未完成，已阻止未经复核的初稿写回',
      detail: errorMessage(error),
      stableId: 'rewrite-review',
    });
    throw new Error(`独立审稿 Agent 未完成：${errorMessage(error)}`);
  }

  let finalScript = firstDraft;
  let repaired = false;
  let repairedIssueCount = 0;
  const maxRepairPasses = 2;
  let repairPass = 0;

  while (review.verdict === 'repair' && review.issues.length > 0) {
    const actionableIssues = review.issues.filter((issue) => !isLengthAdvisoryIssue(issue));
    if (actionableIssues.length === 0) {
      review = { ...review, verdict: 'pass' };
      break;
    }
    if (repairPass >= maxRepairPasses) {
      const remainingHighIssues = actionableIssues.filter((issue) => issue.severity === 'high');
      const deterministicHighIssues = buildDeterministicIssues(finalScript, options)
        .filter((issue) => issue.severity === 'high');
      // Semantic reviewers can keep finding alternative editorial choices.
      // After two bounded repair passes, retain a strong, structurally valid
      // draft and expose the remaining notes instead of discarding all work.
      if (
        (remainingHighIssues.length === 0 && deterministicHighIssues.length === 0)
        || canRetainDraftWithEditorialWarnings(review, deterministicHighIssues)
      ) {
        degraded = true;
        const remainingSeverity = remainingHighIssues.length > 0 ? '高优先级' : '中等强度';
        warnings.push(`终审仍有 ${actionableIssues.length} 项${remainingSeverity}编辑建议，已保留完整修订稿供人工确认。`);
        review = {
          ...review,
          verdict: 'pass',
          summary: `${review.summary}（两轮定点修订后，结构和质量分数达到交付阈值；剩余建议已降级为人工确认项。）`,
        };
        emit(options, {
          stage: 'verifying',
          status: 'warning',
          title: '终稿已保留，剩余审稿建议待人工确认',
          detail: formatReviewForDisplay(review),
          stableId: 'rewrite-verification',
        });
        break;
      }
      throw new Error(`终稿经过 ${maxRepairPasses} 轮修订后仍未通过质量复核\n${formatReviewForDisplay(review)}`);
    }

    repairPass += 1;
    repairedIssueCount += actionableIssues.length;
    const repairReview: ScriptRewriteReview = {
      ...review,
      issues: actionableIssues,
    };
    emit(options, {
      stage: 'repairing',
      status: 'running',
      title: `修稿 Agent 正在进行第 ${repairPass} 轮定点修复`,
      detail: actionableIssues.map((issue) => `${issue.location}：${issue.repairInstruction}`).join('\n').slice(0, 1800),
      stableId: 'rewrite-repair',
    });
    try {
      const repairResult = await generateDraft(
        buildRepairPrompt(originalScript, finalScript, plan, repairReview, language, options),
        model,
        'repairing',
        options,
      );
      finalScript = repairResult.text;
      repaired = true;
      if (repairResult.usedFallback) {
        degraded = true;
        warnings.push('修稿主生成请求未通过，已通过完整恢复请求完成。');
      }
      emit(options, {
        stage: 'repairing',
        status: repairResult.usedFallback ? 'warning' : 'success',
        title: `第 ${repairPass} 轮定点修复完成`,
        detail: `本轮修复 ${actionableIssues.length} 项 · 待终稿复核 · ${finalScript.length} 字`,
        stableId: 'rewrite-repair',
      });
    } catch (error) {
      if (isAbortError(error, options.abortSignal)) throw error;
      options.onDraftUpdate?.(finalScript, 'repairing');
      emit(options, {
        stage: 'repairing',
        status: 'error',
        title: '定点修复失败，已阻止不合格初稿写回',
        detail: errorMessage(error),
        stableId: 'rewrite-repair',
      });
      throw new Error(`审稿要求修复，但修稿 Agent 未完成：${errorMessage(error)}`);
    }

    emit(options, {
      stage: 'verifying',
      status: 'running',
      title: `正在复核第 ${repairPass} 轮修订稿`,
      detail: '重新检查故事、节奏、可拍摄性、字符完整性和下游格式。',
      stableId: 'rewrite-verification',
    });
    try {
      const semanticVerification = await retryOperation(
        async () => parseReviewResponse(await chatCompletion(
            buildReviewPrompt(originalScript, finalScript, plan, language, options),
            model,
            0.15,
            4096,
            'json_object',
            600000,
            options.abortSignal,
          ), finalScript),
        2,
        1200,
        options.abortSignal,
      );
      review = mergeDeterministicIssues(
        semanticVerification,
        finalScript,
        options,
      );
    } catch (error) {
      if (isAbortError(error, options.abortSignal)) throw error;
      emit(options, {
        stage: 'verifying',
        status: 'error',
        title: '终稿复核调用失败，已阻止写回',
        detail: errorMessage(error),
        stableId: 'rewrite-verification',
      });
      throw new Error(`终稿复核 Agent 未完成：${errorMessage(error)}`);
    }

    if (review.verdict === 'pass') {
      emit(options, {
        stage: 'verifying',
        status: 'success',
        title: '终稿复核通过',
        detail: formatReviewForDisplay(review),
        stableId: 'rewrite-verification',
      });
      break;
    }

    emit(options, {
      stage: 'verifying',
      status: repairPass < maxRepairPasses ? 'warning' : 'error',
      title: repairPass < maxRepairPasses
        ? `复核仍有 ${review.issues.filter((issue) => !isLengthAdvisoryIssue(issue)).length} 项质量问题，将继续修订`
        : `经过 ${maxRepairPasses} 轮修订仍未通过质量复核`,
      detail: formatReviewForDisplay(review),
      stableId: 'rewrite-verification',
    });
  }

  if (!repaired) {
    emit(options, {
      stage: 'repairing',
      status: 'info',
      title: '审稿已通过，无需启动修稿 Agent',
      stableId: 'rewrite-repair',
    });
  }

  assertFinalScriptIntegrity(finalScript, options);

  emit(options, {
    stage: 'completed',
    status: degraded ? 'warning' : 'success',
    title: degraded ? '多阶段改写已完成，部分阶段使用降级策略' : '多阶段改写 Agent 已完成',
    detail: `终稿 ${finalScript.length} 字 · 终审 ${review.overallScore}/100${repaired ? ` · 已修复 ${repairedIssueCount} 项` : ''}`,
    stableId: 'rewrite-completed',
  });

  return {
    script: finalScript,
    firstDraft,
    plan,
    review,
    repaired,
    repairedIssueCount,
    degraded,
    warnings,
    durationMs: Date.now() - startedAt,
  };
};
