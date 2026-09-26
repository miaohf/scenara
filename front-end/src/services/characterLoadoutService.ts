import type { ScriptData, Shot } from '../types';

/**
 * Resolves a character's valid default equipment against the current project.
 * The result is deliberately materialized into a shot, so editors can remove
 * an item for one shot without a later prompt build silently putting it back.
 */
export const getCharacterDefaultPropIds = (
  characterId: string,
  scriptData?: ScriptData | null,
): string[] => {
  if (!scriptData) return [];
  const character = (scriptData.characters || []).find(item => String(item.id) === String(characterId));
  if (!character) return [];
  const validIds = new Set((scriptData.props || []).map(item => String(item.id)));
  return Array.from(new Set((character.defaultPropIds || [])
    .map(id => String(id))
    .filter(id => validIds.has(id))));
};

export const getDefaultPropIdsForCharacters = (
  characterIds: string[] | undefined,
  scriptData?: ScriptData | null,
): string[] => Array.from(new Set((characterIds || []).flatMap(id => getCharacterDefaultPropIds(id, scriptData))));

export const addDefaultEquipmentToShot = (
  shot: Shot,
  scriptData?: ScriptData | null,
): Shot => ({
  ...shot,
  props: Array.from(new Set([
    ...(shot.props || []).map(id => String(id)),
    ...getDefaultPropIdsForCharacters(shot.characters, scriptData),
  ])),
});
