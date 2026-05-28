import { Scene } from '../types';

const SCENE_NUMERIC_PATTERN = /^scene[-_]?0*(\d+)$/i;
const CANONICAL_SHOT_PATTERN = /^shot-(\d+)(?:-(\d+))?$/i;
const SCENE_SCOPED_SHOT_PATTERN = /^scene[-_]?0*(\d+)[-_]shot[-_]?(\d+)(?:[-_](\d+))?$/i;

const trimId = (value: string): string => String(value || '').trim();

export const normalizeSceneId = (value: string): string => {
  const raw = trimId(value);
  if (!raw) return '';

  const numericMatch = raw.match(SCENE_NUMERIC_PATTERN);
  if (numericMatch) {
    return `scene-${Number(numericMatch[1])}`;
  }

  return raw
    .toLowerCase()
    .replace(/[_\s]+/g, '-')
    .trim();
};

export const sceneIdsMatch = (left: string, right: string): boolean => {
  const rawLeft = trimId(left);
  const rawRight = trimId(right);
  if (!rawLeft || !rawRight) return false;
  return rawLeft === rawRight || normalizeSceneId(rawLeft) === normalizeSceneId(rawRight);
};

export const findSceneByIdCompat = <T extends Pick<Scene, 'id'>>(
  scenes: T[] | undefined | null,
  sceneId?: string
): T | undefined => {
  const targetId = trimId(sceneId || '');
  if (!targetId || !Array.isArray(scenes)) return undefined;
  return (
    scenes.find((scene) => trimId(scene.id) === targetId) ||
    scenes.find((scene) => sceneIdsMatch(scene.id, targetId))
  );
};

export const resolveSceneIdCompat = <T extends Pick<Scene, 'id'>>(
  sceneId: string,
  scenes: T[] | undefined | null
): string => findSceneByIdCompat(scenes, sceneId)?.id || trimId(sceneId);

export const filterBySceneIdCompat = <T extends { sceneId: string }>(
  items: T[] | undefined | null,
  sceneId: string
): T[] => {
  if (!Array.isArray(items)) return [];
  return items.filter((item) => sceneIdsMatch(item.sceneId, sceneId));
};

export const reconcileShotSceneIds = <T extends { sceneId: string }>(
  shots: T[] | undefined | null,
  scenes: Array<Pick<Scene, 'id'>> | undefined | null
): T[] => {
  if (!Array.isArray(shots)) return [];

  return shots.map((shot) => {
    const resolvedSceneId = resolveSceneIdCompat(shot.sceneId, scenes);
    if (resolvedSceneId === trimId(shot.sceneId)) {
      return shot;
    }
    return {
      ...shot,
      sceneId: resolvedSceneId,
    };
  });
};

export type ParsedShotId =
  | { mode: 'canonical'; mainIndex: number; subIndex?: number }
  | { mode: 'scene-scoped'; sceneIndex: number; shotIndex: number; subIndex?: number }
  | { mode: 'unknown' };

export const parseShotId = (value: string): ParsedShotId => {
  const shotId = trimId(value);
  if (!shotId) return { mode: 'unknown' };

  const canonicalMatch = shotId.match(CANONICAL_SHOT_PATTERN);
  if (canonicalMatch) {
    const mainIndex = Number(canonicalMatch[1]);
    const subIndex = canonicalMatch[2] ? Number(canonicalMatch[2]) : undefined;
    return { mode: 'canonical', mainIndex, subIndex };
  }

  const sceneScopedMatch = shotId.match(SCENE_SCOPED_SHOT_PATTERN);
  if (sceneScopedMatch) {
    const sceneIndex = Number(sceneScopedMatch[1]);
    const shotIndex = Number(sceneScopedMatch[2]);
    const subIndex = sceneScopedMatch[3] ? Number(sceneScopedMatch[3]) : undefined;
    return { mode: 'scene-scoped', sceneIndex, shotIndex, subIndex };
  }

  return { mode: 'unknown' };
};

const padShotNumber = (value: number): string => String(value).padStart(3, '0');

export const getShotDisplayKey = (shotId: string, fallbackIndex: number): string => {
  const parsed = parseShotId(shotId);

  if (parsed.mode === 'canonical') {
    return parsed.subIndex === undefined
      ? padShotNumber(parsed.mainIndex)
      : `${padShotNumber(parsed.mainIndex)}-${parsed.subIndex}`;
  }

  if (parsed.mode === 'scene-scoped') {
    const base = `${padShotNumber(parsed.sceneIndex)}-${parsed.shotIndex}`;
    return parsed.subIndex === undefined ? base : `${base}-${parsed.subIndex}`;
  }

  return padShotNumber(fallbackIndex + 1);
};

export const getShotDisplayLabel = (shotId: string, fallbackIndex: number): string =>
  `SHOT ${getShotDisplayKey(shotId, fallbackIndex)}`;

export const getNextMainShotId = (shotIds: string[]): string => {
  const maxIndex = shotIds.reduce((max, shotId) => {
    const parsed = parseShotId(shotId);
    if (parsed.mode === 'canonical') {
      return Math.max(max, parsed.mainIndex);
    }
    if (parsed.mode === 'scene-scoped') {
      return Math.max(max, parsed.sceneIndex);
    }
    return max;
  }, 0);

  return `shot-${maxIndex + 1}`;
};

export const getNextSubShotId = (anchorShotId: string, shotIds: string[]): string | null => {
  const anchor = parseShotId(anchorShotId);

  if (anchor.mode === 'canonical') {
    const maxSubIndex = shotIds.reduce((max, currentShotId) => {
      const parsed = parseShotId(currentShotId);
      if (parsed.mode !== 'canonical' || parsed.mainIndex !== anchor.mainIndex || parsed.subIndex === undefined) {
        return max;
      }
      return Math.max(max, parsed.subIndex);
    }, 0);

    return `shot-${anchor.mainIndex}-${maxSubIndex + 1}`;
  }

  if (anchor.mode === 'scene-scoped') {
    const maxSubIndex = shotIds.reduce((max, currentShotId) => {
      const parsed = parseShotId(currentShotId);
      if (
        parsed.mode !== 'scene-scoped' ||
        parsed.sceneIndex !== anchor.sceneIndex ||
        parsed.shotIndex !== anchor.shotIndex ||
        parsed.subIndex === undefined
      ) {
        return max;
      }
      return Math.max(max, parsed.subIndex);
    }, 0);

    return `scene-${anchor.sceneIndex}-shot-${anchor.shotIndex}-${maxSubIndex + 1}`;
  }

  return null;
};

export const getShotGroupPrefix = (shotId: string): string | null => {
  const parsed = parseShotId(shotId);

  if (parsed.mode === 'canonical') {
    return `shot-${parsed.mainIndex}`;
  }

  if (parsed.mode === 'scene-scoped') {
    return `scene-${parsed.sceneIndex}-shot-${parsed.shotIndex}`;
  }

  return null;
};

export const shotBelongsToGroup = (shotId: string, groupPrefix: string | null): boolean => {
  if (!groupPrefix) return false;
  const shot = parseShotId(shotId);
  const group = parseShotId(groupPrefix);

  if (shot.mode === 'canonical' && group.mode === 'canonical') {
    return shot.mainIndex === group.mainIndex;
  }

  if (shot.mode === 'scene-scoped' && group.mode === 'scene-scoped') {
    return shot.sceneIndex === group.sceneIndex && shot.shotIndex === group.shotIndex;
  }

  return shotId === groupPrefix || shotId.startsWith(`${groupPrefix}-`);
};
