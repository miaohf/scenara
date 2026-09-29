export type StoryFormId = 'dramatic' | 'documentary' | 'other';

export const DEFAULT_STORY_FORM: StoryFormId = 'dramatic';

export const isStoryFormId = (value: unknown): value is StoryFormId => (
  value === 'dramatic' || value === 'documentary' || value === 'other'
);

/** 未选择，或「其他」没有填写名称时，都回到短片。 */
export const resolveStoryForm = (form?: StoryFormId, customLabel?: string): { form: StoryFormId; label?: string } => {
  const label = customLabel?.trim();
  if (form === 'documentary') return { form: 'documentary' };
  if (form === 'other' && label) return { form: 'other', label };
  return { form: 'dramatic' };
};

export const storyFormLabel = (form: StoryFormId | undefined, customLabel?: string): string => {
  const resolved = resolveStoryForm(form, customLabel);
  if (resolved.form === 'documentary') return '纪录片';
  if (resolved.form === 'other') return resolved.label || '短片';
  return '短片';
};

/** Empty for the default short-film form, so existing prompts stay unchanged. */
export const storyFormGuidanceHeader = (form?: StoryFormId, customLabel?: string): string => {
  const resolved = resolveStoryForm(form, customLabel);
  if (resolved.form === 'dramatic') return '';
  if (resolved.form === 'documentary') {
    return '## 体裁\n本任务是纪录片。保持介绍、观察和解释，禁止改写成短片的人物冲突、角色弧光或戏剧高潮。\n';
  }
  const name = resolved.label || '短片';
  return `## 体裁\n本任务体裁是「${name}」。按该体裁的惯例写作，不要套用短片的人物冲突、角色弧光和高潮反转，除非该体裁本身需要。\n`;
};

export interface RewriteVoice {
  planner: string;
  writer: string;
  goals: string;
  hardConstraints: string;
  planFieldGuide: string;
  shootableRule: string;
  reviewFocus: string;
  reviewPriority: string;
  repairFactLock: string;
  lengthCaution: string;
  fallback: {
    rewriteGoal: string;
    factLock: string;
    openingHook: string;
    centralConflict: string;
    escalation: string;
    climax: string;
    payoff: string;
    visual: string;
    pacing: string[];
    continuityLock: string;
  };
  planLabels: {
    hook: string;
    conflict: string;
    escalation: string;
    climax: string;
    payoff: string;
  };
}

export const getRewriteVoice = (form?: StoryFormId, customLabel?: string): RewriteVoice | null => {
  const resolved = resolveStoryForm(form, customLabel);
  if (resolved.form === 'dramatic') return null;
  if (resolved.form === 'documentary') {
    return {
      planner: '你是纪录片项目的撰稿与统筹。先分析原稿并给出可公开展示、可执行的改写方案；不要输出隐藏推理过程。',
      writer: '你是执行改写的纪录片撰稿。严格依据“已批准改写方案”改写原稿。',
      goals: '目标：让地点、主题、事实和观看理由更清楚，旁白与画面对应，信息按空间、时间或主题递进，结尾留下可记住的印象。不要发明主角、对手或戏剧冲突，同时让后续分镜可以直接消费画面。',
      hardConstraints: `- 保留原稿中的地点、专名、数字、年代、旁白语言和已陈述的事实；除非用户明确要求改变。
- 不发明主角、对手、人物弧光或戏剧冲突，也不把不确定的内容写成定论。
- 不随意增加原稿没有的地点、事件或角色。`,
      planFieldGuide: `字段按纪录片理解，不要写成剧情冲突：
- openingHook：开场如何建立地点、主题与观看理由
- centralConflict：本片要回答的核心问题，不是人物对抗
- escalation：信息按空间、时间或主题如何递进
- climax：最有代表性的场面或事实
- payoff：结尾留下的地点印象或开放问题`,
      shootableRule: '- 让旁白对应可见的环境、活动、物件、声音和光线；不要把说明改成角色表演。',
      reviewFocus: '检查：事实忠实度、信息是否按主题递进、旁白是否具体且能被画面印证、地点与画面连续性、结尾印象、字符完整性和 Markdown 场次结构。不要因为缺少人物冲突、角色弧光或戏剧高潮而要求修复。只有会明显影响事实、解说或后续分镜的具体问题才要求修复。',
      reviewPriority: '- 优先评价事实是否守住、解说是否清楚、画面是否可执行，以及地点印象是否成立。',
      repairFactLock: '- 不改变原稿已陈述的地点、专名、数字、年代和旁白语言。没有角色和戏剧结局时不要补写。',
      lengthCaution: '不得牺牲事实、解说和画面质量来机械凑字数',
      fallback: {
        rewriteGoal: '按纪录片整理开场、核心问题和信息递进，保留旁白与可拍摄画面的对应。',
        factLock: '保留原稿地点、专名、数字、年代、旁白语言和已陈述事实',
        openingHook: '开场标明地点或主题，并给出继续看下去的具体理由。',
        centralConflict: '用一个可核对的问题组织全片，不设置人物对手。',
        escalation: '按空间、时间或主题逐段补充新事实，不重复同一句介绍。',
        climax: '把最有代表性的场面或事实放在信息最清楚的位置。',
        payoff: '结尾留下可记住的地点印象或一个尚未展开的具体问题。',
        visual: '用环境、活动、物件、天气、声音和光线表达地点，不依赖角色表演。',
        pacing: ['先建立地点', '按主题补充事实', '呈现代表场面', '用一个具体印象收束'],
        continuityLock: '地点、专名、数字、年代、旁白语言和已陈述事实不得无故改变。',
      },
      planLabels: {
        hook: '开场',
        conflict: '核心问题',
        escalation: '信息递进',
        climax: '代表场面',
        payoff: '结尾印象',
      },
    };
  }
  const name = resolved.label || '短片';
  return {
    planner: `你是「${name}」体裁的编剧统筹。先分析原稿并给出可公开展示、可执行的改写方案；不要输出隐藏推理过程。`,
    writer: `你是执行改写的「${name}」编剧。严格依据“已批准改写方案”改写原稿。`,
    goals: `目标：按「${name}」的惯例提高清晰度、节奏和可拍摄性。不要把原稿改成短片，除非该体裁本身就是短片。`,
    hardConstraints: `- 保留原稿核心事实、专名、语言和已有结局；除非用户明确要求改变。
- 按「${name}」写作。不要无故添加主角、对手、人物弧光或戏剧高潮。
- 不随意增加原稿没有的角色、事件或设定。`,
    planFieldGuide: `字段按「${name}」理解，不要默认成剧情冲突：
- openingHook：开场
- centralConflict：这段要完成的核心任务
- escalation：内容如何推进
- climax：重点段落
- payoff：收束`,
    shootableRule: `- 让画面、声音和文本符合「${name}」的表达习惯，并保持可拍摄。`,
    reviewFocus: `检查：体裁是否仍是「${name}」、事实忠实度、推进是否符合该体裁、视觉可拍摄性、字符完整性和 Markdown 场次结构。不要用短片的冲突和角色弧光标准否决终稿。只有会明显影响该体裁表达或后续分镜的具体问题才要求修复。`,
    reviewPriority: `- 优先评价体裁是否保持、事实是否守住、文本是否清楚，以及画面是否可执行。`,
    repairFactLock: `- 不改变原稿核心事实、专名和语言。不要把正文改写成另一种体裁。`,
    lengthCaution: '不得牺牲该体裁的表达和画面质量来机械凑字数',
    fallback: {
      rewriteGoal: `按「${name}」整理开场、推进和收束，不改成短片。`,
      factLock: '保留原稿事实、专名、语言和体裁',
      openingHook: `用符合「${name}」的方式打开。`,
      centralConflict: `明确这段「${name}」要完成的任务。`,
      escalation: '按该体裁需要的顺序推进新信息，不重复同一内容。',
      climax: '把最需要被记住的段落放在清楚的位置。',
      payoff: '按该体裁收束，不额外制造戏剧反转。',
      visual: '保留该体裁需要的说明、旁白或对白，并让画面可拍摄。',
      pacing: ['建立题目', '推进新信息', '呈现重点', '收束'],
      continuityLock: `事实、专名、语言，以及「${name}」这一体裁不得无故改变。`,
    },
    planLabels: {
      hook: '开场',
      conflict: '核心任务',
      escalation: '推进',
      climax: '重点段落',
      payoff: '收束',
    },
  };
};

export interface ContinueVoice {
  persona: string;
  rule1: string;
  rule2: string;
  rule3: string;
  rule5: string;
  rule8: string;
}

export const getContinueVoice = (form?: StoryFormId, customLabel?: string): ContinueVoice | null => {
  const resolved = resolveStoryForm(form, customLabel);
  if (resolved.form === 'dramatic') return null;
  if (resolved.form === 'documentary') {
    return {
      persona: '你是一位纪录片撰稿。请在充分理解下方已有文稿的基础上，续写后续介绍。',
      rule1: '1. 严格保持原文稿的风格、旁白语气、事实口径和叙述节奏，确保无明显风格断层。',
      rule2: '2. 内容衔接自然，地点和事实连续，避免突然跳到无关主题。',
      rule3: '3. 继续介绍下一段可核对的事实、地点或观察，不要新增人物冲突或角色弧光。',
      rule5: '5. 保持原稿格式，包括旁白、场景和画面描述。只有原稿已有采访时才写对白。',
      rule8: '8. 若信息量过大，请保留下一段最需要交代的事实或画面，不要为了紧凑改成戏剧冲突。',
    };
  }
  const name = resolved.label || '短片';
  return {
    persona: `你是一位「${name}」撰稿。请在充分理解下方已有文稿的基础上，按该体裁续写。`,
    rule1: `1. 严格保持原文稿的风格、语气和「${name}」的叙述节奏，确保无明显风格断层。`,
    rule2: '2. 内容衔接自然，事实和设定连续，避免突然跳到无关主题。',
    rule3: `3. 按「${name}」的惯例续写，不要改写成剧情冲突，除非该体裁本身需要。`,
    rule5: '5. 保持原稿格式。该体裁需要旁白或说明时予以保留，不要一律改成人物对白。',
    rule8: '8. 若信息量过大，请保留下一段该体裁最需要的内容，不要为了紧凑改成戏剧冲突。',
  };
};

export const segmentFormRule = (form?: StoryFormId, customLabel?: string): string => {
  const resolved = resolveStoryForm(form, customLabel);
  if (resolved.form === 'dramatic') return '';
  if (resolved.form === 'documentary') {
    return '6. 这是纪录片选段。保持介绍和旁白，不要改成人物冲突、角色弧光或戏剧高潮。';
  }
  const name = resolved.label || '短片';
  return `6. 这是「${name}」选段。按该体裁改写，不要改成短片，除非该体裁本身是短片。`;
};
