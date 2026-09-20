import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Edit3, Save, AlertCircle, Camera, RefreshCw, Copy, Check } from 'lucide-react';
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

/** 图标悬停提示延迟（比浏览器原生 title 更晚弹出） */
const HOVER_TIP_DELAY_MS = 2200;
/** 提示词大号预览延迟 */
const PREVIEW_DELAY_MS = 2500;

interface HoverTipButtonProps {
  tip: string;
  ariaLabel: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}

const HoverTipButton: React.FC<HoverTipButtonProps> = ({
  tip,
  ariaLabel,
  onClick,
  disabled,
  children,
}) => {
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  const clearTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const hide = () => {
    clearTimer();
    setVisible(false);
  };

  const showSoon = () => {
    clearTimer();
    timerRef.current = setTimeout(() => {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) return;
      setPosition({
        left: rect.left + rect.width / 2,
        top: rect.top - 8,
      });
      setVisible(true);
    }, HOVER_TIP_DELAY_MS);
  };

  useEffect(() => () => clearTimer(), []);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={onClick}
        disabled={disabled}
        onMouseEnter={showSoon}
        onMouseLeave={hide}
        onFocus={showSoon}
        onBlur={hide}
        className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors p-1 hover:bg-[var(--bg-hover)] rounded disabled:opacity-40 disabled:cursor-not-allowed"
        aria-label={ariaLabel}
      >
        {children}
      </button>
      {visible && tip && typeof document !== 'undefined' && createPortal(
        <div
          role="tooltip"
          className="pointer-events-none fixed z-[110] max-w-[240px] -translate-x-1/2 -translate-y-full rounded-md border border-[var(--border-secondary)] bg-[var(--bg-elevated)] px-2 py-1.5 text-[10px] leading-snug text-[var(--text-secondary)] shadow-lg"
          style={{ left: position.left, top: position.top }}
        >
          {tip}
        </div>,
        document.body,
      )}
    </>
  );
};

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
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'failed'>('idle');
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copyResetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    previewTimer.current = setTimeout(() => setIsPreviewOpen(true), PREVIEW_DELAY_MS);
  };

  useEffect(() => () => {
    clearPreviewTimer();
    if (copyResetTimer.current) clearTimeout(copyResetTimer.current);
  }, []);

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

  const handleCopyPrompt = async () => {
    const content = (prompt || '').trim();
    if (!content) {
      setCopyStatus('failed');
      return;
    }

    if (copyResetTimer.current) {
      clearTimeout(copyResetTimer.current);
      copyResetTimer.current = null;
    }

    const markResult = (ok: boolean) => {
      setCopyStatus(ok ? 'copied' : 'failed');
      copyResetTimer.current = setTimeout(() => {
        setCopyStatus('idle');
        copyResetTimer.current = null;
      }, ok ? 1800 : 2800);
    };

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(content);
        markResult(true);
        return;
      }
    } catch {
      // fall through
    }

    try {
      const helper = document.createElement('textarea');
      helper.value = content;
      helper.setAttribute('readonly', '');
      helper.style.position = 'fixed';
      helper.style.left = '-9999px';
      document.body.appendChild(helper);
      helper.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(helper);
      markResult(ok);
    } catch {
      markResult(false);
    }
  };

  const copyTip = copyStatus === 'copied'
    ? text('已复制', 'Copied')
    : copyStatus === 'failed'
      ? text('复制失败', 'Copy failed')
      : text('复制提示词', 'Copy prompt');

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
              <HoverTipButton
                tip={text('重新生成提示词（按当前项目风格，不会自动生图）', 'Regenerate the prompt in the current project style without generating an image')}
                ariaLabel={text('重新生成提示词', 'Regenerate prompt')}
                onClick={() => onRegenerate()}
                disabled={isRegenerating}
              >
                <RefreshCw className={`w-3 h-3 ${isRegenerating ? 'animate-spin' : ''}`} />
              </HoverTipButton>
            )}
            <HoverTipButton
              tip={copyTip}
              ariaLabel={text('复制提示词', 'Copy prompt')}
              onClick={() => void handleCopyPrompt()}
              disabled={!prompt?.trim() || isRegenerating}
            >
              {copyStatus === 'copied' ? <Check className="w-3 h-3 text-[var(--success)]" /> : <Copy className="w-3 h-3" />}
            </HoverTipButton>
            <HoverTipButton
              tip={text('手工改写提示词', 'Edit prompt manually')}
              ariaLabel={text('手工改写提示词', 'Edit prompt manually')}
              onClick={handleStartEdit}
              disabled={isRegenerating}
            >
              <Edit3 className="w-3 h-3" />
            </HoverTipButton>
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
          className="fixed z-[100] rounded-xl border border-sky-300/60 bg-slate-100 shadow-2xl"
          style={{ left: previewPosition.left, top: previewPosition.top, width: previewPosition.width }}
          onMouseEnter={clearPreviewTimer}
          onMouseLeave={closePreviewSoon}
          role="dialog"
          aria-label={resolvedLabel}
        >
          <div className="max-h-[60vh] overflow-y-auto px-5 py-4">
            <p className="whitespace-pre-wrap break-words text-sm leading-7 text-slate-800 font-mono">
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
