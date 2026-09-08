import React, { useEffect, useState } from 'react';
import { Loader2, Edit2, Upload, ArrowRight, ArrowLeft, Sparkles, Wand2 } from 'lucide-react';
import { Keyframe } from '../../types';
import { useGenerationQueue } from '../../contexts/GenerationQueueContext';
import { findShotKeyframeJob, formatJobProgressLabel, jobDisplayState } from '../../services/generationQueue';

interface KeyframeEditorProps {
  shotId: string;
  shotIndex?: number;
  startKeyframe?: Keyframe;
  endKeyframe?: Keyframe;
  showEndFrame?: boolean;
  canCopyPrevious: boolean;
  canCopyNext: boolean; // 是否可以复制下一镜头的首帧（需要有下一个镜头且已生成首帧）
  isAIOptimizing?: boolean;
  useAIEnhancement: boolean;
  onToggleAIEnhancement: () => void;
  onGenerateKeyframe: (type: 'start' | 'end') => void;
  onCancelKeyframe?: (type: 'start' | 'end') => void;
  onUploadKeyframe: (type: 'start' | 'end') => void;
  onEditPrompt: (type: 'start' | 'end', prompt: string) => void;
  onOptimizeWithAI: (type: 'start' | 'end') => void;
  onOptimizeBothWithAI: () => void;
  onCopyPrevious: () => void;
  onCopyNext: () => void; // 复制下一镜头首帧到当前尾帧
  onImageClick: (url: string, title: string) => void;
}

const KeyframeImage: React.FC<{ url: string; alt: string; onClick: () => void }> = ({
  url,
  alt,
  onClick,
}) => {
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
      setRetry((value) => value + 1);
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [failed, retry]);

  if (failed) {
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center text-[var(--text-muted)] p-2">
        <span className="text-[10px] text-[var(--error)] mb-1">图片无法显示</span>
        <span className="text-[9px] text-[var(--text-muted)] text-center">请重新生成或上传</span>
      </div>
    );
  }

  return (
    <>
      <img
        key={`${url}:${retry}`}
        src={retry ? `${url}${url.includes('?') ? '&' : '?'}_r=${retry}` : url}
        className="w-full h-full object-cover cursor-pointer transition-transform duration-300 group-hover:scale-105"
        onClick={onClick}
        onError={() => setFailed(true)}
        alt={alt}
      />
      <div className="absolute inset-0 bg-[var(--bg-base)]/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center pointer-events-none">
        <span className="text-[var(--text-primary)] text-xs font-mono">点击预览</span>
      </div>
    </>
  );
};

const KeyframeEditor: React.FC<KeyframeEditorProps> = ({
  shotId,
  shotIndex = 0,
  startKeyframe,
  endKeyframe,
  showEndFrame = true,
  canCopyPrevious,
  canCopyNext,
  isAIOptimizing = false,
  useAIEnhancement,
  onToggleAIEnhancement,
  onGenerateKeyframe,
  onCancelKeyframe,
  onUploadKeyframe,
  onEditPrompt,
  onOptimizeWithAI,
  onOptimizeBothWithAI,
  onCopyPrevious,
  onCopyNext,
  onImageClick
}) => {
  const { jobs } = useGenerationQueue();

  const renderKeyframePanel = (
    type: 'start' | 'end',
    label: string,
    keyframe?: Keyframe
  ) => {
    const job = findShotKeyframeJob(jobs, shotId, type, shotIndex);
    const display = job ? jobDisplayState(job, jobs) : (keyframe?.status === 'generating' ? 'queued' : undefined);
    const isGenerating = keyframe?.status === 'generating' || display === 'running' || display === 'queued';
    const hasFailed = keyframe?.status === 'failed' && !isGenerating;
    const progressLabel = display
      ? formatJobProgressLabel(job, display)
      : null;
    
    return (
      <div className="space-y-2">
        <div className="flex justify-between items-center">
          <label className="text-[10px] font-bold text-[var(--text-tertiary)] uppercase tracking-widest">
            {label}
          </label>
          <div className="flex items-center gap-1">
            <button
              onClick={() => onOptimizeWithAI(type)}
              disabled={isAIOptimizing}
              className="p-1 text-[var(--accent-text)] hover:text-[var(--text-primary)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              title="AI优化提示词"
            >
              {isAIOptimizing ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <Sparkles className="w-3 h-3" />
              )}
            </button>
            {keyframe?.visualPrompt && (
              <button
                onClick={() => onEditPrompt(type, keyframe.visualPrompt!)}
                className="p-1 text-[var(--warning-text)] hover:text-[var(--text-primary)] transition-colors"
                title="编辑提示词"
              >
                <Edit2 className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>
        
        <div className="aspect-video bg-[var(--bg-base)] rounded-lg border border-[var(--border-primary)] overflow-hidden relative group">
          {keyframe?.imageUrl ? (
            <KeyframeImage
              url={keyframe.imageUrl}
              alt={label}
              onClick={() => onImageClick(keyframe.imageUrl!, `${label} - 关键帧`)}
            />
          ) : !isGenerating && hasFailed ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-[var(--text-muted)] p-2">
              <span className="text-[10px] text-[var(--error)] mb-2">生成失败</span>
              <button
                onClick={() => onGenerateKeyframe(type)}
                className="px-2 py-1 bg-[var(--error-bg)] text-[var(--error-text)] hover:bg-[var(--error-hover-bg-strong)] rounded text-[9px] font-bold transition-colors border border-[var(--error-border)]"
              >
                重试
              </button>
            </div>
          ) : !isGenerating ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-[var(--text-muted)] p-2">
              <span className="text-[10px] text-center">未生成</span>
            </div>
          ) : null}
          {isGenerating && (
            <div className="absolute inset-0 bg-[var(--bg-base)]/70 flex flex-col items-center justify-center p-2">
              <Loader2 className="w-6 h-6 animate-spin mb-2 text-[var(--accent)]" />
              <span className="text-[10px] text-[var(--accent-text)] font-mono">
                {display === 'queued'
                  ? (job?.queue_position ? `排队 #${job.queue_position}` : '排队中')
                  : progressLabel || '生成中'}
              </span>
              {display === 'running' && (
                <div className="mt-2 w-20 h-0.5 rounded-full bg-[var(--bg-hover)] overflow-hidden">
                  <div
                    className="h-full bg-[var(--accent)] transition-all duration-300"
                    style={{ width: `${Math.max(job?.progress ?? 0, 4)}%` }}
                  />
                </div>
              )}
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div className="flex gap-2">
          {isGenerating ? (
            onCancelKeyframe ? (
              <button
                onClick={() => onCancelKeyframe(type)}
                className="flex-1 py-1.5 rounded text-[10px] font-bold uppercase tracking-wider border border-[var(--error-border)] bg-[var(--error-bg)] text-[var(--error-text)] hover:bg-[var(--error-hover-bg-strong)] transition-colors"
              >
                取消生成
              </button>
            ) : null
          ) : (
            <>
              <button
                onClick={() => onGenerateKeyframe(type)}
                disabled={isGenerating}
                className="flex-1 py-1.5 bg-[var(--btn-primary-bg)] hover:bg-[var(--btn-primary-hover)] text-[var(--btn-primary-text)] rounded text-[10px] font-bold uppercase tracking-wider transition-colors flex items-center justify-center gap-1 disabled:opacity-50"
              >
                {keyframe?.imageUrl ? '重新生成' : '生成'}
              </button>
              <button
                onClick={() => onUploadKeyframe(type)}
                className="flex-1 py-1.5 bg-[var(--bg-hover)] hover:bg-[var(--border-secondary)] text-[var(--text-secondary)] rounded text-[10px] font-bold uppercase tracking-wider transition-colors flex items-center justify-center gap-1"
              >
                <Upload className="w-3 h-3" />
                上传
              </button>
            </>
          )}
        </div>

        {/* 有图时也可直接覆盖复制，避免为露出按钮去点「重新生成」触发多余 API */}
        {type === 'start' && canCopyPrevious && !isGenerating && (
          <button
            onClick={onCopyPrevious}
            className="w-full py-1.5 bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] rounded text-[10px] font-bold uppercase tracking-wider transition-colors flex items-center justify-center gap-1 border border-[var(--border-secondary)]"
          >
            <ArrowRight className="w-3 h-3" />
            {keyframe?.imageUrl ? '用上一镜头尾帧覆盖' : '复制上一镜头尾帧'}
          </button>
        )}

        {type === 'end' && canCopyNext && !isGenerating && (
          <button
            onClick={onCopyNext}
            className="w-full py-1.5 bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] rounded text-[10px] font-bold uppercase tracking-wider transition-colors flex items-center justify-center gap-1 border border-[var(--border-secondary)]"
          >
            <ArrowLeft className="w-3 h-3" />
            {keyframe?.imageUrl ? '用下一镜头首帧覆盖' : '复制下一镜头首帧'}
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 border-b border-[var(--border-primary)] pb-2">
        <span className="text-xs font-bold text-[var(--text-tertiary)] uppercase tracking-widest flex-1">
          视觉制作 (Visual Production)
        </span>
        
        {/* AI 增强开关 */}
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-[var(--text-tertiary)]">
            AI增强提示词
          </span>
          <button
            onClick={onToggleAIEnhancement}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
              useAIEnhancement ? 'bg-[var(--accent)]' : 'bg-[var(--border-secondary)]'
            }`}
            title={useAIEnhancement ? '关闭AI增强：使用基础提示词快速生成' : '开启AI增强：自动扩展为专业电影级描述'}
          >
            <span
              className={`inline-block h-3.5 w-3.5 transform rounded-full bg-[var(--btn-primary-bg)] transition-transform ${
                useAIEnhancement ? 'translate-x-5' : 'translate-x-1'
              }`}
            />
          </button>
        </div>
        
        {/* 一次性优化两帧按钮 */}
        {showEndFrame && (
          <button
            onClick={onOptimizeBothWithAI}
            disabled={isAIOptimizing}
            className="px-3 py-1.5 bg-[var(--btn-primary-bg)] hover:bg-[var(--btn-primary-hover)] text-[var(--btn-primary-text)] rounded text-[10px] font-bold uppercase tracking-wider transition-colors flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
            title="AI一次性优化起始帧和结束帧（推荐）"
          >
            {isAIOptimizing ? (
              <>
                <Loader2 className="w-3 h-3 animate-spin" />
                <span>优化中...</span>
              </>
            ) : (
              <>
                <Wand2 className="w-3 h-3" />
                <span>AI优化两帧</span>
              </>
            )}
          </button>
        )}
      </div>

      <div className={`grid gap-4 ${showEndFrame ? 'grid-cols-2' : 'grid-cols-1'}`}>
        {renderKeyframePanel('start', '起始帧', startKeyframe)}
        {showEndFrame && renderKeyframePanel('end', '结束帧', endKeyframe)}
      </div>
    </div>
  );
};

export default KeyframeEditor;
