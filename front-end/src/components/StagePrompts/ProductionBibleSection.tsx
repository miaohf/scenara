import React, { useState } from 'react';
import { BookOpen, Pencil, RotateCcw, Save, X } from 'lucide-react';
import type { ProductionBible, ScriptData } from '../../types';
import { deriveProductionBible, resolveProductionBible } from '../../services/productionBibleService';
import CollapsibleSection from './CollapsibleSection';
import { useInterfaceLanguage } from '../../contexts/InterfaceLanguageContext';

interface Props {
  scriptData: ScriptData;
  isExpanded: boolean;
  onToggle: () => void;
  onUpdate: (bible: ProductionBible) => void;
}

const FIELD_DEFINITIONS: Array<{
  key: Exclude<keyof ProductionBible, 'version' | 'updatedAt' | 'pinnedDecisions'>;
  zh: string;
  en: string;
  descriptionZh: string;
  descriptionEn: string;
}> = [
  { key: 'worldRules', zh: '世界与剧情事实', en: 'World & Story Rules', descriptionZh: '不会因构图或画风改变的剧情事实。', descriptionEn: 'Story facts that style and composition must never rewrite.' },
  { key: 'historicalContext', zh: '时代与地域背景', en: 'Historical Context', descriptionZh: '朝代、地域、服饰制度及必须排除的时代错位元素。', descriptionEn: 'Period, region, dress conventions, and forbidden anachronisms.' },
  { key: 'costumeRules', zh: '服装规则', en: 'Costume Rules', descriptionZh: '基础服装、换装名称及适用场景。', descriptionEn: 'Base wardrobes, named variations, and their scene scope.' },
  { key: 'sceneAnchors', zh: '场景锚点', en: 'Scene Anchors', descriptionZh: '地点、时间、氛围和空间连续性。', descriptionEn: 'Location, time, atmosphere, and spatial continuity.' },
  { key: 'characterVoiceRules', zh: '角色声音与行为', en: 'Character Voice', descriptionZh: '角色说话方式、性格和行为边界。', descriptionEn: 'Dialogue voice, personality, and behavior boundaries.' },
  { key: 'cameraLanguage', zh: '摄影语言', en: 'Camera Language', descriptionZh: '项目统一的镜头与剪辑约束。', descriptionEn: 'Project-wide camera and editorial constraints.' },
  { key: 'platformGuardrails', zh: '输出护栏', en: 'Output Guardrails', descriptionZh: '字幕、水印、重复人物等硬性限制。', descriptionEn: 'Hard constraints for text, watermarks, duplicated subjects, and layouts.' },
];

const ProductionBibleSection: React.FC<Props> = ({ scriptData, isExpanded, onToggle, onUpdate }) => {
  const { text } = useInterfaceLanguage();
  const resolved = resolveProductionBible(scriptData);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<ProductionBible>(resolved);

  const startEditing = () => {
    setDraft(resolveProductionBible(scriptData));
    setEditing(true);
  };

  const save = () => {
    onUpdate({
      ...draft,
      pinnedDecisions: draft.pinnedDecisions.map((item) => item.trim()).filter(Boolean),
      updatedAt: Date.now(),
    });
    setEditing(false);
  };

  const restoreDerived = () => {
    setDraft(deriveProductionBible(scriptData));
    setEditing(true);
  };

  return (
    <CollapsibleSection
      title={text('项目圣经', 'Production Bible')}
      icon={<BookOpen className="w-5 h-5" />}
      count={FIELD_DEFINITIONS.length + 1}
      isExpanded={isExpanded}
      onToggle={onToggle}
    >
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-surface)] px-3 py-2">
        <p className="text-xs text-[var(--text-tertiary)]">
          {text('这里记录项目事实。发生冲突时，它的优先级高于美术色板和旧分镜提示词。', 'This is the project fact layer. It overrides art palettes and stale shot prompts when they conflict.')}
        </p>
        <div className="flex items-center gap-2">
          {!editing ? (
            <>
              <button type="button" onClick={restoreDerived} className="flex items-center gap-1 text-xs px-2.5 py-1 rounded border border-[var(--warning-border)] text-[var(--warning-text)] hover:bg-[var(--warning-bg)]">
                <RotateCcw className="w-3 h-3" /> {text('载入当前资产', 'Load from Assets')}
              </button>
              <button type="button" onClick={startEditing} className="flex items-center gap-1 text-xs px-3 py-1.5 rounded bg-[var(--btn-primary-bg)] text-[var(--btn-primary-text)] hover:bg-[var(--btn-primary-hover)] shadow-sm">
                <Pencil className="w-3 h-3" /> {text('编辑项目圣经', 'Edit Production Bible')}
              </button>
            </>
          ) : (
            <>
              <button type="button" onClick={() => setEditing(false)} className="flex items-center gap-1 text-xs px-2.5 py-1 rounded border border-[var(--border-primary)] text-[var(--text-secondary)]">
                <X className="w-3 h-3" /> {text('取消', 'Cancel')}
              </button>
              <button type="button" onClick={save} className="flex items-center gap-1 text-xs px-3 py-1.5 rounded bg-[var(--btn-primary-bg)] text-[var(--btn-primary-text)] hover:bg-[var(--btn-primary-hover)] shadow-sm">
                <Save className="w-3 h-3" /> {text('保存更改', 'Save Changes')}
              </button>
            </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
        {FIELD_DEFINITIONS.map((field) => (
          <div key={field.key} className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-surface)] p-3">
            <h4 className="text-sm font-semibold text-[var(--text-primary)]">{text(field.zh, field.en)}</h4>
            <p className="mt-1 text-[10px] text-[var(--text-muted)]">{text(field.descriptionZh, field.descriptionEn)}</p>
            {editing ? (
              <textarea
                value={draft[field.key] || ''}
                onChange={(event) => setDraft((current) => ({ ...current, [field.key]: event.target.value }))}
                className="mt-2 w-full min-h-28 bg-[var(--bg-base)] text-[var(--text-primary)] border border-[var(--border-primary)] rounded-md p-2 text-xs font-mono focus:outline-none focus:border-[var(--accent)]"
              />
            ) : (
              <pre className="mt-2 max-h-36 overflow-auto whitespace-pre-wrap text-xs font-mono text-[var(--text-tertiary)] bg-[var(--bg-base)] border border-[var(--border-primary)] rounded-md p-2">{resolved[field.key]}</pre>
            )}
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-surface)] p-3">
        <h4 className="text-sm font-semibold text-[var(--text-primary)]">{text('已锁定决策', 'Pinned Decisions')}</h4>
        <p className="mt-1 text-[10px] text-[var(--text-muted)]">{text('每行一条；用于记录不能被后续生成器改写的人工决定。', 'One per line; use these for human decisions that later generators must not rewrite.')}</p>
        {editing ? (
          <textarea
            value={draft.pinnedDecisions.join('\n')}
            onChange={(event) => setDraft((current) => ({ ...current, pinnedDecisions: event.target.value.split('\n') }))}
            className="mt-2 w-full min-h-24 bg-[var(--bg-base)] text-[var(--text-primary)] border border-[var(--border-primary)] rounded-md p-2 text-xs font-mono focus:outline-none focus:border-[var(--accent)]"
          />
        ) : (
          <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap text-xs font-mono text-[var(--text-tertiary)] bg-[var(--bg-base)] border border-[var(--border-primary)] rounded-md p-2">{resolved.pinnedDecisions.length ? resolved.pinnedDecisions.map((item) => `- ${item}`).join('\n') : text('暂无已锁定决策', 'No pinned decisions')}</pre>
        )}
      </div>

      {editing && (
        <p className="text-right text-[10px] text-[var(--text-muted)]">
          {text('编辑完成后，点击顶部“保存更改”。', 'When you are done, click “Save Changes” at the top.')}
        </p>
      )}
    </CollapsibleSection>
  );
};

export default ProductionBibleSection;
