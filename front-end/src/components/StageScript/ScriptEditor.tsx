import React from 'react';
import { Plus, RotateCw, BrainCircuit, Wand2, Undo2 } from 'lucide-react';
import { STYLES } from './constants';

interface Props {
  script: string;
  scriptSoftLimit: number;
  scriptHardLimit: number;
  onChange: (value: string) => void;
  onContinue: () => void;
  onRewrite: () => void;
  onSelectionChange: (start: number, end: number) => void;
  selectedText: string;
  rewriteInstruction: string;
  onRewriteInstructionChange: (value: string) => void;
  onRewriteSelection: () => void;
  onUndoRewrite: () => void;
  canUndoRewrite: boolean;
  isContinuing: boolean;
  isRewriting: boolean;
  lastModified?: string;
}

const ScriptEditor: React.FC<Props> = ({
  script,
  scriptSoftLimit,
  scriptHardLimit,
  onChange,
  onContinue,
  onRewrite,
  onSelectionChange,
  selectedText,
  rewriteInstruction,
  onRewriteInstructionChange,
  onRewriteSelection,
  onUndoRewrite,
  canUndoRewrite,
  isContinuing,
  isRewriting,
  lastModified
}) => {
  const stats = {
    characters: script.length,
    lines: script.split('\n').length
  };
  const selectedCount = selectedText.length;
  const selectedPreview = selectedCount > 220
    ? `${selectedText.slice(0, 220)}...`
    : selectedText;
  const scriptLengthStatus: 'normal' | 'warning' | 'error' =
    stats.characters > scriptHardLimit
      ? 'error'
      : stats.characters > scriptSoftLimit
        ? 'warning'
        : 'normal';
  const scriptLimitHint = scriptLengthStatus === 'error'
    ? `超出上限 ${stats.characters}/${scriptHardLimit}，请拆分为多集`
    : scriptLengthStatus === 'warning'
      ? `接近上限 ${stats.characters}/${scriptHardLimit}（建议单集 ≤ ${scriptSoftLimit}）`
      : `建议单集长度 ≤ ${scriptSoftLimit} 字符`;
  const scriptLimitTextClass = scriptLengthStatus === 'error'
    ? 'text-rose-300'
    : scriptLengthStatus === 'warning'
      ? 'text-amber-300'
      : 'text-[var(--text-muted)]';
  const scriptLimitDotClass = scriptLengthStatus === 'error'
    ? 'bg-rose-300'
    : scriptLengthStatus === 'warning'
      ? 'bg-amber-300'
      : 'bg-[var(--border-primary)]';

  const isBusy = isContinuing || isRewriting;
  const isBaseDisabled = isBusy || !script.trim();
  const canRewriteSelection = !isBusy && selectedText.trim().length > 0 && rewriteInstruction.trim().length > 0;
  const canUndo = !isBusy && canUndoRewrite;

  const reportSelection = (target: HTMLTextAreaElement) => {
    onSelectionChange(target.selectionStart ?? 0, target.selectionEnd ?? 0);
  };

  return (
    <div className="flex-1 flex flex-col bg-[var(--bg-base)] relative">
      {/* Header */}
      <div className="h-14 border-b border-[var(--border-primary)] flex items-center justify-between px-8 bg-[var(--bg-base)] shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-1.5 h-1.5 rounded-full bg-[var(--border-secondary)]"></div>
          <span className="text-xs font-bold text-[var(--text-tertiary)]">剧本编辑器</span>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={onContinue}
            disabled={isBaseDisabled}
            className={`px-3 py-1.5 text-xs font-bold rounded-md flex items-center gap-1.5 transition-all shadow-sm ${
              isBaseDisabled
                ? STYLES.button.disabled
                : STYLES.button.primary
            }`}
          >
            {isContinuing ? (
              <>
                <BrainCircuit className="w-3.5 h-3.5 animate-spin" />
                续写中...
              </>
            ) : (
              <>
                <Plus className="w-3.5 h-3.5" />
                AI续写
              </>
            )}
          </button>
          <button
            onClick={onRewrite}
            disabled={isBaseDisabled}
            className={`px-3 py-1.5 text-xs font-bold rounded-md flex items-center gap-1.5 transition-all shadow-sm ${
              isBaseDisabled
                ? STYLES.button.disabled
                : STYLES.button.primary
            }`}
          >
            {isRewriting ? (
              <>
                <BrainCircuit className="w-3.5 h-3.5 animate-spin" />
                改写中...
              </>
            ) : (
              <>
                <RotateCw className="w-3.5 h-3.5" />
                AI改写
              </>
            )}
          </button>
          <button
            onClick={onRewriteSelection}
            disabled={!canRewriteSelection}
            className={`px-3 py-1.5 text-xs font-bold rounded-md flex items-center gap-1.5 transition-all shadow-sm ${
              canRewriteSelection
                ? STYLES.button.primary
                : STYLES.button.disabled
            }`}
          >
            {isRewriting ? (
              <>
                <BrainCircuit className="w-3.5 h-3.5 animate-spin" />
                选段改写中...
              </>
            ) : (
              <>
                <Wand2 className="w-3.5 h-3.5" />
                选段改写
              </>
            )}
          </button>
          <button
            onClick={onUndoRewrite}
            disabled={!canUndo}
            className={`px-3 py-1.5 text-xs font-bold rounded-md flex items-center gap-1.5 transition-all shadow-sm ${
              canUndo
                ? STYLES.button.secondary
                : STYLES.button.disabled
            }`}
          >
            <Undo2 className="w-3.5 h-3.5" />
            撤回改写
          </button>
          <span className="text-[10px] font-mono text-[var(--text-muted)] uppercase tracking-widest">MARKDOWN SUPPORTED</span>
        </div>
      </div>

      {/* Segment Rewrite Controls */}
      <div className="px-8 py-3 border-b border-[var(--border-subtle)] bg-[var(--bg-base)]">
        <div className="flex items-center gap-3">
          <input
            value={rewriteInstruction}
            onChange={(e) => onRewriteInstructionChange(e.target.value)}
            placeholder="输入改写要求，例如：更紧张、增加冲突、对白更口语化..."
            className="flex-1 bg-[var(--bg-surface)] border border-[var(--border-primary)] text-[var(--text-primary)] px-3 py-2 text-sm rounded-md focus:border-[var(--border-secondary)] focus:outline-none transition-all placeholder:text-[var(--text-muted)]"
          />
          <span className="text-xs text-[var(--text-muted)] whitespace-nowrap">
            {selectedCount > 0 ? `已选择 ${selectedCount} 字符` : '请先在下方选择段落'}
          </span>
        </div>
        {selectedCount > 0 && (
          <div className="mt-2 rounded-md border border-amber-500/40 bg-amber-400/10 px-3 py-2">
            <div className="text-[10px] font-mono uppercase tracking-wider text-amber-300 mb-1">
              Locked Selection
            </div>
            <p className="text-xs leading-relaxed text-[var(--text-secondary)] whitespace-pre-wrap max-h-24 overflow-y-auto">
              {selectedPreview}
            </p>
          </div>
        )}
      </div>
      
      {/* Editor Area */}
      <div className="flex-1 overflow-y-auto">
        <div className="w-full max-w-5xl mx-auto h-full flex flex-col py-12 px-8">
          <textarea
            value={script}
            onChange={(e) => onChange(e.target.value)}
            onSelect={(e) => reportSelection(e.currentTarget)}
            onMouseUp={(e) => reportSelection(e.currentTarget)}
            onKeyUp={(e) => reportSelection(e.currentTarget)}
            className="flex-1 bg-transparent text-[var(--text-secondary)] font-serif text-lg leading-loose focus:outline-none resize-none placeholder:text-[var(--text-muted)] selection:bg-[var(--bg-hover)]"
            placeholder="在此输入故事大纲或直接粘贴剧本..."
            spellCheck={false}
          />
        </div>
      </div>

      {/* Status Footer */}
      <div className="h-8 border-t border-[var(--border-subtle)] bg-[var(--bg-base)] px-4 flex items-center justify-between gap-4 text-[10px] font-mono select-none">
        <div className={`flex items-center gap-1.5 ${scriptLimitTextClass}`}>
          <div className={`w-1.5 h-1.5 rounded-full ${scriptLimitDotClass}`}></div>
          <span>{scriptLimitHint}</span>
        </div>
        <div className="flex items-center gap-4 text-[var(--text-muted)]">
          <span>{stats.characters} 字符</span>
          <span>{stats.lines} 行</span>
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-[var(--border-primary)]"></div>
            {lastModified ? '已自动保存' : '准备就绪'}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ScriptEditor;
