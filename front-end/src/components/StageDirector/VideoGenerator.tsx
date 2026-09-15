import React, { useState, useEffect } from 'react';
import { Video, Loader2, Edit2 } from 'lucide-react';
import { Shot, AspectRatio, VideoDuration } from '../../types';
import { VideoSettingsPanel } from '../AspectRatioSelector';
import { isMiniMaxH3VideoModel, resolveVideoModelRouting } from './utils';
import {
  getDefaultAspectRatio,
  getVideoModels,
  getActiveVideoModel,
  getProviderById,
} from '../../services/modelRegistry';
import { recommendVideoDuration } from '../../services/videoDurationRecommend';
import { useGenerationQueue } from '../../contexts/GenerationQueueContext';
import { formatJobProgressLabel, resolveShotVideoBadge } from '../../services/generationQueue';
import { VideoModelDefinition } from '../../types/model';
import { useResolvedVideoUrl } from '../../hooks/useResolvedVideoUrl';
import { useInterfaceLanguage } from '../../contexts/InterfaceLanguageContext';

interface VideoGeneratorProps {
  shot: Shot;
  shotIndex?: number;
  hasStartFrame: boolean;
  hasEndFrame: boolean;
  onGenerate: (aspectRatio: AspectRatio, duration: VideoDuration, modelId: string, quality?: 'standard' | 'turbo') => void;
  onCancel?: () => void;
  onEditPrompt: () => void;
  onModelChange?: (modelId: string) => void;
  planningShotDuration?: number;
  defaultAspectRatio?: AspectRatio;
  defaultModelId?: string;
}

const VideoGenerator: React.FC<VideoGeneratorProps> = ({
  shot,
  shotIndex = 0,
  hasStartFrame,
  hasEndFrame,
  onGenerate,
  onCancel,
  onEditPrompt,
  onModelChange,
  planningShotDuration,
  defaultAspectRatio = '16:9',
  defaultModelId,
}) => {
  const { text } = useInterfaceLanguage();
  const normalizeModelId = (modelId?: string) => {
    if (!modelId) return modelId;
    const normalized = modelId.toLowerCase();
    if (normalized === 'veo_3_1-fast-4k') return 'veo_3_1-fast';
    if (
      normalized === 'veo' ||
      normalized === 'veo-r2v' ||
      normalized === 'veo_3_1' ||
      normalized.startsWith('veo_3_0_r2v')
    ) {
      return 'veo_3_1-fast';
    }
    return modelId;
  };

  const resolveVeoFastQuality = (modelId?: string): 'standard' | '4k' => {
    if (!modelId) return 'standard';
    return modelId.toLowerCase() === 'veo_3_1-fast-4k' ? '4k' : 'standard';
  };

  const videoModels = getVideoModels().filter((m) => m.isEnabled);
  const activeVideoModel = getActiveVideoModel();

  const resolveInitialModelId = (): string => {
    const perShot = normalizeModelId(shot.videoModel);
    if (perShot && videoModels.some((m) => m.id === perShot)) return perShot;
    if (defaultModelId && videoModels.some((m) => m.id === defaultModelId)) return defaultModelId;
    if (activeVideoModel?.id && videoModels.some((m) => m.id === activeVideoModel.id)) {
      return activeVideoModel.id;
    }
    return videoModels[0]?.id || 'sora-2';
  };

  const [selectedModelId, setSelectedModelId] = useState<string>(resolveInitialModelId);
  const [veoFastQuality, setVeoFastQuality] = useState<'standard' | '4k'>(
    resolveVeoFastQuality(shot.videoModel)
  );
  const [h3Quality, setH3Quality] = useState<'standard' | 'turbo'>(shot.interval?.videoQuality || 'standard');
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>(
    () => shot.interval?.aspectRatio || defaultAspectRatio || getDefaultAspectRatio()
  );
  const [duration, setDuration] = useState<VideoDuration>(5);
  const [durationHint, setDurationHint] = useState('');
  const [recommendedDuration, setRecommendedDuration] = useState<VideoDuration>(5);

  const selectedModel = videoModels.find((m) => m.id === selectedModelId) as VideoModelDefinition | undefined;
  const selectedProvider = selectedModel ? getProviderById(selectedModel.providerId) : undefined;
  const requiresDedicatedApiKey = selectedModel?.providerId === 'volcengine';
  const hasDedicatedApiKey = Boolean(
    (selectedModel?.apiKey && selectedModel.apiKey.trim()) ||
      (selectedProvider?.apiKey && selectedProvider.apiKey.trim())
  );
  const isMissingVolcengineApiKey = Boolean(requiresDedicatedApiKey && !hasDedicatedApiKey);
  const modelType: 'sora' | 'veo' = selectedModel?.params.mode === 'async' ? 'sora' : 'veo';
  const effectiveModelId =
    selectedModelId === 'veo_3_1-fast'
      ? veoFastQuality === '4k'
        ? 'veo_3_1-fast-4K'
        : 'veo_3_1-fast'
      : selectedModelId;
  const modelRouting = resolveVideoModelRouting(effectiveModelId || selectedModelId || 'sora-2');
  const routingLabel =
    isMiniMaxH3VideoModel(effectiveModelId || selectedModelId)
      ? 'ComfyUI H3'
      : modelRouting.family === 'sora'
      ? 'Sora'
      : modelRouting.family === 'doubao-task'
        ? 'Doubao Task'
        : modelRouting.family === 'veo-fast'
          ? 'Veo Fast'
          : modelRouting.family === 'comfyui-ltx'
            ? 'ComfyUI LTX'
            : 'Unknown';

  const { jobs } = useGenerationQueue();
  const videoBadge = resolveShotVideoBadge(shot, jobs, shotIndex);
  const isBusy = videoBadge.status === 'running' || videoBadge.status === 'queued' || shot.interval?.status === 'generating';
  const isGenerating = isBusy;
  const hasVideo = !!shot.interval?.videoUrl;
  const resolvedVideoSrc = useResolvedVideoUrl(shot.interval?.videoUrl);
  const [mediaAspectRatio, setMediaAspectRatio] = useState<AspectRatio | null>(null);
  const previewAspectRatio = hasVideo ? (mediaAspectRatio || shot.interval?.aspectRatio || aspectRatio) : aspectRatio;

  useEffect(() => {
    if (!selectedModel) return;

    if (!selectedModel.params.supportedAspectRatios.includes(aspectRatio)) {
      setAspectRatio(selectedModel.params.defaultAspectRatio);
    }
    const recommendation = recommendVideoDuration(
      shot,
      selectedModel.params.supportedDurations,
      planningShotDuration,
    );
    setRecommendedDuration(recommendation.duration);
    setDurationHint(recommendation.reason);
    const stored = Number(shot.interval?.duration) as VideoDuration;
    if (selectedModel.params.supportedDurations.includes(stored)) {
      setDuration(stored);
    } else {
      setDuration(recommendation.duration);
    }
  }, [selectedModelId, shot.id]);

  useEffect(() => {
    setAspectRatio(shot.interval?.aspectRatio || defaultAspectRatio || getDefaultAspectRatio());
    setH3Quality(shot.interval?.videoQuality || 'standard');
    setMediaAspectRatio(null);
  }, [shot.id, shot.interval?.aspectRatio, defaultAspectRatio]);

  useEffect(() => {
    if (!selectedModel) return;
    const recommendation = recommendVideoDuration(
      shot,
      selectedModel.params.supportedDurations,
      planningShotDuration,
    );
    setRecommendedDuration(recommendation.duration);
    setDurationHint(recommendation.reason);
  }, [
    shot.dialogue,
    shot.actionSummary,
    shot.cameraMovement,
    shot.dubbing?.text,
    planningShotDuration,
    selectedModelId,
  ]);

  useEffect(() => {
    const perShot = normalizeModelId(shot.videoModel);
    if (perShot && videoModels.some((m) => m.id === perShot)) {
      setSelectedModelId(perShot);
      setVeoFastQuality(resolveVeoFastQuality(shot.videoModel));
      return;
    }
    if (defaultModelId && videoModels.some((m) => m.id === defaultModelId)) {
      setSelectedModelId(defaultModelId);
      return;
    }
    if (activeVideoModel?.id && videoModels.some((m) => m.id === activeVideoModel.id)) {
      setSelectedModelId(activeVideoModel.id);
      onModelChange?.(activeVideoModel.id);
      return;
    }
  }, [shot.id, shot.videoModel, defaultModelId, activeVideoModel?.id, videoModels.map((m) => m.id).join('|')]);

  const handleGenerate = () => {
    onGenerate(aspectRatio, duration, effectiveModelId, h3Quality);
  };

  const handleH3QualityChange = (quality: 'standard' | 'turbo') => {
    setH3Quality(quality);
  };

  const handleVeoFastQualityChange = (quality: 'standard' | '4k') => {
    setVeoFastQuality(quality);
    if (selectedModelId === 'veo_3_1-fast') {
      const modelId = quality === '4k' ? 'veo_3_1-fast-4K' : 'veo_3_1-fast';
      onModelChange?.(modelId);
    }
  };

  const isRef2VModel = effectiveModelId.toLowerCase().includes('r2v');
  const canGenerate = (isRef2VModel || hasStartFrame) && !isMissingVolcengineApiKey;

  return (
    <div className="grid grid-cols-1 @min-[720px]:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] gap-3 items-start">
      <div className="space-y-3 min-w-0">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-bold text-[var(--text-primary)] uppercase tracking-widest flex items-center gap-2">
          <Video className="w-3 h-3 text-[var(--accent)]" />
          {text('参数', 'Parameters')}
          <button
            onClick={onEditPrompt}
            className="p-1 text-[var(--warning-text)] hover:text-[var(--text-primary)] transition-colors"
            title={text('编辑视频提示词', 'Edit video prompt')}
          >
            <Edit2 className="w-3 h-3" />
          </button>
        </h4>
        {shot.interval?.status === 'completed' && (
          <span className="text-[10px] text-[var(--success)] font-mono flex items-center gap-1">● READY</span>
        )}
      </div>

      <div className="space-y-2">
        <label className="text-[10px] font-bold text-[var(--text-tertiary)] uppercase tracking-widest block">
          {text('视频模型', 'Video model')}
        </label>
        <select
          value={selectedModelId}
          onChange={(e) => {
            const newModelId = e.target.value;
            setSelectedModelId(newModelId);
            const resolvedModelId =
              newModelId === 'veo_3_1-fast'
                ? veoFastQuality === '4k'
                  ? 'veo_3_1-fast-4K'
                  : 'veo_3_1-fast'
                : newModelId;
            onModelChange?.(resolvedModelId);
          }}
          className="w-full bg-[var(--bg-base)] text-[var(--text-primary)] border border-[var(--border-secondary)] rounded-lg px-3 py-2 text-xs outline-none focus:border-[var(--accent)] transition-colors"
          disabled={isGenerating}
        >
          {videoModels.map((model) => (
            <option key={model.id} value={model.id}>
              {model.name}
            </option>
          ))}
        </select>
        {selectedModel?.description && (
          <p
            className="text-[9px] text-[var(--text-muted)] leading-relaxed line-clamp-2"
            title={selectedModel.description}
          >
            {selectedModel.description}
          </p>
        )}
        {isMissingVolcengineApiKey && (
          <div className="rounded-lg border border-[var(--error-border)] bg-[var(--error-bg)] px-3 py-2">
            <p className="text-[10px] text-[var(--error-text)] font-bold">{text('当前模型需要火山引擎 API Key', 'This model requires a Volcengine API key')}</p>
            <p className="text-[9px] text-[var(--error-text)]/90 mt-1">
              {text('未检测到对应 Key，请先在模型配置中设置后再生成。', 'No matching key was found. Add it in model settings before generating.')}
            </p>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] font-mono text-[var(--text-secondary)] mr-1">{routingLabel}</span>
          {[
            { key: 'start-only', label: text('首帧', 'Start'), enabled: modelRouting.supportsStartFrame },
            {
              key: 'start-end',
              label: text('首尾帧', 'Start/End'),
              enabled: modelRouting.supportsStartFrame && modelRouting.supportsEndFrame,
            },
            {
              key: 'nine-grid-priority',
              label: text('九宫格', 'Grid'),
              enabled: modelRouting.prefersNineGridStoryboard,
            },
          ].map((capability) => (
            <span
              key={capability.key}
              className={`px-1.5 py-0.5 rounded border text-[10px] font-mono ${
                capability.enabled
                  ? 'text-[var(--success)] border-[var(--success)]/40 bg-[var(--success)]/10'
                  : 'text-[var(--text-muted)] border-[var(--border-primary)] bg-[var(--bg-hover)]'
              }`}
            >
              {capability.label} {capability.enabled ? 'ON' : 'OFF'}
            </span>
          ))}
          {isMiniMaxH3VideoModel(effectiveModelId || selectedModelId) && (
            <span className="px-1.5 py-0.5 rounded border text-[10px] font-mono text-[var(--success)] border-[var(--success)]/40 bg-[var(--success)]/10">
              {text('原生音频 ON', 'Native audio ON')}
            </span>
          )}
          {hasEndFrame && !modelRouting.supportsEndFrame && (
            <p className="basis-full text-[9px] text-[var(--warning-text)] font-mono">
              {text('当前模型忽略尾帧，仅使用首帧。', 'This model ignores the end frame and uses the start frame only.')}
            </p>
          )}
        </div>
        {isMiniMaxH3VideoModel(effectiveModelId || selectedModelId) && (
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-[var(--text-tertiary)] uppercase">{text('视频质量', 'Quality')}</span>
            <div className="flex gap-1">
              {(['standard', 'turbo'] as const).map((quality) => (
                <button
                  key={quality}
                  onClick={() => handleH3QualityChange(quality)}
                  disabled={isGenerating}
                  className={`px-3 py-1.5 rounded-md text-xs transition-all ${
                    h3Quality === quality
                      ? 'bg-[var(--accent)] text-[var(--text-primary)]'
                      : 'bg-[var(--bg-hover)] text-[var(--text-tertiary)] hover:bg-[var(--border-secondary)] hover:text-[var(--text-secondary)]'
                  } ${isGenerating ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                >
                  {quality === 'standard' ? text('高质量', 'High') : text('快速预览', 'Turbo')}
                </button>
              ))}
            </div>
          </div>
        )}
        {selectedModelId === 'veo_3_1-fast' && (
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-[var(--text-tertiary)] uppercase">{text('清晰度', 'Clarity')}</span>
            <div className="flex gap-1">
              <button
                onClick={() => handleVeoFastQualityChange('standard')}
                disabled={isGenerating}
                className={`
                  px-3 py-1.5 rounded-md text-xs transition-all
                  ${
                    veoFastQuality === 'standard'
                      ? 'bg-[var(--accent)] text-[var(--text-primary)]'
                      : 'bg-[var(--bg-hover)] text-[var(--text-tertiary)] hover:bg-[var(--border-secondary)] hover:text-[var(--text-secondary)]'
                  }
                  ${isGenerating ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
                `}
              >
                {text('标准', 'Standard')}
              </button>
              <button
                onClick={() => handleVeoFastQualityChange('4k')}
                disabled={isGenerating}
                className={`
                  px-3 py-1.5 rounded-md text-xs transition-all
                  ${
                    veoFastQuality === '4k'
                      ? 'bg-[var(--accent)] text-[var(--text-primary)]'
                      : 'bg-[var(--bg-hover)] text-[var(--text-tertiary)] hover:bg-[var(--border-secondary)] hover:text-[var(--text-secondary)]'
                  }
                  ${isGenerating ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
                `}
              >
                4K
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="space-y-2">
        <label className="text-[10px] font-bold text-[var(--text-tertiary)] uppercase tracking-widest block">{text('视频设置', 'Video settings')}</label>
        <VideoSettingsPanel
          aspectRatio={aspectRatio}
          onAspectRatioChange={setAspectRatio}
          duration={duration}
          onDurationChange={setDuration}
          modelType={modelType}
          disabled={isGenerating}
          supportedAspectRatios={selectedModel?.params.supportedAspectRatios}
          supportedDurations={selectedModel?.params.supportedDurations}
          recommendedDuration={recommendedDuration}
        />
        {durationHint && (
          <p className="text-[9px] text-[var(--text-muted)] font-mono">{durationHint}{text('，可手动改档', '; adjustable')}</p>
        )}
      </div>

      <div className="flex gap-2">
        <button
          onClick={handleGenerate}
          disabled={!canGenerate || isGenerating}
          className={`flex-1 py-2.5 rounded-lg font-bold text-xs uppercase tracking-widest flex items-center justify-center gap-2 transition-all ${
            hasVideo
              ? 'bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:bg-[var(--border-secondary)]'
              : 'bg-[var(--accent)] text-[var(--text-primary)] hover:bg-[var(--accent-hover)] shadow-lg shadow-[var(--accent-shadow)]'
          } ${!canGenerate || isGenerating ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
          {isGenerating ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              {videoBadge.status === 'queued'
                ? `${text('排队中', 'Queued')} ${formatJobProgressLabel(videoBadge.job, 'queued')} (${aspectRatio}, ${duration}${text('秒', 's')})`
                : `${formatJobProgressLabel(videoBadge.job, 'running')} (${aspectRatio}, ${duration}${text('秒', 's')})`}
            </>
          ) : (
            <>{hasVideo ? text('重做视频', 'Regenerate video') : text('生成视频', 'Generate video')}</>
          )}
        </button>
        {isGenerating && onCancel && (
          <button
            onClick={onCancel}
            className="px-4 py-2.5 rounded-lg font-bold text-xs uppercase tracking-widest border border-[var(--error-border)] bg-[var(--error-bg)] text-[var(--error-text)] hover:bg-[var(--error-hover-bg-strong)] transition-colors"
          >
            {text('取消', 'Cancel')}
          </button>
        )}
      </div>
      {isMissingVolcengineApiKey && (
        <div className="text-[9px] text-[var(--error-text)] text-center font-mono">
          * {text('请配置火山引擎 API Key', 'Configure a Volcengine API key')}
        </div>
      )}

      {!hasEndFrame && (
        <div className="text-[9px] text-[var(--text-tertiary)] text-center font-mono">
          * {text('未检测到尾帧，将使用单图生成', 'No end frame; image-to-video mode will be used')}
        </div>
      )}
      </div>

      <div className="min-w-0 flex justify-center items-start">
        <div
          className={`h-56 max-w-full rounded-lg overflow-hidden border relative ${
            previewAspectRatio === '9:16'
              ? 'aspect-[9/16]'
              : previewAspectRatio === '1:1'
                ? 'aspect-square'
                : 'aspect-video'
          } ${hasVideo ? 'bg-[var(--bg-base)] border-[var(--border-secondary)]' : 'bg-[var(--nav-hover-bg)] border-dashed border-[var(--border-primary)] flex items-center justify-center'}`}
        >
          {hasVideo ? (
            <video
              src={resolvedVideoSrc}
              controls
              onLoadedMetadata={(event) => {
                const video = event.currentTarget;
                if (video.videoWidth && video.videoHeight) {
                  const ratio = video.videoWidth / video.videoHeight;
                  setMediaAspectRatio(ratio < 0.8 ? '9:16' : ratio > 1.25 ? '16:9' : '1:1');
                }
              }}
              className="w-full h-full object-contain"
            />
          ) : (
            <span className="text-xs text-[var(--text-muted)] font-mono">{aspectRatio}</span>
          )}
        </div>
      </div>
    </div>
  );
};

export default VideoGenerator;
