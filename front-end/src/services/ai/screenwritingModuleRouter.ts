export type ScreenwritingModuleId =
  | 'premise-theme'
  | 'character-conflict'
  | 'scene-craft'
  | 'dialogue'
  | 'shortform-pacing'
  | 'series-structure'
  | 'visual-storytelling'
  | 'genre-contract'
  | 'screenplay-format';

export interface ScreenwritingModule {
  id: ScreenwritingModuleId;
  title: string;
  diagnosticChecks: string[];
  rewriteDirectives: string[];
}

const MODULES: Record<ScreenwritingModuleId, ScreenwritingModule> = {
  'premise-theme': {
    id: 'premise-theme',
    title: 'Premise & Theme',
    diagnosticChecks: ['主角目标、阻力与代价是否明确', '主题是否通过选择和后果体现，而不是口号', '关键转折是否迫使主角在价值取舍中作出选择'],
    rewriteDirectives: ['保持核心前提不变', '让主题落在可见选择及其后果上', '避免让角色直接说教或替主题下结论'],
  },
  'character-conflict': {
    id: 'character-conflict',
    title: 'Character & Conflict',
    diagnosticChecks: ['角色每场是否有目标和阻力', '角色的表层欲望与内在需求是否形成可表演的张力', '冲突是否逐级升级并迫使角色改变策略'],
    rewriteDirectives: ['给主要角色明确的场景目标、策略和转折', '用行为冲突代替抽象心理解释', '让角色为目标付出代价，而不是轻易获得结果'],
  },
  'scene-craft': {
    id: 'scene-craft',
    title: 'Scene Craft',
    diagnosticChecks: ['场景是否在冲突、目标或压力已发生时进入，而非从寒暄开始', '场景是否有清楚的价值变化、信息揭示或不可逆后果', '场景是否在新的问题或冲突被点燃后及时退出'],
    rewriteDirectives: ['晚进早出：从冲突已在进行的位置开始，在转折或新问题出现后离开', '每场只承担清晰的叙事任务，并产生一次可辨认的状态变化', '建立可供分镜消费的空间关系、动作和结果；删去转折后的解释性收尾'],
  },
  dialogue: {
    id: 'dialogue',
    title: 'Dialogue',
    diagnosticChecks: ['说话人声音是否可区分', '对白是否有潜台词且长度适合表演', '每句关键台词是否在施压、试探、回避、争取或改变关系，而不只是说明信息'],
    rewriteDirectives: ['保留对白原语言', '让每句关键对白成为角色的行动或策略', '压缩解释性台词，用停顿、反应和潜台词传递信息；不要用台词重复画面已经表达的信息'],
  },
  'shortform-pacing': {
    id: 'shortform-pacing',
    title: 'Short-form Pacing',
    diagnosticChecks: ['开场是否快速建立异常、欲望或问题', '每个节拍是否推进信息、风险或情绪'],
    rewriteDirectives: ['尽早建立钩子', '删除重复确认同一信息的段落', '结尾提供明确回报或新悬念'],
  },
  'series-structure': {
    id: 'series-structure',
    title: 'Series Structure',
    diagnosticChecks: ['单集目标与季节主线是否区分', '伏笔建立、升级和回收是否有状态'],
    rewriteDirectives: ['保留单集闭环同时推进长期矛盾', '不要重复建立已回收伏笔'],
  },
  'visual-storytelling': {
    id: 'visual-storytelling',
    title: 'Visual Storytelling',
    diagnosticChecks: ['关键信息能否通过动作、道具和空间读出', '动作是否能在目标镜头时长内完成', '场景描述是否只包含观众能够看到或听到的内容'],
    rewriteDirectives: ['把内心说明转成可见动作、道具关系和环境变化', '避免在一个短节拍塞入多次状态切换', '用可拍摄、可听见的事实替代不可见的心理判断'],
  },
  'genre-contract': {
    id: 'genre-contract',
    title: 'Genre Contract',
    diagnosticChecks: ['类型承诺是否在开场建立，并在中段持续升级', '情节推进是否满足类型观众期待，同时保留至少一次有因果依据的意外'],
    rewriteDirectives: ['保留类型的核心体验和情绪节奏', '用角色选择与既有信息制造反转，避免为了反转而无因果跳跃'],
  },
  'screenplay-format': {
    id: 'screenplay-format',
    title: 'Screenplay Format',
    diagnosticChecks: ['动作、环境和声音是否都能被拍到或听到', '场景和动作描述是否简洁、连续并便于表演和分镜'],
    rewriteDirectives: ['用现在时、可拍摄的动作和简洁场景描述书写', '删除镜头外的解释、作者评论和无法执行的抽象指令'],
  },
};

const unique = <T>(values: T[]): T[] => Array.from(new Set(values));

export const routeScreenwritingModules = (input: {
  script: string;
  instruction?: string;
  targetDuration?: string;
  requestedModules?: ScreenwritingModuleId[];
}): ScreenwritingModule[] => {
  if (input.requestedModules?.length) {
    return unique(input.requestedModules).map((id) => MODULES[id]).filter(Boolean);
  }
  const text = `${input.script.slice(0, 12000)} ${input.instruction || ''}`.toLowerCase();
  const ids: ScreenwritingModuleId[] = ['premise-theme', 'character-conflict', 'scene-craft', 'visual-storytelling'];
  if (/对白|台词|dialogue|conversation|独白|旁白/.test(text)) ids.push('dialogue');
  if (/短剧|短片|短视频|竖屏|short[- ]?form|reel|tiktok|抖音/.test(text) || /秒|分钟|\b\d+\s*(?:s|sec|min)/.test(input.targetDuration || '')) {
    ids.push('shortform-pacing');
  }
  if (/第\s*\d+\s*集|episode|season|连续剧|系列|伏笔|cliffhanger/.test(text)) ids.push('series-structure');
  if (/类型|genre|悬疑|惊悚|恐怖|喜剧|爱情|动作|犯罪|科幻|奇幻|战争|西部|剧情/.test(text)) ids.push('genre-contract');
  if (/剧本格式|格式|format|场景标题|场次|slugline|action\s*line/.test(text)) ids.push('screenplay-format');
  return unique(ids).map((id) => MODULES[id]);
};

export const formatScreenwritingModules = (
  modules: ScreenwritingModule[],
  mode: 'diagnose' | 'rewrite',
): string => modules.map((module) => {
  const rules = mode === 'diagnose' ? module.diagnosticChecks : module.rewriteDirectives;
  return `### ${module.title}\n${rules.map((rule) => `- ${rule}`).join('\n')}`;
}).join('\n\n');

export const buildScreenwritingGuidance = (input: {
  script: string;
  instruction?: string;
  targetDuration?: string;
  requestedModules?: ScreenwritingModuleId[];
  mode: 'diagnose' | 'rewrite';
}): string => {
  const modules = routeScreenwritingModules(input);
  return `\n## 本任务加载的编剧模块（仅应用这些规则）\n${formatScreenwritingModules(modules, input.mode)}\n`;
};
