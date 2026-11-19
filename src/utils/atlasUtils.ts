import { CampusRouter, distMeters } from '../routing/pathfinder';
import type { ComputedRoute, RouteMode, SearchItem, TransitRoute } from '../types/map';

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
  bus: ComputedRoute | null;
  drive: ComputedRoute | null;
}

export interface WalkHealthMetrics {
  stepsEstimate: number;
  kcalEstimate: number;
  coveredRatio: number;
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
 * Computes routes across all 3 travel modes (walk, bus, drive) for instant M3 tab comparison.
 */
export function compareAllModes(
  router: CampusRouter | null,
  origin: SearchItem | null,
  dest: SearchItem | null,
  stepFree: boolean,
): ModeComparison {
  if (!router || !origin || !dest) {
    return { walk: null, bus: null, drive: null };
  }
  if (origin.id === dest.id && origin.kind === dest.kind) {
    return { walk: null, bus: null, drive: null };
  }
  return {
    walk: router.computeRoute(origin, dest, 'walk', { stepFree }),
    bus: router.computeRoute(origin, dest, 'bus', { stepFree }),
    drive: router.computeRoute(origin, dest, 'drive', { stepFree: false }),
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
  mode: RouteMode | null;
}

/**
 * Parses URL search parameters for deep-linking to a campus place or route.
 */
export function parseAtlasUrlParams(search: string): ParsedAtlasParams {
  const params = new URLSearchParams(search);
  const placeKey = params.get('place');
  const fromKey = params.get('from');
  const toKey = params.get('to');
  const rawMode = params.get('mode');
  const mode: RouteMode | null =
    rawMode === 'walk' || rawMode === 'bus' || rawMode === 'drive' ? rawMode : null;
  return { placeKey, fromKey, toKey, mode };
}

/**
 * Builds a clean shareable URL for a selected campus entity or route.
 */
export function buildAtlasShareUrl(
  baseHref: string,
  opts: {
    placeKey?: string | null;
    fromKey?: string | null;
    toKey?: string | null;
    mode?: RouteMode;
  },
): string {
  const url = new URL(baseHref, 'https://um-atlas.local');
  url.search = '';
  if (opts.fromKey && opts.toKey) {
    url.searchParams.set('from', opts.fromKey);
    url.searchParams.set('to', opts.toKey);
    if (opts.mode) url.searchParams.set('mode', opts.mode);
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


