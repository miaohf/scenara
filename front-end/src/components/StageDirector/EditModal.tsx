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
type PromptWorkflowKind = 'ref2va' | 'flf2v' | 'unknown';

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
  /** 当前镜头模型族。传入后优先于旧提示词文本判断，避免模型切换后显示旧标签。 */
  workflowKindOverride?: PromptWorkflowKind;
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
  workflowKindOverride,
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
  // 预览数量以当前镜头实际传入的视频参考图为准，不从提示词反推数量。
  // Ref2VA 的提示词可能只显式描述 Picture 1，其他参考图通过 subject/production
  // note 间接约束；按提示词编号裁剪会把真实的多图输入错误截成一张。
  const visibleReferencePreviews = referencePreviews;
  const busy = isAIGenerating || isRebuildingPrompt;
  const isComfyUiView = enableComfyUiExport && viewMode === 'comfyui';
  const effectiveWorkflowKind = workflowKindOverride || workflowKind;
  const workflowKindLabel =
    effectiveWorkflowKind === 'ref2va'
      ? 'Ref2VA'
      : effectiveWorkflowKind === 'flf2v'
        ? 'FL2V'
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
              <span className="px-2 py-1 rounded border border-[var(--border-primary)] text-[10px] font-mono text-[var(--text-secondary)]">
                {workflowKindLabel}
              </span>
            </div>
            <p className="text-[10px] leading-relaxed text-[var(--text-muted)]">
              {text(
                `支持 ${workflowKindLabel}：编辑内容可保存，右下角按钮可直接复制 ComfyUI 粘贴版提示词。请在 ComfyUI 中自行加载对应首尾帧/参考图。`,
                `Supports ${workflowKindLabel}: save edits here, or use the bottom-right button to copy the ComfyUI-ready prompt directly. Load matching frames/references in ComfyUI.`,
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

        <div className="flex flex-1 min-h-0 flex-col gap-2">
          {visibleReferencePreviews.length > 0 && (
            <div className="flex shrink-0 items-center gap-2 overflow-x-auto rounded-lg border border-[var(--border-primary)] bg-[var(--bg-base)] px-3 py-2">
              <span className="mr-1 shrink-0 text-[10px] uppercase tracking-widest text-[var(--text-tertiary)]">
                {text('提示词参考', 'Prompt refs')}
              </span>
              {visibleReferencePreviews.map((reference, index) => {
                const label = effectiveWorkflowKind === 'ref2va'
                  ? `Subject ${index + 1}`
                  : `Picture ${index + 1}`;
                return (
                  <div key={`${reference.image}-${index}`} className="group relative shrink-0">
                    <div className="flex cursor-help items-center gap-1.5 rounded-md border border-transparent px-1 py-1 hover:border-[var(--accent)]/50 hover:bg-[var(--bg-hover)]">
                      <img src={reference.image} alt={`${label}: ${reference.label}`} className="h-8 w-8 rounded object-cover bg-black/20" />
                      <span className="font-mono text-[10px] text-[var(--accent-text)]">{label}</span>
                    </div>
                    <div className="pointer-events-none absolute bottom-full left-0 z-30 mb-2 hidden w-64 rounded-lg border border-[var(--border-secondary)] bg-[var(--bg-elevated)] p-2 shadow-2xl group-hover:block">
                      <img src={reference.image} alt={`${label}: ${reference.label}`} className="h-44 w-full rounded object-contain bg-black/20" />
                      <p className="mt-2 truncate text-[11px] text-[var(--text-secondary)]">{reference.label}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <textarea
            ref={textareaRef}
            value={displayValue}
            onChange={(e) => {
              if (isComfyUiView) return;
              onChange(e.target.value);
            }}
            readOnly={isComfyUiView}
            className={`w-full flex-1 min-h-0 bg-[var(--bg-base)] text-[var(--text-primary)] border border-[var(--border-secondary)] rounded-lg p-4 text-sm leading-6 outline-none focus:border-[var(--border-secondary)] transition-colors resize-none ${textareaClassName} ${
              isComfyUiView ? 'cursor-text opacity-95' : ''
            }`}
            placeholder={resolvedPlaceholder}
            autoFocus={!isComfyUiView}
            disabled={busy}
          />
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
            {enableComfyUiExport && (
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
            )}
            {!isComfyUiView && (
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
