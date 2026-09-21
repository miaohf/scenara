import type { ProductionBible, ScriptData } from '../types';

export const PRODUCTION_BIBLE_VERSION = 1;

const clean = (value?: string): string => String(value || '').trim();

const joinLines = (lines: Array<string | undefined>): string =>
  lines.map(clean).filter(Boolean).join('\n');

const LEGACY_GARMENT_PATTERN = /\b(raincoat|coat|jacket|shirt|sweater|hoodie|trousers|pants|dress|skirt|scarf|boots|shoes|sneakers|hat|helmet)\b|雨衣|外套|上衣|毛衣|裤|裙|围巾|靴|鞋|帽|头盔/i;
const LEGACY_WEARING_CONTEXT = /\b(worn|wearing|wears|wardrobe|costume|attire|outfit)\b|穿着|身穿|佩戴|服装|造型/i;

const inferLegacyWardrobe = (scriptData: ScriptData, characterName: string): string => {
  const normalizedName = clean(characterName).toLowerCase();
  if (!normalizedName) return '';
  return (scriptData.props || [])
    .filter((prop) => {
      if (!LEGACY_GARMENT_PATTERN.test(`${prop.name || ''} ${prop.category || ''}`)) return false;
      const detail = `${prop.description || ''} ${prop.visualPrompt || ''}`.toLowerCase();
      return detail.includes(`${normalizedName}'s`)
        || detail.includes(`${normalizedName}’s`)
        || detail.includes(`${normalizedName}的`)
        || (detail.includes(normalizedName) && LEGACY_WEARING_CONTEXT.test(detail));
    })
    .map((prop) => clean(prop.name))
    .filter(Boolean)
    .join(', ');
};

export const deriveProductionBible = (scriptData?: ScriptData | null): ProductionBible => {
  const characters = scriptData?.characters || [];
  const scenes = scriptData?.scenes || [];
  const artDirection = scriptData?.artDirection;

  const costumeRules = joinLines(characters.map((character) => {
    const base = clean(character.wardrobe) || (scriptData ? inferLegacyWardrobe(scriptData, character.name) : '');
    const variations = (character.variations || [])
      .map((variation) => {
        const wardrobe = clean(variation.wardrobe || variation.visualPrompt);
        if (!wardrobe) return undefined;
        const sceneScope = variation.sceneIds?.length
          ? ` [scenes: ${variation.sceneIds.join(', ')}]`
          : '';
        return `  - ${variation.name}${sceneScope}: ${wardrobe}`;
      })
      .filter(Boolean)
      .join('\n');
    if (!base && !variations) return undefined;
    return `- ${character.name} base wardrobe: ${base || '[not locked]'}${variations ? `\n${variations}` : ''}`;
  }));

  const sceneAnchors = joinLines(scenes.map((scene) => {
    const details = [scene.location, scene.time, scene.atmosphere].map(clean).filter(Boolean);
    const direction = scene.creativeDirection;
    const creativeDetails = direction
      ? ` | purpose: ${clean(direction.narrativePurpose)} | continuity: ${clean(direction.continuityIn)} -> ${clean(direction.continuityOut)}`
      : '';
    return details.length ? `- ${scene.id}: ${details.join(' | ')}${creativeDetails}` : undefined;
  }));

  return {
    version: PRODUCTION_BIBLE_VERSION,
    historicalContext: clean(scriptData?.historicalContext),
    worldRules: joinLines([
      scriptData?.genre ? `Genre: ${scriptData.genre}` : undefined,
      scriptData?.logline ? `Story premise: ${scriptData.logline}` : undefined,
      scriptData?.creativeDevelopment?.centralConflict
        ? `Central conflict: ${scriptData.creativeDevelopment.centralConflict}`
        : undefined,
      scriptData?.creativeDevelopment?.payoff
        ? `Required payoff: ${scriptData.creativeDevelopment.payoff}`
        : undefined,
      'Preserve established story facts. Do not invent identity, costume, location, or continuity changes.',
    ]),
    costumeRules: costumeRules || 'Use each character base wardrobe unless the shot explicitly selects a valid costume variation.',
    sceneAnchors: sceneAnchors || 'Preserve the location, time, atmosphere, and spatial layout established for each scene.',
    characterVoiceRules: joinLines(characters.map((character) => {
      const base = clean(character.personality);
      const performance = clean(character.creativeDirection?.performanceNotes);
      return base || performance
        ? `- ${character.name}: ${[base, performance].filter(Boolean).join(' | performance: ')}`
        : undefined;
    })) || 'Keep dialogue and behavior consistent with each established character.',
    cameraLanguage: 'Use motivated cinematic coverage, readable screen direction, and continuity-safe camera changes. Do not change costume or location merely to improve composition.',
    platformGuardrails: 'No subtitles, captions, logos, watermarks, contact sheets, duplicated subjects, or reference-sheet layouts in final cinematic frames unless explicitly requested.',
    pinnedDecisions: artDirection?.consistencyAnchors
      ? [`Visual style anchor: ${artDirection.consistencyAnchors}`]
      : [],
  };
};

export const resolveProductionBible = (scriptData?: ScriptData | null): ProductionBible => {
  const derived = deriveProductionBible(scriptData);
  const stored = scriptData?.productionBible;
  if (!stored) return derived;
  return {
    ...derived,
    ...stored,
    version: stored.version || PRODUCTION_BIBLE_VERSION,
    historicalContext: clean(stored.historicalContext) || derived.historicalContext,
    pinnedDecisions: Array.isArray(stored.pinnedDecisions)
      ? stored.pinnedDecisions.map(clean).filter(Boolean)
      : derived.pinnedDecisions,
  };
};

export const formatProductionBibleForPrompt = (scriptData?: ScriptData | null): string => {
  if (!scriptData) return '';
  const bible = resolveProductionBible(scriptData);
  return `[PRODUCTION BIBLE — FACTS OVERRIDE STYLE SUGGESTIONS]
World rules:
${bible.worldRules}

Historical context:
${bible.historicalContext || 'No historical period is locked. Do not invent a specific period.'}

Costume rules:
${bible.costumeRules}

Scene anchors:
${bible.sceneAnchors}

Character voice rules:
${bible.characterVoiceRules}

Camera language:
${bible.cameraLanguage}

Platform guardrails:
${bible.platformGuardrails}
${bible.pinnedDecisions.length ? `\nPinned decisions:\n${bible.pinnedDecisions.map((item) => `- ${item}`).join('\n')}` : ''}`;
};
