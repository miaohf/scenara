/**
 * AI 服务统一导出
 * 所有外部模块应通过此入口引用 AI 服务功能
 */

// 基础设施层
export {
  ApiKeyError,
  setGlobalApiKey,
  verifyApiKey,
  // 以下为内部辅助，但部分场景仍可能直接使用
  retryOperation,
  cleanJsonString,
  parseJsonWithRecovery,
  chatCompletion,
  chatCompletionWithImages,
  chatCompletionStream,
  checkApiKey,
  getApiBase,
  resolveModel,
  resolveRequestModel,
  parseHttpError,
  convertVideoUrlToBase64,
  resizeImageToSize,
  getVeoModelName,
  getSoraVideoSize,
  getActiveChatModelName,
  getActiveModel,
  getActiveChatModel,
  getActiveVideoModel,
  getActiveImageModel,
  getActiveAudioModel,
  // 日志回调
  setScriptLogCallback,
  clearScriptLogCallback,
  logScriptProgress,
} from './apiCore';

// 提示词常量
export {
  VISUAL_STYLE_PROMPTS,
  VISUAL_STYLE_PROMPTS_CN,
  NEGATIVE_PROMPTS,
  SCENE_NEGATIVE_PROMPTS,
  CHARACTER_CASTING_POSITIVE_LOCK,
  CHARACTER_CASTING_NEGATIVE,
  CHARACTER_IDENTITY_LOCK,
  getStylePrompt,
  getStylePromptCN,
  getNegativePrompt,
  getSceneNegativePrompt,
  getCharacterCastingNegativePrompt,
  isWearableProp,
  inferCharacterWardrobe,
  normalizeCharacterWardrobeInPrompt,
  dedupeRepeatedPromptClauses,
  listProjectPropNames,
  stripProjectPropsFromPrompt,
  buildCharacterLookbookPromptRules,
  applyCharacterCastingPositivePrompt,
  buildLookbookRegenerateVariation,
  mergeCharacterCastingNegativePrompt,
  resolveCharacterSpecies,
} from './promptConstants';

// 剧本处理服务
export {
  parseScriptStructure,
  enrichScriptDataVisuals,
  parseScriptToData,
  inferVisualStyleFromImage,
  generateShotList,
  continueScript,
  continueScriptStream,
  rewriteScript,
  rewriteScriptStream,
  rewriteScriptSegment,
  rewriteScriptSegmentStream,
  type VisualStyleInferenceResult,
} from './scriptService';

// 状态化编剧/导演 Agent
export {
  developScriptForProduction,
  generateStoryboardDirectorPlan,
  formatDirectorPlanForScene,
  buildShotAgentContract,
  normalizeShotAgentMetadata,
  attachShotAgentMetadata,
  reviewAndRepairStoryboard,
  reviewStoryboardStructure,
  reviewStoryOutline,
  completeStoryboardAgentRun,
} from './storyboardAgent';

// 多阶段剧本改写 Agent
export {
  runScriptRewriteAgent,
  type ScriptRewriteAgentEvent,
  type ScriptRewriteAgentEventStatus,
  type ScriptRewriteAgentOptions,
  type ScriptRewriteAgentResult,
  type ScriptRewriteAgentStage,
  type ScriptRewriteIssue,
  type ScriptRewritePlan,
  type ScriptRewriteReview,
} from './scriptRewriteAgent';

// MiniMax H3 Ref2VA 提示词编译器
export {
  isMiniMaxH3Ref2VAModel,
  isMiniMaxH3Ref2VAPrompt,
  isMiniMaxH3OfficialSkillPrompt,
  buildMiniMaxH3Ref2VAPrompt,
  formatH3CameraMotion,
  type MiniMaxH3Ref2VAPromptOptions,
  type MiniMaxH3NativeAudioOptions,
} from './h3PromptCompiler';

export {
  detectComfyUiPromptWorkflowKind,
  toComfyUiPastePrompt,
  type ComfyUiPromptWorkflowKind,
} from './comfyUiPromptExport';

// 视觉资产生成服务
export {
  generateArtDirection,
  generateAllCharacterPrompts,
  generateVisualPrompts,
  generateImage,
  CHARACTER_TURNAROUND_LAYOUT,
  generateCharacterTurnaroundPanels,
  generateCharacterTurnaroundImage,
  generateCharacterThreeViewImage,
  resolveCharacterCastingAspectRatio,
} from './visualService';

// 视频生成服务
export {
  generateVideo,
} from './videoService';

// 配音生成服务
export {
  generateDubbingAudio,
  type DubbingMode,
  type GenerateDubbingAudioOptions,
  type GenerateDubbingAudioResult,
} from './audioService';

// 分镜辅助服务
export {
  optimizeBothKeyframes,
  optimizeKeyframePrompt,
  generateActionSuggestion,
  splitShotIntoSubShots,
  enhanceKeyframePrompt,
  generateNineGridPanels,
  translateNineGridPanels,
  reviseNineGridPanelsByInstruction,
  generateNineGridImage,
  buildNineGridImagePrompt,
  type NineGridRewriteContext,
} from './shotService';

// Prompt compression service
export {
  compressPromptWithLLM,
} from './promptCompressionService';
