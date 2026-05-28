import React, { useState } from 'react';
import { X, Users, Check, Link2, Search } from 'lucide-react';
import { Character, SeriesProject } from '../../types';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  project: SeriesProject | null;
  existingCharacterIds: string[];
  onSelect: (character: Character) => void;
}

const CharacterLibraryPicker: React.FC<Props> = ({ isOpen, onClose, project, existingCharacterIds, onSelect }) => {
  const [query, setQuery] = useState('');
  if (!isOpen || !project) return null;

  const chars = project.characterLibrary.filter(c =>
    !query.trim() || c.name.toLowerCase().includes(query.toLowerCase())
  );

  const isAlreadyLinked = (charId: string) => existingCharacterIds.includes(charId);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--bg-base)]/70 p-6" onClick={onClose}>
      <div className="w-full max-w-2xl bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-xl overflow-hidden max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-subtle)]">
          <h3 className="text-sm font-bold text-[var(--text-primary)] uppercase tracking-widest flex items-center gap-2">
            <Link2 className="w-4 h-4 text-[var(--accent-text)]" />从角色库添加
          </h3>
          <button onClick={onClose} className="p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X className="w-4 h-4" /></button>
        </div>

        <div className="px-6 py-3 border-b border-[var(--border-subtle)]">
          <div className="relative">
            <Search className="w-4 h-4 text-[var(--text-muted)] absolute left-3 top-1/2 -translate-y-1/2" />
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索角色..." className="w-full pl-9 pr-3 py-2 bg-[var(--bg-primary)] border border-[var(--border-primary)] text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none rounded" autoFocus />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {chars.length === 0 ? (
            <div className="text-center py-12 text-[var(--text-muted)]">
              <Users className="w-8 h-8 mx-auto mb-3 opacity-30" />
              <p className="text-xs">{query ? '未找到匹配角色' : '角色库为空'}</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {chars.map(char => {
                const linked = isAlreadyLinked(char.id);
                return (
                  <button key={char.id} onClick={() => !linked && onSelect(char)} disabled={linked}
                    className={`text-left bg-[var(--bg-surface)] border rounded-lg overflow-hidden transition-all ${linked ? 'border-[var(--success-border)] opacity-60 cursor-not-allowed' : 'border-[var(--border-primary)] hover:border-[var(--accent-border)] cursor-pointer'}`}>
                    <div className="aspect-video bg-[var(--bg-elevated)] relative">
                      {char.referenceImage ? (
                        <img src={char.referenceImage} alt={char.name} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center"><Users className="w-6 h-6 text-[var(--text-muted)] opacity-30" /></div>
                      )}
                      {linked && <div className="absolute top-2 right-2 p-1 bg-[var(--success-bg)] rounded"><Check className="w-3 h-3 text-[var(--success-text)]" /></div>}
                    </div>
                    <div className="p-3">
                      <div className="text-xs font-bold text-[var(--text-primary)]">{char.name}</div>
                      <div className="text-[10px] text-[var(--text-muted)] font-mono">{char.gender} · {char.age}</div>
                      {linked && <div className="text-[9px] text-[var(--success-text)] mt-1 font-mono">已添加</div>}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default CharacterLibraryPicker;
