import React, { useState } from 'react';
import { Edit3, Save, AlertCircle, Camera, RefreshCw } from 'lucide-react';

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
  label = '提示词',
  placeholder = '输入视觉描述...',
  maxHeight = 'max-h-[260px]',
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editedPrompt, setEditedPrompt] = useState(prompt);

  const handleStartEdit = () => {
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
          {label}
        </label>
        {!isEditing && (
          <div className="flex items-center gap-0.5 shrink-0">
            {onRegenerate && (
              <button
                onClick={onRegenerate}
                disabled={isRegenerating}
                className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors p-1 hover:bg-[var(--bg-hover)] rounded disabled:opacity-40 disabled:cursor-not-allowed"
                title="重新生成提示词（按当前项目风格，不会自动生图）"
                aria-label="重新生成提示词"
              >
                <RefreshCw className={`w-3 h-3 ${isRegenerating ? 'animate-spin' : ''}`} />
              </button>
            )}
            <button
              onClick={handleStartEdit}
              disabled={isRegenerating}
              className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors p-1 hover:bg-[var(--bg-hover)] rounded disabled:opacity-40"
              title="手工改写提示词"
              aria-label="手工改写提示词"
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
            placeholder={placeholder}
            autoFocus
          />
          <div className="flex gap-2">
            <button
              onClick={handleSave}
              className="flex-1 py-1.5 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--text-primary)] rounded text-[10px] font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 transition-colors"
            >
              <Save className="w-3 h-3" />
              保存
            </button>
            <button
              onClick={handleCancel}
              className="flex-1 py-1.5 bg-[var(--bg-hover)] hover:bg-[var(--border-secondary)] text-[var(--text-secondary)] rounded text-[10px] font-bold uppercase tracking-wider transition-colors"
            >
              取消
            </button>
          </div>
        </div>
      ) : (
        <div className={`flex-1 bg-[var(--nav-hover-bg)] border border-[var(--border-primary)] rounded-lg p-3 overflow-y-auto ${maxHeight}`}>
          {prompt ? (
            <p className="text-[11px] text-[var(--text-tertiary)] leading-relaxed font-mono">
              {prompt}
            </p>
          ) : (
            <div className="flex items-start gap-2 text-[var(--text-muted)]">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <p className="text-[10px] leading-relaxed">
                未设置提示词。可点刷新图标自动生成，或点编辑图标手工填写。
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default PromptEditor;
