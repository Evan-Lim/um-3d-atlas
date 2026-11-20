import { useEffect, useState } from 'react';
import { Icon, type IconName } from './Icon';
import { ElevationProfileChart } from './ElevationProfileChart';
import { useBottomSheetDrag } from '../hooks/useBottomSheetDrag';
import { computeBikeMetrics, computeWalkMetrics } from '../utils/atlasUtils';
import type {
  ComputedRoute,
  CustomRouteAnchor,
  RouteElevationProfile,
} from '../types/map';

interface CustomRoutePanelProps {
  open: boolean;
  navActive: boolean;
  overviewActive: boolean;
  anchors: CustomRouteAnchor[];
  mode: 'walk' | 'bike' | 'drive';
  snapToGraph: boolean;
  routeName: string;
  route: ComputedRoute | null;
  elevationProfile: RouteElevationProfile | null;
  canStartLiveNav: boolean;
  hasUserLocation: boolean;
  locating: boolean;
  onChangeName: (name: string) => void;
  onChangeMode: (mode: 'walk' | 'bike' | 'drive') => void;
  onToggleSnap: (snap: boolean) => void;
  onStartFromMyLocation: () => void;
  onUndo: () => void;
  onReverse: () => void;
  onCloseLoop: () => void;
  onClear: () => void;
  onRemoveAnchor: (id: string) => void;
  onFocusCoord: (coord: [number, number]) => void;
  onOpenOverview: () => void;
  onStartNavigation: () => void;
  onOpenShareModal: () => void;
  onClose: () => void;
}

const DRAW_MODES: { id: 'walk' | 'bike' | 'drive'; label: string; icon: IconName }[] = [
  { id: 'walk', label: 'Walk', icon: 'walk' },
  { id: 'bike', label: 'Bike', icon: 'bike' },
  { id: 'drive', label: 'Drive', icon: 'car' },
];

function formatDistance(meters: number): string {
  if (meters >= 1000) return `${(meters / 1000).toFixed(2)} km`;
  return `${Math.round(meters)} m`;
}

export function CustomRoutePanel({
  open,
  navActive,
  overviewActive,
  anchors,
  mode,
  snapToGraph,
  routeName,
  route,
  elevationProfile,
  canStartLiveNav,
  hasUserLocation,
  locating,
  onChangeName,
  onChangeMode,
  onToggleSnap,
  onStartFromMyLocation,
  onUndo,
  onReverse,
  onCloseLoop,
  onClear,
  onRemoveAnchor,
  onFocusCoord,
  onOpenOverview,
  onStartNavigation,
  onOpenShareModal,
  onClose,
}: CustomRoutePanelProps) {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    if (open) setCollapsed(false);
  }, [open]);

  const { isDragging, dragStyle, handleProps } = useBottomSheetDrag(collapsed, setCollapsed);

  if (!open || navActive || overviewActive) return null;

  const walkMetrics = computeWalkMetrics(route);
  const bikeMetrics = computeBikeMetrics(route);

  return (
    <aside
      className={`directions draw-panel m3-panel${collapsed ? ' is-collapsed' : ''}${
        isDragging ? ' is-dragging' : ''
      }`}
      style={dragStyle}
      aria-label="Custom Route Builder"
    >
      <div className="sheet-drag-zone" {...handleProps}>
        <button
          type="button"
          className="sheet-handle"
          aria-label={collapsed ? 'Expand route builder' : 'Collapse route builder'}
          aria-expanded={!collapsed}
        >
          <span className="sheet-handle__grip" />
        </button>
        <div className="directions__head">
          <div style={{ minWidth: 0, flex: 1 }}>
            <p className="m3-title" style={{ fontSize: 18 }}>
              {collapsed && route
                ? `${routeName.trim() || 'Custom Route'} · ${formatDistance(route.totalDistanceM)}`
                : 'Draw Custom Route'}
            </p>
            <p className="m3-caption" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {anchors.length === 0
                ? 'Click or tap the map to place points'
                : `${anchors.length} point${anchors.length > 1 ? 's' : ''} · drag pins or drag line on desktop to snap`}
            </p>
          </div>
          <button
            type="button"
            className="m3-icon-btn m3-icon-btn--sm"
            onClick={onClose}
            aria-label="Close custom route builder"
          >
            <Icon name="close" size={16} />
          </button>
        </div>
      </div>

      <div className="directions__form">
        <input
          type="text"
          className="route-name-input"
          value={routeName}
          maxLength={64}
          onChange={(e) => onChangeName(e.target.value)}
          placeholder="Name your route (e.g. Evening Tasik Loop)"
          aria-label="Custom route name"
        />

        <div className="m3-segmented" role="tablist" aria-label="Custom route travel mode">
          {DRAW_MODES.map(({ id, label, icon }) => (
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
            </button>
          ))}
        </div>

        <label className="m3-switch" style={{ padding: '2px 4px' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
            <Icon name="magnet" size={14} />
            Snap to campus roads &amp; paths
          </span>
          <input
            type="checkbox"
            checked={snapToGraph}
            onChange={(e) => onToggleSnap(e.target.checked)}
            aria-label="Snap custom route to roads and paths"
          />
          <span className="m3-switch__track" />
        </label>

        <div className="directions__quick-row">
          <button
            type="button"
            className="m3-btn m3-btn--tonal m3-btn--sm"
            onClick={onStartFromMyLocation}
            disabled={locating}
            title="Place Point A at your current GPS location so live Start is enabled"
          >
            <Icon name="locate" size={13} />
            {locating ? 'Finding…' : hasUserLocation ? 'Start here' : 'My location'}
          </button>
          <button
            type="button"
            className="m3-btn m3-btn--outlined m3-btn--sm"
            onClick={onUndo}
            disabled={anchors.length === 0}
            title="Remove last point"
          >
            <Icon name="undo" size={13} />
            Undo
          </button>
          <button
            type="button"
            className="m3-btn m3-btn--outlined m3-btn--sm"
            onClick={onReverse}
            disabled={anchors.length < 2}
            title="Reverse point order"
          >
            <Icon name="swap" size={13} />
            Reverse
          </button>
          <button
            type="button"
            className="m3-btn m3-btn--outlined m3-btn--sm"
            onClick={onCloseLoop}
            disabled={anchors.length < 2}
            title="Return to starting point to form a loop"
          >
            <Icon name="loop" size={13} />
            Loop
          </button>
          {anchors.length > 0 && (
            <button
              type="button"
              className="m3-icon-btn m3-icon-btn--sm"
              onClick={onClear}
              aria-label="Clear custom route"
              title="Clear all points"
              style={{ marginLeft: 'auto' }}
            >
              <Icon name="trash" size={14} />
            </button>
          )}
        </div>
      </div>

      <div className="directions__body m3-scroll">
        {anchors.length < 2 ? (
          <div className="draw-empty-guide">
            <p className="draw-empty-guide__title">
              {anchors.length === 0 ? 'Click anywhere on the map to start' : 'Click a second point to build your path'}
            </p>
            <p className="draw-empty-guide__text">
              Drop as many points as you like along roads, footpaths, or shortcuts. On desktop, hover and drag the blue route line to pull and snap it onto any road or walkway.
            </p>
          </div>
        ) : route ? (
          <>
            <div className="route-summary route-summary--stacked">
              <div style={{ minWidth: 0, width: '100%' }}>
                <div style={{ display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', gap: '4px 8px' }}>
                  <span className="route-summary__time m3-mono">
                    {Math.max(1, Math.round(route.estimatedMinutes))} min
                  </span>
                  <span className="route-summary__dist m3-mono">{formatDistance(route.totalDistanceM)}</span>
                  {elevationProfile && (
                    <span className="route-summary__elev m3-mono">
                      +{elevationProfile.totalGainM}m / −{elevationProfile.totalDropM}m
                    </span>
                  )}
                </div>
                <div className="m3-meta-line" style={{ marginTop: 4, color: 'var(--on-primary-container)' }}>
                  <span>{anchors.length} points</span>
                  <span aria-hidden="true">·</span>
                  <span>{snapToGraph ? 'Snapped to paths' : 'Freehand'}</span>
                  {mode === 'walk' && walkMetrics.stepsEstimate > 0 && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="m3-mono">~{walkMetrics.stepsEstimate.toLocaleString()} steps</span>
                    </>
                  )}
                  {mode === 'bike' && bikeMetrics.kcalEstimate > 0 && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="m3-mono">{bikeMetrics.kcalEstimate} kcal</span>
                    </>
                  )}
                </div>
              </div>

              <div className="route-summary__action-bar">
                <button
                  type="button"
                  className="m3-btn m3-btn--tonal m3-btn--sm"
                  onClick={onOpenOverview}
                >
                  <Icon name="overview" size={14} />
                  Overview
                </button>
                <button
                  type="button"
                  className="m3-btn m3-btn--filled m3-btn--sm"
                  onClick={onStartNavigation}
                  disabled={!canStartLiveNav}
                  title={
                    canStartLiveNav
                      ? 'Start live GPS navigation'
                      : 'Set Point A to your current location to enable live Start'
                  }
                >
                  <Icon name="directions" size={14} />
                  Start
                </button>
                <button
                  type="button"
                  className="m3-btn m3-btn--outlined m3-btn--sm"
                  onClick={onOpenShareModal}
                  style={{ marginLeft: 'auto' }}
                >
                  <Icon name="share" size={14} />
                  Share / PNG
                </button>
              </div>
              {!canStartLiveNav && (
                <p className="route-start-gate-hint">
                  Start requires Point A to be your current location — use Overview to inspect or simulate.
                </p>
              )}
            </div>

            {elevationProfile && (
              <ElevationProfileChart profile={elevationProfile} onFocusCoord={onFocusCoord} />
            )}
          </>
        ) : null}

        {anchors.length > 0 && (
          <div className="section" style={{ gap: 4 }}>
            <div className="section__title">
              <span>Route points</span>
              <span className="m3-mono" style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>
                {anchors.length}
              </span>
            </div>
            <div className="draw-points-list">
              {anchors.map((a, idx) => {
                const badge =
                  idx === 0 ? 'A' : idx === anchors.length - 1 ? 'B' : String(idx);
                const badgeClass =
                  idx === 0
                    ? 'endpoint__badge'
                    : idx === anchors.length - 1
                      ? 'endpoint__badge endpoint__badge--b'
                      : 'endpoint__badge endpoint__badge--stop';
                return (
                  <div key={a.id} className="draw-point-row">
                    <button
                      type="button"
                      className="draw-point-row__main"
                      onClick={() => onFocusCoord(a.coord)}
                    >
                      <span className={badgeClass}>{badge}</span>
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span className="draw-point-row__title">
                          {a.label || (idx === 0 ? 'Start point' : idx === anchors.length - 1 ? 'Finish point' : `Point ${idx + 1}`)}
                        </span>
                        <span className="draw-point-row__coords m3-mono">
                          {a.coord[1].toFixed(5)}°, {a.coord[0].toFixed(5)}°
                          {a.isShapingPoint ? ' · dragged' : ''}
                        </span>
                      </span>
                    </button>
                    <button
                      type="button"
                      className="m3-icon-btn m3-icon-btn--sm"
                      onClick={() => onRemoveAnchor(a.id)}
                      aria-label={`Remove point ${idx + 1}`}
                      title="Remove point"
                    >
                      <Icon name="close" size={13} />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
