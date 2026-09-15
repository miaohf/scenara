import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Edit3, Save, AlertCircle, Camera, RefreshCw } from 'lucide-react';
import { useInterfaceLanguage } from '../../contexts/InterfaceLanguageContext';

interface PromptEditorProps {
  prompt: string;
  onSave: (newPrompt: string) => void;
  onRegenerate?: () => void;
  isRegenerating?: boolean;
  label?: string;
  placeholder?: string;
  maxHeight?: string;
}

const PromptEditor: React.FC<PromptEditorProps> = ({
  prompt,
  onSave,
  onRegenerate,
  isRegenerating = false,
  label,
  placeholder,
  maxHeight = 'max-h-[180px]',
}) => {
  const { text } = useInterfaceLanguage();
  const resolvedLabel = label || text('提示词', 'Prompt');
  const resolvedPlaceholder = placeholder || text('输入视觉描述...', 'Enter a visual description...');
  const [isEditing, setIsEditing] = useState(false);
  const [editedPrompt, setEditedPrompt] = useState(prompt);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [previewPosition, setPreviewPosition] = useState({ left: 16, top: 16, width: 640 });
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearPreviewTimer = () => {
    if (previewTimer.current) {
      clearTimeout(previewTimer.current);
      previewTimer.current = null;
    }
  };

  const closePreviewSoon = () => {
    clearPreviewTimer();
    previewTimer.current = setTimeout(() => setIsPreviewOpen(false), 120);
  };

  const openPreviewSoon = (element: HTMLElement) => {
    if (!prompt || isEditing) return;
    clearPreviewTimer();
    const rect = element.getBoundingClientRect();
    const viewportPadding = 16;
    const width = Math.min(680, window.innerWidth - viewportPadding * 2);
    const left = Math.min(
      Math.max(viewportPadding, rect.left),
      window.innerWidth - width - viewportPadding,
    );
    const estimatedHeight = Math.min(460, window.innerHeight * 0.6);
    const top = rect.bottom + 10 + estimatedHeight <= window.innerHeight - viewportPadding
      ? rect.bottom + 10
      : Math.max(viewportPadding, rect.top - estimatedHeight - 10);
    setPreviewPosition({ left, top, width });
    previewTimer.current = setTimeout(() => setIsPreviewOpen(true), 1200);
  };

  useEffect(() => () => clearPreviewTimer(), []);

  useEffect(() => {
    if (!isPreviewOpen) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsPreviewOpen(false);
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [isPreviewOpen]);

  const handleStartEdit = () => {
    clearPreviewTimer();
    setIsPreviewOpen(false);
    setIsEditing(true);
    setEditedPrompt(prompt || '');
  };

  const handleSave = () => {
    onSave(editedPrompt.trim());
    setIsEditing(false);
  };

  const handleCancel = () => {
    setIsEditing(false);
    setEditedPrompt(prompt || '');
  };

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between mb-2 gap-2">
        <label className="text-[10px] font-bold text-[var(--text-tertiary)] uppercase tracking-widest flex items-center gap-1.5">
          <Camera className="w-3 h-3" />
          {resolvedLabel}
        </label>
        {!isEditing && (
          <div className="flex items-center gap-0.5 shrink-0">
            {onRegenerate && (
              <button
                onClick={onRegenerate}
                disabled={isRegenerating}
                className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors p-1 hover:bg-[var(--bg-hover)] rounded disabled:opacity-40 disabled:cursor-not-allowed"
                title={text('重新生成提示词（按当前项目风格，不会自动生图）', 'Regenerate the prompt in the current project style without generating an image')}
                aria-label={text('重新生成提示词', 'Regenerate prompt')}
              >
                <RefreshCw className={`w-3 h-3 ${isRegenerating ? 'animate-spin' : ''}`} />
              </button>
            )}
            <button
              onClick={handleStartEdit}
              disabled={isRegenerating}
              className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors p-1 hover:bg-[var(--bg-hover)] rounded disabled:opacity-40"
              title={text('手工改写提示词', 'Edit prompt manually')}
              aria-label={text('手工改写提示词', 'Edit prompt manually')}
            >
              <Edit3 className="w-3 h-3" />
            </button>
          </div>
        )}
      </div>

      {isEditing ? (
        <div className="flex-1 flex flex-col gap-2">
          <textarea
            value={editedPrompt}
            onChange={(e) => setEditedPrompt(e.target.value)}
            className={`flex-1 bg-[var(--bg-base)] border border-[var(--accent)] text-[var(--text-primary)] px-3 py-2 text-xs rounded-lg focus:outline-none focus:ring-1 focus:ring-[var(--accent)] resize-none font-mono leading-relaxed min-h-[140px] ${maxHeight}`}
            placeholder={resolvedPlaceholder}
            autoFocus
          />
          <div className="flex gap-2">
            <button
              onClick={handleSave}
              className="flex-1 py-1.5 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--text-primary)] rounded text-[10px] font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 transition-colors"
            >
              <Save className="w-3 h-3" />
              {text('保存', 'Save')}
            </button>
            <button
              onClick={handleCancel}
              className="flex-1 py-1.5 bg-[var(--bg-hover)] hover:bg-[var(--border-secondary)] text-[var(--text-secondary)] rounded text-[10px] font-bold uppercase tracking-wider transition-colors"
            >
              {text('取消', 'Cancel')}
            </button>
          </div>
        </div>
      ) : (
        <div
          className={`relative flex-1 bg-[var(--nav-hover-bg)] border border-[var(--border-primary)] rounded-lg p-3 overflow-y-auto ${maxHeight}`}
          onMouseEnter={(event) => openPreviewSoon(event.currentTarget)}
          onMouseLeave={closePreviewSoon}
          onFocus={(event) => openPreviewSoon(event.currentTarget)}
          onBlur={closePreviewSoon}
          tabIndex={prompt ? 0 : -1}
          aria-label={prompt ? text('悬停查看大号提示词预览', 'Hover to preview prompt') : undefined}
        >
          {prompt ? (
            <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed font-mono">
              {prompt}
            </p>
          ) : (
            <div className="flex items-start gap-2 text-[var(--text-muted)]">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <p className="text-[10px] leading-relaxed">
                {text('未设置提示词。可点刷新图标自动生成，或点编辑图标手工填写。', 'No prompt yet. Use refresh to generate one, or edit it manually.')}
              </p>
            </div>
          )}
        </div>
      )}

      {isPreviewOpen && prompt && typeof document !== 'undefined' && createPortal(
        <div
          className="fixed z-[100] rounded-xl border border-[var(--border-secondary)] border-t-2 border-t-[var(--accent)] bg-[var(--bg-deep)] shadow-2xl"
          style={{ left: previewPosition.left, top: previewPosition.top, width: previewPosition.width }}
          onMouseEnter={clearPreviewTimer}
          onMouseLeave={closePreviewSoon}
          role="dialog"
          aria-label={resolvedLabel}
        >
          <div className="flex items-center justify-between gap-3 border-b border-[var(--border-secondary)] bg-[var(--bg-elevated)] px-4 py-2.5">
            <span className="text-xs font-bold uppercase tracking-widest text-[var(--accent-text)]">
              {resolvedLabel}
            </span>
            <button
              type="button"
              onClick={handleStartEdit}
              className="rounded-md px-2.5 py-1 text-xs font-bold text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
            >
              {text('编辑', 'Edit')}
            </button>
          </div>
          <div className="max-h-[60vh] overflow-y-auto px-4 py-3">
            <p className="whitespace-pre-wrap break-words text-sm leading-7 text-[var(--text-primary)] font-mono">
              {prompt}
            </p>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
};

export default PromptEditor;
