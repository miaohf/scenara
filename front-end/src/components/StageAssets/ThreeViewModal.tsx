import React from 'react';
import { AlertCircle, Images, Loader2, RefreshCw, Wand2, X } from 'lucide-react';
import { Character } from '../../types';
import { useInterfaceLanguage } from '../../contexts/InterfaceLanguageContext';

interface ThreeViewModalProps {
  character: Character;
  onClose: () => void;
  onGenerate: (characterId: string) => void;
  onImageClick: (imageUrl: string) => void;
}

const ThreeViewModal: React.FC<ThreeViewModalProps> = ({ character, onClose, onGenerate, onImageClick }) => {
  const { text } = useInterfaceLanguage();
  const threeView = character.threeView;
  const isGenerating = threeView?.status === 'generating';
  const isCompleted = threeView?.status === 'completed' && !!threeView.imageUrl;
  const hasFailed = threeView?.status === 'failed';

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-[var(--border-secondary)] bg-[var(--bg-elevated)] shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-[var(--border-primary)] bg-[var(--bg-surface)] px-6">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 overflow-hidden rounded-full border border-[var(--border-secondary)] bg-[var(--bg-hover)]">
              {character.referenceImage && <img src={character.referenceImage} alt={character.name} className="h-full w-full object-cover object-top" />}
            </div>
            <Images className="h-4 w-4 text-[var(--accent-text)]" />
            <h3 className="text-sm font-bold text-[var(--text-primary)]">
              {character.name} — {text('角色三视图', 'Character Three-view')}
            </h3>
            {isCompleted && <span className="rounded border border-[var(--success-border)] bg-[var(--success-bg)] px-2 py-0.5 text-[10px] font-bold text-[var(--success-text)]">{text('已完成', 'READY')}</span>}
          </div>
          <button onClick={onClose} className="rounded p-2 text-[var(--text-tertiary)] hover:bg-[var(--error-hover-bg)] hover:text-[var(--error-text)]" aria-label={text('关闭', 'Close')}>
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {isGenerating ? (
            <div className="flex min-h-[360px] flex-col items-center justify-center text-center">
              <Loader2 className="mb-5 h-12 w-12 animate-spin text-[var(--accent)]" />
              <h4 className="mb-2 text-lg font-bold text-[var(--text-primary)]">{text('正在生成角色三视图...', 'Generating character three-view...')}</h4>
              <p className="max-w-lg text-sm text-[var(--text-tertiary)]">{text('将基于角色定妆图生成正面、侧面、背面全身视图和头像特写。', 'Creating front, side and back full-body views with a matching portrait from the casting reference.')}</p>
            </div>
          ) : isCompleted && threeView?.imageUrl ? (
            <div className="space-y-4">
              <img src={threeView.imageUrl} alt={`${character.name} three-view`} className="mx-auto max-h-[68vh] w-full cursor-pointer rounded-lg border border-[var(--border-primary)] object-contain" onClick={() => onImageClick(threeView.imageUrl!)} />
              <div className="flex justify-center">
                <button onClick={() => onGenerate(character.id)} className="flex items-center gap-2 rounded-lg border border-[var(--accent-border)] bg-[var(--accent-bg)] px-4 py-2 text-xs font-bold text-[var(--accent-text)] hover:bg-[var(--accent-hover-bg)]">
                  <RefreshCw className="h-3.5 w-3.5" />
                  {text('重新生成三视图', 'Regenerate Three-view')}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex min-h-[360px] flex-col items-center justify-center text-center">
              {hasFailed ? <AlertCircle className="mb-5 h-14 w-14 text-[var(--error)] opacity-70" /> : <Images className="mb-5 h-16 w-16 text-[var(--text-muted)] opacity-30" />}
              <h4 className="mb-2 text-lg font-bold text-[var(--text-primary)]">{text('角色三视图', 'Character Three-view')}</h4>
              <p className="mb-2 max-w-lg text-sm text-[var(--text-tertiary)]">{text('生成正面、侧面、背面三个全身视图，并在右侧增加同一角色的大头像，用于稳定身份、轮廓和服装结构。', 'Generate front, side and back full-body views plus a large portrait to stabilize identity, silhouette and wardrobe structure.')}</p>
              <p className="mb-8 max-w-md text-xs text-[var(--text-muted)]">{text('角色已有定妆图时，将以定妆图锁定身份和造型。', 'The casting image is used as the identity and design lock when available.')}</p>
              <button onClick={() => onGenerate(character.id)} disabled={!character.referenceImage && !character.visualPrompt} className="flex items-center gap-2 rounded-lg bg-[var(--btn-primary-bg)] px-6 py-3 text-sm font-bold text-[var(--btn-primary-text)] shadow-lg transition-colors hover:bg-[var(--btn-primary-hover)] disabled:cursor-not-allowed disabled:opacity-40">
                <Wand2 className="h-4 w-4" />
                {hasFailed ? text('重试生成', 'Retry Generation') : text('生成三视图', 'Generate Three-view')}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ThreeViewModal;
