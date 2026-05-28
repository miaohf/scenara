import React from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

interface Props {
  title: string;
  icon: React.ReactNode;
  count: number;
  isExpanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}

const CollapsibleSection: React.FC<Props> = ({
  title,
  icon,
  count,
  isExpanded,
  onToggle,
  children
}) => {
  return (
    <section className="rounded-2xl border border-[var(--border-primary)] bg-[var(--bg-elevated)]/60 overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full px-4 py-3 flex items-center justify-between gap-3 text-left hover:bg-[var(--bg-hover)]/50 transition-colors"
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className="text-[var(--accent-text)] flex-shrink-0">{icon}</div>
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-[var(--text-primary)]">{title}</h2>
            <p className="text-xs text-[var(--text-tertiary)]">当前显示 {count} 条</p>
          </div>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          <span className="text-xs font-mono text-[var(--text-tertiary)] px-2 py-1 rounded bg-[var(--bg-base)] border border-[var(--border-primary)]">
            {count}
          </span>
          <span className="text-[var(--text-secondary)]">
            {isExpanded ? <ChevronDown className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
          </span>
        </div>
      </button>

      {isExpanded && (
        <div className="space-y-4 border-t border-[var(--border-subtle)] p-4">
          {children}
        </div>
      )}
    </section>
  );
};

export default CollapsibleSection;
