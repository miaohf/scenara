/**
 * 视觉资产生成服务
 * 包含美术指导文档生成、角色/场景视觉提示词生成、图像生成
 */

import {
  Character,
  Scene,
  Prop,
  AspectRatio,
  ArtDirection,
  CharacterTurnaroundPanel,
  CreativeCharacterDirection,
  CreativeSceneDirection,
} from "../../types";
import type { GenerationJobStatus, GenerationTarget, ImageModelParams } from "../../types/model";
import { addRenderLogWithTokens } from '../renderLogService';
import {
  retryOperation,
  chatCompletion,
  getActiveModel,
  getActiveChatModelName,
  resolveModel,
  logScriptProgress,
  parseJsonWithRecovery,
} from './apiCore';
import {
  getStylePrompt,
  getNegativePrompt,
  getSceneNegativePrompt,
  buildCharacterLookbookPromptRules,
  stripProjectPropsFromPrompt,
  normalizeCharacterWardrobeInPrompt,
  CHARACTER_ATTIRE_INSTRUCTION,
} from './promptConstants';
import { compressPromptWithLLM } from './promptCompressionService';
import { getImageApiFormat } from '../imageModelUtils';
import { callImageApi } from '../adapters/imageAdapter';

// ============================================
// 美术指导文档生成
// ============================================

/**
 * 生成全局美术指导文档（Art Direction Brief）
 * 在生成任何角色/场景提示词之前调用，为整个项目建立统一的视觉风格基准。
 */
export const generateArtDirection = async (
  title: string,
  genre: string,
  logline: string,
  characters: { name: string; gender: string; age: string; personality: string; species?: string; creativeDirection?: CreativeCharacterDirection }[],
  scenes: { location: string; time: string; atmosphere: string; creativeDirection?: CreativeSceneDirection }[],
  visualStyle: string,
  language: string = '中文',
  model: string = getActiveChatModelName(),
  abortSignal?: AbortSignal
): Promise<ArtDirection> => {
  console.log('🎨 generateArtDirection 调用 - 生成全局美术指导文档');
  logScriptProgress('正在生成全局美术指导文档（Art Direction）...');

  const stylePrompt = getStylePrompt(visualStyle);

  const prompt = `You are a world-class Art Director for ${visualStyle} productions. 
Your job is to create a unified Art Direction Brief that will guide ALL visual prompt generation for characters, scenes, and shots in a single project. This document ensures perfect visual consistency across every generated image.

## Project Info
- Title: ${title}
- Genre: ${genre}
- Logline: ${logline}
- Visual Style: ${visualStyle} (${stylePrompt})
- Language: ${language}

## Characters
${characters.map((c, i) => `${i + 1}. ${c.name} (${c.species || 'species unspecified'}, ${c.gender}, ${c.age}, ${c.personality})${c.creativeDirection ? `\n   Creative direction: ${JSON.stringify(c.creativeDirection)}` : ''}`).join('\n')}

## Scenes
${scenes.map((s, i) => `${i + 1}. ${s.location} - ${s.time} - ${s.atmosphere}${s.creativeDirection ? `\n   Creative direction: ${JSON.stringify(s.creativeDirection)}` : ''}`).join('\n')}

## Your Task
Create a comprehensive Art Direction Brief in JSON format. This brief will be injected into EVERY subsequent visual prompt to ensure all characters and scenes share a unified look and feel.

CRITICAL RULES:
- All descriptions must be specific, concrete, and actionable for image generation AI
- The brief must define a COHESIVE visual world - characters and scenes must look like they belong to the SAME production
- Color palette must be harmonious and genre-appropriate
- Character design rules must ensure all characters share the same art style while being visually distinct from each other
- Describe each character as given. Do not invent a different kind of being.
- Output all descriptive text in ${language}

Output ONLY valid JSON with this exact structure:
{
  "colorPalette": {
    "primary": "primary color tone description (e.g., 'deep navy blue with slight purple undertones')",
    "secondary": "secondary color description",
    "accent": "accent/highlight color",
    "skinTones": "surface tone range for characters in this style (skin, fur, or other covering as applicable)",
    "saturation": "overall saturation tendency (e.g., 'medium-high, slightly desaturated for cinematic feel')",
    "temperature": "overall color temperature (e.g., 'cool-leaning with warm accent lighting')"
  },
  "characterDesignRules": {
    "proportions": "body proportion style (e.g., '7.5 head-to-body ratio, athletic builds, realistic proportions' or '6 head ratio, stylized anime proportions')",
    "eyeStyle": "unified eye rendering approach (e.g., 'large expressive anime eyes with detailed iris reflections' or 'realistic eye proportions with cinematic catchlights')",
    "lineWeight": "line/edge style (e.g., 'clean sharp outlines with 2px weight' or 'soft edges with no visible outlines, photorealistic blending')",
    "detailLevel": "detail density (e.g., 'high detail on faces and hands, medium on clothing textures, stylized backgrounds')"
  },
  "lightingStyle": "unified lighting approach (e.g., 'three-point cinematic lighting with strong rim light, warm key light from 45-degree angle, cool fill')",
  "textureStyle": "material/texture rendering style (e.g., 'smooth cel-shaded with subtle gradient shading' or 'photorealistic with visible skin pores and fabric weave')",
  "moodKeywords": ["keyword1", "keyword2", "keyword3", "keyword4", "keyword5"],
  "consistencyAnchors": "A single comprehensive paragraph (80-120 words) that serves as the MASTER STYLE REFERENCE. This paragraph will be prepended to every character and scene prompt to anchor the visual style. It should describe: the overall rendering quality, the specific art style fingerprint, color grading approach, lighting philosophy, and the emotional tone of the visuals. Write it as direct instructions to an image generation AI."
}`;

  try {
    const responseText = await retryOperation(
      () => chatCompletion(prompt, model, 0.4, 4096, 'json_object', 600000, abortSignal),
      3,
      2000,
      abortSignal
    );
    const parsed = parseJsonWithRecovery<any>(responseText, {});

    const artDirection: ArtDirection = {
      colorPalette: {
        primary: parsed.colorPalette?.primary || '',
        secondary: parsed.colorPalette?.secondary || '',
        accent: parsed.colorPalette?.accent || '',
        skinTones: parsed.colorPalette?.skinTones || '',
        saturation: parsed.colorPalette?.saturation || '',
        temperature: parsed.colorPalette?.temperature || '',
      },
      characterDesignRules: {
        proportions: parsed.characterDesignRules?.proportions || '',
        eyeStyle: parsed.characterDesignRules?.eyeStyle || '',
        lineWeight: parsed.characterDesignRules?.lineWeight || '',
        detailLevel: parsed.characterDesignRules?.detailLevel || '',
      },
      lightingStyle: parsed.lightingStyle || '',
      textureStyle: parsed.textureStyle || '',
      moodKeywords: Array.isArray(parsed.moodKeywords) ? parsed.moodKeywords : [],
      consistencyAnchors: parsed.consistencyAnchors || '',
      visualStyle,
    };

    console.log('✅ 全局美术指导文档生成完成:', artDirection.moodKeywords.join(', '));
    logScriptProgress('全局美术指导文档生成完成');
    return artDirection;
  } catch (error: any) {
    console.error('❌ 全局美术指导文档生成失败:', error);
    logScriptProgress('美术指导文档生成失败，将使用默认风格');
    return {
      colorPalette: { primary: '', secondary: '', accent: '', skinTones: '', saturation: '', temperature: '' },
      characterDesignRules: { proportions: '', eyeStyle: '', lineWeight: '', detailLevel: '' },
      lightingStyle: '',
      textureStyle: '',
      moodKeywords: [],
      consistencyAnchors: stylePrompt,
      visualStyle,
    };
  }
};

// ============================================
// 角色视觉提示词批量生成
// ============================================

/**
 * 批量生成所有角色的视觉提示词（Batch-Aware Generation）
 */
export const generateAllCharacterPrompts = async (
  characters: Character[],
  artDirection: ArtDirection,
  genre: string,
  visualStyle: string,
  language: string = '中文',
  model: string = getActiveChatModelName(),
  abortSignal?: AbortSignal,
  excludePropNames?: string[]
): Promise<{ visualPrompt: string; negativePrompt: string }[]> => {
  console.log(`🎭 generateAllCharacterPrompts 调用 - 批量生成 ${characters.length} 个角色的视觉提示词`);
  logScriptProgress(`正在批量生成 ${characters.length} 个角色的视觉提示词（风格统一模式）...`);

  const stylePrompt = getStylePrompt(visualStyle);
  const negativePrompt = getNegativePrompt(visualStyle);

  if (characters.length === 0) return [];

  const characterList = characters.map((c, i) => {
    const costumeVariants = (c.variations || [])
      .map((variation) => `${variation.id}: ${variation.wardrobe || variation.visualPrompt}`)
      .join(' | ');
    return `Character ${i + 1} (ID: ${c.id}):
  - Name: ${c.name}
  - Form: ${c.species || 'follow name and personality'}
  - Gender: ${c.gender}
  - Age: ${c.age}
  - Personality: ${c.personality}
  - Creative Direction: ${c.creativeDirection ? JSON.stringify(c.creativeDirection) : '[follow established personality]'}
  - Base Wardrobe (EXACT SCRIPT WORDING; MUST NOT be changed): ${c.wardrobe || '[not specified]'}
  - Later Costume Variants (context only; do not apply to base look): ${costumeVariants || '[none]'}`;
  }).join('\n\n');

  const prompt = `You are an expert Art Director and AI prompt engineer for ${visualStyle} style image generation.
You must generate visual prompts for ALL ${characters.length} characters in a SINGLE response, ensuring they share a UNIFIED visual style while being visually distinct from each other.

## GLOBAL ART DIRECTION (MANDATORY - ALL characters MUST follow this)
${artDirection.consistencyAnchors}

### Color Palette
- Primary: ${artDirection.colorPalette.primary}
- Secondary: ${artDirection.colorPalette.secondary}
- Accent: ${artDirection.colorPalette.accent}
- Skin Tones: ${artDirection.colorPalette.skinTones}
- Saturation: ${artDirection.colorPalette.saturation}
- Temperature: ${artDirection.colorPalette.temperature}

### Character Design Rules (APPLY TO ALL)
- Proportions: ${artDirection.characterDesignRules.proportions}
- Eye Style: ${artDirection.characterDesignRules.eyeStyle}
- Line Weight: ${artDirection.characterDesignRules.lineWeight}
- Detail Level: ${artDirection.characterDesignRules.detailLevel}

### Rendering
- Lighting: ${artDirection.lightingStyle}
- Texture: ${artDirection.textureStyle}
- Mood Keywords: ${artDirection.moodKeywords.join(', ')}

## Genre: ${genre}
## Technical Quality: ${stylePrompt}

## Characters to Generate
${characterList}

## REQUIRED PROMPT STRUCTURE (for EACH character, output in ${language}):
Describe the subject as given in the character data. Do not invent a different kind of being.
1. Core Identity: [what this subject is, age/sex if relevant, body plan and body type - MUST follow proportions rule above]
2. Head: [a UNIQUE facial signature: explicitly specify at least four renderable features chosen from face shape, forehead, brow shape, eye shape and spacing, eyelids, nose bridge/tip, cheekbones, jaw, lips, teeth, skin marks, asymmetry, or signs of age — eyes MUST follow eye style rule]
3. Surface: [hair, fur, feathers, skin, or other covering as applicable]
4. Attire: [${CHARACTER_ATTIRE_INSTRUCTION}] Use the exact wardrobe wording supplied for this character. Preserve every garment, color, material, and fit; never substitute palette colors or redesign the outfit.
5. Pose & Framing: [full-body lookbook, entire figure visible, typical stance for this subject, all extremities visible, small margin, expression matching personality]
6. Background: [neutral seamless studio backdrop only, no environment, no location]
7. Technical Quality: ${stylePrompt} — rendering style only, ignore environment cues in style keywords

${buildCharacterLookbookPromptRules(excludePropNames)}

## CRITICAL CONSISTENCY RULES:
1. ALL characters MUST share the SAME art style as defined by the Art Direction above.
2. ALL characters' color schemes MUST harmonize within the defined color palette.
3. ALL characters MUST use the SAME proportions: ${artDirection.characterDesignRules.proportions}
4. ALL characters MUST use the SAME line/edge style: ${artDirection.characterDesignRules.lineWeight}
5. ALL characters MUST have the SAME detail density: ${artDirection.characterDesignRules.detailLevel}
6. Each character should be VISUALLY DISTINCT from others through form, markings, covering, body language, AND especially facial identity
   - but STYLISTICALLY UNIFIED in rendering quality, detail density, color harmony, and art style.
   - Every character needs a different facial signature: do not reuse the same face shape + eye shape + nose + mouth combination. Avoid generic symmetrical beauty/model faces and avoid making all characters look like siblings unless the story explicitly says so.
7. Surface tones must stay in the same family: ${artDirection.colorPalette.skinTones}
8. Sections 1-3 (identity, head, surface) are FIXED features for each character for consistency across all variations.
9. NEVER put project prop names or carried items into the visual prompt text.
10. Do not convert the subject into a different body plan. Do not leave human/humanoid subjects unclothed.
11. Follow Visual Style ${visualStyle} only. Do not mix incompatible style families (do not combine photoreal live-action with cel shading, six-head cartoon proportions, or Pixar/DreamWorks CGI).

## OUTPUT FORMAT
Output ONLY valid JSON with this structure:
{
  "characters": [
    {
      "id": "character_id",
      "visualPrompt": "single paragraph, comma-separated, 70-110 words, MUST include ${visualStyle} style keywords"
    }
  ]
}

The "characters" array MUST have exactly ${characters.length} items, in the SAME ORDER as the input.
Output ONLY the JSON, no explanations.`;

  try {
    const responseText = await retryOperation(
      () => chatCompletion(prompt, model, 0.4, 4096, 'json_object', 600000, abortSignal),
      3,
      2000,
      abortSignal
    );
    const parsed = parseJsonWithRecovery<any>(responseText, {});

    const results: { visualPrompt: string; negativePrompt: string }[] = [];
    const charResults = Array.isArray(parsed.characters) ? parsed.characters : [];

    for (let i = 0; i < characters.length; i++) {
      const charResult = charResults[i];
      if (charResult && charResult.visualPrompt) {
        results.push({
          visualPrompt: normalizeCharacterWardrobeInPrompt(
            stripProjectPropsFromPrompt(charResult.visualPrompt.trim(), excludePropNames || []),
            characters[i]
          ),
          negativePrompt: negativePrompt,
        });
        console.log(`  ✅ 角色 ${characters[i].name} 提示词生成成功`);
      } else {
        console.warn(`  ⚠️ 角色 ${characters[i].name} 在批量结果中缺失，将使用后备方案`);
        results.push({
          visualPrompt: '',
          negativePrompt: negativePrompt,
        });
      }
    }

    console.log(`✅ 批量角色视觉提示词生成完成: ${results.filter(r => r.visualPrompt).length}/${characters.length} 成功`);
    logScriptProgress(`角色视觉提示词批量生成完成 (${results.filter(r => r.visualPrompt).length}/${characters.length})`);
    return results;
  } catch (error: any) {
    console.error('❌ 批量角色视觉提示词生成失败:', error);
    logScriptProgress('批量角色提示词生成失败，将回退到逐个生成模式');
    return characters.map(() => ({ visualPrompt: '', negativePrompt: negativePrompt }));
  }
};

// ============================================
// 单个角色/场景视觉提示词生成
// ============================================

/**
 * 生成角色或场景的视觉提示词
 */
export const generateVisualPrompts = async (
  type: 'character' | 'scene' | 'prop',
  data: Character | Scene | Prop,
  genre: string,
  model: string = getActiveChatModelName(),
  visualStyle: string = 'live-action',
  language: string = '中文',
  artDirection?: ArtDirection,
  abortSignal?: AbortSignal,
  excludePropNames?: string[]
): Promise<{ visualPrompt: string; negativePrompt: string }> => {
  const stylePrompt = getStylePrompt(visualStyle);
  const negativePrompt = type === 'scene'
    ? getSceneNegativePrompt(visualStyle)
    : getNegativePrompt(visualStyle);

  // 构建 Art Direction 注入段落
  const artDirectionBlock = artDirection ? `
## GLOBAL ART DIRECTION (MANDATORY - MUST follow this for visual consistency)
${artDirection.consistencyAnchors}

Color Palette: Primary=${artDirection.colorPalette.primary}, Secondary=${artDirection.colorPalette.secondary}, Accent=${artDirection.colorPalette.accent}
Color Temperature: ${artDirection.colorPalette.temperature}, Saturation: ${artDirection.colorPalette.saturation}
Lighting: ${artDirection.lightingStyle}
Texture: ${artDirection.textureStyle}
Mood Keywords: ${artDirection.moodKeywords.join(', ')}
` : '';

  let prompt: string;

  if (type === 'character') {
    const char = data as Character;
    prompt = `You are an expert AI prompt engineer for ${visualStyle} style image generation.
${artDirectionBlock}
Create a detailed visual prompt for a character with the following structure:

Character Data:
- Name: ${char.name}
- Form: ${char.species || 'follow name and personality'}
- Gender: ${char.gender}
- Age: ${char.age}
- Personality: ${char.personality}
- Creative Direction: ${char.creativeDirection ? JSON.stringify(char.creativeDirection) : '[follow established personality]'}

REQUIRED STRUCTURE (output in ${language}):
Describe the subject as given in the character data. Do not invent a different kind of being.
1. Core Identity: [what this subject is, age/sex if relevant, body plan and body type${artDirection ? ` - MUST follow proportions: ${artDirection.characterDesignRules.proportions}` : ''}]
2. Head: [a UNIQUE facial signature with at least four concrete, renderable features: face shape, brow, eye shape/spacing, nose, cheekbones/jaw, mouth/lips, skin marks, asymmetry, or age cues${artDirection ? ` — eyes MUST follow eye style: ${artDirection.characterDesignRules.eyeStyle}` : ''}]
3. Surface: [hair, fur, feathers, skin, or other covering as applicable${artDirection ? `; surface tones from: ${artDirection.colorPalette.skinTones}` : ''}]
4. Attire: [${CHARACTER_ATTIRE_INSTRUCTION}] Exact wardrobe from Character Data: ${char.wardrobe || '[not specified]'}. Preserve its colors, materials, garment names, and silhouette literally; the global palette may guide lighting only and must never replace wardrobe colors.
5. Pose & Framing: [full-body lookbook, entire figure visible, typical stance for this subject, all extremities visible, small margin, expression matching personality]
6. Background: [neutral seamless studio backdrop only, no environment, no location]
7. Technical Quality: ${stylePrompt} — rendering style only, ignore environment cues in style keywords

${buildCharacterLookbookPromptRules(excludePropNames)}

CRITICAL RULES:
- Sections 1-3 are FIXED features for consistency across all variations${artDirection ? `
- MUST follow the Global Art Direction above for style consistency
- Line/edge style: ${artDirection.characterDesignRules.lineWeight}
- Detail density: ${artDirection.characterDesignRules.detailLevel}` : ''}
- NEVER put project prop names or carried items into the visual prompt text
- Do not convert the subject into a different body plan. Do not leave human/humanoid subjects unclothed.
- Follow Visual Style ${visualStyle} only. Do not mix incompatible style families (do not combine photoreal live-action with cel shading, six-head cartoon proportions, or Pixar/DreamWorks CGI).
- Use specific, concrete visual details
- Make the face unmistakably individual rather than a generic attractive/model face; do not default to the same face as other characters.
- Output as single paragraph, comma-separated
- MUST include style keywords: ${visualStyle}
- Length: 70-110 words
- Focus on visual details that can be rendered in images

Output ONLY the visual prompt text, no explanations.`;
  } else if (type === 'scene') {
    const scene = data as Scene;
    prompt = `You are an expert cinematographer and AI prompt engineer for ${visualStyle} productions.
${artDirectionBlock}
Create a cinematic scene/environment prompt with this structure:

Scene Data:
- Location: ${scene.location}
- Time: ${scene.time}
- Atmosphere: ${scene.atmosphere}
- Creative Direction: ${scene.creativeDirection ? JSON.stringify(scene.creativeDirection) : '[follow established scene facts]'}
- Genre: ${genre}

REQUIRED STRUCTURE (output in ${language}):
1. Environment: [detailed location description with architectural/natural elements, props, furniture, vehicles, or objects that tell the story of the space]
2. Lighting: [specific lighting setup${artDirection ? ` - MUST follow project lighting style: ${artDirection.lightingStyle}` : ' - direction, color temperature, quality (soft/hard), key light source'}]
3. Composition: [camera angle (eye-level/low/high), framing rules (rule of thirds/symmetry), depth layers]
4. Atmosphere: [mood, weather, particles in air (fog/dust/rain), environmental effects]
5. Color Palette: [${artDirection ? `MUST use project palette - Primary: ${artDirection.colorPalette.primary}, Secondary: ${artDirection.colorPalette.secondary}, Accent: ${artDirection.colorPalette.accent}, Temperature: ${artDirection.colorPalette.temperature}` : 'dominant colors, color temperature (warm/cool), saturation level'}]
6. Technical Quality: ${stylePrompt}

CRITICAL RULES:
- ⚠️ ABSOLUTELY NO PEOPLE, CHARACTERS, HUMAN FIGURES, OR SILHOUETTES in the scene - this is a PURE ENVIRONMENT/BACKGROUND shot
- The scene must be an EMPTY environment - no humans, no crowds, no pedestrians, no figures in the distance${artDirection ? `
- ⚠️ MUST follow the Global Art Direction above - this scene must visually match the same project as all characters
- Texture/material rendering: ${artDirection.textureStyle}
- Mood: ${artDirection.moodKeywords.join(', ')}` : ''}
- Use professional cinematography terminology
- Specify light sources and direction (e.g., "golden hour backlight from right")
- Include composition guidelines (rule of thirds, leading lines, depth of field)
- You may include environmental storytelling elements (e.g., an abandoned coffee cup, footprints in snow, a parked car) to make the scene feel lived-in without showing people
- Output as single paragraph, comma-separated
- MUST emphasize ${visualStyle} style throughout
- Length: 70-110 words
- Focus on elements that establish mood and cinematic quality

Output ONLY the visual prompt text, no explanations.`;
  } else {
    const prop = data as Prop;
    prompt = `You are an expert prop/product prompt engineer for ${visualStyle} style image generation.
${artDirectionBlock}
Create a cinematic visual prompt for a standalone prop/item.

Prop Data:
- Name: ${prop.name}
- Category: ${prop.category}
- Description: ${prop.description}
- Genre Context: ${genre}

REQUIRED STRUCTURE (output in ${language}):
1. Form & Silhouette: [overall shape, scale cues, distinctive outline]
2. Material & Texture: [material type, micro texture, wear/age details]
3. Color & Finish: [primary/secondary/accent colors, finish level]
4. Craft & Details: [logos, engravings, seams, patterns, moving parts]
5. Presentation: [clean product-shot framing, controlled studio/cinematic lighting]
6. Technical Quality: ${stylePrompt}

CRITICAL RULES:
- Object-only shot, absolutely NO people, NO characters, NO hands
- Keep identity-defining details concrete and renderable
- Output as single paragraph, comma-separated
- MUST emphasize ${visualStyle} style
- Length: 55-95 words

Output ONLY the visual prompt text, no explanations.`;
  }

  const visualPrompt = await retryOperation(
    () => chatCompletion(prompt, model, 0.5, 1024, undefined, 600000, abortSignal),
    3,
    2000,
    abortSignal
  );

  return {
    visualPrompt: type === 'character'
      ? normalizeCharacterWardrobeInPrompt(
          stripProjectPropsFromPrompt(visualPrompt.trim(), excludePropNames || []),
          data as Character
        )
      : visualPrompt.trim(),
    negativePrompt: negativePrompt
  };
};

// ============================================
// 图像生成
// ============================================

/**
 * 生成图像
 * 使用图像生成API，支持参考图像确保角色和场景一致性
 */
type ReferencePackType = 'shot' | 'character' | 'scene' | 'prop' | 'shape';
type ImageModelRoutingFamily = 'nano-banana' | 'generic';

const resolveImageModelRoutingFamily = (model: any): ImageModelRoutingFamily => {
  const identity = `${model?.id || ''} ${model?.apiModel || ''} ${model?.name || ''}`.toLowerCase();
  const isNanoBanana =
    identity.includes('gemini-3-pro-image-preview') ||
    identity.includes('gemini-3.1-flash-image-preview') ||
    identity.includes('nano banana') ||
    identity.includes('gemini 3 pro image') ||
    identity.includes('gemini 3.1 flash image');
  return isNanoBanana ? 'nano-banana' : 'generic';
};

const buildImageRoutingPrefix = (
  family: ImageModelRoutingFamily,
  context: {
    hasAnyReference: boolean;
    referencePackType: ReferencePackType;
    isVariation: boolean;
  }
): string => {
  if (family !== 'nano-banana') {
    return '';
  }

  if (context.isVariation) {
    return `MODEL ROUTING: Nano Banana Pro - character variation mode.
- Lock face identity from references first.
- Apply outfit change from text prompt while preserving identity, body proportions, and style consistency.`;
  }

  if (!context.hasAnyReference) {
    return `MODEL ROUTING: Nano Banana Pro - text-driven generation mode.
- Follow the textual prompt precisely for subject, camera, and composition.
- Avoid introducing extra characters or objects not required by the prompt.`;
  }

  if (context.referencePackType === 'character') {
    return `MODEL ROUTING: Nano Banana Pro - character reference mode.
- Treat provided references as the primary identity anchor.
- Keep face, hair, outfit materials, and body proportions consistent across outputs.`;
  }

  if (context.referencePackType === 'scene') {
    return `MODEL ROUTING: Nano Banana Pro - scene reference mode.
- Preserve environment layout, lighting logic, atmosphere, and style continuity from references.
- Keep composition coherent with prompt instructions.`;
  }

  if (context.referencePackType === 'prop') {
    return `MODEL ROUTING: Nano Banana Pro - prop reference mode.
- Preserve prop shape, materials, color, and distinguishing details.
- Do not redesign key prop identity.`;
  }

  if (context.referencePackType === 'shape') {
    return `MODEL ROUTING: Nano Banana Pro - shape reference mode.
- Use references only for silhouette, proportions, and major geometry.
- Do not copy rendering style, color grading, textures, or lighting from references.`;
  }

  return `MODEL ROUTING: Nano Banana Pro - shot reference mode.
- Prioritize reference continuity for scene, character identity, and prop details.
- Then apply the textual action and camera intent.`;
};

const MAX_IMAGE_PROMPT_CHARS = 5000;
const IMAGE_PROMPT_SOFT_TARGET_CHARS = 4700;
const MAX_NEGATIVE_PROMPT_TERMS = 64;
const MAX_REFERENCE_IMAGES_PER_REQUEST = 5;
/**
 * ComfyUI 参考图上限：Qwen Edit Utils 5 张，Klein Edit 4 张。前端按 5 收集，多出的槽由后端裁掉。
 * 前端按 5 截断会让日志说“保留 5 张”，实际后端又静默丢掉第 5 张。
 */
const MAX_COMFY_REFERENCE_IMAGES = 5;

const CJK_CHAR_RE = /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/g;

const countCjkChars = (text: string): number => (text.match(CJK_CHAR_RE) || []).length;

/** Flux/T5 对中文提示词遵循极差，需转英文后再送 ComfyUI */
const needsComfyEnglishPrompt = (text: string): boolean => {
  const trimmed = text.trim();
  if (!trimmed) return false;
  const cjk = countCjkChars(trimmed);
  const total = trimmed.replace(/\s/g, '').length;
  return cjk > 0 && (total === 0 || cjk / total > 0.12);
};

const translatePromptForComfyUi = async (prompt: string): Promise<string> => {
  if (!needsComfyEnglishPrompt(prompt)) return prompt;

  const instruction = `Translate the following text-to-image prompt into English for Flux diffusion models.
Preserve ALL visual details: what the subject is, age, body plan, head, covering, attire if present, pose, expression, lighting, camera, and art-style keywords.
Do not change the subject into a different kind of being. Do not add attire that is not in the source.
Output ONLY one English paragraph using comma-separated phrases. No markdown, no explanation.

Prompt:
${prompt}`;

  try {
    const translated = (await chatCompletion(
      instruction,
      getActiveChatModelName(),
      0.2,
      1024,
      undefined,
      90000
    )).trim();
    if (!translated || countCjkChars(translated) >= countCjkChars(prompt)) {
      console.warn('[ComfyUI] Prompt translation did not produce usable English, keeping original');
      return prompt;
    }
    console.info('[ComfyUI] Translated prompt to English for Flux encoder');
    return translated;
  } catch (error) {
    console.warn('[ComfyUI] Prompt translation failed, keeping original:', error);
    return prompt;
  }
};

const normalizeReferenceImageValue = (input?: string): string => String(input || '').trim();

const buildBoundedReferenceImages = (
  referenceImages: string[],
  continuityReferenceImage?: string,
  maxReferences: number = MAX_REFERENCE_IMAGES_PER_REQUEST
): {
  references: string[];
  continuityReferenceImage?: string;
  requestedCount: number;
  droppedCount: number;
  maxReferences: number;
} => {
  const dedupedBase: string[] = [];
  const seenBase = new Set<string>();
  referenceImages.forEach((img) => {
    const normalized = normalizeReferenceImageValue(img);
    if (!normalized || seenBase.has(normalized)) return;
    seenBase.add(normalized);
    dedupedBase.push(normalized);
  });

  const normalizedContinuity = normalizeReferenceImageValue(continuityReferenceImage);
  const hasContinuity = !!normalizedContinuity;
  const baseWithoutContinuity = hasContinuity
    ? dedupedBase.filter((img) => img !== normalizedContinuity)
    : dedupedBase;

  let boundedReferences: string[];
  if (hasContinuity) {
    // Reserve one slot for continuity and keep it as the final reference.
    const head = baseWithoutContinuity.slice(0, Math.max(0, maxReferences - 1));
    boundedReferences = [...head, normalizedContinuity];
  } else {
    boundedReferences = baseWithoutContinuity.slice(0, maxReferences);
  }

  const requestedCount = dedupedBase.length + (hasContinuity && !dedupedBase.includes(normalizedContinuity) ? 1 : 0);
  const droppedCount = Math.max(0, requestedCount - boundedReferences.length);

  return {
    references: boundedReferences,
    continuityReferenceImage: hasContinuity ? normalizedContinuity : undefined,
    requestedCount,
    droppedCount,
    maxReferences,
  };
};

const normalizePromptWhitespace = (input: string): string =>
  String(input || '')
    .replace(/\r/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

const compactTextByWordsAndChars = (
  input: string,
  maxWords: number,
  maxChars: number
): string => {
  const normalized = normalizePromptWhitespace(input).replace(/\n/g, ' ');
  if (!normalized) return '';

  let candidate = normalized;
  const words = candidate.split(/\s+/).filter(Boolean);
  if (words.length > maxWords) {
    candidate = words.slice(0, maxWords).join(' ');
  }

  const chars = Array.from(candidate);
  if (chars.length > maxChars) {
    candidate = chars.slice(0, maxChars).join('');
  }

  candidate = candidate.replace(/[,\s;:.!?]+$/g, '');
  return candidate.length < normalized.length ? `${candidate}...` : candidate;
};

const compactPanelDescriptionLines = (
  input: string,
  maxWordsPerPanel: number,
  maxCharsPerPanel: number
): string => {
  const panelPattern = /^(\s*Panel\s+\d+[^\-]*-\s*)(.+)$/i;
  return input
    .split('\n')
    .map((line) => {
      const match = line.match(panelPattern);
      if (!match) return line;
      const compacted = compactTextByWordsAndChars(match[2], maxWordsPerPanel, maxCharsPerPanel);
      return `${match[1]}${compacted}`;
    })
    .join('\n');
};

const dedupePromptLines = (input: string): string => {
  const seen = new Set<string>();
  const output: string[] = [];

  input.split('\n').forEach((line) => {
    const key = line.trim().toLowerCase();
    if (!key) {
      output.push(line);
      return;
    }
    if (seen.has(key)) return;
    seen.add(key);
    output.push(line);
  });

  return output.join('\n');
};

const truncatePromptAtBoundary = (
  input: string,
  maxChars: number
): { text: string; wasTruncated: boolean; originalLength: number } => {
  const chars = Array.from(input);
  const originalLength = chars.length;
  if (originalLength <= maxChars) {
    return { text: input, wasTruncated: false, originalLength };
  }

  const hardCut = chars.slice(0, maxChars).join('');
  const boundaries = ['\n\n', '\n', '. ', '; '];
  let best = -1;

  boundaries.forEach((marker) => {
    const idx = hardCut.lastIndexOf(marker);
    if (idx > best) best = idx;
  });

  const minUsefulBoundary = Math.floor(maxChars * 0.6);
  if (best >= minUsefulBoundary) {
    return {
      text: hardCut.slice(0, best).trimEnd(),
      wasTruncated: true,
      originalLength,
    };
  }

  return {
    text: hardCut.trimEnd(),
    wasTruncated: true,
    originalLength,
  };
};

const compactNegativePromptTerms = (
  input: string,
  maxTerms: number = MAX_NEGATIVE_PROMPT_TERMS
): string => {
  const terms = String(input || '')
    .split(/[,;\n]+/)
    .map((item) => item.trim())
    .filter(Boolean);
  if (terms.length === 0) return '';

  const deduped: string[] = [];
  const seen = new Set<string>();
  for (const term of terms) {
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(term);
    if (deduped.length >= maxTerms) break;
  }
  return deduped.join(', ');
};

const compactPromptToMaxChars = (
  input: string,
  maxChars: number,
  options?: {
    skipBoundaryTruncation?: boolean;
  }
): { text: string; wasCompacted: boolean; wasTruncated: boolean; originalLength: number; finalLength: number } => {
  const original = String(input || '');
  let text = normalizePromptWhitespace(original);
  let wasCompacted = text !== original;
  const skipBoundaryTruncation = !!options?.skipBoundaryTruncation;

  const getLength = () => Array.from(text).length;

  if (getLength() > IMAGE_PROMPT_SOFT_TARGET_CHARS) {
    const compacted = compactPanelDescriptionLines(text, 18, 110);
    if (compacted !== text) {
      text = compacted;
      wasCompacted = true;
    }
  }

  if (getLength() > IMAGE_PROMPT_SOFT_TARGET_CHARS) {
    const compacted = compactPanelDescriptionLines(text, 12, 80);
    if (compacted !== text) {
      text = compacted;
      wasCompacted = true;
    }
  }

  if (getLength() > IMAGE_PROMPT_SOFT_TARGET_CHARS) {
    const compacted = text
      .split('\n')
      .map((line) => {
        if (Array.from(line).length <= 240) return line;
        return compactTextByWordsAndChars(line, 42, 220);
      })
      .join('\n');
    if (compacted !== text) {
      text = compacted;
      wasCompacted = true;
    }
  }

  if (getLength() > IMAGE_PROMPT_SOFT_TARGET_CHARS) {
    const deduped = dedupePromptLines(text);
    if (deduped !== text) {
      text = deduped;
      wasCompacted = true;
    }
  }

  text = normalizePromptWhitespace(text);

  if (skipBoundaryTruncation) {
    const finalLength = Array.from(text).length;
    return {
      text,
      wasCompacted,
      wasTruncated: false,
      originalLength: Array.from(original).length,
      finalLength,
    };
  }

  const bounded = truncatePromptAtBoundary(text, maxChars);
  return {
    text: bounded.text,
    wasCompacted: wasCompacted || bounded.wasTruncated,
    wasTruncated: bounded.wasTruncated,
    originalLength: bounded.originalLength,
    finalLength: Array.from(bounded.text).length,
  };
};

const countEnglishWords = (text: string): number => {
  const matches = String(text || '').trim().match(/[A-Za-z0-9'-]+/g);
  return matches ? matches.length : 0;
};

export const generateImage = async (
  prompt: string,
  referenceImages: string[] = [],
  aspectRatio: AspectRatio = '16:9',
  isVariation: boolean = false,
  hasTurnaround: boolean = false,
  negativePrompt: string = '',
  options?: {
    continuityReferenceImage?: string;
    characterReferenceImage?: string;
    referencePackType?: ReferencePackType;
    /** ComfyUI 九宫格等场景需纯文生图，禁止 img2img 锁定单张定妆图 */
    skipComfyImg2Img?: boolean;
    /** 覆盖模型默认 workflowName（关键帧 / 九宫格等） */
    workflowName?: string;
    /** 覆盖模型默认 steps */
    steps?: number;
    /** 与 referenceImages 下标对齐的业务说明，用于避免全景图中的角色/道具相互混淆。 */
    referenceAnnotations?: string[];
    target?: GenerationTarget;
    onJobCreated?: (job: GenerationJobStatus) => void;
    waitForResult?: boolean;
  }
): Promise<string> => {
  const startTime = Date.now();
  const activeImageModel = getActiveModel('image');
  const imageRoutingFamily = resolveImageModelRoutingFamily(activeImageModel);
  const imageModelId = activeImageModel?.apiModel || activeImageModel?.id || 'gemini-3-pro-image-preview';
  const imageApiFormat = getImageApiFormat(activeImageModel as any);
  const imageModelParams = (activeImageModel?.params || {}) as Partial<ImageModelParams>;
  const explicitWorkflowName = String(options?.workflowName || '').trim();
  const hasRequestedReference = referenceImages.some((image) => Boolean(normalizeReferenceImageValue(image)))
    || Boolean(normalizeReferenceImageValue(options?.continuityReferenceImage));
  const useConfiguredReferenceWorkflow = imageApiFormat === 'comfyui'
    && hasRequestedReference
    && !explicitWorkflowName
    && Boolean(String(imageModelParams.referenceWorkflowName || '').trim());
  const selectedWorkflowName = explicitWorkflowName
    || (useConfiguredReferenceWorkflow
      ? String(imageModelParams.referenceWorkflowName).trim()
      : String(imageModelParams.workflowName || '').trim());
  const selectedSteps = options?.steps
    ?? (useConfiguredReferenceWorkflow
      ? imageModelParams.referenceSteps ?? imageModelParams.steps
      : imageModelParams.steps);

  // 参考图上限随实际后端而定，避免前端报“保留 5 张”而后端只吃 4 张
  const qwenBuiltinEdit = /qwen_image_edit/i.test(selectedWorkflowName) && !/flf/i.test(selectedWorkflowName);
  const maxComfyRefs = qwenBuiltinEdit ? 3 : MAX_COMFY_REFERENCE_IMAGES;
  const boundedReferences = buildBoundedReferenceImages(
    referenceImages,
    options?.continuityReferenceImage,
    imageApiFormat === 'comfyui' ? maxComfyRefs : MAX_REFERENCE_IMAGES_PER_REQUEST
  );
  const effectiveReferenceImages = boundedReferences.references;
  const continuityReferenceImage = boundedReferences.continuityReferenceImage;
  const referencePackType = options?.referencePackType || 'shot';
  const hasAnyReference = effectiveReferenceImages.length > 0;

  if (boundedReferences.droppedCount > 0) {
    console.warn(
      `[Image] Reference images capped at ${boundedReferences.maxReferences}: ` +
      `${boundedReferences.requestedCount} -> ${effectiveReferenceImages.length}`
    );
  }

  if (imageApiFormat === 'comfyui') {
    console.info('[ComfyUI Image] 工作流路由:', {
      workflowName: selectedWorkflowName || 'model-default',
      steps: selectedSteps,
      source: useConfiguredReferenceWorkflow ? 'reference-workflow' : explicitWorkflowName ? 'explicit-workflow' : 'text-workflow',
      referenceCount: effectiveReferenceImages.length,
    });
  }

  try {
    const normalizedUserPrompt = normalizePromptWhitespace(prompt);
    const referenceMapping = (options?.referenceAnnotations || [])
      .map((annotation, index) => String(annotation || '').trim()
        ? `- Reference ${index + 1}: ${String(annotation).trim()}`
        : '')
      .filter(Boolean)
      .join('\n');

    // ComfyUI：直接使用角色/场景提示词，不走 Gemini 多模态参考图文案与 LLM 压缩
    if (imageApiFormat === 'comfyui') {
      const compactNegativePrompt = compactNegativePromptTerms(negativePrompt.trim());
      const skipImg2Img = options?.skipComfyImg2Img === true;
      const characterRef = skipImg2Img
        ? undefined
        : options?.characterReferenceImage ??
          (referencePackType === 'character' || referencePackType === 'shape'
            ? effectiveReferenceImages[0]
            : undefined);

      let comfyPrompt = normalizedUserPrompt;
      const qwenEditShot =
        referencePackType === 'shot'
        && hasAnyReference
        && !continuityReferenceImage
        && (() => {
          const name = selectedWorkflowName.toLowerCase();
          return name.includes('qwen_image_edit') && !name.includes('turnaround');
        })();
      if (continuityReferenceImage) {
        comfyPrompt += '\n\n[ComfyUI end frame] Keep the same subject identity, body plan, attire, and scene from the reference image, but show a clearly different pose, camera angle, and action moment for the END frame. Shot-listed props may be added from prop reference images; do not invent a different item.';
      } else if (qwenEditShot) {
        comfyPrompt += `\n\n[ComfyUI qwen-edit] Image 1 is the SCENE/location. Build this shot in that environment and lighting. Image 2 is the lead character identity reference${hasTurnaround ? ' and may be a turnaround or three-view sheet; select the panel matching the requested camera angle' : ''}: copy face, hair, body, and outfit only — discard the reference-sheet layout, studio backdrop, posing block, and duplicate views. Later images are props or background extras standing in that location, not another studio portrait.`;
      } else if (characterRef) {
        if (referencePackType === 'shot') {
          comfyPrompt += `\n\n[ComfyUI character anchor] Image 1 is the character identity lock${hasTurnaround ? ' and may be a turnaround or three-view sheet; use the panel matching the requested camera angle' : ''}. Copy that exact subject appearance, body plan, and outfit into this shot; never reproduce the sheet layout or duplicate views. Later images are scene or prop references only. Shot-listed props may be added from prop reference images; do not invent a different item. A missing carried item in the character reference does not forbid it in this shot. Apply the shot description for pose, camera and environment.`;
        } else if (selectedWorkflowName.toLowerCase().includes('turnaround')) {
          comfyPrompt += '\n\n[ComfyUI turnaround] Image 1 is the identity lock. Copy appearance, body plan, and any attire already on the subject. Only change camera angle and shot size per panel. Do not add attire that is not in image 1. Do not change the body plan. Do not invent a different subject.';
        } else {
          comfyPrompt += '\n\n[ComfyUI character anchor] Match the reference subject exactly: appearance, body plan, and any attire shown. This is a lookbook: no carried items. Do not add attire that is not in the reference. Apply the prompt for pose and studio framing.';
        }
      }

      if (referenceMapping) {
        comfyPrompt += `\n\n[Reference mapping]\n${referenceMapping}`;
      }

      comfyPrompt = await translatePromptForComfyUi(comfyPrompt);

      const promptLimitResult = compactPromptToMaxChars(comfyPrompt, MAX_IMAGE_PROMPT_CHARS);
      if (promptLimitResult.wasTruncated) {
        console.warn(
          `[ImagePrompt] ComfyUI prompt exceeded ${MAX_IMAGE_PROMPT_CHARS} chars ` +
          `(${promptLimitResult.originalLength}). Truncated.`
        );
      }

      const imageUrl = await callImageApi({
        prompt: promptLimitResult.text,
        negativePrompt: compactNegativePrompt || undefined,
        aspectRatio,
        referenceImages: effectiveReferenceImages,
        continuityReferenceImage,
        characterReferenceImage: characterRef,
        img2imgDenoise: continuityReferenceImage
          ? 0.65
          : characterRef
            ? 0.78
            : undefined,
        workflowName: selectedWorkflowName || undefined,
        steps: selectedSteps,
        target: options?.target,
        onJobCreated: options?.onJobCreated,
        waitForResult: options?.waitForResult,
      }, activeImageModel as any);
      if (options?.waitForResult === false) {
        return imageUrl;
      }
      addRenderLogWithTokens({
        type: 'keyframe',
        resourceId: 'image-' + Date.now(),
        resourceName: prompt.substring(0, 50) + '...',
        status: 'success',
        model: imageModelId,
        prompt,
        duration: Date.now() - startTime
      });
      return imageUrl;
    }

    let finalPrompt = normalizedUserPrompt;
    if (hasAnyReference) {
      if (isVariation) {
        const compactVariationPrompt = compactTextByWordsAndChars(normalizedUserPrompt, 220, 1400);
        finalPrompt = `
Task: Character outfit variation image.
Requested variation:
${compactVariationPrompt}

Reference constraints (strict):
- Keep the subject identical to references: appearance, body plan, and proportions. Do not add attire that is not requested.
- Outfit/clothing must follow the requested variation and should be visibly different from reference outfit.
- Keep style, lighting, and rendering quality coherent.
- Do not add unrelated characters, objects, or text overlays.
Output one cinematic still image.`;
      } else {
        const referenceRoleLines = (() => {
          if (effectiveReferenceImages.length === 0) {
            return ['- No explicit reference pack is provided; use text prompt as primary composition source.'];
          }

          if (referencePackType === 'character') {
            const lines = [
              '- All provided images are the SAME character identity references.',
              '- Prioritize the same subject: appearance, body plan, and any attire already shown.',
              '- This is a lookbook: do not add backpacks or handheld hero props. Do not add attire that is not in the reference.',
            ];
            if (hasTurnaround) {
              lines.push('- A selected character reference may be a turnaround or three-view sheet; use the panel matching the requested camera angle.');
            }
            return lines;
          }

          if (referencePackType === 'scene') {
            return ['- All provided images are scene/environment references.', '- Preserve location layout, atmosphere, and lighting logic.'];
          }

          if (referencePackType === 'prop') {
            return ['- All provided images are prop/item references.', '- Preserve object shape, color, materials, and distinguishing details.'];
          }

          if (referencePackType === 'shape') {
            return [
              '- All provided images are shape/silhouette references only.',
              '- Use references for contour, proportions, and key geometry anchors only.',
              '- Ignore reference rendering style, color grading, textures, and lighting.'
            ];
          }

          const lines = [
            '- First images: selected character identity references.',
            '- Next image: scene/environment reference.',
            '- Remaining images: prop/item references.',
          ];
          if (hasTurnaround) {
            lines.push('- A selected character reference may be a turnaround or three-view sheet.');
          }
          return lines;
        })();
        const taskLabel = referencePackType === 'character'
          ? 'character image'
          : referencePackType === 'scene'
            ? 'scene/environment image'
            : referencePackType === 'prop'
              ? 'prop/item image'
              : referencePackType === 'shape'
                ? 'style-controlled image with shape reference'
                : 'cinematic shot';
        const sceneConsistencyRule = referencePackType === 'shot'
          ? 'Strictly preserve scene visual style, lighting logic, and environment continuity from references.'
          : referencePackType === 'scene'
            ? 'Strictly preserve scene layout, atmosphere, and lighting logic.'
            : referencePackType === 'shape'
              ? 'Use references only for silhouette and spatial geometry; style and lighting must follow textual prompt.'
            : 'Keep visual style and lighting coherent with prompt and references.';
        const characterConsistencyRule = referencePackType === 'character'
          ? 'Generated subject must remain identical to references (appearance, body plan, proportions, any attire shown). Do not add attire that is not in the reference. Do not add carried hero props.'
          : referencePackType === 'shape'
            ? 'If characters appear, keep overall silhouette/proportions aligned with references but rely on prompt for style and materials.'
          : 'If characters appear, match the referenced subject (appearance, body plan, proportions, any attire shown). Shot-listed props may be added from prop references; a missing carried item in the lookbook does not forbid it.';
        const propConsistencyRule = referencePackType === 'prop'
          ? 'Props/items must match references exactly (shape, material, color, details).'
          : referencePackType === 'shape'
            ? 'If props/items appear, preserve major shape cues from references while following prompt-defined style/material treatment.'
          : 'Referenced props/items in shot must match shape, material, color, and details. If the character lookbook has no such item, still add it from the prop reference rather than inventing a different one.';
        const continuityGuide = continuityReferenceImage
          ? '- Last image is continuity reference; preserve transition continuity for identity, lighting, and spatial placement.'
          : null;
        const turnaroundGuide = hasTurnaround
          ? '- If a turnaround or three-view sheet is present, prioritize the panel matching the current camera angle and treat the sheet as one character identity reference.'
          : null;
        const compactPrimaryPrompt = compactTextByWordsAndChars(normalizedUserPrompt, 520, 2800);
        const referenceGuides = [
          ...referenceRoleLines,
          continuityGuide,
        ].filter((line): line is string => Boolean(line));
        const consistencyRules = [
          `- ${sceneConsistencyRule}`,
          `- ${characterConsistencyRule}`,
          `- ${propConsistencyRule}`,
          turnaroundGuide,
          '- Output one cinematic still image without text overlays.',
        ].filter((line): line is string => Boolean(line));

        finalPrompt = `
Task: Generate a ${taskLabel} using provided references.
Primary prompt:
${compactPrimaryPrompt}

Reference roles:
${referenceGuides.join('\n')}

Consistency priorities:
${consistencyRules.join('\n')}`;
      }
    }

    if (referenceMapping) {
      finalPrompt += `\n\nReference mapping:\n${referenceMapping}`;
    }

    const modelRoutingPrefix = buildImageRoutingPrefix(imageRoutingFamily, {
      hasAnyReference,
      referencePackType,
      isVariation,
    });
    if (modelRoutingPrefix) {
      finalPrompt = `${modelRoutingPrefix}\n\n${finalPrompt}`;
    }

    const compactNegativePrompt = compactNegativePromptTerms(negativePrompt.trim());
    if (compactNegativePrompt) {
      finalPrompt = `${finalPrompt}

NEGATIVE PROMPT (strictly avoid): ${compactNegativePrompt}`;
    }

    const deterministicCompaction = compactPromptToMaxChars(finalPrompt, MAX_IMAGE_PROMPT_CHARS, {
      skipBoundaryTruncation: true,
    });
    if (deterministicCompaction.wasCompacted) {
      console.info(
        `[ImagePrompt] Prompt compacted ${deterministicCompaction.originalLength} -> ${deterministicCompaction.finalLength} chars.`
      );
    }
    finalPrompt = deterministicCompaction.text;

    const deterministicLength = Array.from(finalPrompt).length;
    if (deterministicLength > MAX_IMAGE_PROMPT_CHARS) {
      const llmCompressionResult = await compressPromptWithLLM({
        text: finalPrompt,
        maxChars: MAX_IMAGE_PROMPT_CHARS - 80,
        mode: 'image',
        timeoutMs: 45000,
      });
      if (llmCompressionResult.compressed) {
        finalPrompt = llmCompressionResult.text;
        console.info(
          `[ImagePrompt] LLM compressed (${llmCompressionResult.model}) ` +
          `${llmCompressionResult.originalLength} -> ${llmCompressionResult.finalLength} chars.`
        );
      }
    }

    const promptLimitResult = compactPromptToMaxChars(finalPrompt, MAX_IMAGE_PROMPT_CHARS);
    if (promptLimitResult.wasTruncated) {
      console.warn(
        `[ImagePrompt] Prompt exceeded ${MAX_IMAGE_PROMPT_CHARS} chars ` +
        `(${promptLimitResult.originalLength}). Boundary-truncated after compaction.`
      );
    }
    finalPrompt = promptLimitResult.text;

    // 尾帧的首帧连续性图必须作为最后一个参考槽位传给 NewAPI；之前只在
    // ComfyUI 分支通过单独字段传递，Gemini/OpenAI 分支实际没有收到它。
    const nonComfyReferenceSources = [
      ...effectiveReferenceImages,
      ...(continuityReferenceImage ? [continuityReferenceImage] : []),
    ];

    // OpenAI / Gemini 等云端格式统一走 callImageApi，API 模式下会创建 Celery 任务并回落盘 URL，
    // 避免在本文件内再直连第三方 API（绕过任务队列后前端拿到 base64，episode 自动保存会 500）。
    const imageUrl = await callImageApi({
      prompt: finalPrompt,
      aspectRatio,
      referenceImages: nonComfyReferenceSources,
      referenceAnnotations: options?.referenceAnnotations,
      target: options?.target,
      onJobCreated: options?.onJobCreated,
      waitForResult: options?.waitForResult,
    }, activeImageModel as any);
    if (options?.waitForResult === false) {
      return imageUrl;
    }
    addRenderLogWithTokens({
      type: 'keyframe',
      resourceId: 'image-' + Date.now(),
      resourceName: prompt.substring(0, 50) + '...',
      status: 'success',
      model: imageModelId,
      prompt,
      duration: Date.now() - startTime
    });
    return imageUrl;
  } catch (error: any) {
    addRenderLogWithTokens({
      type: 'keyframe',
      resourceId: 'image-' + Date.now(),
      resourceName: prompt.substring(0, 50) + '...',
      status: 'failed',
      model: imageModelId,
      prompt: prompt,
      error: error.message,
      duration: Date.now() - startTime
    });

    throw error;
  }
};

// ============================================
// 角色九宫格造型设计（Turnaround Sheet）
// ============================================

/**
 * 角色九宫格造型设计 - 默认视角布局
 * 覆盖常用的拍摄角度，确保角色从各方向都有参考
 */
const resolveSupportedAspectRatio = (
  preferredOrder: AspectRatio[],
  fallback: AspectRatio
): AspectRatio => {
  const activeImageModel = getActiveModel('image');
  const supportedRatios =
    activeImageModel?.type === 'image'
      ? activeImageModel.params.supportedAspectRatios
      : undefined;

  if (supportedRatios && supportedRatios.length > 0) {
    for (const ratio of preferredOrder) {
      if (supportedRatios.includes(ratio)) {
        return ratio;
      }
    }
    return supportedRatios[0];
  }

  return fallback;
};

/**
 * 角色定妆/服装变体使用竖构图，与场景 16:9 脱钩，避免横图切脚。
 */
export const resolveCharacterCastingAspectRatio = (): AspectRatio => {
  return resolveSupportedAspectRatio(['9:16', '1:1', '16:9'], '9:16');
};

const resolveTurnaroundAspectRatio = (): AspectRatio => {
  return resolveSupportedAspectRatio(['1:1', '9:16', '16:9'], '1:1');
};

export const CHARACTER_TURNAROUND_LAYOUT = {
  panelCount: 9,
  defaultPanels: [
    { index: 0, viewAngle: '正面', shotSize: '全身', description: '' },
    { index: 1, viewAngle: '正面', shotSize: '半身特写', description: '' },
    { index: 2, viewAngle: '正面', shotSize: '面部特写', description: '' },
    { index: 3, viewAngle: '左侧面', shotSize: '全身', description: '' },
    { index: 4, viewAngle: '右侧面', shotSize: '全身', description: '' },
    { index: 5, viewAngle: '3/4侧面', shotSize: '半身', description: '' },
    { index: 6, viewAngle: '背面', shotSize: '全身', description: '' },
    { index: 7, viewAngle: '仰视', shotSize: '半身', description: '' },
    { index: 8, viewAngle: '俯视', shotSize: '半身', description: '' },
  ],
  viewAngles: ['正面', '左侧面', '右侧面', '3/4左侧', '3/4右侧', '背面', '仰视', '俯视', '斜后方'],
  shotSizes: ['全身', '半身', '半身特写', '面部特写', '大特写'],
  positionLabels: [
    '左上 (Top-Left)', '中上 (Top-Center)', '右上 (Top-Right)',
    '左中 (Middle-Left)', '正中 (Center)', '右中 (Middle-Right)',
    '左下 (Bottom-Left)', '中下 (Bottom-Center)', '右下 (Bottom-Right)'
  ],
};

/**
 * 生成角色九宫格造型描述（AI拆分9个视角）
 * 根据角色信息和视觉提示词，生成9个不同视角的详细描述
 */
export const generateCharacterTurnaroundPanels = async (
  character: Character,
  visualStyle: string,
  artDirection?: ArtDirection,
  language: string = '中文',
  model: string = getActiveChatModelName(),
  abortSignal?: AbortSignal
): Promise<CharacterTurnaroundPanel[]> => {
  console.log(`🎭 generateCharacterTurnaroundPanels - 为角色 ${character.name} 生成九宫格造型视角`);
  logScriptProgress(`正在为角色「${character.name}」生成九宫格造型视角描述...`);

  const stylePrompt = getStylePrompt(visualStyle);

  // 构建 Art Direction 注入
  const artDirectionBlock = artDirection ? `
## GLOBAL ART DIRECTION (MANDATORY)
${artDirection.consistencyAnchors}
Color Palette: Primary=${artDirection.colorPalette.primary}, Secondary=${artDirection.colorPalette.secondary}, Accent=${artDirection.colorPalette.accent}
Character Design: Proportions=${artDirection.characterDesignRules.proportions}, Eye Style=${artDirection.characterDesignRules.eyeStyle}
Lighting: ${artDirection.lightingStyle}, Texture: ${artDirection.textureStyle}
` : '';

  const prompt = `You are a character design director for ${visualStyle}.
Create a 3x3 CHARACTER TURNAROUND plan (9 panels) for the SAME character.

${artDirectionBlock}
Character:
- Name: ${character.name}
- Form: ${character.species || 'follow the visual description'}
- Gender: ${character.gender}
- Age: ${character.age}
- Personality: ${character.personality}
- Visual Description: ${character.visualPrompt || 'Not specified'}

Visual Style: ${visualStyle} (${stylePrompt})

Required panel layout (index 0-8):
0 Top-Left: 正面 / 全身
1 Top-Center: 正面 / 半身特写
2 Top-Right: 正面 / 面部特写
3 Middle-Left: 左侧面 / 全身
4 Center: 右侧面 / 全身
5 Middle-Right: 3/4侧面 / 半身
6 Bottom-Left: 背面 / 全身
7 Bottom-Center: 仰视 / 半身
8 Bottom-Right: 俯视 / 半身

Output JSON only:
{
  "panels": [
    { "index": 0, "viewAngle": "正面", "shotSize": "全身", "description": "..." }
  ]
}

Rules:
- Exactly 9 panels, index 0-8 in order
- description is CAMERA/POSE only (angle, shot size, body orientation). Do NOT restate identity, covering, or attire — those come from the lookbook photo
- Do NOT introduce backpacks, bags, weapons, letters, or handheld hero props
- Full-body panels must show the complete figure with all extremities visible
- Neutral studio backdrop in every panel; no location scenery
- description must be one concise English sentence (10-30 words)`;

  try {
    const buildPanels = (parsed: any): CharacterTurnaroundPanel[] => {
      const built: CharacterTurnaroundPanel[] = [];
      const rawPanels = Array.isArray(parsed.panels) ? parsed.panels : [];
      for (let i = 0; i < 9; i++) {
        const raw = rawPanels[i];
        if (raw) {
          built.push({
            index: i,
            viewAngle: String(raw.viewAngle || CHARACTER_TURNAROUND_LAYOUT.defaultPanels[i].viewAngle).trim(),
            shotSize: String(raw.shotSize || CHARACTER_TURNAROUND_LAYOUT.defaultPanels[i].shotSize).trim(),
            description: String(raw.description || '').trim(),
          });
        } else {
          built.push({
            ...CHARACTER_TURNAROUND_LAYOUT.defaultPanels[i],
            description: `${character.visualPrompt || character.name}, ${CHARACTER_TURNAROUND_LAYOUT.defaultPanels[i].viewAngle} view, ${CHARACTER_TURNAROUND_LAYOUT.defaultPanels[i].shotSize}`,
          });
        }
      }
      return built;
    };

    const validatePanels = (items: CharacterTurnaroundPanel[]): string | null => {
      if (items.length !== 9) return `panels 数量错误（${items.length}）`;
      for (const p of items) {
        if (!p.viewAngle || !p.shotSize || !p.description) {
          return `panel ${p.index} 字段缺失`;
        }
        const words = countEnglishWords(p.description);
        if (words < 10 || words > 30) {
          return `panel ${p.index} description 词数为 ${words}，要求 10-30`;
        }
      }
      return null;
    };

    const responseText = await retryOperation(
      () => chatCompletion(prompt, model, 0.4, 4096, 'json_object', 600000, abortSignal),
      3,
      2000,
      abortSignal
    );
    let parsed = parseJsonWithRecovery<any>(responseText, {});
    let panels = buildPanels(parsed);
    let validationError = validatePanels(panels);

    if (validationError) {
      const repairPrompt = `${prompt}

Your previous output failed validation (${validationError}).
Rewrite and output JSON again with these strict rules:
1) panels must be exactly 9 items (index 0-8 in order)
2) each panel must include non-empty viewAngle, shotSize, description
3) each description must be ONE English sentence, 10-30 words
4) output JSON only, no explanation`;
      const repairedText = await retryOperation(
        () => chatCompletion(repairPrompt, model, 0.3, 4096, 'json_object', 600000, abortSignal),
        3,
        2000,
        abortSignal
      );
      parsed = parseJsonWithRecovery<any>(repairedText, {});
      panels = buildPanels(parsed);
      validationError = validatePanels(panels);
      if (validationError) {
        throw new Error(`角色九宫格视角描述校验失败：${validationError}`);
      }
    }

    console.log(`✅ 角色 ${character.name} 九宫格造型视角描述生成完成`);
    logScriptProgress(`角色「${character.name}」九宫格视角描述生成完成`);
    return panels;
  } catch (error: any) {
    console.error(`❌ 角色 ${character.name} 九宫格视角描述生成失败:`, error);
    logScriptProgress(`角色「${character.name}」九宫格视角描述生成失败`);
    throw error;
  }
};

/**
 * 生成角色九宫格造型图片
 * 将9个视角描述合成为一张3x3九宫格图片
 */
export const generateCharacterTurnaroundImage = async (
  character: Character,
  panels: CharacterTurnaroundPanel[],
  visualStyle: string,
  referenceImage?: string,
  artDirection?: ArtDirection,
  options?: { target?: GenerationTarget }
): Promise<string> => {
  console.log(`🖼️ generateCharacterTurnaroundImage - 为角色 ${character.name} 生成九宫格造型图片`);
  logScriptProgress(`正在为角色「${character.name}」生成九宫格造型图片...`);

  const activeImageModel = getActiveModel('image');
  const imageApiFormat = getImageApiFormat(activeImageModel as any);
  const isComfyUi = imageApiFormat === 'comfyui';
  const masterReference = referenceImage || character.referenceImage;

  if (isComfyUi && !masterReference) {
    throw new Error('造型九宫格需要先有角色定妆参考图，请先生成或上传定妆图后再试。');
  }

  const panelDescriptions = panels.map((p, idx) => {
    const position = CHARACTER_TURNAROUND_LAYOUT.positionLabels[idx];
    return `Panel ${idx + 1} (${position}): ${p.viewAngle} / ${p.shotSize} of the SAME subject from image 1.`;
  }).join('\n');

  const prompt = `Create ONE professional 3x3 character turnaround sheet of exactly the same subject shown in image 1.
Image 1 is the identity lock. Copy that exact appearance: body plan, head, markings, covering, and any attire already on the subject. Do not redesign. Do not invent a different subject. Do not add attire that is not in image 1. Do not change the body plan.

Arrange nine clearly separated panels in a clean 3x3 grid, left to right, top to bottom:
${panelDescriptions}

Constraints:
- Output one single 3x3 grid image only, all 9 panels visible
- Same subject in every panel
- Close-up panels show this subject's actual head as in image 1
- Full-body panels must show the complete figure with all extremities visible
- Neutral studio background, no location scenery, no backpacks or handheld props
- No extra subjects, no hybridized identity, no duplicated limbs, no text labels, no captions, no watermark`;

  const imageParams = (activeImageModel as any)?.params || {};
  const turnaroundWorkflow =
    imageParams.turnaroundWorkflowName ||
    'qwen_image_edit_2511_fp8_character_turnaround';
  const turnaroundSteps = imageParams.turnaroundSteps ?? 4;

  // 定妆图必须进入参考槽；九宫格按 image 1 锁身份，不再靠文字重画角色
  const referenceImages = masterReference ? [masterReference] : [];

  try {
    const turnaroundAspectRatio = resolveTurnaroundAspectRatio();
    const imageUrl = await generateImage(
      prompt,
      referenceImages,
      turnaroundAspectRatio,
      false,
      false,
      getNegativePrompt(visualStyle),
      {
        referencePackType: 'character',
        // ComfyUI：不要 skip 参考图；走专用 turnaround 工作流
        skipComfyImg2Img: false,
        characterReferenceImage: masterReference,
        workflowName: isComfyUi ? turnaroundWorkflow : undefined,
        steps: isComfyUi ? turnaroundSteps : undefined,
        target: options?.target,
      }
    );
    console.log(`✅ 角色 ${character.name} 九宫格造型图片生成完成`);
    logScriptProgress(`角色「${character.name}」九宫格造型图片生成完成`);
    return imageUrl;
  } catch (error: any) {
    console.error(`❌ 角色 ${character.name} 九宫格造型图片生成失败:`, error);
    logScriptProgress(`角色「${character.name}」九宫格造型图片生成失败`);
    throw error;
  }
};

/** Generate a production three-view sheet: front, side and back full-body views plus a portrait. */
export const generateCharacterThreeViewImage = async (
  character: Character,
  visualStyle: string,
  referenceImage?: string,
  options?: { target?: GenerationTarget }
): Promise<string> => {
  const activeImageModel = getActiveModel('image');
  const imageApiFormat = getImageApiFormat(activeImageModel as any);
  const isComfyUi = imageApiFormat === 'comfyui';
  const masterReference = referenceImage || character.referenceImage;

  if (isComfyUi && !masterReference) {
    throw new Error('三视图需要先有角色定妆参考图，请先生成或上传定妆图后再试。');
  }

  const prompt = `Create ONE professional character three-view reference sheet of exactly the same subject shown in image 1.
Image 1 is the identity lock. Preserve the exact face, apparent age, hairstyle, body proportions, clothing, colors, accessories, markings, and species. Do not redesign the subject.

Layout:
- Left area: three evenly spaced full-body views — front, clean side profile, and back.
- Right area: one large head-and-shoulders portrait matching the same identity.
- Every full-body view shows the complete figure and all extremities.
- Neutral seamless studio background and consistent soft production lighting.

Constraints:
- One single reference-sheet image, not separate files
- Same subject and same wardrobe in every view
- No action pose, no location scenery, no extra people or subjects
- No text labels, captions, logos, watermark, duplicated limbs, or cropped feet
- ${visualStyle} production-design quality, clean readable silhouette, high detail`;

  const imageParams = (activeImageModel as any)?.params || {};
  const workflowName = imageParams.turnaroundWorkflowName || 'qwen_image_edit_2511_fp8_character_turnaround';
  const steps = imageParams.turnaroundSteps ?? 4;
  const referenceImages = masterReference ? [masterReference] : [];

  return generateImage(
    prompt,
    referenceImages,
    resolveSupportedAspectRatio(['16:9', '1:1', '9:16'], '16:9'),
    false,
    false,
    getNegativePrompt(visualStyle),
    {
      referencePackType: 'character',
      skipComfyImg2Img: false,
      characterReferenceImage: masterReference,
      workflowName: isComfyUi ? workflowName : undefined,
      steps: isComfyUi ? steps : undefined,
      target: options?.target,
    }
  );
};
