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
  ShotQualityAssessment,
  ShotSemanticReview,
  ShotTimelineBeat,
  StoryboardAgentRun,
  StoryboardAgentStage,
  StoryboardDirectorBeat,
  StoryboardDirectorPlan,
} from '../../types';
import { formatProductionBibleForPrompt } from '../productionBibleService';
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
  const nextData = cloneScriptData(scriptData);
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
    })),
    storyParagraphs: (nextData.storyParagraphs || []).map((paragraph) => ({
      id: paragraph.id,
      sceneRefId: paragraph.sceneRefId,
      text: cleanLines(paragraph.text, 1800),
    })),
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
In addition to the existing shot fields, every shot MUST include this nested object:
"agent": {
  "directorPurpose": "what new story information or change this shot contributes",
  "emotionalBeat": "specific visible emotional change",
  "visualHook": "one immediately readable visual idea",
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
Timeline beats must be chronological, non-overlapping, and stay within 0-${shotDurationSeconds} seconds. Keep one dominant action per shot.`;

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
    .slice(0, 4);
  if (normalized.length > 0) return normalized;
  return [{
    startSeconds: 0,
    endSeconds: durationSeconds,
    action: clean(shot.actionSummary, 420) || 'Execute the shot’s primary action.',
    camera: clean(shot.cameraMovement, 240) || undefined,
    sound: clean(shot.dialogue, 260) || 'Diegetic ambience only.',
  }];
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
  return {
    directorPurpose: clean(raw.directorPurpose, 520) || beat?.purpose || sceneCreative?.narrativePurpose || clean(shot.actionSummary, 520),
    emotionalBeat: clean(raw.emotionalBeat, 520) || beat?.emotionalBeat || sceneCreative?.emotionalTurn || 'Make the emotional change visible in performance.',
    visualHook: clean(raw.visualHook, 520) || beat?.visualHook || sceneCreative?.visualMotif || clean(shot.shotSize, 180),
    timeline: normalizeTimeline(raw.timeline, shot, durationSeconds),
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
  updateAgentRun(scriptData, 'shot-generation', { completedStage: true });
  return next;
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
 * 结构校验仍由原有确定性管线负责，两者职责互补。
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
  logScriptProgress('审片 Agent：正在检查叙事推进、表演、动作可执行性和镜头连续性...');
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
Review all shots as one sequence, then repair only the shots that materially need it.

Evaluate:
1. Every shot contributes new story information and matches the whole-film director plan.
2. Emotional progression and character behavior are visible, specific, and causally motivated.
3. One dominant action is physically achievable within ${durationSeconds} seconds.
4. Camera movement is motivated, not repetitive, and preserves screen direction/eyelines.
5. Entry and exit states cut together; identity, exact wardrobe, props, lighting, and spatial facts remain stable.
6. Start/end visual prompts represent reachable states of the same shot.
7. Dialogue remains in its original language and is short enough for the shot. Never add narration.
8. MiniMax H3 Ref2VA can execute the motion from references without treating references as literal start/end frames.

REPAIR SAFETY:
- Never change shot ids, scene ids, character ids, prop ids, plot facts, wardrobe, spoken language, or story outcome.
- Do not add or remove shots.
- Return a repair object only when needed; prefer the smallest change.
- Output JSON only, with exactly one review per supplied shot id.

${formatProductionBibleForPrompt(scriptData)}

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
      "agent": {"directorPurpose": "optional", "emotionalBeat": "optional", "visualHook": "optional", "timeline": [], "continuity": {}, "audioIntent": "optional", "h3FeasibilityNotes": "optional"}
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
      ? `审片 Agent 缺少 ${missingReviewCount} 个镜头的结果，未对这些镜头做语义修改。`
      : undefined;
    updateAgentRun(scriptData, 'semantic-review', { completedStage: true, warning });
    updateAgentRun(scriptData, 'completed', { completedStage: true, finish: true });
    logScriptProgress(`审片 Agent：完成 ${shots.length} 个镜头审查，发现 ${issueCount} 项，局部修复 ${repairedCount} 个镜头。`);
    return reviewedShots;
  } catch (error: unknown) {
    const warning = `审片 Agent 调用失败，保留规则校验结果：${clean(errorMessage(error), 260)}`;
    updateAgentRun(scriptData, 'semantic-review', { completedStage: true, warning });
    updateAgentRun(scriptData, 'completed', { completedStage: true, finish: true });
    console.warn('[storyboard-agent] semantic review fallback:', error);
    logScriptProgress('审片 Agent：调用失败，已保留规则校验结果并继续。');
    return shots;
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
