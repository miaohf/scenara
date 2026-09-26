import type { AssetDNA, SceneSpatialTopology, ScriptData } from '../types';

const clean = (value?: string): string => String(value || '').replace(/\s+/g, ' ').trim();
const compact = (values: Array<string | undefined>): string[] => Array.from(new Set(values.map(clean).filter(Boolean)));

const fallbackDNA = (identity: string, material?: string, forbidden?: string[]): AssetDNA => ({
  identityAnchors: compact([identity]),
  materialAnchors: compact([material]),
  colorAnchors: [],
  forbiddenChanges: compact(forbidden || []),
});

const fallbackTopology = (location: string, atmosphere: string): SceneSpatialTopology => ({
  zones: [{ id: 'primary-zone', label: location || 'primary scene zone' }],
  entrances: [],
  exits: [],
  landmarks: [],
  dominantAxis: /河|溪|路|走廊|corridor|river|road/iu.test(`${location} ${atmosphere}`)
    ? 'Follow the established path/waterway axis; do not reverse without a visible turn.'
    : 'Axis not established; preserve the first readable screen direction.',
});

/** Backfills old projects without overwriting user- or Agent-authored asset facts. */
export const enrichScriptAssetIntelligence = (source: ScriptData): ScriptData => ({
  ...source,
  characters: source.characters.map((character) => ({
    ...character,
    assetDNA: character.assetDNA || fallbackDNA(
      clean(character.coreFeatures || `${character.name} ${character.species || ''} ${character.age || ''}`),
      character.wardrobe,
      ['identity, body plan, facial signature, and established wardrobe must not change without a scripted event'],
    ),
  })),
  scenes: source.scenes.map((scene) => ({
    ...scene,
    spatialTopology: scene.spatialTopology || fallbackTopology(scene.location, scene.atmosphere),
    assetDNA: scene.assetDNA || fallbackDNA(
      clean(`${scene.location} ${scene.time}`),
      scene.atmosphere,
      ['layout, landmark positions, lighting direction, and period materials must remain stable'],
    ),
  })),
  props: (source.props || []).map((prop) => ({
    ...prop,
    assetDNA: prop.assetDNA || fallbackDNA(
      clean(`${prop.name} ${prop.description}`),
      prop.description,
      ['shape, scale, material, color, and wear pattern must not change without a scripted event'],
    ),
  })),
});
