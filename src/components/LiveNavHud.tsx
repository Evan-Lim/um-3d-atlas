import type { FC } from 'react';
import { Icon, type IconName } from './Icon';
import type { ComputedRoute, RouteMode, RouteStep } from '../types/map';

interface LiveNavHudProps {
  route: ComputedRoute;
  mode: RouteMode;
  destinationName: string;
  currentStepIndex: number;
  distanceToNextStepM: number;
  remainingDistanceM: number;
  remainingMinutes: number;
  progressFraction: number;
  isSimulating: boolean;
  isPaused: boolean;
  simSpeed: 1 | 3;
  isFollowing: boolean;
  gpsStatus: 'idle' | 'watching' | 'error';
  gpsError: string | null;
  arrived: boolean;
  onTogglePause: () => void;
  onToggleSpeed: () => void;
  onToggleSource: () => void;
  onRecenter: () => void;
  onExit: () => void;
}

function formatDistance(meters: number): string {
  if (meters >= 1000) return `${(meters / 1000).toFixed(2)} km`;
  return `${Math.max(1, Math.round(meters))} m`;
}

function stepIcon(step: RouteStep | undefined, mode: RouteMode): IconName {
  if (!step) {
    if (mode === 'bus') return 'bus';
    if (mode === 'drive') return 'car';
    return 'walk';
  }
  if (step.kind === 'bus') return 'bus';
  if (step.kind === 'indoor') return 'door';
  if (step.kind === 'steps') return 'arrowUp';
  if (step.kind === 'road' && mode === 'drive') return 'car';
  return 'arrowUp';
}

export const LiveNavHud: FC<LiveNavHudProps> = ({
  route,
  mode,
  destinationName,
  currentStepIndex,
  distanceToNextStepM,
  remainingDistanceM,
  remainingMinutes,
  progressFraction,
  isSimulating,
  isPaused,
  simSpeed,
  isFollowing,
  gpsStatus,
  gpsError,
  arrived,
  onTogglePause,
  onToggleSpeed,
  onToggleSource,
  onRecenter,
  onExit,
}) => {
  const currentStep = route.steps[currentStepIndex] ?? route.steps[0];
  const nextStep = route.steps[currentStepIndex + 1];
  const percent = Math.min(100, Math.max(0, progressFraction * 100));

  return (
    <div className="nav-hud" role="region" aria-label="Live navigation">
      <div className="nav-hud__primary">
        <div className="nav-hud__row">
          <span className="nav-hud__icon">
            <Icon name={arrived ? 'checkCircle' : stepIcon(currentStep, mode)} size={23} />
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <span className="nav-hud__eyebrow">{arrived ? 'Arrived' : 'Live navigation'}</span>
              <span className="nav-hud__eyebrow" style={{ maxWidth: '55%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textTransform: 'none', letterSpacing: 0, fontSize: 11 }}>
                {destinationName}
              </span>
            </div>
            <p className="nav-hud__instruction">
              {arrived ? `You have reached ${destinationName}` : currentStep?.instruction || 'Follow the route'}
            </p>
            {!arrived && (
              <p className="nav-hud__sub">
                {distanceToNextStepM > 0 ? `In ${formatDistance(distanceToNextStepM)}` : 'Continue on route'}
                {nextStep ? ` · then ${nextStep.instruction}` : ''}
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="nav-hud__surface">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <span className="nav-hud__stats">
            <span className="nav-hud__time">{Math.max(0, Math.round(remainingMinutes))} min</span>
            <span className="nav-hud__meta">{formatDistance(remainingDistanceM)} remaining</span>
          </span>
          <button type="button" className="m3-btn m3-btn--outlined m3-btn--sm nav-hud__exit" onClick={onExit}>
            End
          </button>
        </div>

        <div className="progress-line" aria-hidden="true">
          <div className="progress-line__fill" style={{ width: `${percent}%` }} />
        </div>

        <div className="nav-hud__actions">
          <button type="button" className="m3-btn m3-btn--tonal m3-btn--sm" onClick={onToggleSource}>
            <Icon name="locate" size={14} />
            {isSimulating ? 'Use device GPS' : 'Simulate drive'}
          </button>

          {isSimulating && (
            <>
              <button type="button" className="m3-btn m3-btn--outlined m3-btn--sm" onClick={onTogglePause}>
                <Icon name={isPaused ? 'play' : 'pause'} size={13} />
                {isPaused ? 'Resume' : 'Pause'}
              </button>
              <button type="button" className="m3-btn m3-btn--outlined m3-btn--sm m3-mono" onClick={onToggleSpeed}>
                {simSpeed}×
              </button>
            </>
          )}

          {!isFollowing && (
            <button type="button" className="m3-btn m3-btn--filled m3-btn--sm" onClick={onRecenter} style={{ marginLeft: 'auto' }}>
              <Icon name="locate" size={14} />
              Re-centre
            </button>
          )}
          {gpsStatus === 'watching' && (
            <span className="m3-tag m3-tag--success">
              <Icon name="radio" size={12} />
              GPS
            </span>
          )}
        </div>

        {gpsError && (
          <div
            style={{
              borderRadius: 12,
              background: 'var(--surface-low)',
              padding: '7px 10px',
              fontSize: 11.5,
              color: 'var(--on-surface-variant)',
            }}
          >
            {gpsError}
          </div>
        )}
      </div>
    </div>
  );
};
