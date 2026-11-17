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
