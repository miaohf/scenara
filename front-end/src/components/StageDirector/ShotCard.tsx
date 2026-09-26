import React, { useEffect, useState } from 'react';
import { Image as ImageIcon, Video, Trash2, Loader2, Clock3, CircleAlert, Grid3x3 } from 'lucide-react';
import { Shot } from '../../types';
import { getShotDisplayLabel } from '../../services/storyboardIdUtils';
import { useGenerationQueue } from '../../contexts/GenerationQueueContext';
import { formatJobProgressLabel, resolveShotKeyframeBadge, resolveShotVideoBadge } from '../../services/generationQueue';
import { useInterfaceLanguage } from '../../contexts/InterfaceLanguageContext';

const ShotThumb: React.FC<{
  url: string;
  alt: string;
  unavailableLabel: string;
  fit?: 'cover' | 'contain';
}> = ({ url, alt, unavailableLabel, fit = 'cover' }) => {
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    setFailed(false);
    setRetry(0);
  }, [url]);

  useEffect(() => {
    if (!failed || retry >= 2) return;
    const timer = window.setTimeout(() => {
      setFailed(false);
      setRetry((n) => n + 1);
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [failed, retry]);

  if (failed && retry >= 2) {
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center text-[var(--text-muted)]">
        <ImageIcon className="w-8 h-8 opacity-20 mb-1" />
        <span className="text-[10px] text-[var(--error)]">{unavailableLabel}</span>
      </div>
    );
  }

  const src = retry > 0 ? `${url}${url.includes('?') ? '&' : '?'}_r=${retry}` : url;
  return (
    <img
      key={src}
      src={src}
      className={`w-full h-full ${fit === 'contain' ? 'object-contain' : 'object-cover'} transition-transform duration-700 group-hover:scale-105`}
      alt={alt}
      onError={() => setFailed(true)}
    />
  );
};

interface ShotCardProps {
  shot: Shot;
  index: number;
  isActive: boolean;
  onClick: () => void;
  onDelete?: (shotId: string) => void;
}

const ShotCard: React.FC<ShotCardProps> = ({ shot, index, isActive, onClick, onDelete }) => {
  const { text } = useInterfaceLanguage();
  const { jobs } = useGenerationQueue();
  const { status: videoStatus, job: videoJob, queuePosition } = resolveShotVideoBadge(shot, jobs, index);
  const startFrameBadge = resolveShotKeyframeBadge(shot, jobs, 'start', index);
  const sKf = shot.keyframes?.find(k => k.type === 'start');
  const usesStoryboardGrid = shot.videoInputMode === 'storyboard-grid' && !!shot.nineGrid?.imageUrl;
  const previewUrl = usesStoryboardGrid ? shot.nineGrid?.imageUrl : sKf?.imageUrl;
  const hasImage = !!previewUrl;
  const keyframeBusy = !usesStoryboardGrid && (startFrameBadge.status === 'running' || startFrameBadge.status === 'queued');
  const keyframeProgressLabel = keyframeBusy
    ? formatJobProgressLabel(startFrameBadge.job, startFrameBadge.status === 'running' ? 'running' : 'queued')
    : null;
  const quality = shot.qualityAssessment;
  const qualityGradeLabel = quality?.grade === 'pass'
    ? text('通过', 'PASS')
    : quality?.grade === 'warning'
      ? text('需优化', 'REVIEW')
      : text('高风险', 'HIGH RISK');
  const qualityBadgeClass = quality?.grade === 'pass'
    ? 'bg-[var(--success-bg)] text-[var(--success-text)] border-[var(--success-border)]'
    : quality?.grade === 'warning'
      ? 'bg-[var(--warning-bg)] text-[var(--warning-text)] border-[var(--warning-border)]'
      : 'bg-[var(--error-hover-bg)] text-[var(--error-text)] border-[var(--error-border)]';

  // 从shot.id中提取显示编号
  // 例如：shot-1 → "SHOT 001", shot-1-1 → "SHOT 001-1", shot-1-2 → "SHOT 001-2"
  const getShotDisplayNumber = () => getShotDisplayLabel(shot.id, index);

  return (
    <div 
      onClick={onClick}
      className={`
        group relative flex flex-col bg-[var(--bg-elevated)] border rounded-xl overflow-hidden cursor-pointer transition-all duration-200
        ${isActive
          ? 'border-[var(--selected-outline)] ring-1 ring-[var(--selected-outline-ring)] shadow-xl scale-[0.98]'
          : 'border-[var(--border-primary)] hover:border-[var(--border-secondary)] hover:shadow-lg'}
      `}
    >
      {/* Header */}
      <div className="px-3 py-2 bg-[var(--bg-surface)] border-b border-[var(--border-primary)] flex justify-between items-center">
        <span className={`font-mono text-[10px] font-bold ${isActive ? 'text-[var(--accent-text)]' : 'text-[var(--text-tertiary)]'}`}>
          {getShotDisplayNumber()}
        </span>
        <div className="flex items-center gap-1.5">
          {onDelete && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete(shot.id);
              }}
              className="p-1 rounded-md text-[var(--text-muted)] hover:text-[var(--error)] hover:bg-[var(--error)]/10 transition-all opacity-0 group-hover:opacity-100"
              title={text('删除分镜', 'Delete shot')}
            >
              <Trash2 className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {/* Thumbnail */}
      <div className="aspect-video bg-[var(--bg-elevated)] relative overflow-hidden">
        {hasImage ? (
          <ShotThumb
            url={previewUrl!}
            alt={usesStoryboardGrid ? `${text('网格分镜', 'Storyboard grid')} ${index + 1}` : `Shot ${index + 1}`}
            unavailableLabel={text('无法预览', 'Preview unavailable')}
            fit={usesStoryboardGrid ? 'contain' : 'cover'}
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-[var(--text-muted)]">
            <ImageIcon className="w-8 h-8 opacity-20" />
          </div>
        )}

        {keyframeBusy && (
          <div className="absolute inset-0 bg-[var(--bg-base)]/70 flex flex-col items-center justify-center gap-1.5">
            <Loader2 className="w-6 h-6 animate-spin text-[var(--accent)]" />
            <span className="text-[10px] font-mono text-[var(--accent-text)]">
              {startFrameBadge.status === 'queued'
                ? (startFrameBadge.queuePosition ? text(`排队 #${startFrameBadge.queuePosition}`, `QUEUED #${startFrameBadge.queuePosition}`) : text('排队中', 'QUEUED'))
                : keyframeProgressLabel}
            </span>
            {startFrameBadge.status === 'running' && (
              <div className="w-16 h-0.5 rounded-full bg-[var(--bg-hover)] overflow-hidden">
                <div
                  className="h-full bg-[var(--accent)] transition-all duration-300"
                  style={{ width: `${Math.max(startFrameBadge.job?.progress ?? 0, 4)}%` }}
                />
              </div>
            )}
          </div>
        )}
        
        {/* Badges */}
        <div className="absolute top-2 right-2 flex flex-col gap-1 items-end">
          {usesStoryboardGrid && (
            <div
              className="px-1.5 py-1 rounded bg-[var(--accent-bg)] border border-[var(--accent-border)] text-[var(--accent-text)] text-[9px] font-bold flex items-center gap-1"
              title={text('当前镜头使用网格分镜作为视频参考', 'This shot uses the storyboard grid as its video reference')}
            >
              <Grid3x3 className="w-3 h-3" />
              {text('网格', 'GRID')}
            </div>
          )}
          {quality && (
            <div className={`px-2 py-1 rounded-full text-[9px] font-bold border ${qualityBadgeClass}`}>
              {text('评分', 'SCORE')} {quality.score} · {qualityGradeLabel}
            </div>
          )}
          {videoStatus === 'ready' && (
            <div
              className="w-7 h-7 rounded-full bg-[var(--success)] text-[var(--text-primary)] flex items-center justify-center shadow-lg"
              title={text('视频已生成', 'Video ready')}
            >
              <Video className="w-3.5 h-3.5" />
            </div>
          )}
          {videoStatus === 'running' && (
            <div
              className="min-w-7 h-7 px-1.5 rounded-full bg-[var(--btn-primary-bg)] text-[var(--btn-primary-text)] ring-1 ring-[var(--accent-border)] flex items-center justify-center shadow-lg font-mono text-[9px] font-bold"
              title={typeof videoJob?.progress === 'number' ? text(`生成中 ${videoJob.progress}%`, `Generating ${videoJob.progress}%`) : text('生成中', 'Generating')}
            >
              {typeof videoJob?.progress === 'number' ? `${videoJob.progress}%` : <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            </div>
          )}
          {videoStatus === 'queued' && (
            <div
              className="w-7 h-7 rounded-full bg-[var(--btn-primary-bg)] text-[var(--btn-primary-text)] ring-1 ring-[var(--warning-border)] flex items-center justify-center shadow-lg"
              title={queuePosition ? text(`排队 #${queuePosition}`, `Queued #${queuePosition}`) : text('排队中', 'Queued')}
            >
              <Clock3 className="w-3.5 h-3.5" />
            </div>
          )}
          {videoStatus === 'failed' && (
            <div
              className="w-7 h-7 rounded-full bg-[var(--error)] text-[var(--text-primary)] flex items-center justify-center shadow-lg"
              title={text('生成失败', 'Generation failed')}
            >
              <CircleAlert className="w-3.5 h-3.5" />
            </div>
          )}
        </div>

        {!isActive && !hasImage && !keyframeBusy && (
          <div className="absolute inset-0 bg-[var(--bg-base)]/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
            <span className="text-[var(--text-primary)] text-xs font-mono">{text('点击编辑', 'Click to edit')}</span>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="p-3">
        <p className="text-xs text-[var(--text-secondary)] line-clamp-2 leading-relaxed">
          {shot.actionSummary}
        </p>
      </div>
    </div>
  );
};

export default ShotCard;
