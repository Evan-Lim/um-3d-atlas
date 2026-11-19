import { useEffect, useState } from 'react';
import { Icon } from './Icon';
import { useBottomSheetDrag } from '../hooks/useBottomSheetDrag';
import type { MapLayerVisibility } from '../types/map';

interface LayerControlsProps {
  open: boolean;
  visibility: MapLayerVisibility;
  is3D: boolean;
  darkMode: boolean;
  onToggleLayer: (key: keyof MapLayerVisibility) => void;
  onToggle3D: () => void;
  onToggleDarkMode: () => void;
  onResetCampus: () => void;
  onClose: () => void;
  stats: {
    faculties: number;
    buildings: number;
    rooms: number;
    nodes: number;
    edges: number;
    busRoutes: number;
  };
}

const LAYER_ROWS: { key: keyof MapLayerVisibility; label: string; color: string }[] = [
  { key: 'boundary', label: 'Campus boundary', color: '#1a73e8' },
  { key: 'faculties', label: 'Faculty & college overlays', color: '#5f84b8' },
  { key: 'buildings3d', label: '3D buildings & rooms', color: '#70757a' },
  { key: 'busRoutes', label: 'Shuttle & RapidKL lines', color: '#d9532f' },
  { key: 'pois', label: 'Bus stops, rail & gates', color: '#137333' },
  { key: 'joggingRoutes', label: 'Jogging routes & loops', color: '#2e7d5b' },
  { key: 'pathways', label: 'Footpaths & shortcuts', color: '#607d8b' },
  { key: 'roads', label: 'Campus roads', color: '#9aa0a6' },
  { key: 'labels', label: 'Zone & building labels', color: '#3c4043' },
];

export function LayerControls({
  open,
  visibility,
  is3D,
  darkMode,
  onToggleLayer,
  onToggle3D,
  onToggleDarkMode,
  onResetCampus,
  onClose,
  stats,
}: LayerControlsProps) {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    if (open) setCollapsed(false);
  }, [open]);

  const { isDragging, dragStyle, handleProps } = useBottomSheetDrag(collapsed, setCollapsed);

  if (!open) return null;

  const activeCount = LAYER_ROWS.filter((r) => visibility[r.key]).length;

  return (
    <aside
      className={`layers-panel m3-panel${collapsed ? ' is-collapsed' : ''}${isDragging ? ' is-dragging' : ''}`}
      style={dragStyle}
      aria-label="Map layers and appearance"
    >
      <div className="sheet-drag-zone" {...handleProps}>
        <button
          type="button"
          className="sheet-handle"
          aria-label={collapsed ? 'Expand map layers' : 'Collapse map layers'}
          aria-expanded={!collapsed}
        >
          <span className="sheet-handle__grip" />
        </button>

        <div className="layers-panel__head">
          <div style={{ minWidth: 0, flex: 1 }}>
            <p className="m3-title" style={{ fontSize: 17 }}>
              Map layers
            </p>
            <p className="m3-caption">
              {is3D ? '3D view' : '2D flat'} · {darkMode ? 'Dark' : 'Light'} · {activeCount}/{LAYER_ROWS.length} active
            </p>
          </div>
          <div className="sheet-head-actions">
            {collapsed && (
              <button
                type="button"
                className="m3-icon-btn m3-icon-btn--sm m3-icon-btn--tonal"
                onClick={onToggleDarkMode}
                aria-label={darkMode ? 'Switch to light theme' : 'Switch to dark theme'}
                title={darkMode ? 'Light theme' : 'Dark theme'}
              >
                <Icon name={darkMode ? 'sun' : 'moon'} size={15} />
              </button>
            )}
            <button type="button" className="m3-icon-btn m3-icon-btn--sm" onClick={onClose} aria-label="Close layers">
              <Icon name="close" size={16} />
            </button>
          </div>
        </div>
      </div>

      <div className="layers-panel__body m3-scroll">
        <div className="layers-quick-toggles">
          <div className="m3-segmented" role="group" aria-label="Map projection">
            <button
              type="button"
              className={`m3-segmented__item${is3D ? ' is-active' : ''}`}
              onClick={() => {
                if (!is3D) onToggle3D();
              }}
            >
              <Icon name="box" size={14} />
              3D Extrusion
            </button>
            <button
              type="button"
              className={`m3-segmented__item${!is3D ? ' is-active' : ''}`}
              onClick={() => {
                if (is3D) onToggle3D();
              }}
            >
              2D Flat
            </button>
          </div>

          <div className="m3-segmented" role="group" aria-label="Color appearance">
            <button
              type="button"
              className={`m3-segmented__item${!darkMode ? ' is-active' : ''}`}
              onClick={() => {
                if (darkMode) onToggleDarkMode();
              }}
            >
              <Icon name="sun" size={14} />
              Light
            </button>
            <button
              type="button"
              className={`m3-segmented__item${darkMode ? ' is-active' : ''}`}
              onClick={() => {
                if (!darkMode) onToggleDarkMode();
              }}
            >
              <Icon name="moon" size={14} />
              Dark
            </button>
          </div>
        </div>

        <div className="layers-panel__section" style={{ borderTop: 'none', marginTop: 2, paddingTop: 4 }}>
          {LAYER_ROWS.map(({ key, label, color }) => {
            const on = visibility[key];
            return (
              <label key={key} className="layer-row">
                <span className="layer-row__label">
                  <span className="layer-row__dot" style={{ background: color }} />
                  {label}
                </span>
                <span className="m3-switch">
                  <input type="checkbox" checked={on} onChange={() => onToggleLayer(key)} />
                  <span className="m3-switch__track" />
                </span>
              </label>
            );
          })}
        </div>

        <div className="layers-panel__section">
          <p className="m3-eyebrow" style={{ marginBottom: 6 }}>
            Campus Dataset
          </p>
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
          </div>
        </div>

        <div className="layers-panel__section">
          <p className="m3-eyebrow" style={{ marginBottom: 4 }}>
            Data Sources
          </p>
          <div className="layers-panel__source">
            <Icon name="database" size={14} />
            <span>
              OpenStreetMap &amp; verified UM campus records (UM, PPUM, UMSC, Wisma R&amp;D) · {stats.nodes.toLocaleString()} routing nodes ·{' '}
              {stats.busRoutes} RapidKL &amp; UM shuttle lines · 3 campus jogging loops.
            </span>
          </div>
          <div style={{ marginTop: 10 }}>
            <button type="button" className="m3-btn m3-btn--tonal m3-btn--sm" style={{ width: '100%' }} onClick={onResetCampus}>
              Reset camera to campus overview
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}
