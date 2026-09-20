import React, { useEffect, useMemo, useRef, useState } from 'react';
import { X, Edit2, Check, Sparkles, Loader2, RefreshCw, Copy, CheckCheck } from 'lucide-react';
import { useInterfaceLanguage } from '../../contexts/InterfaceLanguageContext';
import {
  detectComfyUiPromptWorkflowKind,
  toComfyUiPastePrompt,
} from '../../services/ai/comfyUiPromptExport';

export interface EditModalReferencePreview {
  image: string;
  label: string;
}

type PromptViewMode = 'scenara' | 'comfyui';

interface EditModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: () => void;
  title: string;
  icon?: React.ReactNode;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  textareaClassName?: string;
  showAIGenerate?: boolean;
  onAIGenerate?: () => Promise<void>;
  isAIGenerating?: boolean;
  aiInstruction?: string;
  onAIInstructionChange?: (value: string) => void;
  aiInstructionPlaceholder?: string;
  /** 按当前镜头/资产重新编译提示词（非 LLM 改写） */
  showRebuildPrompt?: boolean;
  onRebuildPrompt?: () => void | Promise<void>;
  isRebuildingPrompt?: boolean;
  rebuildPromptLabel?: string;
  /** 视频提示词：提供 Scenara / ComfyUI 粘贴视图切换 */
  enableComfyUiExport?: boolean;
  referencePreviews?: EditModalReferencePreview[];
}

const EditModal: React.FC<EditModalProps> = ({
  isOpen,
  onClose,
  onSave,
  title,
  icon,
  value,
  onChange,
  placeholder,
  textareaClassName = 'font-normal',
  showAIGenerate = false,
  onAIGenerate,
  isAIGenerating = false,
  aiInstruction = '',
  onAIInstructionChange,
  aiInstructionPlaceholder,
  showRebuildPrompt = false,
  onRebuildPrompt,
  isRebuildingPrompt = false,
  rebuildPromptLabel,
  enableComfyUiExport = false,
  referencePreviews = [],
}) => {
  const { text } = useInterfaceLanguage();
  const modalRef = useRef<HTMLDivElement>(null);
  const interactionRef = useRef<{
    kind: 'move' | 'resize';
    startX: number;
    startY: number;
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);
  const [bounds, setBounds] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const [viewMode, setViewMode] = useState<PromptViewMode>('scenara');
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'failed'>('idle');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const copyResetTimerRef = useRef<number | null>(null);
  const resolvedPlaceholder = placeholder || text('输入内容...', 'Enter content...');
  const resolvedAiInstructionPlaceholder = aiInstructionPlaceholder || text(
    '可选：输入你希望 AI 调整或强化的要求（如节奏、情绪、动作重点）',
    'Optional: describe what AI should adjust or strengthen, such as pacing, mood, or action focus.',
  );
  const resolvedRebuildLabel = rebuildPromptLabel || text('按当前镜头重新编译', 'Rebuild from shot');
  const comfyUiPrompt = useMemo(
    () => (enableComfyUiExport ? toComfyUiPastePrompt(value) : ''),
    [enableComfyUiExport, value],
  );
  const workflowKind = useMemo(
    () => (enableComfyUiExport ? detectComfyUiPromptWorkflowKind(comfyUiPrompt || value) : 'unknown'),
    [enableComfyUiExport, comfyUiPrompt, value],
  );
  const displayValue = enableComfyUiExport && viewMode === 'comfyui' ? comfyUiPrompt : value;
  const promptReferenceCount = Math.max(
    0,
    ...Array.from(displayValue.matchAll(/^\s*-?\s*Image\s+(\d+)\b/gim), (match) => Number(match[1]) || 0),
    ...Array.from(displayValue.matchAll(/<Picture\s+(\d+)>/gi), (match) => Number(match[1]) || 0),
    // FLF2V base skill 常用裸写 "Picture 1" / "Picture 2"，不一定带尖括号。
    ...Array.from(displayValue.matchAll(/\bPicture\s+(\d+)\b/gi), (match) => Number(match[1]) || 0),
  );
  // 提示词里没有 Image/Picture N 时仍展示全部参考图，便于核对九宫格等未写进正文映射的场景。
  const visibleReferencePreviews = promptReferenceCount > 0
    ? referencePreviews.slice(0, promptReferenceCount)
    : referencePreviews;
  const usesPictureLabel = /<Picture\s+\d+>/i.test(displayValue) || /\bPicture\s+\d+\b/i.test(displayValue);
  const busy = isAIGenerating || isRebuildingPrompt;
  const isComfyUiView = enableComfyUiExport && viewMode === 'comfyui';
  const workflowKindLabel =
    workflowKind === 'ref2va'
      ? 'Ref2VA'
      : workflowKind === 'flf2v'
        ? 'FLF2V'
        : text('通用', 'Generic');

  useEffect(() => {
    if (!isOpen) return;
    setViewMode('scenara');
    setCopyStatus('idle');
    if (copyResetTimerRef.current) {
      window.clearTimeout(copyResetTimerRef.current);
      copyResetTimerRef.current = null;
    }
    return () => {
      if (copyResetTimerRef.current) {
        window.clearTimeout(copyResetTimerRef.current);
        copyResetTimerRef.current = null;
      }
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isComfyUiView) return;
    const node = textareaRef.current;
    if (!node) return;
    // 粘贴版进入时全选，方便 Ctrl/Cmd+C，也避免只能依赖 Clipboard API。
    window.requestAnimationFrame(() => {
      node.focus();
      node.select();
    });
  }, [isComfyUiView, comfyUiPrompt]);

  useEffect(() => {
    if (!isOpen || typeof window === 'undefined') return;
    const margin = 28;
    const width = Math.min(1440, window.innerWidth - margin * 2);
    const height = Math.min(900, window.innerHeight - margin * 2);
    setBounds({
      left: Math.max(margin, Math.round((window.innerWidth - width) / 2)),
      top: Math.max(margin, Math.round((window.innerHeight - height) / 2)),
      width,
      height,
    });
  }, [isOpen]);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const interaction = interactionRef.current;
      if (!interaction) return;
      const deltaX = event.clientX - interaction.startX;
      const deltaY = event.clientY - interaction.startY;
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const margin = 16;
      if (interaction.kind === 'move') {
        setBounds({
          left: Math.min(viewportWidth - 160, Math.max(-interaction.width + 160, interaction.left + deltaX)),
          top: Math.min(viewportHeight - 48, Math.max(0, interaction.top + deltaY)),
          width: interaction.width,
          height: interaction.height,
        });
      } else {
        setBounds({
          left: interaction.left,
          top: interaction.top,
          width: Math.min(viewportWidth - interaction.left - margin, Math.max(640, interaction.width + deltaX)),
          height: Math.min(viewportHeight - interaction.top - margin, Math.max(480, interaction.height + deltaY)),
        });
      }
    };
    const stopInteraction = () => { interactionRef.current = null; };
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', stopInteraction);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', stopInteraction);
    };
  }, []);

  const beginInteraction = (event: React.PointerEvent, kind: 'move' | 'resize') => {
    const rect = modalRef.current?.getBoundingClientRect();
    if (!rect || event.button !== 0) return;
    event.preventDefault();
    interactionRef.current = {
      kind,
      startX: event.clientX,
      startY: event.clientY,
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
    };
  };
  if (!isOpen) return null;

  const handleAIGenerate = async () => {
    if (onAIGenerate && !isAIGenerating) {
      await onAIGenerate();
    }
  };

  const handleRebuildPrompt = async () => {
    if (onRebuildPrompt && !busy) {
      await onRebuildPrompt();
    }
  };

  const handleCopyComfyUiPrompt = async () => {
    const content = comfyUiPrompt.trim();
    if (!content) {
      setCopyStatus('failed');
      return;
    }

    if (copyResetTimerRef.current) {
      window.clearTimeout(copyResetTimerRef.current);
      copyResetTimerRef.current = null;
    }

    const markResult = (ok: boolean) => {
      setCopyStatus(ok ? 'copied' : 'failed');
      copyResetTimerRef.current = window.setTimeout(() => {
        setCopyStatus('idle');
        copyResetTimerRef.current = null;
      }, ok ? 2000 : 3200);
    };

    const copyViaTextarea = (): boolean => {
      const node = textareaRef.current;
      if (node) {
        node.focus();
        node.select();
        try {
          return document.execCommand('copy');
        } catch {
          // fall through to off-DOM textarea
        }
      }

      const helper = document.createElement('textarea');
      helper.value = content;
      helper.setAttribute('readonly', '');
      helper.style.position = 'fixed';
      helper.style.left = '-9999px';
      helper.style.top = '0';
      document.body.appendChild(helper);
      helper.focus();
      helper.select();
      helper.setSelectionRange(0, helper.value.length);
      let ok = false;
      try {
        ok = document.execCommand('copy');
      } catch {
        ok = false;
      }
      document.body.removeChild(helper);
      return ok;
    };

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(content);
        markResult(true);
        textareaRef.current?.focus();
        textareaRef.current?.select();
        return;
      }
    } catch {
      // Clipboard API often blocked in embedded browsers; use fallback.
    }

    markResult(copyViaTextarea());
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-[var(--overlay-heavy)] backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        ref={modalRef}
        style={bounds
          ? { left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height }
          : { left: '3vw', top: '3vh', width: '94vw', height: '92vh' }}
        className="fixed flex flex-col gap-4 bg-[var(--bg-elevated)] border border-[var(--border-secondary)] rounded-xl p-6 overflow-hidden shadow-2xl animate-in fade-in duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-center justify-between cursor-move select-none"
          onPointerDown={(event) => {
            if ((event.target as HTMLElement).closest('button')) return;
            beginInteraction(event, 'move');
          }}
        >
          <h3 className="text-[var(--text-primary)] font-bold flex items-center gap-2">
            {icon || <Edit2 className="w-4 h-4 text-[var(--accent-text)]" />}
            {title}
          </h3>
          <button
            onClick={onClose}
            className="p-2 hover:bg-[var(--bg-hover)] rounded text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {enableComfyUiExport && (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex rounded-lg border border-[var(--border-primary)] p-0.5 bg-[var(--bg-base)]">
                <button
                  type="button"
                  onClick={() => setViewMode('scenara')}
                  className={`px-3 py-1.5 rounded-md text-xs font-bold transition-colors ${
                    viewMode === 'scenara'
                      ? 'bg-[var(--btn-selected-bg)] text-[var(--btn-selected-text)]'
                      : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  {text('Scenara 编辑版', 'Scenara edit')}
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('comfyui')}
                  className={`px-3 py-1.5 rounded-md text-xs font-bold transition-colors ${
                    viewMode === 'comfyui'
                      ? 'bg-[var(--btn-selected-bg)] text-[var(--btn-selected-text)]'
                      : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  {text('ComfyUI 粘贴版', 'ComfyUI paste')}
                </button>
              </div>
              <span className="px-2 py-1 rounded border border-[var(--border-primary)] text-[10px] font-mono text-[var(--text-secondary)]">
                {workflowKindLabel}
              </span>
            </div>
            <p className="text-[10px] leading-relaxed text-[var(--text-muted)]">
              {isComfyUiView
                ? text(
                    `已剥离 Scenara 策略块，保留 ${workflowKindLabel} 官方 skill 字段。文本已自动全选，可点下方「复制到剪贴板」，或直接 Ctrl/Cmd+C。请在 ComfyUI 中自行加载对应首尾帧/参考图。`,
                    `Scenara policy blocks removed; official ${workflowKindLabel} skill fields kept. Text is auto-selected — use Copy below or Ctrl/Cmd+C. Load matching frames/references in ComfyUI.`,
                  )
                : text(
                    '编辑版可保存；切换到 ComfyUI 粘贴版可复制到工作流提示词节点（支持 FLF2V / Ref2VA）。',
                    'Edit and save here; switch to ComfyUI paste view to copy into the workflow prompt node (FLF2V / Ref2VA).',
                  )}
            </p>
            {isComfyUiView && copyStatus === 'failed' && (
              <p className="text-[10px] text-[var(--error-text)]">
                {text('自动复制失败：文本已全选，请按 Ctrl/Cmd+C 手动复制。', 'Auto-copy failed. Text is selected — press Ctrl/Cmd+C.')}
              </p>
            )}
          </div>
        )}

        {showAIGenerate && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <button
                onClick={handleAIGenerate}
                disabled={busy || isComfyUiView}
                className={`flex-1 px-4 py-2.5 rounded-lg text-sm font-bold transition-all flex items-center justify-center gap-2 ${
                  busy || isComfyUiView
                    ? 'bg-[var(--border-secondary)] text-[var(--text-tertiary)] cursor-not-allowed'
                    : 'bg-[var(--btn-primary-bg)] text-[var(--btn-primary-text)] hover:bg-[var(--btn-primary-hover)] shadow-lg'
                }`}
              >
                {isAIGenerating ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    {text('AI 正在生成动作建议...', 'AI is generating action suggestions...')}
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    {text('AI 生成动作建议', 'Generate action suggestions')}
                  </>
                )}
              </button>
            </div>

            {onAIInstructionChange && (
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-[var(--text-secondary)]">
                  {text('用户修改要求（可选）', 'Revision request (optional)')}
                </label>
                <input
                  type="text"
                  value={aiInstruction}
                  onChange={(e) => onAIInstructionChange(e.target.value)}
                  placeholder={resolvedAiInstructionPlaceholder}
                  disabled={busy || isComfyUiView}
                  className="w-full bg-[var(--bg-base)] text-[var(--text-primary)] border border-[var(--border-secondary)] rounded-lg px-3 py-2 text-sm outline-none focus:border-[var(--accent-primary)] transition-colors disabled:opacity-50"
                />
              </div>
            )}
          </div>
        )}

        <div className={`grid flex-1 gap-4 min-h-0 ${visibleReferencePreviews.length ? 'lg:grid-cols-[minmax(0,1fr)_15rem]' : ''}`}>
          <textarea
            ref={textareaRef}
            value={displayValue}
            onChange={(e) => {
              if (isComfyUiView) return;
              onChange(e.target.value);
            }}
            readOnly={isComfyUiView}
            className={`w-full h-full min-h-0 bg-[var(--bg-base)] text-[var(--text-primary)] border border-[var(--border-secondary)] rounded-lg p-4 text-sm leading-6 outline-none focus:border-[var(--border-secondary)] transition-colors resize-none ${textareaClassName} ${
              isComfyUiView ? 'cursor-text opacity-95' : ''
            }`}
            placeholder={resolvedPlaceholder}
            autoFocus={!isComfyUiView}
            disabled={busy}
          />

          {visibleReferencePreviews.length > 0 && (
            <aside className="h-full min-h-0 border border-[var(--border-primary)] bg-[var(--bg-base)] rounded-lg p-3 overflow-y-auto">
              <p className="text-[10px] uppercase tracking-widest font-bold text-[var(--text-tertiary)]">
                {text('参考图片', 'Reference images')}
              </p>
              <p className="mt-1 text-[10px] leading-4 text-[var(--text-muted)]">
                {text('悬停对应的 Image / Picture 行以预览。', 'Hover an Image/Picture row to preview it.')}
              </p>
              <div className="mt-3 space-y-1.5">
                {visibleReferencePreviews.map((reference, index) => {
                  const imageLine = displayValue.split(/\r?\n/).find((line) =>
                    new RegExp(`^\\s*-?\\s*Image\\s+${index + 1}\\b`, 'i').test(line)
                    || new RegExp(`<Picture\\s+${index + 1}>`, 'i').test(line)
                    || new RegExp(`\\bPicture\\s+${index + 1}\\b`, 'i').test(line)
                  );
                  const fromPrompt = imageLine
                    ?.replace(/^\s*-?\s*Image\s+\d+\s*[—–-]?\s*/i, '')
                    .replace(new RegExp(`.*<Picture\\s+${index + 1}>\\s*`, 'i'), '')
                    .replace(new RegExp(`.*?\\bPicture\\s+${index + 1}\\b\\s*`, 'i'), '')
                    .trim() || '';
                  const displayLabel =
                    fromPrompt
                    && fromPrompt.length <= 48
                    && !/aligns with|fully referenced|is the environment|is a storyboard/i.test(fromPrompt)
                      ? fromPrompt
                      : reference.label;
                  return (
                    <div key={`${reference.image}-${index}`} className="group relative">
                      <div className="flex items-center gap-2 rounded-md border border-transparent px-2 py-1.5 text-left text-[11px] text-[var(--text-secondary)] hover:border-[var(--accent)]/50 hover:bg-[var(--bg-hover)] cursor-help">
                        <span className="shrink-0 font-mono text-[var(--accent-text)]">
                          {usesPictureLabel ? `Picture ${index + 1}` : `Image ${index + 1}`}
                        </span>
                        <span className="truncate" title={fromPrompt || reference.label}>
                          {displayLabel}
                        </span>
                      </div>
                      <div className="pointer-events-none absolute right-0 top-full z-20 mt-1 hidden w-64 rounded-lg border border-[var(--border-secondary)] bg-[var(--bg-elevated)] p-2 shadow-2xl group-hover:block">
                        <img src={reference.image} alt={`Image ${index + 1}: ${reference.label}`} className="h-44 w-full rounded object-contain bg-black/20" />
                        <p className="mt-2 truncate text-[11px] text-[var(--text-secondary)]">{reference.label}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </aside>
          )}
        </div>

        <div className="flex shrink-0 justify-between gap-3">
          <div className="flex gap-2">
            {showRebuildPrompt && onRebuildPrompt && (
              <button
                onClick={handleRebuildPrompt}
                disabled={busy || isComfyUiView}
                className="px-4 py-2 bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:bg-[var(--border-secondary)] hover:text-[var(--text-primary)] border border-[var(--border-secondary)] rounded-lg text-sm font-bold transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                title={text('用当前镜头、参考图与音频设置重新编译提示词（覆盖编辑框内容）', 'Rebuild the prompt from the current shot, references, and audio settings. This replaces the editor content.')}
              >
                {isRebuildingPrompt ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                {resolvedRebuildLabel}
              </button>
            )}
          </div>
          <div className="flex gap-3">
            {isComfyUiView ? (
              <button
                type="button"
                onClick={() => void handleCopyComfyUiPrompt()}
                disabled={!comfyUiPrompt.trim()}
                className="px-4 py-2 bg-[var(--btn-primary-bg)] text-[var(--btn-primary-text)] hover:bg-[var(--btn-primary-hover)] rounded-lg text-sm font-bold transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {copyStatus === 'copied' ? <CheckCheck className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                {copyStatus === 'copied'
                  ? text('已复制', 'Copied')
                  : copyStatus === 'failed'
                    ? text('复制失败，请 Ctrl/Cmd+C', 'Copy failed — use Ctrl/Cmd+C')
                    : text('复制到剪贴板', 'Copy to clipboard')}
              </button>
            ) : (
              <button
                onClick={onSave}
                disabled={busy}
                className="px-4 py-2 bg-[var(--btn-primary-bg)] text-[var(--btn-primary-text)] hover:bg-[var(--btn-primary-hover)] rounded-lg text-sm font-bold transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Check className="w-4 h-4" />
                {text('保存', 'Save')}
              </button>
            )}
            <button
              onClick={onClose}
              disabled={busy}
              className="px-4 py-2 bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:bg-[var(--border-secondary)] rounded-lg text-sm font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {text(isComfyUiView ? '关闭' : '取消', isComfyUiView ? 'Close' : 'Cancel')}
            </button>
          </div>
        </div>
        <div
          className="absolute bottom-1 right-1 h-5 w-5 cursor-nwse-resize opacity-70 before:absolute before:bottom-1 before:right-1 before:h-3 before:w-3 before:border-b-2 before:border-r-2 before:border-[var(--text-tertiary)]"
          title={text('拖动以调整窗口大小', 'Drag to resize')}
          onPointerDown={(event) => beginInteraction(event, 'resize')}
        />
      </div>
    </div>
  );
};

export default EditModal;
