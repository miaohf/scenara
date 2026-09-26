import type {
  Character,
  CreativeCharacterDirection,
  CreativeDevelopmentPlan,
  CreativeSceneDirection,
  QualityCheck,
  Scene,
  ScriptData,
  Shot,
  ShotAgentMetadata,
  ShotExecutionPlan,
  ShotReferencePolicyItem,
  ShotQualityAssessment,
  ShotSemanticReview,
  ShotTimelineBeat,
  StoryboardAgentRun,
  StoryboardAgentStage,
  StoryboardDirectorBeat,
  StoryboardDirectorPlan,
  StoryboardStructureAction,
  StoryboardStructureIssue,
  StoryboardStructureReview,
  StoryOutlineReview,
} from '../../types';
import { formatProductionBibleForPrompt } from '../productionBibleService';
import { applyContinuityLedgerToShots } from '../continuityLedgerService';
import { formatSeriesContinuityForPrompt } from '../seriesContinuityService';
import { enrichScriptAssetIntelligence } from '../assetIntelligenceService';
import { buildScreenwritingGuidance } from './screenwritingModuleRouter';
import {
  chatCompletion,
  getActiveChatModelName,
  logScriptProgress,
  parseJsonWithRecovery,
  retryOperation,
} from './apiCore';

const STORYBOARD_AGENT_VERSION = 1;
const STORYBOARD_DIRECTOR_PLAN_VERSION = 1;
const SEMANTIC_QUALITY_VERSION = 2;
const STRUCTURE_REVIEW_VERSION = 1;
const STORY_OUTLINE_REVIEW_VERSION = 1;

type UnknownRecord = Record<string, unknown>;

const asRecord = (value: unknown): UnknownRecord =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : {};

const asRecordArray = (value: unknown): UnknownRecord[] =>
  Array.isArray(value) ? value.map(asRecord) : [];

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error ?? 'unknown error');

const clean = (value: unknown, maxLength = 1200): string => {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1).trimEnd()}…`;
};

const cleanLines = (value: unknown, maxLength = 1600): string => {
  const text = String(value ?? '')
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n');
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1).trimEnd()}…`;
};

const cleanStringArray = (value: unknown, maxItems = 8, maxLength = 180): string[] => {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map((item) => clean(item, maxLength)).filter(Boolean))).slice(0, maxItems);
};

const clamp = (value: unknown, min: number, max: number, fallback: number): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
};

const maxExecutionPhasesForDuration = (durationSeconds: number): number => {
  if (durationSeconds <= 5) return 2;
  if (durationSeconds <= 8) return 3;
  if (durationSeconds <= 15) return 4;
  return 5;
};

const countPhysicalActionTransitions = (value: string): number => {
  const chinese = value.match(
    /收起|收上|拖过|拖入|放下|抓起|拿起|举起|插入|插进|撑入|撑动|推动|加速|驶入|进入|离开|转身|抬头|低头|站起|坐下|停住|发现|望向|走向|跑向|跳下|打开|关闭|落下|移到|移动/gu,
  ) || [];
  const english = value.match(
    /\b(?:pulls?|drags?|drops?|grabs?|takes?|raises?|plants?|pushes?|accelerates?|enters?|exits?|turns?|looks?|stands?|sits?|stops?|notices?|walks?|runs?|jumps?|opens?|closes?|moves?)\b/gi,
  ) || [];
  return new Set([...chinese, ...english].map((item) => item.toLowerCase())).size;
};

const cloneScriptData = (source: ScriptData): ScriptData => {
  if (typeof structuredClone === 'function') return structuredClone(source);
  return JSON.parse(JSON.stringify(source)) as ScriptData;
};

const uniqueStages = (stages: StoryboardAgentStage[]): StoryboardAgentStage[] =>
  Array.from(new Set(stages));

const createAgentRun = (): StoryboardAgentRun => {
  const now = Date.now();
  return {
    version: STORYBOARD_AGENT_VERSION,
    runId: `storyboard-agent-${now}-${Math.random().toString(36).slice(2, 8)}`,
    status: 'running',
    stage: 'development',
    completedStages: [],
    warnings: [],
    startedAt: now,
    updatedAt: now,
  };
};

const updateAgentRun = (
  scriptData: ScriptData,
  stage: StoryboardAgentStage,
  options?: { completedStage?: boolean; warning?: string; finish?: boolean },
): StoryboardAgentRun => {
  const current = scriptData.storyboardAgentRun || createAgentRun();
  const warning = clean(options?.warning, 500);
  const completedStages = options?.completedStage
    ? uniqueStages([...current.completedStages, stage])
    : current.completedStages;
  const warnings = warning
    ? Array.from(new Set([...current.warnings, warning]))
    : current.warnings;
  const now = Date.now();
  const next: StoryboardAgentRun = {
    ...current,
    version: STORYBOARD_AGENT_VERSION,
    stage,
    completedStages,
    warnings,
    status: options?.finish ? (warnings.length > 0 ? 'degraded' : 'completed') : 'running',
    updatedAt: now,
    completedAt: options?.finish ? now : current.completedAt,
  };
  scriptData.storyboardAgentRun = next;
  return next;
};

export const completeStoryboardAgentRun = (scriptData: ScriptData, warning?: string): void => {
  updateAgentRun(scriptData, 'completed', {
    completedStage: true,
    warning,
    finish: true,
  });
};

const fallbackCharacterDirection = (character: Character): CreativeCharacterDirection => ({
  dramaticFunction: clean(character.personality) || 'Support the story action without changing established facts.',
  desire: 'Pursue the immediate objective established by the script.',
  innerConflict: clean(character.personality) || 'Express the established personality through restrained, readable behavior.',
  performanceNotes: `Keep ${character.name}'s behavior, expressions, and reactions consistent with the script.`,
  silhouette: clean(character.coreFeatures || character.species || character.gender) || 'Preserve the established body plan and proportions.',
  signatureFeatures: cleanStringArray(character.coreFeatures ? [character.coreFeatures] : [], 5),
  wardrobeIntent: character.wardrobe
    ? `Preserve the exact established wardrobe: ${clean(character.wardrobe, 320)}`
    : 'Do not invent a costume change; use a restrained base look consistent with the established character.',
});

const normalizeCharacterDirection = (
  raw: UnknownRecord,
  character: Character,
): CreativeCharacterDirection => {
  const fallback = fallbackCharacterDirection(character);
  return {
    dramaticFunction: clean(raw.dramaticFunction, 360) || fallback.dramaticFunction,
    desire: clean(raw.desire, 360) || fallback.desire,
    innerConflict: clean(raw.innerConflict, 360) || fallback.innerConflict,
    performanceNotes: clean(raw.performanceNotes, 500) || fallback.performanceNotes,
    silhouette: clean(raw.silhouette, 420) || fallback.silhouette,
    signatureFeatures: cleanStringArray(raw.signatureFeatures, 6, 180).length
      ? cleanStringArray(raw.signatureFeatures, 6, 180)
      : fallback.signatureFeatures,
    wardrobeIntent: clean(raw.wardrobeIntent, 420) || fallback.wardrobeIntent,
  };
};

const fallbackSceneDirection = (scene: Scene): CreativeSceneDirection => ({
  narrativePurpose: `Advance the story through the action established for ${scene.location}.`,
  conflict: 'Keep the active dramatic obstacle readable in character behavior and staging.',
  emotionalTurn: `Move from the incoming state toward the atmosphere of ${clean(scene.atmosphere, 220) || scene.location}.`,
  visualMotif: clean(`${scene.location}, ${scene.time}, ${scene.atmosphere}`, 420),
  continuityIn: 'Enter with character identity, wardrobe, props, and spatial state preserved from the previous beat.',
  continuityOut: 'End on a clear physical or emotional state that motivates the next beat.',
});

const normalizeSceneDirection = (raw: UnknownRecord, scene: Scene): CreativeSceneDirection => {
  const fallback = fallbackSceneDirection(scene);
  return {
    narrativePurpose: clean(raw.narrativePurpose, 420) || fallback.narrativePurpose,
    conflict: clean(raw.conflict, 420) || fallback.conflict,
    emotionalTurn: clean(raw.emotionalTurn, 420) || fallback.emotionalTurn,
    visualMotif: clean(raw.visualMotif, 420) || fallback.visualMotif,
    continuityIn: clean(raw.continuityIn, 420) || fallback.continuityIn,
    continuityOut: clean(raw.continuityOut, 420) || fallback.continuityOut,
  };
};

const fallbackDevelopmentPlan = (scriptData: ScriptData): CreativeDevelopmentPlan => ({
  version: STORYBOARD_AGENT_VERSION,
  status: 'fallback',
  hook: clean(scriptData.logline) || 'Open on the story’s clearest irreversible action.',
  audiencePromise: clean(scriptData.logline) || `Deliver a concise ${scriptData.genre || 'dramatic'} story with a clear payoff.`,
  theme: clean(scriptData.genre) || 'Cause and consequence.',
  centralConflict: clean(scriptData.logline) || 'Preserve the conflict established by the script.',
  escalationPlan: 'Escalate the obstacle, narrow the available choices, then force a visible decision.',
  climax: 'Stage the script’s decisive action as the strongest visual and emotional beat.',
  payoff: 'Resolve the central question with a readable final image and emotional state.',
  pacingStrategy: 'Hook immediately, remove redundant exposition, and reserve the longest visual beat for the climax.',
  generatedAt: Date.now(),
});

/**
 * 编剧 Agent：在不改写剧本事实的前提下，补齐可被美术和分镜消费的创作意图。
 * 失败时返回显式 fallback 状态，旧流程仍可继续。
 */
export const developScriptForProduction = async (
  scriptData: ScriptData,
  model: string = getActiveChatModelName(),
  abortSignal?: AbortSignal,
): Promise<ScriptData> => {
  const nextData = enrichScriptAssetIntelligence(cloneScriptData(scriptData));
  nextData.storyboardAgentRun = createAgentRun();
  nextData.storyboardDirectorPlan = undefined;
  logScriptProgress('编剧 Agent：正在建立全片钩子、冲突、角色表演与场景转折...');

  const compactInput = {
    title: nextData.title,
    genre: nextData.genre,
    logline: nextData.logline,
    targetDuration: nextData.targetDuration,
    language: nextData.language,
    characters: (nextData.characters || []).map((character) => ({
      id: character.id,
      name: character.name,
      species: character.species,
      gender: character.gender,
      age: character.age,
      personality: character.personality,
      wardrobe: character.wardrobe,
      coreFeatures: character.coreFeatures,
      assetDNA: character.assetDNA,
      variations: (character.variations || []).map((variation) => ({
        id: variation.id,
        name: variation.name,
        wardrobe: variation.wardrobe,
        sceneIds: variation.sceneIds,
      })),
    })),
    scenes: (nextData.scenes || []).map((scene) => ({
      id: scene.id,
      location: scene.location,
      time: scene.time,
      atmosphere: scene.atmosphere,
      spatialTopology: scene.spatialTopology,
      assetDNA: scene.assetDNA,
    })),
    props: (nextData.props || []).map((prop) => ({
      id: prop.id,
      name: prop.name,
      description: prop.description,
      presentationMode: prop.presentationMode,
      assetDNA: prop.assetDNA,
    })),
    storyParagraphs: (nextData.storyParagraphs || []).map((paragraph) => ({
      id: paragraph.id,
      sceneRefId: paragraph.sceneRefId,
      text: cleanLines(paragraph.text, 1800),
    })),
    seriesContinuity: nextData.seriesContinuity,
  };

  const prompt = `You are the lead screenwriter and performance director for a short-form cinematic production.
Develop the supplied structured script into a production treatment that downstream art and storyboard agents can execute.

NON-NEGOTIABLE RULES:
- Preserve every established story fact, identity, relationship, location, prop, wardrobe item, costume color, and spoken language.
- Do not invent costume changes, new characters, new props, or new plot outcomes.
- Improve dramatic intention: opening hook, audience promise, causality, escalation, climax, payoff, performance subtext, and scene transitions.
- Rewrite each supplied storyParagraph into production-ready action: remove redundancy, make cause/effect and visible behavior explicit, and retain all important dialogue in its original language. Keep the same paragraph id and sceneRefId.
- Character visual notes must be concrete and renderable, but wardrobeIntent describes narrative purpose only and MUST NOT replace explicit wardrobe facts.
- Use stable IDs exactly as supplied. Output descriptive strings in ${nextData.language || '中文'}.
- Output JSON only.

${buildScreenwritingGuidance({
  script: nextData.storyParagraphs.map((paragraph) => paragraph.text).join('\n'),
  targetDuration: nextData.targetDuration,
  mode: 'rewrite',
})}

${formatSeriesContinuityForPrompt(nextData.seriesContinuity)}

Required JSON shape:
{
  "development": {
    "hook": "string",
    "audiencePromise": "string",
    "theme": "string",
    "centralConflict": "string",
    "escalationPlan": "string",
    "climax": "string",
    "payoff": "string",
    "pacingStrategy": "string"
  },
  "storyParagraphs": [{
    "id": "existing paragraph id",
    "sceneRefId": "existing scene id",
    "text": "production-ready rewritten scene action and original-language dialogue"
  }],
  "characters": [{
    "id": "existing character id",
    "dramaticFunction": "string",
    "desire": "string",
    "innerConflict": "string",
    "performanceNotes": "specific facial expression, posture, gesture and reaction logic",
    "silhouette": "identity-safe shape and proportion notes",
    "signatureFeatures": ["renderable feature"],
    "wardrobeIntent": "why the existing wardrobe supports the character; never redesign it"
  }],
  "scenes": [{
    "id": "existing scene id",
    "narrativePurpose": "string",
    "conflict": "string",
    "emotionalTurn": "from X to Y",
    "visualMotif": "renderable motif",
    "continuityIn": "incoming physical/emotional state",
    "continuityOut": "outgoing state that motivates the next scene"
  }]
}

Structured script:
${JSON.stringify(compactInput, null, 2)}`;

  try {
    const responseText = await retryOperation(
      () => chatCompletion(prompt, model, 0.45, 8192, 'json_object', 600000, abortSignal),
      2,
      1800,
      abortSignal,
    );
    const parsed = parseJsonWithRecovery<UnknownRecord>(responseText, {});
    const rawDevelopment = asRecord(parsed.development);
    const fallback = fallbackDevelopmentPlan(nextData);
    const hasGeneratedDevelopment = Boolean(
      clean(rawDevelopment.hook) || clean(rawDevelopment.centralConflict) || clean(rawDevelopment.pacingStrategy),
    );
    nextData.creativeDevelopment = {
      version: STORYBOARD_AGENT_VERSION,
      status: hasGeneratedDevelopment ? 'generated' : 'fallback',
      hook: clean(rawDevelopment.hook, 600) || fallback.hook,
      audiencePromise: clean(rawDevelopment.audiencePromise, 600) || fallback.audiencePromise,
      theme: clean(rawDevelopment.theme, 420) || fallback.theme,
      centralConflict: clean(rawDevelopment.centralConflict, 700) || fallback.centralConflict,
      escalationPlan: clean(rawDevelopment.escalationPlan, 900) || fallback.escalationPlan,
      climax: clean(rawDevelopment.climax, 700) || fallback.climax,
      payoff: clean(rawDevelopment.payoff, 700) || fallback.payoff,
      pacingStrategy: clean(rawDevelopment.pacingStrategy, 700) || fallback.pacingStrategy,
      generatedAt: Date.now(),
    };

    const rewrittenParagraphs = new Map<string, UnknownRecord>(
      asRecordArray(parsed.storyParagraphs)
        .map((item) => [String(item.id ?? ''), item] as const)
        .filter(([id]) => Boolean(id)),
    );
    nextData.storyParagraphs = (nextData.storyParagraphs || []).map((paragraph) => {
      const rewritten = rewrittenParagraphs.get(String(paragraph.id));
      if (!rewritten) return paragraph;
      const text = cleanLines(rewritten.text, 2600);
      const sceneRefId = clean(rewritten.sceneRefId, 160);
      return {
        ...paragraph,
        text: text || paragraph.text,
        sceneRefId: sceneRefId === String(paragraph.sceneRefId) ? sceneRefId : paragraph.sceneRefId,
      };
    });

    const rawCharacters = new Map<string, UnknownRecord>(
      asRecordArray(parsed.characters)
        .map((item) => [clean(item.id, 160), item] as const)
        .filter(([id]) => Boolean(id)),
    );
    nextData.characters = (nextData.characters || []).map((character) => ({
      ...character,
      creativeDirection: normalizeCharacterDirection(asRecord(rawCharacters.get(String(character.id))), character),
    }));

    const rawScenes = new Map<string, UnknownRecord>(
      asRecordArray(parsed.scenes)
        .map((item) => [clean(item.id, 160), item] as const)
        .filter(([id]) => Boolean(id)),
    );
    nextData.scenes = (nextData.scenes || []).map((scene) => ({
      ...scene,
      creativeDirection: normalizeSceneDirection(asRecord(rawScenes.get(String(scene.id))), scene),
    }));

    const warning = hasGeneratedDevelopment
      ? undefined
      : '编剧 Agent 返回内容不完整，已使用确定性创作意图兜底。';
    updateAgentRun(nextData, 'development', { completedStage: true, warning });
    logScriptProgress(
      hasGeneratedDevelopment
        ? '编剧 Agent：全片创作意图已锁定。'
        : '编剧 Agent：返回不完整，已使用可追踪兜底方案。',
    );
    return nextData;
  } catch (error: unknown) {
    nextData.creativeDevelopment = fallbackDevelopmentPlan(nextData);
    rememberFallbackDirections(nextData);
    const warning = `编剧 Agent 调用失败，已降级继续：${clean(errorMessage(error), 260)}`;
    updateAgentRun(nextData, 'development', { completedStage: true, warning });
    console.warn('[storyboard-agent] development fallback:', error);
    logScriptProgress('编剧 Agent：调用失败，已使用可追踪兜底方案继续。');
    return nextData;
  }
};

const fallbackDirectorBeat = (
  scene: Scene,
  order: number,
  shotCount: number,
): StoryboardDirectorBeat => {
  const creative = scene.creativeDirection || fallbackSceneDirection(scene);
  return {
    id: `director-beat-${order}`,
    sceneId: String(scene.id),
    order,
    shotCount,
    purpose: creative.narrativePurpose,
    emotionalBeat: creative.emotionalTurn,
    conflictBeat: creative.conflict,
    visualHook: creative.visualMotif,
    cameraStrategy: 'Use motivated coverage with one clear dominant movement and readable screen direction.',
    continuityIn: creative.continuityIn,
    continuityOut: creative.continuityOut,
    h3FeasibilityNotes: 'Keep each shot to one primary action with physically reachable start and end states.',
  };
};

const fallbackDirectorPlan = (
  scriptData: ScriptData,
  sceneShotPlan: number[],
  shotDurationSeconds: number,
): StoryboardDirectorPlan => ({
  version: STORYBOARD_DIRECTOR_PLAN_VERSION,
  status: 'fallback',
  openingHook: scriptData.creativeDevelopment?.hook || scriptData.logline,
  escalation: scriptData.creativeDevelopment?.escalationPlan || 'Escalate the visible obstacle in each successive scene.',
  climax: scriptData.creativeDevelopment?.climax || 'Make the decisive action the strongest visual beat.',
  payoff: scriptData.creativeDevelopment?.payoff || 'End on a readable resolved state.',
  pacingNotes: scriptData.creativeDevelopment?.pacingStrategy || 'Use concise setup, accelerating middle beats, and a held payoff.',
  targetShotCount: sceneShotPlan.reduce((sum, count) => sum + count, 0),
  shotDurationSeconds,
  beats: (scriptData.scenes || []).map((scene, index) =>
    fallbackDirectorBeat(scene, index + 1, sceneShotPlan[index] || 1),
  ),
  generatedAt: Date.now(),
});

const normalizeDirectorBeat = (
  raw: UnknownRecord,
  scene: Scene,
  order: number,
  shotCount: number,
): StoryboardDirectorBeat => {
  const fallback = fallbackDirectorBeat(scene, order, shotCount);
  return {
    ...fallback,
    id: clean(raw.id, 160) || fallback.id,
    sceneId: String(scene.id),
    order,
    shotCount,
    purpose: clean(raw.purpose, 520) || fallback.purpose,
    emotionalBeat: clean(raw.emotionalBeat, 520) || fallback.emotionalBeat,
    conflictBeat: clean(raw.conflictBeat, 520) || fallback.conflictBeat,
    visualHook: clean(raw.visualHook, 520) || fallback.visualHook,
    cameraStrategy: clean(raw.cameraStrategy, 520) || fallback.cameraStrategy,
    continuityIn: clean(raw.continuityIn, 520) || fallback.continuityIn,
    continuityOut: clean(raw.continuityOut, 520) || fallback.continuityOut,
    h3FeasibilityNotes: clean(raw.h3FeasibilityNotes, 520) || fallback.h3FeasibilityNotes,
  };
};

/** 全片导演 Agent：先建立跨场景节奏和连续性，再允许场景并发生成。 */
export const generateStoryboardDirectorPlan = async (
  scriptData: ScriptData,
  sceneShotPlan: number[],
  shotDurationSeconds: number,
  model: string = getActiveChatModelName(),
  abortSignal?: AbortSignal,
): Promise<StoryboardDirectorPlan> => {
  updateAgentRun(scriptData, 'director-plan');
  logScriptProgress('导演 Agent：正在制定全片节奏、镜头预算和跨场景连续性...');
  const fallback = fallbackDirectorPlan(scriptData, sceneShotPlan, shotDurationSeconds);
  const scenePayload = (scriptData.scenes || []).map((scene, index) => ({
    id: scene.id,
    order: index + 1,
    shotCount: sceneShotPlan[index] || 1,
    location: scene.location,
    time: scene.time,
    atmosphere: scene.atmosphere,
    creativeDirection: scene.creativeDirection,
    story: (scriptData.storyParagraphs || [])
      .filter((paragraph) => String(paragraph.sceneRefId) === String(scene.id))
      .map((paragraph) => cleanLines(paragraph.text, 1400)),
  }));
  const prompt = `You are the supervising director for a short-form cinematic video.
Create ONE whole-film storyboard plan before individual scenes are generated. The scene shot counts are locked.

Goals:
- The first shot must create an immediate visual question or disruption.
- Every scene must have a distinct narrative purpose, conflict beat, emotional turn, and visual hook.
- Escalate causally toward the climax; do not repeat the same information in adjacent shots.
- Define continuity in/out states so independently generated scenes cut together.
- Camera strategy must be motivated, varied, and feasible for ${shotDurationSeconds}-second AI video shots.
- MiniMax H3 feasibility: one dominant action per shot, explicit physical state changes, no impossible multi-stage choreography.
- Preserve the Production Bible and all explicit script facts.
- Output descriptive text in ${scriptData.language || '中文'} and JSON only.

${formatProductionBibleForPrompt(scriptData)}

${formatSeriesContinuityForPrompt(scriptData.seriesContinuity)}

${buildScreenwritingGuidance({
  script: scriptData.storyParagraphs.map((paragraph) => paragraph.text).join('\n'),
  targetDuration: scriptData.targetDuration,
  mode: 'rewrite',
})}

Creative development:
${JSON.stringify(scriptData.creativeDevelopment || {}, null, 2)}

Locked scenes and budgets:
${JSON.stringify(scenePayload, null, 2)}

Required JSON shape:
{
  "openingHook": "string",
  "escalation": "string",
  "climax": "string",
  "payoff": "string",
  "pacingNotes": "string",
  "beats": [{
    "id": "string",
    "sceneId": "existing scene id",
    "purpose": "string",
    "emotionalBeat": "string",
    "conflictBeat": "string",
    "visualHook": "string",
    "cameraStrategy": "string",
    "continuityIn": "string",
    "continuityOut": "string",
    "h3FeasibilityNotes": "string"
  }]
}`;

  try {
    const responseText = await retryOperation(
      () => chatCompletion(prompt, model, 0.4, 8192, 'json_object', 600000, abortSignal),
      2,
      1800,
      abortSignal,
    );
    const parsed = parseJsonWithRecovery<UnknownRecord>(responseText, {});
    const rawBeats = asRecordArray(parsed.beats);
    const bySceneId = new Map<string, UnknownRecord>(
      rawBeats
        .map((beat) => [clean(beat.sceneId, 160), beat] as const)
        .filter(([sceneId]) => Boolean(sceneId)),
    );
    const hasGeneratedPlan = Boolean(clean(parsed.openingHook) && rawBeats.length > 0);
    const plan: StoryboardDirectorPlan = {
      version: STORYBOARD_DIRECTOR_PLAN_VERSION,
      status: hasGeneratedPlan ? 'generated' : 'fallback',
      openingHook: clean(parsed.openingHook, 700) || fallback.openingHook,
      escalation: clean(parsed.escalation, 900) || fallback.escalation,
      climax: clean(parsed.climax, 700) || fallback.climax,
      payoff: clean(parsed.payoff, 700) || fallback.payoff,
      pacingNotes: clean(parsed.pacingNotes, 700) || fallback.pacingNotes,
      targetShotCount: fallback.targetShotCount,
      shotDurationSeconds,
      beats: (scriptData.scenes || []).map((scene, index) =>
        normalizeDirectorBeat(asRecord(bySceneId.get(String(scene.id))), scene, index + 1, sceneShotPlan[index] || 1),
      ),
      generatedAt: Date.now(),
    };
    scriptData.storyboardDirectorPlan = plan;
    const warning = hasGeneratedPlan ? undefined : '导演 Agent 返回内容不完整，已按场景创作意图补齐。';
    updateAgentRun(scriptData, 'director-plan', { completedStage: true, warning });
    logScriptProgress(hasGeneratedPlan ? '导演 Agent：全片分镜规划完成。' : '导演 Agent：已用兜底规划补齐全片。');
    return plan;
  } catch (error: unknown) {
    scriptData.storyboardDirectorPlan = fallback;
    const warning = `导演 Agent 调用失败，已降级继续：${clean(errorMessage(error), 260)}`;
    updateAgentRun(scriptData, 'director-plan', { completedStage: true, warning });
    console.warn('[storyboard-agent] director plan fallback:', error);
    logScriptProgress('导演 Agent：调用失败，已使用全片兜底规划继续。');
    return fallback;
  }
};

export const formatDirectorPlanForScene = (
  plan: StoryboardDirectorPlan | undefined,
  sceneId: string,
): string => {
  if (!plan) return '';
  const beat = plan.beats.find((item) => String(item.sceneId) === String(sceneId));
  if (!beat) return '';
  return `[WHOLE-FILM DIRECTOR PLAN — MANDATORY]
Opening hook: ${plan.openingHook}
Escalation: ${plan.escalation}
Climax: ${plan.climax}
Payoff: ${plan.payoff}
Pacing: ${plan.pacingNotes}

This scene beat:
- Purpose: ${beat.purpose}
- Emotional turn: ${beat.emotionalBeat}
- Conflict: ${beat.conflictBeat}
- Visual hook: ${beat.visualHook}
- Camera strategy: ${beat.cameraStrategy}
- Continuity in: ${beat.continuityIn}
- Continuity out: ${beat.continuityOut}
- H3 feasibility: ${beat.h3FeasibilityNotes}`;
};

export const buildShotAgentContract = (shotDurationSeconds: number): string => `
[SHOT AGENT CONTRACT — REQUIRED FOR EVERY SHOT]
In addition to the existing top-level shot fields, every shot MUST include:
  "frameDirections": {
    "start": {
      "storyState": "static visible state at the first frame",
      "blocking": "static screen positions, body orientation, and eyelines",
      "performance": "visible facial expression and body tension",
      "propState": "static prop location/holder/state",
      "characterBlocking": [{"characterId":"existing id","count":1,"position":"left/center/right","depth":"foreground|midground|background","facing":"direction","gaze":"target","action":"visible action or stillness","expression":"visible expression"}],
      "propStates": {"existing_prop_id": {"holderCharacterId":"existing id","hand":"left|right|both|either","position":"position","state":"visible state","visible":true}}
    },
    "end": "same schema, describing only the final static frame"
  },
  "constraintPolicy": {
    "required": ["3-6 facts that must be visible or preserved"],
    "preferred": ["helpful but non-blocking facts"],
    "flexible": ["decorative details the model may vary"],
    "forbiddenProps": ["props not allowed in this shot"]
  }
Do not put a full action timeline into frameDirections.start or frameDirections.end. They must describe only what is visible in that frame.
In addition to the existing shot fields, every shot MUST include this nested object:
  "agent": {
  "directorPurpose": "what new story information or change this shot contributes",
  "emotionalBeat": "specific visible emotional change",
  "visualHook": "one immediately readable visual idea",
  "executionPlan": {
    "coreBeat": "one dominant action and its narrative turn",
    "actionPhases": [
      {"startSeconds": 0, "endSeconds": ${shotDurationSeconds}, "action": "one physically achievable phase", "camera": "camera behavior", "sound": "diegetic sound"}
    ],
    "subjectBlocking": "where the visible subject is and how it moves",
    "propBlocking": "where important props remain and how they are used",
    "cameraPlan": "shot size, angle, and one motivated camera movement",
    "endState": "one readable final visual state",
    "soundPlan": ["diegetic sound synchronized to the action"],
    "dialogueTiming": "when dialogue occurs within the action phases and where a readable pause is needed",
    "referencePolicy": [{"assetType":"character|scene|prop|storyboard","assetId":"existing id","label":"asset name","policy":"required|supportive|textOnly|omitted","reason":"shot-level reason","visiblePhaseIndexes":[0]}],
  },
  "timeline": [
    {"startSeconds": 0, "endSeconds": ${shotDurationSeconds}, "action": "one physically achievable action phase", "camera": "camera behavior", "sound": "diegetic sound intention"}
  ],
  "continuity": {
    "entryState": "body/prop/spatial state at frame 1",
    "exitState": "body/prop/spatial state at final frame",
    "screenDirection": "left-to-right/right-to-left/neutral and eyeline",
    "mustPreserve": ["identity, wardrobe, prop, lighting or spatial fact"]
  },
  "audioIntent": "exact dialogue intention or ambient-only sound plan",
  "h3FeasibilityNotes": "how to keep motion achievable in ${shotDurationSeconds}s"
}
Timeline beats must be chronological, non-overlapping, and stay within 0-${shotDurationSeconds} seconds. Use at most ${maxExecutionPhasesForDuration(shotDurationSeconds)} action phases, one dominant action, and one readable end state per shot.
For downstream H3 Prompt Agent generation, write every agent field in English. The only exception is dialogue text, which must remain in its original spoken language.`;

const normalizeTimeline = (
  value: unknown,
  shot: Shot,
  durationSeconds: number,
): ShotTimelineBeat[] => {
  const raw = Array.isArray(value) ? value : [];
  const normalized = raw
    .reduce<ShotTimelineBeat[]>((output, item: unknown) => {
      const record = asRecord(item);
      const startSeconds = clamp(record.startSeconds, 0, durationSeconds, 0);
      const endSeconds = clamp(record.endSeconds, startSeconds, durationSeconds, durationSeconds);
      const action = clean(record.action, 420);
      if (!action || endSeconds <= startSeconds) return output;
      output.push({
        startSeconds: Math.round(startSeconds * 10) / 10,
        endSeconds: Math.round(endSeconds * 10) / 10,
        action,
        camera: clean(record.camera, 240) || undefined,
        sound: clean(record.sound, 260) || undefined,
      });
      return output;
    }, [])
    .sort((a, b) => a.startSeconds - b.startSeconds)
    .slice(0, maxExecutionPhasesForDuration(durationSeconds))
    .reduce<ShotTimelineBeat[]>((output, phase) => {
      const startSeconds = Math.max(phase.startSeconds, output.at(-1)?.endSeconds || 0);
      if (phase.endSeconds <= startSeconds) return output;
      output.push({ ...phase, startSeconds });
      return output;
    }, []);
  if (normalized.length > 0) return normalized;
  return [{
    startSeconds: 0,
    endSeconds: durationSeconds,
    action: clean(shot.actionSummary, 420) || 'Execute the shot’s primary action.',
    camera: clean(shot.cameraMovement, 240) || undefined,
    sound: clean(shot.dialogue, 260) || 'Diegetic ambience only.',
  }];
};

const normalizeExecutionPlan = (
  value: unknown,
  shot: Shot,
  scriptData: ScriptData,
  timeline: ShotTimelineBeat[],
  entryState: string,
  exitState: string,
  durationSeconds: number,
) => {
  const raw = asRecord(value);
  const characters = (shot.characters || [])
    .map((id) => scriptData.characters.find((character) => String(character.id) === String(id))?.name)
    .filter(Boolean)
    .join('、');
  const props = (shot.props || [])
    .map((id) => scriptData.props?.find((prop) => String(prop.id) === String(id))?.name)
    .filter(Boolean)
    .join('、');
  const actionPhases = normalizeTimeline(raw.actionPhases, shot, durationSeconds)
    .slice(0, maxExecutionPhasesForDuration(durationSeconds));
  const soundPlan = cleanStringArray(raw.soundPlan, 6, 260);
  const rawReferencePolicy = asRecordArray(raw.referencePolicy);
  const validPolicies = new Set(['required', 'supportive', 'textOnly', 'omitted']);
  const referencePolicy: ShotReferencePolicyItem[] = rawReferencePolicy.length > 0
    ? rawReferencePolicy.map((item) => ({
        assetType: ['character', 'scene', 'prop', 'storyboard'].includes(clean(item.assetType, 40))
          ? clean(item.assetType, 40) as ShotReferencePolicyItem['assetType']
          : 'prop',
        assetId: clean(item.assetId, 120) || undefined,
        label: clean(item.label, 160),
        policy: validPolicies.has(clean(item.policy, 40))
          ? clean(item.policy, 40) as ShotReferencePolicyItem['policy']
          : 'textOnly',
        reason: clean(item.reason, 320) || 'Selected by the shot execution Agent.',
        visiblePhaseIndexes: Array.isArray(item.visiblePhaseIndexes)
          ? item.visiblePhaseIndexes.map(Number).filter(Number.isInteger).slice(0, 8)
          : undefined,
        lockedByUser: item.lockedByUser === true,
      })).filter((item) => item.label)
    : [
        ...(shot.characters || []).map((id, index) => {
          const character = scriptData.characters.find((item) => String(item.id) === String(id));
          return {
            assetType: 'character' as const,
            assetId: String(id),
            label: character?.name || String(id),
            policy: index === 0 ? 'required' as const : 'supportive' as const,
            reason: index === 0 ? 'Primary visible identity anchor.' : 'Supporting visible character continuity.',
          };
        }),
        ...(scriptData.scenes.find((item) => String(item.id) === String(shot.sceneId))
          ? [{
              assetType: 'scene' as const,
              assetId: String(shot.sceneId),
              label: scriptData.scenes.find((item) => String(item.id) === String(shot.sceneId))?.location || String(shot.sceneId),
              policy: 'required' as const,
              reason: 'Primary environment and spatial-layout anchor.',
            }]
          : []),
        ...(shot.props || []).map((id) => {
          const prop = scriptData.props?.find((item) => String(item.id) === String(id));
          const mentioned = prop?.name && clean(shot.actionSummary, 700).includes(prop.name);
          return {
            assetType: 'prop' as const,
            assetId: String(id),
            label: prop?.name || String(id),
            policy: mentioned ? 'required' as const : 'textOnly' as const,
            reason: mentioned ? 'Action-critical visible prop.' : 'Retained as text without spending a visual reference slot.',
          };
        }),
      ];
  return {
    coreBeat: clean(raw.coreBeat, 520) || clean(shot.actionSummary, 520),
    actionPhases,
    subjectBlocking: clean(raw.subjectBlocking, 520) || `${characters || '主体'}：${clean(shot.actionSummary, 360)}`,
    propBlocking: clean(raw.propBlocking, 520) || (props ? `道具保持明确位置并服务于当前动作：${props}。` : '无关键道具位置变化。'),
    cameraPlan: clean(raw.cameraPlan, 520) || `${clean(shot.shotSize, 120) || '中景'}；${clean(shot.cameraMovement, 240) || '镜头保持稳定'}。`,
    endState: clean(raw.endState, 520) || exitState,
    soundPlan: soundPlan.length > 0 ? soundPlan : Array.from(new Set(actionPhases.map((phase) => phase.sound).filter(Boolean) as string[])).slice(0, 6),
    dialogueTiming: clean(raw.dialogueTiming, 320) || (clean(shot.dialogue) ? 'Deliver dialogue during the clearest performance beat; preserve a short readable pause after the line.' : undefined),
    referencePolicy,
  };
};

export interface ShotExecutionPlanValidation {
  valid: boolean;
  issues: string[];
}

/**
 * Deterministic preflight for the execution plan. The LLM remains responsible
 * for the creative wording, while this gate prevents malformed timing and
 * missing production-critical states from reaching the final storyboard.
 */
export const validateShotExecutionPlan = (
  shot: Shot,
  durationSeconds: number,
): ShotExecutionPlanValidation => {
  const plan = shot.agent?.executionPlan;
  const issues: string[] = [];
  if (!plan) {
    return { valid: false, issues: ['缺少镜头执行计划'] };
  }
  if (!plan.coreBeat.trim()) issues.push('缺少镜头核心动作');
  if (!plan.subjectBlocking.trim()) issues.push('缺少主体调度');
  if (!plan.cameraPlan.trim()) issues.push('缺少摄影执行方案');
  if (!plan.endState.trim()) issues.push('缺少清晰的结束状态');
  if (plan.actionPhases.length === 0) issues.push('没有可执行的动作阶段');
  if (plan.actionPhases.length > maxExecutionPhasesForDuration(durationSeconds)) {
    issues.push(`动作阶段超过 ${maxExecutionPhasesForDuration(durationSeconds)} 个`);
  }
  const actionTextLength = plan.actionPhases.reduce((sum, phase) => sum + phase.action.length, 0);
  if (actionTextLength > Math.max(520, durationSeconds * 150)) {
    issues.push('动作阶段描述过密，可能在镜头时长内不可执行');
  }
  const cameraChanges = new Set(
    plan.actionPhases.map((phase) => phase.camera?.trim()).filter(Boolean),
  );
  if (cameraChanges.size > Math.min(3, maxExecutionPhasesForDuration(durationSeconds))) {
    issues.push('摄影变化过多，应保持一个主导机位和运动');
  }

  let previousEnd = 0;
  plan.actionPhases.forEach((phase, index) => {
    if (phase.startSeconds < 0 || phase.endSeconds > durationSeconds) {
      issues.push(`动作阶段 ${index + 1} 超出镜头时长范围`);
    }
    if (phase.endSeconds <= phase.startSeconds) {
      issues.push(`动作阶段 ${index + 1} 没有有效时长`);
    }
    if (phase.startSeconds < previousEnd) {
      issues.push(`动作阶段 ${index + 1} 与前一阶段重叠`);
    }
    const phaseDuration = Math.max(0.1, phase.endSeconds - phase.startSeconds);
    const transitionLimit = phaseDuration <= 3 ? 3 : phaseDuration <= 5 ? 4 : 5;
    const transitionCount = countPhysicalActionTransitions(phase.action);
    if (transitionCount > transitionLimit) {
      issues.push(
        `动作阶段 ${index + 1} 在 ${phaseDuration.toFixed(1)} 秒内包含约 ${transitionCount} 个状态变化，最多建议 ${transitionLimit} 个`,
      );
    }
    previousEnd = Math.max(previousEnd, phase.endSeconds);
  });

  return { valid: issues.length === 0, issues };
};

export const normalizeShotAgentMetadata = (
  shot: Shot,
  scriptData: ScriptData,
  plan: StoryboardDirectorPlan | undefined,
  durationSeconds: number,
): ShotAgentMetadata => {
  const raw = asRecord(shot.agent);
  const rawContinuity = asRecord(raw.continuity);
  const beat = plan?.beats.find((item) => String(item.sceneId) === String(shot.sceneId));
  const scene = scriptData.scenes.find((item) => String(item.id) === String(shot.sceneId));
  const sceneCreative = scene?.creativeDirection;
  const entryState = clean(rawContinuity.entryState, 520) || beat?.continuityIn || sceneCreative?.continuityIn || 'Preserve the established incoming state.';
  const exitState = clean(rawContinuity.exitState, 520) || beat?.continuityOut || sceneCreative?.continuityOut || 'End on a readable state change.';
  const timeline = normalizeTimeline(raw.timeline, shot, durationSeconds);
  return {
    directorPurpose: clean(raw.directorPurpose, 520) || beat?.purpose || sceneCreative?.narrativePurpose || clean(shot.actionSummary, 520),
    emotionalBeat: clean(raw.emotionalBeat, 520) || beat?.emotionalBeat || sceneCreative?.emotionalTurn || 'Make the emotional change visible in performance.',
    visualHook: clean(raw.visualHook, 520) || beat?.visualHook || sceneCreative?.visualMotif || clean(shot.shotSize, 180),
    timeline,
    executionPlan: normalizeExecutionPlan(raw.executionPlan, shot, scriptData, timeline, entryState, exitState, durationSeconds),
    continuity: {
      entryState,
      exitState,
      screenDirection: clean(rawContinuity.screenDirection, 260) || 'neutral; preserve established eyelines',
      mustPreserve: cleanStringArray(rawContinuity.mustPreserve, 8, 220),
    },
    audioIntent: clean(raw.audioIntent, 520) || (clean(shot.dialogue) ? `Original-language dialogue: ${clean(shot.dialogue, 420)}` : 'Diegetic ambience only; no speech or narration.'),
    h3FeasibilityNotes: clean(raw.h3FeasibilityNotes, 520) || beat?.h3FeasibilityNotes || `One dominant action, achievable within ${durationSeconds} seconds.`,
    semanticReview: shot.agent?.semanticReview,
  };
};

/**
 * Re-plan one shot through the storyboard Agent. This is intentionally
 * narrower than full storyboard generation: it repairs execution feasibility
 * while preserving the existing shot's story intent and references.
 */
export const repairShotExecutionPlan = async (
  shot: Shot,
  scriptData: ScriptData,
  durationSeconds: number,
  modelName?: string,
  signal?: AbortSignal,
): Promise<{ executionPlan: ShotExecutionPlan; agent: ShotAgentMetadata } | undefined> => {
  const duration = Math.max(1, Number(durationSeconds) || 5);
  const maxPhases = maxExecutionPhasesForDuration(duration);
  const scene = scriptData.scenes.find((item) => String(item.id) === String(shot.sceneId));
  const characterNames = (shot.characters || [])
    .map((id) => scriptData.characters.find((item) => String(item.id) === String(id))?.name)
    .filter(Boolean)
    .join('、');
  const propNames = (shot.props || [])
    .map((id) => scriptData.props?.find((item) => String(item.id) === String(id))?.name)
    .filter(Boolean)
    .join('、');
  const currentPlan = shot.agent?.executionPlan;
  const prompt = `You are a single-shot video execution planner. Repair the shot for a video model.
Return JSON only. Preserve story intent, character identity, wardrobe, props, scene, and screen direction.
Duration: ${duration}s. Maximum action phases: ${maxPhases}. Use one dominant physical action.
Do not add cuts unless the existing shot explicitly requires them. Prefer one camera setup and one motivated movement.
Every phase must be physically achievable within its time range. The final phase must end in one clear visual state.
Write every execution-plan value in English. Preserve dialogue in its original spoken language only.

Shot:
scene=${clean(scene ? `${scene.location} ${scene.time} ${scene.atmosphere}` : shot.sceneId, 160)}
action=${clean(shot.actionSummary, 700)}
camera=${clean(shot.cameraMovement, 360)}
dialogue=${clean(shot.dialogue, 360) || 'none'}
characters=${clean(characterNames, 240) || 'none'}
props=${clean(propNames, 240) || 'none'}
existingPlan=${JSON.stringify(currentPlan || {})}

Schema:
{
  "executionPlan": {
    "coreBeat": "one sentence",
    "actionPhases": [{"startSeconds":0,"endSeconds":${duration},"action":"one achievable action","camera":"one camera behavior","sound":"synchronized diegetic sound"}],
    "subjectBlocking": "stable subject positions and one readable movement",
    "propBlocking": "where important props remain and how they are used",
    "cameraPlan": "shot size, angle, and one motivated camera movement",
    "endState": "one readable final visual state",
    "soundPlan": ["sound intention"],
    "dialogueTiming": "timing and pause, or omit when no dialogue",
    "referencePolicy": [{"assetType":"character|scene|prop|storyboard","assetId":"use an existing id only","label":"asset name","policy":"required|supportive|textOnly|omitted","reason":"why this shot needs or does not need its image","visiblePhaseIndexes":[0]}]
  }
}
Keep actionPhases chronological, non-overlapping, and within 0-${duration}s. Reference policy must reserve images for the primary identity, environment, and action-critical props; downgrade non-visible or incidental props to textOnly. Do not invent asset ids. Do not describe metadata, analysis, or multiple alternative versions.`;

  try {
    let repairFeedback = '';
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const attemptPrompt = repairFeedback
        ? `${prompt}\n\nThe previous plan failed deterministic validation:\n${repairFeedback}\nRegenerate the complete JSON plan. Resolve every listed issue; do not explain.`
        : prompt;
      const response = await retryOperation(
        () => chatCompletion(
          attemptPrompt,
          modelName || getActiveChatModelName(),
          0.2,
          4096,
          'json_object',
          120000,
          signal,
        ),
        1,
        800,
        signal,
      );
      const parsed = parseJsonWithRecovery(response);
      const rawPlan = asRecord(asRecord(parsed).executionPlan || parsed);
      const rawAgent = {
        ...(shot.agent || {}),
        executionPlan: rawPlan,
      };
      const repairedShot = { ...shot, agent: rawAgent as unknown as ShotAgentMetadata };
      const agent = normalizeShotAgentMetadata(repairedShot, scriptData, undefined, duration);
      const validation = validateShotExecutionPlan({ ...repairedShot, agent }, duration);
      const validationIssues = [...validation.issues];
      const rawActionPhaseCount = asRecordArray(rawPlan.actionPhases).length;
      if (rawActionPhaseCount === 0) {
        validationIssues.push('Agent 原始输出缺少 actionPhases，不能依赖确定性回退代填');
      } else if (rawActionPhaseCount > maxPhases) {
        validationIssues.push(`Agent 原始输出包含 ${rawActionPhaseCount} 个动作阶段，超过上限 ${maxPhases}`);
      }
      if (validationIssues.length === 0) {
        return { executionPlan: agent.executionPlan, agent };
      }
      repairFeedback = validationIssues.map((issue) => `- ${issue}`).join('\n');
      if (attempt === 0) {
        logScriptProgress(`单镜头 Agent 计划未通过，正在按校验结果重试：${validationIssues.join('；')}`);
      } else {
        logScriptProgress(`单镜头 Agent 重试后仍有校验问题：${validationIssues.join('；')}`);
        return { executionPlan: agent.executionPlan, agent };
      }
    }
    return undefined;
  } catch (error) {
    logScriptProgress(`单镜头 Agent 重规划失败，回退到确定性编译：${errorMessage(error)}`);
    return undefined;
  }
};

export const attachShotAgentMetadata = (
  shots: Shot[],
  scriptData: ScriptData,
  plan: StoryboardDirectorPlan | undefined,
  durationSeconds: number,
): Shot[] => {
  updateAgentRun(scriptData, 'shot-generation');
  const previousExitByScene = new Map<string, string>();
  const next = shots.map((shot) => {
    const agent = normalizeShotAgentMetadata(shot, scriptData, plan, durationSeconds);
    const previousExit = previousExitByScene.get(String(shot.sceneId));
    if (previousExit && (!shot.agent?.continuity?.entryState || shot.agent.continuity.entryState === agent.continuity.entryState)) {
      agent.continuity.entryState = previousExit;
    }
    previousExitByScene.set(String(shot.sceneId), agent.continuity.exitState);
    return { ...shot, agent };
  });
  const withLedger = applyContinuityLedgerToShots(next, scriptData);
  scriptData.continuityLedger = withLedger.ledger;
  updateAgentRun(scriptData, 'shot-generation', { completedStage: true });
  return withLedger.shots;
};

interface SemanticRepairPayload {
  actionSummary?: unknown;
  dialogue?: unknown;
  cameraMovement?: unknown;
  shotSize?: unknown;
  keyframes?: {
    startVisualPrompt?: unknown;
    endVisualPrompt?: unknown;
  };
  agent?: unknown;
}

const resolveGrade = (score: number): ShotQualityAssessment['grade'] => {
  if (score >= 80) return 'pass';
  if (score >= 60) return 'warning';
  return 'fail';
};

const mergeSemanticAssessment = (
  existing: ShotQualityAssessment | undefined,
  review: ShotSemanticReview,
): ShotQualityAssessment => {
  const existingChecks = existing?.checks || [];
  const semanticCheck: QualityCheck = {
    key: 'semantic-direction',
    label: 'Semantic Direction',
    score: review.score,
    weight: 35,
    passed: review.verdict === 'pass',
    details: review.issues.length ? review.issues.join('；') : '叙事目的、动作可执行性与连续性通过导演 Agent 审查。',
  };
  const checks = [...existingChecks.filter((check) => check.key !== semanticCheck.key), semanticCheck];
  const totalWeight = checks.reduce((sum, check) => sum + Math.max(0, check.weight), 0) || 1;
  const score = Math.round(checks.reduce((sum, check) => sum + check.score * Math.max(0, check.weight), 0) / totalWeight);
  const grade = resolveGrade(score);
  return {
    version: SEMANTIC_QUALITY_VERSION,
    score,
    grade,
    generatedAt: Date.now(),
    checks,
    summary: review.issues.length
      ? `导演 Agent ${review.repaired ? '已局部修复' : '审查'}：${review.issues.join('；')}`
      : '导演 Agent 语义审查通过，可进入视觉制作。',
  };
};

const applyRepair = (
  shot: Shot,
  repair: SemanticRepairPayload | undefined,
  scriptData: ScriptData,
  plan: StoryboardDirectorPlan,
  durationSeconds: number,
): Shot => {
  if (!repair) return shot;
  const next: Shot = {
    ...shot,
    actionSummary: clean(repair.actionSummary, 1200) || shot.actionSummary,
    dialogue: repair.dialogue === undefined ? shot.dialogue : clean(repair.dialogue, 700),
    cameraMovement: clean(repair.cameraMovement, 420) || shot.cameraMovement,
    shotSize: clean(repair.shotSize, 180) || shot.shotSize,
  };
  if (repair.keyframes) {
    next.keyframes = (shot.keyframes || []).map((keyframe) => {
      const replacement = keyframe.type === 'start'
        ? repair.keyframes?.startVisualPrompt
        : repair.keyframes?.endVisualPrompt;
      const visualPrompt = cleanLines(replacement, 1400);
      return visualPrompt ? { ...keyframe, visualPrompt } : keyframe;
    });
  }
  const repairAgent = asRecord(repair.agent);
  const repairContinuity = asRecord(repairAgent.continuity);
  const mergedAgent = {
    ...(shot.agent || {}),
    ...repairAgent,
    timeline: Array.isArray(repairAgent.timeline)
      ? repairAgent.timeline
      : shot.agent?.timeline,
    continuity: {
      ...(shot.agent?.continuity || {}),
      ...repairContinuity,
    },
  } as ShotAgentMetadata;
  next.agent = normalizeShotAgentMetadata(
    { ...next, agent: mergedAgent },
    scriptData,
    plan,
    durationSeconds,
  );
  return next;
};

/**
 * 导演审片 Agent：一次批量语义审查，仅允许按 shotId 做局部修复。
 * 结构审片（删/并/重排）由 reviewStoryboardStructure 负责，应先于本函数执行。
 */
export const reviewAndRepairStoryboard = async (
  shots: Shot[],
  scriptData: ScriptData,
  plan: StoryboardDirectorPlan,
  model: string = getActiveChatModelName(),
  abortSignal?: AbortSignal,
): Promise<Shot[]> => {
  if (shots.length === 0) return shots;
  updateAgentRun(scriptData, 'semantic-review');
  logScriptProgress('字段审片 Agent：正在检查叙事推进、表演、动作可执行性和镜头连续性...');
  const durationSeconds = Math.max(1, plan.shotDurationSeconds || scriptData.planningShotDuration || 5);
  const compactShots = shots.map((shot) => ({
    id: shot.id,
    sceneId: shot.sceneId,
    actionSummary: clean(shot.actionSummary, 800),
    dialogue: clean(shot.dialogue, 500),
    cameraMovement: clean(shot.cameraMovement, 300),
    shotSize: clean(shot.shotSize, 120),
    characters: shot.characters,
    props: shot.props,
    keyframes: (shot.keyframes || []).map((keyframe) => ({
      type: keyframe.type,
      visualPrompt: cleanLines(keyframe.visualPrompt, 700),
    })),
    agent: shot.agent,
  }));
  const prompt = `You are the final storyboard continuity editor for an AI-generated short film.
The structural pass (remove/merge/reorder) already ran. Do NOT add or remove shots.
Review all shots as one sequence, then repair only the shots that materially need field-level fixes.

Evaluate:
1. Every remaining shot contributes new story information and matches the whole-film director plan.
2. Emotional progression and character behavior are visible, specific, and causally motivated.
3. One dominant action is physically achievable within ${durationSeconds} seconds.
4. Camera movement is motivated, not repetitive, and preserves screen direction/eyelines.
5. Entry and exit states cut together; identity, exact wardrobe, props, lighting, and spatial facts remain stable.
6. Start/end visual prompts represent reachable states of the same shot. Repair any prompt that is only a style label, generic scene description, or lacks the shot-specific subject action, spatial placement, prop relationship, composition, camera movement, lighting, or continuity. A concise prompt is acceptable, but it must still contain those shot-specific facts.
7. Dialogue remains in its original language and is short enough for the shot. Never add narration.
8. MiniMax H3 Ref2VA can execute the motion from references without treating references as literal start/end frames.

REPAIR SAFETY:
- Never change shot ids, scene ids, character ids, prop ids, plot facts, wardrobe, spoken language, or story outcome.
- Do not add or remove shots.
- Return a repair object only when needed; prefer the smallest change.
- Output JSON only, with exactly one review per supplied shot id.

${formatProductionBibleForPrompt(scriptData)}

${formatSeriesContinuityForPrompt(scriptData.seriesContinuity)}

${buildScreenwritingGuidance({
  script: scriptData.storyParagraphs.map((paragraph) => paragraph.text).join('\n'),
  targetDuration: scriptData.targetDuration,
  mode: 'diagnose',
})}

Whole-film director plan:
${JSON.stringify(plan, null, 2)}

Shots:
${JSON.stringify(compactShots, null, 2)}

Required JSON shape:
{
  "reviews": [{
    "shotId": "existing shot id",
    "score": 0,
    "verdict": "pass|warning|fail",
    "issues": ["specific issue"],
    "repair": {
      "actionSummary": "optional replacement",
      "dialogue": "optional replacement in original language",
      "cameraMovement": "optional replacement",
      "shotSize": "optional replacement",
      "keyframes": {"startVisualPrompt": "optional", "endVisualPrompt": "optional"},
      "agent": {"directorPurpose": "optional", "emotionalBeat": "optional", "visualHook": "optional", "executionPlan": {"coreBeat": "optional", "actionPhases": [], "subjectBlocking": "optional", "propBlocking": "optional", "cameraPlan": "optional", "endState": "optional", "soundPlan": []}, "timeline": [], "continuity": {}, "audioIntent": "optional", "h3FeasibilityNotes": "optional"}
    }
  }]
}`;

  try {
    const responseText = await retryOperation(
      () => chatCompletion(prompt, model, 0.25, 8192, 'json_object', 600000, abortSignal),
      2,
      1800,
      abortSignal,
    );
    const parsed = parseJsonWithRecovery<UnknownRecord>(responseText, {});
    const rawReviews = asRecordArray(parsed.reviews);
    const reviewByShotId = new Map<string, UnknownRecord>(
      rawReviews
        .map((review) => [clean(review.shotId, 160), review] as const)
        .filter(([shotId]) => Boolean(shotId)),
    );
    let repairedCount = 0;
    let issueCount = 0;
    const reviewedShots = shots.map((shot) => {
      const raw = reviewByShotId.get(String(shot.id));
      if (!raw) return shot;
      const score = Math.round(clamp(raw.score, 0, 100, 65));
      const verdict: ShotSemanticReview['verdict'] = raw.verdict === 'pass' || raw.verdict === 'fail'
        ? raw.verdict
        : score >= 80 ? 'pass' : score >= 60 ? 'warning' : 'fail';
      const issues = cleanStringArray(raw.issues, 6, 360);
      const rawRepair = asRecord(raw.repair);
      const hasRepair = Object.keys(rawRepair).length > 0;
      const repairedShot = applyRepair(
        shot,
        hasRepair ? rawRepair as SemanticRepairPayload : undefined,
        scriptData,
        plan,
        durationSeconds,
      );
      if (hasRepair) repairedCount += 1;
      issueCount += issues.length;
      const semanticReview: ShotSemanticReview = {
        score,
        verdict,
        issues,
        repaired: Boolean(hasRepair),
        reviewedAt: Date.now(),
      };
      const agent = normalizeShotAgentMetadata(repairedShot, scriptData, plan, durationSeconds);
      agent.semanticReview = semanticReview;
      return {
        ...repairedShot,
        agent,
        qualityAssessment: mergeSemanticAssessment(repairedShot.qualityAssessment, semanticReview),
      };
    });
    const reviewedShotCount = shots.filter((shot) => reviewByShotId.has(String(shot.id))).length;
    const missingReviewCount = shots.length - reviewedShotCount;
    const warning = missingReviewCount > 0
      ? `字段审片 Agent 缺少 ${missingReviewCount} 个镜头的结果，未对这些镜头做语义修改。`
      : undefined;
    updateAgentRun(scriptData, 'semantic-review', { completedStage: true, warning });
    updateAgentRun(scriptData, 'completed', { completedStage: true, finish: true });
    logScriptProgress(`字段审片 Agent：完成 ${shots.length} 个镜头审查，发现 ${issueCount} 项，局部修复 ${repairedCount} 个镜头。`);
    return reviewedShots;
  } catch (error: unknown) {
    const warning = `字段审片 Agent 调用失败，保留规则校验结果：${clean(errorMessage(error), 260)}`;
    updateAgentRun(scriptData, 'semantic-review', { completedStage: true, warning });
    updateAgentRun(scriptData, 'completed', { completedStage: true, finish: true });
    console.warn('[storyboard-agent] semantic review fallback:', error);
    logScriptProgress('字段审片 Agent：调用失败，已保留规则校验结果并继续。');
    return shots;
  }
};

const STRUCTURE_ACTION_TYPES = new Set(['remove', 'merge', 'reorder', 'regenerateBeat']);

const normalizeStructureIssues = (raw: unknown): StoryboardStructureIssue[] =>
  asRecordArray(raw).slice(0, 24).map((item): StoryboardStructureIssue | null => {
    const kindRaw = clean(item.kind, 40);
    const kind: StoryboardStructureIssue['kind'] =
      kindRaw === 'duplicate_beat'
      || kindRaw === 'missing_transition'
      || kindRaw === 'empty_progress'
      || kindRaw === 'pacing'
        ? kindRaw
        : 'other';
    const summary = clean(item.summary, 420);
    if (!summary) return null;
    return {
      kind,
      shotIds: cleanStringArray(item.shotIds, 12, 160),
      summary,
      severity: item.severity === 'fail' ? 'fail' : 'warning',
    };
  }).filter((issue): issue is StoryboardStructureIssue => issue !== null);

const normalizeStructureActions = (
  raw: unknown,
  validShotIds: Set<string>,
): StoryboardStructureAction[] => {
  const actions: StoryboardStructureAction[] = [];
  for (const item of asRecordArray(raw).slice(0, 24)) {
    const typeRaw = clean(item.type, 40);
    if (!STRUCTURE_ACTION_TYPES.has(typeRaw)) continue;
    const type = typeRaw as StoryboardStructureAction['type'];
    const shotIds = cleanStringArray(item.shotIds, 24, 160).filter((id) => validShotIds.has(id));
    const orderedShotIds = cleanStringArray(item.orderedShotIds, 80, 160).filter((id) => validShotIds.has(id));
    const keepShotIdRaw = clean(item.keepShotId, 160);
    const keepShotId = keepShotIdRaw && validShotIds.has(keepShotIdRaw) ? keepShotIdRaw : undefined;
    if (type === 'reorder') {
      if (orderedShotIds.length < 2) continue;
      actions.push({
        type,
        shotIds: orderedShotIds,
        orderedShotIds,
        reason: clean(item.reason, 420) || 'Reorder for clearer narrative progression',
        autoSafe: item.autoSafe !== false,
      });
      continue;
    }
    if (shotIds.length === 0) continue;
    if (type === 'merge' && shotIds.length < 2) continue;
    actions.push({
      type,
      shotIds,
      keepShotId: type === 'merge' ? (keepShotId || shotIds[0]) : keepShotId,
      orderedShotIds: orderedShotIds.length ? orderedShotIds : undefined,
      reason: clean(item.reason, 420) || 'Structure fix',
      autoSafe: Boolean(item.autoSafe) && type !== 'regenerateBeat',
    });
  }
  return actions;
};

const countShotsByScene = (shots: Shot[]): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const shot of shots) {
    const sceneId = String(shot.sceneId || '');
    counts.set(sceneId, (counts.get(sceneId) || 0) + 1);
  }
  return counts;
};

const applyStructureActions = (
  shots: Shot[],
  actions: StoryboardStructureAction[],
  options?: { applyUnsafe?: boolean },
): { shots: Shot[]; actions: StoryboardStructureAction[]; removedShotIds: string[]; appliedCount: number } => {
  let next = [...shots];
  const removedShotIds: string[] = [];
  let appliedCount = 0;
  const maxRemovable = Math.max(1, Math.floor(shots.length * 0.4));

  const annotated = actions.map((action) => ({ ...action, applied: false }));

  for (const action of annotated) {
    const shouldApply = action.autoSafe || options?.applyUnsafe;
    if (!shouldApply || action.type === 'regenerateBeat') continue;

    if (action.type === 'remove') {
      const sceneCounts = countShotsByScene(next);
      const removable = action.shotIds.filter((id) => {
        const shot = next.find((item) => String(item.id) === id);
        if (!shot) return false;
        const sceneId = String(shot.sceneId || '');
        return (sceneCounts.get(sceneId) || 0) > 1;
      });
      if (removable.length === 0) continue;
      if (removedShotIds.length + removable.length > maxRemovable) continue;
      const removeSet = new Set(removable);
      next = next.filter((shot) => !removeSet.has(String(shot.id)));
      removedShotIds.push(...removable);
      action.applied = true;
      appliedCount += 1;
      continue;
    }

    if (action.type === 'merge') {
      const keepId = String(action.keepShotId || action.shotIds[0] || '');
      const mergeIds = action.shotIds.filter((id) => id !== keepId);
      if (!keepId || mergeIds.length === 0) continue;
      if (removedShotIds.length + mergeIds.length > maxRemovable) continue;
      const keepIndex = next.findIndex((shot) => String(shot.id) === keepId);
      if (keepIndex < 0) continue;
      const keepShot = next[keepIndex];
      const mergedBits = mergeIds
        .map((id) => next.find((shot) => String(shot.id) === id)?.actionSummary)
        .map((text) => clean(text, 220))
        .filter(Boolean);
      const mergedDialogue = [
        clean(keepShot.dialogue, 400),
        ...mergeIds.map((id) => clean(next.find((shot) => String(shot.id) === id)?.dialogue, 200)),
      ].filter(Boolean);
      next[keepIndex] = {
        ...keepShot,
        actionSummary: clean(
          [clean(keepShot.actionSummary, 600), ...mergedBits].filter(Boolean).join(' / '),
          1200,
        ) || keepShot.actionSummary,
        dialogue: mergedDialogue[0] || keepShot.dialogue,
      };
      const removeSet = new Set(mergeIds);
      next = next.filter((shot) => !removeSet.has(String(shot.id)));
      removedShotIds.push(...mergeIds);
      action.applied = true;
      appliedCount += 1;
      continue;
    }

    if (action.type === 'reorder' && action.orderedShotIds && action.orderedShotIds.length >= 2) {
      const order = action.orderedShotIds;
      const orderSet = new Set(order);
      const moving = next.filter((shot) => orderSet.has(String(shot.id)));
      if (moving.length !== order.length) continue;
      const byId = new Map(moving.map((shot) => [String(shot.id), shot]));
      const reordered = order.map((id) => byId.get(id)!);
      let cursor = 0;
      next = next.map((shot) => {
        if (!orderSet.has(String(shot.id))) return shot;
        const replacement = reordered[cursor];
        cursor += 1;
        return replacement;
      });
      action.applied = true;
      appliedCount += 1;
    }
  }

  return { shots: next, actions: annotated, removedShotIds, appliedCount };
};

export interface ReviewStoryboardStructureResult {
  shots: Shot[];
  review: StoryboardStructureReview;
}

/**
 * 结构审片 Agent：检查叠戏/缺转场/空推进，并可自动应用低风险删并重排。
 * 应在字段级审片之前调用。
 */
export const reviewStoryboardStructure = async (
  shots: Shot[],
  scriptData: ScriptData,
  plan: StoryboardDirectorPlan,
  model: string = getActiveChatModelName(),
  abortSignal?: AbortSignal,
  options?: { autoApplySafeActions?: boolean },
): Promise<ReviewStoryboardStructureResult> => {
  if (shots.length === 0) {
    const empty: StoryboardStructureReview = {
      version: STRUCTURE_REVIEW_VERSION,
      score: 100,
      verdict: 'pass',
      issues: [],
      actions: [],
      appliedActionCount: 0,
      removedShotIds: [],
      reviewedAt: Date.now(),
      summary: '无镜头，跳过结构审片。',
    };
    scriptData.storyboardStructureReview = empty;
    return { shots, review: empty };
  }

  updateAgentRun(scriptData, 'structure-review');
  logScriptProgress('结构审片 Agent：正在检查叠戏、缺转场、空推进与 beat 节奏...');
  const autoApply = options?.autoApplySafeActions !== false;
  const validShotIds = new Set(shots.map((shot) => String(shot.id)));
  const compactShots = shots.map((shot, index) => ({
    index,
    id: shot.id,
    sceneId: shot.sceneId,
    actionSummary: clean(shot.actionSummary, 520),
    dialogue: clean(shot.dialogue, 280),
    cameraMovement: clean(shot.cameraMovement, 180),
    shotSize: clean(shot.shotSize, 80),
    characters: shot.characters,
    directorPurpose: clean(shot.agent?.directorPurpose, 280),
    emotionalBeat: clean(shot.agent?.emotionalBeat, 280),
    executionPlan: {
      coreBeat: clean(shot.agent?.executionPlan.coreBeat, 360),
      actionPhases: shot.agent?.executionPlan.actionPhases || [],
      subjectBlocking: clean(shot.agent?.executionPlan.subjectBlocking, 300),
      propBlocking: clean(shot.agent?.executionPlan.propBlocking, 300),
      cameraPlan: clean(shot.agent?.executionPlan.cameraPlan, 300),
      endState: clean(shot.agent?.executionPlan.endState, 300),
    },
  }));

  const prompt = `You are a storyboard STRUCTURE editor for an AI short film.
Your job is structural narrative integrity — NOT wording polish.

Find and fix:
1. duplicate_beat: the same story beat / first meeting / reveal happens twice in a row.
2. missing_transition: a required causal bridge is absent (e.g. character leaves then is suddenly elsewhere).
3. empty_progress: a shot adds no new story information.
4. pacing: too many nearly identical reaction/coverage shots.

ACTIONS (prefer smallest change):
- remove: delete redundant shotIds (autoSafe=true when clearly duplicate/empty).
- merge: combine near-duplicate shots into keepShotId (autoSafe=true when safe).
- reorder: provide orderedShotIds for a contiguous misplaced subsequence (autoSafe=true when local).
- regenerateBeat: mark shots that need creative rewrite but MUST set autoSafe=false (do not invent new shot ids).

HARD RULES:
- Never invent shot ids. Only use ids from the supplied list.
- Prefer remove/merge over regenerateBeat when the beat is simply repeated.
- Do not change dialogue language or plot outcome.
- Keep at least one shot per scene that currently has shots.
- Output JSON only.

${formatSeriesContinuityForPrompt(scriptData.seriesContinuity)}

${buildScreenwritingGuidance({
  script: scriptData.storyParagraphs.map((paragraph) => paragraph.text).join('\n'),
  targetDuration: scriptData.targetDuration,
  mode: 'diagnose',
})}

Script title: ${clean(scriptData.title, 120)}
Logline: ${clean(scriptData.logline, 400)}
Creative development:
${JSON.stringify(scriptData.creativeDevelopment || {}, null, 2)}

Director plan:
${JSON.stringify({
    openingHook: plan.openingHook,
    escalation: plan.escalation,
    climax: plan.climax,
    payoff: plan.payoff,
    pacingNotes: plan.pacingNotes,
    beats: plan.beats,
  }, null, 2)}

Shots in order:
${JSON.stringify(compactShots, null, 2)}

Required JSON shape:
{
  "score": 0,
  "verdict": "pass|warning|fail",
  "summary": "one-line overall assessment",
  "issues": [{
    "kind": "duplicate_beat|missing_transition|empty_progress|pacing|other",
    "shotIds": ["id"],
    "summary": "what is wrong",
    "severity": "warning|fail"
  }],
  "actions": [{
    "type": "remove|merge|reorder|regenerateBeat",
    "shotIds": ["id"],
    "keepShotId": "optional for merge",
    "orderedShotIds": ["optional for reorder"],
    "reason": "why",
    "autoSafe": true
  }]
}`;

  try {
    const responseText = await retryOperation(
      () => chatCompletion(prompt, model, 0.2, 8192, 'json_object', 600000, abortSignal),
      2,
      1800,
      abortSignal,
    );
    const parsed = parseJsonWithRecovery<UnknownRecord>(responseText, {});
    const score = Math.round(clamp(parsed.score, 0, 100, 70));
    const issues = normalizeStructureIssues(parsed.issues);
    const actions = normalizeStructureActions(parsed.actions, validShotIds);
    const verdict: StoryboardStructureReview['verdict'] =
      parsed.verdict === 'pass' || parsed.verdict === 'fail'
        ? parsed.verdict
        : score >= 80 ? 'pass' : score >= 60 ? 'warning' : 'fail';

    const applied = autoApply
      ? applyStructureActions(shots, actions)
      : { shots, actions: actions.map((item) => ({ ...item, applied: false })), removedShotIds: [] as string[], appliedCount: 0 };

    const review: StoryboardStructureReview = {
      version: STRUCTURE_REVIEW_VERSION,
      score,
      verdict,
      issues,
      actions: applied.actions,
      appliedActionCount: applied.appliedCount,
      removedShotIds: applied.removedShotIds,
      reviewedAt: Date.now(),
      summary: clean(parsed.summary, 500)
        || (applied.appliedCount > 0
          ? `结构审片应用 ${applied.appliedCount} 项修复，移除 ${applied.removedShotIds.length} 镜。`
          : issues.length > 0
            ? `发现 ${issues.length} 项结构问题，未自动改动镜头列表。`
            : '结构审片通过。'),
    };
    scriptData.storyboardStructureReview = review;
    const warning = issues.some((issue) => issue.severity === 'fail')
      ? `结构审片存在 fail 级问题：${issues.filter((i) => i.severity === 'fail').map((i) => i.summary).join('；')}`
      : applied.appliedCount === 0 && actions.some((a) => a.type === 'regenerateBeat')
        ? '结构审片建议局部重写部分镜头（regenerateBeat，未自动应用）。'
        : undefined;
    updateAgentRun(scriptData, 'structure-review', { completedStage: true, warning });
    logScriptProgress(
      `结构审片 Agent：${review.summary}（问题 ${issues.length} · 自动修复 ${applied.appliedCount} · 删镜 ${applied.removedShotIds.length}）`,
    );
    return { shots: applied.shots, review };
  } catch (error: unknown) {
    const warning = `结构审片 Agent 调用失败，跳过结构修复：${clean(errorMessage(error), 260)}`;
    const review: StoryboardStructureReview = {
      version: STRUCTURE_REVIEW_VERSION,
      score: 0,
      verdict: 'warning',
      issues: [],
      actions: [],
      appliedActionCount: 0,
      removedShotIds: [],
      reviewedAt: Date.now(),
      summary: warning,
    };
    scriptData.storyboardStructureReview = review;
    updateAgentRun(scriptData, 'structure-review', { completedStage: true, warning });
    console.warn('[storyboard-agent] structure review fallback:', error);
    logScriptProgress('结构审片 Agent：调用失败，已跳过结构修复并继续字段审片。');
    return { shots, review };
  }
};

/**
 * 故事层软门禁：在分镜生成前对照创作意图，只记警告不阻断。
 */
export const reviewStoryOutline = async (
  scriptData: ScriptData,
  rawScript: string,
  model: string = getActiveChatModelName(),
  abortSignal?: AbortSignal,
): Promise<StoryOutlineReview> => {
  updateAgentRun(scriptData, 'development');
  logScriptProgress('故事层门禁：正在对照大纲检查叙事缺口与断层...');
  const development = scriptData.creativeDevelopment;
  const prompt = `You are a story continuity gate for a short-film script before storyboard generation.
Soft-check only: list material gaps vs the creative development plan. Do not rewrite the script.

Flag:
- missing causal bridges (e.g. character never leaves but later is gone)
- duplicate first-meeting / reveal that will force the storyboard to stack beats
- climax/payoff absent from the script body
- major characters introduced without payoff

Script (truncated):
${cleanLines(rawScript, 6000)}

Creative development:
${JSON.stringify(development || {}, null, 2)}

${formatSeriesContinuityForPrompt(scriptData.seriesContinuity)}

${buildScreenwritingGuidance({
  script: rawScript,
  targetDuration: scriptData.targetDuration,
  mode: 'diagnose',
})}

Scenes:
${JSON.stringify((scriptData.scenes || []).map((scene) => ({
    id: scene.id,
    location: scene.location,
    time: scene.time,
    atmosphere: clean(scene.atmosphere, 160),
    purpose: clean(scene.creativeDirection?.narrativePurpose, 200),
  })), null, 2)}

Return JSON only:
{
  "score": 0,
  "verdict": "pass|warning|fail",
  "issues": ["specific gap in original language of the script if Chinese"],
  "summary": "one-line assessment"
}`;

  try {
    const responseText = await retryOperation(
      () => chatCompletion(prompt, model, 0.2, 4096, 'json_object', 300000, abortSignal),
      2,
      1200,
      abortSignal,
    );
    const parsed = parseJsonWithRecovery<UnknownRecord>(responseText, {});
    const score = Math.round(clamp(parsed.score, 0, 100, 75));
    const issues = cleanStringArray(parsed.issues, 10, 360);
    const verdict: StoryOutlineReview['verdict'] =
      parsed.verdict === 'pass' || parsed.verdict === 'fail'
        ? parsed.verdict
        : score >= 80 ? 'pass' : score >= 60 ? 'warning' : 'fail';
    const review: StoryOutlineReview = {
      version: STORY_OUTLINE_REVIEW_VERSION,
      score,
      verdict,
      issues,
      reviewedAt: Date.now(),
      summary: clean(parsed.summary, 420) || (issues.length ? `发现 ${issues.length} 项故事缺口` : '故事层门禁通过'),
    };
    scriptData.storyOutlineReview = review;
    if (issues.length) {
      logScriptProgress(`故事层门禁：${review.summary} — ${issues.slice(0, 3).join('；')}`);
    } else {
      logScriptProgress(`故事层门禁：${review.summary}`);
    }
    return review;
  } catch (error: unknown) {
    const review: StoryOutlineReview = {
      version: STORY_OUTLINE_REVIEW_VERSION,
      score: 0,
      verdict: 'warning',
      issues: [],
      reviewedAt: Date.now(),
      summary: `故事层门禁调用失败（不阻断）：${clean(errorMessage(error), 200)}`,
    };
    scriptData.storyOutlineReview = review;
    console.warn('[storyboard-agent] story outline review fallback:', error);
    logScriptProgress('故事层门禁：调用失败，已跳过并继续分镜。');
    return review;
  }
};

function rememberFallbackDirections(scriptData: ScriptData): void {
  scriptData.characters = (scriptData.characters || []).map((character) => ({
    ...character,
    creativeDirection: character.creativeDirection || fallbackCharacterDirection(character),
  }));
  scriptData.scenes = (scriptData.scenes || []).map((scene) => ({
    ...scene,
    creativeDirection: scene.creativeDirection || fallbackSceneDirection(scene),
  }));
}
