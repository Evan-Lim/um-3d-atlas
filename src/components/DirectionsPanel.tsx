import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon, type IconName } from './Icon';
import { ElevationProfileChart } from './ElevationProfileChart';
import { useBottomSheetDrag } from '../hooks/useBottomSheetDrag';
import {
  computeBikeMetrics,
  computeWalkMetrics,
  type ModeComparison,
} from '../utils/atlasUtils';
import type {
  CampusWeatherReport,
  ComputedRoute,
  PickTarget,
  RouteElevationProfile,
  RouteMode,
  RouteStep,
  RouteStopSlot,
  SearchItem,
} from '../types/map';

interface DirectionsPanelProps {
  open: boolean;
  navActive: boolean;
  items: SearchItem[];
  origin: SearchItem | null;
  stops: RouteStopSlot[];
  destination: SearchItem | null;
  mode: RouteMode;
  stepFree: boolean;
  route: ComputedRoute | null;
  elevationProfile: RouteElevationProfile | null;
  weather: CampusWeatherReport | null;
  modeComparison: ModeComparison;
  pickTarget: PickTarget;
  hasUserLocation: boolean;
  locating: boolean;
  onUseCurrentLocation: () => void;
  onSetOrigin: (item: SearchItem | null) => void;
  onSetDestination: (item: SearchItem | null) => void;
  onAddStop: () => void;
  onUpdateStop: (stopId: string, item: SearchItem | null) => void;
  onRemoveStop: (stopId: string) => void;
  onMoveStop: (stopId: string, direction: -1 | 1) => void;
  onReorderStops: (fromIndex: number, toIndex: number) => void;
  onOptimizeStops: () => void;
  onSwap: () => void;
  onChangeMode: (mode: RouteMode) => void;
  onToggleStepFree: (enabled: boolean) => void;
  onTogglePickTarget: (target: Exclude<PickTarget, null>) => void;
  onStartNavigation: () => void;
  onShareRoute: () => void;
  onSelectStep: (step: RouteStep) => void;
  onFocusCoord: (coord: [number, number]) => void;
  onClose: () => void;
}

const MODES: { id: RouteMode; label: string; icon: IconName }[] = [
  { id: 'walk', label: 'Walk', icon: 'walk' },
  { id: 'bike', label: 'Bike', icon: 'bike' },
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
  waypoint: { icon: 'flag', label: 'Stop' },
};

function formatDistance(meters: number): string {
  if (meters >= 1000) return `${(meters / 1000).toFixed(2)} km`;
  return `${Math.round(meters)} m`;
}

function isPickingStop(target: PickTarget, stopId: string): boolean {
  return Boolean(target && typeof target === 'object' && target.stopId === stopId);
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
  badge: string;
  badgeVariant: 'origin' | 'destination' | 'stop';
  placeholder: string;
  ariaLabel: string;
  value: SearchItem | null;
  items: SearchItem[];
  picking: boolean;
  onSelect: (item: SearchItem | null) => void;
  onTogglePick: () => void;
  trailingAction?: React.ReactNode;
}

function EndpointInput({
  badge,
  badgeVariant,
  placeholder,
  ariaLabel,
  value,
  items,
  picking,
  onSelect,
  onTogglePick,
  trailingAction,
}: EndpointInputProps) {
  const [text, setText] = useState('');
  const [focused, setFocused] = useState(false);
  const suggestions = useMemo(() => searchPool(items, text), [items, text]);
  const displayText = focused ? text : value ? value.title : '';

  const badgeClass =
    badgeVariant === 'destination'
      ? 'endpoint__badge endpoint__badge--b'
      : badgeVariant === 'stop'
        ? 'endpoint__badge endpoint__badge--stop'
        : 'endpoint__badge';

  return (
    <div style={{ position: 'relative', flex: 1, minWidth: 0 }}>
      <div className={`endpoint${badgeVariant === 'stop' ? ' endpoint--stop' : ''}${picking ? ' is-picking' : ''}`}>
        <span className={badgeClass}>{badge}</span>
        <input
          value={displayText}
          onFocus={() => {
            setFocused(true);
            setText(value ? value.title : '');
          }}
          onBlur={() => setTimeout(() => setFocused(false), 160)}
          onChange={(e) => setText(e.target.value)}
          placeholder={picking ? 'Click the map to place' : placeholder}
          aria-label={ariaLabel}
        />
        {value && badgeVariant !== 'stop' && (
          <button
            type="button"
            className="m3-icon-btn m3-icon-btn--sm"
            onClick={() => {
              onSelect(null);
              setText('');
            }}
            aria-label={`Clear ${ariaLabel.toLowerCase()}`}
          >
            <Icon name="close" size={13} />
          </button>
        )}
        <button
          type="button"
          className={`m3-icon-btn m3-icon-btn--sm${picking ? ' m3-icon-btn--tonal' : ''}`}
          onClick={onTogglePick}
          aria-label={picking ? 'Cancel map selection' : `Pick ${ariaLabel.toLowerCase()} on map`}
          title="Pick on map"
        >
          <Icon name="crosshair" size={15} />
        </button>
        {trailingAction}
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
  stops,
  destination,
  mode,
  stepFree,
  route,
  elevationProfile,
  weather,
  modeComparison,
  pickTarget,
  hasUserLocation,
  locating,
  onUseCurrentLocation,
  onSetOrigin,
  onSetDestination,
  onAddStop,
  onUpdateStop,
  onRemoveStop,
  onMoveStop,
  onReorderStops,
  onOptimizeStops,
  onSwap,
  onChangeMode,
  onToggleStepFree,
  onTogglePickTarget,
  onStartNavigation,
  onShareRoute,
  onSelectStep,
  onFocusCoord,
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
      out.push({ label: 'FSKTM → Engineering Tower', sub: 'Bike or walk via campus paths', a: fsktm, b: engine, recMode: 'bike' });
    }
    if (lib && kppi) {
      out.push({ label: 'Main Library → KPPI Research Hub', sub: 'Walk or UM Shuttle BA', a: lib, b: kppi, recMode: 'walk' });
    }
    return out;
  }, [items]);

  const walkMetrics = useMemo(() => computeWalkMetrics(route), [route]);
  const bikeMetrics = useMemo(() => computeBikeMetrics(route), [route]);

  const filledStopCount = useMemo(
    () => stops.filter((s) => Boolean(s.item)).length,
    [stops],
  );
  const canOptimize = Boolean(origin && destination && filledStopCount >= 2);

  const [collapsed, setCollapsed] = useState(false);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
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

  const pickLabel =
    pickTarget === 'origin'
      ? 'starting point'
      : pickTarget === 'destination'
        ? 'destination'
        : 'stop';

  const peekCaption = pickTarget
    ? `Tap map to set ${pickLabel}`
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
              {collapsed && route
                ? `${Math.max(1, Math.round(route.estimatedMinutes))} min (${formatDistance(route.totalDistanceM)})`
                : 'Directions'}
            </p>
            <p className="m3-caption" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {collapsed
                ? destination
                  ? `To ${destination.title}`
                  : peekCaption
                : pickTarget
                  ? `Tap the map to set ${pickLabel}`
                  : 'Walk, bike, shuttle and drive · multi-stop'}
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
        <div className="m3-segmented m3-segmented--modes" role="tablist" aria-label="Travel mode">
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
                <Icon name={icon} size={14} />
                <span>{label}</span>
                {estMin !== null && (
                  <span className="m3-segmented__eta m3-mono" style={{ opacity: mode === id ? 0.95 : 0.68 }}>
                    {estMin}m
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {(mode === 'walk' || mode === 'bus') && (
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

        {mode === 'bike' && (
          <p className="m3-meta-line" style={{ padding: '0 4px', fontSize: 11.5 }}>
            <Icon name="bike" size={13} />
            <span>Prefers campus roads &amp; paved paths · avoids stairs</span>
          </p>
        )}

        <div className="directions__quick-row">
          <button
            type="button"
            className="m3-btn m3-btn--tonal m3-btn--sm"
            onClick={onUseCurrentLocation}
            disabled={locating}
          >
            <Icon name="locate" size={14} />
            {locating ? 'Finding…' : hasUserLocation ? 'My location' : 'Use location'}
          </button>
          <button
            type="button"
            className="m3-btn m3-btn--outlined m3-btn--sm"
            onClick={onAddStop}
          >
            <Icon name="plus" size={14} />
            Add stop
          </button>
          {filledStopCount >= 2 && (
            <button
              type="button"
              className="m3-btn m3-btn--tonal m3-btn--sm"
              onClick={onOptimizeStops}
              disabled={!canOptimize}
              title="Reorder intermediate stops for the shortest total route"
            >
              <Icon name="optimize" size={14} />
              Optimize
            </button>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
            <EndpointInput
              badge="A"
              badgeVariant="origin"
              placeholder="Choose a starting point"
              ariaLabel="Starting point"
              value={origin}
              items={items}
              picking={pickTarget === 'origin'}
              onSelect={onSetOrigin}
              onTogglePick={() => onTogglePickTarget('origin')}
            />

            {stops.length > 0 && (
              <div className="stops-list m3-scroll" aria-label="Intermediate stops">
                {stops.map((slot, idx) => (
                  <div
                    key={slot.id}
                    className={`stop-row${dragIdx === idx ? ' is-dragging' : ''}${
                      dragOverIdx === idx && dragIdx !== idx ? ' is-drag-over' : ''
                    }`}
                    draggable={stops.length > 1}
                    onDragStart={(e) => {
                      setDragIdx(idx);
                      e.dataTransfer.effectAllowed = 'move';
                      e.dataTransfer.setData('text/plain', String(idx));
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = 'move';
                      if (dragOverIdx !== idx) setDragOverIdx(idx);
                    }}
                    onDragLeave={() => {
                      if (dragOverIdx === idx) setDragOverIdx(null);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (dragIdx !== null && dragIdx !== idx) {
                        onReorderStops(dragIdx, idx);
                      }
                      setDragIdx(null);
                      setDragOverIdx(null);
                    }}
                    onDragEnd={() => {
                      setDragIdx(null);
                      setDragOverIdx(null);
                    }}
                  >
                    {stops.length > 1 && (
                      <div className="stop-row__reorder">
                        <button
                          type="button"
                          className="stop-row__move"
                          onClick={() => onMoveStop(slot.id, -1)}
                          disabled={idx === 0}
                          aria-label={`Move stop ${idx + 1} up`}
                          title="Move up"
                        >
                          <Icon name="arrowUp" size={11} />
                        </button>
                        <button
                          type="button"
                          className="stop-row__move"
                          onClick={() => onMoveStop(slot.id, 1)}
                          disabled={idx === stops.length - 1}
                          aria-label={`Move stop ${idx + 1} down`}
                          title="Move down"
                        >
                          <Icon name="arrowDown" size={11} />
                        </button>
                      </div>
                    )}
                    <EndpointInput
                      badge={String(idx + 1)}
                      badgeVariant="stop"
                      placeholder={`Add stop ${idx + 1}`}
                      ariaLabel={`Stop ${idx + 1}`}
                      value={slot.item}
                      items={items}
                      picking={isPickingStop(pickTarget, slot.id)}
                      onSelect={(it) => onUpdateStop(slot.id, it)}
                      onTogglePick={() => onTogglePickTarget({ stopId: slot.id })}
                      trailingAction={
                        <button
                          type="button"
                          className="m3-icon-btn m3-icon-btn--sm"
                          onClick={() => onRemoveStop(slot.id)}
                          aria-label={`Remove stop ${idx + 1}`}
                          title="Remove stop"
                        >
                          <Icon name="close" size={13} />
                        </button>
                      }
                    />
                  </div>
                ))}
              </div>
            )}

            <EndpointInput
              badge="B"
              badgeVariant="destination"
              placeholder="Choose a destination"
              ariaLabel="Destination"
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
            title={stops.length > 0 ? 'Reverse full itinerary' : 'Swap start and destination'}
            aria-label={stops.length > 0 ? 'Reverse full itinerary' : 'Swap start and destination'}
          >
            <Icon name="swap" size={15} />
          </button>
        </div>
      </div>

      <div className="directions__body m3-scroll">
        {!origin || !destination ? (
          <>
            <p className="m3-body" style={{ fontSize: 12.5 }}>
              Pick start and destination, add stops along the way, or try a common campus journey.
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
                  <Icon name={demo.recMode === 'bus' ? 'bus' : demo.recMode === 'bike' ? 'bike' : 'walk'} size={16} />
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
              No connected {mode} route for this itinerary. Try walking or adjust a stop.
            </p>
          </div>
        ) : (
          <>
            <div className="route-summary">
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', gap: '4px 8px' }}>
                  <span className="route-summary__time m3-mono">
                    {Math.max(1, Math.round(route.estimatedMinutes))} min
                  </span>
                  <span className="route-summary__dist m3-mono">{formatDistance(route.totalDistanceM)}</span>
                  {elevationProfile && (
                    <span className="route-summary__elev m3-mono" title="Total elevation gain and drop">
                      +{elevationProfile.totalGainM}m / −{elevationProfile.totalDropM}m
                    </span>
                  )}
                </div>
                <div className="m3-meta-line" style={{ marginTop: 6, color: 'var(--on-primary-container)' }}>
                  {route.waypoints && route.waypoints.length > 0 && (
                    <span>
                      {route.waypoints.length} stop{route.waypoints.length > 1 ? 's' : ''}
                    </span>
                  )}
                  {route.busRoutesUsed.length > 0 && (
                    <>
                      {route.waypoints && route.waypoints.length > 0 && <span aria-hidden="true">·</span>}
                      <span>Bus {route.busRoutesUsed.join(' → ')}</span>
                    </>
                  )}
                  {route.shortcutCount > 0 && (
                    <>
                      {(route.busRoutesUsed.length > 0 || (route.waypoints && route.waypoints.length > 0)) && (
                        <span aria-hidden="true">·</span>
                      )}
                      <span>
                        {route.shortcutCount} covered shortcut{route.shortcutCount > 1 ? 's' : ''}
                      </span>
                    </>
                  )}
                  {route.mode === 'walk' && (
                    <>
                      {(route.busRoutesUsed.length > 0 ||
                        route.shortcutCount > 0 ||
                        (route.waypoints && route.waypoints.length > 0)) && <span aria-hidden="true">·</span>}
                      <span>{route.stepsCount > 0 ? `${route.stepsCount} stairs` : 'Step-free path'}</span>
                    </>
                  )}
                  {route.mode === 'bike' && (
                    <>
                      {(route.shortcutCount > 0 || (route.waypoints && route.waypoints.length > 0)) && (
                        <span aria-hidden="true">·</span>
                      )}
                      <span>Stair-free cycling</span>
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

            {route.mode === 'bike' && bikeMetrics.kcalEstimate > 0 && (
              <div className="walk-metrics-strip">
                <div className="walk-metrics-strip__item">
                  <span className="walk-metrics-strip__val m3-mono">{bikeMetrics.kcalEstimate} kcal</span>
                  <span className="walk-metrics-strip__lbl">active burn</span>
                </div>
                <span className="walk-metrics-strip__div" aria-hidden="true" />
                <div className="walk-metrics-strip__item">
                  <span className="walk-metrics-strip__val m3-mono">
                    {Math.round(bikeMetrics.roadRatio * 100)}%
                  </span>
                  <span className="walk-metrics-strip__lbl">campus roads</span>
                </div>
                <span className="walk-metrics-strip__div" aria-hidden="true" />
                <div className="walk-metrics-strip__item">
                  <span className="walk-metrics-strip__val m3-mono">
                    {Math.round(bikeMetrics.pavedPathRatio * 100)}%
                  </span>
                  <span className="walk-metrics-strip__lbl">paved paths</span>
                </div>
              </div>
            )}

            {weather && (
              <div className="route-weather-strip" aria-label="Route weather comfort">
                <div className="route-weather-strip__top">
                  <span className="route-weather-strip__stat">
                    <Icon name={weather.isDay ? 'sun' : 'moon'} size={13} />
                    <strong>{weather.heatLabel}</strong>
                    <span className="m3-mono">{Math.round(weather.feelsLikeC)}°C feels</span>
                  </span>
                  <span aria-hidden="true" style={{ opacity: 0.45 }}>·</span>
                  <span className="route-weather-strip__stat">
                    <Icon
                      name={weather.rainLevel === 'raining' || weather.rainLevel === 'likely' ? 'cloudRain' : 'droplet'}
                      size={13}
                    />
                    <span className="m3-mono">
                      {weather.rainLevel === 'raining' ? 'Raining now' : `${weather.rainChancePct}% rain`}
                    </span>
                  </span>
                </div>
                <p className="route-weather-strip__advice">{weather.routeAdvisory}</p>
              </div>
            )}

            {elevationProfile && (
              <ElevationProfileChart profile={elevationProfile} onFocusCoord={onFocusCoord} />
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
                const isWaypoint = st.kind === 'waypoint';
                const stepElev = elevationProfile?.stepElevations[idx] ?? null;
                return (
                  <button
                    key={`${idx}-${st.instruction}`}
                    type="button"
                    className={`step${isWaypoint ? ' step--waypoint' : ''}`}
                    onClick={() => onSelectStep(st)}
                  >
                    <span
                      className={`step__badge${isWaypoint ? ' step__badge--waypoint' : ''}`}
                      style={st.routeColor ? { background: st.routeColor, color: '#fff' } : undefined}
                    >
                      {isWaypoint && st.waypointIndex ? (
                        <span className="m3-mono" style={{ fontSize: 11, fontWeight: 600 }}>
                          {st.waypointIndex}
                        </span>
                      ) : (
                        <Icon
                          name={route.mode === 'bike' && (st.kind === 'road' || st.kind === 'footway') ? 'bike' : meta.icon}
                          size={14}
                        />
                      )}
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
                      {stepElev && (stepElev.hillTag || Math.abs(stepElev.deltaM) >= 3) && (
                        <span
                          className={`step__grade m3-mono${
                            stepElev.hillTag === 'steep-climb'
                              ? ' is-steep-climb'
                              : stepElev.hillTag === 'steep-descent'
                                ? ' is-steep-descent'
                                : ''
                          }`}
                        >
                          <Icon
                            name={stepElev.deltaM >= 0 ? 'trendUp' : 'trendDown'}
                            size={11}
                          />
                          {stepElev.hillTag === 'steep-climb'
                            ? `Steep climb · +${Math.round(stepElev.deltaM)} m (${Math.abs(stepElev.gradePct).toFixed(0)}%)`
                            : stepElev.hillTag === 'steep-descent'
                              ? `Steep descent · −${Math.round(Math.abs(stepElev.deltaM))} m (${Math.abs(stepElev.gradePct).toFixed(0)}%)`
                              : `${stepElev.deltaM > 0 ? '+' : '−'}${Math.round(Math.abs(stepElev.deltaM))} m (${Math.abs(stepElev.gradePct).toFixed(0)}%)`}
                        </span>
                      )}
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
