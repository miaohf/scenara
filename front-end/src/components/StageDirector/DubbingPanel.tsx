import React, { useEffect, useMemo, useState } from 'react';
import { Mic, Loader2, Trash2 } from 'lucide-react';
import { Character, Shot, DubbingMode } from '../../types';
import { getAudioModels, getActiveAudioModel } from '../../services/modelRegistry';
import { AudioModelDefinition } from '../../types/model';
import { useInterfaceLanguage } from '../../contexts/InterfaceLanguageContext';

interface DubbingPanelProps {
  shot: Shot;
  voiceCharacters?: Pick<Character, 'id' | 'name'>[];
  onGenerateDubbing: (mode: DubbingMode, text: string, modelId?: string, speakerId?: string) => void;
  onClearDubbing: () => void;
}

const DubbingPanel: React.FC<DubbingPanelProps> = ({ shot, voiceCharacters = [], onGenerateDubbing, onClearDubbing }) => {
  const { text } = useInterfaceLanguage();
  const audioModels = getAudioModels().filter((m) => m.isEnabled);
  const activeAudioModel = getActiveAudioModel();

  const [dubbingMode, setDubbingMode] = useState<DubbingMode>(shot.dubbing?.mode || 'narration');
  const [selectedAudioModelId, setSelectedAudioModelId] = useState<string>(
    shot.dubbing?.modelId || activeAudioModel?.id || audioModels[0]?.id || 'gpt-audio-1.5'
  );
  const [dubbingText, setDubbingText] = useState<string>(shot.dubbing?.text || '');
  const [selectedSpeakerId, setSelectedSpeakerId] = useState<string>(shot.dubbing?.speakerId || '');

  const isGeneratingDubbing = shot.dubbing?.status === 'generating';
  const hasDubbingAudio = !!shot.dubbing?.audioUrl;
  const resolvedDubbingModel = audioModels.find((m) => m.id === selectedAudioModelId) as AudioModelDefinition | undefined;
  const fallbackDubbingText = useMemo(
    // 动作描述是画面指令，不能默认当作旁白；无明确台词时由 H3 生成环境声。
    () => (dubbingMode === 'dialogue' ? (shot.dialogue || '') : '').trim(),
    [dubbingMode, shot.dialogue]
  );
  const canGenerateDubbing = dubbingText.trim().length > 0 && !!selectedAudioModelId && !isGeneratingDubbing;

  useEffect(() => {
    const initialMode = shot.dubbing?.mode || 'narration';
    const initialModelId = shot.dubbing?.modelId || activeAudioModel?.id || audioModels[0]?.id || 'gpt-audio-1.5';
    const initialText = (shot.dubbing?.text || (initialMode === 'dialogue' ? shot.dialogue : '') || '').trim();
    setDubbingMode(initialMode);
    setSelectedAudioModelId(initialModelId);
    setDubbingText(initialText);
    setSelectedSpeakerId(shot.dubbing?.speakerId || '');
  }, [shot.id, shot.dubbing?.speakerId, activeAudioModel?.id]);

  const handleGenerateDubbing = () => {
    if (!canGenerateDubbing) return;
    onGenerateDubbing(dubbingMode, dubbingText.trim(), selectedAudioModelId, selectedSpeakerId || undefined);
  };

  return (
    <div className="mt-3 rounded-xl border border-[var(--border-primary)] bg-[var(--bg-surface)] p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h5 className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-tertiary)] flex items-center gap-2">
          <Mic className="w-3 h-3 text-[var(--accent)]" />
          {text('配音模块', 'Dubbing')}
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
              setDubbingText('');
            }
          }}
          className={`px-2 py-2 rounded border text-[10px] font-bold uppercase tracking-wider transition-colors ${
            dubbingMode === 'narration'
              ? 'border-[var(--accent-border)] bg-[var(--accent-bg)] text-[var(--accent-text)]'
              : 'border-[var(--border-primary)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)]'
          }`}
          disabled={isGeneratingDubbing}
        >
          {text('旁白', 'Narration')}
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
          {text('对话', 'Dialogue')}
        </button>
      </div>

      <div className="space-y-2">
        {dubbingMode === 'dialogue' && voiceCharacters.length > 0 && (
          <>
            <label className="text-[10px] font-bold text-[var(--text-tertiary)] uppercase tracking-widest block">
              {text('说话角色', 'Speaker')}
            </label>
            <select
              value={selectedSpeakerId}
              onChange={(e) => setSelectedSpeakerId(e.target.value)}
              className="w-full bg-[var(--bg-surface)] border border-[var(--border-primary)] text-[var(--text-primary)] text-xs rounded-lg px-3 py-2 outline-none focus:border-[var(--accent)]"
              disabled={isGeneratingDubbing}
            >
              <option value="">{text('自动识别声音角色', 'Auto-detect speaker')}</option>
              {voiceCharacters.map((character) => (
                <option key={character.id} value={character.id}>
                  {character.name}
                </option>
              ))}
            </select>
            <p className="text-[9px] text-[var(--text-muted)]">
              {text('该角色名会写入 H3 原生音频提示词；不会作为画面角色加入参考图。', 'The speaker name is added to the H3 audio prompt; it is not added as a visual reference character.')}
            </p>
          </>
        )}
        <label className="text-[10px] font-bold text-[var(--text-tertiary)] uppercase tracking-widest block">
          {text('选择配音模型', 'Select voice model')}
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
            ? text(`默认音色 ${resolvedDubbingModel.params.defaultVoice} · 输出 ${resolvedDubbingModel.params.outputFormat}`, `Default voice ${resolvedDubbingModel.params.defaultVoice} · Output ${resolvedDubbingModel.params.outputFormat}`)
            : text('请先在模型配置中启用配音模型', 'Enable an audio model in Model Configuration first')}
        </p>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-[10px] font-bold text-[var(--text-tertiary)] uppercase tracking-widest">
            {text('配音文本', 'Voiceover text')}
          </label>
          <button
            type="button"
            onClick={() => setDubbingText(fallbackDubbingText)}
            className="text-[9px] text-[var(--accent-text)] hover:text-[var(--text-primary)]"
            disabled={isGeneratingDubbing}
          >
            {text('使用建议文本', 'Use suggested text')}
          </button>
        </div>
        <textarea
          value={dubbingText}
          onChange={(e) => setDubbingText(e.target.value)}
          rows={3}
          placeholder={dubbingMode === 'dialogue' ? text('请输入对话文本', 'Enter dialogue text') : text('请输入旁白文本', 'Enter narration text')}
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
              {text('生成中...', 'Generating...')}
            </>
          ) : (
            <>{text('生成配音', 'Generate voiceover')}</>
          )}
        </button>
        {shot.dubbing && (
          <button
            type="button"
            onClick={onClearDubbing}
            disabled={isGeneratingDubbing}
            className="px-3 py-2 rounded-lg border border-[var(--border-secondary)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] disabled:opacity-50 disabled:cursor-not-allowed"
            title={text('清除当前配音', 'Clear current voiceover')}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {shot.dubbing?.error && <p className="text-[9px] text-[var(--error-text)]">{shot.dubbing.error}</p>}

      {hasDubbingAudio && (
        <div className="space-y-2">
          <audio src={shot.dubbing?.audioUrl} controls className="w-full" />
          <p className="text-[9px] text-[var(--text-muted)]">{text('配音已生成，可单独预览并用于后续导出。', 'Voiceover generated. Preview it separately or use it in the final export.')}</p>
        </div>
      )}
    </div>
  );
};

export default DubbingPanel;
