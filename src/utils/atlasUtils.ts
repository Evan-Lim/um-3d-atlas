import { CampusRouter, distMeters } from '../routing/pathfinder';
import type { ComputedRoute, FacultyProps, RouteMode, SearchItem, TransitRoute } from '../types/map';

export interface NearbyTransitStop {
  name: string;
  ref: string;
  coord: [number, number];
  walk_node: number;
  distanceM: number;
  walkMinutes: number;
  routes: {
    id: string;
    code: string;
    name: string;
    color: string;
    headway_min: number;
    operator: string;
  }[];
}

export interface ModeComparison {
  walk: ComputedRoute | null;
  bike: ComputedRoute | null;
  bus: ComputedRoute | null;
  drive: ComputedRoute | null;
}

export interface WalkHealthMetrics {
  stepsEstimate: number;
  kcalEstimate: number;
  coveredRatio: number;
}

export interface BikeRouteMetrics {
  kcalEstimate: number;
  roadRatio: number;
  pavedPathRatio: number;
}

/**
 * Finds unique transit stops near a coordinate, aggregating all bus/shuttle routes
 * serving each stop and sorting by straight-line walking distance.
 */
export function findNearbyStops(
  coord: [number, number],
  transitRoutes: TransitRoute[],
  maxRadiusM = 650,
  limit = 4,
): NearbyTransitStop[] {
  const byKey = new Map<string, NearbyTransitStop>();

  for (const route of transitRoutes) {
    for (const stop of route.stops) {
      const d = Math.round(distMeters(coord, stop.coord));
      if (d > maxRadiusM) continue;

      const key = `${stop.name.toLowerCase()}|${stop.coord[0].toFixed(3)},${stop.coord[1].toFixed(3)}`;
      let entry = byKey.get(key);
      if (!entry) {
        entry = {
          name: stop.name,
          ref: stop.ref,
          coord: stop.coord,
          walk_node: stop.walk_node,
          distanceM: d,
          walkMinutes: Math.max(1, Math.round(d / 78)),
          routes: [],
        };
        byKey.set(key, entry);
      } else if (d < entry.distanceM) {
        entry.distanceM = d;
        entry.walkMinutes = Math.max(1, Math.round(d / 78));
      }

      if (!entry.routes.some((r) => r.code === route.code)) {
        entry.routes.push({
          id: route.id,
          code: route.code,
          name: route.name,
          color: route.color,
          headway_min: route.headway_min,
          operator: route.operator,
        });
      }
    }
  }

  return Array.from(byKey.values())
    .sort((a, b) => a.distanceM - b.distanceM)
    .slice(0, limit);
}

/**
 * Computes routes across all 4 travel modes (walk, bike, bus, drive) for instant tab comparison.
 */
export function compareAllModes(
  router: CampusRouter | null,
  origin: SearchItem | null,
  dest: SearchItem | null,
  stepFree: boolean,
  stops: SearchItem[] = [],
): ModeComparison {
  if (!router || !origin || !dest) {
    return { walk: null, bike: null, bus: null, drive: null };
  }
  if (stops.length === 0 && origin.id === dest.id && origin.kind === dest.kind) {
    return { walk: null, bike: null, bus: null, drive: null };
  }
  return {
    walk: router.computeMultiStopRoute(origin, stops, dest, 'walk', { stepFree }),
    bike: router.computeMultiStopRoute(origin, stops, dest, 'bike', { stepFree: true }),
    bus: router.computeMultiStopRoute(origin, stops, dest, 'bus', { stepFree }),
    drive: router.computeMultiStopRoute(origin, stops, dest, 'drive', { stepFree: false }),
  };
}

/**
 * Calculates walking step count, active kilocalories, and covered shortcut ratio.
 */
export function computeWalkMetrics(route: ComputedRoute | null): WalkHealthMetrics {
  if (!route || route.totalDistanceM <= 0) {
    return { stepsEstimate: 0, kcalEstimate: 0, coveredRatio: 0 };
  }
  const stepsEstimate = Math.round(route.totalDistanceM * 1.31);
  const kcalEstimate = Math.max(1, Math.round(route.totalDistanceM * 0.048));

  let shortcutM = 0;
  for (const step of route.steps) {
    if (step.kind === 'shortcut' || step.kind === 'indoor') {
      shortcutM += step.distanceM;
    }
  }
  const coveredRatio = Math.min(1, Math.max(0, shortcutM / route.totalDistanceM));
  return { stepsEstimate, kcalEstimate, coveredRatio };
}

/**
 * Calculates cycling active burn and road vs paved path split.
 */
export function computeBikeMetrics(route: ComputedRoute | null): BikeRouteMetrics {
  if (!route || route.totalDistanceM <= 0) {
    return { kcalEstimate: 0, roadRatio: 0, pavedPathRatio: 0 };
  }
  const kcalEstimate = Math.max(1, Math.round(route.totalDistanceM * 0.028));
  let roadM = 0;
  let pathM = 0;
  for (const step of route.steps) {
    if (step.kind === 'road') roadM += step.distanceM;
    else if (step.kind === 'footway' || step.kind === 'shortcut') pathM += step.distanceM;
  }
  const denom = Math.max(1, roadM + pathM);
  return {
    kcalEstimate,
    roadRatio: Math.min(1, Math.max(0, roadM / denom)),
    pavedPathRatio: Math.min(1, Math.max(0, pathM / denom)),
  };
}

/**
 * Pure helper to toggle a place key (`kind:id`) in a saved list.
 */
export function toggleSavedPlace(currentIds: string[], itemKey: string): string[] {
  if (currentIds.includes(itemKey)) {
    return currentIds.filter((id) => id !== itemKey);
  }
  return [itemKey, ...currentIds];
}

/**
 * Pure helper to push a place key (`kind:id`) to the front of recent history.
 */
export function pushRecentPlace(currentIds: string[], itemKey: string, maxItems = 8): string[] {
  const filtered = currentIds.filter((id) => id !== itemKey);
  return [itemKey, ...filtered].slice(0, maxItems);
}

export interface ParsedAtlasParams {
  placeKey: string | null;
  fromKey: string | null;
  toKey: string | null;
  stopKeys: string[];
  mode: RouteMode | null;
  routeName: string | null;
  customEncoded: string | null;
  customSnap: boolean;
}

/**
 * Parses URL search parameters for deep-linking to a campus place, standard route, or custom route.
 */
export function parseAtlasUrlParams(search: string): ParsedAtlasParams {
  const params = new URLSearchParams(search);
  const placeKey = params.get('place');
  const fromKey = params.get('from');
  const toKey = params.get('to');
  const rawStops = params.get('stops');
  const stopKeys = rawStops
    ? rawStops
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
  const rawMode = params.get('mode');
  const mode: RouteMode | null =
    rawMode === 'walk' || rawMode === 'bike' || rawMode === 'bus' || rawMode === 'drive'
      ? rawMode
      : null;
  const rawName = params.get('name')?.trim() || null;
  const customEncoded = params.get('custom')?.trim() || null;
  const snapParam = params.get('snap');
  const customSnap = snapParam !== '0';
  return {
    placeKey,
    fromKey,
    toKey,
    stopKeys,
    mode,
    routeName: rawName,
    customEncoded,
    customSnap,
  };
}

/**
 * Builds a clean shareable URL for a selected campus entity, standard route, or custom route.
 */
export function buildAtlasShareUrl(
  baseHref: string,
  opts: {
    placeKey?: string | null;
    fromKey?: string | null;
    toKey?: string | null;
    stopKeys?: string[];
    mode?: RouteMode;
    routeName?: string | null;
    customEncoded?: string | null;
    customSnap?: boolean;
  },
): string {
  const url = new URL(baseHref, 'https://um-atlas.local');
  url.search = '';
  if (opts.customEncoded) {
    url.searchParams.set('custom', opts.customEncoded);
    if (opts.mode) url.searchParams.set('mode', opts.mode);
    if (opts.customSnap === false) url.searchParams.set('snap', '0');
    if (opts.routeName?.trim()) url.searchParams.set('name', opts.routeName.trim());
  } else if (opts.fromKey && opts.toKey) {
    url.searchParams.set('from', opts.fromKey);
    if (opts.stopKeys && opts.stopKeys.length > 0) {
      url.searchParams.set('stops', opts.stopKeys.join(','));
    }
    url.searchParams.set('to', opts.toKey);
    if (opts.mode) url.searchParams.set('mode', opts.mode);
    if (opts.routeName?.trim()) url.searchParams.set('name', opts.routeName.trim());
  } else if (opts.placeKey) {
    url.searchParams.set('place', opts.placeKey);
  }
  return url.toString();
}

export type ActivePanel =
  | 'none'
  | 'inspector'
  | 'saved'
  | 'directions'
  | 'draw'
  | 'layers'
  | 'explore'
  | 'transit';

export const THEME_STORAGE_KEY = 'um-atlas-theme-v1';

/**
 * Pure mutually exclusive tab/panel transition helper.
 * Opening any tab closes the currently active tab/modal; clicking the active
 * tab again toggles it closed.
 */
export function resolvePanelToggle(
  current: ActivePanel,
  target: Exclude<ActivePanel, 'none'>,
): ActivePanel {
  return current === target ? 'none' : target;
}

/**
 * Reads persisted dark mode preference safely from Storage.
 */
export function readPersistedDarkMode(
  storage?: Pick<Storage, 'getItem'> | null,
): boolean {
  try {
    const store = storage ?? (typeof window !== 'undefined' ? window.localStorage : null);
    if (!store) return false;
    return store.getItem(THEME_STORAGE_KEY) === 'dark';
  } catch {
    return false;
  }
}

/**
 * Persists light/dark mode preference safely to Storage.
 */
export function persistDarkMode(
  darkMode: boolean,
  storage?: Pick<Storage, 'setItem'> | null,
): void {
  try {
    const store = storage ?? (typeof window !== 'undefined' ? window.localStorage : null);
    store?.setItem(THEME_STORAGE_KEY, darkMode ? 'dark' : 'light');
  } catch {
    // Ignore storage write errors in private browsing
  }
}

/**
 * Decides whether a mobile bottom sheet should snap to collapsed (`true`) or
 * expanded (`false`) after a vertical pointer drag gesture.
 */
export function resolveSheetDragOutcome(
  currentCollapsed: boolean,
  deltaY: number,
  velocityY: number,
  thresholdPx = 44,
): boolean {
  if (!currentCollapsed) {
    if (deltaY >= thresholdPx || (deltaY > 18 && velocityY >= 0.35)) {
      return true;
    }
    return false;
  }
  if (deltaY <= -thresholdPx || (deltaY < -18 && velocityY <= -0.35)) {
    return false;
  }
  return true;
}

export interface RecommendedPlace {
  id: string;
  label: string;
  category: 'jogging' | 'faculty' | 'landmark' | 'transit';
  distanceM: number | null;
  distanceLabel: string | null;
  mode: RouteMode;
  destination: SearchItem;
}

export interface RecommendationsResult {
  isNearby: boolean;
  items: RecommendedPlace[];
}

const UM_CAMPUS_CENTER: [number, number] = [101.6538, 3.1209];
const NEARBY_CAMPUS_RADIUS_M = 3000;

const SHORT_REC_LABELS: Record<string, string> = {
  LIB: 'Main Library',
  KPS: 'Perdanasiswa',
  DTC: 'DTC',
  EXAM: 'Exam Hall',
  JPPHB: 'JPPHB',
  HIR: 'HIR',
  CORE: 'Chancellery',
  MASJID: 'Masjid Ar-Rahman',
  FSKTM: 'FSKTM',
  FK: 'Engineering (FK)',
  FS: 'Science (FS)',
  FOM: 'Medicine (FOM)',
  FPE: 'Business (FPE)',
  FASS: 'Arts (FASS)',
  FLL: 'Languages (FLL)',
  FOL: 'Law (FOL)',
  FBE: 'Built Env (FBE)',
  FED: 'Education',
  FSES: 'Sports Centre',
  APM: 'Malay Studies',
  API: 'Islamic Studies',
};

export function formatCompactDistance(meters: number): string {
  if (!Number.isFinite(meters) || meters < 0) return '';
  if (meters < 1000) return `${Math.max(10, Math.round(meters / 10) * 10)} m`;
  return `${(Math.round(meters / 100) / 10).toFixed(1)} km`;
}

function closestCoordOnLine(
  coords: [number, number][],
  anchor: [number, number],
): { coord: [number, number]; distanceM: number } | null {
  if (coords.length === 0) return null;
  let best = coords[0];
  let bestDist = distMeters(anchor, best);
  for (let i = 1; i < coords.length; i += 1) {
    const d = distMeters(anchor, coords[i]);
    if (d < bestDist) {
      bestDist = d;
      best = coords[i];
    }
  }
  return { coord: best, distanceM: bestDist };
}

function conciseZoneLabel(item: SearchItem): string {
  if (SHORT_REC_LABELS[item.id]) return SHORT_REC_LABELS[item.id];
  const cleaned = item.title
    .replace(/^Faculty of\s+/i, '')
    .replace(/\s*\([^)]*\)$/, '')
    .trim();
  return cleaned.length > 20 ? item.id : cleaned;
}

/**
 * Ranks contextual recommended destinations below the search bar based on the
 * visitor's live location (nearest UM jogging loop trailhead, nearby faculties
 * and landmarks) with a curated UM campus fallback when GPS is off or far away.
 */
export function buildRecommendedPlaces(
  userCoord: [number, number] | null,
  searchItems: SearchItem[],
  joggingRoutes: GeoJSON.FeatureCollection,
  campusCenter: [number, number] = UM_CAMPUS_CENTER,
  limit = 6,
): RecommendationsResult {
  const isNearby = Boolean(userCoord && distMeters(userCoord, campusCenter) <= NEARBY_CAMPUS_RADIUS_M);
  const anchor: [number, number] = isNearby && userCoord ? userCoord : campusCenter;

  // Extract jogging loop trailhead candidates
  const jogCandidates: { rec: RecommendedPlace; dist: number }[] = [];
  for (const ft of joggingRoutes.features) {
    if (ft.geometry?.type !== 'LineString') continue;
    const coords = ft.geometry.coordinates as [number, number][];
    const hit = closestCoordOnLine(coords, anchor);
    if (!hit) continue;
    const props = (ft.properties ?? {}) as Record<string, unknown>;
    const id = String(props.id ?? 'jog-loop');
    const fullName = String(props.name ?? 'UM Jogging Loop');
    const shortName = String(props.short_name ?? fullName).replace(/\s*Loop$/i, ' Jog');
    const km = Number(props.distance_km ?? 0);
    const destItem: SearchItem = {
      id: `jog-trailhead-${id}`,
      kind: 'point',
      title: `${fullName} Trailhead`,
      subtitle: km > 0 ? `Jogging loop · ${km.toFixed(1)} km` : 'Popular UM jogging route',
      keywords: `${fullName.toLowerCase()} jog running loop trailhead`,
      center: hit.coord,
      entrance_node: -1,
    };
    jogCandidates.push({
      dist: hit.distanceM,
      rec: {
        id: `rec-${id}`,
        label: shortName,
        category: 'jogging',
        distanceM: isNearby ? Math.round(hit.distanceM) : null,
        distanceLabel: isNearby ? formatCompactDistance(hit.distanceM) : null,
        mode: 'walk',
        destination: destItem,
      },
    });
  }
  jogCandidates.sort((a, b) => a.dist - b.dist);

  const byZoneId = new Map<string, SearchItem>();
  for (const item of searchItems) {
    if (item.kind === 'faculty') byZoneId.set(item.id, item);
  }

  if (isNearby && userCoord) {
    const picked: RecommendedPlace[] = [];
    const usedIds = new Set<string>();

    // 1. Closest jogging loop trailhead
    if (jogCandidates.length > 0) {
      picked.push(jogCandidates[0].rec);
      usedIds.add(jogCandidates[0].rec.id);
    }

    // 2. Closest faculties/institutes (> 35m away so we don't suggest where user already stands)
    const nearbyFacs = searchItems
      .filter(
        (it) =>
          it.kind === 'faculty' &&
          (it.zone_kind === 'faculty' || !it.zone_kind || it.zone_kind === 'institute'),
      )
      .map((it) => ({ item: it, dist: distMeters(userCoord, it.center) }))
      .filter((x) => x.dist >= 35)
      .sort((a, b) => a.dist - b.dist);

    for (const entry of nearbyFacs.slice(0, 2)) {
      const recId = `rec-fac-${entry.item.id}`;
      if (usedIds.has(recId)) continue;
      usedIds.add(recId);
      picked.push({
        id: recId,
        label: conciseZoneLabel(entry.item),
        category: 'faculty',
        distanceM: Math.round(entry.dist),
        distanceLabel: formatCompactDistance(entry.dist),
        mode: 'walk',
        destination: entry.item,
      });
    }

    // 3. Closest iconic landmarks (Library, KPS, DTC, Exam Hall, Masjid, Chancellery)
    const landmarkIds = ['LIB', 'KPS', 'DTC', 'EXAM', 'MASJID', 'CORE'];
    const nearbyLandmarks = landmarkIds
      .map((id) => byZoneId.get(id))
      .filter((it): it is SearchItem => Boolean(it))
      .map((it) => ({ item: it, dist: distMeters(userCoord, it.center) }))
      .filter((x) => x.dist >= 35)
      .sort((a, b) => a.dist - b.dist);

    for (const entry of nearbyLandmarks.slice(0, 2)) {
      const recId = `rec-lm-${entry.item.id}`;
      if (usedIds.has(recId)) continue;
      usedIds.add(recId);
      picked.push({
        id: recId,
        label: conciseZoneLabel(entry.item),
        category: 'landmark',
        distanceM: Math.round(entry.dist),
        distanceLabel: formatCompactDistance(entry.dist),
        mode: 'walk',
        destination: entry.item,
      });
    }

    // 4. Fill remaining slot with nearest rail station or next closest faculty
    if (picked.length < limit) {
      const railStations = searchItems
        .filter((it) => it.kind === 'rail_station')
        .map((it) => ({ item: it, dist: distMeters(userCoord, it.center) }))
        .sort((a, b) => a.dist - b.dist);
      if (railStations.length > 0 && railStations[0].dist <= 2600) {
        const st = railStations[0];
        picked.push({
          id: `rec-tr-${st.item.id}`,
          label: st.item.title.replace(/\s*\([^)]*\)$/, ''),
          category: 'transit',
          distanceM: Math.round(st.dist),
          distanceLabel: formatCompactDistance(st.dist),
          mode: st.dist > 1100 ? 'bus' : 'walk',
          destination: st.item,
        });
      }
    }

    return { isNearby: true, items: picked.slice(0, limit) };
  }

  // Fallback curated campus highlights when GPS is unavailable or off-campus
  const fallback: RecommendedPlace[] = [];
  const tasikLoop =
    jogCandidates.find((j) => j.rec.id.includes('tasik')) ?? jogCandidates[0];
  if (tasikLoop) {
    fallback.push(tasikLoop.rec);
  }

  const curatedZones: { id: string; category: 'landmark' | 'faculty' }[] = [
    { id: 'LIB', category: 'landmark' },
    { id: 'KPS', category: 'landmark' },
    { id: 'EXAM', category: 'landmark' },
    { id: 'DTC', category: 'landmark' },
    { id: 'FSKTM', category: 'faculty' },
    { id: 'JPPHB', category: 'faculty' },
  ];

  for (const spec of curatedZones) {
    if (fallback.length >= limit) break;
    const found = byZoneId.get(spec.id);
    if (!found) continue;
    fallback.push({
      id: `rec-curated-${found.id}`,
      label: conciseZoneLabel(found),
      category: spec.category,
      distanceM: null,
      distanceLabel: null,
      mode: 'walk',
      destination: found,
    });
  }

  return { isNearby: false, items: fallback.slice(0, limit) };
}

/* ------------------------------------------------------------------
   Multi-Stop Route Order Optimizer (Fixed Origin & Destination)
   ------------------------------------------------------------------ */

export interface StopOptimizationResult {
  orderedStops: SearchItem[];
  originalDistanceM: number;
  optimizedDistanceM: number;
  savedDistanceM: number;
  changed: boolean;
}

/**
 * Reorders intermediate stops to minimize total distance from `origin` -> stops -> `dest`,
 * keeping `origin` fixed at start and `dest` fixed at end.
 * - Uses exact Held-Karp DP for <= 10 stops (provably optimal).
 * - Uses Nearest-Neighbor + 2-opt local refinement for 11+ stops (fast & scalable for unlimited stops).
 */
export function optimizeStopOrder(
  origin: SearchItem,
  stops: SearchItem[],
  dest: SearchItem,
  distanceFn?: (a: SearchItem, b: SearchItem) => number,
): StopOptimizationResult {
  const measure = distanceFn ?? ((a: SearchItem, b: SearchItem) => distMeters(a.center, b.center));
  const n = stops.length;

  const evalChain = (order: number[], mat: number[][], endIdx: number): number => {
    let total = 0;
    let prev = 0;
    for (let i = 0; i < order.length; i++) {
      const cur = order[i] + 1;
      total += mat[prev][cur];
      prev = cur;
    }
    total += mat[prev][endIdx];
    return total;
  };

  if (n <= 1) {
    const d =
      n === 0
        ? Math.round(measure(origin, dest))
        : Math.round(measure(origin, stops[0]) + measure(stops[0], dest));
    return {
      orderedStops: stops.slice(),
      originalDistanceM: d,
      optimizedDistanceM: d,
      savedDistanceM: 0,
      changed: false,
    };
  }

  // Build symmetric distance matrix for [origin, ...stops, dest]
  const pts: SearchItem[] = [origin, ...stops, dest];
  const m = pts.length;
  const endIdx = m - 1;
  const mat: number[][] = Array.from({ length: m }, () => new Array<number>(m).fill(0));
  for (let i = 0; i < m; i++) {
    for (let j = i + 1; j < m; j++) {
      const d = measure(pts[i], pts[j]);
      mat[i][j] = d;
      mat[j][i] = d;
    }
  }

  const origOrder = Array.from({ length: n }, (_, i) => i);
  const origDist = evalChain(origOrder, mat, endIdx);

  let bestOrder: number[];

  if (n <= 10) {
    // Exact Held-Karp DP: dp[mask * n + last] = min dist from origin visiting `mask` ending at stop `last`
    const totalMasks = 1 << n;
    const dp = new Float64Array(totalMasks * n).fill(Infinity);
    const parent = new Int8Array(totalMasks * n).fill(-1);

    for (let i = 0; i < n; i++) {
      dp[(1 << i) * n + i] = mat[0][i + 1];
    }

    for (let mask = 1; mask < totalMasks; mask++) {
      for (let last = 0; last < n; last++) {
        if (!(mask & (1 << last))) continue;
        const curCost = dp[mask * n + last];
        if (!Number.isFinite(curCost)) continue;
        for (let next = 0; next < n; next++) {
          if (mask & (1 << next)) continue;
          const nextMask = mask | (1 << next);
          const nextCost = curCost + mat[last + 1][next + 1];
          const idx = nextMask * n + next;
          if (nextCost < dp[idx]) {
            dp[idx] = nextCost;
            parent[idx] = last;
          }
        }
      }
    }

    const fullMask = totalMasks - 1;
    let bestLast = 0;
    let bestTotal = Infinity;
    for (let last = 0; last < n; last++) {
      const tot = dp[fullMask * n + last] + mat[last + 1][endIdx];
      if (tot < bestTotal) {
        bestTotal = tot;
        bestLast = last;
      }
    }

    bestOrder = new Array<number>(n);
    let mask = fullMask;
    let cur = bestLast;
    for (let pos = n - 1; pos >= 0; pos--) {
      bestOrder[pos] = cur;
      const p = parent[mask * n + cur];
      mask ^= 1 << cur;
      cur = p;
    }
  } else {
    // Scalable Nearest-Neighbor seed + 2-opt refinement for 11+ stops
    const visited = new Uint8Array(n);
    bestOrder = [];
    let currentNode = 0;
    for (let step = 0; step < n; step++) {
      let nearest = -1;
      let nearestD = Infinity;
      for (let i = 0; i < n; i++) {
        if (visited[i]) continue;
        const d = mat[currentNode][i + 1];
        if (d < nearestD) {
          nearestD = d;
          nearest = i;
        }
      }
      if (nearest === -1) break;
      visited[nearest] = 1;
      bestOrder.push(nearest);
      currentNode = nearest + 1;
    }

    // 2-opt local search (open path with fixed endpoints 0 and endIdx)
    let improved = true;
    let guard = 0;
    while (improved && guard < 200) {
      improved = false;
      guard += 1;
      for (let i = 0; i < n - 1; i++) {
        const beforeI = i === 0 ? 0 : bestOrder[i - 1] + 1;
        const nodeI = bestOrder[i] + 1;
        for (let k = i + 1; k < n; k++) {
          const nodeK = bestOrder[k] + 1;
          const afterK = k === n - 1 ? endIdx : bestOrder[k + 1] + 1;
          const oldCost = mat[beforeI][nodeI] + mat[nodeK][afterK];
          const newCost = mat[beforeI][nodeK] + mat[nodeI][afterK];
          if (newCost + 1e-6 < oldCost) {
            // Reverse segment [i..k]
            let l = i;
            let r = k;
            while (l < r) {
              const tmp = bestOrder[l];
              bestOrder[l] = bestOrder[r];
              bestOrder[r] = tmp;
              l += 1;
              r -= 1;
            }
            improved = true;
          }
        }
      }
    }
  }

  const optDist = evalChain(bestOrder, mat, endIdx);
  const isActuallyShorter = optDist + 1 < origDist;
  const finalOrder = isActuallyShorter ? bestOrder : origOrder;
  const orderChanged = finalOrder.some((idx, pos) => idx !== pos);
  const originalDistanceM = Math.round(origDist);
  const optimizedDistanceM = Math.round(isActuallyShorter ? optDist : origDist);

  return {
    orderedStops: finalOrder.map((idx) => stops[idx]),
    originalDistanceM,
    optimizedDistanceM,
    savedDistanceM: Math.max(0, originalDistanceM - optimizedDistanceM),
    changed: orderChanged && isActuallyShorter,
  };
}

/* ------------------------------------------------------------------
   Campus Zone Point-in-Polygon Spatial Index & Transition Detector
   ------------------------------------------------------------------ */

export interface ZoneSpatialEntry {
  zone: FacultyProps;
  bbox: [number, number, number, number];
  bboxArea: number;
  polygons: [number, number][][][];
}

function pointInRing(pt: [number, number], ring: [number, number][]): boolean {
  const [x, y] = pt;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersects = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-15) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function pointInPolygonRings(pt: [number, number], rings: [number, number][][]): boolean {
  if (rings.length === 0 || !pointInRing(pt, rings[0])) return false;
  for (let h = 1; h < rings.length; h++) {
    if (pointInRing(pt, rings[h])) return false;
  }
  return true;
}

/**
 * Builds a fast bounding-box-indexed lookup table for all UM campus zones
 * (faculties, colleges, research institutes, medical centres, and landmarks).
 * Sorted by smallest bbox area first so nested standalone landmarks take priority.
 */
export function buildZoneSpatialIndex(facultiesGeo: GeoJSON.FeatureCollection): ZoneSpatialEntry[] {
  const entries: ZoneSpatialEntry[] = [];

  for (const ft of facultiesGeo.features) {
    if (!ft.geometry || !ft.properties) continue;
    let polygons: [number, number][][][] = [];
    if (ft.geometry.type === 'Polygon') {
      polygons = [ft.geometry.coordinates as [number, number][][]];
    } else if (ft.geometry.type === 'MultiPolygon') {
      polygons = ft.geometry.coordinates as [number, number][][][];
    } else {
      continue;
    }

    let minLng = Infinity;
    let minLat = Infinity;
    let maxLng = -Infinity;
    let maxLat = -Infinity;
    for (const poly of polygons) {
      for (const ring of poly) {
        for (const [lng, lat] of ring) {
          if (lng < minLng) minLng = lng;
          if (lat < minLat) minLat = lat;
          if (lng > maxLng) maxLng = lng;
          if (lat > maxLat) maxLat = lat;
        }
      }
    }
    if (!Number.isFinite(minLng)) continue;
    const bboxArea = Math.max(0, (maxLng - minLng) * (maxLat - minLat));
    entries.push({
      zone: ft.properties as FacultyProps,
      bbox: [minLng, minLat, maxLng, maxLat],
      bboxArea,
      polygons,
    });
  }

  entries.sort((a, b) => a.bboxArea - b.bboxArea);
  return entries;
}

/**
 * Returns the campus zone containing `coord`, or `null` when in an unzoned corridor/road.
 */
export function findZoneAtCoord(
  coord: [number, number] | null,
  index: ZoneSpatialEntry[],
): FacultyProps | null {
  if (!coord || index.length === 0) return null;
  const [lng, lat] = coord;
  for (const entry of index) {
    const [minLng, minLat, maxLng, maxLat] = entry.bbox;
    if (lng < minLng || lng > maxLng || lat < minLat || lat > maxLat) continue;
    for (const rings of entry.polygons) {
      if (pointInPolygonRings(coord, rings)) {
        return entry.zone;
      }
    }
  }
  return null;
}

/**
 * Classifies a zone crossing between two consecutive navigation positions.
 */
export function resolveZoneTransition(
  prevZone: FacultyProps | null,
  nextZone: FacultyProps | null,
): { type: 'enter' | 'leave' | 'cross'; leavingZone: FacultyProps | null; enteringZone: FacultyProps | null } | null {
  const prevId = prevZone?.id ?? null;
  const nextId = nextZone?.id ?? null;
  if (prevId === nextId) return null;
  if (!prevZone && nextZone) {
    return { type: 'enter', leavingZone: null, enteringZone: nextZone };
  }
  if (prevZone && !nextZone) {
    return { type: 'leave', leavingZone: prevZone, enteringZone: null };
  }
  return { type: 'cross', leavingZone: prevZone, enteringZone: nextZone };
}



