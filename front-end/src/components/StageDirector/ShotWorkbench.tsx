import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  X,
  Film,
  Edit2,
  MessageSquare,
  Sparkles,
  Loader2,
  Scissors,
  Grid3x3,
  CircleHelp,
  CheckCircle2,
  Circle,
  ChevronDown,
  ChevronUp,
  SlidersHorizontal,
  Images,
  ShieldAlert,
  ListTree,
} from 'lucide-react';
import {
  Shot,
  ProjectState,
  AspectRatio,
  VideoDuration,
  DubbingMode,
  Character,
  NineGridData,
  NineGridPanel,
  StoryboardGridPanelCount,
} from '../../types';
import SceneContext from './SceneContext';
import KeyframeEditor from './KeyframeEditor';
import VideoGenerator from './VideoGenerator';
import DubbingPanel from './DubbingPanel';
import { getRefImagesForShot, isQwenEditKeyframeWorkflow, resolveEffectiveVideoModelId, resolveVideoModelRouting } from './utils';
import { getActiveImageModel, getModelById } from '../../services/modelRegistry';
import { findSceneByIdCompat, getShotDisplayKey } from '../../services/storyboardIdUtils';
import {
  STORYBOARD_GRID_LAYOUTS,
  resolveStoryboardGridLayout,
} from './constants';
import {
  buildReferenceImagePack,
  describeReferencePack,
  ReferenceImagePack,
} from '../../services/referenceImagePack';
import { useInterfaceLanguage } from '../../contexts/InterfaceLanguageContext';
import { inspectShotProductionConflicts } from '../../services/productionConflictService';

interface ShotWorkbenchProps {
  shot: Shot;
  shotIndex: number;
  totalShots: number;
  scriptData?: ProjectState['scriptData'];
  projectAspectRatio?: AspectRatio;
  currentVideoModelId: string;
  nextShotHasStartFrame?: boolean;
  isAIOptimizing?: boolean;
  isAIReassessing?: boolean;
  isSplittingShot?: boolean;
  onClose: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onAIReassessQuality: () => void;
  onEditActionSummary: () => void;
  onEditDialogue: () => void;
  onGenerateAIAction: () => void;
  onSplitShot: () => void;
  onAddCharacter: (charId: string) => void;
  onRemoveCharacter: (charId: string) => void;
  onVariationChange: (charId: string, varId: string) => void;
  onSceneChange: (sceneId: string) => void;
  onAddProp?: (propId: string) => void;
  onRemoveProp?: (propId: string) => void;
  onGenerateKeyframe: (type: 'start' | 'end') => void;
  onUploadKeyframe: (type: 'start' | 'end') => void;
  onEditKeyframePrompt: (type: 'start' | 'end', prompt: string) => void;
  onOptimizeKeyframeWithAI: (type: 'start' | 'end') => void;
  onOptimizeBothKeyframes: () => void;
  onCopyPreviousEndFrame: () => void;
  onCopyNextStartFrame: () => void;
  useAIEnhancement: boolean;
  onToggleAIEnhancement: () => void;
  onGenerateVideo: (aspectRatio: AspectRatio, duration: VideoDuration, modelId: string, quality?: 'standard' | 'turbo') => void;
  onCancelVideo?: () => void;
  onCancelKeyframe?: (type: 'start' | 'end') => void;
  voiceCharacters?: Pick<Character, 'id' | 'name'>[];
  onGenerateDubbing: (mode: DubbingMode, text: string, modelId?: string, speakerId?: string) => void;
  onClearDubbing: () => void;
  onEditVideoPrompt: () => void;
  onVideoModelChange: (modelId: string) => void;
  onImageClick: (url: string, title: string) => void;
  videoInputMode?: 'keyframes' | 'storyboard-grid';
  onVideoInputModeChange: (mode: 'keyframes' | 'storyboard-grid') => void;
  onGenerateNineGrid: (panelCount?: StoryboardGridPanelCount) => void;
  nineGrid?: NineGridData;
  onSelectNineGridPanel: (panel: NineGridPanel) => void;
  onShowNineGrid: () => void;
}

type SectionKey = 'quality' | 'context' | 'keyframe' | 'narrative' | 'video' | 'advanced';

const ShotWorkbench: React.FC<ShotWorkbenchProps> = ({
  shot,
  shotIndex,
  totalShots,
  scriptData,
  projectAspectRatio = '16:9',
  currentVideoModelId,
  nextShotHasStartFrame = false,
  isAIOptimizing = false,
  isAIReassessing = false,
  isSplittingShot = false,
  onClose,
  onPrevious,
  onNext,
  onAIReassessQuality,
  onEditActionSummary,
  onEditDialogue,
  onGenerateAIAction,
  onSplitShot,
  onAddCharacter,
  onRemoveCharacter,
  onVariationChange,
  onSceneChange,
  onAddProp,
  onRemoveProp,
  onGenerateKeyframe,
  onUploadKeyframe,
  onEditKeyframePrompt,
  onOptimizeKeyframeWithAI,
  onOptimizeBothKeyframes,
  onCopyPreviousEndFrame,
  onCopyNextStartFrame,
  useAIEnhancement,
  onToggleAIEnhancement,
  onGenerateVideo,
  onCancelVideo,
  onCancelKeyframe,
  onGenerateDubbing,
  voiceCharacters = [],
  onClearDubbing,
  onEditVideoPrompt,
  onVideoModelChange,
  onImageClick,
  videoInputMode,
  onVideoInputModeChange,
  onGenerateNineGrid,
  nineGrid,
  onSelectNineGridPanel,
  onShowNineGrid,
}) => {
  const { language, text } = useInterfaceLanguage();
  const scene = findSceneByIdCompat(scriptData?.scenes, shot.sceneId);
  const activeCharacters = scriptData?.characters.filter((c) => shot.characters.includes(c.id)) || [];
  const availableCharacters = scriptData?.characters.filter((c) => !shot.characters.includes(c.id)) || [];
  const activeProps = (scriptData?.props || []).filter((p) => (shot.props || []).includes(p.id));
  const availablePropsForShot = (scriptData?.props || []).filter((p) => !(shot.props || []).includes(p.id));
  const previewEntries = useMemo(
    () => getRefImagesForShot(shot, scriptData || null).entries,
    [shot, scriptData],
  );
  const previewEntrySignature = previewEntries
    .map((entry) => {
      const imageIdentity = entry.image.startsWith('data:')
        ? `${entry.image.slice(0, 32)}:${entry.image.length}:${entry.image.slice(-32)}`
        : entry.image;
      return `${entry.type}:${entry.label}:${imageIdentity}`;
    })
    .join('|');
  const activeImageModel = getActiveImageModel() as { params?: { keyframeWorkflowName?: string; workflowName?: string } } | undefined;
  const previewWorkflowName = activeImageModel?.params?.keyframeWorkflowName || activeImageModel?.params?.workflowName;
  const previewReferenceLimit = isQwenEditKeyframeWorkflow(previewWorkflowName) ? 3 : 5;
  const [referencePreviewPack, setReferencePreviewPack] = useState<ReferenceImagePack | null>(null);
  const [isPreparingReferencePreview, setIsPreparingReferencePreview] = useState(false);
  const [showReferenceSlots, setShowReferenceSlots] = useState(false);
  const productionIssues = useMemo(
    () => inspectShotProductionConflicts(shot, scriptData, language),
    [shot, scriptData, language],
  );
  const blockingProductionIssues = productionIssues.filter((issue) => issue.severity === 'error');

  const startKf = shot.keyframes?.find((k) => k.type === 'start');
  const endKf = shot.keyframes?.find((k) => k.type === 'end');
  const quality = shot.qualityAssessment;
  const [localVideoModelId, setLocalVideoModelId] = useState(
    () => currentVideoModelId || resolveEffectiveVideoModelId(shot.videoModel)
  );
  const [expandedCheckKey, setExpandedCheckKey] = useState<string | null>(null);
  const [isAdvancedMode, setIsAdvancedMode] = useState(false);
  const [expandedSections, setExpandedSections] = useState<SectionKey[]>([
    'context',
    'narrative',
    'keyframe',
    'video',
  ]);
  const lastAutoExpandedShotRef = useRef<string | null>(null);

  const isSectionOpen = (sectionKey: SectionKey) => expandedSections.includes(sectionKey);
  const openSection = (sectionKey: SectionKey) => {
    setExpandedSections((prev) => (prev.includes(sectionKey) ? prev : [...prev, sectionKey]));
  };
  const toggleSection = (sectionKey: SectionKey) => {
    setExpandedSections((prev) =>
      prev.includes(sectionKey) ? prev.filter((item) => item !== sectionKey) : [...prev, sectionKey]
    );
  };

  useEffect(() => {
    setLocalVideoModelId(currentVideoModelId || resolveEffectiveVideoModelId(shot.videoModel));
  }, [currentVideoModelId, shot.id, shot.videoModel]);

  useEffect(() => {
    let cancelled = false;
    if (previewEntries.length === 0) {
      setReferencePreviewPack(null);
      setIsPreparingReferencePreview(false);
      return () => { cancelled = true; };
    }

    setIsPreparingReferencePreview(true);
    buildReferenceImagePack(previewEntries, {
      maxReferenceImages: previewReferenceLimit,
      reservedReferenceSlots: 1,
      alwaysCompositeTypes: ['character', 'prop'],
    })
      .then((pack) => {
        if (!cancelled) setReferencePreviewPack(pack);
      })
      .catch((error) => {
        console.warn('[ReferencePack] 合并参考图预览准备失败。', error);
        if (!cancelled) setReferencePreviewPack(null);
      })
      .finally(() => {
        if (!cancelled) setIsPreparingReferencePreview(false);
      });

    return () => { cancelled = true; };
  }, [previewEntrySignature, previewReferenceLimit]);

  const modelRouting = resolveVideoModelRouting(
    localVideoModelId || currentVideoModelId || resolveEffectiveVideoModelId(shot.videoModel)
  );
  const recommendedInputMode: 'keyframes' | 'storyboard-grid' =
    modelRouting.family === 'sora' || modelRouting.family === 'doubao-task'
      ? 'storyboard-grid'
      : 'keyframes';
  const effectiveVideoInputMode = videoInputMode || recommendedInputMode;
  const resolveStoredGridPanelCount = (): StoryboardGridPanelCount | null => {
    const fromLayout = nineGrid?.layout?.panelCount;
    if (fromLayout === 4 || fromLayout === 6 || fromLayout === 9) {
      return fromLayout;
    }

    const panelLength = nineGrid?.panels?.length;
    if (panelLength === 4 || panelLength === 6 || panelLength === 9) {
      return panelLength;
    }

    return null;
  };
  const resolveDefaultGridPanelCount = (): StoryboardGridPanelCount => {
    const intervalDuration = Number(shot.interval?.duration);
    if (Number.isFinite(intervalDuration) && intervalDuration === 8) {
      return 6;
    }

    const modelId =
      localVideoModelId || currentVideoModelId || resolveEffectiveVideoModelId(shot.videoModel);
    const model = getModelById(modelId) as any;
    const modelDefaultDuration = Number(model?.params?.defaultDuration);
    if (Number.isFinite(modelDefaultDuration) && modelDefaultDuration === 8) {
      return 6;
    }

    return 9;
  };
  const resolvePreferredGridPanelCount = (): StoryboardGridPanelCount =>
    resolveStoredGridPanelCount() ?? resolveDefaultGridPanelCount();
  const [selectedGridPanelCount, setSelectedGridPanelCount] = useState<StoryboardGridPanelCount>(() =>
    resolvePreferredGridPanelCount()
  );
  const selectedGridLayout = resolveStoryboardGridLayout(selectedGridPanelCount);
  const existingGridLayout = resolveStoryboardGridLayout(
    nineGrid?.layout?.panelCount,
    nineGrid?.panels?.length
  );
  const hasSameGridLayout =
    !!nineGrid?.panels?.length && existingGridLayout.panelCount === selectedGridLayout.panelCount;

  useEffect(() => {
    setSelectedGridPanelCount(resolvePreferredGridPanelCount());
  }, [shot.id, nineGrid?.layout?.panelCount, nineGrid?.panels?.length]);

  const showEndFrame = modelRouting.supportsEndFrame;
  const hasStartFrame = !!startKf?.imageUrl;
  const hasEndFrame = !!endKf?.imageUrl;
  const keyframeReady = effectiveVideoInputMode === 'storyboard-grid'
    ? hasStartFrame
    : hasStartFrame && (!showEndFrame || hasEndFrame);
  const hasActionSummary = (shot.actionSummary || '').trim().length > 0;
  const hasVideo = !!shot.interval?.videoUrl;
  const isVideoGenerating = shot.interval?.status === 'generating';

  useEffect(() => {
    if (lastAutoExpandedShotRef.current === shot.id) {
      return;
    }
    lastAutoExpandedShotRef.current = shot.id;

    if (!hasActionSummary) {
      openSection('narrative');
      return;
    }
    if (!keyframeReady) {
      openSection('keyframe');
      return;
    }
    if (!hasVideo) {
      openSection('video');
      return;
    }
    openSection('quality');
  }, [shot.id, hasActionSummary, keyframeReady, hasVideo]);

  useEffect(() => {
    setExpandedCheckKey(null);
  }, [shot.id]);

  useEffect(() => {
    if (effectiveVideoInputMode === 'storyboard-grid') {
      setIsAdvancedMode(true);
    }
  }, [effectiveVideoInputMode]);

  const qualityGradeLabel = quality?.grade === 'pass' ? '通过' : quality?.grade === 'warning' ? '需优化' : '高风险';
  const qualityBadgeClass =
    quality?.grade === 'pass'
      ? 'bg-[var(--success-bg)] text-[var(--success-text)] border-[var(--success-border)]'
      : quality?.grade === 'warning'
        ? 'bg-[var(--warning-bg)] text-[var(--warning-text)] border-[var(--warning-border)]'
        : 'bg-[var(--error-hover-bg)] text-[var(--error-text)] border-[var(--error-border)]';
  const qualitySourceLabel = quality ? (quality.version >= 2 ? 'AI评估 V2' : '规则评分 V1') : '';

  const checkLabelMap: Record<string, string> = {
    'prompt-readiness': '提示词完整度',
    'asset-coverage': '资产覆盖度',
    'keyframe-execution': '关键帧就绪度',
    'video-execution': '视频执行状态',
    'continuity-risk': '连贯性风险',
  };

  const adviceMap: Record<string, string> = {
    'prompt-readiness': '建议先补全首帧/尾帧/视频提示词，避免执行歧义。',
    'asset-coverage': '建议补角色/场景/道具参考图，提高风格一致性。',
    'keyframe-execution': '建议先完成关键帧出图，再进入视频生成。',
    'video-execution': '建议优先完成视频生成并确认可播放结果。',
    'continuity-risk': '建议补齐首尾锚点，确保跨镜头连贯。',
  };

  const getCheckLabel = (checkKey: string, fallback: string) => checkLabelMap[checkKey] || fallback;

  const qualitySummary = (() => {
    if (!quality) return '';
    const failedLabels = quality.checks.filter((check) => !check.passed).map((check) => getCheckLabel(check.key, check.label));
    if (failedLabels.length === 0) return '可进入生产，核心检查项已通过。';
    if (quality.grade === 'fail') return `风险较高：${failedLabels.join('、')}`;
    if (quality.grade === 'warning') return `需要优化：${failedLabels.join('、')}`;
    return `轻微问题：${failedLabels.join('、')}`;
  })();

  const weakestCheck = quality?.checks?.length
    ? [...quality.checks].sort((a, b) => a.score - b.score)[0]
    : undefined;
  const qualityActionHint = weakestCheck ? adviceMap[weakestCheck.key] || '' : '';

  const steps = useMemo(
    () => [
      { key: 'context' as const, label: '1 资产绑定', done: !!scene && activeCharacters.length > 0 },
      { key: 'narrative' as const, label: '2 动作台词', done: hasActionSummary },
      { key: 'keyframe' as const, label: effectiveVideoInputMode === 'storyboard-grid' ? '3 网格分镜' : '3 关键帧', done: keyframeReady },
      { key: 'video' as const, label: '4 视频生成', done: hasVideo },
    ],
    [scene, activeCharacters.length, keyframeReady, hasActionSummary, hasVideo, effectiveVideoInputMode]
  );
  const completedSteps = steps.filter((item) => item.done).length;
  const recommendationText =
    modelRouting.family === 'sora' || modelRouting.family === 'doubao-task'
      ? '当前模型推荐网格分镜'
      : modelRouting.family === 'veo-fast'
        ? '当前模型支持网格分镜与首尾帧'
        : '当前模型可按镜头需求选择输入方式';
  const isGridGenerating = nineGrid?.status === 'generating_panels' || nineGrid?.status === 'generating_image';
  const openOrGenerateGridStoryboard = () => {
    if (
      hasSameGridLayout &&
      (nineGrid?.status === 'completed' || nineGrid?.status === 'panels_ready' || nineGrid?.status === 'generating_image')
    ) {
      onShowNineGrid();
      return;
    }
    onGenerateNineGrid(selectedGridPanelCount);
  };

  const primaryAction = useMemo(() => {
    if (!hasActionSummary) {
      return {
        label: '下一步：完善动作与台词',
        hint: '关键帧与网格分镜依赖动作描述，建议先补齐叙事内容。',
        disabled: false,
        onClick: () => openSection('narrative'),
      };
    }

    if (effectiveVideoInputMode === 'storyboard-grid' && !hasStartFrame) {
      return {
        label: '下一步：生成网格分镜',
        hint: isAdvancedMode
          ? `先生成${selectedGridLayout.label}并选定首帧，再进入视频生成。`
          : '网格分镜属于高级功能，请先切换到“高级”。',
        disabled: isGridGenerating,
        onClick: () => {
          openSection('keyframe');
          if (!isAdvancedMode) {
            setIsAdvancedMode(true);
            return;
          }
          openOrGenerateGridStoryboard();
        },
      };
    }

    if (!hasStartFrame) {
      return {
        label: '下一步：生成首帧',
        hint: '先生成首帧，建立镜头视觉锚点。',
        disabled: startKf?.status === 'generating',
        onClick: () => {
          openSection('keyframe');
          onGenerateKeyframe('start');
        },
      };
    }

    if (effectiveVideoInputMode === 'keyframes' && showEndFrame && !hasEndFrame) {
      return {
        label: '下一步：生成尾帧',
        hint: '补齐首尾关键帧后，再做视频会更稳定。',
        disabled: endKf?.status === 'generating',
        onClick: () => {
          openSection('keyframe');
          onGenerateKeyframe('end');
        },
      };
    }

    if (!hasVideo) {
      return {
        label: isVideoGenerating ? '视频生成中...' : '下一步：进入视频生成',
        hint: isVideoGenerating ? '当前镜头正在出片，请稍候。' : '在步骤 4 选择模型和参数后生成视频。',
        disabled: isVideoGenerating,
        onClick: () => openSection('video'),
      };
    }

    return {
      label: isAIReassessing ? 'AI评估中...' : '下一步：AI重评估',
      hint: '视频已完成，建议做一次最终可交付性评估。',
      disabled: isAIReassessing,
      onClick: () => {
        openSection('quality');
        onAIReassessQuality();
      },
    };
  }, [
    hasActionSummary,
    effectiveVideoInputMode,
    hasStartFrame,
    isAdvancedMode,
    selectedGridLayout.label,
    selectedGridPanelCount,
    isGridGenerating,
    openOrGenerateGridStoryboard,
    startKf?.status,
    showEndFrame,
    hasEndFrame,
    endKf?.status,
    hasVideo,
    isVideoGenerating,
    isAIReassessing,
    onGenerateKeyframe,
    onAIReassessQuality,
  ]);

  const getShotDisplayNumber = () => {
    return getShotDisplayKey(shot.id, shotIndex);
  };

  const renderSectionHeader = (
    sectionKey: SectionKey,
    title: string,
    subtitle: string,
    done?: boolean
  ) => {
    const isOpen = isSectionOpen(sectionKey);
    return (
      <button
        type="button"
        className="w-full px-3 py-2 flex items-center justify-between text-left"
        onClick={() => toggleSection(sectionKey)}
      >
        <div className="flex items-center gap-2 min-w-0">
          {done === undefined ? null : done ? (
            <CheckCircle2 className="w-4 h-4 text-[var(--success-text)] shrink-0" />
          ) : (
            <Circle className="w-4 h-4 text-[var(--text-muted)] shrink-0" />
          )}
          <div className="min-w-0">
            <p className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-widest">{title}</p>
            <p className="text-[10px] text-[var(--text-muted)] truncate">{subtitle}</p>
          </div>
        </div>
        {isOpen ? (
          <ChevronUp className="w-4 h-4 text-[var(--text-muted)]" />
        ) : (
          <ChevronDown className="w-4 h-4 text-[var(--text-muted)]" />
        )}
      </button>
    );
  };

  return (
    <div className="w-[40%] min-w-0 shrink-0 bg-[var(--bg-deep)] flex flex-col h-full shadow-2xl animate-in slide-in-from-right-10 duration-300 relative z-20">
      <div className="h-16 px-6 border-b border-[var(--border-primary)] flex items-center justify-between bg-[var(--bg-surface)] shrink-0">
        <div className="flex items-center gap-3 min-w-0 flex-1 mr-2">
          <span className="min-w-[3rem] h-8 px-2 bg-[var(--accent-bg)] text-[var(--accent-text)] rounded-lg flex items-center justify-center font-bold font-mono text-[11px] whitespace-nowrap border border-[var(--accent-border)] shrink-0">
            {getShotDisplayNumber()}
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="text-[var(--text-primary)] font-bold text-sm">镜头详情</h3>
            <p className="text-[10px] text-[var(--text-tertiary)] uppercase tracking-widest truncate" title={shot.cameraMovement}>
              {shot.cameraMovement}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1">
          <div className="flex items-center rounded-md border border-[var(--border-primary)] bg-[var(--bg-base)]/40 mr-2">
            <button
              type="button"
              className={`px-2 py-1 text-[10px] font-medium ${!isAdvancedMode ? 'text-[var(--text-primary)] bg-[var(--bg-hover)]' : 'text-[var(--text-tertiary)]'}`}
              onClick={() => setIsAdvancedMode(false)}
              title="仅显示核心流程，降低复杂度"
            >
              新手
            </button>
            <button
              type="button"
              className={`px-2 py-1 text-[10px] font-medium ${isAdvancedMode ? 'text-[var(--text-primary)] bg-[var(--bg-hover)]' : 'text-[var(--text-tertiary)]'}`}
              onClick={() => setIsAdvancedMode(true)}
              title="显示网格分镜和拆镜等高级工具"
            >
              高级
            </button>
          </div>
          <button
            onClick={onPrevious}
            disabled={shotIndex === 0}
            className="p-2 hover:bg-[var(--bg-hover)] rounded text-[var(--text-tertiary)] hover:text-[var(--text-primary)] disabled:opacity-20 transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            onClick={onNext}
            disabled={shotIndex === totalShots - 1}
            className="p-2 hover:bg-[var(--bg-hover)] rounded text-[var(--text-tertiary)] hover:text-[var(--text-primary)] disabled:opacity-20 transition-colors"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
          <div className="w-px h-4 bg-[var(--border-secondary)] mx-2" />
          <button
            onClick={onClose}
            className="p-2 hover:bg-[var(--error-hover-bg)] rounded text-[var(--text-tertiary)] hover:text-[var(--error-text)] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="@container flex-1 min-h-0 overflow-y-auto p-4">
        <div className="space-y-3">
        <section className="rounded-xl border border-[var(--border-primary)] bg-[var(--bg-surface)] p-3 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-bold text-[var(--text-secondary)] uppercase tracking-widest">制作流程</p>
            <span className="text-[10px] text-[var(--text-muted)] font-mono">
              {completedSteps}/{steps.length} 完成
            </span>
          </div>
          <div className="grid grid-cols-4 gap-2">
            {steps.map((step) => (
              <button
                key={step.key}
                type="button"
                onClick={() => {
                  openSection(step.key);
                  requestAnimationFrame(() => {
                    document.getElementById(`shot-section-${step.key}`)?.scrollIntoView({
                      behavior: 'smooth',
                      block: 'start',
                    });
                  });
                }}
                className={`px-2 py-2 rounded border text-[10px] text-left flex items-center gap-1.5 min-w-0 ${
                  isSectionOpen(step.key)
                    ? 'border-[var(--accent-border)] bg-[var(--accent-bg)] text-[var(--accent-text)]'
                    : 'border-[var(--border-primary)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)]'
                }`}
              >
                {step.done ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0" /> : <Circle className="w-3.5 h-3.5 shrink-0" />}
                <span className="truncate">{step.label}</span>
              </button>
            ))}
          </div>
          <div className="flex items-center justify-between gap-2 pt-1">
            <div className="min-w-0 flex items-center gap-2">
              {quality ? (
                <>
                  <span className={`px-2 py-0.5 rounded-md text-[10px] font-mono border shrink-0 ${qualityBadgeClass}`}>
                    评分 {quality.score} · {qualityGradeLabel}
                  </span>
                  <p className="text-[10px] text-[var(--text-muted)] truncate" title={qualitySummary}>{qualitySummary}</p>
                </>
              ) : (
                <p className="text-[10px] text-[var(--text-muted)]">尚未评估</p>
              )}
            </div>
            <button
              type="button"
              onClick={() => toggleSection('quality')}
              className="text-[10px] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] shrink-0"
            >
              {isSectionOpen('quality') ? '收起评估' : '查看评估'}
            </button>
          </div>
          {!isAdvancedMode && (
            <p className="text-[10px] text-[var(--text-muted)]">
              当前为新手模式。需要拆镜/网格分镜时，可切换到顶部“高级”。
            </p>
          )}
        </section>

        {isSectionOpen('quality') && (
        <section className="rounded-xl border border-[var(--border-primary)] bg-[var(--bg-surface)] overflow-hidden">
          {renderSectionHeader('quality', '质量评估', '查看当前镜头可交付性')}
          {quality && (
            <div className="px-3 pb-3 border-t border-[var(--border-primary)] space-y-2">
              <div className="pt-2 flex items-center justify-between gap-2">
                <span className={`px-2 py-1 rounded-md text-[10px] font-mono border ${qualityBadgeClass}`}>
                  评分 {quality.score} · {qualityGradeLabel}
                </span>
                <button
                  type="button"
                  onClick={onAIReassessQuality}
                  disabled={isAIReassessing}
                  className="px-2 py-1 rounded-md text-[10px] font-semibold border border-[var(--accent-border)] text-[var(--accent-text)] hover:bg-[var(--accent-bg)] disabled:opacity-60 disabled:cursor-not-allowed flex items-center gap-1"
                  title="使用大模型重新评估当前镜头质量"
                >
                  {isAIReassessing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                  {isAIReassessing ? '评估中...' : 'AI重评估'}
                </button>
              </div>
              {qualityActionHint && (
                <p className="text-[10px] text-[var(--accent-text)] bg-[var(--accent-bg)] border border-[var(--accent-border)] rounded px-2 py-1">
                  下一步建议：{qualityActionHint}
                </p>
              )}
              <div className="grid grid-cols-2 gap-1.5">
                {quality.checks.map((check) => (
                  <div key={check.key} className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className={`w-12 shrink-0 text-[10px] font-mono ${check.passed ? 'text-[var(--success-text)]' : 'text-[var(--warning-text)]'}`}>
                        {check.score}
                      </span>
                      <span className="flex-1 text-[11px] text-[var(--text-tertiary)] truncate" title={check.details || check.label}>
                        {getCheckLabel(check.key, check.label)}
                      </span>
                      <button
                        type="button"
                        onClick={() => setExpandedCheckKey((prev) => (prev === check.key ? null : check.key))}
                        className="p-1 rounded border border-[var(--border-primary)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:border-[var(--accent-border)]"
                        title="查看评分依据"
                      >
                        <CircleHelp className="w-3 h-3" />
                      </button>
                    </div>
                    {expandedCheckKey === check.key && (
                      <div className="rounded border border-[var(--border-primary)] bg-[var(--bg-base)]/60 px-2 py-1.5 text-[10px] leading-relaxed text-[var(--text-secondary)] whitespace-pre-line">
                        {check.details || '暂无评分依据。'}
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-[var(--text-muted)]">
                {qualitySourceLabel} · {new Date(quality.generatedAt).toLocaleString()}
              </p>
            </div>
          )}
          {!quality && (
            <div className="px-3 pb-3 border-t border-[var(--border-primary)]">
              <p className="pt-2 text-xs text-[var(--text-muted)]">当前镜头还没有质量评估结果。</p>
            </div>
          )}
        </section>
        )}

        <section id="shot-section-context" className="rounded-xl border border-[var(--border-primary)] bg-[var(--bg-surface)] overflow-hidden">
          {renderSectionHeader('context', '1 资产绑定', '先确认场景、角色与道具', steps[0]?.done)}
          {isSectionOpen('context') && (
            <div className="border-t border-[var(--border-primary)] p-3">
              {scriptData ? (
                <>
                  <SceneContext
                    shot={shot}
                    scene={scene}
                    scenes={scriptData.scenes}
                    characters={activeCharacters}
                    availableCharacters={availableCharacters}
                    props={activeProps}
                    availableProps={availablePropsForShot}
                    onAddCharacter={onAddCharacter}
                    onRemoveCharacter={onRemoveCharacter}
                    onVariationChange={onVariationChange}
                    onSceneChange={onSceneChange}
                    onAddProp={onAddProp}
                    onRemoveProp={onRemoveProp}
                  />
                  {productionIssues.length > 0 && (
                    <div className={`mt-3 rounded-lg border p-3 ${
                      blockingProductionIssues.length > 0
                        ? 'border-[var(--error-border)] bg-[var(--error-bg)]'
                        : 'border-[var(--warning-border)] bg-[var(--warning-bg)]'
                    }`}>
                      <div className="flex items-center gap-2">
                        <ShieldAlert className={`w-4 h-4 ${blockingProductionIssues.length > 0 ? 'text-[var(--error-text)]' : 'text-[var(--warning-text)]'}`} />
                        <p className="text-[11px] font-bold text-[var(--text-primary)]">
                          {blockingProductionIssues.length > 0
                            ? text(`发现 ${blockingProductionIssues.length} 个生成阻断项`, `${blockingProductionIssues.length} generation blocker(s)`)
                            : text('制作一致性提醒', 'Production consistency notes')}
                        </p>
                      </div>
                      <div className="mt-2 space-y-1.5">
                        {productionIssues.map((issue) => (
                          <div key={issue.code} className="text-[10px] leading-relaxed text-[var(--text-secondary)]">
                            <span className={`mr-1 font-bold uppercase ${issue.severity === 'error' ? 'text-[var(--error-text)]' : issue.severity === 'warning' ? 'text-[var(--warning-text)]' : 'text-[var(--text-muted)]'}`}>
                              {issue.severity}
                            </span>
                            {issue.message}
                            {issue.suggestion && <p className="ml-10 text-[var(--text-muted)]">{issue.suggestion}</p>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {(isPreparingReferencePreview || !!referencePreviewPack) && (
                  <div className="mt-3 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-base)]/45 p-3">
                    <div className="flex items-center gap-2">
                      <Images className="w-3.5 h-3.5 text-[var(--accent-text)]" />
                      <p className="text-[11px] font-bold text-[var(--text-secondary)] tracking-wide">
                        {text('智能整理参考图', 'Smart reference packing')}
                      </p>
                      {isPreparingReferencePreview && (
                        <Loader2 className="w-3 h-3 animate-spin text-[var(--text-muted)]" />
                      )}
                      {referencePreviewPack && (
                        <button
                          type="button"
                          onClick={() => setShowReferenceSlots((current) => !current)}
                          className="ml-auto flex items-center gap-1 rounded border border-[var(--border-primary)] px-2 py-1 text-[9px] font-semibold text-[var(--text-secondary)] hover:border-[var(--accent-border)]"
                        >
                          <ListTree className="w-3 h-3" />
                          {showReferenceSlots ? text('收起预案', 'Hide Plan') : text('检查槽位预案', 'Inspect Slot Plan')}
                        </button>
                      )}
                    </div>
                    {referencePreviewPack && (
                      <>
                        <p className="mt-1 text-[10px] leading-relaxed text-[var(--text-tertiary)]">
                          {describeReferencePack(referencePreviewPack, language)}
                        </p>
                        <p className="mt-1 text-[9px] leading-relaxed text-[var(--text-muted)]">
                          {text(
                            `严格预案按当前工作流 ${previewReferenceLimit} 张上限预留 1 个安全槽位；实际任务无需模板图或连续性图时会自动使用该槽位。`,
                            `The strict plan reserves 1 of ${previewReferenceLimit} slots for a template or continuity frame; the actual request can use it when no extra workflow image is needed.`,
                          )}
                        </p>
                        <div className="mt-2 grid grid-cols-2 gap-2">
                          {referencePreviewPack.compositeGroups.map((group) => (
                            <button
                              key={`${group.type}:${group.entry.label}`}
                              type="button"
                              onClick={() => onImageClick(
                                group.entry.image,
                                `${group.entry.label} · ${text('全景参考', 'Panorama reference')}`,
                              )}
                              className="min-w-0 overflow-hidden rounded-md border border-[var(--border-secondary)] bg-[var(--bg-elevated)] text-left hover:border-[var(--accent-border)] transition-colors"
                            >
                              <img
                                src={group.entry.image}
                                alt={`${group.entry.label} ${text('全景参考', 'panorama reference')}`}
                                className="h-20 w-full object-cover object-center"
                              />
                              <div className="px-2 py-1.5">
                                <p className="truncate text-[10px] font-semibold text-[var(--text-secondary)]">
                                  {group.type === 'character'
                                    ? text('角色全景参考', 'Character panorama')
                                    : group.type === 'prop'
                                      ? text('道具全景参考', 'Prop panorama')
                                      : text('角色多视图参考', 'Character view-sheet panorama')}
                                </p>
                                <p className="truncate text-[9px] text-[var(--text-muted)]">
                                  {group.entry.includedLabels?.join(' · ')}
                                </p>
                              </div>
                            </button>
                          ))}
                        </div>
                        {showReferenceSlots && (
                          <div className="mt-3 space-y-1.5 border-t border-[var(--border-primary)] pt-3">
                            {referencePreviewPack.slots.map((slot) => (
                              <button
                                key={`${slot.slot}:${slot.kind}`}
                                type="button"
                                disabled={!slot.image}
                                onClick={() => slot.image && onImageClick(slot.image, `${text('参考图槽位', 'Reference Slot')} ${slot.slot} · ${slot.label}`)}
                                className="flex w-full items-center gap-2 rounded-md border border-[var(--border-primary)] bg-[var(--bg-elevated)] p-2 text-left disabled:cursor-default"
                              >
                                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-[var(--bg-base)] font-mono text-[10px] font-bold text-[var(--accent-text)]">{slot.slot}</span>
                                {slot.image ? (
                                  <img src={slot.image} alt={slot.label} className="h-9 w-12 shrink-0 rounded object-cover" />
                                ) : (
                                  <div className="h-9 w-12 shrink-0 rounded border border-dashed border-[var(--border-secondary)] bg-[var(--bg-base)]" />
                                )}
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-2">
                                    <span className="truncate text-[10px] font-semibold text-[var(--text-secondary)]">
                                      {slot.kind === 'reserved'
                                        ? text('安全预留槽位', 'Reserved safety slot')
                                        : slot.kind === 'empty'
                                          ? text('可用槽位', 'Available slot')
                                          : slot.kind === 'continuity'
                                            ? text('首帧连贯性', 'Start-frame continuity')
                                            : slot.label}
                                    </span>
                                    <span className="rounded border border-[var(--border-primary)] px-1.5 py-0.5 text-[8px] uppercase text-[var(--text-muted)]">{slot.role}</span>
                                  </div>
                                  {slot.includedLabels?.length ? (
                                    <p className="mt-0.5 truncate text-[9px] text-[var(--text-muted)]">{slot.includedLabels.join(' · ')}</p>
                                  ) : (slot.detailZh || slot.detailEn || slot.detail) ? (
                                    <p className="mt-0.5 truncate text-[9px] text-[var(--text-muted)]">
                                      {language === 'zh' ? (slot.detailZh || slot.detail) : (slot.detailEn || slot.detail)}
                                    </p>
                                  ) : null}
                                </div>
                              </button>
                            ))}
                            {referencePreviewPack.droppedInspections.length > 0 && (
                              <div className="rounded-md border border-[var(--warning-border)] bg-[var(--warning-bg)] p-2">
                                <p className="text-[9px] font-bold text-[var(--warning-text)]">{text('未采用的参考图', 'Omitted References')}</p>
                                {referencePreviewPack.droppedInspections.map(({ entry }) => (
                                  <p key={`${entry.type}:${entry.label}`} className="mt-1 text-[9px] text-[var(--text-secondary)]">
                                    {entry.type}: {entry.label} — {text('在严格安全预案中暂不采用', 'omitted by the strict safety plan')}
                                  </p>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                  )}
                </>
              ) : (
                <p className="text-xs text-[var(--text-muted)]">暂无脚本资产数据。</p>
              )}
            </div>
          )}
        </section>

        <section id="shot-section-narrative" className="rounded-xl border border-[var(--border-primary)] bg-[var(--bg-surface)] overflow-hidden">
          {renderSectionHeader('narrative', '2 动作与台词', '先写清动作和台词，再做关键帧', steps[1]?.done)}
          {isSectionOpen('narrative') && (
            <div className="border-t border-[var(--border-primary)] p-3 space-y-2">
              <div className="flex items-center gap-2">
                <Film className="w-4 h-4 text-[var(--text-tertiary)]" />
                <h4 className="text-xs font-bold text-[var(--text-tertiary)] uppercase tracking-widest">Narrative</h4>
                <div className="ml-auto flex items-center gap-1">
                  <button
                    onClick={onGenerateAIAction}
                    disabled={isAIOptimizing}
                    className="p-1 text-[var(--accent-text)] hover:text-[var(--text-primary)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    title="AI生成动作建议"
                  >
                    {isAIOptimizing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                  </button>
                  <button
                    onClick={onEditActionSummary}
                    className="p-1 text-[var(--warning-text)] hover:text-[var(--text-primary)] transition-colors"
                    title="编辑动作文本"
                  >
                    <Edit2 className="w-3 h-3" />
                  </button>
                  <button
                    onClick={onEditDialogue}
                    className="p-1 text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
                    title="编辑台词"
                  >
                    <MessageSquare className="w-3 h-3" />
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-1 @min-[520px]:grid-cols-2 gap-2">
                <div className="bg-[var(--bg-base)] p-3 rounded-lg border border-[var(--border-primary)] max-h-28 overflow-y-auto custom-scrollbar">
                  <p className="text-[var(--text-secondary)] text-xs leading-relaxed">{shot.actionSummary || '暂无动作描述。'}</p>
                </div>
                <div className="bg-[var(--bg-base)] p-3 rounded-lg border border-[var(--border-primary)] flex gap-2 max-h-28 overflow-y-auto custom-scrollbar">
                  <MessageSquare className="w-4 h-4 text-[var(--text-muted)] mt-0.5 shrink-0" />
                  <div className="flex-1 min-w-0">
                    {shot.dialogue ? (
                      <p className="text-[var(--text-tertiary)] text-xs italic leading-relaxed">"{shot.dialogue}"</p>
                    ) : (
                      <p className="text-[var(--text-muted)] text-xs leading-relaxed">暂无台词，点击上方气泡图标添加。</p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </section>

        <section id="shot-section-keyframe" className="rounded-xl border border-[var(--border-primary)] bg-[var(--bg-surface)] overflow-hidden">
          {renderSectionHeader(
            'keyframe',
            effectiveVideoInputMode === 'storyboard-grid' ? '3 网格分镜' : '3 关键帧制作',
            effectiveVideoInputMode === 'storyboard-grid'
              ? '网格分镜与首尾帧二选一，当前为网格模式'
              : '完成首帧/尾帧后再进入视频',
            steps[2]?.done
          )}
          {isSectionOpen('keyframe') && (
            <div className="border-t border-[var(--border-primary)] p-3 space-y-3">
              <div className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-base)]/40 p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-secondary)]">
                    镜头驱动模式（2 选 1）
                  </p>
                  <span className="text-[9px] text-[var(--accent-text)] bg-[var(--accent-bg)] border border-[var(--accent-border)] px-2 py-0.5 rounded">
                    {recommendationText}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => onVideoInputModeChange('keyframes')}
                    className={`px-2 py-2 rounded border text-[10px] font-bold uppercase tracking-wider transition-colors ${
                      effectiveVideoInputMode === 'keyframes'
                        ? 'border-[var(--accent-border)] bg-[var(--accent-bg)] text-[var(--accent-text)]'
                        : 'border-[var(--border-primary)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)]'
                    }`}
                  >
                    首尾帧
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onVideoInputModeChange('storyboard-grid');
                      if (!isAdvancedMode) setIsAdvancedMode(true);
                    }}
                    className={`px-2 py-2 rounded border text-[10px] font-bold uppercase tracking-wider transition-colors ${
                      effectiveVideoInputMode === 'storyboard-grid'
                        ? 'border-[var(--accent-border)] bg-[var(--accent-bg)] text-[var(--accent-text)]'
                        : 'border-[var(--border-primary)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)]'
                    }`}
                  >
                    网格分镜
                  </button>
                </div>
                <p className="text-[10px] text-[var(--text-muted)]">
                  网格分镜与首尾帧互斥：切换为网格模式后，视频将自动忽略尾帧输入。
                </p>
              </div>

              {effectiveVideoInputMode === 'keyframes' ? (
                <KeyframeEditor
                  shotId={shot.id}
                  shotIndex={shotIndex}
                  startKeyframe={startKf}
                  endKeyframe={endKf}
                  showEndFrame={showEndFrame}
                  canCopyPrevious={shotIndex > 0}
                  canCopyNext={shotIndex < totalShots - 1 && nextShotHasStartFrame}
                  isAIOptimizing={isAIOptimizing}
                  useAIEnhancement={useAIEnhancement}
                  onToggleAIEnhancement={onToggleAIEnhancement}
                  onGenerateKeyframe={onGenerateKeyframe}
                  onCancelKeyframe={onCancelKeyframe}
                  onUploadKeyframe={onUploadKeyframe}
                  onEditPrompt={onEditKeyframePrompt}
                  onOptimizeWithAI={onOptimizeKeyframeWithAI}
                  onOptimizeBothWithAI={onOptimizeBothKeyframes}
                  onCopyPrevious={onCopyPreviousEndFrame}
                  onCopyNext={onCopyNextStartFrame}
                  onImageClick={onImageClick}
                />
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    {([4, 6, 9] as const).map((count) => {
                      const layout = STORYBOARD_GRID_LAYOUTS[count];
                      return (
                        <button
                          key={count}
                          type="button"
                          onClick={() => setSelectedGridPanelCount(count)}
                          className={`px-2 py-1.5 rounded border text-[10px] font-semibold transition-colors ${
                            selectedGridPanelCount === count
                              ? 'border-[var(--accent-border)] bg-[var(--accent-bg)] text-[var(--accent-text)]'
                              : 'border-[var(--border-primary)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)]'
                          }`}
                        >
                          {layout.label}
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-[10px] text-[var(--text-muted)]">
                    小优化：8 秒镜头默认推荐六宫格，减少切镜频率。
                  </p>

                  <button
                    onClick={openOrGenerateGridStoryboard}
                    disabled={isGridGenerating}
                    className={`w-full py-2.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all flex items-center justify-center gap-2 border ${
                      isGridGenerating
                        ? 'bg-[var(--bg-base)] text-[var(--text-muted)] border-[var(--border-primary)] cursor-wait'
                        : nineGrid?.status === 'completed' && hasSameGridLayout
                          ? 'bg-[var(--success-bg)] text-[var(--success-text)] border-[var(--success-border)]'
                          : nineGrid?.status === 'panels_ready' && hasSameGridLayout
                            ? 'bg-[var(--warning-bg)] text-[var(--warning-text)] border-[var(--warning-border)]'
                            : 'bg-[var(--bg-base)] text-[var(--text-tertiary)] border-[var(--border-secondary)] hover:text-[var(--text-primary)]'
                    }`}
                  >
                    {nineGrid?.status === 'generating_panels' ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>分镜描述生成中...</span>
                      </>
                    ) : nineGrid?.status === 'generating_image' ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>{selectedGridLayout.label}出图中...</span>
                      </>
                    ) : nineGrid?.status === 'completed' && hasSameGridLayout ? (
                      <>
                        <Grid3x3 className="w-3.5 h-3.5" />
                        <span>查看{selectedGridLayout.label}分镜</span>
                      </>
                    ) : nineGrid?.status === 'panels_ready' && hasSameGridLayout ? (
                      <>
                        <Grid3x3 className="w-3.5 h-3.5" />
                        <span>确认{selectedGridLayout.label}分镜</span>
                      </>
                    ) : (
                      <>
                        <Grid3x3 className="w-3.5 h-3.5" />
                        <span>生成{selectedGridLayout.label}分镜</span>
                      </>
                    )}
                  </button>

                  {!hasSameGridLayout && nineGrid?.panels?.length ? (
                    <p className="text-[10px] text-[var(--text-muted)]">
                      当前已有 {existingGridLayout.label} 结果，点击上方按钮将重新生成 {selectedGridLayout.label}。
                    </p>
                  ) : null}

                  {nineGrid?.status === 'completed' && nineGrid.imageUrl && hasSameGridLayout && (
                    <div
                      className="relative bg-[var(--bg-base)] rounded-lg border border-[var(--border-primary)] overflow-hidden cursor-pointer group"
                      onClick={onShowNineGrid}
                    >
                      <img
                        src={nineGrid.imageUrl}
                        className="w-full h-auto block transition-transform duration-300 group-hover:scale-105"
                        alt={`${selectedGridLayout.label}分镜预览`}
                      />
                      <div className="absolute inset-0 bg-[var(--bg-base)]/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center pointer-events-none">
                        <span className="text-[var(--text-primary)] text-xs font-mono">点击查看并选择镜头</span>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </section>

        <section id="shot-section-video" className="rounded-xl border border-[var(--border-primary)] bg-[var(--bg-surface)] overflow-hidden">
          {renderSectionHeader('video', '4 视频生成', '选模型、设参数、出片', steps[3]?.done)}
          {isSectionOpen('video') && (
            <div className="border-t border-[var(--border-primary)] p-3">
              <VideoGenerator
                shot={shot}
                shotIndex={shotIndex}
                hasStartFrame={hasStartFrame}
                hasEndFrame={hasEndFrame}
                onGenerate={onGenerateVideo}
                onCancel={onCancelVideo}
                defaultAspectRatio={projectAspectRatio}
                planningShotDuration={scriptData?.planningShotDuration}
                onEditPrompt={onEditVideoPrompt}
                onModelChange={(modelId) => {
                  setLocalVideoModelId(modelId);
                  onVideoModelChange(modelId);
                }}
              />
              <DubbingPanel
                shot={shot}
                voiceCharacters={voiceCharacters}
                onGenerateDubbing={onGenerateDubbing}
                onClearDubbing={onClearDubbing}
              />
            </div>
          )}
        </section>

        {isAdvancedMode && (
          <section className="rounded-xl border border-[var(--border-primary)] bg-[var(--bg-surface)] overflow-hidden">
            {renderSectionHeader('advanced', '高级工具', '镜头拆分与实验能力', undefined)}
            {isSectionOpen('advanced') && (
              <div className="border-t border-[var(--border-primary)] p-3">
                <button
                  onClick={onSplitShot}
                  disabled={isSplittingShot}
                  className="w-full py-2 rounded-lg border border-[var(--border-secondary)] bg-[var(--bg-base)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors text-xs font-semibold flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSplittingShot ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Scissors className="w-3.5 h-3.5" />}
                  {isSplittingShot ? '拆镜中...' : 'AI拆分镜头'}
                </button>
              </div>
            )}
          </section>
        )}
        </div>
      </div>

      <div className="border-t border-[var(--border-primary)] bg-[var(--bg-surface)] p-4 space-y-2">
        <div className="flex items-center gap-2 text-[10px] text-[var(--text-muted)]">
          <SlidersHorizontal className="w-3.5 h-3.5" />
          <span>{primaryAction.hint}</span>
        </div>
        <button
          type="button"
          onClick={primaryAction.onClick}
          disabled={primaryAction.disabled}
          className="w-full py-2.5 rounded-lg bg-[var(--btn-primary-bg)] text-[var(--btn-primary-text)] hover:bg-[var(--btn-primary-hover)] text-xs font-bold tracking-wider transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {primaryAction.label}
        </button>
      </div>
    </div>
  );
};

export default ShotWorkbench;
