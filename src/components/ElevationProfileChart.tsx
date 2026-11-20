import { useMemo, useRef, useState } from 'react';
import { Icon } from './Icon';
import type { RouteElevationProfile } from '../types/map';

interface ElevationProfileChartProps {
  profile: RouteElevationProfile;
  onFocusCoord?: (coord: [number, number]) => void;
}

const CHART_W = 340;
const CHART_H = 84;
const PAD_L = 32;
const PAD_R = 10;
const PAD_T = 12;
const PAD_B = 18;
const PLOT_W = CHART_W - PAD_L - PAD_R;
const PLOT_H = CHART_H - PAD_T - PAD_B;

function formatDistShort(meters: number): string {
  if (meters >= 1000) return `${(meters / 1000).toFixed(2)} km`;
  return `${Math.round(meters)} m`;
}

export function ElevationProfileChart({ profile, onFocusCoord }: ElevationProfileChartProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [activeIdx, setActiveIdx] = useState<number | null>(null);

  const geometry = useMemo(() => {
    const { samples, minElevationM, maxElevationM, totalDistanceM } = profile;
    const spanElev = Math.max(8, maxElevationM - minElevationM);
    const yMin = Math.floor(minElevationM - spanElev * 0.14);
    const yMax = Math.ceil(maxElevationM + spanElev * 0.16);
    const ySpan = Math.max(1, yMax - yMin);
    const safeDist = Math.max(1, totalDistanceM);

    const xOf = (distM: number) => PAD_L + (distM / safeDist) * PLOT_W;
    const yOf = (elevM: number) => PAD_T + PLOT_H - ((elevM - yMin) / ySpan) * PLOT_H;

    const pts = samples.map((s) => ({
      ...s,
      x: xOf(s.distanceM),
      y: yOf(s.elevationM),
    }));

    const linePath = pts
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
      .join(' ');
    const areaPath =
      pts.length > 1
        ? `${linePath} L${pts[pts.length - 1].x.toFixed(1)},${(PAD_T + PLOT_H).toFixed(1)} L${pts[0].x.toFixed(1)},${(PAD_T + PLOT_H).toFixed(1)} Z`
        : '';

    // Highlight steep uphill (>= 4.5%) and steep downhill (<= -4.5%) segments along the curve
    const steepClimbs: string[] = [];
    const steepDescents: string[] = [];
    for (let i = 1; i < pts.length; i += 1) {
      const prev = pts[i - 1];
      const cur = pts[i];
      const segDist = Math.max(1, cur.distanceM - prev.distanceM);
      const segGrade = ((cur.elevationM - prev.elevationM) / segDist) * 100;
      const segD = `M${prev.x.toFixed(1)},${prev.y.toFixed(1)} L${cur.x.toFixed(1)},${cur.y.toFixed(1)}`;
      if (segGrade >= 4.5) steepClimbs.push(segD);
      else if (segGrade <= -4.5) steepDescents.push(segD);
    }

    const waypoints = profile.waypointOffsets.map((wp) => ({
      ...wp,
      x: xOf(wp.distanceM),
      y: yOf(wp.elevationM),
    }));

    return {
      pts,
      linePath,
      areaPath,
      steepClimbs,
      steepDescents,
      waypoints,
      yMin,
      yMax,
      yMinLine: yOf(minElevationM),
      yMaxLine: yOf(maxElevationM),
    };
  }, [profile]);

  const activePoint = activeIdx !== null ? geometry.pts[activeIdx] ?? null : null;

  const updatePointer = (clientX: number, focusMap: boolean) => {
    const svg = svgRef.current;
    if (!svg || geometry.pts.length < 2) return;
    const rect = svg.getBoundingClientRect();
    if (rect.width <= 0) return;
    const svgX = ((clientX - rect.left) / rect.width) * CHART_W;
    const frac = Math.max(0, Math.min(1, (svgX - PAD_L) / PLOT_W));
    const idx = Math.round(frac * (geometry.pts.length - 1));
    setActiveIdx(idx);
    if (focusMap && onFocusCoord && geometry.pts[idx]) {
      onFocusCoord(geometry.pts[idx].coord);
    }
  };

  return (
    <div className="elev-card" aria-label="Route elevation profile">
      <div className="elev-card__head">
        <span className="elev-card__label">
          <Icon name="mountain" size={13} />
          <span>Elevation profile</span>
        </span>
        <span className="elev-card__totals m3-mono">
          <span className="elev-card__gain">+{profile.totalGainM} m</span>
          <span aria-hidden="true"> · </span>
          <span className="elev-card__drop">−{profile.totalDropM} m</span>
          <span aria-hidden="true"> · </span>
          <span>Peak {Math.round(profile.maxElevationM)} m</span>
        </span>
      </div>

      <svg
        ref={svgRef}
        className="elev-chart"
        viewBox={`0 0 ${CHART_W} ${CHART_H}`}
        role="img"
        aria-label={`Elevation from ${Math.round(profile.startElevationM)} to ${Math.round(profile.endElevationM)} metres, total gain ${profile.totalGainM} metres, drop ${profile.totalDropM} metres`}
        onPointerMove={(e) => updatePointer(e.clientX, false)}
        onPointerDown={(e) => updatePointer(e.clientX, true)}
        onPointerLeave={() => setActiveIdx(null)}
      >
        <defs>
          <linearGradient id="umElevAreaGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.22" />
            <stop offset="100%" stopColor="var(--primary)" stopOpacity="0.02" />
          </linearGradient>
        </defs>

        {/* Reference dashed lines for min/max route altitude */}
        <line
          x1={PAD_L}
          x2={CHART_W - PAD_R}
          y1={geometry.yMaxLine}
          y2={geometry.yMaxLine}
          className="elev-chart__grid"
        />
        <line
          x1={PAD_L}
          x2={CHART_W - PAD_R}
          y1={geometry.yMinLine}
          y2={geometry.yMinLine}
          className="elev-chart__grid"
        />

        {/* Y-axis altitude labels */}
        <text x={PAD_L - 5} y={geometry.yMaxLine + 3} textAnchor="end" className="elev-chart__axis">
          {Math.round(profile.maxElevationM)}m
        </text>
        <text x={PAD_L - 5} y={geometry.yMinLine + 3} textAnchor="end" className="elev-chart__axis">
          {Math.round(profile.minElevationM)}m
        </text>

        {/* X-axis distance labels */}
        <text x={PAD_L} y={CHART_H - 3} textAnchor="start" className="elev-chart__axis">
          0 m
        </text>
        <text x={PAD_L + PLOT_W / 2} y={CHART_H - 3} textAnchor="middle" className="elev-chart__axis">
          {formatDistShort(profile.totalDistanceM / 2)}
        </text>
        <text x={CHART_W - PAD_R} y={CHART_H - 3} textAnchor="end" className="elev-chart__axis">
          {formatDistShort(profile.totalDistanceM)}
        </text>

        {/* Fill area & base elevation curve */}
        {geometry.areaPath && <path d={geometry.areaPath} fill="url(#umElevAreaGrad)" />}
        {geometry.linePath && <path d={geometry.linePath} className="elev-chart__line" />}

        {/* Highlight steep climbs & steep descents directly on curve */}
        {geometry.steepClimbs.map((d, idx) => (
          <path key={`c-${idx}`} d={d} className="elev-chart__steep-up" />
        ))}
        {geometry.steepDescents.map((d, idx) => (
          <path key={`d-${idx}`} d={d} className="elev-chart__steep-down" />
        ))}

        {/* Multi-stop waypoint dots */}
        {geometry.waypoints.map((wp) => (
          <g key={`wp-${wp.index}`}>
            <line
              x1={wp.x}
              x2={wp.x}
              y1={wp.y}
              y2={PAD_T + PLOT_H}
              className="elev-chart__wp-line"
            />
            <circle cx={wp.x} cy={wp.y} r={3.2} className="elev-chart__wp-dot" />
          </g>
        ))}

        {/* Interactive scrub cursor */}
        {activePoint && (
          <g>
            <line
              x1={activePoint.x}
              x2={activePoint.x}
              y1={PAD_T}
              y2={PAD_T + PLOT_H}
              className="elev-chart__cursor"
            />
            <circle cx={activePoint.x} cy={activePoint.y} r={4} className="elev-chart__cursor-dot" />
          </g>
        )}
      </svg>

      <div className="elev-card__foot">
        {activePoint ? (
          <span className="m3-mono">
            {formatDistShort(activePoint.distanceM)} · {activePoint.elevationM.toFixed(1)} m ASL ·{' '}
            {activePoint.gradePct >= 0 ? '+' : ''}
            {activePoint.gradePct.toFixed(1)}% grade
          </span>
        ) : (
          <span>
            {profile.steepClimbCount > 0 || profile.steepDescentCount > 0
              ? [
                  profile.steepClimbCount > 0
                    ? `${profile.steepClimbCount} steep climb${profile.steepClimbCount > 1 ? 's' : ''}`
                    : null,
                  profile.steepDescentCount > 0
                    ? `${profile.steepDescentCount} steep descent${profile.steepDescentCount > 1 ? 's' : ''}`
                    : null,
                ]
                  .filter(Boolean)
                  .join(' · ')
              : 'Gentle campus terrain'}
            {' · '}
            Tap curve to inspect
          </span>
        )}
      </div>
    </div>
  );
}
