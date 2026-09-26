import type {
  ContinuityCharacterState,
  ContinuityPropState,
  PropPresentationMode,
  ScriptData,
  Shot,
  ShotContinuityDelta,
  ShotContinuityLedgerEntry,
  ShotContinuityState,
} from '../types';

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const clean = (value?: string): string => String(value || '').replace(/\s+/g, ' ').trim();

const blankState = (): ShotContinuityState => ({
  characters: {},
  props: {},
  scene: {
    sceneId: '',
    time: '',
    weather: '',
    lighting: '',
    screenDirection: 'neutral',
  },
});

const inferLighting = (text: string): string => {
  const match = text.match(/晨光|晨雾|夕阳|月光|烛光|霓虹|逆光|侧光|顶光|冷光|暖光|daylight|moonlight|sunset|neon|backlight/iu);
  return match?.[0] || '';
};

const inferWeather = (text: string): string => {
  const match = text.match(/晴|阴|雨|雪|雾|风|雷|storm|rain|snow|fog|mist|wind|sunny|cloudy/iu);
  return match?.[0] || '';
};

const inferDirection = (value?: string): string => {
  const text = clean(value).toLowerCase();
  if (/左.{0,8}右|left.{0,8}right/.test(text)) return 'left-to-right';
  if (/右.{0,8}左|right.{0,8}left/.test(text)) return 'right-to-left';
  if (/向前|前进|forward|toward camera/.test(text)) return 'forward';
  if (/后退|远离|away from camera|backward/.test(text)) return 'backward';
  return text || 'neutral';
};

const inferPhysicalState = (shot: Shot): string =>
  clean(shot.agent?.executionPlan.endState || shot.actionSummary).slice(0, 360);

const inferPropMode = (shot: Shot, propId: string, fallback?: PropPresentationMode): PropPresentationMode =>
  shot.propUsages?.[propId]?.mode || fallback || 'unknown';

const diffState = (before: ShotContinuityState, after: ShotContinuityState): ShotContinuityDelta => {
  const characterChanges: ShotContinuityDelta['characterChanges'] = {};
  const propChanges: ShotContinuityDelta['propChanges'] = {};
  Object.entries(after.characters).forEach(([id, value]) => {
    if (JSON.stringify(before.characters[id]) !== JSON.stringify(value)) characterChanges[id] = clone(value);
  });
  Object.entries(after.props).forEach(([id, value]) => {
    if (JSON.stringify(before.props[id]) !== JSON.stringify(value)) propChanges[id] = clone(value);
  });
  const sceneChanges: ShotContinuityDelta['sceneChanges'] = {};
  (Object.keys(after.scene) as Array<keyof typeof after.scene>).forEach((key) => {
    if (before.scene[key] !== after.scene[key]) {
      Object.assign(sceneChanges, { [key]: after.scene[key] });
    }
  });
  return { characterChanges, propChanges, sceneChanges };
};

const detectIssues = (
  shot: Shot,
  before: ShotContinuityState,
  after: ShotContinuityState,
): string[] => {
  const issues: string[] = [];
  const action = clean(shot.actionSummary).toLowerCase();
  Object.entries(after.characters).forEach(([id, state]) => {
    const previous = before.characters[id];
    if (previous?.wardrobe && state.wardrobe && previous.wardrobe !== state.wardrobe && !/换装|更衣|脱下|穿上|changes? clothes|puts? on|removes?/iu.test(action)) {
      issues.push(`角色 ${id} 的服装发生变化，但镜头动作没有换装依据。`);
    }
  });
  Object.entries(after.props).forEach(([id, state]) => {
    const previous = before.props[id];
    if (previous?.holderCharacterId && state.holderCharacterId && previous.holderCharacterId !== state.holderCharacterId && !/递给|交给|接过|夺过|传递|hands? over|passes?|takes? from/iu.test(action)) {
      issues.push(`道具 ${id} 的持有人从 ${previous.holderCharacterId} 变为 ${state.holderCharacterId}，但没有交接动作。`);
    }
  });
  const beforeDirection = before.scene.screenDirection;
  const afterDirection = after.scene.screenDirection;
  if (
    ((beforeDirection === 'left-to-right' && afterDirection === 'right-to-left')
      || (beforeDirection === 'right-to-left' && afterDirection === 'left-to-right'))
    && !/转身|掉头|返回|反向|turns? around|reverses?/iu.test(action)
  ) {
    issues.push('屏幕运动方向发生反转，但镜头没有建立转向动作。');
  }
  return issues;
};

export const buildContinuityLedger = (
  shots: Shot[],
  scriptData: ScriptData,
): ShotContinuityLedgerEntry[] => {
  let previous = blankState();
  return shots.map((shot) => {
    const stateIn = clone(previous);
    const stateOut = clone(previous);
    const scene = scriptData.scenes.find((item) => String(item.id) === String(shot.sceneId));
    const sceneText = clean([scene?.time, scene?.atmosphere].filter(Boolean).join(' '));
    stateOut.scene = {
      sceneId: String(shot.sceneId),
      time: clean(scene?.time),
      weather: inferWeather(sceneText),
      lighting: inferLighting(sceneText),
      screenDirection: inferDirection(shot.agent?.continuity.screenDirection || shot.cameraMovement),
    };

    Object.values(stateOut.characters).forEach((state) => { state.visible = false; });
    (shot.characters || []).forEach((characterId) => {
      const id = String(characterId);
      const character = scriptData.characters.find((item) => String(item.id) === id);
      const variationId = shot.characterVariations?.[characterId];
      const variation = variationId
        ? character?.variations.find((item) => String(item.id) === String(variationId))
        : undefined;
      const heldPropIds = (shot.props || []).filter((propId) => shot.propUsages?.[String(propId)]?.actorId === id);
      const next: ContinuityCharacterState = {
        location: String(shot.sceneId),
        wardrobe: clean(variation?.wardrobe || character?.wardrobe || character?.visualPrompt),
        heldPropIds: heldPropIds.map(String),
        physicalState: inferPhysicalState(shot),
        emotionalState: clean(shot.agent?.emotionalBeat),
        knowledge: stateOut.characters[id]?.knowledge || [],
        visible: true,
      };
      stateOut.characters[id] = next;
    });

    Object.values(stateOut.props).forEach((state) => { state.visible = false; });
    (shot.props || []).forEach((propId) => {
      const id = String(propId);
      const prop = scriptData.props?.find((item) => String(item.id) === id);
      const usage = shot.propUsages?.[id];
      const mode = inferPropMode(shot, id, prop?.presentationMode);
      const next: ContinuityPropState = {
        location: clean(usage?.position) || String(shot.sceneId),
        holderCharacterId: usage?.actorId || (mode === 'handheld' || mode === 'worn' ? shot.characters?.[0] : undefined),
        presentationMode: mode,
        condition: clean(usage?.action) || stateOut.props[id]?.condition || 'stable',
        visible: true,
      };
      stateOut.props[id] = next;
    });

    const entry: ShotContinuityLedgerEntry = {
      shotId: String(shot.id),
      stateIn,
      stateDelta: diffState(stateIn, stateOut),
      stateOut,
      issues: detectIssues(shot, stateIn, stateOut),
      generatedAt: Date.now(),
    };
    previous = stateOut;
    return entry;
  });
};

export const applyContinuityLedgerToShots = (
  shots: Shot[],
  scriptData: ScriptData,
): { shots: Shot[]; ledger: ShotContinuityLedgerEntry[] } => {
  const ledger = buildContinuityLedger(shots, scriptData);
  const byShot = new Map(ledger.map((entry) => [String(entry.shotId), entry]));
  return {
    ledger,
    shots: shots.map((shot) => ({
      ...shot,
      agent: shot.agent
        ? { ...shot.agent, continuityLedger: byShot.get(String(shot.id)) }
        : shot.agent,
    })),
  };
};

export const formatContinuityLedgerForPrompt = (entry?: ShotContinuityLedgerEntry): string => {
  if (!entry) return '';
  const visibleCharacters = Object.entries(entry.stateOut.characters)
    .filter(([, state]) => state.visible)
    .map(([id, state]) => `${id}: wardrobe=${state.wardrobe || 'unchanged'}, held=${state.heldPropIds.join(',') || 'none'}, state=${state.physicalState || 'stable'}`);
  const visibleProps = Object.entries(entry.stateOut.props)
    .filter(([, state]) => state.visible)
    .map(([id, state]) => `${id}: mode=${state.presentationMode}, location=${state.location}, holder=${state.holderCharacterId || 'none'}`);
  return [
    `Scene state: ${entry.stateOut.scene.sceneId}; time=${entry.stateOut.scene.time || 'unchanged'}; weather=${entry.stateOut.scene.weather || 'unchanged'}; lighting=${entry.stateOut.scene.lighting || 'unchanged'}; screen direction=${entry.stateOut.scene.screenDirection}.`,
    visibleCharacters.length ? `Character state: ${visibleCharacters.join('; ')}.` : '',
    visibleProps.length ? `Prop state: ${visibleProps.join('; ')}.` : '',
  ].filter(Boolean).join(' ');
};
