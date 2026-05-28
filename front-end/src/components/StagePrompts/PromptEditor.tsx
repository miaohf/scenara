import React from 'react';
import { Save, X, History } from 'lucide-react';
import { PromptVersion } from '../../types';
import { lintPromptText } from '../../services/promptLintService';
import { STYLES } from './constants';

interface Props {
  value: string;
  onChange: (value: string) => void;
  onSave: () => void;
  onCancel: () => void;
  placeholder?: string;
  size?: 'large' | 'small' | 'video';
  isVideo?: boolean;
  versions?: PromptVersion[];
  onRollback?: (versionId: string) => void;
}

const SOURCE_LABELS: Record<PromptVersion['source'], string> = {
  'ai-generated': 'AI',
  'manual-edit': 'Manual',
  rollback: 'Rollback',
  imported: 'Imported',
  system: 'System',
};

const PromptEditor: React.FC<Props> = ({
  value,
  onChange,
  onSave,
  onCancel,
  placeholder = '输入提示词...',
  size = 'large',
  isVideo = false,
  versions = [],
  onRollback,
}) => {
  const textareaClass = `${STYLES.textarea.base} ${
    size === 'large' ? STYLES.textarea.large : size === 'video' ? STYLES.textarea.video : STYLES.textarea.small
  }`;

  const saveButtonClass = isVideo
    ? STYLES.button.saveVideo
    : size === 'small'
      ? STYLES.button.saveSmall
      : STYLES.button.save;

  const cancelButtonClass = size === 'small' ? STYLES.button.cancelSmall : STYLES.button.cancel;

  const lintResult = lintPromptText(value, {
    minLength: size === 'small' ? 10 : 16,
    allowEmpty: false,
  });
  const hasBlockingError = lintResult.errorCount > 0;
  const recentVersions = [...versions].slice(-6).reverse();

  return (
    <div className="space-y-3">
      {lintResult.issues.length > 0 && (
        <div className="rounded border border-[var(--warning-border)] bg-[var(--warning-bg)]/40 px-3 py-2 space-y-1">
          {lintResult.issues.map((issue) => (
            <div
              key={issue.code}
              className={`text-[10px] ${
                issue.severity === 'error'
                  ? 'text-[var(--error-text)]'
                  : issue.severity === 'warning'
                    ? 'text-[var(--warning-text)]'
                    : 'text-[var(--text-tertiary)]'
              }`}
            >
              [{issue.severity}] {issue.message}
            </div>
          ))}
        </div>
      )}

      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={textareaClass}
        placeholder={placeholder}
        autoFocus
      />

      {recentVersions.length > 0 && onRollback && (
        <div className="rounded border border-[var(--border-primary)] bg-[var(--bg-surface)] p-2 space-y-2">
          <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">
            <History className="w-3 h-3" />
            Prompt History
          </div>
          <div className="space-y-1 max-h-32 overflow-auto">
            {recentVersions.map((version) => (
              <div
                key={version.id}
                className="flex items-center justify-between gap-2 rounded border border-[var(--border-primary)] bg-[var(--bg-elevated)] px-2 py-1"
              >
                <div className="min-w-0">
                  <div className="text-[10px] text-[var(--text-secondary)] font-mono">
                    {SOURCE_LABELS[version.source]} · {new Date(version.createdAt).toLocaleString()}
                  </div>
                  {version.note && (
                    <div className="text-[9px] text-[var(--text-muted)] truncate">{version.note}</div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => onRollback(version.id)}
                  className="text-[10px] px-2 py-0.5 rounded border border-[var(--accent-border)] text-[var(--accent-text)] hover:bg-[var(--accent-bg)]"
                >
                  回滚
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex gap-2">
        <button onClick={onSave} className={saveButtonClass} disabled={hasBlockingError}>
          <Save className="w-3 h-3" />
          保存
        </button>
        <button onClick={onCancel} className={cancelButtonClass}>
          <X className="w-3 h-3" />
          取消
        </button>
      </div>
    </div>
  );
};

export default PromptEditor;

