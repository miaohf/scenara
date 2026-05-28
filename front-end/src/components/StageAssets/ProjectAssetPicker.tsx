import React, { useState } from 'react';
import { X, Check, Link2, Search, MapPin, Package } from 'lucide-react';
import { Scene, Prop, SeriesProject } from '../../types';

type AssetType = 'scene' | 'prop';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  project: SeriesProject | null;
  assetType: AssetType;
  existingIds: string[];
  onSelectScene?: (scene: Scene) => void;
  onSelectProp?: (prop: Prop) => void;
}

const ProjectAssetPicker: React.FC<Props> = ({ isOpen, onClose, project, assetType, existingIds, onSelectScene, onSelectProp }) => {
  const [query, setQuery] = useState('');
  if (!isOpen || !project) return null;

  const isScene = assetType === 'scene';
  const items = isScene
    ? project.sceneLibrary.filter(s => !query.trim() || s.location.toLowerCase().includes(query.toLowerCase()))
    : project.propLibrary.filter(p => !query.trim() || p.name.toLowerCase().includes(query.toLowerCase()));

  const isAlreadyLinked = (id: string) => existingIds.includes(id);
  const Icon = isScene ? MapPin : Package;
  const title = isScene ? '从场景库添加' : '从道具库添加';
  const emptyText = isScene ? '场景库为空' : '道具库为空';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--bg-base)]/70 p-6" onClick={onClose}>
      <div className="w-full max-w-2xl bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-xl overflow-hidden max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-subtle)]">
          <h3 className="text-sm font-bold text-[var(--text-primary)] uppercase tracking-widest flex items-center gap-2">
            <Link2 className="w-4 h-4 text-[var(--accent-text)]" />{title}
          </h3>
          <button onClick={onClose} className="p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X className="w-4 h-4" /></button>
        </div>

        <div className="px-6 py-3 border-b border-[var(--border-subtle)]">
          <div className="relative">
            <Search className="w-4 h-4 text-[var(--text-muted)] absolute left-3 top-1/2 -translate-y-1/2" />
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder={isScene ? '搜索场景...' : '搜索道具...'} className="w-full pl-9 pr-3 py-2 bg-[var(--bg-primary)] border border-[var(--border-primary)] text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none rounded" autoFocus />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {items.length === 0 ? (
            <div className="text-center py-12 text-[var(--text-muted)]">
              <Icon className="w-8 h-8 mx-auto mb-3 opacity-30" />
              <p className="text-xs">{query ? '未找到匹配项' : emptyText}</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {items.map(item => {
                const linked = isAlreadyLinked(item.id);
                const label = isScene ? (item as Scene).location : (item as Prop).name;
                const subtitle = isScene
                  ? `${(item as Scene).time} · ${(item as Scene).atmosphere}`
                  : `${(item as Prop).category}`;
                const img = isScene ? (item as Scene).referenceImage : (item as Prop).referenceImage;

                return (
                  <button
                    key={item.id}
                    onClick={() => {
                      if (linked) return;
                      if (isScene && onSelectScene) onSelectScene(item as Scene);
                      if (!isScene && onSelectProp) onSelectProp(item as Prop);
                    }}
                    disabled={linked}
                    className={`text-left bg-[var(--bg-surface)] border rounded-lg overflow-hidden transition-all ${linked ? 'border-[var(--success-border)] opacity-60 cursor-not-allowed' : 'border-[var(--border-primary)] hover:border-[var(--accent-border)] cursor-pointer'}`}
                  >
                    <div className="aspect-video bg-[var(--bg-elevated)] relative">
                      {img ? (
                        <img src={img} alt={label} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center"><Icon className="w-6 h-6 text-[var(--text-muted)] opacity-30" /></div>
                      )}
                      {linked && <div className="absolute top-2 right-2 p-1 bg-[var(--success-bg)] rounded"><Check className="w-3 h-3 text-[var(--success-text)]" /></div>}
                    </div>
                    <div className="p-3">
                      <div className="text-xs font-bold text-[var(--text-primary)]">{label}</div>
                      <div className="text-[10px] text-[var(--text-muted)] font-mono">{subtitle}</div>
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

export default ProjectAssetPicker;
