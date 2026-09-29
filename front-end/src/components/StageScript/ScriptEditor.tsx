import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Plus,
  RotateCw,
  BrainCircuit,
  Wand2,
  Undo2,
  Search,
  ListTree,
  HelpCircle,
  Clapperboard,
  MessageSquare,
  X,
  ChevronUp,
  ChevronDown,
  Eye,
  Pencil,
} from 'lucide-react';
import { STYLES } from './constants';
import { countSceneHeadings, findTextMatches, parseScriptOutline } from './utils';
import { renderHighlightedScript, renderMarkdownPreview } from './scriptHighlight';
import { useInterfaceLanguage } from '../../contexts/InterfaceLanguageContext';
import type { StoryFormId } from '../../services/ai/storyForm';

interface Props {
  script: string;
  scriptSoftLimit: number;
  scriptHardLimit: number;
  onChange: (value: string) => void;
  onContinue: () => void;
  onRewrite: () => void;
  onSelectionChange: (start: number, end: number) => void;
  selectionRange: { start: number; end: number } | null;
  selectedText: string;
  rewriteInstruction: string;
  onRewriteInstructionChange: (value: string) => void;
  storyForm: StoryFormId;
  onStoryFormChange: (value: StoryFormId) => void;
  customStoryForm: string;
  onCustomStoryFormChange: (value: string) => void;
  onRewriteSelection: () => void;
  onUndoRewrite: () => void;
  canUndoRewrite: boolean;
  isContinuing: boolean;
  isRewriting: boolean;
  lastModified?: string | number;
}

const EDITOR_TYPE = 'font-sans text-[13px] leading-[1.45] tracking-[0.005em] whitespace-pre-wrap break-words';

const ScriptEditor: React.FC<Props> = ({
  script,
  scriptSoftLimit,
  scriptHardLimit,
  onChange,
  onContinue,
  onRewrite,
  onSelectionChange,
  selectionRange,
  selectedText,
  rewriteInstruction,
  onRewriteInstructionChange,
  storyForm,
  onStoryFormChange,
  customStoryForm,
  onCustomStoryFormChange,
  onRewriteSelection,
  onUndoRewrite,
  canUndoRewrite,
  isContinuing,
  isRewriting,
  lastModified
}) => {
  const { text } = useInterfaceLanguage();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const findInputRef = useRef<HTMLInputElement | null>(null);
  const [cursorOffset, setCursorOffset] = useState(0);
  const [showOutline, setShowOutline] = useState(true);
  const [showHelp, setShowHelp] = useState(false);
  const [showFind, setShowFind] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [findQuery, setFindQuery] = useState('');
  const [findIndex, setFindIndex] = useState(0);
  const prevScriptLengthRef = useRef(script.length);

  const stats = {
    characters: script.length,
    lines: script.split('\n').length,
    scenes: countSceneHeadings(script)
  };
  const selectedCount = selectedText.length;
  const selectedPreview = selectedCount > 160
    ? `${selectedText.slice(0, 160)}...`
    : selectedText;
  const scriptLengthStatus: 'normal' | 'warning' | 'error' =
    stats.characters > scriptHardLimit
      ? 'error'
      : stats.characters > scriptSoftLimit
        ? 'warning'
        : 'normal';
  const scriptLimitHint = scriptLengthStatus === 'error'
    ? text(`超出上限 ${stats.characters}/${scriptHardLimit}，请拆分为多集`, `Over limit: ${stats.characters}/${scriptHardLimit}; split into multiple episodes`)
    : scriptLengthStatus === 'warning'
      ? text(`接近上限 ${stats.characters}/${scriptHardLimit}（建议单集 ≤ ${scriptSoftLimit}）`, `Near limit: ${stats.characters}/${scriptHardLimit} (recommended episode limit: ${scriptSoftLimit})`)
      : text(`建议单集长度 ≤ ${scriptSoftLimit} 字符`, `Recommended episode length: ≤ ${scriptSoftLimit} characters`);
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
  const hasInstruction = rewriteInstruction.trim().length > 0;
  const outline = useMemo(() => parseScriptOutline(script), [script]);
  const findMatches = useMemo(
    () => (showFind ? findTextMatches(script, findQuery) : []),
    [script, findQuery, showFind]
  );
  const activeFindStart = findMatches.length > 0
    ? findMatches[Math.min(findIndex, findMatches.length - 1)]
    : -1;
  const highlightRanges = useMemo(() => {
    const ranges: Array<{ start: number; end: number; kind: 'lock' | 'find' | 'find-current' }> = [];
    if (selectionRange && selectionRange.end > selectionRange.start) {
      ranges.push({
        start: selectionRange.start,
        end: Math.min(selectionRange.end, script.length),
        kind: 'lock',
      });
    }
    if (showFind && findQuery.trim()) {
      const qLen = findQuery.trim().length;
      findMatches.forEach((start) => {
        ranges.push({
          start,
          end: start + qLen,
          kind: start === activeFindStart ? 'find-current' : 'find',
        });
      });
    }
    return ranges;
  }, [script, selectionRange, showFind, findQuery, findMatches, activeFindStart]);

  const highlighted = useMemo(
    () => renderHighlightedScript(script, highlightRanges),
    [script, highlightRanges]
  );

  const activeOutlineId = useMemo(() => {
    let current = outline[0]?.id;
    for (const item of outline) {
      if (item.offset <= cursorOffset) current = item.id;
      else break;
    }
    return current;
  }, [outline, cursorOffset]);

  const reportSelection = (target: HTMLTextAreaElement) => {
    const start = target.selectionStart ?? 0;
    const end = target.selectionEnd ?? 0;
    setCursorOffset(start);
    if (end > start) {
      onSelectionChange(start, end);
      return;
    }
    // 点到指令栏时不要丢掉已锁定选区
    if (document.activeElement === target) {
      onSelectionChange(start, start);
    }
  };

  const focusEditor = (start: number, end = start) => {
    const el = textareaRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(start, end);
    setCursorOffset(start);
    onSelectionChange(start, end);
  };

  const insertAtCursor = (text: string, selectOffset?: { start: number; length: number }) => {
    const el = textareaRef.current;
    const start = el?.selectionStart ?? script.length;
    const end = el?.selectionEnd ?? start;
    const next = script.slice(0, start) + text + script.slice(end);
    onChange(next);
    const caret = start + text.length;
    requestAnimationFrame(() => {
      if (selectOffset) {
        focusEditor(start + selectOffset.start, start + selectOffset.start + selectOffset.length);
      } else {
        focusEditor(caret);
      }
    });
  };

  const handleInsertScene = () => {
    const nextIndex = outline.filter((item) => item.level === 2).length + 1;
    const prefix = !script || script.endsWith('\n') ? '' : '\n';
    const snippet = `${prefix}\n## 第 ${nextIndex} 场\n\n### 内景，地点，日\n\n`;
    const locationAt = snippet.indexOf('地点');
    insertAtCursor(
      snippet,
      locationAt >= 0 ? { start: locationAt, length: 2 } : undefined
    );
  };

  const handleInsertDialogue = () => {
    const prefix = !script || script.endsWith('\n') ? '' : '\n';
    const snippet = `${prefix}\n**角色名**\n\n`;
    insertAtCursor(snippet, { start: snippet.indexOf('角色名'), length: 3 });
  };

  const jumpToOffset = (offset: number) => {
    focusEditor(offset);
    requestAnimationFrame(() => {
      const marker = scrollRef.current?.querySelector(`[data-script-offset="${offset}"]`);
      marker?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
  };

  const jumpToFind = (nextIndex: number) => {
    if (findMatches.length === 0) return;
    const safe = (nextIndex + findMatches.length) % findMatches.length;
    setFindIndex(safe);
    const start = findMatches[safe];
    const end = start + findQuery.trim().length;
    focusEditor(start, end);
    requestAnimationFrame(() => {
      const lineOffset = script.lastIndexOf('\n', Math.max(0, start - 1));
      const approxLineStart = lineOffset < 0 ? 0 : lineOffset + 1;
      const heading = scrollRef.current?.querySelector(`[data-script-offset="${approxLineStart}"]`);
      heading?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
  };

  const handleEditorKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const el = event.currentTarget;
    if (event.key === 'Tab') {
      event.preventDefault();
      const start = el.selectionStart ?? 0;
      const end = el.selectionEnd ?? 0;
      const next = `${script.slice(0, start)}  ${script.slice(end)}`;
      onChange(next);
      requestAnimationFrame(() => focusEditor(start + 2));
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') {
      event.preventDefault();
      setShowFind(true);
      requestAnimationFrame(() => findInputRef.current?.focus());
    }
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      if (event.shiftKey) {
        if (canRewriteSelection) onRewriteSelection();
        else if (!isBaseDisabled) onRewrite();
      } else if (!isBaseDisabled) {
        onContinue();
      }
    }
  };

  useEffect(() => {
    if (!isContinuing) {
      prevScriptLengthRef.current = script.length;
      return;
    }
    if (script.length >= prevScriptLengthRef.current) {
      const scroller = scrollRef.current;
      if (scroller) scroller.scrollTop = scroller.scrollHeight;
    }
    prevScriptLengthRef.current = script.length;
  }, [isContinuing, script.length]);

  useEffect(() => {
    if (!isEditing) return;
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, [isEditing]);

  useEffect(() => {
    if (findIndex >= findMatches.length) setFindIndex(0);
  }, [findMatches.length, findIndex]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') {
        const target = event.target as HTMLElement | null;
        if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
        event.preventDefault();
        setShowFind(true);
        requestAnimationFrame(() => findInputRef.current?.focus());
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="flex-1 flex flex-col bg-[var(--bg-elevated)] relative min-h-0">
      <div className="h-12 border-b border-[var(--border-primary)] flex items-center justify-between px-4 bg-[var(--bg-base)]/80 backdrop-blur-sm shrink-0 gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-1 h-4 rounded-full bg-[var(--accent)]" />
          <span className="text-xs font-semibold tracking-wide text-[var(--text-secondary)]">
            {text('剧本编辑器', 'Script Editor')}
          </span>
        </div>
        <div className="flex items-center gap-1.5 overflow-x-auto">
          <button
            type="button"
            onClick={() => setIsEditing((previous) => !previous)}
            className={`px-2 py-1.5 text-[11px] font-semibold rounded-md flex items-center gap-1.5 border transition-colors ${
              isEditing ? STYLES.button.selected : STYLES.button.secondary
            }`}
            title={isEditing ? text('切换到 Markdown 预览', 'Switch to Markdown preview') : text('进入编辑模式（也可双击正文）', 'Enter edit mode (or double-click the text)')}
          >
            {isEditing ? <Eye className="w-3.5 h-3.5" /> : <Pencil className="w-3.5 h-3.5" />}
            {isEditing ? text('预览', 'Preview') : text('编辑', 'Edit')}
          </button>
          <button
            type="button"
            onClick={() => {
              setShowFind((prev) => !prev);
              requestAnimationFrame(() => findInputRef.current?.focus());
            }}
            className={`px-2 py-1.5 text-[11px] font-semibold rounded-md flex items-center gap-1.5 border transition-colors ${
              showFind ? STYLES.button.selected : STYLES.button.secondary
            }`}
            title={text('查找（Ctrl/⌘ F）', 'Find (Ctrl/⌘ F)')}
          >
            <Search className="w-3.5 h-3.5" />
            {text('查找', 'Find')}
          </button>
          <button
            type="button"
            onClick={() => setShowOutline((prev) => !prev)}
            className={`px-2 py-1.5 text-[11px] font-semibold rounded-md flex items-center gap-1.5 border transition-colors ${
              showOutline ? STYLES.button.selected : STYLES.button.secondary
            }`}
            title={text('场次大纲', 'Scene outline')}
          >
            <ListTree className="w-3.5 h-3.5" />
            {text('大纲', 'Outline')}
          </button>
          <button
            type="button"
            onClick={handleInsertScene}
            disabled={isBusy}
            className={`px-2 py-1.5 text-[11px] font-semibold rounded-md flex items-center gap-1.5 border transition-colors ${
              isBusy ? STYLES.button.disabled : STYLES.button.secondary
            }`}
            title={text('在光标处插入场次', 'Insert scene at cursor')}
          >
            <Clapperboard className="w-3.5 h-3.5" />
            {text('场次', 'Scene')}
          </button>
          <button
            type="button"
            onClick={handleInsertDialogue}
            disabled={isBusy}
            className={`px-2 py-1.5 text-[11px] font-semibold rounded-md flex items-center gap-1.5 border transition-colors ${
              isBusy ? STYLES.button.disabled : STYLES.button.secondary
            }`}
            title={text('在光标处插入对白', 'Insert dialogue at cursor')}
          >
            <MessageSquare className="w-3.5 h-3.5" />
            {text('对白', 'Dialogue')}
          </button>
          <div className="w-px h-4 bg-[var(--border-primary)] mx-0.5" />
          <button
            type="button"
            onClick={onContinue}
            disabled={isBaseDisabled}
            className={`px-2.5 py-1.5 text-[11px] font-semibold rounded-md flex items-center gap-1.5 border transition-colors ${
              isBaseDisabled ? STYLES.button.disabled : STYLES.button.primary
            }`}
            title="Ctrl/⌘ Enter"
          >
            {isContinuing ? (
              <>
                <BrainCircuit className="w-3.5 h-3.5 animate-spin" />
                {text('续写中', 'Continuing…')}
              </>
            ) : (
              <>
                <Plus className="w-3.5 h-3.5" />
                {text('AI续写', 'AI Continue')}
              </>
            )}
          </button>
          <button
            type="button"
            onClick={onRewrite}
            disabled={isBaseDisabled}
            className={`px-2.5 py-1.5 text-[11px] font-semibold rounded-md flex items-center gap-1.5 border transition-colors ${
              isBaseDisabled ? STYLES.button.disabled : STYLES.button.secondary
            }`}
            title={hasInstruction ? text('按上方要求改写全文', 'Rewrite the full script using the instruction above') : text('优化改写全文', 'Rewrite and improve the full script')}
          >
            {isRewriting && !selectedCount ? (
              <>
                <BrainCircuit className="w-3.5 h-3.5 animate-spin" />
                {text('改写中', 'Rewriting…')}
              </>
            ) : (
              <>
                <RotateCw className="w-3.5 h-3.5" />
                {text('AI改写', 'AI Rewrite')}
              </>
            )}
          </button>
          <button
            type="button"
            onClick={onRewriteSelection}
            disabled={!canRewriteSelection}
            className={`px-2.5 py-1.5 text-[11px] font-semibold rounded-md flex items-center gap-1.5 border transition-colors ${
              canRewriteSelection ? STYLES.button.secondary : STYLES.button.disabled
            }`}
            title="Ctrl/⌘ Shift Enter"
          >
            {isRewriting && selectedCount > 0 ? (
              <>
                <BrainCircuit className="w-3.5 h-3.5 animate-spin" />
                {text('选段改写中', 'Rewriting selection…')}
              </>
            ) : (
              <>
                <Wand2 className="w-3.5 h-3.5" />
                {text('选段改写', 'Rewrite Selection')}
              </>
            )}
          </button>
          <button
            type="button"
            onClick={onUndoRewrite}
            disabled={!canUndo}
            className={`px-2.5 py-1.5 text-[11px] font-semibold rounded-md flex items-center gap-1.5 border transition-colors ${
              canUndo ? STYLES.button.secondary : STYLES.button.disabled
            }`}
            title={text('撤回最近一次改写', 'Undo the latest rewrite')}
          >
            <Undo2 className="w-3.5 h-3.5" />
            {text('撤回', 'Undo')}
          </button>
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowHelp((prev) => !prev)}
              className={`px-2 py-1.5 text-[11px] font-semibold rounded-md flex items-center border transition-colors ${
                showHelp ? STYLES.button.selected : STYLES.button.secondary
              }`}
              title={text('格式与快捷键', 'Formatting and shortcuts')}
            >
              <HelpCircle className="w-3.5 h-3.5" />
            </button>
            {showHelp && (
              <div className="absolute right-0 top-9 z-20 w-64 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-base)] p-3 shadow-xl text-[11px] text-[var(--text-secondary)]">
                <p className="font-semibold text-[var(--text-primary)] mb-2">{text('剧本格式', 'Script Format')}</p>
                <p className="leading-relaxed text-[var(--text-tertiary)]">
                  <span className="font-mono">#</span> {text('剧名', 'Title')}　
                  <span className="font-mono">##</span> {text('场次', 'Scene')}　
                  <span className="font-mono">###</span> {text('场景', 'Setting')}<br />
                  <span className="font-mono">**{text('角色', 'Character')}**</span> {text('后换行写台词', 'then write dialogue on the next line')}
                </p>
                <p className="font-semibold text-[var(--text-primary)] mt-3 mb-2">{text('快捷键', 'Shortcuts')}</p>
                <ul className="space-y-1 text-[var(--text-tertiary)]">
                  <li>{text('Tab 缩进', 'Tab Indent')}</li>
                  <li>{text('Ctrl/⌘ F 查找', 'Ctrl/⌘ F Find')}</li>
                  <li>{text('Ctrl/⌘ Enter 续写', 'Ctrl/⌘ Enter Continue')}</li>
                  <li>{text('Ctrl/⌘ Shift Enter 改写选段/全文', 'Ctrl/⌘ Shift Enter Rewrite selection/full script')}</li>
                </ul>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="px-4 py-2.5 border-b border-[var(--border-subtle)] bg-[var(--bg-base)] shrink-0 space-y-2">
        {showFind && (
          <div className="flex items-center gap-2">
            <Search className="w-3.5 h-3.5 text-[var(--text-muted)] shrink-0" />
            <input
              ref={findInputRef}
              value={findQuery}
              onChange={(e) => {
                setFindQuery(e.target.value);
                setFindIndex(0);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  jumpToFind(e.shiftKey ? findIndex - 1 : findIndex + 1);
                }
                if (e.key === 'Escape') {
                  setShowFind(false);
                  textareaRef.current?.focus();
                }
              }}
              placeholder={text('在剧本中查找…', 'Find in script…')}
              className="flex-1 bg-[var(--bg-surface)] border border-[var(--border-primary)] text-[var(--text-primary)] px-3 py-1.5 text-xs rounded-md focus:border-[var(--border-secondary)] focus:outline-none"
            />
            <span className="text-[11px] text-[var(--text-muted)] tabular-nums whitespace-nowrap">
              {findQuery.trim()
                ? (findMatches.length > 0 ? `${findIndex + 1}/${findMatches.length}` : text('无匹配', 'No matches'))
                : text('输入关键词', 'Enter a keyword')}
            </span>
            <button
              type="button"
              onClick={() => jumpToFind(findIndex - 1)}
              disabled={findMatches.length === 0}
              className="p-1 rounded border border-[var(--border-primary)] text-[var(--text-tertiary)] disabled:opacity-30"
            >
              <ChevronUp className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => jumpToFind(findIndex + 1)}
              disabled={findMatches.length === 0}
              className="p-1 rounded border border-[var(--border-primary)] text-[var(--text-tertiary)] disabled:opacity-30"
            >
              <ChevronDown className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setShowFind(false)}
              className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-[var(--text-muted)] shrink-0">{text('体裁', 'Form')}</span>
          <select
            value={storyForm}
            onChange={(e) => onStoryFormChange(e.target.value as StoryFormId)}
            disabled={isBusy}
            title={
              storyForm === 'documentary'
                ? text('续写和改写按纪录片介绍处理。', 'Continue and rewrite as a documentary.')
                : storyForm === 'other'
                  ? text('填写体裁后按该体裁处理。未填写时按短片处理。', 'Name a form to use it. An empty name stays on short film.')
                  : text('续写和改写按短片处理。默认是短片。', 'Continue and rewrite as a short film. The default is a short film.')
            }
            className="shrink-0 bg-[var(--bg-surface)] border border-[var(--border-primary)] text-[var(--text-primary)] px-2 py-1.5 text-xs rounded-md focus:border-[var(--border-secondary)] focus:outline-none disabled:opacity-50"
          >
            <option value="dramatic">{text('短片', 'Short film')}</option>
            <option value="documentary">{text('纪录片', 'Documentary')}</option>
            <option value="other">{text('其他', 'Other')}</option>
          </select>
          {storyForm === 'other' && (
            <input
              value={customStoryForm}
              onChange={(e) => onCustomStoryFormChange(e.target.value)}
              disabled={isBusy}
              placeholder={text('如科普、访谈', 'e.g. explainer, interview')}
              className="w-28 shrink-0 bg-[var(--bg-surface)] border border-[var(--border-primary)] text-[var(--text-primary)] px-2 py-1.5 text-xs rounded-md focus:border-[var(--border-secondary)] focus:outline-none placeholder:text-[var(--text-muted)] disabled:opacity-50"
            />
          )}
          <input
            value={rewriteInstruction}
            onChange={(e) => onRewriteInstructionChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                if (canRewriteSelection) onRewriteSelection();
              }
            }}
            placeholder={
              selectedCount > 0
                ? (storyForm === 'documentary'
                  ? text('选段改写要求，例如：旁白更具体、补一个地标…（Enter 改写选段）', 'Rewrite selection, e.g. make the narration more concrete or add a landmark… (Enter to rewrite)')
                  : text('选段改写要求，例如：更紧张、对白更口语化…（Enter 改写选段）', 'Rewrite selection, e.g. make it tenser or make dialogue more conversational… (Enter to rewrite)'))
                : (storyForm === 'documentary'
                  ? text('给 AI 的要求，例如：接着介绍老城区的清晨市集…（可选，续写/改写都会用到）', 'Tell AI what to do, e.g. continue with the old-town morning market… (optional; used for continue/rewrite)')
                  : text('给 AI 的要求，例如：增加冲突、续写到乌江边…（可选，续写/改写都会用到）', 'Tell AI what to do, e.g. add conflict or continue to the river… (optional; used for continue/rewrite)'))
            }
            className="min-w-0 flex-1 bg-[var(--bg-surface)] border border-[var(--border-primary)] text-[var(--text-primary)] px-3 py-1.5 text-xs rounded-md focus:border-[var(--border-secondary)] focus:outline-none transition-colors placeholder:text-[var(--text-muted)]"
          />
          {selectedCount > 0 ? (
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-[11px] text-[var(--accent-text)] whitespace-nowrap tabular-nums">
                {text(`已锁定 ${selectedCount} 字`, `Locked ${selectedCount} characters`)}
              </span>
              <button
                type="button"
                onClick={() => onSelectionChange(0, 0)}
                className="text-[11px] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              >
                {text('清除', 'Clear')}
              </button>
            </div>
          ) : (
            <span className="text-[11px] text-[var(--text-muted)] whitespace-nowrap">
              {text('框选后可改写选段', 'Select text to rewrite a passage')}
            </span>
          )}
        </div>
        {selectedCount > 0 && (
          <p className="text-[11px] leading-snug text-[var(--text-tertiary)] line-clamp-2">
            {selectedPreview}
          </p>
        )}
      </div>

        <div className="flex-1 min-h-0 flex">
          <div ref={scrollRef} className="flex-1 overflow-y-auto min-h-0">
            <div className="w-full max-w-3xl mx-auto px-8 py-8 min-h-full">
              {isEditing ? (
                <div className="relative min-h-[calc(100vh-16rem)]">
                  <pre
                    aria-hidden
                    className={`m-0 p-0 ${EDITOR_TYPE} pointer-events-none text-[var(--text-secondary)]`}
                  >
                    {script ? highlighted : (
                      <span className="text-[var(--text-muted)]">
                        {text('在此输入故事大纲，或直接粘贴剧本…', 'Enter a story outline or paste a script here…')}{'\n\n'}
                        {text('可用结构：', 'Supported structure:')}{'\n'}
                        # {text('剧名', 'Title')}{'\n'}
                        ## {text('第一场', 'Scene 1')}{'\n'}
                        ### {text('内景，地点，日', 'INT. LOCATION - DAY')}{'\n'}
                        **{text('角色名', 'CHARACTER NAME')}**{'\n'}
                        {text('台词', 'Dialogue')}
                      </span>
                    )}
                  </pre>
                  <textarea
                    ref={textareaRef}
                    value={script}
                    onChange={(e) => {
                      onChange(e.target.value);
                      setCursorOffset(e.target.selectionStart ?? 0);
                    }}
                    onSelect={(e) => reportSelection(e.currentTarget)}
                    onMouseUp={(e) => reportSelection(e.currentTarget)}
                    onKeyUp={(e) => reportSelection(e.currentTarget)}
                    onKeyDown={handleEditorKeyDown}
                    className={`absolute inset-0 w-full h-full bg-transparent text-transparent caret-[var(--text-primary)] ${EDITOR_TYPE} focus:outline-none resize-none overflow-hidden selection:bg-[var(--accent-bg)]`}
                    placeholder=""
                    spellCheck={false}
                    readOnly={isBusy}
                  />
                </div>
              ) : (
                <div
                  role="button"
                  tabIndex={0}
                  title={text('双击正文进入编辑模式', 'Double-click the text to enter edit mode')}
                  onDoubleClick={() => setIsEditing(true)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') setIsEditing(true);
                  }}
                  className="min-h-[calc(100vh-16rem)] cursor-text text-[var(--text-secondary)] outline-none"
                >
                  {script ? renderMarkdownPreview(script) : (
                    <p className="m-0 whitespace-pre-wrap text-[13px] leading-[1.45] text-[var(--text-muted)]">
                      {text('在此输入故事大纲，或直接粘贴剧本…', 'Enter a story outline or paste a script here…')}
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>

        {showOutline && (
          <aside className="w-48 shrink-0 border-l border-[var(--border-subtle)] bg-[var(--bg-base)]/60 overflow-y-auto px-3 py-4">
            <div className="text-[10px] font-bold tracking-widest text-[var(--text-tertiary)] mb-3">
              {text('结构大纲', 'Structure Outline')}
            </div>
            {outline.length === 0 ? (
              <p className="text-[11px] leading-relaxed text-[var(--text-muted)]">
                {text('使用 # / ## / ### 标题后，可在此跳转场次。', 'Use # / ## / ### headings to jump between scenes here.')}
              </p>
            ) : (
              <nav className="space-y-0.5">
                {outline.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => jumpToOffset(item.offset)}
                    className={`w-full text-left rounded-md px-2 py-1.5 text-[11px] leading-snug transition-colors ${
                      item.id === activeOutlineId
                        ? 'bg-[var(--accent-bg)] text-[var(--text-primary)]'
                        : 'text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-secondary)]'
                    }`}
                    style={{ paddingLeft: `${6 + (item.level - 1) * 10}px` }}
                    title={item.title}
                  >
                    <span className="line-clamp-2">{item.title}</span>
                  </button>
                ))}
              </nav>
            )}
          </aside>
        )}
      </div>

      <div className="h-8 border-t border-[var(--border-subtle)] bg-[var(--bg-base)] px-6 flex items-center justify-between gap-4 text-[10px] select-none shrink-0">
        <div className={`flex items-center gap-1.5 ${scriptLimitTextClass}`}>
          <div className={`w-1.5 h-1.5 rounded-full ${scriptLimitDotClass}`} />
          <span>{scriptLimitHint}</span>
        </div>
        <div className="flex items-center gap-4 text-[var(--text-muted)] tabular-nums">
          <span>{text(`${stats.scenes} 场`, `${stats.scenes} scenes`)}</span>
          <span>{text(`${stats.characters} 字`, `${stats.characters} chars`)}</span>
          <span>{text(`${stats.lines} 行`, `${stats.lines} lines`)}</span>
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500/70" />
            {lastModified ? text('已自动保存', 'Autosaved') : text('准备就绪', 'Ready')}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ScriptEditor;
