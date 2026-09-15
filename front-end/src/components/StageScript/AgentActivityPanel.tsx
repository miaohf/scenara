import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  BrainCircuit,
  Check,
  ChevronDown,
  ChevronUp,
  Circle,
  Clock3,
  Info,
  Trash2,
  XCircle,
} from 'lucide-react';
import { useInterfaceLanguage } from '../../contexts/InterfaceLanguageContext';

export type AgentTraceEntryStatus = 'info' | 'running' | 'success' | 'warning' | 'error';
export type AgentTraceRunStatus = 'running' | 'completed' | 'warning' | 'error' | 'cancelled' | 'waiting';

export interface AgentTraceEntry {
  id: string;
  phase: string;
  message: string;
  detail?: string;
  status: AgentTraceEntryStatus;
  timestamp: number;
}

export interface AgentTraceSession {
  id: string;
  title: string;
  subtitle?: string;
  status: AgentTraceRunStatus;
  startedAt: number;
  completedAt?: number;
  entries: AgentTraceEntry[];
}

interface Props {
  session: AgentTraceSession | null;
  onClear: () => void;
}

const formatTime = (timestamp: number, language: 'zh' | 'en'): string => new Intl.DateTimeFormat(language === 'zh' ? 'zh-CN' : 'en-US', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
}).format(timestamp);

const formatDuration = (milliseconds: number, language: 'zh' | 'en'): string => {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  if (seconds < 60) return language === 'zh' ? `${seconds}秒` : `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return language === 'zh' ? `${minutes}分${seconds % 60}秒` : `${minutes}m ${seconds % 60}s`;
};

const RUN_STATUS: Record<AgentTraceRunStatus, { zh: string; en: string; className: string }> = {
  running: { zh: '执行中', en: 'Running', className: 'border-sky-400/30 bg-sky-400/10 text-sky-200' },
  completed: { zh: '已完成', en: 'Complete', className: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200' },
  warning: { zh: '已降级', en: 'Fallback', className: 'border-amber-400/30 bg-amber-400/10 text-amber-200' },
  error: { zh: '失败', en: 'Failed', className: 'border-rose-400/30 bg-rose-400/10 text-rose-200' },
  cancelled: { zh: '已取消', en: 'Cancelled', className: 'border-zinc-400/30 bg-zinc-400/10 text-zinc-300' },
  waiting: { zh: '等待确认', en: 'Needs review', className: 'border-violet-400/30 bg-violet-400/10 text-violet-200' },
};

const EntryIcon: React.FC<{ status: AgentTraceEntryStatus }> = ({ status }) => {
  if (status === 'running') {
    return <BrainCircuit className="h-3.5 w-3.5 animate-pulse text-sky-300" />;
  }
  if (status === 'success') return <Check className="h-3.5 w-3.5 text-emerald-300" />;
  if (status === 'warning') return <AlertTriangle className="h-3.5 w-3.5 text-amber-300" />;
  if (status === 'error') return <XCircle className="h-3.5 w-3.5 text-rose-300" />;
  if (status === 'info') return <Info className="h-3.5 w-3.5 text-violet-300" />;
  return <Circle className="h-3.5 w-3.5 text-zinc-400" />;
};

const AgentActivityPanel: React.FC<Props> = ({ session, onClear }) => {
  const { language, text } = useInterfaceLanguage();
  const [collapsed, setCollapsed] = useState(false);
  const [elapsedMilliseconds, setElapsedMilliseconds] = useState(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (session?.status !== 'running') return;
    const startedAt = session.startedAt;
    const timer = window.setInterval(() => {
      setElapsedMilliseconds(Date.now() - startedAt);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [session?.startedAt, session?.status]);

  useEffect(() => {
    if (collapsed) return;
    const viewport = scrollRef.current;
    if (viewport) viewport.scrollTop = viewport.scrollHeight;
  }, [collapsed, session?.entries.length]);

  if (!session) return null;

  const runStatus = RUN_STATUS[session.status];
  const elapsed = formatDuration(
    session.completedAt
      ? session.completedAt - session.startedAt
      : elapsedMilliseconds,
    language,
  );

  return (
    <section
      className="fixed bottom-10 right-4 z-[9998] w-[min(440px,calc(100vw-2rem))] overflow-hidden rounded-xl border border-[var(--border-default)] bg-[var(--bg-base)]/95 shadow-2xl backdrop-blur"
      aria-label="Agent 执行轨迹"
    >
      <header className="flex items-center gap-3 border-b border-[var(--border-subtle)] px-3.5 py-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-violet-400/20 bg-violet-400/10">
          <BrainCircuit className="h-4 w-4 text-violet-300" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-sm font-semibold text-[var(--text-primary)]">{session.title}</h3>
            <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[11px] font-semibold ${runStatus.className}`}>
              {language === 'zh' ? runStatus.zh : runStatus.en}
            </span>
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-[11px] text-[var(--text-muted)]">
            {session.subtitle && <span className="truncate">{session.subtitle}</span>}
            <span className="flex shrink-0 items-center gap-1 tabular-nums">
              <Clock3 className="h-3 w-3" />
              {elapsed}
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setCollapsed((value) => !value)}
          className="rounded p-1 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
          title={collapsed ? text('展开执行轨迹', 'Expand agent activity') : text('收起执行轨迹', 'Collapse agent activity')}
        >
          {collapsed ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
        <button
          type="button"
          onClick={onClear}
          disabled={session.status === 'running'}
          className="rounded p-1 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-30"
          title={session.status === 'running' ? text('执行结束后可清除', 'Clear when the run ends') : text('清除执行轨迹', 'Clear agent activity')}
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </header>

      {!collapsed && (
        <>
          <div
            ref={scrollRef}
            className="max-h-[42vh] min-h-28 space-y-0 overflow-y-auto px-3.5 py-2"
            aria-live="polite"
          >
            {session.entries.length === 0 ? (
              <div className="py-6 text-center text-xs text-[var(--text-muted)]">
                {text('正在准备 Agent 工作流…', 'Preparing agent workflow…')}
              </div>
            ) : session.entries.map((entry, index) => (
              <div key={entry.id} className="relative flex gap-2.5 py-2.5">
                {index < session.entries.length - 1 && (
                  <div className="absolute left-[7px] top-7 h-[calc(100%-10px)] w-px bg-[var(--border-subtle)]" />
                )}
                <div className="relative z-10 mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[var(--bg-base)]">
                  <EntryIcon status={entry.status} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <span className="mr-2 text-xs font-semibold uppercase tracking-wide text-violet-300/90">
                        {entry.phase}
                      </span>
                      <span className="text-[13px] leading-snug text-[var(--text-secondary)]">
                        {entry.message}
                      </span>
                    </div>
                    <time className="shrink-0 text-[10px] tabular-nums text-[var(--text-muted)]">
                      {formatTime(entry.timestamp, language)}
                    </time>
                  </div>
                  {entry.detail && (
                    <p className="mt-1 whitespace-pre-wrap break-words rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 py-1.5 text-xs leading-snug text-[var(--text-tertiary)]">
                      {entry.detail}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
          <footer className="border-t border-[var(--border-subtle)] px-3.5 py-2 text-[10px] leading-relaxed text-[var(--text-muted)]">
            {text('仅展示执行阶段、产出摘要与校验结果，不展示模型隐藏推理。', 'Shows phases, summaries, and checks; hidden model reasoning is not displayed.')}
          </footer>
        </>
      )}
    </section>
  );
};

export default AgentActivityPanel;
