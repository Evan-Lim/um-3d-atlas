import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAtlasShareUrl,
  computeWalkMetrics,
  findNearbyStops,
  parseAtlasUrlParams,
  persistDarkMode,
  pushRecentPlace,
  readPersistedDarkMode,
  resolvePanelToggle,
  resolveSheetDragOutcome,
  THEME_STORAGE_KEY,
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

test('resolvePanelToggle guarantees mutually exclusive active panels and clean toggle-off', () => {
  assert.equal(resolvePanelToggle('none', 'layers'), 'layers');
  assert.equal(resolvePanelToggle('layers', 'transit'), 'transit');
  assert.equal(resolvePanelToggle('transit', 'saved'), 'saved');
  assert.equal(resolvePanelToggle('saved', 'directions'), 'directions');
  assert.equal(resolvePanelToggle('directions', 'directions'), 'none');
  assert.equal(resolvePanelToggle('inspector', 'layers'), 'layers');
});

test('readPersistedDarkMode and persistDarkMode reliably persist light and dark themes', () => {
  const mem = new Map<string, string>();
  const mockStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => {
      mem.set(k, v);
    },
  };
  assert.equal(readPersistedDarkMode(mockStorage), false);
  persistDarkMode(true, mockStorage);
  assert.equal(mem.get(THEME_STORAGE_KEY), 'dark');
  assert.equal(readPersistedDarkMode(mockStorage), true);
  persistDarkMode(false, mockStorage);
  assert.equal(mem.get(THEME_STORAGE_KEY), 'light');
  assert.equal(readPersistedDarkMode(mockStorage), false);
});

test('resolveSheetDragOutcome handles drag-down collapse, flick velocity, and drag-up expand', () => {
  // Expanded -> dragged down past threshold collapses
  assert.equal(resolveSheetDragOutcome(false, 60, 0.2), true);
  // Expanded -> fast flick down collapses
  assert.equal(resolveSheetDragOutcome(false, 24, 0.5), true);
  // Expanded -> small accidental nudge stays expanded
  assert.equal(resolveSheetDragOutcome(false, 12, 0.1), false);
  // Collapsed -> dragged up past threshold expands
  assert.equal(resolveSheetDragOutcome(true, -55, -0.2), false);
  // Collapsed -> fast flick up expands
  assert.equal(resolveSheetDragOutcome(true, -22, -0.45), false);
  // Collapsed -> dragging further down stays collapsed
  assert.equal(resolveSheetDragOutcome(true, 30, 0.2), true);
});

test('buildRecommendedPlaces ranks nearby jogging loop, faculties, and landmarks when GPS is on campus', async () => {
  const { buildRecommendedPlaces, formatCompactDistance } = await import('./atlasUtils');
  assert.equal(formatCompactDistance(324), '320 m');
  assert.equal(formatCompactDistance(1450), '1.5 km');

  const items = [
    { id: 'LIB', kind: 'faculty' as const, zone_kind: 'landmark' as const, title: 'Perpustakaan Utama (Main Library)', subtitle: 'LIB', keywords: 'lib', center: [101.6540, 3.1203] as [number, number], entrance_node: 1 },
    { id: 'KPS', kind: 'faculty' as const, zone_kind: 'landmark' as const, title: 'Kompleks Perdanasiswa (KPS)', subtitle: 'KPS', keywords: 'kps', center: [101.6557, 3.1207] as [number, number], entrance_node: 2 },
    { id: 'FSKTM', kind: 'faculty' as const, zone_kind: 'faculty' as const, title: 'Faculty of Computer Science', subtitle: 'FSKTM', keywords: 'fsktm', center: [101.6506, 3.1282] as [number, number], entrance_node: 3 },
    { id: 'FK', kind: 'faculty' as const, zone_kind: 'faculty' as const, title: 'Faculty of Engineering', subtitle: 'FK', keywords: 'fk', center: [101.6550, 3.1180] as [number, number], entrance_node: 4 },
    { id: 'EXAM', kind: 'faculty' as const, zone_kind: 'landmark' as const, title: 'Examination Hall', subtitle: 'EXAM', keywords: 'exam', center: [101.6589, 3.1151] as [number, number], entrance_node: 5 },
  ];
  const jogging: GeoJSON.FeatureCollection = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { id: 'jog-tasik-varsiti', name: 'Tasik Varsiti Lake Loop', short_name: 'Tasik Varsiti Loop', distance_km: 1.15 },
        geometry: { type: 'LineString', coordinates: [[101.6562, 3.1197], [101.6578, 3.1199], [101.6556, 3.1191]] },
      },
      {
        type: 'Feature',
        properties: { id: 'jog-arena-sports', name: 'UM Arena Loop', short_name: 'UM Arena Loop', distance_km: 2.1 },
        geometry: { type: 'LineString', coordinates: [[101.6591, 3.1310], [101.6601, 3.1286]] },
      },
    ],
  };

  // User near FK / Tasik Varsiti
  const near = buildRecommendedPlaces([101.6552, 3.1190], items, jogging);
  assert.equal(near.isNearby, true);
  assert.equal(near.items[0].category, 'jogging');
  assert.equal(near.items[0].label, 'Tasik Varsiti Jog');
  assert.ok(near.items[0].distanceLabel && near.items[0].distanceLabel.endsWith('m'));
  assert.ok(near.items.some((i) => i.destination.id === 'FK'));
  assert.ok(near.items.some((i) => i.destination.id === 'LIB'));

  // Off-campus / no GPS fallback
  const fallback = buildRecommendedPlaces(null, items, jogging);
  assert.equal(fallback.isNearby, false);
  assert.equal(fallback.items[0].category, 'jogging');
  assert.equal(fallback.items[0].distanceLabel, null);
  assert.ok(fallback.items.some((i) => i.destination.id === 'LIB'));
  assert.ok(fallback.items.some((i) => i.destination.id === 'EXAM'));
});


