import { distMeters } from '../routing/pathfinder';
import type {
  ComputedRoute,
  ElevationGridData,
  ElevationProfilePoint,
  RouteElevationProfile,
  RouteStepElevation,
} from '../types/map';

const STEEP_GRADE_THRESHOLD_PCT = 4.5;
const STEEP_MIN_DELTA_M = 2.0;
const GAIN_HYSTERESIS_M = 0.7;

/**
 * Fast bilinear interpolation over the pre-baked Universiti Malaya DEM grid.
 * Returns elevation in metres above sea level (m ASL), or null if outside coverage.
 */
export function sampleElevation(
  coord: [number, number] | null | undefined,
  grid: ElevationGridData | null | undefined,
): number | null {
  if (!coord || !grid || grid.cols < 2 || grid.rows < 2 || grid.values.length < grid.cols * grid.rows) {
    return null;
  }
  const [lon, lat] = coord;
  if (
    !Number.isFinite(lon) ||
    !Number.isFinite(lat) ||
    lon < grid.minLon ||
    lon > grid.maxLon ||
    lat < grid.minLat ||
    lat > grid.maxLat
  ) {
    return null;
  }

  const u = ((lon - grid.minLon) / (grid.maxLon - grid.minLon)) * (grid.cols - 1);
  const v = ((lat - grid.minLat) / (grid.maxLat - grid.minLat)) * (grid.rows - 1);

  const c0 = Math.min(grid.cols - 2, Math.max(0, Math.floor(u)));
  const r0 = Math.min(grid.rows - 2, Math.max(0, Math.floor(v)));
  const c1 = c0 + 1;
  const r1 = r0 + 1;

  const tx = Math.min(1, Math.max(0, u - c0));
  const ty = Math.min(1, Math.max(0, v - r0));

  const scale = grid.scale || 10;
  const z00 = grid.values[r0 * grid.cols + c0] / scale;
  const z10 = grid.values[r0 * grid.cols + c1] / scale;
  const z01 = grid.values[r1 * grid.cols + c0] / scale;
  const z11 = grid.values[r1 * grid.cols + c1] / scale;

  const z0 = z00 + (z10 - z00) * tx;
  const z1 = z01 + (z11 - z01) * tx;
  return Number((z0 + (z1 - z0) * ty).toFixed(1));
}

/**
 * Smooths raw sampled elevation values gently (3-point triangular kernel)
 * to suppress DEM grid quantization noise while preserving real campus hills.
 */
function smoothElevations(values: number[]): number[] {
  if (values.length <= 2) return values.slice();
  const out = new Array<number>(values.length);
  out[0] = values[0];
  out[values.length - 1] = values[values.length - 1];
  for (let i = 1; i < values.length - 1; i += 1) {
    out[i] = values[i - 1] * 0.25 + values[i] * 0.5 + values[i + 1] * 0.25;
  }
  return out;
}

/**
 * Interpolates a coordinate along a polyline given cumulative distances.
 */
function interpAlongPolyline(
  coords: [number, number][],
  cumDists: number[],
  targetDistM: number,
): [number, number] {
  const n = coords.length;
  if (targetDistM <= 0) return coords[0];
  if (targetDistM >= cumDists[n - 1]) return coords[n - 1];
  let lo = 0;
  let hi = n - 1;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (cumDists[mid] <= targetDistM) lo = mid;
    else hi = mid;
  }
  const segLen = Math.max(1e-6, cumDists[hi] - cumDists[lo]);
  const t = Math.max(0, Math.min(1, (targetDistM - cumDists[lo]) / segLen));
  return [
    coords[lo][0] + (coords[hi][0] - coords[lo][0]) * t,
    coords[lo][1] + (coords[hi][1] - coords[lo][1]) * t,
  ];
}

/**
 * Computes a complete elevation profile for a routed campus path:
 * - Total ascent (+m) and descent (-m) with deadband filtering
 * - Uniformly resampled elevation curve with local grade (%)
 * - Multi-stop waypoint positions along the elevation curve
 * - Per-step elevation delta & steep-climb / steep-descent tags
 */
export function computeRouteElevationProfile(
  route: ComputedRoute | null,
  grid: ElevationGridData | null,
): RouteElevationProfile | null {
  if (!route || !grid || route.coordinates.length < 2) return null;

  const coords = route.coordinates;
  const cumDists: number[] = [0];
  for (let i = 1; i < coords.length; i += 1) {
    cumDists.push(cumDists[i - 1] + distMeters(coords[i - 1], coords[i]));
  }
  const totalDistM = cumDists[cumDists.length - 1];
  if (totalDistM < 1) return null;

  // Resample every ~20m (bounded to 18..120 points for crisp SVG rendering)
  const sampleCount = Math.min(120, Math.max(18, Math.round(totalDistM / 20) + 1));
  const rawDists: number[] = [];
  const rawCoords: [number, number][] = [];
  const rawElevs: number[] = [];

  for (let i = 0; i < sampleCount; i += 1) {
    const d = (totalDistM * i) / (sampleCount - 1);
    const c = interpAlongPolyline(coords, cumDists, d);
    const elev = sampleElevation(c, grid);
    if (elev === null) return null;
    rawDists.push(d);
    rawCoords.push(c);
    rawElevs.push(elev);
  }

  const smoothed = smoothElevations(rawElevs);

  // Compute local grade (%) using a short centered window (~1-2 samples)
  const samples: ElevationProfilePoint[] = [];
  let minElevationM = Infinity;
  let maxElevationM = -Infinity;
  for (let i = 0; i < smoothed.length; i += 1) {
    const elev = Number(smoothed[i].toFixed(1));
    if (elev < minElevationM) minElevationM = elev;
    if (elev > maxElevationM) maxElevationM = elev;

    const prevIdx = Math.max(0, i - 1);
    const nextIdx = Math.min(smoothed.length - 1, i + 1);
    const spanDist = Math.max(1, rawDists[nextIdx] - rawDists[prevIdx]);
    const gradePct = Number((((smoothed[nextIdx] - smoothed[prevIdx]) / spanDist) * 100).toFixed(1));

    samples.push({
      distanceM: Number(rawDists[i].toFixed(1)),
      elevationM: elev,
      gradePct,
      coord: rawCoords[i],
    });
  }

  // Compute total elevation gain & drop with gentle hysteresis deadband
  let totalGain = 0;
  let totalDrop = 0;
  let anchorElev = smoothed[0];
  let direction: -1 | 0 | 1 = 0;
  let extremumElev = smoothed[0];

  for (let i = 1; i < smoothed.length; i += 1) {
    const e = smoothed[i];
    if (direction === 0) {
      if (e - anchorElev >= GAIN_HYSTERESIS_M) {
        direction = 1;
        extremumElev = e;
      } else if (anchorElev - e >= GAIN_HYSTERESIS_M) {
        direction = -1;
        extremumElev = e;
      }
    } else if (direction === 1) {
      if (e >= extremumElev) {
        extremumElev = e;
      } else if (extremumElev - e >= GAIN_HYSTERESIS_M) {
        totalGain += extremumElev - anchorElev;
        anchorElev = extremumElev;
        extremumElev = e;
        direction = -1;
      }
    } else {
      if (e <= extremumElev) {
        extremumElev = e;
      } else if (e - extremumElev >= GAIN_HYSTERESIS_M) {
        totalDrop += anchorElev - extremumElev;
        anchorElev = extremumElev;
        extremumElev = e;
        direction = 1;
      }
    }
  }
  if (direction === 1) totalGain += Math.max(0, extremumElev - anchorElev);
  else if (direction === -1) totalDrop += Math.max(0, anchorElev - extremumElev);

  // If net change is nonzero on short smooth monotonic climbs below hysteresis, keep it consistent
  const startElevationM = samples[0].elevationM;
  const endElevationM = samples[samples.length - 1].elevationM;
  const netChangeM = Number((endElevationM - startElevationM).toFixed(1));
  if (totalGain === 0 && totalDrop === 0 && Math.abs(netChangeM) >= 0.5) {
    if (netChangeM > 0) totalGain = netChangeM;
    else totalDrop = Math.abs(netChangeM);
  }

  // Locate multi-stop waypoints along cumulative route distance
  const waypointOffsets: RouteElevationProfile['waypointOffsets'] = [];
  if (route.waypoints && route.waypoints.length > 0) {
    let wpSearchFrom = 0;
    for (const wp of route.waypoints) {
      let bestIdx = wpSearchFrom;
      let bestD = Infinity;
      for (let i = wpSearchFrom; i < coords.length; i += 1) {
        const d = distMeters(coords[i], wp.coord);
        if (d < bestD) {
          bestD = d;
          bestIdx = i;
        }
        if (bestD < 10) break;
      }
      wpSearchFrom = bestIdx;
      const distM = cumDists[bestIdx];
      const elev = sampleElevation(coords[bestIdx], grid) ?? startElevationM;
      waypointOffsets.push({
        index: wp.index,
        label: wp.label,
        distanceM: Number(distM.toFixed(1)),
        elevationM: elev,
      });
    }
  }

  // Map each route step to its elevation delta and steep-hill grade tag
  const stepStartsM: number[] = [];
  let searchFrom = 0;
  for (const step of route.steps) {
    let bestIdx = searchFrom;
    let bestD = Infinity;
    for (let i = searchFrom; i < coords.length; i += 1) {
      const d = distMeters(coords[i], step.coord);
      if (d < bestD) {
        bestD = d;
        bestIdx = i;
      }
      if (bestD < 12) break;
    }
    searchFrom = bestIdx;
    stepStartsM.push(cumDists[bestIdx]);
  }

  const sampleAtDist = (distM: number): number => {
    const clamped = Math.max(0, Math.min(totalDistM, distM));
    const idxFloat = (clamped / totalDistM) * (samples.length - 1);
    const i0 = Math.floor(idxFloat);
    const i1 = Math.min(samples.length - 1, i0 + 1);
    const frac = idxFloat - i0;
    return samples[i0].elevationM + (samples[i1].elevationM - samples[i0].elevationM) * frac;
  };

  let steepClimbCount = 0;
  let steepDescentCount = 0;

  const stepElevations: (RouteStepElevation | null)[] = route.steps.map((step, idx) => {
    if (step.kind === 'indoor' || step.kind === 'bus' || step.kind === 'waypoint' || step.distanceM < 12) {
      return null;
    }
    const startM = stepStartsM[idx];
    const nextStartM = idx + 1 < stepStartsM.length ? stepStartsM[idx + 1] : totalDistM;
    const endM = Math.max(startM + Math.min(step.distanceM, totalDistM - startM), nextStartM);
    const spanDist = Math.max(step.distanceM, endM - startM, 1);

    const startElev = Number(sampleAtDist(startM).toFixed(1));
    const endElev = Number(sampleAtDist(Math.min(totalDistM, endM)).toFixed(1));
    const deltaM = Number((endElev - startElev).toFixed(1));
    const gradePct = Number(((deltaM / spanDist) * 100).toFixed(1));

    let hillTag: RouteStepElevation['hillTag'] = null;
    if (
      (gradePct >= STEEP_GRADE_THRESHOLD_PCT && deltaM >= STEEP_MIN_DELTA_M) ||
      (step.kind === 'steps' && deltaM >= 1.5)
    ) {
      hillTag = 'steep-climb';
      steepClimbCount += 1;
    } else if (
      (gradePct <= -STEEP_GRADE_THRESHOLD_PCT && deltaM <= -STEEP_MIN_DELTA_M) ||
      (step.kind === 'steps' && deltaM <= -1.5)
    ) {
      hillTag = 'steep-descent';
      steepDescentCount += 1;
    }

    return {
      startElevationM: startElev,
      endElevationM: endElev,
      deltaM,
      gradePct,
      hillTag,
    };
  });

  return {
    totalGainM: Math.round(totalGain),
    totalDropM: Math.round(totalDrop),
    minElevationM: Number(minElevationM.toFixed(1)),
    maxElevationM: Number(maxElevationM.toFixed(1)),
    startElevationM,
    endElevationM,
    netChangeM,
    totalDistanceM: Number(totalDistM.toFixed(1)),
    steepClimbCount,
    steepDescentCount,
    samples,
    waypointOffsets,
    stepElevations,
  };
}

/**
 * Computes remaining climb (+m) and drop (-m) from a live navigation progress distance.
 */
export function computeRemainingElevation(
  profile: RouteElevationProfile | null,
  progressM: number,
): { remainingGainM: number; remainingDropM: number } | null {
  if (!profile || profile.samples.length < 2) return null;
  const clamped = Math.max(0, Math.min(profile.totalDistanceM, progressM));
  let gain = 0;
  let drop = 0;
  let prevElev: number | null = null;

  for (const pt of profile.samples) {
    if (pt.distanceM < clamped) continue;
    if (prevElev !== null) {
      const diff = pt.elevationM - prevElev;
      if (diff > 0.35) gain += diff;
      else if (diff < -0.35) drop += -diff;
    }
    prevElev = pt.elevationM;
  }

  return {
    remainingGainM: Math.round(gain),
    remainingDropM: Math.round(drop),
  };
}
