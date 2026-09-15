/**
 * 提示词常量
 * 统一管理所有视觉风格相关的提示词映射，消除各函数中的重复定义
 */

// ============================================
// 英文视觉风格提示词（用于 AI 图像生成 prompt）
// ============================================

export const VISUAL_STYLE_PROMPTS: { [key: string]: string } = {
  'live-action': 'photorealistic, cinematic film quality, real human actors, professional cinematography, natural lighting, 8K resolution, shallow depth of field, film grain texture, color graded, anamorphic lens flare, three-point lighting setup',
  'anime': 'Japanese anime style, cel-shaded, vibrant saturated colors, large expressive eyes with detailed iris highlights, dynamic action poses, clean sharp outlines, consistent line weight throughout, Studio Ghibli/Makoto Shinkai quality, painted sky backgrounds, soft ambient lighting with dramatic rim light',
  '2d-animation': 'classic 2D animation, hand-drawn style, Disney/Pixar quality, smooth clean lines with consistent weight, expressive characters with squash-and-stretch principles, painterly watercolor backgrounds, soft gradient shading, warm color palette, round friendly character proportions',
  '3d-animation': 'high-quality 3D CGI animation, Pixar/DreamWorks style, subsurface scattering on skin, detailed PBR textures, stylized character proportions, volumetric lighting, ambient occlusion, soft shadows, physically-based rendering, motion blur',
  'cyberpunk': 'cyberpunk aesthetic, neon-lit urban environment, rain-soaked reflective streets, holographic UI displays, high-tech low-life contrast, Blade Runner style, volumetric fog with neon color bleeding, chromatic aberration, cool blue-purple palette with hot pink and cyan accents, gritty detailed textures',
  'oil-painting': 'oil painting style, visible impasto brushstrokes, rich layered textures, classical art composition with golden ratio, museum quality fine art, warm undertones, Rembrandt lighting, chiaroscuro contrast, canvas texture visible, glazing technique color depth',
};

// ============================================
// 中文视觉风格描述（用于中文 prompt 和 UI 显示）
// ============================================

export const VISUAL_STYLE_PROMPTS_CN: { [key: string]: string } = {
  'live-action': '真人实拍电影风格，photorealistic，8K高清，专业摄影',
  'anime': '日本动漫风格，cel-shaded，鲜艳色彩，Studio Ghibli品质',
  '2d-animation': '经典2D动画风格，手绘风格，Disney/Pixar品质',
  '3d-animation': '3D CGI动画，Pixar/DreamWorks风格，精细材质',
  'cyberpunk': '赛博朋克美学，霓虹灯光，未来科技感',
  'oil-painting': '油画风格，可见笔触，古典艺术构图',
};

// ============================================
// 角色负面提示词（排除不想要的视觉元素）
// ============================================

export const NEGATIVE_PROMPTS: { [key: string]: string } = {
  'live-action': 'cartoon, anime, illustration, painting, drawing, 3d render, cgi, low quality, blurry, grainy, watermark, text, logo, signature, distorted face, bad anatomy, extra limbs, mutated hands, deformed, ugly, disfigured, poorly drawn, amateur',
  'anime': 'photorealistic, 3d render, western cartoon, ugly, bad anatomy, extra limbs, deformed limbs, blurry, watermark, text, logo, poorly drawn face, mutated hands, extra fingers, missing fingers, bad proportions, grotesque',
  '2d-animation': 'photorealistic, 3d, low quality, pixelated, blurry, watermark, text, bad anatomy, deformed, ugly, amateur drawing, inconsistent style, rough sketch',
  '3d-animation': 'photorealistic, 2d, flat, hand-drawn, low poly, bad topology, texture artifacts, z-fighting, clipping, low quality, blurry, watermark, text, bad rigging, unnatural movement',
  'cyberpunk': 'bright daylight, pastoral, medieval, fantasy, cartoon, low tech, rural, natural, watermark, text, logo, low quality, blurry, amateur',
  'oil-painting': 'digital art, photorealistic, 3d render, cartoon, anime, low quality, blurry, watermark, text, amateur, poorly painted, muddy colors, overworked canvas',
};

// ============================================
// 场景专用负面提示词（额外排除人物/人形元素）
// ============================================

export const SCENE_NEGATIVE_PROMPTS: { [key: string]: string } = {
  'live-action': 'person, people, human, man, woman, child, figure, silhouette, crowd, pedestrian, portrait, face, body, hands, feet, ' + NEGATIVE_PROMPTS['live-action'],
  'anime': 'person, people, human, character, figure, silhouette, crowd, portrait, face, body, hands, ' + NEGATIVE_PROMPTS['anime'],
  '2d-animation': 'person, people, human, character, figure, silhouette, crowd, portrait, face, body, ' + NEGATIVE_PROMPTS['2d-animation'],
  '3d-animation': 'person, people, human, character, figure, silhouette, crowd, portrait, face, body, ' + NEGATIVE_PROMPTS['3d-animation'],
  'cyberpunk': 'person, people, human, figure, silhouette, crowd, pedestrian, portrait, face, body, ' + NEGATIVE_PROMPTS['cyberpunk'],
  'oil-painting': 'person, people, human, figure, silhouette, crowd, portrait, face, body, ' + NEGATIVE_PROMPTS['oil-painting'],
};

/**
 * 获取视觉风格的英文提示词，如果风格不在预设中则原样返回
 */
export const getStylePrompt = (visualStyle: string): string => {
  return VISUAL_STYLE_PROMPTS[visualStyle] || visualStyle;
};

/**
 * 获取视觉风格的中文描述，如果风格不在预设中则原样返回
 */
export const getStylePromptCN = (visualStyle: string): string => {
  return VISUAL_STYLE_PROMPTS_CN[visualStyle] || visualStyle;
};

/**
 * 获取角色负面提示词
 */
export const getNegativePrompt = (visualStyle: string): string => {
  return NEGATIVE_PROMPTS[visualStyle] || NEGATIVE_PROMPTS['live-action'];
};

/**
 * 获取场景负面提示词
 */
export const getSceneNegativePrompt = (visualStyle: string): string => {
  return SCENE_NEGATIVE_PROMPTS[visualStyle] || SCENE_NEGATIVE_PROMPTS['live-action'];
};

/** 定妆生图正向构图锁：全身棚拍、不含随身道具。不写入已存储的 visualPrompt。不预设人形或动物。 */
export const CHARACTER_CASTING_POSITIVE_LOCK =
  'full-body character lookbook, entire figure in frame, all extremities visible, typical stance for this subject, small margin around the figure, render the specified facial structure as a primary identity anchor with distinctive asymmetry and concrete features, follow the covering and garments already described, no carried items, neutral seamless studio backdrop, no environment, no location scenery';

/** 仅人形定妆追加：剧本没写衣服时补日常穿搭，避免裸模。 */
export const CHARACTER_CASTING_HUMAN_ATTIRE_LOCK =
  'fully clothed with shoes, complete everyday outfit if garments are not already specified, no nude, no bare mannequin, no underwear-only';

/** 定妆生图专用负面词：只在定妆/变体请求里追加，禁止写入 character.negativePrompt（会被首尾帧继承）。 */
export const CHARACTER_CASTING_NEGATIVE =
  'cropped, close-up, medium shot, bust shot, cut-off, incomplete body, busy background, scenic environment, location scenery, hybridized subject, mixed identity, generic face, same face as another character, duplicated facial features, identical face, beauty-filter face, interchangeable model face';

/** 仅人形定妆追加的衣着负面词。不要用于动物，避免反向催生服装。 */
export const CHARACTER_CASTING_HUMAN_ATTIRE_NEGATIVE =
  'nude, naked, unclothed, bare body, bare mannequin, underwear only';

/** 角色定妆衣着：只约束会穿衣服的人形；其他角色沿用 Surface 的天然被覆即可。 */
export const CHARACTER_ATTIRE_INSTRUCTION =
  'If this character is human or humanoid, describe a complete outfit with shoes. Use garments from the character data when present; otherwise invent a simple everyday outfit that fits the role, personality, age, and visual style (top + bottom or equivalent set, plus shoes). Never leave a human lookbook nude or as a featureless unclothed mannequin. If this character is not a clothed human or humanoid, omit attire and keep the Surface covering already described.';

/** 参考图身份锁：只复制参考主体，不改身体结构、不加参考里没有的衣着。 */
export const CHARACTER_IDENTITY_LOCK =
  'IDENTITY LOCK: Match the provided reference subject exactly — appearance, body plan, and any attire already shown. Do not redesign. Do not add attire that is not in the reference. Do not add carried hero props.';

export const getCharacterCastingNegativePrompt = (visualStyle: string): string => {
  return `${getNegativePrompt(visualStyle)}, ${CHARACTER_CASTING_NEGATIVE}`;
};

export const listProjectPropNames = (
  props?: Array<{ name?: string; isWearable?: boolean } | string> | null
): string[] => {
  if (!props || props.length === 0) return [];
  const names = props
    // Wearable entries are derived from the character wardrobe. They must stay
    // in character prompts; only independent hero props should be stripped.
    .filter((item) => typeof item === 'string' || !isWearableProp(item))
    .map((item) => (typeof item === 'string' ? item : item.name || ''))
    .map((name) => name.trim())
    .filter(Boolean);
  return Array.from(new Set(names));
};

const WEARABLE_PROP_NAME_RE =
  /\b(coat|jacket|shirt|sweater|hoodie|trouser|trousers|pants|jeans|scarf|boot|boots|shoe|shoes|dress|skirt|hat|cap|glove|gloves|uniform|raincoat)\b|雨衣|外套|夹克|衬衫|毛衣|卫衣|裤|围巾|靴|鞋|裙|帽|手套|制服/i;

/** 兼容旧项目：旧数据没有 isWearable 时，按服装名称识别可穿戴条目。 */
export const isWearableProp = (prop: { name?: string; isWearable?: boolean } | string): boolean => {
  if (typeof prop === 'string') return WEARABLE_PROP_NAME_RE.test(prop);
  return prop.isWearable === true || WEARABLE_PROP_NAME_RE.test(prop.name || '');
};

/** 从旧项目的服装道具中恢复角色基础服装，供生成前兜底使用。 */
export const inferCharacterWardrobe = (
  character: CharacterSpeciesSource | undefined,
  props?: Array<{ name?: string; isWearable?: boolean; description?: string } | string> | null
): string => {
  const explicit = character?.wardrobe?.trim() || '';
  const name = character?.name?.trim();
  const inferred = (props || [])
    .filter((item) => isWearableProp(item))
    .filter((item) => {
      if (typeof item === 'string' || !name) return true;
      const text = `${item.name || ''} ${item.description || ''}`;
      return new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(text);
    })
    .map((item) => (typeof item === 'string' ? item.trim() : (item.name || '').trim()))
    .filter(Boolean);

  // 新数据以 character.wardrobe 为主；旧数据可能仍把服装保存在 props 中。
  // 两者必须合并，否则 UI 虽然显示已绑定服装，生成提示词却会漏掉其中一部分。
  return Array.from(new Set([explicit, ...inferred].filter(Boolean))).join('; ');
};

/** 将角色基础服装作为单一事实源写回定妆提示词，避免 LLM 或清理逻辑改色/换装。 */
export const normalizeCharacterWardrobeInPrompt = (
  prompt: string,
  character?: CharacterSpeciesSource
): string => {
  const wardrobe = character?.wardrobe?.trim();
  if (!prompt || !wardrobe) return prompt;

  const attire = `Attire: ${wardrobe}`;
  const attirePattern = /Attire:\s*.*?(?=,\s*Pose\s*&\s*Framing:|\n|$)/i;
  if (attirePattern.test(prompt)) {
    return prompt.replace(attirePattern, attire);
  }
  return `${prompt}\n\n${attire}. Preserve every garment, color, material, and silhouette exactly.`;
};

export const stripProjectPropsFromPrompt = (prompt: string, propNames: string[]): string => {
  if (!prompt || propNames.length === 0) return prompt;

  let next = prompt;
  const uniqueNames = listProjectPropNames(propNames).sort((a, b) => b.length - a.length);
  for (const name of uniqueNames) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const isAsciiWord = /^[A-Za-z0-9][A-Za-z0-9 '\-]*$/.test(name);
    const pattern = isAsciiWord ? new RegExp(`\\b${escaped}\\b`, 'gi') : new RegExp(escaped, 'g');
    next = next.replace(pattern, '');
  }

  return next
    .replace(/\s+,/g, ',')
    .replace(/,\s*,+/g, ',')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[,;，；\s]+|[,;，；\s]+$/g, '')
    .trim();
};

export const buildCharacterLookbookPromptRules = (excludePropNames?: string[]): string => {
  const names = listProjectPropNames(excludePropNames);
  const namedExclusion = names.length > 0
    ? `- Do NOT mention, describe, or imply these project props in the visual prompt: ${names.join(', ')}.`
    : '';

  return `CASTING LOOKBOOK RULES (MANDATORY):
- This is a character lookbook, NOT a story still.
- Describe the subject as given in the character data. Do not invent a different kind of being.
- Attire: ${CHARACTER_ATTIRE_INSTRUCTION}
- Do NOT include backpacks, bags, weapons, letters, handheld objects, or other hero props.
- Do NOT write project prop names into the visual prompt.
${namedExclusion}
- If the story implies a carried item, omit it; props are generated separately and added in shots.
- Framing: full figure, typical stance for this subject, all extremities visible, small margin around the figure.
- Background: neutral seamless studio backdrop only. Ignore environment/location cues in style keywords.`;
};

const shouldLockHumanAttire = (character?: CharacterSpeciesSource): boolean => {
  if (!character) return true;
  return resolveCharacterSpecies(character).kind !== 'animal';
};

/** 重新生图时只注入请求、不写入 visualPrompt。Qwen 等模型对锁死提示词几乎无种子多样性。 */
const LOOKBOOK_REGENERATE_POSES = [
  'weight on the back foot, slight contrapposto, arms relaxed, chin level',
  'small step toward camera, shoulders square, hands loosely at sides',
  'three-quarter body turn, face toward camera, relaxed knees',
  'feet planted, one knee soft, gaze slightly off-camera',
  'square stance, shoulders dropped, looking just past the lens',
];

export const buildLookbookRegenerateVariation = (): string => {
  const pose = LOOKBOOK_REGENERATE_POSES[Math.floor(Math.random() * LOOKBOOK_REGENERATE_POSES.length)];
  const take = Math.floor(Math.random() * 9000) + 1000;
  return `NEW LOOKBOOK TAKE ${take}: ${pose}. Keep identity and described attire. This must be a visibly different photograph from previous takes: change pose, gaze, and micro-expression. Do not reproduce a previous frame.`;
};

export const applyCharacterCastingPositivePrompt = (
  prompt: string,
  propNames: string[] = [],
  character?: CharacterSpeciesSource
): string => {
  const wardrobeLocked = normalizeCharacterWardrobeInPrompt(prompt, character);
  const stripped = stripProjectPropsFromPrompt(wardrobeLocked, propNames);
  const lockHumanAttire = shouldLockHumanAttire(character);
  const lock = lockHumanAttire
    ? `${CHARACTER_CASTING_POSITIVE_LOCK}, ${CHARACTER_CASTING_HUMAN_ATTIRE_LOCK}`
    : CHARACTER_CASTING_POSITIVE_LOCK;
  if (!stripped) return lock;
  if (stripped.includes('full-body character lookbook')) {
    if (lockHumanAttire && !/fully clothed/i.test(stripped)) {
      return `${stripped}\n\n${CHARACTER_CASTING_HUMAN_ATTIRE_LOCK}`;
    }
    return stripped;
  }
  return `${stripped}\n\n${lock}`;
};

export const mergeCharacterCastingNegativePrompt = (
  visualStyle: string,
  storedNegative?: string,
  character?: CharacterSpeciesSource
): string => {
  const base = storedNegative?.trim() || getNegativePrompt(visualStyle);
  const attireNegative = shouldLockHumanAttire(character)
    ? `${CHARACTER_CASTING_HUMAN_ATTIRE_NEGATIVE}, wardrobe substitution, incorrect garment color, incorrect garment material, `
    : '';
  const merged = `${base}, ${attireNegative}${CHARACTER_CASTING_NEGATIVE}`;
  return merged.replace(/,\s*,+/g, ',').replace(/,\s*$/, '');
};

export type CharacterSpeciesKind = 'human' | 'animal' | 'creature';

export interface CharacterSpeciesInfo {
  kind: CharacterSpeciesKind;
  label: string;
}

export interface CharacterSpeciesSource {
  name?: string;
  gender?: string;
  age?: string;
  personality?: string;
  visualPrompt?: string;
  wardrobe?: string;
  coreFeatures?: string;
  species?: string;
}

const HUMAN_SPECIES_LABEL = /^(human|person|humans|人类|人)$/i;

const ANTHRO_SPECIES_RE =
  /anthropomorphic|anthro\b|furry\b|humanoid animal|animal-headed|拟人|兽人|动物人形/i;

const ANIMAL_SPECIES_RE =
  /\b(dog|cat|puppy|kitten|wolf|fox|bear|rabbit|bunny|bird|horse|lion|tiger|leopard|panda|monkey|mouse|pig|cow|sheep|goat|deer|elephant|duck|chicken|owl|eagle|snake|fish|dragon|dinosaur|canine|feline|hound|retriever|shepherd|corgi|husky|labrador|animal|creature|beast|pet|quadruped)\b|狗|猫|犬|狼|狐|熊|兔|鸟|马|狮|虎|豹|熊猫|猴|鼠|猪|牛|羊|鹿|象|鸭|鸡|猫头鹰|鹰|蛇|鱼|龙|恐龙|宠物|动物|野兽|幼犬|幼猫|牧羊犬|柴犬|柯基|金毛|拉布拉多|哈士奇/;

const extractSpeciesMatch = (text: string): string => {
  const match = text.match(ANIMAL_SPECIES_RE);
  return match?.[0]?.trim() || '';
};

/** 从角色字段推断物种，避免把动物定妆写成人类。 */
export const resolveCharacterSpecies = (
  character: CharacterSpeciesSource
): CharacterSpeciesInfo => {
  const explicit = (character.species || '').trim();
  const blob = [
    explicit,
    character.name,
    character.gender,
    character.age,
    character.personality,
    character.coreFeatures,
    character.visualPrompt,
  ]
    .filter(Boolean)
    .join(' ');

  if (explicit && !HUMAN_SPECIES_LABEL.test(explicit)) {
    const kind: CharacterSpeciesKind = ANTHRO_SPECIES_RE.test(explicit) || ANTHRO_SPECIES_RE.test(blob)
      ? 'creature'
      : 'animal';
    return { kind, label: explicit };
  }

  if (ANTHRO_SPECIES_RE.test(blob)) {
    return { kind: 'creature', label: explicit || extractSpeciesMatch(blob) || 'non-human creature' };
  }
  if (ANIMAL_SPECIES_RE.test(blob)) {
    return { kind: 'animal', label: explicit || extractSpeciesMatch(blob) || 'animal' };
  }
  return { kind: 'human', label: explicit || 'human' };
};
