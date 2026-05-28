import React, { useMemo, useState } from 'react';
import { SlidersHorizontal, RotateCcw, Pencil } from 'lucide-react';
import type {
  PromptTemplateConfig,
  PromptTemplateOverrides,
} from '../../types';
import {
  getDefaultPromptTemplateValue,
  getPromptTemplateCategoryLabel,
  getPromptTemplateValueByPath,
  hasPromptTemplateOverride,
  PROMPT_TEMPLATE_FIELD_DEFINITIONS,
  PromptTemplateCategory,
  PromptTemplatePath,
  removePromptTemplateOverride,
  sanitizePromptTemplateOverrides,
  setPromptTemplateOverride,
} from '../../services/promptTemplateService';
import CollapsibleSection from './CollapsibleSection';

interface Props {
  templateConfig: PromptTemplateConfig;
  templateOverrides?: PromptTemplateOverrides;
  visiblePaths: Set<PromptTemplatePath>;
  isExpanded: boolean;
  onToggle: () => void;
  onUpdateOverrides: (overrides?: PromptTemplateOverrides) => void;
}

const CATEGORY_ORDER: PromptTemplateCategory[] = ['storyboard', 'keyframe', 'nineGrid', 'video'];

const TemplateSection: React.FC<Props> = ({
  templateConfig,
  templateOverrides,
  visiblePaths,
  isExpanded,
  onToggle,
  onUpdateOverrides,
}) => {
  const [editingPath, setEditingPath] = useState<PromptTemplatePath | null>(null);
  const [draftValue, setDraftValue] = useState('');

  const filteredFields = useMemo(
    () => PROMPT_TEMPLATE_FIELD_DEFINITIONS.filter((field) => visiblePaths.has(field.path)),
    [visiblePaths]
  );

  const groupedFields = useMemo(
    () =>
      CATEGORY_ORDER.map((category) => ({
        category,
        items: filteredFields.filter((field) => field.category === category),
      })).filter((group) => group.items.length > 0),
    [filteredFields]
  );

  const hasAnyOverride = !!sanitizePromptTemplateOverrides(templateOverrides);

  const handleStartEdit = (path: PromptTemplatePath) => {
    setEditingPath(path);
    setDraftValue(getPromptTemplateValueByPath(templateConfig, path));
  };

  const handleSaveEdit = () => {
    if (!editingPath) return;
    const defaultValue = getDefaultPromptTemplateValue(editingPath);
    const nextOverrides = draftValue === defaultValue
      ? removePromptTemplateOverride(templateOverrides, editingPath)
      : setPromptTemplateOverride(templateOverrides, editingPath, draftValue);
    onUpdateOverrides(nextOverrides);
    setEditingPath(null);
    setDraftValue('');
  };

  const handleCancelEdit = () => {
    setEditingPath(null);
    setDraftValue('');
  };

  const handleRestoreOne = (path: PromptTemplatePath) => {
    onUpdateOverrides(removePromptTemplateOverride(templateOverrides, path));
    if (editingPath === path) {
      handleCancelEdit();
    }
  };

  const handleRestoreAll = () => {
    onUpdateOverrides(undefined);
    handleCancelEdit();
  };

  return (
    <CollapsibleSection
      title="模板变量"
      icon={<SlidersHorizontal className="w-5 h-5" />}
      count={filteredFields.length}
      isExpanded={isExpanded}
      onToggle={onToggle}
    >
      <div className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-surface)] px-3 py-2">
        <p className="text-xs text-[var(--text-tertiary)]">
          当前运行会优先使用这里的自定义模板；恢复默认后自动回退到内置模板。
        </p>
        <button
          type="button"
          onClick={handleRestoreAll}
          disabled={!hasAnyOverride}
          className="flex items-center gap-1 text-xs px-2.5 py-1 rounded border border-[var(--warning-border)] text-[var(--warning-text)] hover:bg-[var(--warning-bg)] disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <RotateCcw className="w-3 h-3" />
          全部恢复默认
        </button>
      </div>

      {groupedFields.length === 0 && (
        <div className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-surface)] px-4 py-6 text-sm text-[var(--text-tertiary)] text-center">
          当前筛选下没有匹配的模板
        </div>
      )}

      {groupedFields.map((group) => (
        <div key={group.category} className="space-y-3">
          <div className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
            {getPromptTemplateCategoryLabel(group.category)}
          </div>

          {group.items.map((field) => {
            const currentValue = getPromptTemplateValueByPath(templateConfig, field.path);
            const isOverridden = hasPromptTemplateOverride(templateOverrides, field.path);
            const isEditing = editingPath === field.path;

            return (
              <div
                key={field.path}
                className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-surface)] p-3 space-y-2"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <h4 className="text-sm font-semibold text-[var(--text-primary)]">{field.title}</h4>
                      <span
                        className={`text-[10px] px-2 py-0.5 rounded border ${
                          isOverridden
                            ? 'border-[var(--accent-border)] text-[var(--accent-text)] bg-[var(--accent-bg)]'
                            : 'border-[var(--border-primary)] text-[var(--text-muted)] bg-[var(--bg-base)]'
                        }`}
                      >
                        {isOverridden ? '自定义' : '默认'}
                      </span>
                    </div>
                    <p className="text-xs text-[var(--text-tertiary)] mt-1">{field.description}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleStartEdit(field.path)}
                      className="flex items-center gap-1 text-xs px-2 py-1 rounded border border-[var(--accent-border)] text-[var(--accent-text)] hover:bg-[var(--accent-bg)]"
                    >
                      <Pencil className="w-3 h-3" />
                      编辑
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRestoreOne(field.path)}
                      disabled={!isOverridden}
                      className="text-xs px-2 py-1 rounded border border-[var(--warning-border)] text-[var(--warning-text)] hover:bg-[var(--warning-bg)] disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      恢复默认
                    </button>
                  </div>
                </div>

                {field.placeholders.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {field.placeholders.map((placeholder) => (
                      <span
                        key={placeholder}
                        className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[var(--bg-base)] border border-[var(--border-primary)] text-[var(--text-muted)]"
                      >
                        {'{'}{placeholder}{'}'}
                      </span>
                    ))}
                  </div>
                )}

                {isEditing ? (
                  <div className="space-y-2">
                    <textarea
                      value={draftValue}
                      onChange={(e) => setDraftValue(e.target.value)}
                      className="w-full min-h-[180px] bg-[var(--bg-base)] text-[var(--text-primary)] border border-[var(--border-primary)] rounded-md p-2 text-xs font-mono focus:outline-none focus:border-[var(--accent)]"
                    />
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={handleSaveEdit}
                        className="text-xs px-3 py-1.5 rounded bg-[var(--accent)] text-[var(--accent-on)] hover:bg-[var(--accent-hover)]"
                      >
                        保存
                      </button>
                      <button
                        type="button"
                        onClick={handleCancelEdit}
                        className="text-xs px-3 py-1.5 rounded border border-[var(--border-primary)] text-[var(--text-secondary)] hover:border-[var(--border-secondary)]"
                      >
                        取消
                      </button>
                    </div>
                  </div>
                ) : (
                  <pre className="max-h-44 overflow-auto whitespace-pre-wrap text-xs font-mono text-[var(--text-tertiary)] bg-[var(--bg-base)] border border-[var(--border-primary)] rounded-md p-2">
                    {currentValue}
                  </pre>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </CollapsibleSection>
  );
};

export default TemplateSection;
