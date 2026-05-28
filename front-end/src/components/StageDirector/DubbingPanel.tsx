import React, { useEffect, useMemo, useState } from 'react';
import { Mic, Loader2, Trash2 } from 'lucide-react';
import { Shot, DubbingMode } from '../../types';
import { getAudioModels, getActiveAudioModel } from '../../services/modelRegistry';
import { AudioModelDefinition } from '../../types/model';

interface DubbingPanelProps {
  shot: Shot;
  onGenerateDubbing: (mode: DubbingMode, text: string, modelId?: string) => void;
  onClearDubbing: () => void;
}

const DubbingPanel: React.FC<DubbingPanelProps> = ({ shot, onGenerateDubbing, onClearDubbing }) => {
  const audioModels = getAudioModels().filter((m) => m.isEnabled);
  const activeAudioModel = getActiveAudioModel();

  const [dubbingMode, setDubbingMode] = useState<DubbingMode>(shot.dubbing?.mode || 'narration');
  const [selectedAudioModelId, setSelectedAudioModelId] = useState<string>(
    shot.dubbing?.modelId || activeAudioModel?.id || audioModels[0]?.id || 'gpt-audio-1.5'
  );
  const [dubbingText, setDubbingText] = useState<string>(shot.dubbing?.text || '');

  const isGeneratingDubbing = shot.dubbing?.status === 'generating';
  const hasDubbingAudio = !!shot.dubbing?.audioUrl;
  const resolvedDubbingModel = audioModels.find((m) => m.id === selectedAudioModelId) as AudioModelDefinition | undefined;
  const fallbackDubbingText = useMemo(
    () => (dubbingMode === 'dialogue' ? (shot.dialogue || '') : (shot.actionSummary || '')).trim(),
    [dubbingMode, shot.dialogue, shot.actionSummary]
  );
  const canGenerateDubbing = dubbingText.trim().length > 0 && !!selectedAudioModelId && !isGeneratingDubbing;

  useEffect(() => {
    const initialMode = shot.dubbing?.mode || 'narration';
    const initialModelId = shot.dubbing?.modelId || activeAudioModel?.id || audioModels[0]?.id || 'gpt-audio-1.5';
    const initialText = (shot.dubbing?.text || (initialMode === 'dialogue' ? shot.dialogue : shot.actionSummary) || '').trim();
    setDubbingMode(initialMode);
    setSelectedAudioModelId(initialModelId);
    setDubbingText(initialText);
  }, [shot.id, activeAudioModel?.id]);

  const handleGenerateDubbing = () => {
    if (!canGenerateDubbing) return;
    onGenerateDubbing(dubbingMode, dubbingText.trim(), selectedAudioModelId);
  };

  return (
    <div className="mt-3 rounded-xl border border-[var(--border-primary)] bg-[var(--bg-surface)] p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h5 className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-tertiary)] flex items-center gap-2">
          <Mic className="w-3 h-3 text-[var(--accent)]" />
          配音模块
        </h5>
        {shot.dubbing?.status === 'completed' && (
          <span className="text-[9px] text-[var(--success)] font-mono">● READY</span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => {
            setDubbingMode('narration');
            if (!shot.dubbing?.text || dubbingMode !== 'narration') {
              setDubbingText((shot.actionSummary || '').trim());
            }
          }}
          className={`px-2 py-2 rounded border text-[10px] font-bold uppercase tracking-wider transition-colors ${
            dubbingMode === 'narration'
              ? 'border-[var(--accent-border)] bg-[var(--accent-bg)] text-[var(--accent-text)]'
              : 'border-[var(--border-primary)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)]'
          }`}
          disabled={isGeneratingDubbing}
        >
          旁白
        </button>
        <button
          type="button"
          onClick={() => {
            setDubbingMode('dialogue');
            if (!shot.dubbing?.text || dubbingMode !== 'dialogue') {
              setDubbingText((shot.dialogue || '').trim());
            }
          }}
          className={`px-2 py-2 rounded border text-[10px] font-bold uppercase tracking-wider transition-colors ${
            dubbingMode === 'dialogue'
              ? 'border-[var(--accent-border)] bg-[var(--accent-bg)] text-[var(--accent-text)]'
              : 'border-[var(--border-primary)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)]'
          }`}
          disabled={isGeneratingDubbing}
        >
          对话
        </button>
      </div>

      <div className="space-y-2">
        <label className="text-[10px] font-bold text-[var(--text-tertiary)] uppercase tracking-widest block">
          选择配音模型
        </label>
        <select
          value={selectedAudioModelId}
          onChange={(e) => setSelectedAudioModelId(e.target.value)}
          className="w-full bg-[var(--bg-surface)] border border-[var(--border-primary)] text-[var(--text-primary)] text-xs rounded-lg px-3 py-2 outline-none focus:border-[var(--accent)]"
          disabled={isGeneratingDubbing}
        >
          {audioModels.map((model) => (
            <option key={model.id} value={model.id}>
              {model.name}
            </option>
          ))}
        </select>
        <p className="text-[9px] text-[var(--text-muted)]">
          {resolvedDubbingModel
            ? `默认音色 ${resolvedDubbingModel.params.defaultVoice} · 输出 ${resolvedDubbingModel.params.outputFormat}`
            : '请先在模型配置中启用配音模型'}
        </p>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-[10px] font-bold text-[var(--text-tertiary)] uppercase tracking-widest">
            配音文本
          </label>
          <button
            type="button"
            onClick={() => setDubbingText(fallbackDubbingText)}
            className="text-[9px] text-[var(--accent-text)] hover:text-[var(--text-primary)]"
            disabled={isGeneratingDubbing}
          >
            使用建议文本
          </button>
        </div>
        <textarea
          value={dubbingText}
          onChange={(e) => setDubbingText(e.target.value)}
          rows={3}
          placeholder={dubbingMode === 'dialogue' ? '请输入对话文本' : '请输入旁白文本'}
          className="w-full bg-[var(--bg-surface)] border border-[var(--border-primary)] text-[var(--text-primary)] text-xs rounded-lg px-3 py-2 outline-none focus:border-[var(--accent)] resize-y min-h-[72px]"
          disabled={isGeneratingDubbing}
        />
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleGenerateDubbing}
          disabled={!canGenerateDubbing || !audioModels.length}
          className="flex-1 py-2 rounded-lg bg-[var(--accent)] text-[var(--text-primary)] text-[10px] font-bold uppercase tracking-wider hover:bg-[var(--accent-hover)] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {isGeneratingDubbing ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              生成中...
            </>
          ) : (
            <>生成配音</>
          )}
        </button>
        {shot.dubbing && (
          <button
            type="button"
            onClick={onClearDubbing}
            disabled={isGeneratingDubbing}
            className="px-3 py-2 rounded-lg border border-[var(--border-secondary)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] disabled:opacity-50 disabled:cursor-not-allowed"
            title="清除当前配音"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {shot.dubbing?.error && <p className="text-[9px] text-[var(--error-text)]">{shot.dubbing.error}</p>}

      {hasDubbingAudio && (
        <div className="space-y-2">
          <audio src={shot.dubbing?.audioUrl} controls className="w-full" />
          <p className="text-[9px] text-[var(--text-muted)]">配音已生成，可单独预览并用于后续导出。</p>
        </div>
      )}
    </div>
  );
};

export default DubbingPanel;

