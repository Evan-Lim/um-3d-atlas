import type { FC } from 'react';
import { Icon, type IconName } from './Icon';
import { zoneKindLabel } from '../theme';
import { formatGpsCoords } from '../utils/routeTools';
import type {
  CampusWeatherReport,
  ComputedRoute,
  FacultyProps,
  RouteMode,
  RouteStep,
  ZoneTransitionEvent,
} from '../types/map';

interface LiveNavHudProps {
  route: ComputedRoute;
  mode: RouteMode;
  destinationName: string;
  currentStepIndex: number;
  distanceToNextStepM: number;
  remainingDistanceM: number;
  remainingMinutes: number;
  progressFraction: number;
  totalGeomM: number;
  isSimulating: boolean;
  isPaused: boolean;
  simSpeed: 1 | 3;
  isFollowing: boolean;
  gpsStatus: 'idle' | 'watching' | 'error';
  gpsError: string | null;
  arrived: boolean;
  speedMps: number;
  currentCoord: [number, number] | null;
  rerouteState: 'idle' | 'rerouting' | 'updated';
  currentZone: FacultyProps | null;
  zoneTransition: ZoneTransitionEvent | null;
  currentElevationM: number | null;
  remainingElevation: { remainingGainM: number; remainingDropM: number } | null;
  weather: CampusWeatherReport | null;
  onDismissZoneTransition: () => void;
  onScrubProgressM: (meters: number) => void;
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

function zoneDisplayName(zone: FacultyProps): string {
  const short = zone.short_label?.trim();
  if (short && short.length <= 28) return short;
  return zone.code || zone.name;
}

function stepIcon(step: RouteStep | undefined, mode: RouteMode): IconName {
  if (!step) {
    if (mode === 'bike') return 'bike';
    if (mode === 'bus') return 'bus';
    if (mode === 'drive') return 'car';
    return 'walk';
  }
  if (step.kind === 'waypoint') return 'flag';
  if (step.kind === 'bus') return 'bus';
  if (step.kind === 'indoor') return 'door';
  if (step.kind === 'steps') return 'arrowUp';
  if (mode === 'bike') return 'bike';
  if (step.kind === 'road' && mode === 'drive') return 'car';
  return 'arrowUp';
}

function SpeedDial({ speedMps }: { speedMps: number }) {
  const kmh = Math.max(0, Math.round(speedMps * 3.6));
  const radius = 40;
  const circumference = 2 * Math.PI * radius;
  const arc = circumference * 0.75;
  const progress = Math.min(1, kmh / 40);

  return (
    <div className="speed-dial" role="img" aria-label={`Speed ${kmh} kilometres per hour`}>
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <circle
          className="speed-dial__track"
          cx="50"
          cy="50"
          r={radius}
          strokeDasharray={`${arc} ${circumference}`}
          transform="rotate(135 50 50)"
        />
        <circle
          className="speed-dial__progress"
          cx="50"
          cy="50"
          r={radius}
          strokeDasharray={`${arc * progress} ${circumference}`}
          transform="rotate(135 50 50)"
        />
      </svg>
      <div className="speed-dial__readout">
        <span className="speed-dial__value m3-mono">{kmh}</span>
        <span className="speed-dial__unit">km/h</span>
      </div>
    </div>
  );
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
  totalGeomM,
  isSimulating,
  isPaused,
  simSpeed,
  isFollowing,
  gpsStatus,
  gpsError,
  arrived,
  speedMps,
  currentCoord,
  rerouteState,
  currentZone,
  zoneTransition,
  currentElevationM,
  remainingElevation,
  weather,
  onDismissZoneTransition,
  onScrubProgressM,
  onTogglePause,
  onToggleSpeed,
  onToggleSource,
  onRecenter,
  onExit,
}) => {
  const currentStep = route.steps[currentStepIndex] ?? route.steps[0];
  const nextStep = route.steps[currentStepIndex + 1];
  const percent = Math.min(100, Math.max(0, progressFraction * 100));

  const zoneAccentColor = currentZone?.accent || 'rgba(255, 255, 255, 0.72)';

  const transitionSummary = zoneTransition
    ? zoneTransition.type === 'cross' && zoneTransition.leavingZone && zoneTransition.enteringZone
      ? {
          title: `Entering ${zoneDisplayName(zoneTransition.enteringZone)}`,
          detail: `Leaving ${zoneDisplayName(zoneTransition.leavingZone)} · ${zoneKindLabel(zoneTransition.enteringZone.zone_kind)}`,
          dotColor: zoneTransition.enteringZone.accent || '#1a73e8',
        }
      : zoneTransition.type === 'enter' && zoneTransition.enteringZone
        ? {
            title: `Entering ${zoneDisplayName(zoneTransition.enteringZone)}`,
            detail: zoneKindLabel(zoneTransition.enteringZone.zone_kind),
            dotColor: zoneTransition.enteringZone.accent || '#1a73e8',
          }
        : zoneTransition.leavingZone
          ? {
              title: `Leaving ${zoneDisplayName(zoneTransition.leavingZone)}`,
              detail: `${zoneKindLabel(zoneTransition.leavingZone.zone_kind)} · Campus corridor`,
              dotColor: zoneTransition.leavingZone.accent || '#5f6368',
            }
          : null
    : null;

  return (
    <div className="nav-hud" role="region" aria-label="Live navigation">
      <div className="nav-hud__primary">
        <div className="nav-hud__row">
          <span className="nav-hud__icon">
            <Icon name={arrived ? 'checkCircle' : stepIcon(currentStep, mode)} size={23} />
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <span className="nav-hud__eyebrow">
                {arrived ? 'Arrived' : isSimulating ? '3D Walkthrough Simulation' : 'Live GPS Navigation'}
              </span>
              <span
                className="nav-hud__eyebrow"
                style={{
                  maxWidth: '55%',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  textTransform: 'none',
                  letterSpacing: 0,
                  fontSize: 11,
                }}
              >
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

        <div className="nav-hud__zone" aria-live="polite">
          <span
            className="nav-hud__zone-dot"
            style={{ background: zoneAccentColor }}
            aria-hidden="true"
          />
          {currentZone ? (
            <span className="nav-hud__zone-text">
              In <strong>{zoneDisplayName(currentZone)}</strong>
              <span className="nav-hud__zone-sep" aria-hidden="true">·</span>
              <span>{zoneKindLabel(currentZone.zone_kind)}</span>
            </span>
          ) : (
            <span className="nav-hud__zone-text">Campus corridor</span>
          )}
        </div>

        {(currentElevationM !== null || weather) && (
          <div className="nav-hud__conditions" aria-label="Live altitude and weather conditions">
            {currentElevationM !== null && (
              <span className="nav-hud__cond-item m3-mono">
                <Icon name="mountain" size={12} />
                <span>{Math.round(currentElevationM)} m</span>
                {remainingElevation && remainingElevation.remainingGainM >= 2 && (
                  <span style={{ opacity: 0.85 }}>(+{remainingElevation.remainingGainM}m left)</span>
                )}
              </span>
            )}
            {currentElevationM !== null && weather && (
              <span className="nav-hud__zone-sep" aria-hidden="true">·</span>
            )}
            {weather && (
              <>
                <span className="nav-hud__cond-item">
                  <Icon name={weather.isDay ? 'sun' : 'moon'} size={12} />
                  <span>
                    {weather.heatLabel} <span className="m3-mono">{Math.round(weather.feelsLikeC)}°</span>
                  </span>
                </span>
                <span className="nav-hud__zone-sep" aria-hidden="true">·</span>
                <span className="nav-hud__cond-item">
                  <Icon name={weather.rainLevel === 'raining' || weather.rainLevel === 'likely' ? 'cloudRain' : 'droplet'} size={12} />
                  <span className="m3-mono">
                    {weather.rainLevel === 'raining' ? 'Raining' : `${weather.rainChancePct}% rain`}
                  </span>
                </span>
              </>
            )}
          </div>
        )}

        {currentCoord && (
          <div className="nav-hud__coords m3-mono" aria-label="Current GPS coordinates">
            <Icon name="crosshair" size={11} />
            <span>{formatGpsCoords(currentCoord)}</span>
            {rerouteState !== 'idle' && (
              <>
                <span className="nav-hud__zone-sep" aria-hidden="true">·</span>
                <span className="nav-hud__reroute-note">
                  {rerouteState === 'rerouting' ? 'Rerouting…' : 'Route recalculated'}
                </span>
              </>
            )}
          </div>
        )}
      </div>

      <div className="nav-hud__surface">
        <div className="nav-hud__status">
          <div className="nav-hud__status-main">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
              <span className="nav-hud__stats">
                <span className="nav-hud__time m3-mono">{Math.max(0, Math.round(remainingMinutes))} min</span>
                <span className="nav-hud__meta m3-mono">{formatDistance(remainingDistanceM)} remaining</span>
              </span>
              <button type="button" className="m3-btn m3-btn--outlined m3-btn--sm nav-hud__exit" onClick={onExit}>
                End
              </button>
            </div>

            {isSimulating ? (
              <input
                type="range"
                className="m3-slider"
                min={0}
                max={Math.max(1, Math.round(totalGeomM))}
                value={Math.round(progressFraction * totalGeomM)}
                onChange={(e) => onScrubProgressM(Number(e.target.value))}
                aria-label="Scrub route progress"
              />
            ) : (
              <div className="progress-line" aria-hidden="true">
                <div className="progress-line__fill" style={{ width: `${percent}%` }} />
              </div>
            )}
          </div>
          <SpeedDial speedMps={speedMps} />
        </div>

        <div className="nav-hud__actions">
          <button type="button" className="m3-btn m3-btn--tonal m3-btn--sm" onClick={onToggleSource}>
            <Icon name={isSimulating ? 'locate' : 'play'} size={14} />
            {isSimulating ? 'Use device GPS' : 'Simulate route'}
          </button>

          {isSimulating && (
            <>
              <button type="button" className="m3-btn m3-btn--outlined m3-btn--sm" onClick={onTogglePause}>
                <Icon name={isPaused ? 'play' : 'pause'} size={13} />
                {isPaused ? 'Resume' : 'Pause'}
              </button>
              <button
                type="button"
                className="m3-btn m3-btn--outlined m3-btn--sm m3-mono"
                onClick={onToggleSpeed}
                aria-label={`Simulation speed ${simSpeed}x`}
              >
                {simSpeed}×
              </button>
            </>
          )}

          {!isFollowing && (
            <button
              type="button"
              className="m3-btn m3-btn--filled m3-btn--sm"
              onClick={onRecenter}
              style={{ marginLeft: 'auto' }}
            >
              <Icon name="locate" size={14} />
              Re-centre
            </button>
          )}
          {gpsStatus === 'watching' && !isSimulating && (
            <span className="m3-meta-line" style={{ marginLeft: 'auto' }}>
              <Icon name="radio" size={12} />
              <span>GPS active</span>
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

      {zoneTransition && transitionSummary && (
        <div
          key={zoneTransition.id}
          className="zone-toast"
          role="status"
          aria-live="polite"
        >
          <span
            className="zone-toast__dot"
            style={{ background: transitionSummary.dotColor }}
            aria-hidden="true"
          />
          <div className="zone-toast__body">
            <span className="zone-toast__title">{transitionSummary.title}</span>
            <span className="zone-toast__detail">{transitionSummary.detail}</span>
          </div>
          <button
            type="button"
            className="m3-icon-btn m3-icon-btn--sm"
            onClick={onDismissZoneTransition}
            aria-label="Dismiss zone notice"
          >
            <Icon name="close" size={13} />
          </button>
        </div>
      )}
    </div>
  );
};
