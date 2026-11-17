import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAtlasShareUrl,
  computeWalkMetrics,
  findNearbyStops,
  parseAtlasUrlParams,
  pushRecentPlace,
  toggleSavedPlace,
} from './atlasUtils';
import type { ComputedRoute, TransitRoute } from '../types/map';

const SAMPLE_ROUTES: TransitRoute[] = [
  {
    id: 'UM-AB',
    code: 'AB',
    name: 'UM Shuttle AB',
    operator: 'UM Shuttle',
    color: '#1d4ed8',
    headway_min: 15,
    hours: '07:30-18:30',
    stops: [
      { name: 'UM Central', ref: 'UM01', coord: [101.6536, 3.1211], walk_node: 1 },
      { name: 'FSKTM Stop', ref: 'KL2346', coord: [101.6503, 3.1277], walk_node: 2 },
    ],
    leg_distances_m: [600],
  },
  {
    id: 'T815',
    code: 'T815',
    name: 'RapidKL T815',
    operator: 'RapidKL',
    color: '#ea580c',
    headway_min: 15,
    hours: '06:00-23:30',
    stops: [
      { name: 'UM Central', ref: 'UM01', coord: [101.6536, 3.1211], walk_node: 1 },
    ],
    leg_distances_m: [],
  },
];

test('findNearbyStops aggregates multiple routes at the same stop and sorts by distance', () => {
  const nearby = findNearbyStops([101.6537, 3.1212], SAMPLE_ROUTES, 1200);
  assert.equal(nearby.length, 2);
  assert.equal(nearby[0].name, 'UM Central');
  assert.equal(nearby[0].routes.length, 2);
  assert.deepEqual(
    nearby[0].routes.map((r) => r.code),
    ['AB', 'T815'],
  );
});

test('computeWalkMetrics calculates steps, kcal, and covered shortcut ratio accurately', () => {
  const mockRoute: ComputedRoute = {
    mode: 'walk',
    stepFreeUsed: false,
    coordinates: [
      [101.65, 3.12],
      [101.655, 3.125],
    ],
    segments: [],
    totalDistanceM: 1000,
    estimatedMinutes: 12,
    shortcutCount: 2,
    stepsCount: 0,
    busRoutesUsed: [],
    steps: [
      { instruction: 'Walk on path', detail: 'Footpath', distanceM: 600, kind: 'footway', coord: [101.65, 3.12] },
      { instruction: 'Use shortcut', detail: 'Covered', distanceM: 400, kind: 'shortcut', coord: [101.652, 3.122] },
    ],
    originLabel: 'A',
    destLabel: 'B',
  };

  const metrics = computeWalkMetrics(mockRoute);
  assert.equal(metrics.stepsEstimate, 1310);
  assert.equal(metrics.kcalEstimate, 48);
  assert.equal(metrics.coveredRatio, 0.4);
});

test('toggleSavedPlace and pushRecentPlace maintain clean immutable lists', () => {
  let saved: string[] = [];
  saved = toggleSavedPlace(saved, 'faculty:FSKTM');
  assert.deepEqual(saved, ['faculty:FSKTM']);
  saved = toggleSavedPlace(saved, 'building:B1');
  assert.deepEqual(saved, ['building:B1', 'faculty:FSKTM']);
  saved = toggleSavedPlace(saved, 'faculty:FSKTM');
  assert.deepEqual(saved, ['building:B1']);

  let recent: string[] = ['faculty:FSKTM', 'building:B1'];
  recent = pushRecentPlace(recent, 'building:B1');
  assert.deepEqual(recent, ['building:B1', 'faculty:FSKTM']);
});

test('parseAtlasUrlParams and buildAtlasShareUrl round-trip deep links', () => {
  const sharePlace = buildAtlasShareUrl('https://example.com/', { placeKey: 'faculty:FSKTM' });
  const parsedPlace = parseAtlasUrlParams(new URL(sharePlace).search);
  assert.equal(parsedPlace.placeKey, 'faculty:FSKTM');

  const shareRoute = buildAtlasShareUrl('https://example.com/', {
    fromKey: 'gate:gate-main',
    toKey: 'faculty:FSKTM',
    mode: 'bus',
  });
  const parsedRoute = parseAtlasUrlParams(new URL(shareRoute).search);
  assert.equal(parsedRoute.fromKey, 'gate:gate-main');
  assert.equal(parsedRoute.toKey, 'faculty:FSKTM');
  assert.equal(parsedRoute.mode, 'bus');
});
