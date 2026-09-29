import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { BrainCircuit } from 'lucide-react';
import { ProjectState, ScriptData, ScriptGenerationCheckpoint, ScriptGenerationStep, Shot, VisualStyleProfile } from '../../types';
import { useAlert } from '../GlobalAlert';
import {
  parseScriptStructure,
  developScriptForProduction,
  enrichScriptDataVisuals,
  generateShotList,
  continueScript,
  continueScriptStream,
  runScriptRewriteAgent,
  rewriteScriptSegment,
  rewriteScriptSegmentStream,
  setScriptLogCallback,
  clearScriptLogCallback,
  logScriptProgress,
  inferVisualStyleFromImage,
  generateVisualPrompts,
  generateArtDirection,
  generateImage,
} from '../../services/aiService';
import { getFinalValue, validateConfig } from './utils';
import { resolveShotGenerationModel, setActiveModel } from '../../services/modelRegistry';
import { DEFAULTS, SCRIPT_SOFT_LIMIT, SCRIPT_HARD_LIMIT, VISUAL_STYLE_OPTIONS } from './constants';
import { storyFormLabel, type StoryFormId } from '../../services/ai/storyForm';
import ConfigPanel from './ConfigPanel';
import ScriptEditor from './ScriptEditor';
import SceneBreakdown from './SceneBreakdown';
import AssetMatchDialog from './AssetMatchDialog';
import AgentActivityPanel from './AgentActivityPanel';
import type {
  AgentTraceEntryStatus,
  AgentTraceRunStatus,
  AgentTraceSession,
} from './AgentActivityPanel';
import { findAssetMatches, applyAssetMatches, AssetMatchResult } from '../../services/assetMatchService';
import { getEpisodesBySeries, loadEpisode, loadSeriesProject, saveEpisodePartial } from '../../services/storageService';
import { applyIncomingSeriesContinuity, buildIncomingSeriesContinuity, updateOutgoingSeriesContinuity } from '../../services/seriesContinuityService';
import { resolvePromptTemplateConfig } from '../../services/promptTemplateService';
import { updatePromptWithVersion } from '../../services/promptVersionService';
import { useInterfaceLanguage } from '../../contexts/InterfaceLanguageContext';
import { resolveProductionBible } from '../../services/productionBibleService';
import { getStylePreviewPrompt, resolveVisualStyleProfile } from '../../services/visualStyleProfileService';
import { mergeLegacyVisualStyleProfiles } from '../../services/globalVisualStyleProfileService';
import {
  filterBySceneIdCompat,
  getNextMainShotId,
  getNextSubShotId,
  getShotDisplayLabel,
  sceneIdsMatch,
  getShotGroupPrefix,
  shotBelongsToGroup,
} from '../../services/storyboardIdUtils';

interface Props {
  project: ProjectState;
  updateProject: (updates: Partial<ProjectState> | ((prev: ProjectState) => ProjectState)) => void;
  onShowModelConfig?: () => void;
  onGeneratingChange?: (isGenerating: boolean) => void;
  /** Legacy project-local profiles are imported once into the shared library. */
  legacyVisualStyleProfiles?: VisualStyleProfile[];
  visualStyleProfiles?: VisualStyleProfile[];
  onUpdateVisualStyleProfiles?: (profiles: VisualStyleProfile[]) => void;
}

type TabMode = 'story' | 'script';
type AnalyzeRunStep = ScriptGenerationStep | 'done';
type AnalyzeRunMode = 'full' | 'framework';

const inferTracePhase = (message: string): string => {
  if (/编剧 Agent/i.test(message)) return '编剧 Agent';
  if (/导演 Agent/i.test(message)) return '导演 Agent';
  if (/结构审片|故事层门禁/i.test(message)) return '结构审片';
  if (/字段审片|审片 Agent|质量校验|自动修复/i.test(message)) return '审片 Agent';
  if (/视觉|美术|角色|场景|道具/i.test(message)) return '视觉 Agent';
  if (/分镜/i.test(message)) return '分镜 Agent';
  if (/解析|结构/i.test(message)) return '结构 Agent';
  if (/模型|风格|配置/i.test(message)) return '运行配置';
  return 'Agent 工作流';
};

const inferTraceStatus = (message: string): AgentTraceEntryStatus => {
  if (/失败|错误/i.test(message)) return 'error';
  if (/降级|兜底|警告|取消|缺失/i.test(message)) return 'warning';
  if (/完成|已锁定|已复用|跳过|命中/i.test(message)) return 'success';
  if (/正在|开始|启动|生成中/i.test(message)) return 'running';
  return 'info';
};

const summarizeCreativeDevelopment = (scriptData: ScriptData): string => {
  const development = scriptData.creativeDevelopment;
  if (!development) return '未返回独立创作意图，后续流程将使用结构化剧本继续。';
  return [
    development.hook ? `钩子：${development.hook}` : '',
    development.centralConflict ? `核心冲突：${development.centralConflict}` : '',
    development.climax ? `高潮：${development.climax}` : '',
    development.payoff ? `结尾回报：${development.payoff}` : '',
  ].filter(Boolean).join('\n').slice(0, 1200);
};

const summarizeRewriteValidation = (
  originalScript: string,
  rewrittenScript: string,
  hardLimit: number,
): { status: AgentTraceEntryStatus; message: string; detail: string } => {
  const originalScenes = (originalScript.match(/^#{1,3}\s+.+$/gm) || []).length;
  const rewrittenScenes = (rewrittenScript.match(/^#{1,3}\s+.+$/gm) || []).length;
  const warnings: string[] = [];
  if (rewrittenScript.length > hardLimit) warnings.push('输出超过单集字符上限');
  if (rewrittenScript.includes('\uFFFD')) warnings.push('输出包含 Unicode 替换字符（乱码）');
  if (originalScenes > 0 && rewrittenScenes === 0) warnings.push('未检测到原有 Markdown 场次标题');
  if (rewrittenScript.length < Math.max(80, originalScript.length * 0.25)) warnings.push('输出长度明显短于原稿');

  return {
    status: warnings.length > 0 ? 'warning' : 'success',
    message: warnings.length > 0 ? '基础完整性检查发现需注意项' : '基础完整性检查通过',
    detail: [
      `原稿 ${originalScript.length} 字 → 改写 ${rewrittenScript.length} 字`,
      `结构标题 ${originalScenes} → ${rewrittenScenes}`,
      warnings.length > 0 ? `注意：${warnings.join('；')}` : '非空、长度和剧本结构格式检查正常',
    ].join('\n'),
  };
};

const StageScript: React.FC<Props> = ({ project, updateProject, onShowModelConfig, onGeneratingChange, legacyVisualStyleProfiles = [], visualStyleProfiles = [], onUpdateVisualStyleProfiles }) => {
  const { text } = useInterfaceLanguage();
  const { showAlert } = useAlert();
  const promptTemplates = useMemo(
    () => resolvePromptTemplateConfig(project.promptTemplateOverrides),
    [project.promptTemplateOverrides]
  );
  const [activeTab, setActiveTab] = useState<TabMode>(project.scriptData ? 'script' : 'story');

  const getDraftValue = (selected: string, customInput: string, fallback: string): string => {
    if (selected !== 'custom') return selected;
    const trimmed = customInput.trim();
    return trimmed || fallback;
  };

  const hashRaw = (raw: string): string => {
    let hash = 5381;
    for (let i = 0; i < raw.length; i += 1) {
      hash = ((hash << 5) + hash) ^ raw.charCodeAt(i);
    }
    return `${(hash >>> 0).toString(16)}-${raw.length}`;
  };

  const buildAnalyzeConfigKey = (input: {
    script: string;
    language: string;
    targetDuration: string;
    model: string;
    visualStyle: string;
    enableQualityCheck: boolean;
  }): string => {
    const raw = JSON.stringify(input);
    return `v2-${hashRaw(raw)}`;
  };

  const buildStepKey = (step: ScriptGenerationStep, payload: Record<string, unknown>): string => {
    return `${step}-${hashRaw(JSON.stringify(payload))}`;
  };

  const normalizeAssetKey = (value: string): string => {
    return String(value || '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\u4e00-\u9fff]+/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  };

  const cloneScriptData = (data: ScriptData): ScriptData => {
    if (typeof structuredClone === 'function') {
      return structuredClone(data);
    }
    return JSON.parse(JSON.stringify(data)) as ScriptData;
  };

  const dedupeByKey = <T,>(items: T[], getKey: (item: T) => string): T[] => {
    const map = new Map<string, T>();
    items.forEach(item => map.set(getKey(item), item));
    return Array.from(map.values());
  };

  const rebuildAssetRefsFromScriptData = (
    scriptData: ScriptData
  ): Pick<ProjectState, 'characterRefs' | 'sceneRefs' | 'propRefs'> => {
    const characterRefs = dedupeByKey(
      (scriptData.characters || [])
        .filter(char => !!char.libraryId)
        .map(char => ({
          characterId: char.libraryId as string,
          syncedVersion: char.libraryVersion || 1,
          syncStatus: 'synced' as const,
        })),
      ref => ref.characterId
    );

    const sceneRefs = dedupeByKey(
      (scriptData.scenes || [])
        .filter(scene => !!scene.libraryId)
        .map(scene => ({
          sceneId: scene.libraryId as string,
          syncedVersion: scene.libraryVersion || 1,
          syncStatus: 'synced' as const,
        })),
      ref => ref.sceneId
    );

    const propRefs = dedupeByKey(
      (scriptData.props || [])
        .filter(prop => !!prop.libraryId)
        .map(prop => ({
          propId: prop.libraryId as string,
          syncedVersion: prop.libraryVersion || 1,
          syncStatus: 'synced' as const,
        })),
      ref => ref.propId
    );

    return { characterRefs, sceneRefs, propRefs };
  };

  const attachGenerationMeta = (
    source: ScriptData,
    patch: Partial<NonNullable<ScriptData['generationMeta']>>
  ): ScriptData => ({
    ...source,
    generationMeta: {
      ...(source.generationMeta || {}),
      ...patch,
      generatedAt: Date.now()
    }
  });

  const buildReuseLookup = <T extends { id: string }>(
    items: T[],
    getKey: (item: T) => string
  ): { byId: Map<string, T>; byKey: Map<string, T> } => {
    const byId = new Map<string, T>();
    const byKey = new Map<string, T>();
    for (const item of items) {
      const id = String(item.id);
      byId.set(id, item);
      const key = normalizeAssetKey(getKey(item));
      if (key && !byKey.has(key)) {
        byKey.set(key, item);
      }
    }
    return { byId, byKey };
  };

  const reuseVisualDataFromPrevious = (
    current: ScriptData,
    previous: ScriptData | null,
    reuseArtDirection: boolean
  ): ScriptData => {
    if (!previous) return current;
    const next = cloneScriptData(current);

    const previousCharacters = buildReuseLookup(previous.characters || [], (item) => item.name);
    next.characters = (next.characters || []).map((character) => {
      const direct = previousCharacters.byId.get(String(character.id));
      const byName = previousCharacters.byKey.get(normalizeAssetKey(character.name));
      const match = direct || byName;
      if (!match) return character;
      return {
        ...character,
        visualPrompt: character.visualPrompt || match.visualPrompt,
        negativePrompt: character.negativePrompt || match.negativePrompt,
        promptVersions: character.promptVersions || match.promptVersions,
        referenceImage: character.referenceImage || match.referenceImage,
        turnaround: character.turnaround || match.turnaround,
        variations: character.variations?.length ? character.variations : (match.variations || []),
        status: character.status || match.status,
        libraryId: character.libraryId || match.libraryId,
        libraryVersion: character.libraryVersion || match.libraryVersion,
        version: character.version || match.version
      };
    });

    const previousScenes = buildReuseLookup(previous.scenes || [], (item) => item.location);
    next.scenes = (next.scenes || []).map((scene) => {
      const direct = previousScenes.byId.get(String(scene.id));
      const byLocation = previousScenes.byKey.get(normalizeAssetKey(scene.location));
      const match = direct || byLocation;
      if (!match) return scene;
      return {
        ...scene,
        visualPrompt: scene.visualPrompt || match.visualPrompt,
        negativePrompt: scene.negativePrompt || match.negativePrompt,
        promptVersions: scene.promptVersions || match.promptVersions,
        referenceImage: scene.referenceImage || match.referenceImage,
        status: scene.status || match.status,
        libraryId: scene.libraryId || match.libraryId,
        libraryVersion: scene.libraryVersion || match.libraryVersion,
        version: scene.version || match.version
      };
    });

    const previousProps = buildReuseLookup(previous.props || [], (item) => item.name);
    next.props = (next.props || []).map((prop) => {
      const direct = previousProps.byId.get(String(prop.id));
      const byName = previousProps.byKey.get(normalizeAssetKey(prop.name));
      const match = direct || byName;
      if (!match) return prop;
      return {
        ...prop,
        visualPrompt: prop.visualPrompt || match.visualPrompt,
        negativePrompt: prop.negativePrompt || match.negativePrompt,
        promptVersions: prop.promptVersions || match.promptVersions,
        referenceImage: prop.referenceImage || match.referenceImage,
        status: prop.status || match.status,
        libraryId: prop.libraryId || match.libraryId,
        libraryVersion: prop.libraryVersion || match.libraryVersion,
        version: prop.version || match.version
      };
    });

    if (reuseArtDirection && !next.artDirection && previous.artDirection) {
      next.artDirection = previous.artDirection;
    }
    // 项目圣经是用户确认的制作事实，不能因为重新解析剧本而丢失。
    if (previous.productionBible) {
      next.productionBible = previous.productionBible;
    }

    return next;
  };

  const isPlaceholderProjectTitle = (value: string): boolean => {
    const trimmed = value.trim();
    if (!trimmed) return true;
    if (/^untitled\b/i.test(trimmed)) return true;
    if (/^episode\s*\d+$/i.test(trimmed)) return true;
    if (/^project\s+\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}$/i.test(trimmed)) return true;
    return false;
  };

  const hydrateScriptDataMeta = (
    source: ScriptData,
    params: {
      targetDuration: string;
      language: string;
      visualStyle: string;
      model: string;
      localTitle: string;
    }
  ): ScriptData => {
    const next: ScriptData = {
      ...source,
      targetDuration: params.targetDuration,
      language: params.language,
      visualStyle: params.visualStyle,
      shotGenerationModel: params.model
    };
    const trimmedTitle = params.localTitle.trim();
    if (!isPlaceholderProjectTitle(trimmedTitle)) {
      next.title = trimmedTitle;
    }
    return next;
  };

  const createAnalyzeCheckpoint = (
    step: ScriptGenerationStep,
    configKey: string,
    scriptData?: ScriptData | null
  ): ScriptGenerationCheckpoint => ({
    step,
    configKey,
    scriptData: scriptData || null,
    updatedAt: Date.now()
  });

  const isAbortError = (err: unknown, signal?: AbortSignal): boolean => {
    if (signal?.aborted) return true;
    const message = String((err as any)?.message || '').toLowerCase();
    return (
      message.includes('abort') ||
      message.includes('aborted') ||
      message.includes('cancel') ||
      message.includes('canceled') ||
      message.includes('取消')
    );
  };
  
  // Configuration state
  const [localScript, setLocalScript] = useState(project.rawScript);
  const [localTitle, setLocalTitle] = useState(project.title);
  const [localDuration, setLocalDuration] = useState(project.targetDuration || DEFAULTS.duration);
  const [localLanguage, setLocalLanguage] = useState(project.language || DEFAULTS.language);
  const [localModel, setLocalModel] = useState(() =>
    resolveShotGenerationModel()
  );
  const [localVisualStyle, setLocalVisualStyle] = useState(project.visualStyle || DEFAULTS.visualStyle);
  const [previewVisualStyle, setPreviewVisualStyle] = useState(project.visualStyle || DEFAULTS.visualStyle);
  const [enableQualityCheck, setEnableQualityCheck] = useState(true);
  const [customDurationInput, setCustomDurationInput] = useState('');
  const [customModelInput, setCustomModelInput] = useState('');
  const [customStyleInput, setCustomStyleInput] = useState('');
  const [rewriteInstruction, setRewriteInstruction] = useState('');
  const [storyForm, setStoryForm] = useState<StoryFormId>('dramatic');
  const [customStoryForm, setCustomStoryForm] = useState('');
  const [selectionRange, setSelectionRange] = useState<{ start: number; end: number } | null>(null);
  
  // Processing state
  const [isProcessing, setIsProcessing] = useState(false);
  const [isContinuing, setIsContinuing] = useState(false);
  const [isRewriting, setIsRewriting] = useState(false);
  const [isInferringVisualStyle, setIsInferringVisualStyle] = useState(false);
  const [generatingStylePreviewKeys, setGeneratingStylePreviewKeys] = useState<string[]>([]);
  const [styleProfilesForUi, setStyleProfilesForUi] = useState<VisualStyleProfile[]>(visualStyleProfiles);
  const visualStyleProfilesRef = useRef<VisualStyleProfile[]>(visualStyleProfiles);
  useEffect(() => {
    setStyleProfilesForUi(visualStyleProfiles);
    visualStyleProfilesRef.current = visualStyleProfiles;
  }, [visualStyleProfiles]);
  useEffect(() => {
    if (!legacyVisualStyleProfiles.length || !onUpdateVisualStyleProfiles) return;
    const merged = mergeLegacyVisualStyleProfiles(visualStyleProfiles, legacyVisualStyleProfiles);
    if (merged.length === visualStyleProfiles.length) return;
    visualStyleProfilesRef.current = merged;
    setStyleProfilesForUi(merged);
    onUpdateVisualStyleProfiles(merged);
  }, [legacyVisualStyleProfiles, onUpdateVisualStyleProfiles, visualStyleProfiles]);
  useEffect(() => {
    // 兼容本次确认弹窗上线前误删的 3D 动画预设；新删除记录带 deletedAt，不会被恢复。
    const legacyDeleted3d = visualStyleProfiles.find(
      (profile) => profile.styleKey === '3d-animation' && profile.deleted && !profile.deletedAt
    );
    if (!legacyDeleted3d || !onUpdateVisualStyleProfiles) return;
    const restored = visualStyleProfiles.map((profile) =>
      profile.id === legacyDeleted3d.id
        ? { ...profile, deleted: false, updatedAt: Date.now() }
        : profile
    );
    visualStyleProfilesRef.current = restored;
    setStyleProfilesForUi(restored);
    onUpdateVisualStyleProfiles(restored);
    showAlert('已恢复 3D 动画视觉风格', { type: 'success' });
  }, [visualStyleProfiles, onUpdateVisualStyleProfiles, showAlert]);
  const [styleCreateRequest, setStyleCreateRequest] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [processingMessage, setProcessingMessage] = useState('');
  const [processingLogs, setProcessingLogs] = useState<string[]>([]);
  const [agentTraceSession, setAgentTraceSession] = useState<AgentTraceSession | null>(null);
  const [isAgentTraceOpen, setIsAgentTraceOpen] = useState(false);

  // Asset match state
  const [pendingParseResult, setPendingParseResult] = useState<{
    scriptData: ScriptData;
    shots: Shot[];
    matches: AssetMatchResult;
    title: string;
  } | null>(null);

  // Editing state - unified
  const [editingCharacterId, setEditingCharacterId] = useState<string | null>(null);
  const [editingCharacterPrompt, setEditingCharacterPrompt] = useState('');
  const [editingShotId, setEditingShotId] = useState<string | null>(null);
  const [editingShotPrompt, setEditingShotPrompt] = useState('');
  const [editingShotCharactersId, setEditingShotCharactersId] = useState<string | null>(null);
  const [editingShotActionId, setEditingShotActionId] = useState<string | null>(null);
  const [editingShotActionText, setEditingShotActionText] = useState('');
  const [editingShotDialogueText, setEditingShotDialogueText] = useState('');
  const [lastRewriteSnapshot, setLastRewriteSnapshot] = useState<string | null>(null);
  const analyzeAbortControllerRef = useRef<AbortController | null>(null);
  const rewriteAbortControllerRef = useRef<AbortController | null>(null);
  const agentTraceCounterRef = useRef(0);
  const localScriptRef = useRef(localScript);
  const rawScriptRef = useRef(project.rawScript);
  const updateProjectRef = useRef(updateProject);
  localScriptRef.current = localScript;
  rawScriptRef.current = project.rawScript;
  updateProjectRef.current = updateProject;

  const startAgentTrace = useCallback((title: string, subtitle?: string) => {
    const startedAt = Date.now();
    agentTraceCounterRef.current += 1;
    const session: AgentTraceSession = {
      id: `agent-trace-${startedAt}-${agentTraceCounterRef.current}`,
      title,
      subtitle,
      status: 'running',
      startedAt,
      entries: [],
    };
    setAgentTraceSession(session);
    setIsAgentTraceOpen(true);
    updateProject({ agentTraceSession: session });
  }, [updateProject]);

  const appendAgentTrace = useCallback((
    phase: string,
    message: string,
    status: AgentTraceEntryStatus = 'info',
    detail?: string,
    stableId?: string,
  ) => {
    const timestamp = Date.now();
    agentTraceCounterRef.current += 1;
    const id = stableId || `agent-entry-${timestamp}-${agentTraceCounterRef.current}`;
    setAgentTraceSession((session) => {
      if (!session) return session;
      const existingIndex = stableId
        ? session.entries.findIndex((entry) => entry.id === stableId)
        : -1;
      const entry = { id, phase, message, status, detail, timestamp };
      const entries = existingIndex >= 0
        ? [...session.entries.filter((current) => current.id !== stableId), entry].slice(-120)
        : [...session.entries, entry].slice(-120);
      const next = { ...session, entries };
      updateProject({ agentTraceSession: next });
      return next;
    });
  }, [updateProject]);

  const finishAgentTrace = useCallback((status: AgentTraceRunStatus) => {
    const completedAt = Date.now();
    setAgentTraceSession((session) => {
      if (!session) return session;
      const entryStatus: AgentTraceEntryStatus = status === 'error'
        ? 'error'
        : status === 'cancelled'
          ? 'warning'
          : 'success';
      const next = {
        ...session,
        status,
        completedAt: status === 'waiting' ? undefined : completedAt,
        entries: session.entries.map((entry) => (
          entry.status === 'running' ? { ...entry, status: entryStatus } : entry
        )),
      };
      updateProject({ agentTraceSession: next });
      return next;
    });
  }, [updateProject]);

  useEffect(() => {
    setLocalScript(project.rawScript);
    setLocalTitle(project.title);
    setLocalDuration(project.targetDuration || DEFAULTS.duration);
    setLocalLanguage(project.language || DEFAULTS.language);
    setLocalModel(resolveShotGenerationModel());
    setLocalVisualStyle(project.visualStyle || DEFAULTS.visualStyle);
    setPreviewVisualStyle(project.visualStyle || DEFAULTS.visualStyle);
    setEnableQualityCheck(true);
    setRewriteInstruction('');
    setSelectionRange(null);
    setLastRewriteSnapshot(null);
    setIsInferringVisualStyle(false);
    setAgentTraceSession(project.agentTraceSession || null);
    setIsAgentTraceOpen(false);
  }, [project.id]);

  // 上报生成状态给父组件，用于导航锁定
  useEffect(() => {
    const generating = isProcessing || isContinuing || isRewriting || isInferringVisualStyle;
    onGeneratingChange?.(generating);
  }, [isProcessing, isContinuing, isRewriting, isInferringVisualStyle]);

  // 组件卸载时重置生成状态。编辑器文本只在 project.id 变化时从项目回读，
  // 离开页面前必须把尚未写回的稿子刷进剧集，否则切走再回来会看到旧剧本。
  useEffect(() => {
    return () => {
      const script = localScriptRef.current;
      if (script !== rawScriptRef.current) {
        updateProjectRef.current({ rawScript: script });
      }
      analyzeAbortControllerRef.current?.abort();
      rewriteAbortControllerRef.current?.abort();
      onGeneratingChange?.(false);
    };
  }, [onGeneratingChange]);

  useEffect(() => {
    setScriptLogCallback((message) => {
      setProcessingLogs(prev => {
        const next = [...prev, message];
        return next.slice(-30);
      });
      appendAgentTrace(
        inferTracePhase(message),
        message,
        inferTraceStatus(message),
      );
    });

    return () => clearScriptLogCallback();
  }, [appendAgentTrace]);

  useEffect(() => {
    if (isProcessing || isContinuing || isRewriting) return;

    const draftDuration = getDraftValue(localDuration, customDurationInput, project.targetDuration || DEFAULTS.duration);
    const draftModel = resolveShotGenerationModel();
    const draftVisualStyle = getDraftValue(localVisualStyle, customStyleInput, project.visualStyle || DEFAULTS.visualStyle);

    const draftUpdates = {
      rawScript: localScript,
      title: localTitle,
      targetDuration: draftDuration,
      language: localLanguage,
      shotGenerationModel: draftModel,
      visualStyle: draftVisualStyle,
    };

    const unchanged =
      draftUpdates.rawScript === project.rawScript &&
      draftUpdates.title === project.title &&
      draftUpdates.targetDuration === project.targetDuration &&
      draftUpdates.language === project.language &&
      draftUpdates.shotGenerationModel === project.shotGenerationModel &&
      draftUpdates.visualStyle === project.visualStyle;

    if (unchanged) return;

    const timeoutId = window.setTimeout(() => {
      updateProject(draftUpdates);
    }, 450);

    return () => window.clearTimeout(timeoutId);
  }, [
    isProcessing,
    isContinuing,
    isRewriting,
    localScript,
    localTitle,
    localDuration,
    customDurationInput,
    localLanguage,
    localModel,
    customModelInput,
    localVisualStyle,
    customStyleInput,
    project.rawScript,
    project.title,
    project.targetDuration,
    project.language,
    project.shotGenerationModel,
    project.visualStyle,
    updateProject
  ]);

  const handleModelChange = async (modelId: string) => {
    if (!modelId) return;
    await setActiveModel('chat', modelId);
    setLocalModel(modelId);
    updateProject({ shotGenerationModel: modelId });
  };

  const getConfiguredModelForRequest = (): string => resolveShotGenerationModel();

  const getStyleOptionLabel = (styleValue: string): string => {
    const option = VISUAL_STYLE_OPTIONS.find(item => item.value === styleValue);
    if (option) return option.label.replace(/^[^\p{L}\p{N}]+/u, '').trim() || option.label;
    return styleValue === 'custom' ? '自定义风格' : styleValue;
  };

  const hasExistingAssetPrompts = (): boolean => {
    const data = project.scriptData;
    if (!data) return false;
    const hasChar = (data.characters || []).some(c => !!String(c.visualPrompt || '').trim());
    const hasScene = (data.scenes || []).some(s => !!String(s.visualPrompt || '').trim());
    const hasProp = (data.props || []).some(p => !!String(p.visualPrompt || '').trim());
    return hasChar || hasScene || hasProp;
  };

  const resolveStyleForPrompt = (styleValue: string, customInput?: string): string => {
    const trimmed = (customInput ?? customStyleInput).trim();
    const savedProfile = styleProfilesForUi.find((profile) => profile.styleKey === styleValue && !profile.deleted);
    if (savedProfile?.positivePrompt?.trim()) return savedProfile.positivePrompt.trim();
    if (styleValue !== 'custom') return styleValue;
    return trimmed || project.visualStyle || DEFAULTS.visualStyle;
  };

  const regenerateAssetPromptsForStyle = async (styleValue: string, customInput?: string) => {
    if (!project.scriptData) return;
    const styleForPrompt = resolveStyleForPrompt(styleValue, customInput);
    const model = getConfiguredModelForRequest();
    const genre = project.scriptData.genre || 'drama';
    let artDirection = project.scriptData.artDirection;

    setIsProcessing(true);
    setProcessingMessage(text('正在按新风格生成资产提示词…', 'Generating asset prompts for the new style…'));
    setError(null);

    try {
      const newData = cloneScriptData(project.scriptData);
      if (!artDirection?.visualStyle || artDirection.visualStyle !== styleForPrompt) {
        artDirection = await generateArtDirection(
          newData.title || '未命名剧本',
          genre,
          newData.logline || '',
          (newData.characters || []).map(c => ({
            name: c.name,
            gender: c.gender,
            age: c.age,
            personality: c.personality,
            species: c.species,
          })),
          (newData.scenes || []).map(s => ({
            location: s.location,
            time: s.time,
            atmosphere: s.atmosphere,
          })),
          styleForPrompt,
          localLanguage,
          model
        );
        newData.artDirection = artDirection;
      }
      let updatedCount = 0;
      const historicalContext = resolveProductionBible(newData).historicalContext;

      for (const char of newData.characters || []) {
        if (!String(char.visualPrompt || '').trim()) continue;
        const prompts = await generateVisualPrompts(
          'character',
          char,
          genre,
          model,
          styleForPrompt,
          localLanguage,
          artDirection,
          undefined,
          (newData.props || []).map(p => p.name),
          historicalContext,
        );
        char.promptVersions = updatePromptWithVersion(
          char.visualPrompt,
          prompts.visualPrompt,
          char.promptVersions,
          'ai-generated',
          'Regenerated after visual style change'
        );
        char.visualPrompt = prompts.visualPrompt;
        char.negativePrompt = prompts.negativePrompt;
        updatedCount += 1;
      }

      for (const scene of newData.scenes || []) {
        if (!String(scene.visualPrompt || '').trim()) continue;
        const prompts = await generateVisualPrompts(
          'scene',
          scene,
          genre,
          model,
          styleForPrompt,
          localLanguage,
          artDirection,
          undefined,
          (newData.props || []).map(p => p.name),
          historicalContext,
        );
        scene.promptVersions = updatePromptWithVersion(
          scene.visualPrompt,
          prompts.visualPrompt,
          scene.promptVersions,
          'ai-generated',
          'Regenerated after visual style change'
        );
        scene.visualPrompt = prompts.visualPrompt;
        scene.negativePrompt = prompts.negativePrompt;
        updatedCount += 1;
      }

      for (const prop of newData.props || []) {
        if (!String(prop.visualPrompt || '').trim()) continue;
        const prompts = await generateVisualPrompts(
          'prop',
          prop,
          genre,
          model,
          styleForPrompt,
          localLanguage,
          artDirection,
          undefined,
          undefined,
          historicalContext,
        );
        prop.promptVersions = updatePromptWithVersion(
          prop.visualPrompt,
          prompts.visualPrompt,
          prop.promptVersions,
          'ai-generated',
          'Regenerated after visual style change'
        );
        prop.visualPrompt = prompts.visualPrompt;
        prop.negativePrompt = prompts.negativePrompt;
        updatedCount += 1;
      }

      updateProject({
        visualStyle: styleForPrompt,
        scriptData: attachGenerationMeta(newData, {
          shotsKey: undefined,
        }),
      });

      showAlert(
        updatedCount > 0
          ? `已按新风格重写 ${updatedCount} 条资产提示词。画面不会自动更新，请到「资产」页对需要的项点击「重新生图」。`
          : '当前没有可重写的资产提示词。',
        { type: updatedCount > 0 ? 'success' : 'info' }
      );
    } catch (err: any) {
      console.error(err);
      setError(err?.message || '重新生成提示词失败');
      showAlert(err?.message || '重新生成提示词失败', { type: 'error' });
    } finally {
      setIsProcessing(false);
      setProcessingMessage('');
    }
  };

  const offerPromptRegenerateAfterStyleChange = (
    nextStyle: string,
    prevStyle: string,
    options?: { customInput?: string; nextLabel?: string }
  ) => {
    if (!hasExistingAssetPrompts()) return;
    if (nextStyle === prevStyle && !options?.customInput) return;

    const nextLabel = options?.nextLabel || getStyleOptionLabel(nextStyle);
    const prevLabel = getStyleOptionLabel(prevStyle);

    showAlert(
      `已从「${prevLabel}」切换为「${nextLabel}」。是否按新风格重新生成角色/场景/道具提示词？不会自动重新生图。`,
      {
        type: 'warning',
        title: '视觉风格已切换',
        showCancel: true,
        confirmText: '重新生成提示词',
        cancelText: '暂不重写',
        onConfirm: () => {
          void regenerateAssetPromptsForStyle(nextStyle, options?.customInput);
        },
      }
    );
  };

  const handleVisualStyleChange = (nextStyle: string) => {
    const prevStyle = localVisualStyle;
    if (nextStyle === prevStyle) return;
    setLocalVisualStyle(nextStyle);
    setPreviewVisualStyle(nextStyle);
    offerPromptRegenerateAfterStyleChange(nextStyle, prevStyle);
  };

  const handleSaveVisualStyleProfile = (profile: VisualStyleProfile) => {
    if (!onUpdateVisualStyleProfiles) return;
    const next = visualStyleProfilesRef.current.filter((item) => item.id !== profile.id && item.styleKey !== profile.styleKey);
    visualStyleProfilesRef.current = [...next, profile];
    setStyleProfilesForUi(visualStyleProfilesRef.current);
    onUpdateVisualStyleProfiles(visualStyleProfilesRef.current);
    if (profile.styleKey?.startsWith('custom')) {
      setCustomStyleInput(profile.positivePrompt);
      setLocalVisualStyle(profile.styleKey);
      setPreviewVisualStyle(profile.styleKey);
    }
    showAlert(`风格「${profile.label}」配置已保存`, { type: 'success' });
  };

  const handleDeleteVisualStyle = (profile: VisualStyleProfile) => {
    if (!onUpdateVisualStyleProfiles) return;
    showAlert(`确定删除视觉风格「${profile.label}」吗？删除后可通过重新添加恢复。`, {
      type: 'warning',
      title: '确认删除视觉风格',
      showCancel: true,
      confirmText: '确认删除',
      cancelText: '取消',
      onConfirm: () => {
        const deletedAt = Date.now();
        const nextProfiles = visualStyleProfilesRef.current.map((item) => item.id === profile.id ? { ...item, deleted: true, deletedAt, updatedAt: deletedAt } : item);
        visualStyleProfilesRef.current = nextProfiles;
        setStyleProfilesForUi(nextProfiles);
        onUpdateVisualStyleProfiles(nextProfiles);
        if (profile.styleKey === localVisualStyle) {
          const fallback = VISUAL_STYLE_OPTIONS.find((option) => option.value !== profile.styleKey && !styleProfilesForUi.some((item) => item.styleKey === option.value && item.deleted))?.value || DEFAULTS.visualStyle;
          setLocalVisualStyle(fallback);
          setPreviewVisualStyle(fallback);
          if (profile.styleKey.startsWith('custom')) setCustomStyleInput('');
        }
        showAlert(`风格「${profile.label}」已删除`, { type: 'success' });
      },
    });
  };

  const handleAddVisualStyle = () => {
    setStyleCreateRequest((current) => current + 1);
  };

  const handleRegenerateStylePreviewForStyle = (styleKey: string) => {
    const profile = resolveVisualStyleProfile(styleKey, styleProfilesForUi, '');
    void handleGenerateStylePreview({ ...profile, styleKey });
  };

  const handleApplyVisualStylePreview = (styleKey: string) => {
    setLocalVisualStyle(styleKey);
    setPreviewVisualStyle(styleKey);
  };

  const handleInferVisualStyleProfile = async (file: File) => {
    const imageDataUrl = await fileToDataUrl(file);
    const result = await inferVisualStyleFromImage(imageDataUrl, getConfiguredModelForRequest(), localLanguage);
    return {
      stylePrompt: result.stylePrompt,
      negativePrompt: result.negativePrompt,
      styleLabel: result.styleLabel,
      previewImage: imageDataUrl,
    };
  };

  const handleGenerateStylePreview = async (profile: VisualStyleProfile) => {
    if (!onUpdateVisualStyleProfiles) return;
    const previewKey = profile.styleKey || profile.id;
    if (generatingStylePreviewKeys.includes(previewKey)) return;
    setGeneratingStylePreviewKeys((current) => [...current, previewKey]);
    setError(null);
    try {
      const resolved = resolveVisualStyleProfile(profile.styleKey || 'custom', styleProfilesForUi, profile.positivePrompt);
      const imageUrl = await generateImage(
        getStylePreviewPrompt({ ...resolved, positivePrompt: profile.positivePrompt, negativePrompt: profile.negativePrompt }),
        [],
        '16:9',
        false,
        false,
        profile.negativePrompt,
        // 风格预览不是场景资产：不传 scene target，避免生成队列把它标成“场景”，结果由当前风格卡直接接收。
        { skipComfyImg2Img: true },
      );
      const updated = { ...profile, previewImage: imageUrl, updatedAt: Date.now() };
      handleSaveVisualStyleProfile(updated);
      showAlert('风格预览图已更新', { type: 'success' });
    } catch (err: any) {
      setError(err?.message || '风格预览生成失败');
      showAlert(err?.message || '风格预览生成失败', { type: 'error' });
    } finally {
      setGeneratingStylePreviewKeys((current) => current.filter((key) => key !== previewKey));
    }
  };

  const fileToDataUrl = (file: File): Promise<string> => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Failed to read image file'));
    reader.readAsDataURL(file);
  });

  const handleInferVisualStyleByImage = async (file: File) => {
    if (isInferringVisualStyle || isProcessing || isContinuing || isRewriting) {
      return;
    }
    const finalModel = getConfiguredModelForRequest();

    if (!finalModel) {
      setError('Please choose or input a chat model first.');
      return;
    }
    if (!file.type.startsWith('image/')) {
      setError('Please select an image file (PNG/JPG/WebP).');
      return;
    }

    setIsInferringVisualStyle(true);
    setError(null);

    try {
      const imageDataUrl = await fileToDataUrl(file);
      const result = await inferVisualStyleFromImage(
        imageDataUrl,
        finalModel,
        localLanguage
      );

      const inferredPrompt = String(result.stylePrompt || result.styleLabel || '').trim();
      if (!inferredPrompt) {
        throw new Error('empty style prompt returned');
      }
      setLocalVisualStyle('custom');
      setPreviewVisualStyle('custom');
      setCustomStyleInput(inferredPrompt);

      const confidenceText = typeof result.confidence === 'number'
        ? `（置信度 ${(result.confidence * 100).toFixed(0)}%）`
        : '';
      if (hasExistingAssetPrompts()) {
        offerPromptRegenerateAfterStyleChange('custom', localVisualStyle, {
          customInput: inferredPrompt,
          nextLabel: `自定义风格（图推）${confidenceText}`,
        });
      } else {
        showAlert(`风格提示词已生成${confidenceText}`, { type: 'success' });
      }
    } catch (err: any) {
      console.error(err);
      setError(`Style inference failed: ${err?.message || 'request failed'}`);
    } finally {
      setIsInferringVisualStyle(false);
    }
  };

  const handleAnalyze = async (runMode: AnalyzeRunMode = 'full') => {
    const finalDuration = getFinalValue(localDuration, customDurationInput);
    const finalModel = getConfiguredModelForRequest();
    const pendingVisualStyle = previewVisualStyle || localVisualStyle;
    const finalVisualStyle = getFinalValue(pendingVisualStyle, customStyleInput);
    if (pendingVisualStyle !== localVisualStyle) {
      setLocalVisualStyle(pendingVisualStyle);
    }

    const validation = validateConfig({
      script: localScript,
      duration: finalDuration,
      model: finalModel,
      visualStyle: finalVisualStyle
    });

    if (!validation.valid) {
      setError(validation.error);
      if (localScript.length > SCRIPT_HARD_LIMIT && validation.error) {
        showAlert(validation.error, { type: 'warning' });
      }
      return;
    }

    const previousScriptData = project.scriptData || null;
    const previousShots = Array.isArray(project.shots) ? project.shots : [];

    const structureKey = buildStepKey('structure', {
      script: localScript,
      language: localLanguage
    });
    const developmentKey = buildStepKey('development', {
      structureKey,
      model: finalModel,
      targetDuration: finalDuration,
      language: localLanguage
    });
    const visualsKey = buildStepKey('visuals', {
      developmentKey,
      language: localLanguage,
      model: finalModel,
      visualStyle: finalVisualStyle,
      historicalContext: resolveProductionBible(previousScriptData).historicalContext,
    });
    const shotsKey = buildStepKey('shots', {
      visualsKey,
      model: finalModel,
      targetDuration: finalDuration,
      enableQualityCheck
    });
    const frameworkKey = buildStepKey('shots', {
      developmentKey,
      model: finalModel,
      targetDuration: finalDuration,
      enableQualityCheck,
      mode: 'framework'
    });

    const analyzeConfigKey = buildAnalyzeConfigKey({
      script: localScript,
      language: localLanguage,
      targetDuration: finalDuration,
      model: finalModel,
      visualStyle: finalVisualStyle,
      enableQualityCheck
    });
    const savedCheckpoint = project.scriptGenerationCheckpoint;
    const resumeCheckpoint =
      savedCheckpoint && savedCheckpoint.configKey === analyzeConfigKey
        ? savedCheckpoint
        : null;

    let nextStep: AnalyzeRunStep = 'structure';
    let workingScriptData: ScriptData | null = resumeCheckpoint?.scriptData || previousScriptData || null;
    let shouldGenerateOnlyMissingVisuals = false;
    let reuseUnchangedScenes = !!previousScriptData && previousShots.length > 0;
    const preserveFrameworkShots =
      runMode === 'full' &&
      previousShots.length > 0 &&
      previousScriptData?.generationMeta?.frameworkKey === frameworkKey;

    const attachPreviousEpisodeContinuity = async (scriptData: ScriptData): Promise<ScriptData> => {
      if (!project.seriesId || project.episodeNumber <= 1) return scriptData;
      try {
        const summaries = await getEpisodesBySeries(project.seriesId);
        const priorSummaries = summaries.filter((episode) => episode.episodeNumber < project.episodeNumber);
        const priorEpisodes = await Promise.all(priorSummaries.map((episode) => loadEpisode(episode.id)));
        const incoming = buildIncomingSeriesContinuity(project, priorEpisodes);
        if (!incoming) return scriptData;
        appendAgentTrace(
          '跨集连续性',
          `已继承第 ${incoming.sourceEpisodeNumber || '?'} 集结束状态`,
          'info',
          incoming.openThreads.length ? `未结线索 ${incoming.openThreads.length} 条` : '无已登记未结线索',
        );
        return applyIncomingSeriesContinuity(scriptData, incoming);
      } catch (error) {
        console.warn('Unable to load prior episode continuity; continuing without it.', error);
        return scriptData;
      }
    };

    if (resumeCheckpoint?.scriptData) {
      nextStep = resumeCheckpoint.step;
      shouldGenerateOnlyMissingVisuals = resumeCheckpoint.step === 'visuals';
    } else {
      const meta = previousScriptData?.generationMeta;
      if (!previousScriptData || !meta?.structureKey) {
        nextStep = 'structure';
      } else if (meta.structureKey !== structureKey) {
        nextStep = 'structure';
      } else if (meta.developmentKey !== developmentKey) {
        nextStep = 'development';
      } else if (meta.visualsKey !== visualsKey) {
        nextStep = 'visuals';
      } else if (meta.shotsKey !== shotsKey || previousShots.length === 0) {
        nextStep = 'shots';
      } else {
        nextStep = 'done';
      }

      const visualsInputStable =
        !!previousScriptData &&
        previousScriptData.language === localLanguage &&
        previousScriptData.visualStyle === finalVisualStyle &&
        previousScriptData.shotGenerationModel === finalModel;
      shouldGenerateOnlyMissingVisuals = nextStep === 'structure' && visualsInputStable;
    }

    if (runMode === 'framework' && nextStep === 'visuals') {
      nextStep = 'shots';
      shouldGenerateOnlyMissingVisuals = false;
    }
    if (preserveFrameworkShots && nextStep === 'visuals') {
      // Framework-first projects may already contain hand-authored prompts.
      // Completing the visual stage must not overwrite those edits.
      shouldGenerateOnlyMissingVisuals = true;
    }

    if (nextStep === 'done') {
      setError(null);
      setProcessingLogs([]);
      startAgentTrace('分镜 Agent 工作流', `${finalModel} · ${finalDuration} · ${getStyleOptionLabel(finalVisualStyle)}`);
      appendAgentTrace('断点检查', '配置未变化，已复用现有分镜结果。', 'success');
      finishAgentTrace('completed');
      logScriptProgress('配置未变化，已复用现有分镜结果。');
      showAlert('未检测到变更，已复用现有分镜结果。', { type: 'success' });
      setActiveTab('script');
      return;
    }

    if (!workingScriptData && nextStep !== 'structure') {
      nextStep = 'structure';
      shouldGenerateOnlyMissingVisuals = false;
    }

    analyzeAbortControllerRef.current?.abort();
    const controller = new AbortController();
    analyzeAbortControllerRef.current = controller;

    setIsProcessing(true);
    setProcessingMessage(text('正在准备生成流程…', 'Preparing generation…'));
    setProcessingLogs([]);
    setError(null);
    startAgentTrace(runMode === 'framework' ? '分镜框架工作流' : '分镜 Agent 工作流', `${finalModel} · ${finalDuration} · ${getStyleOptionLabel(finalVisualStyle)}`);

    console.log('📌 用户选择的模型:', finalModel);
    console.log('📌 最终使用的模型:', finalModel);
    console.log('🎨 视觉风格:', finalVisualStyle);
    logScriptProgress(`已选择模型：${finalModel}`);
    logScriptProgress(`最终使用模型：${finalModel}`);
    logScriptProgress(`视觉风格：${finalVisualStyle}`);
    if (resumeCheckpoint) {
      logScriptProgress(`检测到断点，将从 ${resumeCheckpoint.step} 步骤继续`);
    }

    // 分镜仍由前端编排，但每个阶段/场景都立即写入服务端。
    // 这样 Fast Refresh 或页面重新挂载最多只会中断当前请求，不会丢掉已完成结果。
    let generationPersistQueue: Promise<void> = Promise.resolve();
    const persistGenerationState = (updates: Partial<ProjectState>): Promise<void> => {
      updateProject(updates);
      const changedKeys = Object.keys(updates) as (keyof ProjectState)[];
      const snapshot: ProjectState = { ...project, ...updates };
      generationPersistQueue = generationPersistQueue
        .catch(() => undefined)
        .then(async () => {
          try {
            await saveEpisodePartial(snapshot, changedKeys);
          } catch (error) {
            console.warn('保存分镜生成断点失败，将由自动保存再次尝试。', error);
          }
        });
      return generationPersistQueue;
    };

    try {
      await persistGenerationState({
        title: localTitle,
        rawScript: localScript,
        targetDuration: finalDuration,
        language: localLanguage,
        visualStyle: finalVisualStyle,
        shotGenerationModel: finalModel,
        isParsingScript: true,
        scriptGenerationCheckpoint: createAnalyzeCheckpoint(nextStep, analyzeConfigKey, workingScriptData)
      });

      if (nextStep === 'structure' || !workingScriptData) {
        setProcessingMessage(text('正在解析剧本结构…', 'Parsing script structure…'));
        logScriptProgress('开始解析剧本结构...');
        const structured = await parseScriptStructure(
          localScript,
          localLanguage,
          finalModel,
          controller.signal
        );
        const hydrated = hydrateScriptDataMeta(structured, {
          targetDuration: finalDuration,
          language: localLanguage,
          visualStyle: finalVisualStyle,
          model: finalModel,
          localTitle
        });
        const canReuseVisualData =
          !!previousScriptData &&
          previousScriptData.language === localLanguage &&
          previousScriptData.visualStyle === finalVisualStyle &&
          previousScriptData.shotGenerationModel === finalModel;
        workingScriptData = reuseVisualDataFromPrevious(hydrated, previousScriptData, canReuseVisualData);
        workingScriptData = attachGenerationMeta(workingScriptData, { structureKey });
        appendAgentTrace(
          '结构 Agent',
          '剧本结构解析完成',
          'success',
          `识别角色 ${workingScriptData.characters.length} 个 · 场景 ${workingScriptData.scenes.length} 个 · 道具 ${workingScriptData.props.length} 个`,
        );
        shouldGenerateOnlyMissingVisuals = canReuseVisualData;
        nextStep = 'development';
        await persistGenerationState({
          scriptData: workingScriptData,
          isParsingScript: true,
          scriptGenerationCheckpoint: createAnalyzeCheckpoint(nextStep, analyzeConfigKey, workingScriptData)
        });
      }

      if (nextStep === 'development') {
        workingScriptData = await attachPreviousEpisodeContinuity(workingScriptData!);
        setProcessingMessage(text('编剧 Agent 正在深化剧情、角色表演与场景转折…', 'Writer agent is deepening plot, performances, and story turns…'));
        logScriptProgress('启动编剧 Agent 创作开发阶段...');
        const developed = await developScriptForProduction(
          workingScriptData!,
          finalModel,
          controller.signal
        );
        workingScriptData = attachGenerationMeta(
          hydrateScriptDataMeta(developed, {
            targetDuration: finalDuration,
            language: localLanguage,
            visualStyle: finalVisualStyle,
            model: finalModel,
            localTitle
          }),
          { structureKey, developmentKey }
        );
        appendAgentTrace(
          '编剧 Agent',
          workingScriptData.creativeDevelopment?.status === 'generated'
            ? '全片创作意图与角色表演方向已锁定'
            : '创作开发已使用可追踪兜底方案完成',
          workingScriptData.creativeDevelopment?.status === 'generated' ? 'success' : 'warning',
          summarizeCreativeDevelopment(workingScriptData),
        );
        shouldGenerateOnlyMissingVisuals = false;
        reuseUnchangedScenes = false;
        nextStep = runMode === 'framework' ? 'shots' : 'visuals';
        await persistGenerationState({
          scriptData: workingScriptData,
          isParsingScript: true,
          scriptGenerationCheckpoint: createAnalyzeCheckpoint(nextStep, analyzeConfigKey, workingScriptData)
        });
      }

      if (nextStep === 'visuals') {
        const visualPassMode = shouldGenerateOnlyMissingVisuals ? '增量补全' : '全量重建';
        setProcessingMessage(text(`正在生成角色/场景/道具视觉提示词（${visualPassMode}）…`, `Generating visual prompts for characters, locations, and props (${visualPassMode === '增量补全' ? 'incremental' : 'full'})…`));
        logScriptProgress(`开始生成视觉提示词（${visualPassMode}）...`);
        if (!shouldGenerateOnlyMissingVisuals) {
          reuseUnchangedScenes = false;
        }
        const enriched = await enrichScriptDataVisuals(
          workingScriptData!,
          finalModel,
          finalVisualStyle,
          localLanguage,
          {
            abortSignal: controller.signal,
            onlyMissing: shouldGenerateOnlyMissingVisuals
          }
        );
        const hydrated = hydrateScriptDataMeta(enriched, {
          targetDuration: finalDuration,
          language: localLanguage,
          visualStyle: finalVisualStyle,
          model: finalModel,
          localTitle
        });
        workingScriptData = attachGenerationMeta(hydrated, { structureKey, developmentKey, visualsKey });
        appendAgentTrace(
          '视觉 Agent',
          `视觉提示词${visualPassMode === '增量补全' ? '补全' : '生成'}完成`,
          'success',
          `角色 ${workingScriptData.characters.length} 个 · 场景 ${workingScriptData.scenes.length} 个 · 道具 ${workingScriptData.props.length} 个`,
        );
        nextStep = 'shots';
        await persistGenerationState({
          scriptData: workingScriptData,
          isParsingScript: true,
          scriptGenerationCheckpoint: createAnalyzeCheckpoint(nextStep, analyzeConfigKey, workingScriptData)
        });
      } else {
        workingScriptData = attachGenerationMeta(
          workingScriptData!,
          runMode === 'framework'
            ? { structureKey, developmentKey }
            : { structureKey, developmentKey, visualsKey }
        );
      }

      if (runMode === 'full' && preserveFrameworkShots && nextStep === 'shots') {
        workingScriptData = attachGenerationMeta(
          hydrateScriptDataMeta(workingScriptData!, {
            targetDuration: finalDuration,
            language: localLanguage,
            visualStyle: finalVisualStyle,
            model: finalModel,
            localTitle
          }),
          { structureKey, developmentKey, visualsKey, frameworkKey, shotsKey }
        );
        const rebuiltRefs = rebuildAssetRefsFromScriptData(workingScriptData);
        await persistGenerationState({
          scriptData: workingScriptData,
          characterRefs: rebuiltRefs.characterRefs,
          sceneRefs: rebuiltRefs.sceneRefs,
          propRefs: rebuiltRefs.propRefs,
          isParsingScript: false,
          title: workingScriptData.title,
          scriptGenerationCheckpoint: null
        });
        appendAgentTrace('分镜框架', '已保留现有镜头结构，仅补全资产提示词。', 'success');
        finishAgentTrace('completed');
        setActiveTab('script');
        return;
      }

      setProcessingMessage(text('正在生成分镜…', 'Generating storyboard shots…'));
      const isResumingShots = resumeCheckpoint?.step === 'shots';
      // 新一轮生成先清空旧镜头；否则刷新后会把“尚未处理的旧镜头”误判为本次已完成结果。
      // 只有明确处于 shots 断点时，才把数据库里的镜头当作可恢复的已完成场景。
      const resumableShots = isResumingShots ? previousShots : [];
      const partialShotsByScene = new Map<string, Shot[]>();
      for (const scene of workingScriptData!.scenes) {
        const completedForScene = filterBySceneIdCompat(resumableShots, scene.id);
        if (completedForScene.length > 0) {
          partialShotsByScene.set(String(scene.id), completedForScene);
        }
      }
      const getOrderedPartialShots = (): Shot[] =>
        workingScriptData!.scenes.flatMap((scene) => partialShotsByScene.get(String(scene.id)) || []);

      if (!isResumingShots) {
        await persistGenerationState({
          scriptData: workingScriptData!,
          shots: [],
          isParsingScript: true,
          scriptGenerationCheckpoint: createAnalyzeCheckpoint('shots', analyzeConfigKey, workingScriptData)
        });
      }

      logScriptProgress(
        reuseUnchangedScenes
          ? '开始生成分镜（启用未变场景复用）...'
          : '开始生成分镜...'
      );
      logScriptProgress(enableQualityCheck ? '已启用分镜质量校验（故事门禁 → 结构审片 → 字段审片）。' : '分镜质量校验已关闭。');
      const shots = await generateShotList(workingScriptData!, finalModel, {
        abortSignal: controller.signal,
        previousScriptData,
        previousShots,
        reuseUnchangedScenes,
        enableQualityCheck,
        rawScript: localScript,
        promptTemplates,
        onSceneComplete: async ({ scene, shots: completedShots, mode }) => {
          const targetScene = workingScriptData!.scenes.find((candidate) =>
            sceneIdsMatch(candidate.id, scene.id)
          );
          partialShotsByScene.set(String(targetScene?.id || scene.id), completedShots);
          const partialShots = getOrderedPartialShots();
          await persistGenerationState({
            scriptData: workingScriptData!,
            shots: partialShots,
            isParsingScript: true,
            scriptGenerationCheckpoint: createAnalyzeCheckpoint('shots', analyzeConfigKey, workingScriptData)
          });
          logScriptProgress(`已保存场景 ${scene.location || '未命名场景'} 的 ${completedShots.length} 条${mode === 'reused' ? '复用' : ''}分镜断点。`);
        },
      });
      workingScriptData = updateOutgoingSeriesContinuity(workingScriptData!);
      workingScriptData = attachGenerationMeta(
        hydrateScriptDataMeta(workingScriptData, {
          targetDuration: finalDuration,
          language: localLanguage,
          visualStyle: finalVisualStyle,
          model: finalModel,
          localTitle
        }),
        runMode === 'framework'
          ? { structureKey, developmentKey, frameworkKey, visualsKey: undefined, shotsKey: undefined }
          : { structureKey, developmentKey, visualsKey, frameworkKey, shotsKey }
      );
      const reviewedShots = shots.filter((shot) => !!shot.agent?.semanticReview);
      const repairedShots = reviewedShots.filter((shot) => shot.agent?.semanticReview?.repaired);
      const warningShots = reviewedShots.filter((shot) => shot.agent?.semanticReview?.verdict !== 'pass');
      const structureReview = workingScriptData?.storyboardStructureReview;
      const outlineReview = workingScriptData?.storyOutlineReview;
      if (outlineReview) {
        appendAgentTrace(
          '故事层门禁',
          outlineReview.summary,
          outlineReview.verdict === 'pass' ? 'success' : 'warning',
          outlineReview.issues.length ? outlineReview.issues.slice(0, 4).join('；') : undefined,
        );
      }
      if (structureReview) {
        appendAgentTrace(
          '结构审片',
          structureReview.summary,
          structureReview.verdict === 'pass' && structureReview.issues.length === 0 ? 'success' : 'warning',
          `问题 ${structureReview.issues.length} · 自动修复 ${structureReview.appliedActionCount} · 删镜 ${structureReview.removedShotIds.length}`,
        );
      }
      appendAgentTrace(
        '字段审片',
        `分镜生成与审查完成，共 ${shots.length} 镜`,
        warningShots.length > 0 ? 'warning' : 'success',
        enableQualityCheck
          ? `已审查 ${reviewedShots.length} 镜 · 字段修复 ${repairedShots.length} 镜 · 仍需注意 ${warningShots.length} 镜`
          : '质量校验已关闭，仅完成分镜生成',
      );

      if (project.projectId) {
        try {
          const seriesProject = await loadSeriesProject(project.projectId);
          if (seriesProject) {
            const matches = findAssetMatches(workingScriptData!, seriesProject);
            if (matches.hasAnyMatch) {
              setPendingParseResult({
                scriptData: workingScriptData!,
                shots,
                matches,
                title: workingScriptData!.title
              });
              updateProject({
                isParsingScript: false,
                scriptGenerationCheckpoint: null
              });
              setIsProcessing(false);
              setProcessingMessage('');
              appendAgentTrace('资产匹配', '检测到可复用资产，等待用户确认匹配结果。', 'info');
              finishAgentTrace('waiting');
              return;
            }
          }
        } catch (e) {
          console.warn('Asset match check failed, proceeding without match:', e);
        }
      }

      const rebuiltRefs = rebuildAssetRefsFromScriptData(workingScriptData!);
      await persistGenerationState({
        scriptData: workingScriptData!,
        shots,
        characterRefs: rebuiltRefs.characterRefs,
        sceneRefs: rebuiltRefs.sceneRefs,
        propRefs: rebuiltRefs.propRefs,
        isParsingScript: false,
        title: workingScriptData!.title,
        scriptGenerationCheckpoint: null
      });

      appendAgentTrace('Agent 工作流', '结构、创作开发、视觉提示词和分镜已写入项目。', 'success');
      finishAgentTrace(workingScriptData.storyboardAgentRun?.status === 'degraded' ? 'warning' : 'completed');
      setActiveTab('script');
    } catch (err: any) {
      console.error(err);
      if (isAbortError(err, controller.signal)) {
        setError('已取消生成，可点击“继续生成分镜脚本”从断点继续。');
        logScriptProgress('生成已取消，可点击继续按钮从断点续跑。');
        appendAgentTrace('Agent 工作流', '生成已取消，当前断点已经保留。', 'warning');
        finishAgentTrace('cancelled');
      } else {
        setError(`错误: ${err.message || 'AI 连接失败'}`);
        appendAgentTrace('Agent 工作流', '生成流程中断。', 'error', String(err.message || 'AI 连接失败'));
        finishAgentTrace('error');
      }
      await persistGenerationState({ isParsingScript: false });
    } finally {
      if (analyzeAbortControllerRef.current === controller) {
        analyzeAbortControllerRef.current = null;
      }
      setIsProcessing(false);
      setProcessingMessage('');
    }
  };

  const handleCancelAnalyze = () => {
    if (!isProcessing) return;
    analyzeAbortControllerRef.current?.abort();
    setProcessingMessage(text('正在取消生成…', 'Cancelling generation…'));
    logScriptProgress('正在取消当前生成流程...');
  };

  const handleGenerateMissingVisuals = async () => {
    if (!project.scriptData) {
      showAlert(text('请先生成分镜框架。', 'Generate the storyboard framework first.'), { type: 'warning' });
      return;
    }

    const finalDuration = getFinalValue(localDuration, customDurationInput);
    const finalModel = getConfiguredModelForRequest();
    const finalVisualStyle = getFinalValue(previewVisualStyle || localVisualStyle, customStyleInput);
    const structureKey = buildStepKey('structure', { script: localScript, language: localLanguage });
    const developmentKey = buildStepKey('development', {
      structureKey,
      model: finalModel,
      targetDuration: finalDuration,
      language: localLanguage,
    });
    const visualsKey = buildStepKey('visuals', {
      developmentKey,
      language: localLanguage,
      model: finalModel,
      visualStyle: finalVisualStyle,
      historicalContext: resolveProductionBible(project.scriptData).historicalContext,
    });

    analyzeAbortControllerRef.current?.abort();
    const controller = new AbortController();
    analyzeAbortControllerRef.current = controller;
    setIsProcessing(true);
    setProcessingMessage(text('正在补全资产提示词…', 'Filling missing asset prompts…'));
    setProcessingLogs([]);
    setError(null);
    startAgentTrace('资产提示词工作流', `${finalModel} · ${getStyleOptionLabel(finalVisualStyle)}`);

    try {
      const beforeCount = [
        ...(project.scriptData.characters || []),
        ...(project.scriptData.scenes || []),
        ...(project.scriptData.props || []),
      ].filter((asset) => !String(asset.visualPrompt || '').trim()).length;
      const enriched = await enrichScriptDataVisuals(
        project.scriptData,
        finalModel,
        finalVisualStyle,
        localLanguage,
        { onlyMissing: true, abortSignal: controller.signal },
      );
      const nextData = attachGenerationMeta(
        hydrateScriptDataMeta(enriched, {
          targetDuration: finalDuration,
          language: localLanguage,
          visualStyle: finalVisualStyle,
          model: finalModel,
          localTitle,
        }),
        { structureKey, developmentKey, visualsKey },
      );
      updateProject({
        title: nextData.title,
        targetDuration: finalDuration,
        language: localLanguage,
        visualStyle: finalVisualStyle,
        shotGenerationModel: finalModel,
        scriptData: nextData,
      });
      await saveEpisodePartial(
        {
          ...project,
          title: nextData.title,
          targetDuration: finalDuration,
          language: localLanguage,
          visualStyle: finalVisualStyle,
          shotGenerationModel: finalModel,
          scriptData: nextData,
        },
        ['title', 'targetDuration', 'language', 'visualStyle', 'shotGenerationModel', 'scriptData'],
      );
      appendAgentTrace('视觉 Agent', '缺失资产提示词已补全；已有提示词保持不变。', 'success', `待补全项：${beforeCount}`);
      finishAgentTrace('completed');
      setActiveTab('script');
      showAlert(text('已补全缺失的资产提示词，已有内容未覆盖。', 'Missing asset prompts were filled without overwriting existing content.'), { type: 'success' });
    } catch (error: any) {
      if (isAbortError(error, controller.signal)) {
        appendAgentTrace('资产提示词工作流', '生成已取消。', 'warning');
        finishAgentTrace('cancelled');
      } else {
        setError(`错误: ${error?.message || 'AI 连接失败'}`);
        appendAgentTrace('资产提示词工作流', '生成失败。', 'error', String(error?.message || 'AI 连接失败'));
        finishAgentTrace('error');
      }
    } finally {
      if (analyzeAbortControllerRef.current === controller) analyzeAbortControllerRef.current = null;
      setIsProcessing(false);
      setProcessingMessage('');
    }
  };

  const handleAssetMatchConfirm = (finalMatches: AssetMatchResult) => {
    if (!pendingParseResult) return;
    const { scriptData, shots } = pendingParseResult;
    const result = applyAssetMatches(scriptData, shots, finalMatches);

    updateProject({
      scriptData: result.scriptData,
      shots: result.shots,
      characterRefs: result.characterRefs,
      sceneRefs: result.sceneRefs,
      propRefs: result.propRefs,
      isParsingScript: false,
      title: result.scriptData.title,
      scriptGenerationCheckpoint: null,
    });

    setPendingParseResult(null);
    appendAgentTrace('资产匹配', '资产匹配已确认，分镜结果已写入项目。', 'success');
    finishAgentTrace('completed');
    setActiveTab('script');
  };

  const handleAssetMatchCancel = () => {
    if (!pendingParseResult) return;
    const { scriptData, shots, title } = pendingParseResult;
    const rebuiltRefs = rebuildAssetRefsFromScriptData(scriptData);

    updateProject({
      scriptData,
      shots,
      characterRefs: rebuiltRefs.characterRefs,
      sceneRefs: rebuiltRefs.sceneRefs,
      propRefs: rebuiltRefs.propRefs,
      isParsingScript: false,
      title,
      scriptGenerationCheckpoint: null,
    });

    setPendingParseResult(null);
    appendAgentTrace('资产匹配', '已跳过资产匹配，保留本次新生成的资产与分镜。', 'success');
    finishAgentTrace('completed');
    setActiveTab('script');
  };

  const handleContinueScript = async () => {
    const finalModel = getConfiguredModelForRequest();
    const baseScript = localScript;
    const separator = baseScript.trim() ? '\n\n' : '';
    const continueBudget = SCRIPT_HARD_LIMIT - baseScript.length - separator.length;
    
    if (!baseScript.trim()) {
      setError("请先输入一些剧本内容作为基础。");
      return;
    }
    if (!finalModel) {
      setError("请选择或输入模型名称。");
      return;
    }
    if (continueBudget <= 0) {
      const message = `当前剧本已达到单集上限 ${SCRIPT_HARD_LIMIT} 字符，无法继续续写，请先拆分为多集。`;
      setError(message);
      showAlert(message, { type: 'warning' });
      return;
    }

    setIsContinuing(true);
    setProcessingMessage(text('AI续写中…', 'AI continuation in progress…'));
    setProcessingLogs([]);
    setError(null);
    startAgentTrace('剧本续写 Agent', `${finalModel} · 原稿 ${baseScript.length} 字`);
    appendAgentTrace(
      '输入分析',
      '已读取当前剧本并锁定续写边界',
      'success',
      `输出语言：${localLanguage}\n体裁：${storyFormLabel(storyForm, customStoryForm)}\n剩余可写：${continueBudget} 字\n用户要求：${rewriteInstruction.trim() || (storyForm === 'dramatic' ? '延续当前剧情、人物与场景连续性' : `按${storyFormLabel(storyForm, customStoryForm)}续写，保持体裁`)}`,
    );
    let streamed = '';
    let wasTruncated = false;
    let lastTraceLength = 0;
    try {
      const continuedContent = await continueScriptStream(
        baseScript,
        localLanguage,
        finalModel,
        (delta) => {
          const remaining = continueBudget - streamed.length;
          if (remaining <= 0) {
            wasTruncated = true;
            return;
          }
          const safeDelta = delta.slice(0, remaining);
          if (!safeDelta) {
            wasTruncated = true;
            return;
          }
          streamed += safeDelta;
          const newScript = `${baseScript}${separator}${streamed}`;
          setLocalScript(newScript);
          updateProject({ rawScript: newScript });
          if (streamed.length - lastTraceLength >= 120) {
            lastTraceLength = streamed.length;
            appendAgentTrace('续写 Agent', '正在流式续写剧本', 'running', `已新增 ${streamed.length} 字`, 'continuation-draft');
          }
        },
        {
          maxAppendChars: continueBudget,
          maxTotalChars: SCRIPT_HARD_LIMIT,
          instruction: rewriteInstruction.trim() || undefined,
          storyForm,
          storyFormLabel: storyForm === 'other' ? customStoryForm.trim() || undefined : undefined,
        }
      );
      if (continuedContent) {
        const safeContent = continuedContent.slice(0, continueBudget);
        if (safeContent.length < continuedContent.length) {
          wasTruncated = true;
        }
        const newScript = `${baseScript}${separator}${safeContent}`;
        setLocalScript(newScript);
        updateProject({ rawScript: newScript });
      }
      appendAgentTrace('结果校验', wasTruncated ? '续写已按长度上限截断' : '续写完成并已写入编辑器', wasTruncated ? 'warning' : 'success', `本次新增 ${Math.min(continuedContent.length, continueBudget)} 字`);
      finishAgentTrace(wasTruncated ? 'warning' : 'completed');
      if (wasTruncated) {
        showAlert(`续写内容已按单集上限自动截断（最大总长 ${SCRIPT_HARD_LIMIT} 字符）。`, { type: 'warning' });
      }
    } catch (err: any) {
      console.error(err);
      setError(`AI续写失败: ${err.message || "连接失败"}`);
      appendAgentTrace('续写 Agent', '流式续写失败，正在使用兼容请求重试', 'warning', String(err.message || '连接失败'));
      try {
        const continuedContent = await continueScript(
          baseScript,
          localLanguage,
          finalModel,
          {
            maxAppendChars: continueBudget,
            maxTotalChars: SCRIPT_HARD_LIMIT,
            instruction: rewriteInstruction.trim() || undefined,
            storyForm,
            storyFormLabel: storyForm === 'other' ? customStoryForm.trim() || undefined : undefined,
          }
        );
        const safeContent = continuedContent.slice(0, continueBudget);
        if (safeContent.length < continuedContent.length) {
          showAlert(`续写内容已按单集上限自动截断（最大总长 ${SCRIPT_HARD_LIMIT} 字符）。`, { type: 'warning' });
        }
        const newScript = `${baseScript}${separator}${safeContent}`;
        setLocalScript(newScript);
        updateProject({ rawScript: newScript });
        appendAgentTrace('项目写回', '兼容续写完成并已写入编辑器', 'success', `本次新增 ${safeContent.length} 字`);
        finishAgentTrace('warning');
      } catch (fallbackErr: any) {
        console.error(fallbackErr);
        appendAgentTrace('Agent 工作流', '续写失败，未覆盖原稿', 'error', String(fallbackErr?.message || fallbackErr || '连接失败'));
        finishAgentTrace('error');
      }
    } finally {
      setIsContinuing(false);
      setProcessingMessage('');
    }
  };

  const handleRewriteScript = async () => {
    const finalModel = getConfiguredModelForRequest();
    const baseScript = localScript;
    const rewriteTargetDuration = getDraftValue(
      localDuration,
      customDurationInput,
      project.targetDuration || DEFAULTS.duration,
    );
    
    if (!baseScript.trim()) {
      setError("请先输入剧本内容。");
      return;
    }
    if (!finalModel) {
      setError("请选择或输入模型名称。");
      return;
    }

    rewriteAbortControllerRef.current?.abort();
    const controller = new AbortController();
    rewriteAbortControllerRef.current = controller;

    setIsRewriting(true);
    setProcessingMessage(text('策划 Agent 正在分析原稿…', 'Planning agent is analyzing the draft…'));
    setProcessingLogs([]);
    setError(null);
    startAgentTrace('多阶段剧本改写 Agent', `${finalModel} · ${baseScript.length} 字`);
    appendAgentTrace(
      '输入分析',
      '已读取原稿并锁定改写约束',
      'success',
      `输出语言：${localLanguage}\n体裁：${storyFormLabel(storyForm, customStoryForm)}\n目标时长：${rewriteTargetDuration}\n字符上限：${SCRIPT_HARD_LIMIT}\n用户要求：${rewriteInstruction.trim() || (storyForm === 'dramatic' ? '使用默认的结构、冲突、对白和节奏优化策略' : `按${storyFormLabel(storyForm, customStoryForm)}改写，不套用短片规则`)}`,
    );

    let activeDraftStage: 'rewriting' | 'repairing' = 'rewriting';
    let lastTraceLength = 0;
    let lastTraceAt = 0;

    try {
      const result = await runScriptRewriteAgent(
        baseScript,
        localLanguage,
        finalModel,
        {
          maxOutputChars: SCRIPT_HARD_LIMIT,
          instruction: rewriteInstruction.trim() || undefined,
          targetDuration: rewriteTargetDuration,
          storyForm,
          storyFormLabel: storyForm === 'other' ? customStoryForm.trim() || undefined : undefined,
          abortSignal: controller.signal,
          onEvent: (event) => {
            const phaseByStage = {
              planning: '策划 Agent',
              rewriting: '改写 Agent',
              reviewing: '审稿 Agent',
              repairing: '修稿 Agent',
              verifying: '终稿复核 Agent',
              completed: 'Agent 工作流',
            } as const;
            appendAgentTrace(
              phaseByStage[event.stage],
              event.title,
              event.status,
              event.detail,
              event.stableId,
            );
            setProcessingMessage(event.title);
            setProcessingLogs((previous) => [...previous, event.title].slice(-30));
          },
          onDraftUpdate: (draft, stage) => {
            const safeDraft = draft.slice(0, SCRIPT_HARD_LIMIT);
            setLocalScript(safeDraft);
            const now = Date.now();
            if (stage !== activeDraftStage) {
              activeDraftStage = stage;
              lastTraceLength = 0;
              lastTraceAt = 0;
            }
            if (safeDraft.length - lastTraceLength >= 120 || now - lastTraceAt >= 700) {
              lastTraceLength = safeDraft.length;
              lastTraceAt = now;
              appendAgentTrace(
                stage === 'rewriting' ? '改写 Agent' : '修稿 Agent',
                stage === 'rewriting' ? '正在流式生成完整改写稿' : '正在流式生成修订终稿',
                'running',
                `已接收 ${safeDraft.length} 字 · 编辑器正在同步更新`,
                stage === 'rewriting' ? 'rewriting-draft' : 'rewrite-repair',
              );
            }
          },
        },
      );

      const finalContent = result.script.trim().slice(0, SCRIPT_HARD_LIMIT);
      if (!finalContent) {
        throw new Error('改写 Agent 未返回剧本内容');
      }
      if (finalContent !== baseScript) {
        setLastRewriteSnapshot(baseScript);
      }
      setLocalScript(finalContent);
      updateProject({ rawScript: finalContent });
      setSelectionRange(null);
      const validation = summarizeRewriteValidation(baseScript, finalContent, SCRIPT_HARD_LIMIT);
      appendAgentTrace('结果校验', validation.message, validation.status, validation.detail);
      appendAgentTrace(
        '项目写回',
        'Agent 终稿已写入编辑器并自动保存，可使用“撤回”恢复原稿。',
        'success',
        `终审评分 ${result.review.overallScore}/100${result.repaired ? ` · 已修复 ${result.repairedIssueCount} 项` : ''}`,
      );
      finishAgentTrace(result.degraded || validation.status === 'warning' ? 'warning' : 'completed');
      if (result.degraded) {
        showAlert('多阶段改写已完成，但部分阶段使用了降级策略；详情见 Agent 执行轨迹。', { type: 'warning' });
      }
    } catch (agentError: unknown) {
      console.error(agentError);
      setLocalScript(baseScript);
      updateProject({ rawScript: baseScript });
      if (isAbortError(agentError, controller.signal)) {
        setError('已取消 AI 改写，原稿已恢复。');
        appendAgentTrace('Agent 工作流', '改写已取消，原稿未被覆盖。', 'warning');
        finishAgentTrace('cancelled');
      } else {
        const message = agentError instanceof Error ? agentError.message : '连接失败';
        setError(`AI改写失败，已恢复原稿: ${message}`);
        appendAgentTrace('Agent 工作流', '多阶段改写未完成，已恢复原稿。', 'error', message);
        finishAgentTrace('error');
      }
    } finally {
      if (rewriteAbortControllerRef.current === controller) {
        rewriteAbortControllerRef.current = null;
      }
      setIsRewriting(false);
      setProcessingMessage('');
    }
  };

  const handleCancelRewrite = () => {
    if (!isRewriting) return;
    rewriteAbortControllerRef.current?.abort();
    setProcessingMessage(text('正在取消 AI 改写…', 'Cancelling AI rewrite…'));
    appendAgentTrace('Agent 工作流', '正在取消当前改写任务…', 'warning');
  };

  const handleSelectionChange = (start: number, end: number) => {
    if (end <= start) {
      setSelectionRange(null);
      return;
    }
    setSelectionRange({ start, end });
  };

  const selectedText = selectionRange
    ? localScript.slice(selectionRange.start, selectionRange.end)
    : '';

  const handleRewriteSelection = async () => {
    const finalModel = getConfiguredModelForRequest();
    const currentSelection = selectionRange;
    const trimmedInstruction = rewriteInstruction.trim();

    if (!localScript.trim()) {
      setError('请先输入剧本内容。');
      return;
    }
    if (!currentSelection || currentSelection.end <= currentSelection.start) {
      setError('请先在编辑区选择需要改写的段落。');
      return;
    }
    if (!trimmedInstruction) {
      setError('请输入改写要求。');
      return;
    }
    if (!finalModel) {
      setError('请选择或输入模型名称。');
      return;
    }

    const baseScript = localScript;
    const selectedSegment = baseScript.slice(currentSelection.start, currentSelection.end);

    if (!selectedSegment.trim()) {
      setError('选中内容为空，请重新选择段落。');
      return;
    }

    const prefix = baseScript.slice(0, currentSelection.start);
    const suffix = baseScript.slice(currentSelection.end);

    setIsRewriting(true);
    setProcessingMessage(text('AI选段改写中…', 'Rewriting selected passage…'));
    setProcessingLogs([]);
    setError(null);
    startAgentTrace('AI 选段改写', `${finalModel} · 已选 ${selectedSegment.length} 字`);
    appendAgentTrace(
      '输入分析',
      '已锁定改写范围与前后文',
      'success',
      `仅替换选中片段，不改动其余内容\n体裁：${storyFormLabel(storyForm, customStoryForm)}\n改写要求：${trimmedInstruction}`,
    );
    appendAgentTrace(
      '改写模型',
      '正在流式生成选段改写',
      'running',
      '等待模型返回首批文本…',
      'segment-rewrite-stream',
    );

    let streamed = '';
    let lastTraceLength = 0;
    let lastTraceAt = 0;

    try {
      const rewrittenSegment = await rewriteScriptSegmentStream(
        baseScript,
        selectedSegment,
        trimmedInstruction,
        localLanguage,
        finalModel,
        (delta) => {
          streamed += delta;
          const nextScript = prefix + streamed + suffix;
          setLocalScript(nextScript);
          updateProject({ rawScript: nextScript });
          const now = Date.now();
          if (streamed.length - lastTraceLength >= 80 || now - lastTraceAt >= 700) {
            lastTraceLength = streamed.length;
            lastTraceAt = now;
            appendAgentTrace(
              '改写模型',
              '正在流式生成选段改写',
              'running',
              `已接收 ${streamed.length} 字 · 编辑器正在同步替换选区`,
              'segment-rewrite-stream',
            );
          }
        },
        {
          storyForm,
          storyFormLabel: storyForm === 'other' ? customStoryForm.trim() || undefined : undefined,
        },
      );

      const finalSegment = rewrittenSegment || streamed;
      const nextScript = prefix + finalSegment + suffix;
      if (nextScript !== baseScript) {
        setLastRewriteSnapshot(baseScript);
      }
      setLocalScript(nextScript);
      updateProject({ rawScript: nextScript });
      setSelectionRange({
        start: currentSelection.start,
        end: currentSelection.start + finalSegment.length,
      });
      appendAgentTrace(
        '改写模型',
        '选段改写接收完毕',
        'success',
        `原片段 ${selectedSegment.length} 字 → 改写 ${finalSegment.length} 字`,
        'segment-rewrite-stream',
      );
      const validation = summarizeRewriteValidation(selectedSegment, finalSegment, SCRIPT_HARD_LIMIT);
      appendAgentTrace('结果校验', validation.message, validation.status, validation.detail);
      appendAgentTrace('项目写回', '仅选中范围已替换并自动保存，可使用“撤回”恢复。', 'success');
      finishAgentTrace(validation.status === 'warning' ? 'warning' : 'completed');
    } catch (err: any) {
      console.error(err);
      setError(`AI选段改写失败: ${err.message || '连接失败'}`);
      appendAgentTrace(
        '改写模型',
        '流式生成失败，正在切换为普通请求重试',
        'warning',
        String(err?.message || '连接失败'),
        'segment-rewrite-stream',
      );
      appendAgentTrace('恢复策略', '正在重新生成选中片段', 'running', undefined, 'segment-rewrite-fallback');
      try {
        const rewrittenSegment = await rewriteScriptSegment(
          baseScript,
          selectedSegment,
          trimmedInstruction,
          localLanguage,
          finalModel,
          {
            storyForm,
            storyFormLabel: storyForm === 'other' ? customStoryForm.trim() || undefined : undefined,
          },
        );
        const nextScript = prefix + rewrittenSegment + suffix;
        if (nextScript !== baseScript) {
          setLastRewriteSnapshot(baseScript);
        }
        setLocalScript(nextScript);
        updateProject({ rawScript: nextScript });
        setError(null);
        setSelectionRange({
          start: currentSelection.start,
          end: currentSelection.start + rewrittenSegment.length,
        });
        appendAgentTrace(
          '恢复策略',
          '普通请求重试成功',
          'success',
          `原片段 ${selectedSegment.length} 字 → 改写 ${rewrittenSegment.length} 字`,
          'segment-rewrite-fallback',
        );
        const validation = summarizeRewriteValidation(selectedSegment, rewrittenSegment, SCRIPT_HARD_LIMIT);
        appendAgentTrace('结果校验', validation.message, validation.status, validation.detail);
        appendAgentTrace('项目写回', '仅选中范围已替换并自动保存，可使用“撤回”恢复。', 'success');
        finishAgentTrace('warning');
      } catch (fallbackErr: any) {
        console.error(fallbackErr);
        appendAgentTrace(
          '恢复策略',
          '普通请求重试失败，原稿未被覆盖',
          'error',
          String(fallbackErr?.message || err?.message || '连接失败'),
          'segment-rewrite-fallback',
        );
        finishAgentTrace('error');
      }
    } finally {
      setIsRewriting(false);
      setProcessingMessage('');
    }
  };

  const handleUndoRewrite = () => {
    if (!lastRewriteSnapshot) return;

    setLocalScript(lastRewriteSnapshot);
    updateProject({ rawScript: lastRewriteSnapshot });
    setSelectionRange(null);
    setLastRewriteSnapshot(null);
    showAlert('已撤回上次改写', { type: 'success' });
  };

  const draftAnalyzeConfigKey = buildAnalyzeConfigKey({
    script: localScript,
    language: localLanguage,
    targetDuration: getDraftValue(localDuration, customDurationInput, project.targetDuration || DEFAULTS.duration),
    model: resolveShotGenerationModel(),
    visualStyle: getDraftValue(
      previewVisualStyle || localVisualStyle,
      customStyleInput,
      project.visualStyle || DEFAULTS.visualStyle
    ),
    enableQualityCheck
  });
  const analyzeCheckpoint = project.scriptGenerationCheckpoint;
  const hasResumeCheckpoint =
    !!analyzeCheckpoint &&
    analyzeCheckpoint.configKey === draftAnalyzeConfigKey &&
    !!analyzeCheckpoint.scriptData;
  const analyzeButtonLabel =
    hasResumeCheckpoint && analyzeCheckpoint?.step !== 'structure'
      ? text('继续生成分镜脚本', 'Continue Storyboard')
      : text('生成分镜脚本', 'Generate Storyboard');

  const showProcessingToast = isProcessing || isContinuing || isRewriting;
  const canCancelRewrite = isRewriting && agentTraceSession?.title === '多阶段剧本改写 Agent';
  const toastMessage = processingMessage || (isProcessing
    ? text('正在生成剧本...', 'Generating script…')
    : isContinuing
      ? text('AI续写中...', 'AI continuation…')
      : isRewriting
        ? text('AI改写中...', 'AI rewrite…')
        : '');

  // Character editing handlers
  const handleEditCharacter = (charId: string, prompt: string) => {
    setEditingCharacterId(charId);
    setEditingCharacterPrompt(prompt);
  };

  const handleSaveCharacter = (charId: string, prompt: string) => {
    if (!project.scriptData) return;
    
    const updatedCharacters = project.scriptData.characters.map(c => 
      c.id === charId ? { ...c, visualPrompt: prompt } : c
    );
    
    updateProject({
      scriptData: {
        ...project.scriptData,
        characters: updatedCharacters
      }
    });
    
    setEditingCharacterId(null);
    setEditingCharacterPrompt('');
  };

  const handleCancelCharacterEdit = () => {
    setEditingCharacterId(null);
    setEditingCharacterPrompt('');
  };

  // Shot prompt editing handlers
  const handleEditShotPrompt = (shotId: string, prompt: string) => {
    setEditingShotId(shotId);
    setEditingShotPrompt(prompt);
  };

  const handleSaveShotPrompt = () => {
    if (!editingShotId) return;
    
    const updatedShots = project.shots.map(shot => {
      if (shot.id === editingShotId && shot.keyframes.length > 0) {
        return {
          ...shot,
          keyframes: shot.keyframes.map((kf, idx) => 
            idx === 0 ? { ...kf, visualPrompt: editingShotPrompt } : kf
          )
        };
      }
      return shot;
    });
    
    updateProject({ shots: updatedShots });
    setEditingShotId(null);
    setEditingShotPrompt('');
  };

  const handleCancelShotPrompt = () => {
    setEditingShotId(null);
    setEditingShotPrompt('');
  };

  // Shot characters editing handlers
  const handleEditShotCharacters = (shotId: string) => {
    setEditingShotCharactersId(shotId);
  };

  const handleAddCharacterToShot = (shotId: string, characterId: string) => {
    const updatedShots = project.shots.map(shot => {
      if (shot.id === shotId && !shot.characters.includes(characterId)) {
        return { ...shot, characters: [...shot.characters, characterId] };
      }
      return shot;
    });
    updateProject({ shots: updatedShots });
  };

  const handleRemoveCharacterFromShot = (shotId: string, characterId: string) => {
    const updatedShots = project.shots.map(shot => {
      if (shot.id === shotId) {
        return { ...shot, characters: shot.characters.filter(cid => cid !== characterId) };
      }
      return shot;
    });
    updateProject({ shots: updatedShots });
  };

  const handleCloseShotCharactersEdit = () => {
    setEditingShotCharactersId(null);
  };

  // Shot action editing handlers
  const handleEditShotAction = (shotId: string, action: string, dialogue: string) => {
    setEditingShotActionId(shotId);
    setEditingShotActionText(action);
    setEditingShotDialogueText(dialogue);
  };

  const handleSaveShotAction = () => {
    if (!editingShotActionId) return;
    
    const updatedShots = project.shots.map(shot => {
      if (shot.id === editingShotActionId) {
        return {
          ...shot,
          actionSummary: editingShotActionText,
          dialogue: editingShotDialogueText.trim() || undefined
        };
      }
      return shot;
    });
    
    updateProject({ shots: updatedShots });
    setEditingShotActionId(null);
    setEditingShotActionText('');
    setEditingShotDialogueText('');
  };

  const handleCancelShotAction = () => {
    setEditingShotActionId(null);
    setEditingShotActionText('');
    setEditingShotDialogueText('');
  };

  const getNextShotId = (shots: Shot[]) => {
    return getNextMainShotId(shots.map((shot) => shot.id));
  };

  const handleAddSubShot = (anchorShotId: string) => {
    const anchorShot = project.shots.find(s => s.id === anchorShotId);
    if (!anchorShot) return;

    const newId = getNextSubShotId(anchorShotId, project.shots.map((shot) => shot.id));
    if (!newId) return;

    const groupPrefix = getShotGroupPrefix(anchorShotId);
    const baseShot = project.shots.find((shot) => shot.id === groupPrefix) || anchorShot;
    const newShot: Shot = {
      id: newId,
      sceneId: baseShot.sceneId,
      actionSummary: '在此输入动作描述',
      cameraMovement: baseShot.cameraMovement || '平移',
      shotSize: baseShot.shotSize || '中景',
      characters: [...(baseShot.characters || [])],
      characterVariations: baseShot.characterVariations ? { ...baseShot.characterVariations } : undefined,
      props: baseShot.props ? [...baseShot.props] : undefined,
      videoModel: baseShot.videoModel,
      keyframes: [
        {
          id: `kf-${newId}-start`,
          type: 'start',
          visualPrompt: '',
          status: 'pending'
        }
      ]
    };

    const lastIndexInGroup = project.shots.reduce((idx, shot, i) => {
      const isGroup = shotBelongsToGroup(shot.id, groupPrefix);
      return isGroup ? i : idx;
    }, -1);

    const insertAt = lastIndexInGroup >= 0 ? lastIndexInGroup + 1 : project.shots.length;
    const nextShots = [
      ...project.shots.slice(0, insertAt),
      newShot,
      ...project.shots.slice(insertAt)
    ];

    updateProject({ shots: nextShots });
    setEditingShotActionId(newId);
    setEditingShotActionText(newShot.actionSummary);
    setEditingShotDialogueText('');
  };

  const handleAddShot = (sceneId: string) => {
    if (!project.scriptData) return;

    const sceneShots = filterBySceneIdCompat(project.shots, sceneId);
    if (sceneShots.length > 0) {
      handleAddSubShot(sceneShots[sceneShots.length - 1].id);
      return;
    }

    const newId = getNextShotId(project.shots);
    const newShot: Shot = {
      id: newId,
      sceneId,
      actionSummary: '在此输入动作描述',
      cameraMovement: '平移',
      shotSize: '中景',
      characters: [],
      keyframes: [
        {
          id: `kf-${newId}-start`,
          type: 'start',
          visualPrompt: '',
          status: 'pending'
        }
      ]
    };

    const sceneIndex = project.scriptData.scenes.findIndex(s => s.id === sceneId);
    const lastIndexInScene = project.shots.reduce((idx, shot, i) => (
      sceneIdsMatch(shot.sceneId, sceneId) ? i : idx
    ), -1);

    let insertAt = project.shots.length;
    if (lastIndexInScene >= 0) {
      insertAt = lastIndexInScene + 1;
    } else if (sceneIndex >= 0) {
      for (let i = sceneIndex + 1; i < project.scriptData.scenes.length; i += 1) {
        const nextSceneId = project.scriptData.scenes[i].id;
        const nextIndex = project.shots.findIndex(s => sceneIdsMatch(s.sceneId, nextSceneId));
        if (nextIndex >= 0) {
          insertAt = nextIndex;
          break;
        }
      }
    }

    const nextShots = [
      ...project.shots.slice(0, insertAt),
      newShot,
      ...project.shots.slice(insertAt)
    ];

    updateProject({ shots: nextShots });
    setEditingShotActionId(newId);
    setEditingShotActionText(newShot.actionSummary);
    setEditingShotDialogueText('');
  };

  const getShotDisplayName = (shot: Shot, fallbackIndex: number) => {
    return getShotDisplayLabel(shot.id, fallbackIndex);
  };

  const handleDeleteShot = (shotId: string) => {
    const shotIndex = project.shots.findIndex(s => s.id === shotId);
    const shot = shotIndex >= 0 ? project.shots[shotIndex] : null;
    if (!shot) return;

    const displayName = getShotDisplayName(shot, shotIndex);
    showAlert(`确定要删除 ${displayName} 吗？此操作不可撤销。`, {
      type: 'warning',
      showCancel: true,
      onConfirm: () => {
        updateProject({ shots: project.shots.filter(s => s.id !== shotId) });
        if (editingShotId === shotId) {
          setEditingShotId(null);
          setEditingShotPrompt('');
        }
        if (editingShotCharactersId === shotId) {
          setEditingShotCharactersId(null);
        }
        if (editingShotActionId === shotId) {
          setEditingShotActionId(null);
          setEditingShotActionText('');
          setEditingShotDialogueText('');
        }
        showAlert(`${displayName} 已删除`, { type: 'success' });
      }
    });
  };

  return (
    <div className="h-full bg-[var(--bg-base)]">
      {showProcessingToast && (
        <div className="fixed right-4 top-4 z-[9999] w-full max-w-md rounded-xl border border-[var(--border-default)] bg-black/80 px-4 py-3 shadow-2xl backdrop-blur">
          <div className="flex items-center gap-3">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-500 border-t-white" />
            <div className="text-sm text-white">{toastMessage}</div>
          </div>
          {processingLogs.length > 0 && (
            <div className="mt-2 truncate text-xs text-zinc-300">
              {processingLogs[processingLogs.length - 1]}
            </div>
          )}
          {(isProcessing || canCancelRewrite) && (
            <div className="mt-3 flex justify-end">
              <button
                type="button"
                onClick={isProcessing ? handleCancelAnalyze : handleCancelRewrite}
                className="rounded border border-zinc-400/60 px-2 py-1 text-[11px] text-white/90 transition-colors hover:border-white hover:text-white"
              >
                {isProcessing ? text('取消生成', 'Cancel generation') : text('取消改写', 'Cancel rewrite')}
              </button>
            </div>
          )}
        </div>
      )}
      {isAgentTraceOpen && (
        <AgentActivityPanel
          key={agentTraceSession?.id || 'agent-trace-empty'}
          session={agentTraceSession}
          onClose={() => setIsAgentTraceOpen(false)}
          onClear={() => {
            setAgentTraceSession(null);
            setIsAgentTraceOpen(false);
            updateProject({ agentTraceSession: null });
          }}
        />
      )}
      {agentTraceSession && !isAgentTraceOpen && (
        <button
          type="button"
          onClick={() => setIsAgentTraceOpen(true)}
          className="fixed bottom-6 right-4 z-[9998] flex items-center gap-2 rounded-full border border-violet-400/35 bg-[var(--bg-base)]/95 px-3.5 py-2 text-xs font-semibold text-violet-200 shadow-xl backdrop-blur transition-colors hover:border-violet-300 hover:text-white"
          title={text('查看本次剧本或分镜执行日志', 'View script or storyboard activity log')}
        >
          <BrainCircuit className="h-4 w-4" />
          {text('查看工作流日志', 'View activity log')}
        </button>
      )}
      {activeTab === 'story' ? (
        <div className="flex h-full bg-[var(--bg-base)] text-[var(--text-secondary)]">
          <ConfigPanel
            title={localTitle}
            duration={localDuration}
            language={localLanguage}
            model={resolveShotGenerationModel()}
            visualStyle={localVisualStyle}
            customDurationInput={customDurationInput}
            customModelInput={customModelInput}
            isProcessing={isProcessing}
            error={error}
            onShowModelConfig={onShowModelConfig}
            onTitleChange={setLocalTitle}
            onDurationChange={setLocalDuration}
            onLanguageChange={setLocalLanguage}
            onModelChange={handleModelChange}
            onVisualStyleChange={handleVisualStyleChange}
            onVisualStylePreview={setPreviewVisualStyle}
            onCustomDurationChange={setCustomDurationInput}
            onCustomModelChange={setCustomModelInput}
            visualStyleProfiles={styleProfilesForUi}
            generatingStylePreviewKeys={generatingStylePreviewKeys}
            onSaveVisualStyleProfile={handleSaveVisualStyleProfile}
            onGenerateStylePreview={handleGenerateStylePreview}
            onAddVisualStyle={handleAddVisualStyle}
            styleCreateRequest={styleCreateRequest}
            onRegenerateStylePreview={handleRegenerateStylePreviewForStyle}
            onApplyVisualStylePreview={handleApplyVisualStylePreview}
            onDeleteVisualStyle={handleDeleteVisualStyle}
            onInferVisualStyleProfile={handleInferVisualStyleProfile}
            enableQualityCheck={enableQualityCheck}
            onToggleQualityCheck={setEnableQualityCheck}
            onAnalyze={() => handleAnalyze('full')}
            onGenerateFramework={() => handleAnalyze('framework')}
            onGenerateVisuals={handleGenerateMissingVisuals}
            canGenerateVisuals={!!project.scriptData}
            analyzeButtonLabel={analyzeButtonLabel}
            canCancelAnalyze={!!analyzeAbortControllerRef.current}
            onCancelAnalyze={handleCancelAnalyze}
          />
          <ScriptEditor
            script={localScript}
            scriptSoftLimit={SCRIPT_SOFT_LIMIT}
            scriptHardLimit={SCRIPT_HARD_LIMIT}
            onChange={setLocalScript}
            onContinue={handleContinueScript}
            onRewrite={handleRewriteScript}
            onSelectionChange={handleSelectionChange}
            selectionRange={selectionRange}
            selectedText={selectedText}
            rewriteInstruction={rewriteInstruction}
            onRewriteInstructionChange={setRewriteInstruction}
            storyForm={storyForm}
            onStoryFormChange={setStoryForm}
            customStoryForm={customStoryForm}
            onCustomStoryFormChange={setCustomStoryForm}
            onRewriteSelection={handleRewriteSelection}
            onUndoRewrite={handleUndoRewrite}
            canUndoRewrite={!!lastRewriteSnapshot}
            isContinuing={isContinuing}
            isRewriting={isRewriting}
            lastModified={project.lastModified}
          />
        </div>
      ) : (
        <SceneBreakdown
          project={project}
          editingCharacterId={editingCharacterId}
          editingCharacterPrompt={editingCharacterPrompt}
          editingShotId={editingShotId}
          editingShotPrompt={editingShotPrompt}
          editingShotCharactersId={editingShotCharactersId}
          editingShotActionId={editingShotActionId}
          editingShotActionText={editingShotActionText}
          editingShotDialogueText={editingShotDialogueText}
          onEditCharacter={handleEditCharacter}
          onSaveCharacter={handleSaveCharacter}
          onCancelCharacterEdit={handleCancelCharacterEdit}
          onEditShotPrompt={handleEditShotPrompt}
          onSaveShotPrompt={handleSaveShotPrompt}
          onCancelShotPrompt={handleCancelShotPrompt}
          onEditShotCharacters={handleEditShotCharacters}
          onAddCharacterToShot={handleAddCharacterToShot}
          onRemoveCharacterFromShot={handleRemoveCharacterFromShot}
          onCloseShotCharactersEdit={handleCloseShotCharactersEdit}
          onEditShotAction={handleEditShotAction}
          onSaveShotAction={handleSaveShotAction}
          onCancelShotAction={handleCancelShotAction}
          onAddShot={handleAddShot}
          onAddSubShot={handleAddSubShot}
          onDeleteShot={handleDeleteShot}
          onBackToStory={() => setActiveTab('story')}
        />
      )}

      {pendingParseResult && (
        <AssetMatchDialog
          matches={pendingParseResult.matches}
          onConfirm={handleAssetMatchConfirm}
          onCancel={handleAssetMatchCancel}
        />
      )}
    </div>
  );
};

export default StageScript;
