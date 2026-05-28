import {
  Character,
  EpisodeCharacterRef,
  EpisodeSceneRef,
  EpisodePropRef,
  Episode,
  SeriesProject,
} from '../types';

export interface SyncCheckResult<TRef> {
  outdatedRefs: TRef[];
  missingInLibrary: TRef[];
}

function upsertByKey<T>(items: T[], key: string, getKey: (item: T) => string, nextItem: T): T[] {
  let found = false;
  const updated = items.map(item => {
    if (getKey(item) !== key) return item;
    found = true;
    return nextItem;
  });
  return found ? updated : [...updated, nextItem];
}

export function checkCharacterSync(
  episode: Episode,
  project: SeriesProject
): SyncCheckResult<EpisodeCharacterRef> {
  const outdatedRefs: EpisodeCharacterRef[] = [];
  const missingInLibrary: EpisodeCharacterRef[] = [];

  for (const ref of episode.characterRefs || []) {
    if (ref.syncStatus === 'local-only') continue;

    const libChar = project.characterLibrary.find(c => c.id === ref.characterId);
    if (!libChar) {
      missingInLibrary.push(ref);
      continue;
    }

    const libVersion = libChar.version || 1;
    if (libVersion > ref.syncedVersion) {
      outdatedRefs.push(ref);
    }
  }

  return { outdatedRefs, missingInLibrary };
}

export function checkSceneSync(
  episode: Episode,
  project: SeriesProject
): SyncCheckResult<EpisodeSceneRef> {
  const outdatedRefs: EpisodeSceneRef[] = [];
  const missingInLibrary: EpisodeSceneRef[] = [];

  for (const ref of episode.sceneRefs || []) {
    if (ref.syncStatus === 'local-only') continue;

    const libScene = project.sceneLibrary.find(s => s.id === ref.sceneId);
    if (!libScene) {
      missingInLibrary.push(ref);
      continue;
    }

    const libVersion = libScene.version || 1;
    if (libVersion > ref.syncedVersion) {
      outdatedRefs.push(ref);
    }
  }

  return { outdatedRefs, missingInLibrary };
}

export function checkPropSync(
  episode: Episode,
  project: SeriesProject
): SyncCheckResult<EpisodePropRef> {
  const outdatedRefs: EpisodePropRef[] = [];
  const missingInLibrary: EpisodePropRef[] = [];

  for (const ref of episode.propRefs || []) {
    if (ref.syncStatus === 'local-only') continue;

    const libProp = project.propLibrary.find(p => p.id === ref.propId);
    if (!libProp) {
      missingInLibrary.push(ref);
      continue;
    }

    const libVersion = libProp.version || 1;
    if (libVersion > ref.syncedVersion) {
      outdatedRefs.push(ref);
    }
  }

  return { outdatedRefs, missingInLibrary };
}

export function syncCharacter(
  episode: Episode,
  project: SeriesProject,
  characterId: string
): Episode {
  const libChar = project.characterLibrary.find(c => c.id === characterId);
  if (!libChar || !episode.scriptData) return episode;

  const libVersion = libChar.version || 1;

  const newCharacters = episode.scriptData.characters.map(c => {
    if (c.libraryId !== characterId) return c;
    return {
      ...libChar,
      id: c.id,
      libraryId: characterId,
      libraryVersion: libVersion,
      variations: c.variations,
    };
  });

  const nextRef: EpisodeCharacterRef = {
    characterId,
    syncedVersion: libVersion,
    syncStatus: 'synced',
  };

  const newRefs = upsertByKey(
    episode.characterRefs || [],
    characterId,
    r => r.characterId,
    nextRef
  );

  return {
    ...episode,
    scriptData: { ...episode.scriptData, characters: newCharacters },
    characterRefs: newRefs,
  };
}

export function syncScene(
  episode: Episode,
  project: SeriesProject,
  sceneId: string
): Episode {
  const libScene = project.sceneLibrary.find(s => s.id === sceneId);
  if (!libScene || !episode.scriptData) return episode;

  const libVersion = libScene.version || 1;
  const newScenes = episode.scriptData.scenes.map(s => {
    if (s.libraryId !== sceneId) return s;
    return {
      ...libScene,
      id: s.id,
      libraryId: sceneId,
      libraryVersion: libVersion,
    };
  });

  const nextRef: EpisodeSceneRef = {
    sceneId,
    syncedVersion: libVersion,
    syncStatus: 'synced',
  };

  const newRefs = upsertByKey(
    episode.sceneRefs || [],
    sceneId,
    r => r.sceneId,
    nextRef
  );

  return {
    ...episode,
    scriptData: { ...episode.scriptData, scenes: newScenes },
    sceneRefs: newRefs,
  };
}

export function syncProp(
  episode: Episode,
  project: SeriesProject,
  propId: string
): Episode {
  const libProp = project.propLibrary.find(p => p.id === propId);
  if (!libProp || !episode.scriptData) return episode;

  const libVersion = libProp.version || 1;
  const newProps = (episode.scriptData.props || []).map(p => {
    if (p.libraryId !== propId) return p;
    return {
      ...libProp,
      id: p.id,
      libraryId: propId,
      libraryVersion: libVersion,
    };
  });

  const nextRef: EpisodePropRef = {
    propId,
    syncedVersion: libVersion,
    syncStatus: 'synced',
  };

  const newRefs = upsertByKey(
    episode.propRefs || [],
    propId,
    r => r.propId,
    nextRef
  );

  return {
    ...episode,
    scriptData: { ...episode.scriptData, props: newProps },
    propRefs: newRefs,
  };
}

export function syncAllCharacters(
  episode: Episode,
  project: SeriesProject
): Episode {
  const { outdatedRefs } = checkCharacterSync(episode, project);
  let updated = episode;
  for (const ref of outdatedRefs) {
    updated = syncCharacter(updated, project, ref.characterId);
  }
  return updated;
}

export function syncAllScenes(
  episode: Episode,
  project: SeriesProject
): Episode {
  const { outdatedRefs } = checkSceneSync(episode, project);
  let updated = episode;
  for (const ref of outdatedRefs) {
    updated = syncScene(updated, project, ref.sceneId);
  }
  return updated;
}

export function syncAllProps(
  episode: Episode,
  project: SeriesProject
): Episode {
  const { outdatedRefs } = checkPropSync(episode, project);
  let updated = episode;
  for (const ref of outdatedRefs) {
    updated = syncProp(updated, project, ref.propId);
  }
  return updated;
}

export function promoteCharacterToLibrary(
  character: Character,
  project: SeriesProject
): { updatedProject: SeriesProject; libraryCharacterId: string } {
  const existing = project.characterLibrary.find(c => c.id === character.libraryId);

  if (existing) {
    const updatedLibrary = project.characterLibrary.map(c =>
      c.id === existing.id ? { ...character, id: existing.id, version: (existing.version || 0) + 1, libraryId: undefined, libraryVersion: undefined } : c
    );
    return {
      updatedProject: { ...project, characterLibrary: updatedLibrary, lastModified: Date.now() },
      libraryCharacterId: existing.id,
    };
  }

  const libChar: Character = {
    ...character,
    libraryId: undefined,
    libraryVersion: undefined,
    version: 1,
  };
  return {
    updatedProject: { ...project, characterLibrary: [...project.characterLibrary, libChar], lastModified: Date.now() },
    libraryCharacterId: libChar.id,
  };
}
