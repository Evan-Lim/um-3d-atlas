import { useState } from 'react';
import { Icon } from './Icon';
import type { MapLayerVisibility } from '../types/map';

interface LayerControlsProps {
  open: boolean;
  visibility: MapLayerVisibility;
  is3D: boolean;
  onToggleLayer: (key: keyof MapLayerVisibility) => void;
  onToggle3D: () => void;
  onResetCampus: () => void;
  onClose: () => void;
  stats: {
    buildings: number;
    rooms: number;
    faculties: number;
    nodes: number;
    edges: number;
    busRoutes: number;
  };
}

const LAYERS: { key: keyof MapLayerVisibility; label: string; color: string }[] = [
  { key: 'boundary', label: 'Campus boundary', color: '#24439c' },
  { key: 'faculties', label: 'Faculty zones', color: '#2f5bb7' },
  { key: 'buildings3d', label: 'Buildings', color: '#9aa3b8' },
  { key: 'roads', label: 'Roads', color: '#7d8597' },
  { key: 'pathways', label: 'Footpaths', color: '#4f8fa8' },
  { key: 'busRoutes', label: 'Transit lines', color: '#0c6a5e' },
  { key: 'pois', label: 'Transit stops & gates', color: '#5c6fa8' },
  { key: 'labels', label: 'Labels', color: '#171a21' },
];

export function LayerControls({
  open,
  visibility,
  is3D,
  onToggleLayer,
  onToggle3D,
  onResetCampus,
  onClose,
  stats,
}: LayerControlsProps) {
  const [sourcesOpen, setSourcesOpen] = useState(false);

  if (!open) return null;

  return (
    <aside className="layers-panel" aria-label="Map layers">
      <div className="layers-panel__head">
        <div>
          <p className="m3-subtitle" style={{ fontWeight: 600 }}>
            Map layers
          </p>
          <p className="m3-caption">{is3D ? '3D campus view' : 'Flat 2D view'}</p>
        </div>
        <button type="button" className="m3-icon-btn m3-icon-btn--sm" onClick={onClose} aria-label="Close layers">
          <Icon name="close" size={16} />
        </button>
      </div>

      <div className="layers-panel__body m3-scroll">
        {LAYERS.map((layer) => (
          <label className="layer-row" key={layer.key}>
            <span className="layer-row__label">
              <span className="layer-row__dot" style={{ background: layer.color }} />
              {layer.label}
            </span>
            <span className="m3-switch">
              <input
                type="checkbox"
                checked={visibility[layer.key]}
                onChange={() => onToggleLayer(layer.key)}
                aria-label={`Toggle ${layer.label}`}
              />
              <span className="m3-switch__track" />
            </span>
          </label>
        ))}

        <div className="layers-panel__section">
          <label className="layer-row">
            <span className="layer-row__label">
              <Icon name="box" size={15} />
              3D buildings
            </span>
            <span className="m3-switch">
              <input type="checkbox" checked={is3D} onChange={onToggle3D} aria-label="Toggle 3D view" />
              <span className="m3-switch__track" />
            </span>
          </label>
          <button type="button" className="m3-btn m3-btn--text m3-btn--sm" onClick={onResetCampus} style={{ marginTop: 4 }}>
            <Icon name="reset" size={15} />
            Reset view
          </button>
        </div>

        <div className="layers-panel__section">
          <button
            type="button"
            className="m3-btn m3-btn--text m3-btn--sm"
            onClick={() => setSourcesOpen((v) => !v)}
            aria-expanded={sourcesOpen}
            style={{ justifyContent: 'space-between', width: '100%', padding: '0 6px' }}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
              <Icon name="database" size={15} />
              Campus data
            </span>
            <Icon name={sourcesOpen ? 'chevronDown' : 'chevronRight'} size={14} />
          </button>

          {sourcesOpen && (
            <>
              <div className="layers-panel__stats">
                <div className="stat">
                  <div className="stat__value m3-mono">{stats.faculties}</div>
                  <div className="stat__label">Zones</div>
                </div>
                <div className="stat">
                  <div className="stat__value m3-mono">{stats.buildings}</div>
                  <div className="stat__label">Buildings</div>
                </div>
                <div className="stat">
                  <div className="stat__value m3-mono">{stats.rooms}</div>
                  <div className="stat__label">Rooms</div>
                </div>
                <div className="stat">
                  <div className="stat__value m3-mono">{stats.busRoutes}</div>
                  <div className="stat__label">Transit lines</div>
                </div>
                <div className="stat" style={{ gridColumn: 'span 2' }}>
                  <div className="stat__value m3-mono">
                    {stats.nodes.toLocaleString()} / {stats.edges.toLocaleString()}
                  </div>
                  <div className="stat__label">Routing nodes / edges</div>
                </div>
              </div>
              <div style={{ marginTop: 8 }}>
                <div className="layers-panel__source">
                  <Icon name="globe" size={13} />
                  <span>OpenStreetMap campus geometry · OpenFreeMap basemap</span>
                </div>
                <div className="layers-panel__source">
                  <Icon name="building" size={13} />
                  <span>UM directory: faculties, KK1–KK13, KPPI, IAS and PPUM</span>
                </div>
                <div className="layers-panel__source">
                  <Icon name="bus" size={13} />
                  <span>RapidKL T789 / T815 · UM shuttle · MRT & LRT feeder stops</span>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </aside>
  );
}
