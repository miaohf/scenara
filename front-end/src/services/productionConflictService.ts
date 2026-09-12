import type { Character, Prop, ScriptData, Shot } from '../types';
import type { PromptLintIssue } from './promptLintService';
import { inferCharacterWardrobe } from './ai/promptConstants';

type InterfaceLanguage = 'zh' | 'en';
type GarmentGroup = 'outerwear' | 'top' | 'bottom' | 'neckwear' | 'footwear' | 'headwear';

const GARMENT_TERMS: Record<GarmentGroup, RegExp> = {
  outerwear: /\b(raincoat|coat|jacket|parka|blazer|overcoat)\b|雨衣|外套|夹克|大衣/i,
  top: /\b(shirt|sweater|hoodie|blouse|jersey|top|t-?shirt)\b|衬衫|毛衣|卫衣|上衣/i,
  bottom: /\b(trousers|pants|jeans|shorts|skirt)\b|长裤|裤子|牛仔裤|短裤|裙/i,
  neckwear: /\b(scarf|tie|necktie)\b|围巾|领带/i,
  footwear: /\b(boots|shoes|sneakers|sandals)\b|靴|鞋|凉鞋/i,
  headwear: /\b(hat|helmet|cap|beanie)\b|帽|头盔/i,
};

const COLOR_ALIASES: Record<string, RegExp> = {
  black: /\bblack|charcoal\b|黑|炭灰/i,
  white: /\bwhite|ivory|cream\b|白|象牙|米白/i,
  gray: /\bgr[ae]y|slate|silver\b|灰|银|石板/i,
  red: /\bred|crimson|scarlet|burgundy|coral\b|红|猩红|酒红|珊瑚/i,
  orange: /\borange|amber|terracotta\b|橙|琥珀|陶土/i,
  yellow: /\byellow|mustard|gold(?:en)?\b|黄|芥末|金/i,
  green: /\bgreen|olive|emerald\b|绿|橄榄|翠/i,
  teal: /\bteal|cyan|turquoise\b|青|蓝绿|孔雀蓝/i,
  blue: /\bblue|navy|azure\b|蓝|海军蓝/i,
  purple: /\bpurple|violet|lavender\b|紫|薰衣草/i,
  pink: /\bpink|magenta\b|粉|洋红/i,
  brown: /\bbrown|tan|khaki|umber|honey-brown\b|棕|褐|卡其/i,
};

const WEARING_CONTEXT = /\b(worn|wearing|wears|wardrobe|costume|attire|outfit)\b|穿着|身穿|佩戴|服装|造型/i;

const extractColors = (text: string): Set<string> => {
  const colors = new Set<string>();
  Object.entries(COLOR_ALIASES).forEach(([color, pattern]) => {
    if (pattern.test(text)) colors.add(color);
  });
  return colors;
};

const resolveGarmentGroup = (text: string): GarmentGroup | undefined =>
  (Object.keys(GARMENT_TERMS) as GarmentGroup[]).find((group) => GARMENT_TERMS[group].test(text));

const extractAttireText = (visualPrompt?: string): string => {
  const prompt = String(visualPrompt || '');
  const match = prompt.match(/(?:Attire|Clothing|Wardrobe)\s*:\s*([\s\S]*?)(?=\b(?:Pose|Framing|Background|Technical Quality)\s*:|$)/i);
  return (match?.[1] || prompt).trim();
};

const findGarmentClause = (text: string, group: GarmentGroup): string =>
  text.split(/[,;；，\n]+/).find((part) => GARMENT_TERMS[group].test(part)) || '';

const isLegacyWornProp = (prop: Prop, character: Character): boolean => {
  if (prop.isWearable) return true;
  const identity = `${prop.name || ''} ${prop.category || ''}`;
  if (!resolveGarmentGroup(identity)) return false;
  const detail = `${prop.description || ''} ${prop.visualPrompt || ''}`;
  if (WEARING_CONTEXT.test(detail)) return true;
  const name = String(character.name || '').trim().toLowerCase();
  const normalized = detail.toLowerCase();
  return !!name && (
    normalized.includes(`${name}'s`) ||
    normalized.includes(`${name}’s`) ||
    normalized.includes(`${name}的`)
  );
};

const intersects = (left: Set<string>, right: Set<string>): boolean =>
  [...left].some((value) => right.has(value));

export const inspectShotProductionConflicts = (
  shot: Shot,
  scriptData?: ScriptData | null,
  language: InterfaceLanguage = 'zh',
): PromptLintIssue[] => {
  if (!scriptData) return [];
  const issues: PromptLintIssue[] = [];
  const t = (zh: string, en: string) => language === 'zh' ? zh : en;

  (shot.characters || []).forEach((characterId) => {
    const character = scriptData.characters.find((item) => String(item.id) === String(characterId));
    if (!character) {
      issues.push({
        code: 'missing-character',
        severity: 'error',
        message: t(`镜头引用了不存在的角色：${characterId}`, `Shot references a missing character: ${characterId}`),
      });
      return;
    }

    const selectedVariationId = shot.characterVariations?.[characterId];
    const selectedVariation = selectedVariationId
      ? character.variations?.find((item) => String(item.id) === String(selectedVariationId))
      : undefined;
    if (selectedVariationId && !selectedVariation) {
      issues.push({
        code: 'invalid-costume-variation',
        severity: 'error',
        message: t(
          `${character.name} 选择了无效的服装变体 ${selectedVariationId}。`,
          `${character.name} uses an invalid wardrobe variation: ${selectedVariationId}.`,
        ),
        suggestion: t('重新选择基础造型或有效服装变体。', 'Select the base look or a valid wardrobe variation.'),
      });
      return;
    }
    if (selectedVariation && !selectedVariation.referenceImage) {
      issues.push({
        code: 'variation-without-reference',
        severity: 'warning',
        message: t(
          `${character.name} 的“${selectedVariation.name}”没有变体参考图，将使用基础身份图配合文字换装。`,
          `${character.name}'s “${selectedVariation.name}” has no variation reference; the base identity image and text wardrobe will be used.`,
        ),
      });
    }

    const canonicalWardrobe = String(
      selectedVariation?.wardrobe || selectedVariation?.visualPrompt || inferCharacterWardrobe(character, scriptData.props)
    ).trim();
    const legacyGarments = (scriptData.props || []).filter((prop) =>
      (shot.props || []).some((id) => String(id) === String(prop.id)) && isLegacyWornProp(prop, character)
    );
    const attireText = extractAttireText(character.visualPrompt);
    const expectedSources = [
      ...(canonicalWardrobe ? [canonicalWardrobe] : []),
      ...legacyGarments.map((prop) => `${prop.name} ${prop.description || ''}`),
    ];

    const checkedGroups = new Set<GarmentGroup>();
    expectedSources.forEach((expectedText) => {
      (Object.keys(GARMENT_TERMS) as GarmentGroup[])
        .filter((group) => GARMENT_TERMS[group].test(expectedText) && !checkedGroups.has(group))
        .forEach((group) => {
          checkedGroups.add(group);
          const expectedClause = findGarmentClause(expectedText, group) || expectedText;
          const actualClause = findGarmentClause(attireText, group);
          const expectedColors = extractColors(expectedClause);
          const actualColors = extractColors(actualClause);

          if (!actualClause) {
            issues.push({
              code: `missing-garment-${group}`,
              severity: 'warning',
              message: t(
                `${character.name} 的角色提示词缺少已锁定服装：${expectedClause.trim()}。`,
                `${character.name}'s character prompt is missing a locked garment: ${expectedClause.trim()}.`,
              ),
              suggestion: t('重新生成角色提示词或手动修正服装段落。', 'Regenerate the character prompt or correct its wardrobe section.'),
            });
          } else if (expectedColors.size > 0 && actualColors.size > 0 && !intersects(expectedColors, actualColors)) {
            issues.push({
              code: `wardrobe-color-conflict-${group}`,
              severity: 'error',
              message: t(
                `${character.name} 的服装颜色冲突：锁定“${expectedClause.trim()}”，角色提示词却写成“${actualClause.trim()}”。`,
                `${character.name} has a wardrobe color conflict: locked “${expectedClause.trim()}”, but the character prompt says “${actualClause.trim()}”.`,
              ),
              suggestion: t('以项目圣经/剧本服装为准，修正提示词并重新生成定妆。', 'Use the Production Bible wardrobe as truth, correct the prompt, and regenerate casting.'),
            });
          }
        });
    });

    legacyGarments.forEach((prop) => {
      issues.push({
        code: `legacy-wearable-prop-${prop.id}`,
        severity: 'info',
        message: t(
          `旧数据兼容：${prop.name} 已识别为 ${character.name} 的服装，不会占用独立道具参考槽位。`,
          `Legacy compatibility: ${prop.name} is treated as ${character.name}'s wardrobe and will not consume a prop-reference slot.`,
        ),
      });
    });
  });

  return issues;
};
