import { ScriptData, SeriesProject, Character, Scene, Prop, Shot, EpisodeCharacterRef, EpisodeSceneRef, EpisodePropRef } from '../types';

export interface AssetMatchItem<T> {
  aiAsset: T;
  libraryAsset: T | null;
  reuse: boolean;
}

export interface AssetMatchResult {
  characters: AssetMatchItem<Character>[];
  scenes: AssetMatchItem<Scene>[];
  props: AssetMatchItem<Prop>[];
  hasAnyMatch: boolean;
}

export interface ApplyResult {
  scriptData: ScriptData;
  shots: Shot[];
  characterRefs: EpisodeCharacterRef[];
  sceneRefs: EpisodeSceneRef[];
  propRefs: EpisodePropRef[];
}

function normalize(s: string): string {
  return String(s || '')
    .toLowerCase()
    .replace(/[()（）【】[\]{}'"`]/g, ' ')
    .replace(/[^\p{L}\p{N}\u4e00-\u9fff]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(s: string): string[] {
  const normalized = normalize(s);
  if (!normalized) return [];
  const segments = normalized.split(' ').filter(Boolean);
  const tokens = new Set<string>(segments);
  for (const segment of segments) {
    if (/^[\u4e00-\u9fff]+$/u.test(segment) && segment.length > 1) {
      for (let i = 0; i < segment.length - 1; i += 1) {
        tokens.add(segment.slice(i, i + 2));
      }
    }
  }
  return Array.from(tokens);
}

function jaccard(tokensA: string[], tokensB: string[]): number {
  if (tokensA.length === 0 || tokensB.length === 0) return 0;
  const setB = new Set(tokensB);
  let intersection = 0;
  for (const token of tokensA) {
    if (setB.has(token)) intersection += 1;
  }
  const union = new Set([...tokensA, ...tokensB]).size;
  return union === 0 ? 0 : intersection / union;
}

function diceByBigram(a: string, b: string): number {
  const s1 = normalize(a).replace(/\s+/g, '');
  const s2 = normalize(b).replace(/\s+/g, '');
  if (!s1 || !s2) return 0;
  if (s1 === s2) return 1;
  if (s1.length < 2 || s2.length < 2) return 0;

  const grams1 = new Map<string, number>();
  for (let i = 0; i < s1.length - 1; i += 1) {
    const gram = s1.slice(i, i + 2);
    grams1.set(gram, (grams1.get(gram) || 0) + 1);
  }

  let intersection = 0;
  for (let i = 0; i < s2.length - 1; i += 1) {
    const gram = s2.slice(i, i + 2);
    const count = grams1.get(gram) || 0;
    if (count > 0) {
      intersection += 1;
      grams1.set(gram, count - 1);
    }
  }
  return (2 * intersection) / ((s1.length - 1) + (s2.length - 1));
}

function nameSimilarity(a: string, b: string): number {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;

  const containsBoost = na.includes(nb) || nb.includes(na) ? 0.2 : 0;
  const tokenScore = jaccard(tokenize(na), tokenize(nb));
  const bigramScore = diceByBigram(na, nb);
  return Math.min(1, tokenScore * 0.55 + bigramScore * 0.45 + containsBoost);
}

function getAssetImage(asset: { referenceImage?: string } & Record<string, any>): string | undefined {
  // Backward compatibility: older data may keep preview image in imageUrl.
  return asset.referenceImage || asset.imageUrl;
}

function pickBestByName<T extends { version?: number; referenceImage?: string } & Record<string, any>>(
  items: T[],
  getName: (item: T) => string,
  targetName: string,
  options?: {
    minScore?: number;
    extraScore?: (item: T) => number;
  }
): T | null {
  const normalizedTarget = normalize(targetName);
  if (!normalizedTarget) return null;

  const minScore = options?.minScore ?? (
    normalizedTarget.length <= 2
      ? 0.95
      : normalizedTarget.length <= 4
        ? 0.72
        : 0.5
  );

  let best: T | null = null;
  let bestScore = 0;

  for (const item of items) {
    const baseScore = nameSimilarity(getName(item), targetName);
    const bonusImage = getAssetImage(item) ? 0.04 : 0;
    const bonusVersion = Math.min((item.version || 1), 10) * 0.004;
    const bonusPrompt = Math.min((item.visualPrompt || '').length, 240) / 6000;
    const extra = options?.extraScore ? options.extraScore(item) : 0;
    const totalScore = baseScore + bonusImage + bonusVersion + bonusPrompt + extra;

    if (baseScore >= minScore && totalScore > bestScore) {
      best = item;
      bestScore = totalScore;
    }
  }

  return best;
}

function pickBestCharacterMatch(aiChar: Character, library: Character[]): Character | null {
  return pickBestByName(library, lib => lib.name, aiChar.name, { minScore: 0.5 });
}

function pickBestSceneMatch(aiScene: Scene, library: Scene[]): Scene | null {
  const aiTime = normalize(aiScene.time || '');
  const aiAtmosphere = normalize(aiScene.atmosphere || '');
  return pickBestByName(
    library,
    lib => lib.location,
    aiScene.location,
    {
      minScore: 0.48,
      extraScore: (lib) => {
        let score = 0;
        if (aiTime && aiTime === normalize(lib.time || '')) score += 0.08;
        if (aiAtmosphere && aiAtmosphere === normalize(lib.atmosphere || '')) score += 0.06;
        return score;
      }
    }
  );
}

function pickBestPropMatch(aiProp: Prop, library: Prop[]): Prop | null {
  const aiCategory = normalize(aiProp.category || '');
  const aiDescription = String(aiProp.description || '');
  return pickBestByName(
    library,
    lib => lib.name,
    aiProp.name,
    {
      minScore: 0.45,
      extraScore: (lib) => {
        let score = 0;
        if (aiCategory && aiCategory === normalize(lib.category || '')) score += 0.08;
        if (aiDescription && lib.description) {
          score += Math.min(0.1, nameSimilarity(aiDescription, lib.description) * 0.15);
        }
        return score;
      }
    }
  );
}

export function findAssetMatches(scriptData: ScriptData, project: SeriesProject): AssetMatchResult {
  const characters: AssetMatchItem<Character>[] = scriptData.characters.map(aiChar => {
    const match = pickBestCharacterMatch(aiChar, project.characterLibrary);
    return { aiAsset: aiChar, libraryAsset: match || null, reuse: !!match };
  });

  const scenes: AssetMatchItem<Scene>[] = scriptData.scenes.map(aiScene => {
    const match = pickBestSceneMatch(aiScene, project.sceneLibrary);
    return { aiAsset: aiScene, libraryAsset: match || null, reuse: !!match };
  });

  const props: AssetMatchItem<Prop>[] = (scriptData.props || []).map(aiProp => {
    const match = pickBestPropMatch(aiProp, project.propLibrary);
    return { aiAsset: aiProp, libraryAsset: match || null, reuse: !!match };
  });

  const hasAnyMatch =
    characters.some(m => m.libraryAsset !== null) ||
    scenes.some(m => m.libraryAsset !== null) ||
    props.some(m => m.libraryAsset !== null);

  return { characters, scenes, props, hasAnyMatch };
}

export function applyAssetMatches(
  scriptData: ScriptData,
  shots: Shot[],
  matches: AssetMatchResult,
): ApplyResult {
  const charIdMap = new Map<string, string>();
  const sceneIdMap = new Map<string, string>();
  const propIdMap = new Map<string, string>();
  const characterRefs: EpisodeCharacterRef[] = [];
  const sceneRefs: EpisodeSceneRef[] = [];
  const propRefs: EpisodePropRef[] = [];

  const newCharacters = matches.characters.map(m => {
    if (m.reuse && m.libraryAsset) {
      const lib = m.libraryAsset;
      const aiId = m.aiAsset.id;
      const newId = 'char_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
      const libImage = getAssetImage(lib);
      charIdMap.set(aiId, newId);

      characterRefs.push({
        characterId: lib.id,
        syncedVersion: lib.version || 1,
        syncStatus: 'synced',
      });

      return {
        ...m.aiAsset,
        ...lib,
        id: newId,
        referenceImage: libImage || m.aiAsset.referenceImage,
        visualPrompt: lib.visualPrompt || m.aiAsset.visualPrompt,
        negativePrompt: lib.negativePrompt || m.aiAsset.negativePrompt,
        coreFeatures: lib.coreFeatures || m.aiAsset.coreFeatures,
        variations: (lib.variations || m.aiAsset.variations || []).map(v => ({ ...v })),
        turnaround: lib.turnaround ? { ...lib.turnaround } : m.aiAsset.turnaround,
        status: libImage ? ('completed' as const) : (lib.status || m.aiAsset.status),
        libraryId: lib.id,
        libraryVersion: lib.version || 1,
      };
    }
    return m.aiAsset;
  });

  const newScenes = matches.scenes.map(m => {
    if (m.reuse && m.libraryAsset) {
      const lib = m.libraryAsset;
      const aiId = m.aiAsset.id;
      const newId = 'scene_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
      const libImage = getAssetImage(lib);
      sceneIdMap.set(aiId, newId);
      sceneRefs.push({
        sceneId: lib.id,
        syncedVersion: lib.version || 1,
        syncStatus: 'synced',
      });

      return {
        ...m.aiAsset,
        ...lib,
        id: newId,
        referenceImage: libImage || m.aiAsset.referenceImage,
        visualPrompt: lib.visualPrompt || m.aiAsset.visualPrompt,
        negativePrompt: lib.negativePrompt || m.aiAsset.negativePrompt,
        status: libImage ? ('completed' as const) : (lib.status || m.aiAsset.status),
        libraryId: lib.id,
        libraryVersion: lib.version || 1,
      };
    }
    return m.aiAsset;
  });

  const newProps = matches.props.map(m => {
    if (m.reuse && m.libraryAsset) {
      const lib = m.libraryAsset;
      const aiId = m.aiAsset.id;
      const newId = 'prop_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
      const libImage = getAssetImage(lib);
      propIdMap.set(aiId, newId);
      propRefs.push({
        propId: lib.id,
        syncedVersion: lib.version || 1,
        syncStatus: 'synced',
      });

      return {
        ...m.aiAsset,
        ...lib,
        id: newId,
        referenceImage: libImage || m.aiAsset.referenceImage,
        visualPrompt: lib.visualPrompt || m.aiAsset.visualPrompt,
        negativePrompt: lib.negativePrompt || m.aiAsset.negativePrompt,
        status: libImage ? ('completed' as const) : (lib.status || m.aiAsset.status),
        libraryId: lib.id,
        libraryVersion: lib.version || 1,
      };
    }
    return m.aiAsset;
  });

  const remapId = (id: string, map: Map<string, string>) => map.get(id) || id;

  const newShots = shots.map(shot => {
    const newCharacters = shot.characters.map(cid => remapId(cid, charIdMap));
    const newSceneId = remapId(shot.sceneId, sceneIdMap);
    const newPropsArr = shot.props?.map(pid => remapId(pid, propIdMap));

    let newCharVariations = shot.characterVariations;
    if (newCharVariations) {
      const remapped: Record<string, string> = {};
      for (const [oldCid, varId] of Object.entries(newCharVariations)) {
        remapped[remapId(oldCid, charIdMap)] = varId;
      }
      newCharVariations = remapped;
    }

    return {
      ...shot,
      sceneId: newSceneId,
      characters: newCharacters,
      props: newPropsArr,
      characterVariations: newCharVariations,
    };
  });

  const newScriptData: ScriptData = {
    ...scriptData,
    characters: newCharacters,
    scenes: newScenes,
    props: newProps,
  };

  const dedupeBy = <T>(items: T[], getKey: (item: T) => string): T[] => {
    const map = new Map<string, T>();
    items.forEach(item => map.set(String(getKey(item)), item));
    return Array.from(map.values());
  };

  return {
    scriptData: newScriptData,
    shots: newShots,
    characterRefs: dedupeBy(characterRefs, r => r.characterId),
    sceneRefs: dedupeBy(sceneRefs, r => r.sceneId),
    propRefs: dedupeBy(propRefs, r => r.propId),
  };
}
