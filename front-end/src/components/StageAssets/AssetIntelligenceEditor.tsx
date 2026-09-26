import React, { useState } from 'react';
import type { AssetDNA, SceneSpatialTopology } from '../../types';
import { useInterfaceLanguage } from '../../contexts/InterfaceLanguageContext';

const parseList = (value: string): string[] => Array.from(new Set(
  value.split(/[\n,，]/g).map((item) => item.trim()).filter(Boolean),
)).slice(0, 12);

const formatList = (value?: string[]): string => (value || []).join('，');

interface Props {
  assetDNA?: AssetDNA;
  spatialTopology?: SceneSpatialTopology;
  onSaveAssetDNA: (assetDNA: AssetDNA) => void;
  onSaveSpatialTopology?: (spatialTopology: SceneSpatialTopology) => void;
}

/** Small editable fact layer. It deliberately edits only explicit locks, not image prompts. */
const AssetIntelligenceEditor: React.FC<Props> = ({ assetDNA, spatialTopology, onSaveAssetDNA, onSaveSpatialTopology }) => {
  const { text } = useInterfaceLanguage();
  const [dna, setDna] = useState<AssetDNA>({
    identityAnchors: assetDNA?.identityAnchors || [],
    materialAnchors: assetDNA?.materialAnchors || [],
    colorAnchors: assetDNA?.colorAnchors || [],
    forbiddenChanges: assetDNA?.forbiddenChanges || [],
  });
  const [topology, setTopology] = useState<SceneSpatialTopology | undefined>(spatialTopology);
  const inputClass = 'mt-1 w-full rounded border border-[var(--border-primary)] bg-[var(--bg-elevated)] px-2 py-1 text-[10px] text-[var(--text-secondary)] outline-none focus:border-[var(--accent)]';
  const labelClass = 'mt-2 block text-[9px] font-mono uppercase tracking-wider text-[var(--text-muted)]';

  return (
    <details className="mt-3 border-t border-[var(--border-primary)] pt-3">
      <summary className="cursor-pointer text-[10px] font-bold uppercase tracking-wider text-[var(--text-tertiary)] hover:text-[var(--text-primary)]">
        {text('资产 DNA 与空间锁定', 'Asset DNA & Spatial Locks')}
      </summary>
      <p className="mt-1 text-[9px] text-[var(--text-muted)]">
        {text('这些是跨镜稳定事实，不会自动改写视觉提示词。', 'These are cross-shot facts and do not rewrite the visual prompt automatically.')}
      </p>
      {([
        ['identityAnchors', text('身份锚点', 'Identity anchors')],
        ['materialAnchors', text('材质锚点', 'Material anchors')],
        ['colorAnchors', text('色彩锚点', 'Color anchors')],
        ['forbiddenChanges', text('禁止变化', 'Forbidden changes')],
      ] as Array<[keyof AssetDNA, string]>).map(([key, label]) => (
        <label key={key} className={labelClass}>
          {label}
          <input value={formatList(dna[key])} onChange={(event) => setDna((current) => ({ ...current, [key]: parseList(event.target.value) }))} className={inputClass} />
        </label>
      ))}
      <button type="button" onClick={() => onSaveAssetDNA(dna)} className="mt-2 rounded border border-[var(--accent-border)] bg-[var(--accent-bg)] px-2 py-1 text-[9px] font-bold text-[var(--accent-text)]">
        {text('保存 DNA', 'Save DNA')}
      </button>
      {topology && onSaveSpatialTopology && (
        <div className="mt-3 border-t border-[var(--border-primary)] pt-2">
          <label className={labelClass}>
            {text('场景区域（逗号分隔）', 'Scene zones (comma-separated)')}
            <input value={topology.zones.map((zone) => zone.label).join('，')} onChange={(event) => setTopology((current) => ({ ...(current || { entrances: [], exits: [], landmarks: [], dominantAxis: '' }), zones: parseList(event.target.value).map((label, index) => ({ id: `zone-${index + 1}`, label })) }))} className={inputClass} />
          </label>
          <label className={labelClass}>
            {text('入口 / 出口 / 地标', 'Entrances / exits / landmarks')}
            <input value={`${formatList(topology.entrances)} | ${formatList(topology.exits)} | ${formatList(topology.landmarks)}`} onChange={(event) => { const [entrances = '', exits = '', landmarks = ''] = event.target.value.split('|'); setTopology((current) => ({ ...current!, entrances: parseList(entrances), exits: parseList(exits), landmarks: parseList(landmarks) })); }} className={inputClass} />
          </label>
          <label className={labelClass}>
            {text('主轴线', 'Dominant axis')}
            <input value={topology.dominantAxis} onChange={(event) => setTopology((current) => ({ ...current!, dominantAxis: event.target.value }))} className={inputClass} />
          </label>
          <label className={labelClass}>
            {text('摄影安全侧', 'Camera-safe side')}
            <input value={topology.cameraSafeSide || ''} onChange={(event) => setTopology((current) => ({ ...current!, cameraSafeSide: event.target.value || undefined }))} className={inputClass} />
          </label>
          <button type="button" onClick={() => topology && onSaveSpatialTopology(topology)} className="mt-2 rounded border border-[var(--accent-border)] bg-[var(--accent-bg)] px-2 py-1 text-[9px] font-bold text-[var(--accent-text)]">
            {text('保存场景拓扑', 'Save topology')}
          </button>
        </div>
      )}
    </details>
  );
};

export default AssetIntelligenceEditor;
