import { Icon } from './Icon';
import { computeWalkMetrics } from '../utils/atlasUtils';
import type { ComputedRoute, RouteElevationProfile } from '../types/map';

interface RouteOverviewBarProps {
  route: ComputedRoute;
  routeName: string;
  elevationProfile: RouteElevationProfile | null;
  stepIndex: number;
  simulating: boolean;
  paused: boolean;
  simSpeed: 1 | 3;
  progressFraction: number;
  totalGeomM: number;
  canStartLiveNav: boolean;
  onPrevStep: () => void;
  onNextStep: () => void;
  onFitRoute: () => void;
  onToggleSim: () => void;
  onTogglePause: () => void;
  onToggleSpeed: () => void;
  onScrubProgressM: (meters: number) => void;
  onStartLiveNav: () => void;
  onOpenShare: () => void;
  onClose: () => void;
}

function formatDistance(meters: number): string {
  if (meters >= 1000) return `${(meters / 1000).toFixed(2)} km`;
  return `${Math.round(meters)} m`;
}

export function RouteOverviewBar({
  route,
  routeName,
  elevationProfile,
  stepIndex,
  simulating,
  paused,
  simSpeed,
  progressFraction,
  totalGeomM,
  canStartLiveNav,
  onPrevStep,
  onNextStep,
  onFitRoute,
  onToggleSim,
  onTogglePause,
  onToggleSpeed,
  onScrubProgressM,
  onStartLiveNav,
  onOpenShare,
  onClose,
}: RouteOverviewBarProps) {
  const step = route.steps[stepIndex] ?? route.steps[0];
  const totalSteps = route.steps.length;
  const walkMetrics = computeWalkMetrics(route);
  const title = routeName.trim() || `${route.originLabel} → ${route.destLabel}`;

  return (
    <div className="overview-bar m3-panel" role="region" aria-label="Route overview">
      <div className="overview-bar__head">
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="overview-bar__title-row">
            <span className="overview-bar__eyebrow">Route Overview</span>
            <span className="overview-bar__title">{title}</span>
          </div>
          <div className="overview-bar__stats m3-mono">
            <span>{Math.max(1, Math.round(route.estimatedMinutes))} min</span>
            <span aria-hidden="true">·</span>
            <span>{formatDistance(route.totalDistanceM)}</span>
            {elevationProfile && (
              <>
                <span aria-hidden="true">·</span>
                <span>
                  +{elevationProfile.totalGainM}m / −{elevationProfile.totalDropM}m
                </span>
              </>
            )}
            {route.mode === 'walk' && walkMetrics.stepsEstimate > 0 && (
              <>
                <span aria-hidden="true">·</span>
                <span>~{walkMetrics.stepsEstimate.toLocaleString()} steps</span>
              </>
            )}
          </div>
        </div>
        <button
          type="button"
          className="m3-icon-btn m3-icon-btn--sm"
          onClick={onClose}
          aria-label="Exit route overview"
          title="Back to route editor"
        >
          <Icon name="close" size={16} />
        </button>
      </div>

      {step && (
        <div className="overview-bar__step">
          <button
            type="button"
            className="m3-icon-btn m3-icon-btn--sm"
            onClick={onPrevStep}
            disabled={stepIndex <= 0}
            aria-label="Previous step"
            title="Previous step"
          >
            <Icon name="chevronLeft" size={15} />
          </button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="overview-bar__step-title">{step.instruction}</div>
            <div className="overview-bar__step-meta">
              <span className="m3-mono">
                Step {Math.min(stepIndex + 1, totalSteps)} / {totalSteps}
              </span>
              {step.distanceM > 0 && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="m3-mono">{formatDistance(step.distanceM)}</span>
                </>
              )}
              {step.detail && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="overview-bar__step-detail">{step.detail}</span>
                </>
              )}
            </div>
          </div>
          <button
            type="button"
            className="m3-icon-btn m3-icon-btn--sm"
            onClick={onNextStep}
            disabled={stepIndex >= totalSteps - 1}
            aria-label="Next step"
            title="Next step"
          >
            <Icon name="chevronRight" size={15} />
          </button>
        </div>
      )}

      {simulating && (
        <div className="overview-bar__sim">
          <input
            type="range"
            className="m3-slider"
            min={0}
            max={Math.max(1, Math.round(totalGeomM))}
            value={Math.round(progressFraction * totalGeomM)}
            onChange={(e) => onScrubProgressM(Number(e.target.value))}
            aria-label="Scrub 3D walkthrough simulation"
          />
          <div className="overview-bar__sim-controls">
            <button
              type="button"
              className="m3-btn m3-btn--outlined m3-btn--sm"
              onClick={onTogglePause}
            >
              <Icon name={paused ? 'play' : 'pause'} size={13} />
              {paused ? 'Resume' : 'Pause'}
            </button>
            <button
              type="button"
              className="m3-btn m3-btn--outlined m3-btn--sm m3-mono"
              onClick={onToggleSpeed}
              aria-label={`Simulation speed ${simSpeed}x`}
            >
              {simSpeed}×
            </button>
            <span className="m3-caption m3-mono" style={{ marginLeft: 'auto' }}>
              {Math.round(progressFraction * 100)}%
            </span>
          </div>
        </div>
      )}

      <div className="overview-bar__actions">
        <button
          type="button"
          className={`m3-btn m3-btn--sm ${simulating ? 'm3-btn--tonal' : 'm3-btn--outlined'}`}
          onClick={onToggleSim}
        >
          <Icon name={simulating ? 'pause' : 'play'} size={14} />
          {simulating ? 'Stop sim' : 'Simulate 3D'}
        </button>
        <button
          type="button"
          className="m3-btn m3-btn--outlined m3-btn--sm"
          onClick={onFitRoute}
        >
          <Icon name="overview" size={14} />
          Fit route
        </button>
        <button
          type="button"
          className="m3-btn m3-btn--outlined m3-btn--sm"
          onClick={onOpenShare}
        >
          <Icon name="share" size={14} />
          Share / PNG
        </button>
        <button
          type="button"
          className="m3-btn m3-btn--filled m3-btn--sm"
          onClick={onStartLiveNav}
          disabled={!canStartLiveNav}
          title={
            canStartLiveNav
              ? 'Start live turn-by-turn GPS navigation'
              : 'Set start point to your current location to start live navigation'
          }
          style={{ marginLeft: 'auto' }}
        >
          <Icon name="directions" size={14} />
          Start
        </button>
      </div>
    </div>
  );
}
