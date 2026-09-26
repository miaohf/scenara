import React from 'react';
import { Aperture, Edit2, Check, X, UserPlus, Trash2, Plus } from 'lucide-react';
import { Shot, Character, ScriptData } from '../../types';
import InlineEditor from './InlineEditor';
import { STYLES } from './constants';
import { getShotDisplayLabel } from '../../services/storyboardIdUtils';
import { useInterfaceLanguage } from '../../contexts/InterfaceLanguageContext';

interface Props {
  shot: Shot;
  shotNumber: number;
  scriptData?: ScriptData;
  editingShotId: string | null;
  editingShotPrompt: string;
  editingShotCharactersId: string | null;
  editingShotActionId: string | null;
  editingShotActionText: string;
  editingShotDialogueText: string;
  onEditPrompt: (shotId: string, prompt: string) => void;
  onSavePrompt: () => void;
  onCancelPrompt: () => void;
  onEditCharacters: (shotId: string) => void;
  onAddCharacter: (shotId: string, charId: string) => void;
  onRemoveCharacter: (shotId: string, charId: string) => void;
  onCloseCharactersEdit: () => void;
  onEditAction: (shotId: string, action: string, dialogue: string) => void;
  onSaveAction: () => void;
  onCancelAction: () => void;
  onAddSubShot: (shotId: string) => void;
  onDeleteShot: (shotId: string) => void;
}

const ShotRow: React.FC<Props> = ({
  shot,
  shotNumber,
  scriptData,
  editingShotId,
  editingShotPrompt,
  editingShotCharactersId,
  editingShotActionId,
  editingShotActionText,
  editingShotDialogueText,
  onEditPrompt,
  onSavePrompt,
  onCancelPrompt,
  onEditCharacters,
  onAddCharacter,
  onRemoveCharacter,
  onCloseCharactersEdit,
  onEditAction,
  onSaveAction,
  onCancelAction,
  onAddSubShot,
  onDeleteShot
}) => {
  const { text } = useInterfaceLanguage();
  // 从shot.id中提取显示编号
  // 例如：shot-1 → "SHOT 001", shot-1-1 → "SHOT 001-1"
  const getShotDisplayNumber = () => getShotDisplayLabel(shot.id, shotNumber - 1);

  return (
    <div className="group bg-[var(--bg-base)] hover:bg-[var(--bg-primary)] transition-colors p-6 flex gap-5 xl:gap-6">
      {/* Shot ID & Tech Data */}
      <div className="w-28 flex-shrink-0 flex flex-col gap-4">
        <div className="flex items-center justify-between gap-2 text-xs font-mono text-[var(--text-tertiary)] group-hover:text-[var(--text-primary)] transition-colors">
          <span>{getShotDisplayNumber()}</span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => onAddSubShot(shot.id)}
              className="p-1 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-all opacity-0 group-hover:opacity-100"
              title={text('新增子分镜', 'Add sub-shot')}
            >
              <Plus className="w-3 h-3" />
            </button>
            <button
              onClick={() => onDeleteShot(shot.id)}
              className="p-1 rounded-md text-[var(--text-muted)] hover:text-[var(--error)] hover:bg-[var(--error)]/10 transition-all opacity-0 group-hover:opacity-100"
              title={text('删除分镜', 'Delete shot')}
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        </div>
        
        <div className="flex flex-col gap-2">
          <div className="px-2 py-1 bg-[var(--bg-elevated)] border border-[var(--border-primary)] text-[10px] font-mono text-[var(--text-tertiary)] uppercase text-center rounded">
            {shot.shotSize || 'MED'}
          </div>
          <div className="px-2 py-1 bg-[var(--bg-elevated)] border border-[var(--border-primary)] text-[10px] font-mono text-[var(--text-tertiary)] uppercase text-center rounded">
            {shot.cameraMovement}
          </div>
        </div>
      </div>

      {/* Main Action */}
      <div className="flex-1 xl:flex-none xl:w-[36%] xl:min-w-[14rem] xl:max-w-md space-y-4 min-w-0">
        {editingShotActionId === shot.id ? (
          <div className="space-y-3 p-4 bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg">
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-[var(--text-tertiary)] uppercase tracking-widest">{text('动作描述', 'Action')}</label>
              <textarea
                value={editingShotActionText}
                onChange={(e) => onEditAction(shot.id, e.target.value, editingShotDialogueText)}
                className={STYLES.editor.textarea}
                rows={3}
                placeholder={text('输入动作描述...', 'Describe the action...')}
              />
            </div>
            
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-[var(--text-tertiary)] uppercase tracking-widest">{text('台词（可选）', 'Dialogue (optional)')}</label>
              <textarea
                value={editingShotDialogueText}
                onChange={(e) => onEditAction(shot.id, editingShotActionText, e.target.value)}
                className={`${STYLES.editor.textarea} ${STYLES.editor.serif}`}
                rows={2}
                placeholder={text('输入台词（留空表示无台词）...', 'Enter dialogue (leave blank for none)...')}
              />
            </div>
            
            <div className="flex gap-2 pt-2 border-t border-[var(--border-primary)]">
              <button onClick={onSaveAction} className="px-3 py-1.5 bg-[var(--btn-primary-bg)] text-[var(--btn-primary-text)] text-xs font-bold rounded flex items-center gap-1 hover:bg-[var(--btn-primary-hover)] transition-colors">
                <Check className="w-3 h-3" />
                {text('保存', 'Save')}
              </button>
              <button onClick={onCancelAction} className="px-3 py-1.5 bg-[var(--bg-hover)] text-[var(--text-tertiary)] text-xs font-bold rounded flex items-center gap-1 hover:bg-[var(--border-secondary)] transition-colors">
                <X className="w-3 h-3" />
                {text('取消', 'Cancel')}
              </button>
            </div>
          </div>
        ) : (
          <div className="relative group/action">
            <div className="flex items-start gap-2">
              <p className="text-[var(--text-secondary)] text-sm leading-7 font-medium min-w-0 flex-1">
                {shot.actionSummary}
              </p>
              <button
                onClick={() => onEditAction(shot.id, shot.actionSummary, shot.dialogue || '')}
                className="opacity-0 group-hover/action:opacity-100 transition-opacity p-1.5 hover:bg-[var(--bg-hover)] rounded flex-shrink-0"
                title={text('编辑动作和台词', 'Edit action and dialogue')}
              >
                <Edit2 className="w-3.5 h-3.5 text-[var(--text-tertiary)] hover:text-[var(--text-primary)]" />
              </button>
            </div>
            
            {shot.dialogue && (
              <div className="pl-6 border-l-2 border-[var(--border-primary)] group-hover:border-[var(--border-secondary)] transition-colors py-1 mt-3">
                <p className="text-[var(--text-tertiary)] font-serif italic text-sm">"{shot.dialogue}"</p>
              </div>
            )}
          </div>
        )}
        
        {/* Characters */}
        <div className="pt-2">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-widest">{text('角色', 'Characters')}</span>
            <button
              onClick={() => onEditCharacters(shot.id)}
              className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-[var(--bg-hover)] rounded"
              title={text('编辑角色列表', 'Edit character list')}
            >
              <Edit2 className="w-3 h-3 text-[var(--text-tertiary)] hover:text-[var(--text-primary)]" />
            </button>
          </div>
          
          {editingShotCharactersId === shot.id ? (
            <div className="space-y-3 p-3 bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg">
              <div className="space-y-2">
                <div className="text-[10px] text-[var(--text-tertiary)] uppercase tracking-wider">{text('当前角色', 'Current characters')}</div>
                <div className="flex flex-wrap gap-2">
                  {shot.characters.length === 0 ? (
                    <span className="text-xs text-[var(--text-muted)] italic">{text('无角色', 'No characters')}</span>
                  ) : (
                    shot.characters.map(cid => {
                      const char = scriptData?.characters.find(c => c.id === cid);
                      return char ? (
                        <div key={cid} className="flex items-center gap-1 text-[10px] uppercase font-bold tracking-wider text-[var(--text-secondary)] border border-[var(--border-secondary)] px-2 py-1 rounded-md bg-[var(--bg-elevated)]">
                          <span>{char.name}</span>
                          <button
                            onClick={() => onRemoveCharacter(shot.id, cid)}
                            className="ml-1 hover:text-[var(--error-text)] transition-colors"
                            title={text('移除角色', 'Remove character')}
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      ) : null;
                    })
                  )}
                </div>
              </div>
              
              <div className="space-y-2">
                <div className="text-[10px] text-[var(--text-tertiary)] uppercase tracking-wider">{text('添加角色', 'Add characters')}</div>
                <div className="flex flex-wrap gap-2">
                  {scriptData?.characters
                    .filter(char => !shot.characters.includes(char.id))
                    .map(char => (
                      <button
                        key={char.id}
                        onClick={() => onAddCharacter(shot.id, char.id)}
                        className="flex items-center gap-1 text-[10px] uppercase font-bold tracking-wider text-[var(--text-tertiary)] border border-[var(--border-primary)] px-2 py-1 rounded-md bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] hover:border-[var(--border-secondary)] transition-colors"
                        title={text('添加角色', 'Add character')}
                      >
                        <UserPlus className="w-3 h-3" />
                        <span>{char.name}</span>
                      </button>
                    ))}
                  {scriptData?.characters.filter(char => !shot.characters.includes(char.id)).length === 0 && (
                    <span className="text-xs text-[var(--text-muted)] italic">{text('所有角色已添加', 'All characters added')}</span>
                  )}
                </div>
              </div>
              
              <div className="pt-2 border-t border-[var(--border-primary)]">
                <button
                  onClick={onCloseCharactersEdit}
                  className="px-3 py-1.5 bg-[var(--bg-hover)] text-[var(--text-secondary)] text-xs font-bold rounded flex items-center gap-1 hover:bg-[var(--border-secondary)] transition-colors"
                >
                  <Check className="w-3 h-3" />
                  {text('完成', 'Done')}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2 opacity-50 group-hover:opacity-100 transition-opacity">
              {shot.characters.length === 0 ? (
                <span className="text-[10px] text-[var(--text-muted)] italic">{text('无角色', 'No characters')}</span>
              ) : (
                shot.characters.map(cid => {
                  const char = scriptData?.characters.find(c => c.id === cid);
                  return char ? (
                    <span key={cid} className="text-[10px] uppercase font-bold tracking-wider text-[var(--text-tertiary)] border border-[var(--border-primary)] px-2 py-0.5 rounded-full bg-[var(--bg-elevated)]">
                      {char.name}
                    </span>
                  ) : null;
                })
              )}
            </div>
          )}
        </div>

        {/* Mobile Prompt Editor */}
        <div className="xl:hidden pt-4 border-t border-[var(--border-subtle)]">
          <div className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-widest mb-2 flex items-center gap-2 justify-between">
            <span className="flex items-center gap-2">
              <Aperture className="w-3 h-3" /> {text('画面提示词', 'Visual Prompt')}
            </span>
            {editingShotId !== shot.id && (
              <button
                onClick={() => onEditPrompt(shot.id, shot.keyframes[0]?.visualPrompt || '')}
                className="p-1.5 bg-[var(--bg-hover)] hover:bg-[var(--border-secondary)] rounded transition-colors"
                title={text('编辑提示词', 'Edit prompt')}
              >
                <Edit2 className="w-3 h-3 text-[var(--text-tertiary)]" />
              </button>
            )}
          </div>
          <InlineEditor
            isEditing={editingShotId === shot.id}
            value={editingShotId === shot.id ? editingShotPrompt : shot.keyframes[0]?.visualPrompt || ''}
            onEdit={() => onEditPrompt(shot.id, shot.keyframes[0]?.visualPrompt || '')}
            onChange={(val) => onEditPrompt(shot.id, val)}
            onSave={onSavePrompt}
            onCancel={onCancelPrompt}
            placeholder={text('输入画面提示词...', 'Enter visual prompt...')}
            rows={6}
            mono={true}
            showEditButton={false}
          />
        </div>
      </div>

      {/* Prompt Preview (Desktop) */}
      <div className="hidden xl:block flex-1 min-w-0 pl-6 border-l border-[var(--border-subtle)]">
        <div className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-widest mb-2 flex items-center gap-2 justify-between">
          <span className="flex items-center gap-2">
            <Aperture className="w-3 h-3" /> {text('画面提示词', 'Visual Prompt')}
          </span>
          {editingShotId !== shot.id && (
            <button
              onClick={() => onEditPrompt(shot.id, shot.keyframes[0]?.visualPrompt || '')}
              className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-[var(--bg-hover)] rounded"
              title={text('编辑提示词', 'Edit prompt')}
            >
              <Edit2 className="w-3 h-3 text-[var(--text-tertiary)] hover:text-[var(--text-primary)]" />
            </button>
          )}
        </div>
        <InlineEditor
          isEditing={editingShotId === shot.id}
          value={editingShotId === shot.id ? editingShotPrompt : shot.keyframes[0]?.visualPrompt || ''}
          onEdit={() => onEditPrompt(shot.id, shot.keyframes[0]?.visualPrompt || '')}
          onChange={(val) => onEditPrompt(shot.id, val)}
          onSave={onSavePrompt}
          onCancel={onCancelPrompt}
          placeholder={text('输入画面提示词...', 'Enter visual prompt...')}
          rows={8}
          mono={true}
          showEditButton={false}
        />
      </div>
    </div>
  );
};

export default ShotRow;
