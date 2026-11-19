import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon, type IconName } from './Icon';
import { useBottomSheetDrag } from '../hooks/useBottomSheetDrag';
import { computeWalkMetrics, type ModeComparison } from '../utils/atlasUtils';
import type { ComputedRoute, RouteMode, RouteStep, SearchItem } from '../types/map';

interface DirectionsPanelProps {
  open: boolean;
  navActive: boolean;
  items: SearchItem[];
  origin: SearchItem | null;
  destination: SearchItem | null;
  mode: RouteMode;
  stepFree: boolean;
  route: ComputedRoute | null;
  modeComparison: ModeComparison;
  pickTarget: 'origin' | 'destination' | null;
  hasUserLocation: boolean;
  locating: boolean;
  onUseCurrentLocation: () => void;
  onSetOrigin: (item: SearchItem | null) => void;
  onSetDestination: (item: SearchItem | null) => void;
  onSwap: () => void;
  onChangeMode: (mode: RouteMode) => void;
  onToggleStepFree: (enabled: boolean) => void;
  onTogglePickTarget: (target: 'origin' | 'destination') => void;
  onStartNavigation: () => void;
  onShareRoute: () => void;
  onSelectStep: (step: RouteStep) => void;
  onClose: () => void;
}

const MODES: { id: RouteMode; label: string; icon: IconName }[] = [
  { id: 'walk', label: 'Walk', icon: 'walk' },
  { id: 'bus', label: 'Bus', icon: 'bus' },
  { id: 'drive', label: 'Drive', icon: 'car' },
];

const STEP_META: Record<RouteStep['kind'], { icon: IconName; label: string }> = {
  shortcut: { icon: 'directions', label: 'Shortcut' },
  steps: { icon: 'arrowUp', label: 'Stairs' },
  footway: { icon: 'walk', label: 'Path' },
  road: { icon: 'walk', label: 'Road' },
  indoor: { icon: 'door', label: 'Indoor' },
  bus: { icon: 'bus', label: 'Bus' },
};

function formatDistance(meters: number): string {
  if (meters >= 1000) return `${(meters / 1000).toFixed(2)} km`;
  return `${Math.round(meters)} m`;
}

function searchPool(items: SearchItem[], q: string): SearchItem[] {
  const s = q.trim().toLowerCase();
  if (!s) {
    return items
      .filter(
        (it) =>
          it.kind === 'rail_station' || it.kind === 'gate' || it.kind === 'faculty' || it.kind === 'building',
      )
      .slice(0, 10);
  }
  const scored: { item: SearchItem; score: number }[] = [];
  for (const it of items) {
    const t = it.title.toLowerCase();
    if (!t.includes(s) && !it.subtitle.toLowerCase().includes(s) && !it.keywords.toLowerCase().includes(s)) continue;
    let score = t === s ? 100 : t.startsWith(s) ? 60 : t.includes(s) ? 35 : 20;
    if (it.kind === 'rail_station') score += 10;
    if (it.kind === 'room') score += 6;
    if (it.kind === 'building') score += 4;
    scored.push({ item: it, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 12).map((x) => x.item);
}

interface EndpointInputProps {
  badge: 'A' | 'B';
  placeholder: string;
  value: SearchItem | null;
  items: SearchItem[];
  picking: boolean;
  onSelect: (item: SearchItem | null) => void;
  onTogglePick: () => void;
}

function EndpointInput({
  badge,
  placeholder,
  value,
  items,
  picking,
  onSelect,
  onTogglePick,
}: EndpointInputProps) {
  const [text, setText] = useState('');
  const [focused, setFocused] = useState(false);
  const suggestions = useMemo(() => searchPool(items, text), [items, text]);
  const displayText = focused ? text : value ? value.title : '';

  return (
    <div style={{ position: 'relative', flex: 1, minWidth: 0 }}>
      <div className={`endpoint${picking ? ' is-picking' : ''}`}>
        <span className={`endpoint__badge${badge === 'B' ? ' endpoint__badge--b' : ''}`}>{badge}</span>
        <input
          value={displayText}
          onFocus={() => {
            setFocused(true);
            setText(value ? value.title : '');
          }}
          onBlur={() => setTimeout(() => setFocused(false), 160)}
          onChange={(e) => setText(e.target.value)}
          placeholder={picking ? 'Click the map to place' : placeholder}
          aria-label={badge === 'A' ? 'Starting point' : 'Destination'}
        />
        {value && (
          <button
            type="button"
            className="m3-icon-btn m3-icon-btn--sm"
            onClick={() => {
              onSelect(null);
              setText('');
            }}
            aria-label={badge === 'A' ? 'Clear starting point' : 'Clear destination'}
          >
            <Icon name="close" size={13} />
          </button>
        )}
        <button
          type="button"
          className={`m3-icon-btn m3-icon-btn--sm${picking ? ' m3-icon-btn--tonal' : ''}`}
          onClick={onTogglePick}
          aria-label={
            picking
              ? 'Cancel map selection'
              : badge === 'A'
                ? 'Pick starting point on map'
                : 'Pick destination on map'
          }
        >
          <Icon name="crosshair" size={15} />
        </button>
      </div>

      {focused && suggestions.length > 0 && (
        <div className="endpoint__suggest m3-scroll">
          {suggestions.map((it) => (
            <button
              key={`${it.kind}:${it.id}`}
              type="button"
              className="endpoint__suggest-item"
              onMouseDown={(e) => {
                e.preventDefault();
                onSelect(it);
                setText(it.title);
                setFocused(false);
              }}
            >
              <span className="endpoint__suggest-title">{it.title}</span>
              <span className="endpoint__suggest-sub">{it.subtitle}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function DirectionsPanel({
  open,
  navActive,
  items,
  origin,
  destination,
  mode,
  stepFree,
  route,
  modeComparison,
  pickTarget,
  hasUserLocation,
  locating,
  onUseCurrentLocation,
  onSetOrigin,
  onSetDestination,
  onSwap,
  onChangeMode,
  onToggleStepFree,
  onTogglePickTarget,
  onStartNavigation,
  onShareRoute,
  onSelectStep,
  onClose,
}: DirectionsPanelProps) {
  const quickDemos = useMemo(() => {
    const findMatch = (needle: string) =>
      items.find(
        (i) =>
          i.title.toLowerCase().includes(needle.toLowerCase()) ||
          i.keywords.toLowerCase().includes(needle.toLowerCase()),
      );
    const phileo = findMatch('MRT Phileo Damansara');
    const lrtUni = findMatch('LRT Universiti');
    const fsktm = findMatch('FSKTM Block B') || findMatch('FSKTM');
    const engine = findMatch('Menara Kejuruteraan') || findMatch('Faculty of Engineering');
    const lib = findMatch('Perpustakaan Utama');
    const kppi = findMatch('KPPI');

    const out: { label: string; sub: string; a: SearchItem; b: SearchItem; recMode: RouteMode }[] = [];
    if (phileo && fsktm) {
      out.push({ label: 'MRT Phileo Damansara → FSKTM', sub: 'RapidKL T815 + walk', a: phileo, b: fsktm, recMode: 'bus' });
    }
    if (lrtUni && lib) {
      out.push({ label: 'LRT Universiti → Main Library', sub: 'RapidKL T789 + campus path', a: lrtUni, b: lib, recMode: 'bus' });
    }
    if (fsktm && engine) {
      out.push({ label: 'FSKTM → Engineering Tower', sub: 'Walk via campus shortcuts', a: fsktm, b: engine, recMode: 'walk' });
    }
    if (lib && kppi) {
      out.push({ label: 'Main Library → KPPI Research Hub', sub: 'Walk or UM Shuttle BA', a: lib, b: kppi, recMode: 'walk' });
    }
    return out;
  }, [items]);

  const walkMetrics = useMemo(() => computeWalkMetrics(route), [route]);

  const [collapsed, setCollapsed] = useState(false);
  const wasPickingRef = useRef(false);

  useEffect(() => {
    if (open) setCollapsed(false);
  }, [open]);

  useEffect(() => {
    if (pickTarget) {
      wasPickingRef.current = true;
      setCollapsed(true);
    } else if (wasPickingRef.current) {
      wasPickingRef.current = false;
      setCollapsed(false);
    }
  }, [pickTarget]);

  const { isDragging, dragStyle, handleProps } = useBottomSheetDrag(collapsed, setCollapsed);

  if (!open || navActive) return null;

  const peekCaption = pickTarget
    ? `Tap map to set ${pickTarget === 'origin' ? 'starting point' : 'destination'}`
    : route
      ? `${Math.max(1, Math.round(route.estimatedMinutes))} min · ${formatDistance(route.totalDistanceM)}${
          destination ? ` · ${destination.title}` : ''
        }`
      : 'Choose start and destination';

  return (
    <aside
      className={`directions m3-panel${collapsed ? ' is-collapsed' : ''}${isDragging ? ' is-dragging' : ''}`}
      style={dragStyle}
      aria-label="Directions"
    >
      <div className="sheet-drag-zone" {...handleProps}>
        <button
          type="button"
          className="sheet-handle"
          aria-label={collapsed ? 'Expand directions' : 'Collapse directions'}
          aria-expanded={!collapsed}
        >
          <span className="sheet-handle__grip" />
        </button>
        <div className="directions__head">
          <div style={{ minWidth: 0, flex: 1 }}>
            <p className="m3-title" style={{ fontSize: 18 }}>
              {collapsed && route ? `${Math.max(1, Math.round(route.estimatedMinutes))} min (${formatDistance(route.totalDistanceM)})` : 'Directions'}
            </p>
            <p className="m3-caption" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {collapsed ? (destination ? `To ${destination.title}` : peekCaption) : pickTarget ? 'Tap the map to set a point' : 'Campus walking, shuttle and driving'}
            </p>
          </div>
          <div className="sheet-head-actions">
            {collapsed && route && (
              <button type="button" className="m3-btn m3-btn--filled m3-btn--sm" onClick={onStartNavigation}>
                <Icon name="directions" size={14} />
                Start
              </button>
            )}
            <button type="button" className="m3-icon-btn m3-icon-btn--sm" onClick={onClose} aria-label="Close directions">
              <Icon name="close" size={16} />
            </button>
          </div>
        </div>
      </div>

      <div className="directions__form">
        <div className="m3-segmented" role="tablist" aria-label="Travel mode">
          {MODES.map(({ id, label, icon }) => {
            const candidate = modeComparison[id];
            const estMin = candidate ? Math.max(1, Math.round(candidate.estimatedMinutes)) : null;
            return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={mode === id}
                className={`m3-segmented__item${mode === id ? ' is-active' : ''}`}
                onClick={() => onChangeMode(id)}
              >
                <Icon name={icon} size={15} />
                <span>{label}</span>
                {estMin !== null && (
                  <span className="m3-mono" style={{ fontSize: 11, opacity: mode === id ? 0.95 : 0.68 }}>
                    {estMin}m
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {mode !== 'drive' && (
          <label className="m3-switch" style={{ padding: '2px 4px' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
              <Icon name="accessible" size={15} />
              Step-free route (avoid stairs)
            </span>
            <input
              type="checkbox"
              checked={stepFree}
              onChange={(e) => onToggleStepFree(e.target.checked)}
              aria-label="Avoid stairs"
            />
            <span className="m3-switch__track" />
          </label>
        )}

        <button
          type="button"
          className="m3-btn m3-btn--tonal m3-btn--sm"
          onClick={onUseCurrentLocation}
          disabled={locating}
          style={{ alignSelf: 'flex-start' }}
        >
          <Icon name="locate" size={15} />
          {locating ? 'Finding your location…' : hasUserLocation ? 'Start from my location' : 'Use current location'}
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 7, minWidth: 0 }}>
            <EndpointInput
              badge="A"
              placeholder="Choose a starting point"
              value={origin}
              items={items}
              picking={pickTarget === 'origin'}
              onSelect={onSetOrigin}
              onTogglePick={() => onTogglePickTarget('origin')}
            />
            <EndpointInput
              badge="B"
              placeholder="Choose a destination"
              value={destination}
              items={items}
              picking={pickTarget === 'destination'}
              onSelect={onSetDestination}
              onTogglePick={() => onTogglePickTarget('destination')}
            />
          </div>
          <button
            type="button"
            className="swap-btn"
            onClick={onSwap}
            title="Swap start and destination"
            aria-label="Swap start and destination"
          >
            <Icon name="swap" size={15} />
          </button>
        </div>
      </div>

      <div className="directions__body m3-scroll">
        {!origin || !destination ? (
          <>
            <p className="m3-body" style={{ fontSize: 12.5 }}>
              Pick two points, or start from a common campus journey.
            </p>
            {quickDemos.map((demo) => (
              <button
                key={demo.label}
                type="button"
                className="preset"
                onClick={() => {
                  onSetOrigin(demo.a);
                  onSetDestination(demo.b);
                  onChangeMode(demo.recMode);
                }}
              >
                <span className="preset__icon">
                  <Icon name={demo.recMode === 'bus' ? 'bus' : 'walk'} size={16} />
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span className="preset__title" style={{ display: 'block' }}>
                    {demo.label}
                  </span>
                  <span className="preset__sub" style={{ display: 'block' }}>
                    {demo.sub}
                  </span>
                </span>
                <Icon name="chevronRight" size={15} />
              </button>
            ))}
          </>
        ) : !route ? (
          <div className="zone-description" style={{ background: 'var(--error-container)' }}>
            <p style={{ color: 'var(--error)' }}>
              No connected {mode} route for this pair. Try walking or pick another destination.
            </p>
          </div>
        ) : (
          <>
            <div className="route-summary">
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <span className="route-summary__time m3-mono">
                    {Math.max(1, Math.round(route.estimatedMinutes))} min
                  </span>
                  <span className="route-summary__dist m3-mono">{formatDistance(route.totalDistanceM)}</span>
                </div>
                <div className="m3-meta-line" style={{ marginTop: 6, color: 'var(--on-primary-container)' }}>
                  {route.busRoutesUsed.length > 0 && (
                    <span>Bus {route.busRoutesUsed.join(' → ')}</span>
                  )}
                  {route.shortcutCount > 0 && (
                    <>
                      {route.busRoutesUsed.length > 0 && <span aria-hidden="true">·</span>}
                      <span>
                        {route.shortcutCount} covered shortcut{route.shortcutCount > 1 ? 's' : ''}
                      </span>
                    </>
                  )}
                  {route.mode === 'walk' && (
                    <>
                      {(route.busRoutesUsed.length > 0 || route.shortcutCount > 0) && (
                        <span aria-hidden="true">·</span>
                      )}
                      <span>{route.stepsCount > 0 ? `${route.stepsCount} stairs` : 'Step-free path'}</span>
                    </>
                  )}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                <button
                  type="button"
                  className="m3-icon-btn m3-icon-btn--sm"
                  onClick={onShareRoute}
                  title="Copy route link"
                  aria-label="Share route link"
                  style={{ color: 'var(--on-primary-container)' }}
                >
                  <Icon name="share" size={16} />
                </button>
                <button
                  type="button"
                  className="m3-btn m3-btn--filled route-summary__start"
                  onClick={onStartNavigation}
                >
                  <Icon name="directions" size={16} />
                  Start
                </button>
              </div>
            </div>

            {route.mode === 'walk' && walkMetrics.stepsEstimate > 0 && (
              <div className="walk-metrics-strip">
                <div className="walk-metrics-strip__item">
                  <span className="walk-metrics-strip__val m3-mono">
                    ~{walkMetrics.stepsEstimate.toLocaleString()}
                  </span>
                  <span className="walk-metrics-strip__lbl">steps</span>
                </div>
                <span className="walk-metrics-strip__div" aria-hidden="true" />
                <div className="walk-metrics-strip__item">
                  <span className="walk-metrics-strip__val m3-mono">{walkMetrics.kcalEstimate} kcal</span>
                  <span className="walk-metrics-strip__lbl">active burn</span>
                </div>
                <span className="walk-metrics-strip__div" aria-hidden="true" />
                <div className="walk-metrics-strip__item">
                  <span className="walk-metrics-strip__val m3-mono">
                    {Math.round(walkMetrics.coveredRatio * 100)}%
                  </span>
                  <span className="walk-metrics-strip__lbl">covered / indoor</span>
                </div>
              </div>
            )}

            <div className="section" style={{ gap: 4 }}>
              <div className="section__title">
                <span>Route steps</span>
                <span className="m3-mono" style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>
                  {route.steps.length}
                </span>
              </div>
              {route.steps.map((st, idx) => {
                const meta = STEP_META[st.kind];
                return (
                  <button
                    key={`${idx}-${st.instruction}`}
                    type="button"
                    className="step"
                    onClick={() => onSelectStep(st)}
                  >
                    <span
                      className="step__badge"
                      style={st.routeColor ? { background: st.routeColor, color: '#fff' } : undefined}
                    >
                      <Icon name={meta.icon} size={14} />
                    </span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 8,
                        }}
                      >
                        <span className="step__title">{st.instruction}</span>
                        {st.distanceM > 0 && (
                          <span className="m3-mono m3-caption" style={{ flexShrink: 0, fontSize: 10.5 }}>
                            {formatDistance(st.distanceM)}
                          </span>
                        )}
                      </span>
                      <span className="step__meta">
                        <span className="step__route">{st.routeCode || meta.label}</span>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {st.detail}
                        </span>
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>
    </aside>
  );
}
