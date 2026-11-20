import { CampusRouter, distMeters } from '../routing/pathfinder';
import type {
  ComputedRoute,
  CustomRouteAnchor,
  RouteStep,
  RouteWaypoint,
  SearchItem,
  UserLocation,
} from '../types/map';

const METERS_PER_LAT = 110540;
const METERS_PER_LON = 111320 * Math.cos((3.122 * Math.PI) / 180);

/**
 * Formats [lng, lat] into a crisp compact coordinate readout (e.g. "3.12092°N, 101.65384°E").
 */
export function formatGpsCoords(coord: [number, number] | null): string {
  if (!coord || !Number.isFinite(coord[0]) || !Number.isFinite(coord[1])) return '';
  const [lng, lat] = coord;
  const latStr = `${Math.abs(lat).toFixed(5)}°${lat >= 0 ? 'N' : 'S'}`;
  const lngStr = `${Math.abs(lng).toFixed(5)}°${lng >= 0 ? 'E' : 'W'}`;
  return `${latStr}, ${lngStr}`;
}

/**
 * Returns true when a starting SearchItem matches the user's current device location
 * (either explicitly selected as "Current location" or within `toleranceM` of the live GPS fix).
 */
export function isOriginAtUserLocation(
  origin: SearchItem | null,
  userLocation: UserLocation | null,
  toleranceM = 65,
): boolean {
  if (!origin) return false;
  if (origin.id === 'user-location') return true;
  if (!userLocation) return false;
  return distMeters(origin.center, userLocation.coord) <= toleranceM;
}

/**
 * Returns true when an arbitrary starting coordinate is near the user's live GPS fix.
 */
export function isCoordAtUserLocation(
  coord: [number, number] | null,
  userLocation: UserLocation | null,
  toleranceM = 65,
): boolean {
  if (!coord || !userLocation) return false;
  return distMeters(coord, userLocation.coord) <= toleranceM;
}

export interface PolylineProjection {
  distanceM: number;
  alongM: number;
  segmentIndex: number;
  closestCoord: [number, number];
}

/**
 * Orthogonally projects `coord` onto the nearest segment of `polyline`, returning
 * true cross-track distance in meters and cumulative distance along the route.
 */
export function projectPointOntoPolyline(
  coord: [number, number],
  polyline: [number, number][],
): PolylineProjection {
  if (polyline.length === 0) {
    return { distanceM: Infinity, alongM: 0, segmentIndex: 0, closestCoord: coord };
  }
  if (polyline.length === 1) {
    return {
      distanceM: distMeters(coord, polyline[0]),
      alongM: 0,
      segmentIndex: 0,
      closestCoord: polyline[0],
    };
  }

  let bestDist = Infinity;
  let bestAlong = 0;
  let bestSeg = 0;
  let bestCoord: [number, number] = polyline[0];
  let cumM = 0;

  const px = coord[0] * METERS_PER_LON;
  const py = coord[1] * METERS_PER_LAT;

  for (let i = 0; i < polyline.length - 1; i++) {
    const a = polyline[i];
    const b = polyline[i + 1];
    const ax = a[0] * METERS_PER_LON;
    const ay = a[1] * METERS_PER_LAT;
    const bx = b[0] * METERS_PER_LON;
    const by = b[1] * METERS_PER_LAT;
    const dx = bx - ax;
    const dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    const segLen = Math.sqrt(lenSq);

    let t = 0;
    if (lenSq > 1e-6) {
      t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
    }
    const cx = ax + dx * t;
    const cy = ay + dy * t;
    const d = Math.hypot(px - cx, py - cy);

    if (d < bestDist) {
      bestDist = d;
      bestAlong = cumM + segLen * t;
      bestSeg = i;
      bestCoord = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    }
    cumM += segLen;
  }

  return {
    distanceM: bestDist,
    alongM: bestAlong,
    segmentIndex: bestSeg,
    closestCoord: bestCoord,
  };
}

/**
 * Filters intermediate stops during live navigation, marking stops as passed once
 * the user comes within `passRadiusM` so adaptive rerouting only routes through
 * remaining unvisited stops.
 */
export function filterRemainingStops(
  stops: SearchItem[],
  passedStopIds: ReadonlySet<string>,
  userCoord: [number, number],
  passRadiusM = 28,
): { remaining: SearchItem[]; newlyPassedIds: string[] } {
  const remaining: SearchItem[] = [];
  const newlyPassedIds: string[] = [];

  for (const stop of stops) {
    const key = `${stop.kind}:${stop.id}`;
    if (passedStopIds.has(key)) continue;
    if (distMeters(userCoord, stop.center) <= passRadiusM) {
      newlyPassedIds.push(key);
      continue;
    }
    remaining.push(stop);
  }
  return { remaining, newlyPassedIds };
}

/* ------------------------------------------------------------------
   Google Maps-Style On-Road Turning Arrows
   ------------------------------------------------------------------ */

function segmentBearingDeg(a: [number, number], b: [number, number]): number {
  const dx = (b[0] - a[0]) * METERS_PER_LON;
  const dy = (b[1] - a[1]) * METERS_PER_LAT;
  if (Math.hypot(dx, dy) < 1e-6) return 0;
  return ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
}

function signedTurnAngleDeg(
  p0: [number, number],
  p1: [number, number],
  p2: [number, number],
): number {
  const ax = (p1[0] - p0[0]) * METERS_PER_LON;
  const ay = (p1[1] - p0[1]) * METERS_PER_LAT;
  const bx = (p2[0] - p1[0]) * METERS_PER_LON;
  const by = (p2[1] - p1[1]) * METERS_PER_LAT;
  const la = Math.hypot(ax, ay);
  const lb = Math.hypot(bx, by);
  if (la < 0.8 || lb < 0.8) return 0;
  const dot = (ax * bx + ay * by) / (la * lb);
  const cross = (ax * by - ay * bx) / (la * lb);
  return (Math.atan2(cross, dot) * 180) / Math.PI;
}

function samplePointAtDist(
  coords: [number, number][],
  cumDists: number[],
  targetDist: number,
): [number, number] {
  const maxD = cumDists[cumDists.length - 1] ?? 0;
  const d = Math.max(0, Math.min(maxD, targetDist));
  let idx = 0;
  while (idx < cumDists.length - 2 && cumDists[idx + 1] < d) {
    idx += 1;
  }
  const segStart = cumDists[idx];
  const segEnd = cumDists[idx + 1];
  const span = Math.max(1e-6, segEnd - segStart);
  const t = Math.max(0, Math.min(1, (d - segStart) / span));
  const a = coords[idx];
  const b = coords[idx + 1];
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

function slicePolylineAroundDistance(
  coords: [number, number][],
  cumDists: number[],
  centerDist: number,
  beforeM: number,
  afterM: number,
): [number, number][] {
  const maxD = cumDists[cumDists.length - 1] ?? 0;
  const startD = Math.max(0, centerDist - beforeM);
  const endD = Math.min(maxD, centerDist + afterM);
  if (endD - startD < 4) return [];

  const out: [number, number][] = [samplePointAtDist(coords, cumDists, startD)];
  for (let i = 0; i < coords.length; i++) {
    if (cumDists[i] > startD + 0.5 && cumDists[i] < endD - 0.5) {
      out.push(coords[i]);
    }
  }
  out.push(samplePointAtDist(coords, cumDists, endD));
  return out;
}

export interface TurnArrowBundle {
  lines: GeoJSON.FeatureCollection;
  heads: GeoJSON.FeatureCollection;
  count: number;
}

/**
 * Extracts Google Maps-style road-hugging turning arrows at every significant bend
 * along a route. Returns LineString shafts + Point arrowheads with exact outgoing
 * road bearing and an `isNext` flag for the active/upcoming navigation turn.
 */
export function extractTurnArrows(
  route: ComputedRoute | null,
  activeStepIndex = -1,
): TurnArrowBundle {
  const empty: TurnArrowBundle = {
    lines: { type: 'FeatureCollection', features: [] },
    heads: { type: 'FeatureCollection', features: [] },
    count: 0,
  };
  if (!route || route.coordinates.length < 3) return empty;

  const coords = route.coordinates;
  const cumDists: number[] = [0];
  for (let i = 1; i < coords.length; i++) {
    cumDists.push(cumDists[i - 1] + distMeters(coords[i - 1], coords[i]));
  }
  const totalDist = cumDists[cumDists.length - 1];
  if (totalDist < 12) return empty;

  // Map step coords onto cumulative distances so we can mark the next maneuver turn
  const stepDists: number[] = [];
  let searchFrom = 0;
  for (const st of route.steps) {
    let bestIdx = searchFrom;
    let bestD = Infinity;
    for (let i = searchFrom; i < coords.length; i++) {
      const d = distMeters(coords[i], st.coord);
      if (d < bestD) {
        bestD = d;
        bestIdx = i;
      }
      if (bestD < 8) break;
    }
    searchFrom = bestIdx;
    stepDists.push(cumDists[bestIdx]);
  }

  const nextStepDist =
    activeStepIndex >= 0 && activeStepIndex + 1 < stepDists.length
      ? stepDists[activeStepIndex + 1]
      : activeStepIndex >= 0 && activeStepIndex < stepDists.length
        ? stepDists[activeStepIndex]
        : -1;

  // Detect significant turn vertices along polyline using ~8m look-back / look-ahead vectors
  interface TurnCandidate {
    distM: number;
    angleDeg: number;
    stepIndex: number;
  }
  const candidates: TurnCandidate[] = [];

  for (let i = 1; i < coords.length - 1; i++) {
    const centerD = cumDists[i];
    if (centerD < 7 || totalDist - centerD < 7) continue;

    const pPrev = samplePointAtDist(coords, cumDists, Math.max(0, centerD - 8));
    const pNext = samplePointAtDist(coords, cumDists, Math.min(totalDist, centerD + 8));
    const ang = signedTurnAngleDeg(pPrev, coords[i], pNext);
    if (Math.abs(ang) < 28) continue;

    // Merge close vertices into the sharpest peak of the bend (within 18 m)
    const prev = candidates[candidates.length - 1];
    if (prev && centerD - prev.distM < 18) {
      if (Math.abs(ang) > Math.abs(prev.angleDeg)) {
        prev.distM = centerD;
        prev.angleDeg = ang;
      }
      continue;
    }

    // Match nearest route step index
    let matchedStep = 0;
    let bestStepDiff = Infinity;
    for (let s = 0; s < stepDists.length; s++) {
      const diff = Math.abs(stepDists[s] - centerD);
      if (diff < bestStepDiff) {
        bestStepDiff = diff;
        matchedStep = s;
      }
    }
    candidates.push({ distM: centerD, angleDeg: ang, stepIndex: matchedStep });
  }

  // Pick single "next" highlighted turn arrow closest to upcoming step (within 40 m)
  let highlightedIdx = -1;
  if (nextStepDist >= 0 && candidates.length > 0) {
    let bestDiff = Infinity;
    for (let i = 0; i < candidates.length; i++) {
      const diff = Math.abs(candidates[i].distM - nextStepDist);
      if (diff < bestDiff && diff <= 45) {
        bestDiff = diff;
        highlightedIdx = i;
      }
    }
  }

  const lineFeatures: GeoJSON.Feature[] = [];
  const headFeatures: GeoJSON.Feature[] = [];

  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    const isNext = i === highlightedIdx;
    const beforeM = isNext ? 14 : 11;
    const afterM = isNext ? 16 : 13;
    const clip = slicePolylineAroundDistance(coords, cumDists, c.distM, beforeM, afterM);
    if (clip.length < 2) continue;

    const tip = clip[clip.length - 1];
    const preTip = clip[clip.length - 2];
    const bearing = segmentBearingDeg(preTip, tip);
    const turnDir =
      Math.abs(c.angleDeg) >= 135 ? 'uturn' : c.angleDeg > 0 ? 'left' : 'right';

    lineFeatures.push({
      type: 'Feature',
      properties: {
        id: `turn-line-${i}`,
        isNext: isNext ? 1 : 0,
        turnDir,
        stepIndex: c.stepIndex,
      },
      geometry: {
        type: 'LineString',
        coordinates: clip,
      },
    });

    headFeatures.push({
      type: 'Feature',
      properties: {
        id: `turn-head-${i}`,
        isNext: isNext ? 1 : 0,
        bearing,
        turnDir,
        stepIndex: c.stepIndex,
      },
      geometry: {
        type: 'Point',
        coordinates: tip,
      },
    });
  }

  return {
    lines: { type: 'FeatureCollection', features: lineFeatures },
    heads: { type: 'FeatureCollection', features: headFeatures },
    count: headFeatures.length,
  };
}

/* ------------------------------------------------------------------
   Custom Route Builder: Computation, Drag-to-Snap & URL Encoding
   ------------------------------------------------------------------ */

function anchorToSearchItem(anchor: CustomRouteAnchor, idx: number): SearchItem {
  return {
    id: anchor.id,
    kind: 'point',
    title: anchor.label || `Point ${idx + 1}`,
    subtitle: 'Custom route point',
    keywords: 'custom point',
    center: anchor.coord,
    entrance_node: -1,
  };
}

function compassDir(a: [number, number], b: [number, number]): string {
  const deg = segmentBearingDeg(a, b);
  const dirs = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'];
  return dirs[Math.round(deg / 45) % 8];
}

function directTurnVerb(
  p0: [number, number],
  p1: [number, number],
  p2: [number, number],
): string {
  const ang = signedTurnAngleDeg(p0, p1, p2);
  if (ang > 35 && ang < 135) return 'Turn left';
  if (ang >= 15 && ang <= 35) return 'Keep left';
  if (ang < -35 && ang > -135) return 'Turn right';
  if (ang <= -15 && ang >= -35) return 'Keep right';
  if (Math.abs(ang) >= 135) return 'Make a U-turn';
  return 'Continue straight';
}

/**
 * Computes a full `ComputedRoute` from ordered user-defined custom anchors.
 * When `snapToGraph` is enabled, snaps every leg onto real UM campus roads, footpaths,
 * and shortcuts using `CampusRouter`; otherwise draws crisp direct legs.
 */
export function computeCustomRoute(
  router: CampusRouter | null,
  anchors: CustomRouteAnchor[],
  mode: 'walk' | 'bike' | 'drive',
  snapToGraph: boolean,
): ComputedRoute | null {
  if (anchors.length < 2) return null;

  const first = anchors[0];
  const last = anchors[anchors.length - 1];
  const intermediateWaypoints: RouteWaypoint[] = anchors.slice(1, -1).map((a, idx) => ({
    index: idx + 1,
    label: a.label || `Point ${idx + 2}`,
    coord: a.coord,
  }));

  if (snapToGraph && router) {
    const originItem = anchorToSearchItem(first, 0);
    const destItem = anchorToSearchItem(last, anchors.length - 1);
    const midItems = anchors.slice(1, -1).map((a, idx) => anchorToSearchItem(a, idx + 1));
    const snapped = router.computeMultiStopRoute(originItem, midItems, destItem, mode, {
      stepFree: mode === 'bike',
    });
    if (snapped) {
      return {
        ...snapped,
        waypoints: intermediateWaypoints,
      };
    }
  }

  // Direct / freehand fallback (also used when snapToGraph is toggled off)
  const coordinates: [number, number][] = anchors.map((a) => a.coord);
  const segKind: 'road' | 'footway' = mode === 'drive' ? 'road' : 'footway';
  const segments: ComputedRoute['segments'] = [{ kind: segKind, coordinates: coordinates.slice() }];
  const steps: RouteStep[] = [];
  let totalDistanceM = 0;

  for (let i = 0; i < anchors.length - 1; i++) {
    const a = anchors[i];
    const b = anchors[i + 1];
    const legDist = distMeters(a.coord, b.coord);
    totalDistanceM += legDist;

    let instruction = '';
    if (i === 0) {
      const verb = mode === 'bike' ? 'Cycle' : mode === 'drive' ? 'Drive' : 'Head';
      instruction = `${verb} ${compassDir(a.coord, b.coord)} toward ${b.label || `Point ${i + 2}`}`;
    } else {
      const verb = directTurnVerb(anchors[i - 1].coord, a.coord, b.coord);
      instruction = `${verb} toward ${b.label || `Point ${i + 2}`}`;
    }

    steps.push({
      instruction,
      detail: snapToGraph ? 'Direct connector' : 'Custom freehand segment',
      distanceM: Math.round(legDist),
      kind: segKind,
      coord: a.coord,
    });

    if (i < anchors.length - 2) {
      steps.push({
        instruction: `Point ${i + 2}: ${b.label || `Waypoint ${i + 1}`}`,
        detail: 'Custom waypoint',
        distanceM: 0,
        kind: 'waypoint',
        waypointIndex: i + 1,
        coord: b.coord,
      });
    }
  }

  steps.push({
    instruction: `Arrive at ${last.label || `Point ${anchors.length}`}`,
    detail: 'End of custom route',
    distanceM: 0,
    kind: 'indoor',
    coord: last.coord,
  });

  const speedMpm = mode === 'drive' ? 420 : mode === 'bike' ? 240 : 80;
  return {
    mode,
    stepFreeUsed: mode === 'bike',
    coordinates,
    segments,
    totalDistanceM: Math.round(totalDistanceM),
    estimatedMinutes: Math.max(1, Math.round(totalDistanceM / speedMpm)),
    shortcutCount: 0,
    stepsCount: 0,
    busRoutesUsed: [],
    steps,
    waypoints: intermediateWaypoints,
    originLabel: first.label || 'Start',
    destLabel: last.label || 'Finish',
  };
}

/**
 * Given a drag grab point on an active route polyline, finds the exact leg index
 * (`0 .. anchors.length - 2`) where a newly dragged shaping anchor should be inserted.
 */
export function findInsertLegIndex(
  route: ComputedRoute,
  anchors: CustomRouteAnchor[],
  grabCoord: [number, number],
): number {
  if (anchors.length <= 2 || route.coordinates.length < 2) return 0;

  const grabProj = projectPointOntoPolyline(grabCoord, route.coordinates);
  const anchorAlongs: number[] = [];

  // Anchor coordinates progress monotonically along route polyline
  let searchStartSeg = 0;
  const coords = route.coordinates;
  const cumDists: number[] = [0];
  for (let i = 1; i < coords.length; i++) {
    cumDists.push(cumDists[i - 1] + distMeters(coords[i - 1], coords[i]));
  }

  for (let a = 0; a < anchors.length; a++) {
    if (a === 0) {
      anchorAlongs.push(0);
      continue;
    }
    if (a === anchors.length - 1) {
      anchorAlongs.push(cumDists[cumDists.length - 1]);
      continue;
    }
    let bestIdx = searchStartSeg;
    let bestD = Infinity;
    for (let i = searchStartSeg; i < coords.length; i++) {
      const d = distMeters(coords[i], anchors[a].coord);
      if (d < bestD) {
        bestD = d;
        bestIdx = i;
      }
    }
    searchStartSeg = bestIdx;
    anchorAlongs.push(cumDists[bestIdx]);
  }

  for (let leg = 0; leg < anchorAlongs.length - 1; leg++) {
    if (grabProj.alongM >= anchorAlongs[leg] && grabProj.alongM <= anchorAlongs[leg + 1]) {
      return leg;
    }
  }
  return Math.max(0, anchors.length - 2);
}

/**
 * Encodes custom route anchors into a compact URL-safe coordinate string
 * (`lat,lng;lat,lng;...` at 5 decimal places ≈ 1.1m accuracy).
 */
export function encodeCustomAnchors(anchors: CustomRouteAnchor[]): string {
  return anchors
    .map((a) => `${a.coord[1].toFixed(5)},${a.coord[0].toFixed(5)}`)
    .join(';');
}

/**
 * Decodes compact custom route anchor coordinates from a shared URL query parameter.
 */
export function decodeCustomAnchors(encoded: string): CustomRouteAnchor[] {
  if (!encoded.trim()) return [];
  const parts = encoded.split(';').map((s) => s.trim()).filter(Boolean);
  const out: CustomRouteAnchor[] = [];
  for (let i = 0; i < parts.length && out.length < 60; i++) {
    const [latStr, lngStr] = parts[i].split(',');
    const lat = Number(latStr);
    const lng = Number(lngStr);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) continue;
    out.push({
      id: `shared-anchor-${i + 1}`,
      coord: [lng, lat],
      label: i === 0 ? 'Start' : i === parts.length - 1 ? 'Finish' : `Point ${i + 1}`,
    });
  }
  return out;
}

export function slugifyRouteFilename(name: string): string {
  const cleaned = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return `${cleaned || 'um-campus-route'}.png`;
}
