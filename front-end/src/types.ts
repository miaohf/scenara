export interface CharacterVariation {
  id: string;
  name: string; // e.g., "Casual", "Tactical Gear", "Injured"
  /** 该变体的服装事实描述；visualPrompt 保留作旧数据兼容和生图扩展。 */
  wardrobe?: string;
  /** 剧本解析时识别出的适用场景，用于自动选择镜头服装。 */
  sceneIds?: string[];
  visualPrompt: string;
  promptVersions?: PromptVersion[]; // Prompt edit history with rollback support
  negativePrompt?: string; // 负面提示词，用于排除不想要的元素
  referenceImage?: string; // 角色变体参考图，存储为base64格式（data:image/png;base64,...）
  status?: 'pending' | 'generating' | 'completed' | 'failed'; // 生成状态，用于loading状态持久化
}

/** 编剧/导演 Agent 为角色补充的创作意图，不覆盖剧本中的客观事实。 */
export interface CreativeCharacterDirection {
  dramaticFunction: string;
  desire: string;
  innerConflict: string;
  performanceNotes: string;
  silhouette: string;
  signatureFeatures: string[];
  /** 服装的叙事目的；显式服装事实仍以 wardrobe/variation 为准。 */
  wardrobeIntent: string;
}

/** 编剧/导演 Agent 为场景补充的戏剧与视觉意图。 */
export interface CreativeSceneDirection {
  narrativePurpose: string;
  conflict: string;
  emotionalTurn: string;
  visualMotif: string;
  continuityIn: string;
  continuityOut: string;
}

/** 角色在剧本中的用途；旧数据缺失时按名称/语义兼容推断。 */
export type CharacterRole = 'visual' | 'voice';

export type PromptVersionSource = 'ai-generated' | 'manual-edit' | 'rollback' | 'imported' | 'system';

export interface PromptVersion {
  id: string;
  prompt: string;
  createdAt: number;
  source: PromptVersionSource;
  note?: string;
}

/**
 * 分镜阶段提示词模板配置（可编辑）
 */
export interface StoryboardPromptTemplateConfig {
  shotGeneration: string;
  shotRepair: string;
  actionSuggestion: string;
  shotSplit: string;
}

/**
 * 首尾帧提示词模板配置（可编辑）
 */
export interface KeyframePromptTemplateConfig {
  startFrameGuide: string;
  endFrameGuide: string;
  characterConsistencyGuide: string;
  propWithImageGuide: string;
  propWithoutImageGuide: string;
  nineGridSourceMeta: string;
  optimizeBoth: string;
  optimizeSingle: string;
  enhance: string;
}

/**
 * 网格分镜提示词模板配置（可编辑）
 */
export interface NineGridPromptTemplateConfig {
  splitSystem: string;
  splitUser: string;
  imagePrefix: string;
  imagePanelTemplate: string;
  imageSuffix: string;
  imageNoTextConstraint: string;
  translatePrompt: string;
  rewritePrompt: string;
}

/**
 * 视频生成提示词模板配置（可编辑）
 */
export interface VideoPromptTemplateConfig {
  sora2Chinese: string;
  sora2English: string;
  sora2NineGridChinese: string;
  sora2NineGridEnglish: string;
  veoStartOnly: string;
  veoStartEnd: string;
  minimaxH3StartOnly: string;
  minimaxH3StartEnd: string;
  nineGridGuardrailsChinese: string;
  nineGridGuardrailsEnglish: string;
  endFrameConstraintNote: string;
  ignoredEndFrameNote: string;
}

/**
 * 当前项目可编辑的提示词模板集合
 */
export interface PromptTemplateConfig {
  storyboard: StoryboardPromptTemplateConfig;
  keyframe: KeyframePromptTemplateConfig;
  nineGrid: NineGridPromptTemplateConfig;
  video: VideoPromptTemplateConfig;
}

/**
 * 模板覆盖配置（仅存储用户改动）
 */
export interface PromptTemplateOverrides {
  storyboard?: Partial<StoryboardPromptTemplateConfig>;
  keyframe?: Partial<KeyframePromptTemplateConfig>;
  nineGrid?: Partial<NineGridPromptTemplateConfig>;
  video?: Partial<VideoPromptTemplateConfig>;
}

export interface QualityCheck {
  key: string;
  label: string;
  score: number; // 0-100
  weight: number; // Weight percentage in total score
  passed: boolean;
  details?: string;
}

export interface ShotQualityAssessment {
  version: number; // Quality scoring schema version
  score: number; // 0-100
  grade: 'pass' | 'warning' | 'fail';
  generatedAt: number;
  checks: QualityCheck[];
  summary: string;
}

/**
 * 角色九宫格造型设计 - 单个视角面板数据
 * 用于多视角展示角色外观，提升镜头图生成时的角色一致性
 */
export interface CharacterTurnaroundPanel {
  index: number;           // 0-8, 九宫格位置索引
  viewAngle: string;       // 视角：正面/左侧面/右侧面/背面/3/4左侧/3/4右侧/俯视/仰视 等
  shotSize: string;        // 景别：全身/半身/特写 等
  description: string;     // 该格子的视觉描述
}

/**
 * 角色九宫格造型设计数据
 * 提供角色的多视角参考图，用于在分镜生成时按镜头角度匹配最佳参考
 */
export interface CharacterTurnaroundData {
  panels: CharacterTurnaroundPanel[];  // 9个格子的描述数据
  imageUrl?: string;                    // 生成的九宫格整图 (base64)，直接作为多视角参考图使用
  prompt?: string;                      // 生成时使用的完整提示词
  status: 'pending' | 'generating_panels' | 'panels_ready' | 'generating_image' | 'completed' | 'failed';
  // generating_panels: AI正在生成9个视角描述
  // panels_ready: 视角描述已生成，等待用户确认/编辑后再生成图片
  // generating_image: 用户已确认，正在生成九宫格图片
}

export interface CharacterThreeViewData {
  imageUrl?: string;
  prompt?: string;
  status: 'pending' | 'generating' | 'completed' | 'failed';
}

export type CharacterImageView = 'casting' | 'turnaround' | 'threeView';
export type CharacterImageHistorySource = 'generated' | 'uploaded';

export interface CharacterImageHistoryEntry {
  id: string;
  imageUrl: string;
  createdAt: number;
  source: CharacterImageHistorySource;
  prompt?: string;
}

export type AssetImageHistorySource = 'generated' | 'uploaded';

export interface AssetImageHistoryEntry {
  id: string;
  imageUrl: string;
  createdAt: number;
  source: AssetImageHistorySource;
  prompt?: string;
}

export interface Character {
  id: string;
  name: string;
  role?: CharacterRole;
  gender: string;
  age: string;
  personality: string;
  /** 物种/形态，如 human、黑背幼犬、拟人棕猫。缺省时按文本推断。 */
  species?: string;
  /** 剧本中明确写出的服装/穿着描述，作为角色造型的唯一文字来源。 */
  wardrobe?: string;
  /** 角色在出场镜头中默认随身/随行的独立装备；服装类物品不应放入这里。 */
  defaultPropIds?: string[];
  visualPrompt?: string;
  promptVersions?: PromptVersion[]; // Prompt edit history with rollback support
  negativePrompt?: string;
  coreFeatures?: string;
  /** 可复用资产 DNA：跨镜头稳定的形体、材质、色彩和禁改特征。 */
  assetDNA?: AssetDNA;
  creativeDirection?: CreativeCharacterDirection;
  shapeReferenceImage?: string; // Optional reference image used only for shape/silhouette guidance during generation
  referenceImage?: string;
  turnaround?: CharacterTurnaroundData;
  threeView?: CharacterThreeViewData;
  activeImageView?: CharacterImageView;
  /** 当前定妆图生成任务的临时标识；生成完成或失败后清除，避免旧任务覆盖当前预览。 */
  referenceGenerationId?: string;
  /** 同一次抽卡里尚未完成的生成任务。只接受这些任务写回，避免旧图回流。 */
  referenceGenerationIds?: string[];
  imageHistory?: CharacterImageHistoryEntry[];
  /** 用户删过的图。旧任务和服务器合并不能再把这些图写回历史。 */
  removedImageKeys?: string[];
  variations: CharacterVariation[];
  status?: 'pending' | 'generating' | 'completed' | 'failed';
  libraryId?: string;
  libraryVersion?: number;
  version?: number;
}

export interface Scene {
  id: string;
  location: string;
  time: string;
  atmosphere: string;
  creativeDirection?: CreativeSceneDirection;
  /** 可用于镜头调度和轴线检查的场景空间拓扑。 */
  spatialTopology?: SceneSpatialTopology;
  assetDNA?: AssetDNA;
  visualPrompt?: string;
  promptVersions?: PromptVersion[]; // Prompt edit history with rollback support
  negativePrompt?: string; // 负面提示词，用于排除不想要的元素
  shapeReferenceImage?: string; // Optional reference image used only for shape/silhouette guidance during generation
  referenceImage?: string; // 场景参考图，存储为base64格式（data:image/png;base64,...）
  referenceImageUpdatedAt?: number;
  /** 当前场景图生成任务的临时标识；避免旧任务把已删除的历史图写回来。 */
  referenceGenerationId?: string;
  referenceGenerationIds?: string[];
  imageHistory?: AssetImageHistoryEntry[];
  /** 用户删过的图。旧任务和服务器合并不能再把这些图写回历史。 */
  removedImageKeys?: string[];
  status?: 'pending' | 'generating' | 'completed' | 'failed'; // 生成状态，用于loading状态持久化
  libraryId?: string;
  libraryVersion?: number;
  version?: number;
}

/**
 * 道具在镜头中的默认呈现方式。
 * 这是结构化事实，不会默认完整展开到每个生图提示词中。
 */
export type PropPresentationMode =
  | 'handheld'
  | 'worn'
  | 'placed'
  | 'mounted'
  | 'background'
  | 'used'
  | 'unknown';

/** 镜头对某个道具呈现方式的覆盖约束。 */
export interface ShotPropUsage {
  mode?: PropPresentationMode;
  actorId?: string;
  hand?: 'left' | 'right' | 'both' | 'either';
  position?: string;
  action?: string;
  forbiddenModes?: string[];
}

/**
 * 关键帧专用的可见状态。镜头级 executionPlan 描述整个动作过程，不能直接当成
 * 首帧或尾帧的静态画面事实；本字段只记录某一帧可被看见的状态。
 */
export interface ShotFrameDirection {
  /** 这一帧让观众立即读到的剧情状态。 */
  storyState?: string;
  /** 人物的画面站位、朝向、视线与静止/动作姿态。 */
  blocking?: string;
  /** 可观察的表情、情绪和身体张力，不描述整段情绪变化。 */
  performance?: string;
  /** 本帧道具的拥有者、位置和状态；可覆盖镜头级 propUsages。 */
  propState?: string;
  /** 结构化人物调度；优先于自由文本 blocking。 */
  characterBlocking?: ShotCharacterBlocking[];
  /** 结构化本帧道具状态；key 为道具 ID。 */
  propStates?: Record<string, ShotPropFrameState>;
}

export interface ShotCharacterBlocking {
  characterId: string;
  count?: number;
  position?: string;
  depth?: 'foreground' | 'midground' | 'background' | string;
  facing?: string;
  gaze?: string;
  action?: string;
  expression?: string;
}

export interface ShotPropFrameState {
  holderCharacterId?: string;
  hand?: 'left' | 'right' | 'both' | 'either';
  position?: string;
  state?: string;
  visible?: boolean;
}

export interface ShotConstraintPolicy {
  /** 必须满足并应在生成前检查的事实。 */
  required?: string[];
  /** 建议满足但失败时不阻断生成的事实。 */
  preferred?: string[];
  /** 可由模型自由处理的次要细节。 */
  flexible?: string[];
  /** 本镜头禁止自动添加的道具名称或 ID。 */
  forbiddenProps?: string[];
}

/**
 * 道具/物品 - 用于保持多分镜间物品视觉一致性
 * 如星图、武器、地图、信件等需要在多个镜头中重复出现的物品
 */
export interface Prop {
  id: string;
  name: string;           // 道具名称，如"星图"、"古剑"
  category: string;       // 分类：武器、文件/书信、食物/饮品、交通工具、装饰品、科技设备、其他
  description: string;    // 道具描述
  assetDNA?: AssetDNA;
  /** 穿在角色身上的物品不应作为镜头独立道具参考图重复注入。 */
  isWearable?: boolean;
  /** 兼容旧道具数据：记录该服装组件的角色归属，但不作为独立道具生成。 */
  wardrobeOwnerCharacterId?: string;
  /** 道具的默认使用/呈现方式；旧数据缺失时按名称和描述保守推断。 */
  presentationMode?: PropPresentationMode;
  /** 只有需要补充关系时填写，例如“两个短提手，不使用肩带”。 */
  presentationNote?: string;
  /** 生成镜头时追加的禁止呈现方式，例如 backpack、shoulder-worn。 */
  forbiddenPresentationModes?: string[];
  visualPrompt?: string;  // 视觉提示词
  promptVersions?: PromptVersion[]; // Prompt edit history with rollback support
  negativePrompt?: string; // 负面提示词，用于排除不想要的元素
  shapeReferenceImage?: string; // Optional reference image used only for shape/silhouette guidance during generation
  referenceImage?: string; // 道具参考图，存储为base64格式（data:image/png;base64,...）
  referenceImageUpdatedAt?: number;
  /** 当前道具图生成任务的临时标识；避免旧任务把已删除的历史图写回来。 */
  referenceGenerationId?: string;
  referenceGenerationIds?: string[];
  imageHistory?: AssetImageHistoryEntry[];
  /** 用户删过的图。旧任务和服务器合并不能再把这些图写回历史。 */
  removedImageKeys?: string[];
  status?: 'pending' | 'generating' | 'completed' | 'failed'; // 生成状态，用于loading状态持久化
  libraryId?: string;
  libraryVersion?: number;
  version?: number;
}

export type AssetLibraryItemType = 'character' | 'scene' | 'prop';

export interface AssetLibraryItem {
  id: string;
  type: AssetLibraryItemType;
  name: string;
  projectId?: string;
  projectName?: string;
  createdAt: number;
  updatedAt: number;
  data: Character | Scene | Prop;
}

export interface Keyframe {
  id: string;
  type: 'start' | 'end';
  /** 当前关键帧版本；用于忽略旧生成任务的迟到回写。 */
  generationId?: string;
  visualPrompt: string;
  promptVersions?: PromptVersion[]; // Prompt edit history with rollback support
  imageUrl?: string; // 关键帧图像，存储为base64格式（data:image/png;base64,...）
  status: 'pending' | 'generating' | 'completed' | 'failed';
  /** 成图后的结构 + 视觉语义审核结果；视频提交门禁以此为准。 */
  visualReview?: KeyframeVisualReview;
}

export type VisualReviewIssueType =
  | 'structure'
  | 'shot_size'
  | 'composition'
  | 'character_count'
  | 'character_identity'
  | 'wardrobe'
  | 'subject_position'
  | 'prop_presence'
  | 'prop_scale'
  | 'prop_usage'
  | 'scene_match'
  | 'anatomy'
  | 'text_watermark'
  | 'motion_space'
  | 'adjacent_similarity'
  | 'other';

export interface VisualReviewIssue {
  type: VisualReviewIssueType;
  severity: 'low' | 'medium' | 'high';
  message: string;
  repairInstruction?: string;
}

export interface KeyframeVisualReview {
  version: 1;
  status: 'reviewing' | 'passed' | 'failed' | 'error';
  score: number;
  passed: boolean;
  structureScore: number;
  semanticScore?: number;
  issues: VisualReviewIssue[];
  repairPrompt?: string;
  /** 与上一镜头关键帧的感知相似度，0-1。 */
  previousShotSimilarity?: number;
  reviewedImageUrl?: string;
  reviewedAt: number;
  model?: string;
  repairAttempt?: number;
  error?: string;
}

export interface VideoInterval {
  id: string;
  startKeyframeId: string;
  endKeyframeId: string;
  duration: number;
  motionStrength: number;
  /** 生成该视频时使用的画幅，避免被其他项目的全局设置覆盖预览。 */
  aspectRatio?: AspectRatio;
  /** 视频采样质量：standard 使用完整步数，turbo 使用加速 LoRA。 */
  videoQuality?: 'standard' | 'turbo';
  videoUrl?: string; // 视频数据，存储为base64格式（data:video/mp4;base64,...），避免URL过期问题
  videoPrompt?: string; // 视频生成时使用的提示词
  promptVersions?: PromptVersion[]; // Prompt edit history with rollback support
  status: 'pending' | 'generating' | 'completed' | 'failed';
}

/**
 * 分镜网格面板数量（导演工作台）
 */
export type StoryboardGridPanelCount = 4 | 6 | 9;

/**
 * 分镜网格布局元信息
 */
export interface StoryboardGridLayoutMeta {
  panelCount: StoryboardGridPanelCount;
  rows: number;
  cols: number;
}

/**
 * 九宫格分镜预览 - 单个面板数据
 */
export interface NineGridPanel {
  index: number;           // 0-(panelCount-1), 网格位置索引
  shotSize: string;        // 景别：特写/近景/中景/全景/远景 等
  cameraAngle: string;     // 机位角度：俯拍/仰拍/平视/斜拍 等
  description: string;     // 该格子的视觉描述
  descriptionZh?: string;  // 英文描述的中文展示翻译（可选）
}

/**
 * 九宫格分镜预览数据
 */
export interface NineGridData {
  panels: NineGridPanel[];  // 网格格子的描述数据
  layout?: StoryboardGridLayoutMeta; // 当前网格布局（4/6/9）
  imageUrl?: string;        // 生成的网格图片 (base64)
  prompt?: string;          // 生成时使用的完整提示词
  status: 'pending' | 'generating_panels' | 'panels_ready' | 'generating_image' | 'completed' | 'failed';
  // generating_panels: AI正在生成网格镜头描述
  // panels_ready: 镜头描述已生成，等待用户确认/编辑后再生成图片
  // generating_image: 用户已确认，正在生成网格图片
}

export type DubbingMode = 'narration' | 'dialogue';
export type DubbingStatus = 'pending' | 'generating' | 'completed' | 'failed';
export type DubbingOutputFormat = 'wav' | 'mp3' | 'opus';

export interface ShotDubbing {
  mode: DubbingMode;
  text: string;
  modelId: string;
  /** 对白对应的声音角色；旁白模式为空。 */
  speakerId?: string;
  speakerName?: string;
  voice?: string;
  outputFormat?: DubbingOutputFormat;
  audioUrl?: string; // base64 data url
  transcript?: string;
  status: DubbingStatus;
  error?: string;
  generatedAt?: number;
}

export interface CreativeDevelopmentPlan {
  version: number;
  status: 'generated' | 'fallback';
  hook: string;
  audiencePromise: string;
  theme: string;
  centralConflict: string;
  escalationPlan: string;
  climax: string;
  payoff: string;
  pacingStrategy: string;
  generatedAt: number;
}

export interface StoryboardDirectorBeat {
  id: string;
  sceneId: string;
  order: number;
  shotCount: number;
  purpose: string;
  emotionalBeat: string;
  conflictBeat: string;
  visualHook: string;
  cameraStrategy: string;
  continuityIn: string;
  continuityOut: string;
  h3FeasibilityNotes: string;
}

export interface StoryboardDirectorPlan {
  version: number;
  status: 'generated' | 'fallback';
  openingHook: string;
  escalation: string;
  climax: string;
  payoff: string;
  pacingNotes: string;
  targetShotCount: number;
  shotDurationSeconds: number;
  beats: StoryboardDirectorBeat[];
  generatedAt: number;
}

export interface ShotTimelineBeat {
  startSeconds: number;
  endSeconds: number;
  action: string;
  camera?: string;
  sound?: string;
}

export interface ShotContinuityPlan {
  entryState: string;
  exitState: string;
  screenDirection: string;
  mustPreserve: string[];
}

export interface AssetDNA {
  identityAnchors: string[];
  materialAnchors: string[];
  colorAnchors: string[];
  forbiddenChanges: string[];
}

export interface SceneSpatialTopology {
  zones: Array<{ id: string; label: string; relation?: string }>;
  entrances: string[];
  exits: string[];
  landmarks: string[];
  dominantAxis: string;
  cameraSafeSide?: string;
}

export type ShotReferencePolicyLevel = 'required' | 'supportive' | 'textOnly' | 'omitted';

export interface ShotReferencePolicyItem {
  assetType: 'character' | 'scene' | 'prop' | 'storyboard';
  assetId?: string;
  label: string;
  policy: ShotReferencePolicyLevel;
  reason: string;
  visiblePhaseIndexes?: number[];
  lockedByUser?: boolean;
}

export interface ContinuityCharacterState {
  location: string;
  wardrobe: string;
  heldPropIds: string[];
  physicalState: string;
  emotionalState: string;
  knowledge: string[];
  visible: boolean;
}

export interface ContinuityPropState {
  location: string;
  holderCharacterId?: string;
  presentationMode: PropPresentationMode;
  condition: string;
  visible: boolean;
}

export interface ContinuitySceneState {
  sceneId: string;
  time: string;
  weather: string;
  lighting: string;
  screenDirection: string;
}

export interface ShotContinuityState {
  characters: Record<string, ContinuityCharacterState>;
  props: Record<string, ContinuityPropState>;
  scene: ContinuitySceneState;
}

export interface ShotContinuityDelta {
  characterChanges: Record<string, Partial<ContinuityCharacterState>>;
  propChanges: Record<string, Partial<ContinuityPropState>>;
  sceneChanges: Partial<ContinuitySceneState>;
}

export interface ShotContinuityLedgerEntry {
  shotId: string;
  stateIn: ShotContinuityState;
  stateDelta: ShotContinuityDelta;
  stateOut: ShotContinuityState;
  issues: string[];
  generatedAt: number;
}

/** 镜头执行计划：先于最终视觉/视频提示词生成，用于控制动作密度与可执行性。 */
export interface ShotExecutionPlan {
  coreBeat: string;
  actionPhases: ShotTimelineBeat[];
  subjectBlocking: string;
  propBlocking: string;
  cameraPlan: string;
  endState: string;
  soundPlan: string[];
  /** 对白应落在哪个动作阶段，以及需要保留的停顿。 */
  dialogueTiming?: string;
  /** 参考图语义预算；未提供时由确定性策略补齐。 */
  referencePolicy?: ShotReferencePolicyItem[];
}

export interface ShotSemanticReview {
  score: number;
  verdict: 'pass' | 'warning' | 'fail';
  issues: string[];
  repaired: boolean;
  reviewedAt: number;
}

export type StoryboardStructureActionType = 'remove' | 'merge' | 'reorder' | 'regenerateBeat';

export interface StoryboardStructureIssue {
  kind: 'duplicate_beat' | 'missing_transition' | 'empty_progress' | 'pacing' | 'other';
  shotIds: string[];
  summary: string;
  severity: 'warning' | 'fail';
}

export interface StoryboardStructureAction {
  type: StoryboardStructureActionType;
  shotIds: string[];
  /** merge：保留的镜头；reorder：可忽略 */
  keepShotId?: string;
  /** reorder：该范围内的新顺序（须覆盖 shotIds 或为全片顺序） */
  orderedShotIds?: string[];
  reason: string;
  /** 低风险删/并/重排，生成时可自动应用 */
  autoSafe: boolean;
  applied?: boolean;
}

/** 结构审片结果：允许删/并/重排；与字段级 semanticReview 互补。 */
export interface StoryboardStructureReview {
  version: number;
  score: number;
  verdict: 'pass' | 'warning' | 'fail';
  issues: StoryboardStructureIssue[];
  actions: StoryboardStructureAction[];
  appliedActionCount: number;
  removedShotIds: string[];
  reviewedAt: number;
  summary: string;
}

/** 故事层软门禁：改写/分镜前相对大纲查缺口，不阻断流程。 */
export interface StoryOutlineReview {
  version: number;
  score: number;
  verdict: 'pass' | 'warning' | 'fail';
  issues: string[];
  reviewedAt: number;
  summary: string;
}

/** 单镜头 Agent 产物；由分镜生成、语义审片和 H3 编译器共同消费。 */
export interface ShotAgentMetadata {
  directorPurpose: string;
  emotionalBeat: string;
  visualHook: string;
  timeline: ShotTimelineBeat[];
  executionPlan: ShotExecutionPlan;
  continuity: ShotContinuityPlan;
  continuityLedger?: ShotContinuityLedgerEntry;
  audioIntent: string;
  h3FeasibilityNotes: string;
  semanticReview?: ShotSemanticReview;
}

export type StoryboardAgentStage =
  | 'development'
  | 'director-plan'
  | 'shot-generation'
  | 'structure-review'
  | 'semantic-review'
  | 'completed';

export interface StoryboardAgentRun {
  version: number;
  runId: string;
  status: 'running' | 'completed' | 'degraded';
  stage: StoryboardAgentStage;
  completedStages: StoryboardAgentStage[];
  warnings: string[];
  startedAt: number;
  updatedAt: number;
  completedAt?: number;
}

export interface Shot {
  id: string;
  sceneId: string;
  actionSummary: string;
  dialogue?: string; 
  cameraMovement: string;
  shotSize?: string; 
  characters: string[]; // Character IDs
  characterVariations?: { [characterId: string]: string }; // Added: Map char ID to variation ID for this shot
  props?: string[]; // 道具ID数组，引用 ScriptData.props 中的道具
  /** 镜头级道具使用方式覆盖；未设置时使用道具默认值或保守推断。 */
  propUsages?: { [propId: string]: ShotPropUsage };
  /** 首尾帧的静态可见状态；缺失时兼容旧项目并回退到 visualPrompt。 */
  frameDirections?: Partial<Record<'start' | 'end', ShotFrameDirection>>;
  /** 镜头提示词约束预算；旧数据缺失时由复杂度策略自动推断。 */
  constraintPolicy?: ShotConstraintPolicy;
  /** 参考图/提示词复杂度档位；缺失时由镜头内容自动推断。 */
  visualComplexity?: 'simple' | 'standard' | 'complex';
  keyframes: Keyframe[];
  interval?: VideoInterval;
  qualityAssessment?: ShotQualityAssessment;
  agent?: ShotAgentMetadata;
  videoModel?: 'veo' | 'sora-2' | 'veo_3_1-fast' | 'veo_3_1-fast-4K' | 'veo_3_1_t2v_fast_landscape' | 'veo_3_1_t2v_fast_portrait' | 'veo_3_1_i2v_s_fast_fl_landscape' | 'veo_3_1_i2v_s_fast_fl_portrait' | 'doubao-seedance-1-5-pro' | 'doubao-seedance-1-5-pro-251215' | 'doubao-seedance-2-0-260128'; // Video generation model selection
  videoInputMode?: 'keyframes' | 'storyboard-grid'; // 视频驱动方式：首尾帧 / 网格分镜（互斥）
  nineGrid?: NineGridData; // 可选的九宫格分镜预览数据（高级功能）
  /** 已生成的 4/6/9 格分镜版本；nineGrid 始终指向当前正在查看/使用的版本。 */
  nineGridVariants?: Partial<Record<StoryboardGridPanelCount, NineGridData>>;
  dubbing?: ShotDubbing; // 镜头配音（旁白/对话）
}

/**
 * 全局美术指导文档 - 用于统一所有角色和场景的视觉风格
 * 在生成任何角色/场景提示词之前，先由 AI 根据剧本内容生成此文档，
 * 后续所有视觉提示词生成都以此为约束，确保风格一致性。
 */
export interface ArtDirection {
  /** 全局色彩方案 */
  colorPalette: {
    primary: string;      // 主色调描述
    secondary: string;    // 辅色调
    accent: string;       // 点缀色
    skinTones: string;    // 肤色范围描述
    saturation: string;   // 整体饱和度倾向
    temperature: string;  // 整体色温倾向
  };
  /** 角色设计统一规则 */
  characterDesignRules: {
    proportions: string;   // 头身比、体型风格
    eyeStyle: string;      // 眼睛画法统一
    lineWeight: string;    // 线条粗细风格
    detailLevel: string;   // 细节密度级别
  };
  /** 统一光影处理方式 */
  lightingStyle: string;
  /** 材质/质感风格 */
  textureStyle: string;
  /** 3-5个核心风格关键词 */
  moodKeywords: string[];
  /** 一段统一风格的文字锚点描述，所有提示词生成时注入 */
  consistencyAnchors: string;
  /** 生成该文档时的视觉风格 id，换风格后必须重建 */
  visualStyle?: string;
}

/**
 * 项目级事实与制作约束。与 ArtDirection 的“画风”职责分开：
 * ProductionBible 锁定剧情事实、服装、场景和摄影规则。
 */
export interface ProductionBible {
  version: number;
  /** 可执行的时代、地域与文化约束；必须注入角色、场景、道具的视觉提示词。 */
  historicalContext: string;
  worldRules: string;
  costumeRules: string;
  sceneAnchors: string;
  characterVoiceRules: string;
  cameraLanguage: string;
  platformGuardrails: string;
  pinnedDecisions: string[];
  updatedAt?: number;
}

/** 跨集连续性只保存已确认的交接事实；不会从自然语言臆测角色知识或伏笔。 */
export interface SeriesContinuityThread {
  id: string;
  label: string;
  status: 'open' | 'resolved';
  note?: string;
  sourceEpisodeId?: string;
}

export interface SeriesContinuityContext {
  sourceEpisodeId?: string;
  sourceEpisodeNumber?: number;
  incomingState?: ShotContinuityState;
  outgoingState?: ShotContinuityState;
  openThreads: SeriesContinuityThread[];
  updatedAt: number;
}

export interface ScriptData {
  title: string;
  genre: string;
  logline: string;
  /** 结构解析阶段从原稿提取的时代/地域线索；用户可在项目圣经中确认或覆盖。 */
  historicalContext?: string;
  targetDuration?: string;
  language?: string;
  visualStyle?: string; // Visual style: live-action, anime, 3d-animation, etc.
  shotGenerationModel?: string; // 生成时快照的对话模型；实际请求统一走模型配置 CHAT「当前使用」
  planningShotDuration?: number; // Locked shot duration baseline (seconds) used for shot count planning
  artDirection?: ArtDirection; // 全局美术指导文档，用于统一角色和场景的视觉风格
  productionBible?: ProductionBible; // 项目圣经：事实、服装、场景与制作约束
  creativeDevelopment?: CreativeDevelopmentPlan; // 编剧 Agent 的全片创作意图
  storyboardDirectorPlan?: StoryboardDirectorPlan; // 全片分镜规划，供并发场景生成共享
  storyboardAgentRun?: StoryboardAgentRun; // 可恢复、可诊断的 Agent 运行状态
  storyboardStructureReview?: StoryboardStructureReview; // 结构审片（删/并/重排）最近一次结果
  storyOutlineReview?: StoryOutlineReview; // 故事层软门禁最近一次结果
  /** 按镜头顺序保存的结构化连续性状态账。 */
  continuityLedger?: ShotContinuityLedgerEntry[];
  /** 跨集交接状态：上一集结束状态作为本集输入，本集完成后写出结束状态。 */
  seriesContinuity?: SeriesContinuityContext;
  characters: Character[];
  scenes: Scene[];
  props: Prop[]; // 道具列表，用于保持多分镜间物品视觉一致性
  storyParagraphs: { id: number; text: string; sceneRefId: string }[];
  generationMeta?: {
    // Fingerprint of raw script + language (structure extraction inputs).
    structureKey?: string;
    // Fingerprint of structure + model/duration (creative development inputs).
    developmentKey?: string;
    // Fingerprint of structure + style/model/language (visual enrichment inputs).
    visualsKey?: string;
    // Fingerprint of structure/development inputs used to create the shot framework before visual prompts exist.
    frameworkKey?: string;
    // Fingerprint of visualized script + duration/model (shot generation inputs).
    shotsKey?: string;
    generatedAt?: number;
  };
}

export interface RenderLog {
  id: string;
  timestamp: number; // Unix timestamp when API was called
  type: 'character' | 'character-variation' | 'scene' | 'prop' | 'keyframe' | 'video' | 'script-parsing';
  resourceId: string; // ID of the resource being generated
  resourceName: string; // Human-readable name
  status: 'success' | 'failed';
  model: string; // Model used (e.g., 'imagen-3', 'veo_3_1_i2v_s_fast_fl_landscape', 'gpt-5.4')
  prompt?: string; // The prompt used (optional, for debugging)
  error?: string; // Error message if failed
  inputTokens?: number; // Input tokens consumed
  outputTokens?: number; // Output tokens generated
  totalTokens?: number; // Total tokens (if available from API)
  duration?: number; // Time taken in milliseconds
}

/** 用户可见的 Agent 执行日志；只保存阶段、产出摘要和校验结果，不保存模型隐藏推理。 */
export type AgentTraceEntryStatus = 'info' | 'running' | 'success' | 'warning' | 'error';
export type AgentTraceRunStatus = 'running' | 'completed' | 'warning' | 'error' | 'cancelled' | 'waiting';

export interface AgentTraceEntry {
  id: string;
  phase: string;
  message: string;
  detail?: string;
  status: AgentTraceEntryStatus;
  timestamp: number;
}

export interface AgentTraceSession {
  id: string;
  title: string;
  subtitle?: string;
  status: AgentTraceRunStatus;
  startedAt: number;
  completedAt?: number;
  entries: AgentTraceEntry[];
}

export interface SeriesProject {
  id: string;
  title: string;
  description?: string;
  coverImage?: string;
  createdAt: number;
  lastModified: number;
  visualStyle: string;
  language: string;
  artDirection?: ArtDirection;
  /** 项目级自定义/覆盖视觉风格；内置预设仍由代码常量提供。 */
  visualStyleProfiles?: VisualStyleProfile[];
  characterLibrary: Character[];
  sceneLibrary: Scene[];
  propLibrary: Prop[];
}

export interface VisualStyleProfile {
  id: string;
  /** 内置预设 key；自定义风格为空。 */
  styleKey?: string;
  label: string;
  description?: string;
  positivePrompt: string;
  negativePrompt: string;
  previewImage?: string;
  source: 'preset-override' | 'custom' | 'inferred';
  deleted?: boolean;
  deletedAt?: number;
  createdAt: number;
  updatedAt: number;
}

export interface Series {
  id: string;
  projectId: string;
  title: string;
  description?: string;
  sortOrder: number;
  createdAt: number;
  lastModified: number;
}

export type AssetSyncStatus = 'synced' | 'outdated' | 'local-only';

export interface EpisodeCharacterRef {
  characterId: string;
  syncedVersion: number;
  syncStatus: AssetSyncStatus;
}

export interface EpisodeSceneRef {
  sceneId: string;
  syncedVersion: number;
  syncStatus: AssetSyncStatus;
}

export interface EpisodePropRef {
  propId: string;
  syncedVersion: number;
  syncStatus: AssetSyncStatus;
}

export type ScriptGenerationStep = 'structure' | 'development' | 'visuals' | 'shots';

export interface ScriptGenerationCheckpoint {
  // Next step to execute in the analyze pipeline.
  step: ScriptGenerationStep;
  // Hash of script/config inputs so stale checkpoints can be invalidated.
  configKey: string;
  // Latest successful intermediate result for resume.
  scriptData?: ScriptData | null;
  updatedAt: number;
}

export interface Episode {
  id: string;
  projectId: string;
  seriesId: string;
  episodeNumber: number;
  title: string;
  createdAt: number;
  lastModified: number;
  stage: 'script' | 'assets' | 'director' | 'export' | 'prompts';
  rawScript: string;
  targetDuration: string;
  language: string;
  visualStyle: string;
  /** 当前剧集/项目的统一画幅；旧数据缺失时由前端兼容回退。 */
  aspectRatio?: AspectRatio;
  shotGenerationModel: string; // 生成快照；请求时统一解析为模型配置 CHAT「当前使用」
  scriptData: ScriptData | null;
  shots: Shot[];
  isParsingScript: boolean;
  renderLogs: RenderLog[];
  characterRefs: EpisodeCharacterRef[];
  sceneRefs: EpisodeSceneRef[];
  propRefs: EpisodePropRef[];
  promptTemplateOverrides?: PromptTemplateOverrides;
  scriptGenerationCheckpoint?: ScriptGenerationCheckpoint | null;
  /** 最新一次剧本/分镜 Agent 运行的可回看日志。 */
  agentTraceSession?: AgentTraceSession | null;
}

export type ProjectState = Episode;

// ============================================
// 模型管理相关类型定义
// ============================================

/**
 * 横竖屏比例类型
 * - 16:9: 横屏（默认）
 * - 9:16: 竖屏
 * - 1:1: 方形
 */
export type AspectRatio = '16:9' | '9:16' | '1:1';

/**
 * 视频时长类型（仅异步视频模型支持）
 */
export type VideoDuration = 4 | 5 | 8 | 10 | 12 | 15;

/**
 * 模型提供商配置
 */
export interface ModelProvider {
  id: string;
  name: string;
  baseUrl: string;  // API 基础 URL
  apiKey?: string;  // 可选的独立 API Key（如果不设置则使用全局 API Key）
  isDefault?: boolean;  // 是否为默认提供商
  isBuiltIn?: boolean;  // 是否为内置提供商（不可删除）
}

/**
 * 对话模型配置
 */
export interface ChatModelConfig {
  providerId: string;
  modelName: string;  // 如 'gpt-5.1', 'gpt-5.2', 'gpt-5.4'
  endpoint?: string;  // API 端点，默认为 '/v1/chat/completions'
}

/**
 * 画图模型配置
 */
export interface ImageModelConfig {
  providerId: string;
  modelName: string;  // 如 'gemini-3-pro-image-preview'
  endpoint?: string;  // API 端点，默认为 '/v1beta/models/{modelName}:generateContent'
}

/**
 * 视频模型配置
 */
export interface VideoModelConfig {
  providerId: string;
  type: 'sora' | 'veo';  // sora 使用异步 API，veo 使用同步 API
  modelName: string;  // 基础模型名，如 'sora-2', 'veo_3_1-fast'
  endpoint?: string;  // API 端点
}

/**
 * 完整的模型配置
 */
export interface ModelConfig {
  chatModel: ChatModelConfig;
  imageModel: ImageModelConfig;
  videoModel: VideoModelConfig;
}

/**
 * 模型管理全局状态
 */
export interface ModelManagerState {
  providers: ModelProvider[];
  currentConfig: ModelConfig;
  defaultAspectRatio: AspectRatio;
  defaultVideoDuration: VideoDuration;
}
