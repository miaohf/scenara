import type { VisualStyleProfile } from '../types';
import { VISUAL_STYLE_OPTIONS } from '../components/StageScript/constants';
import {
  getNegativePrompt,
  getStylePrompt,
  getStylePromptCN,
} from './ai/promptConstants';

export const getBuiltinStyleProfile = (styleKey: string): VisualStyleProfile | null => {
  const option = VISUAL_STYLE_OPTIONS.find((item) => item.value === styleKey);
  if (!option || styleKey === 'custom') return null;
  const now = 0;
  return {
    id: `preset:${styleKey}`,
    styleKey,
    label: option.label.replace(/^\S+\s*/, ''),
    description: option.desc,
    positivePrompt: getStylePrompt(styleKey),
    negativePrompt: getNegativePrompt(styleKey),
    source: 'preset-override',
    createdAt: now,
    updatedAt: now,
  };
};

export const resolveVisualStyleProfile = (
  styleKey: string,
  profiles: VisualStyleProfile[] = [],
  customPrompt = '',
): VisualStyleProfile => {
  const override = profiles.find((profile) => profile.styleKey === styleKey && !profile.deleted);
  if (override) return override;
  if (styleKey === 'custom') {
    const now = 0;
    return {
      id: 'custom:draft',
      label: '自定义风格',
      positivePrompt: customPrompt.trim() || 'cinematic visual style',
      negativePrompt: getNegativePrompt('3d-animation'),
      source: 'custom',
      createdAt: now,
      updatedAt: now,
    };
  }
  return getBuiltinStyleProfile(styleKey) || {
    id: `preset:${styleKey}`,
    styleKey,
    label: styleKey,
    positivePrompt: getStylePrompt(styleKey),
    negativePrompt: getNegativePrompt(styleKey),
    source: 'preset-override',
    createdAt: 0,
    updatedAt: 0,
  };
};

export const getStylePreviewPrompt = (profile: VisualStyleProfile): string =>
  `Create one representative visual style sample image, no text, no captions, no logos, no collage, no split screen. Use one clear human subject or simple focal subject so the rendering style is easy to compare with the existing preview image. Keep the composition neutral and let the style definition control the rendering, color, material, lighting, and texture treatment. Style definition: ${profile.positivePrompt}.`;

export const getStyleDisplayLabel = (styleKey: string): string =>
  getBuiltinStyleProfile(styleKey)?.label || getStylePromptCN(styleKey) || styleKey;
