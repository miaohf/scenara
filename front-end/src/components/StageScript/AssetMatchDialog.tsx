import React, { useState } from 'react';
import { X, Users, MapPin, Package, Check, ArrowRight, Link2, Plus } from 'lucide-react';
import { AssetMatchResult, AssetMatchItem } from '../../services/assetMatchService';
import { Character, Scene, Prop } from '../../types';

interface Props {
  matches: AssetMatchResult;
  onConfirm: (finalMatches: AssetMatchResult) => void;
  onCancel: () => void;
}

const MatchRow: React.FC<{
  item: AssetMatchItem<any>;
  getAiLabel: (a: any) => string;
  getLibLabel: (a: any) => string;
  getLibImage: (a: any) => string | undefined;
  onToggle: () => void;
}> = ({ item, getAiLabel, getLibLabel, getLibImage, onToggle }) => {
  const hasMatch = !!item.libraryAsset;
  const hasImage = hasMatch && !!getLibImage(item.libraryAsset!);

  return (
    <div className={`flex items-center gap-3 px-4 py-3 rounded-lg border transition-all ${
      hasMatch && item.reuse
        ? 'bg-[var(--accent-bg)] border-[var(--accent-border)]'
        : 'bg-[var(--bg-surface)] border-[var(--border-primary)]'
    }`}>
      <div className="flex-1 min-w-0">
        <div className="text-xs font-bold text-[var(--text-primary)] truncate">
          {getAiLabel(item.aiAsset)}
        </div>
        <div className="text-[10px] text-[var(--text-muted)] font-mono mt-0.5">
          AI 解析结果
        </div>
      </div>

      {hasMatch ? (
        <>
          <ArrowRight className="w-3 h-3 text-[var(--text-muted)] flex-shrink-0" />
          <div className="flex items-center gap-2 flex-shrink-0">
            {hasImage && (
              <div className="w-8 h-8 rounded overflow-hidden bg-[var(--bg-elevated)] flex-shrink-0">
                <img src={getLibImage(item.libraryAsset!)} alt="" className="w-full h-full object-cover" />
              </div>
            )}
            <div className="min-w-0">
              <div className="text-xs font-medium text-[var(--text-primary)] truncate">
                {getLibLabel(item.libraryAsset!)}
              </div>
              <div className="text-[10px] text-[var(--text-muted)] font-mono">
                {hasImage ? '已有参考图' : '无参考图'}
              </div>
            </div>
          </div>
          <button
            onClick={onToggle}
            className={`flex-shrink-0 px-3 py-1.5 rounded text-[10px] font-bold uppercase tracking-widest transition-all border ${
              item.reuse
                ? 'bg-[var(--accent-bg)] text-[var(--accent-text)] border-[var(--accent-border)] hover:bg-[var(--accent-bg-hover)]'
                : 'bg-[var(--bg-surface)] text-[var(--text-muted)] border-[var(--border-primary)] hover:text-[var(--text-primary)] hover:border-[var(--border-secondary)]'
            }`}
          >
            {item.reuse ? (
              <span className="flex items-center gap-1"><Link2 className="w-3 h-3" />复用</span>
            ) : (
              <span className="flex items-center gap-1"><Plus className="w-3 h-3" />新建</span>
            )}
          </button>
        </>
      ) : (
        <span className="text-[10px] text-[var(--text-muted)] font-mono uppercase tracking-widest flex items-center gap-1 flex-shrink-0">
          <Plus className="w-3 h-3" />新建
        </span>
      )}
    </div>
  );
};

const AssetMatchDialog: React.FC<Props> = ({ matches, onConfirm, onCancel }) => {
  const [local, setLocal] = useState<AssetMatchResult>(() => ({
    ...matches,
    characters: matches.characters.map(m => ({ ...m })),
    scenes: matches.scenes.map(m => ({ ...m })),
    props: matches.props.map(m => ({ ...m })),
  }));

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onCancel();
  };

  const toggleChar = (idx: number) => {
    setLocal(prev => {
      const next = { ...prev, characters: [...prev.characters] };
      next.characters[idx] = { ...next.characters[idx], reuse: !next.characters[idx].reuse };
      return next;
    });
  };

  const toggleScene = (idx: number) => {
    setLocal(prev => {
      const next = { ...prev, scenes: [...prev.scenes] };
      next.scenes[idx] = { ...next.scenes[idx], reuse: !next.scenes[idx].reuse };
      return next;
    });
  };

  const toggleProp = (idx: number) => {
    setLocal(prev => {
      const next = { ...prev, props: [...prev.props] };
      next.props[idx] = { ...next.props[idx], reuse: !next.props[idx].reuse };
      return next;
    });
  };

  const reuseCount =
    local.characters.filter(m => m.reuse && m.libraryAsset).length +
    local.scenes.filter(m => m.reuse && m.libraryAsset).length +
    local.props.filter(m => m.reuse && m.libraryAsset).length;

  const matchCount =
    local.characters.filter(m => m.libraryAsset).length +
    local.scenes.filter(m => m.libraryAsset).length +
    local.props.filter(m => m.libraryAsset).length;

  const charMatches = local.characters.filter(m => m.libraryAsset);
  const sceneMatches = local.scenes.filter(m => m.libraryAsset);
  const propMatches = local.props.filter(m => m.libraryAsset);
  const charNew = local.characters.filter(m => !m.libraryAsset);
  const sceneNew = local.scenes.filter(m => !m.libraryAsset);
  const propNew = local.props.filter(m => !m.libraryAsset);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--bg-base)]/70 p-6" onClick={handleBackdropClick}>
      <div className="w-full max-w-2xl bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-xl overflow-hidden max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-subtle)]">
          <div>
            <h3 className="text-sm font-bold text-[var(--text-primary)] uppercase tracking-widest flex items-center gap-2">
              <Link2 className="w-4 h-4 text-[var(--accent-text)]" />
              检测到项目库资产匹配
            </h3>
            <p className="text-[10px] text-[var(--text-muted)] mt-1">
              找到 {matchCount} 项匹配，已选择复用 {reuseCount} 项。复用的资产将直接继承参考图和提示词。
            </p>
          </div>
          <button onClick={onCancel} className="p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)]">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
          {/* Characters */}
          {(charMatches.length > 0 || charNew.length > 0) && (
            <section>
              <h4 className="text-[10px] font-bold text-[var(--text-tertiary)] uppercase tracking-widest mb-3 flex items-center gap-2">
                <Users className="w-3.5 h-3.5" />
                角色 ({local.characters.length})
              </h4>
              <div className="space-y-2">
                {local.characters.map((m, i) => (
                  <MatchRow
                    key={m.aiAsset.id}
                    item={m}
                    getAiLabel={(c: Character) => c.name}
                    getLibLabel={(c: Character) => `${c.name} (v${c.version || 1})`}
                    getLibImage={(c: Character) => c.referenceImage}
                    onToggle={() => toggleChar(i)}
                  />
                ))}
              </div>
            </section>
          )}

          {/* Scenes */}
          {(sceneMatches.length > 0 || sceneNew.length > 0) && (
            <section>
              <h4 className="text-[10px] font-bold text-[var(--text-tertiary)] uppercase tracking-widest mb-3 flex items-center gap-2">
                <MapPin className="w-3.5 h-3.5" />
                场景 ({local.scenes.length})
              </h4>
              <div className="space-y-2">
                {local.scenes.map((m, i) => (
                  <MatchRow
                    key={m.aiAsset.id}
                    item={m}
                    getAiLabel={(s: Scene) => s.location}
                    getLibLabel={(s: Scene) => s.location}
                    getLibImage={(s: Scene) => s.referenceImage}
                    onToggle={() => toggleScene(i)}
                  />
                ))}
              </div>
            </section>
          )}

          {/* Props */}
          {(propMatches.length > 0 || propNew.length > 0) && (
            <section>
              <h4 className="text-[10px] font-bold text-[var(--text-tertiary)] uppercase tracking-widest mb-3 flex items-center gap-2">
                <Package className="w-3.5 h-3.5" />
                道具 ({local.props.length})
              </h4>
              <div className="space-y-2">
                {local.props.map((m, i) => (
                  <MatchRow
                    key={m.aiAsset.id}
                    item={m}
                    getAiLabel={(p: Prop) => p.name}
                    getLibLabel={(p: Prop) => p.name}
                    getLibImage={(p: Prop) => p.referenceImage}
                    onToggle={() => toggleProp(i)}
                  />
                ))}
              </div>
            </section>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-[var(--border-subtle)]">
          <button
            onClick={onCancel}
            className="px-4 py-2 bg-[var(--bg-surface)] text-[var(--text-tertiary)] border border-[var(--border-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--border-primary)] rounded-lg text-xs font-bold uppercase tracking-wide transition-all"
          >
            全部新建
          </button>
          <button
            onClick={() => onConfirm(local)}
            className="px-4 py-2 bg-[var(--btn-primary-bg)] text-[var(--btn-primary-text)] hover:bg-[var(--btn-primary-hover)] rounded-lg text-xs font-bold uppercase tracking-wide transition-all flex items-center gap-2 shadow-lg shadow-[var(--btn-primary-shadow)]"
          >
            <Check className="w-3.5 h-3.5" />
            确认 ({reuseCount} 项复用)
          </button>
        </div>
      </div>
    </div>
  );
};

export default AssetMatchDialog;
