import React from 'react';
import { MapPin, Clock, X, Edit2, Package } from 'lucide-react';
import { Shot, Character, Scene, Prop } from '../../types';
import HoverImagePreview from '../HoverImagePreview';

interface SceneContextProps {
  shot: Shot;
  scene?: Scene;
  scenes?: Scene[];
  characters: Character[];
  availableCharacters: Character[];
  props?: Prop[];
  availableProps?: Prop[];
  onAddCharacter: (charId: string) => void;
  onRemoveCharacter: (charId: string) => void;
  onVariationChange: (charId: string, varId: string) => void;
  onSceneChange?: (sceneId: string) => void;
  onAddProp?: (propId: string) => void;
  onRemoveProp?: (propId: string) => void;
}

const SceneContext: React.FC<SceneContextProps> = ({
  shot,
  scene,
  scenes = [],
  characters,
  availableCharacters,
  props = [],
  availableProps = [],
  onAddCharacter,
  onRemoveCharacter,
  onVariationChange,
  onSceneChange,
  onAddProp,
  onRemoveProp
}) => {
  return (
    <div className="grid grid-cols-1 @min-[640px]:grid-cols-3 gap-3">
      <div className="flex gap-3 min-w-0">
        <HoverImagePreview src={scene?.referenceImage} alt={scene?.location}>
          <div className={`w-16 h-16 bg-[var(--bg-elevated)] rounded-lg overflow-hidden border border-[var(--border-secondary)] ${scene?.referenceImage ? 'cursor-zoom-in' : ''}`}>
            {scene?.referenceImage ? (
              <img src={scene.referenceImage} className="w-full h-full object-cover" alt={scene.location} />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-[var(--bg-hover)]">
                <MapPin className="w-5 h-5 text-[var(--text-muted)]" />
              </div>
            )}
          </div>
        </HoverImagePreview>

        <div className="flex-1 min-w-0 flex flex-col justify-center gap-1">
          <span className="text-[10px] text-[var(--text-tertiary)] font-bold uppercase tracking-widest">场景</span>
          <div className="relative group min-w-0">
            {onSceneChange && scenes.length > 1 ? (
              <div className="relative flex items-center">
                <select
                  value={scene?.id || shot.sceneId}
                  onChange={(e) => onSceneChange(e.target.value)}
                  className="w-full appearance-none bg-transparent text-[var(--text-primary)] text-sm font-bold pr-6 outline-none hover:text-[var(--accent)] transition-colors cursor-pointer truncate"
                  title={scene?.location}
                >
                  {scenes.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.location}
                    </option>
                  ))}
                </select>
                <div className="absolute right-0 top-1/2 -translate-y-1/2 pointer-events-none text-[var(--text-tertiary)] group-hover:text-[var(--accent)]">
                  <Edit2 className="w-3 h-3" />
                </div>
              </div>
            ) : (
              <div className="text-[var(--text-primary)] text-sm font-bold truncate" title={scene?.location}>
                {scene?.location || '未知场景'}
              </div>
            )}
          </div>

          <div className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
            <Clock className="w-3 h-3 shrink-0" />
            <span className="truncate opacity-80" title={scene?.time}>
              {scene?.time || '未设置时间'}
            </span>
          </div>
          {scene?.atmosphere && (
            <p className="text-[11px] text-[var(--text-tertiary)] line-clamp-2 leading-relaxed" title={scene.atmosphere}>
              {scene.atmosphere}
            </p>
          )}
        </div>
      </div>
        <div className="flex flex-col gap-1.5 min-w-0">
          <span className="text-[10px] text-[var(--text-tertiary)] font-bold uppercase tracking-widest">角色</span>
          {characters.map((char) => {
            const hasVars = char.variations && char.variations.length > 0;
            const selectedVarId = shot.characterVariations?.[char.id];
            const selectedVar = char.variations?.find((v) => v.id === selectedVarId);
            const charImage = selectedVar?.referenceImage || char.referenceImage;

            return (
              <div
                key={char.id}
                className="flex items-center justify-between bg-[var(--bg-elevated)] rounded p-1.5 border border-[var(--border-primary)] group"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <HoverImagePreview src={charImage} alt={char.name}>
                    <div className={`w-6 h-6 rounded-full bg-[var(--border-secondary)] overflow-hidden flex-shrink-0 ${charImage ? 'cursor-zoom-in' : ''}`}>
                      {charImage && (
                        <img src={charImage} className="w-full h-full object-cover object-top" alt={char.name} />
                      )}
                    </div>
                  </HoverImagePreview>
                  <span className="text-[11px] text-[var(--text-secondary)] font-medium truncate">{char.name}</span>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  {hasVars && (
                    <select
                      value={selectedVarId || ''}
                      onChange={(e) => onVariationChange(char.id, e.target.value)}
                      className="text-[10px] max-w-[88px] bg-[var(--bg-hover)] text-[var(--text-tertiary)] border border-[var(--border-secondary)] rounded px-1 py-0.5 outline-none"
                    >
                      <option value="">基础造型</option>
                      {char.variations!.map((v) => (
                        <option key={v.id} value={v.id}>
                          服装: {v.name}
                        </option>
                      ))}
                    </select>
                  )}
                  <button
                    onClick={() => onRemoveCharacter(char.id)}
                    className="p-1 text-[var(--text-muted)] hover:text-[var(--error)] hover:bg-[var(--error-bg)] rounded transition-colors opacity-0 group-hover:opacity-100"
                    title="移除角色"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              </div>
            );
          })}

          {availableCharacters.length > 0 && (
            <select
              onChange={(e) => {
                if (e.target.value) {
                  onAddCharacter(e.target.value);
                  e.target.value = '';
                }
              }}
              className="bg-[var(--bg-elevated)] text-[11px] text-[var(--text-tertiary)] border border-[var(--border-secondary)] rounded px-2 py-1.5 outline-none focus:border-[var(--accent)]"
            >
              <option value="">+ 添加角色</option>
              {availableCharacters.map((char) => (
                <option key={char.id} value={char.id}>{char.name}</option>
              ))}
            </select>
          )}
        </div>

        <div className="flex flex-col gap-1.5 min-w-0">
          <span className="text-[10px] text-[var(--text-tertiary)] font-bold uppercase tracking-widest">道具</span>
          {props.map((prop) => (
            <div
              key={prop.id}
              className="flex items-center justify-between bg-[var(--bg-elevated)] rounded p-1.5 border border-[var(--border-primary)] group"
            >
              <div className="flex items-center gap-2 min-w-0">
                <HoverImagePreview src={prop.referenceImage} alt={prop.name}>
                  <div className={`w-6 h-6 rounded bg-[var(--border-secondary)] overflow-hidden flex-shrink-0 ${prop.referenceImage ? 'cursor-zoom-in' : ''}`}>
                    {prop.referenceImage ? (
                      <img src={prop.referenceImage} className="w-full h-full object-cover" alt={prop.name} />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <Package className="w-3 h-3 text-[var(--text-muted)]" />
                      </div>
                    )}
                  </div>
                </HoverImagePreview>
                <span className="text-[11px] text-[var(--text-secondary)] font-medium truncate">{prop.name}</span>
              </div>

              {onRemoveProp && (
                <button
                  onClick={() => onRemoveProp(prop.id)}
                  className="p-1 text-[var(--text-muted)] hover:text-[var(--error)] hover:bg-[var(--error-bg)] rounded transition-colors opacity-0 group-hover:opacity-100 shrink-0"
                  title="移除道具"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          ))}

          {onAddProp && availableProps.length > 0 && (
            <select
              onChange={(e) => {
                if (e.target.value) {
                  onAddProp(e.target.value);
                  e.target.value = '';
                }
              }}
              className="bg-[var(--bg-elevated)] text-[11px] text-[var(--text-tertiary)] border border-[var(--border-secondary)] rounded px-2 py-1.5 outline-none focus:border-[var(--accent)]"
            >
              <option value="">+ 添加道具</option>
              {availableProps.map((prop) => (
                <option key={prop.id} value={prop.id}>{prop.name}</option>
              ))}
            </select>
          )}

          {props.length === 0 && availableProps.length === 0 && (
            <p className="text-[10px] text-[var(--text-muted)]">暂无道具</p>
          )}
        </div>
    </div>
  );
};

export default SceneContext;
