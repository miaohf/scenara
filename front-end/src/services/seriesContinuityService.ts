import type {
  Episode,
  ScriptData,
  SeriesContinuityContext,
  SeriesContinuityThread,
  ShotContinuityState,
} from '../types';

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const latestState = (episode: Episode): ShotContinuityState | undefined => {
  const scriptData = episode.scriptData;
  if (!scriptData) return undefined;
  const ledger = scriptData.continuityLedger;
  if (ledger?.length) return clone(ledger[ledger.length - 1].stateOut);
  return scriptData.seriesContinuity?.outgoingState
    ? clone(scriptData.seriesContinuity.outgoingState)
    : undefined;
};

const mergeOpenThreads = (episodes: Episode[]): SeriesContinuityThread[] => {
  const threads = new Map<string, SeriesContinuityThread>();
  episodes.forEach((episode) => {
    (episode.scriptData?.seriesContinuity?.openThreads || []).forEach((thread) => {
      const key = String(thread.id || thread.label);
      threads.set(key, { ...thread, sourceEpisodeId: thread.sourceEpisodeId || episode.id });
    });
  });
  return Array.from(threads.values()).filter((thread) => thread.status === 'open');
};

/** Builds only evidence-backed handoff data from earlier episodes in the same series. */
export const buildIncomingSeriesContinuity = (
  currentEpisode: Pick<Episode, 'id' | 'episodeNumber'>,
  priorEpisodes: Episode[],
): SeriesContinuityContext | undefined => {
  const ordered = priorEpisodes
    .filter((episode) => episode.id !== currentEpisode.id && episode.episodeNumber < currentEpisode.episodeNumber)
    .sort((a, b) => a.episodeNumber - b.episodeNumber);
  const latest = ordered[ordered.length - 1];
  if (!latest) return undefined;
  const incomingState = latestState(latest);
  const openThreads = mergeOpenThreads(ordered);
  if (!incomingState && openThreads.length === 0) return undefined;
  return {
    sourceEpisodeId: latest.id,
    sourceEpisodeNumber: latest.episodeNumber,
    incomingState,
    openThreads,
    updatedAt: Date.now(),
  };
};

export const applyIncomingSeriesContinuity = (
  scriptData: ScriptData,
  incoming?: SeriesContinuityContext,
): ScriptData => {
  if (!incoming) return scriptData;
  return {
    ...scriptData,
    seriesContinuity: {
      ...incoming,
      incomingState: incoming.incomingState ? clone(incoming.incomingState) : undefined,
      openThreads: incoming.openThreads.map(clone),
      updatedAt: Date.now(),
    },
  };
};

/** Writes the episode's confirmed final state without changing user-authored open-thread state. */
export const updateOutgoingSeriesContinuity = (
  scriptData: ScriptData,
): ScriptData => {
  const ledger = scriptData.continuityLedger || [];
  const outgoingState = ledger.length ? clone(ledger[ledger.length - 1].stateOut) : undefined;
  if (!outgoingState && !scriptData.seriesContinuity) return scriptData;
  return {
    ...scriptData,
    continuityLedger: ledger.length ? ledger : scriptData.continuityLedger,
    seriesContinuity: {
      ...(scriptData.seriesContinuity || { openThreads: [], updatedAt: Date.now() }),
      outgoingState,
      openThreads: (scriptData.seriesContinuity?.openThreads || []).map(clone),
      updatedAt: Date.now(),
    },
  };
};

export const formatSeriesContinuityForPrompt = (context?: SeriesContinuityContext): string => {
  if (!context) return '';
  const state = context.incomingState;
  const characters = Object.entries(state?.characters || {})
    .filter(([, value]) => value.visible)
    .map(([id, value]) => `${id}: location=${value.location || 'unknown'}, wardrobe=${value.wardrobe || 'unchanged'}, held=${value.heldPropIds.join(',') || 'none'}`);
  const props = Object.entries(state?.props || {})
    .filter(([, value]) => value.visible)
    .map(([id, value]) => `${id}: location=${value.location || 'unknown'}, holder=${value.holderCharacterId || 'none'}, mode=${value.presentationMode}`);
  const threads = context.openThreads
    .filter((thread) => thread.status === 'open')
    .map((thread) => `${thread.label}${thread.note ? ` (${thread.note})` : ''}`);
  return [
    context.sourceEpisodeNumber ? `Previous episode: ${context.sourceEpisodeNumber}.` : '',
    characters.length ? `Inherited characters: ${characters.join('; ')}.` : '',
    props.length ? `Inherited props: ${props.join('; ')}.` : '',
    threads.length ? `Unresolved threads: ${threads.join('; ')}.` : '',
    'Treat this as locked continuity. Do not resolve or re-establish an open thread unless the current script explicitly does so.',
  ].filter(Boolean).join(' ');
};
