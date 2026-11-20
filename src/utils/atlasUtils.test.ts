import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAtlasShareUrl,
  buildZoneSpatialIndex,
  computeBikeMetrics,
  computeWalkMetrics,
  findNearbyStops,
  findZoneAtCoord,
  optimizeStopOrder,
  parseAtlasUrlParams,
  persistDarkMode,
  pushRecentPlace,
  readPersistedDarkMode,
  resolvePanelToggle,
  resolveSheetDragOutcome,
  resolveZoneTransition,
  THEME_STORAGE_KEY,
  toggleSavedPlace,
} from './atlasUtils';
import { CampusRouter } from '../routing/pathfinder';
import {
  computeRemainingElevation,
  computeRouteElevationProfile,
  sampleElevation,
} from './elevationUtils';
import {
  buildDiurnalFallbackWeather,
  classifyHeatLevel,
  computeEffectiveHeatIndexC,
  parseOpenMeteoForecast,
  predictPrecipitation,
} from './weatherUtils';
import {
  computeCustomRoute,
  decodeCustomAnchors,
  encodeCustomAnchors,
  extractTurnArrows,
  filterRemainingStops,
  findInsertLegIndex,
  formatGpsCoords,
  isCoordAtUserLocation,
  isOriginAtUserLocation,
  projectPointOntoPolyline,
  slugifyRouteFilename,
} from './routeTools';
import type {
  ComputedRoute,
  CustomRouteAnchor,
  ElevationGridData,
  FacultyProps,
  GraphData,
  SearchItem,
  TransitRoute,
  UserLocation,
} from '../types/map';

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

function makePoint(id: string, lon: number, lat: number, entranceNode = -1): SearchItem {
  return {
    id,
    kind: 'building',
    title: id,
    subtitle: 'UM Campus',
    keywords: id.toLowerCase(),
    center: [lon, lat],
    entrance_node: entranceNode,
  };
}

test('parseAtlasUrlParams and buildAtlasShareUrl round-trip bike mode and multi-stop params', () => {
  const shareUrl = buildAtlasShareUrl('https://example.com/', {
    fromKey: 'gate:gate-main',
    stopKeys: ['faculty:LIB', 'faculty:FSKTM', 'faculty:EXAM'],
    toKey: 'faculty:FK',
    mode: 'bike',
  });
  const parsed = parseAtlasUrlParams(new URL(shareUrl).search);
  assert.equal(parsed.fromKey, 'gate:gate-main');
  assert.deepEqual(parsed.stopKeys, ['faculty:LIB', 'faculty:FSKTM', 'faculty:EXAM']);
  assert.equal(parsed.toKey, 'faculty:FK');
  assert.equal(parsed.mode, 'bike');
});

test('optimizeStopOrder finds exact shortest order for <=10 stops and improves 12+ stops with 2-opt', () => {
  // Points along a line from west (0) to east (5)
  const origin = makePoint('A', 101.650, 3.120);
  const s1 = makePoint('S1', 101.651, 3.120);
  const s2 = makePoint('S2', 101.652, 3.120);
  const s3 = makePoint('S3', 101.653, 3.120);
  const s4 = makePoint('S4', 101.654, 3.120);
  const dest = makePoint('B', 101.655, 3.120);

  // Scrambled order: S4 -> S1 -> S3 -> S2
  const res = optimizeStopOrder(origin, [s4, s1, s3, s2], dest);
  assert.equal(res.changed, true);
  assert.ok(res.savedDistanceM > 300);
  assert.deepEqual(
    res.orderedStops.map((s) => s.id),
    ['S1', 'S2', 'S3', 'S4'],
  );

  // Already optimal
  const already = optimizeStopOrder(origin, [s1, s2, s3, s4], dest);
  assert.equal(already.changed, false);
  assert.equal(already.savedDistanceM, 0);

  // 12 stops in scrambled zigzag order (exercises NN + 2-opt path)
  const manyDest = makePoint('END', 101.663, 3.120);
  const orderedMany = Array.from({ length: 12 }, (_, i) =>
    makePoint(`M${i + 1}`, 101.650 + (i + 1) * 0.001, 3.120),
  );
  const scrambledMany = [
    orderedMany[11],
    orderedMany[0],
    orderedMany[9],
    orderedMany[2],
    orderedMany[7],
    orderedMany[4],
    orderedMany[10],
    orderedMany[1],
    orderedMany[8],
    orderedMany[3],
    orderedMany[6],
    orderedMany[5],
  ];
  const bigRes = optimizeStopOrder(origin, scrambledMany, manyDest);
  assert.equal(bigRes.changed, true);
  assert.ok(bigRes.savedDistanceM > 2000);
  assert.equal(bigRes.orderedStops.length, 12);
});

test('buildZoneSpatialIndex, findZoneAtCoord, and resolveZoneTransition detect nested zones & crossings', () => {
  const makeFacProps = (id: string, code: string, name: string): FacultyProps => ({
    id,
    code,
    zone_kind: 'faculty',
    name,
    name_ms: name,
    category: 'Faculty',
    color: '#e8f0fe',
    website: '',
    center: [101.652, 3.122],
    zoom: 17,
    pitch: 50,
    bearing: 0,
    description: '',
    osm_ref: '',
  });

  const geo: GeoJSON.FeatureCollection = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: makeFacProps('OUTER', 'OUTER', 'Outer Precinct'),
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [101.650, 3.120],
              [101.656, 3.120],
              [101.656, 3.126],
              [101.650, 3.126],
              [101.650, 3.120],
            ],
          ],
        },
      },
      {
        type: 'Feature',
        properties: { ...makeFacProps('LIB', 'LIB', 'Main Library'), zone_kind: 'landmark' },
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [101.652, 3.122],
              [101.654, 3.122],
              [101.654, 3.124],
              [101.652, 3.124],
              [101.652, 3.122],
            ],
          ],
        },
      },
      {
        type: 'Feature',
        properties: makeFacProps('FSKTM', 'FSKTM', 'Computer Science'),
        geometry: {
          type: 'MultiPolygon',
          coordinates: [
            [
              [
                [101.658, 3.120],
                [101.660, 3.120],
                [101.660, 3.122],
                [101.658, 3.122],
                [101.658, 3.120],
              ],
            ],
          ],
        },
      },
    ],
  };

  const idx = buildZoneSpatialIndex(geo);
  // Smaller nested LIB polygon takes priority over OUTER
  const insideLib = findZoneAtCoord([101.653, 3.123], idx);
  assert.equal(insideLib?.id, 'LIB');

  // Outside LIB but inside OUTER
  const insideOuter = findZoneAtCoord([101.651, 3.121], idx);
  assert.equal(insideOuter?.id, 'OUTER');

  // Inside MultiPolygon FSKTM
  const insideFsktm = findZoneAtCoord([101.659, 3.121], idx);
  assert.equal(insideFsktm?.id, 'FSKTM');

  // Outside all zones (corridor)
  const corridor = findZoneAtCoord([101.657, 3.121], idx);
  assert.equal(corridor, null);

  assert.equal(resolveZoneTransition(null, null), null);
  assert.equal(resolveZoneTransition(insideLib, insideLib), null);
  assert.equal(resolveZoneTransition(null, insideLib)?.type, 'enter');
  assert.equal(resolveZoneTransition(insideLib, null)?.type, 'leave');
  assert.equal(resolveZoneTransition(insideOuter, insideLib)?.type, 'cross');
});

test('CampusRouter bicycle mode avoids stairs and multi-stop chains numbered waypoints', () => {
  // Mini graph:
  // 0 (Start) --[steps, 50m]--> 1 (Mid) --[road, 120m]--> 3 (End)
  // 0 (Start) --[road, 100m]--> 2 (Detour) --[footway, 90m]--> 1 (Mid)
  const miniGraph: GraphData = {
    nodes: [
      [101.650, 3.120], // 0
      [101.651, 3.120], // 1
      [101.6505, 3.1208], // 2
      [101.652, 3.120], // 3
    ],
    edges: [
      [0, 1, 50, 3, 0, 'Short Stairway'],
      [0, 2, 100, 0, 3, 'Lingkungan Budi'],
      [2, 1, 90, 1, 2, 'Paved Bike Path'],
      [1, 3, 120, 0, 3, 'Jalan Universiti'],
    ],
  };

  const router = new CampusRouter(miniGraph);
  const start = makePoint('Start', 101.650, 3.120, 0);
  const mid = makePoint('Mid Stop', 101.651, 3.120, 1);
  const end = makePoint('End', 101.652, 3.120, 3);

  // Walk (normal) can take the shorter stairs
  const walkRoute = router.computeRoute(start, mid, 'walk', { stepFree: false });
  assert.ok(walkRoute);
  assert.equal(walkRoute.stepsCount, 1);

  // Bike strictly avoids stairs and routes via road + paved path
  const bikeRoute = router.computeRoute(start, mid, 'bike');
  assert.ok(bikeRoute);
  assert.equal(bikeRoute.mode, 'bike');
  assert.equal(bikeRoute.stepsCount, 0);
  assert.equal(bikeRoute.totalDistanceM, 190);
  const bikeStats = computeBikeMetrics(bikeRoute);
  assert.ok(bikeStats.kcalEstimate > 0);
  assert.ok(bikeStats.roadRatio > 0.4);

  // Multi-stop chaining: Start -> Mid Stop -> End
  const multi = router.computeMultiStopRoute(start, [mid], end, 'bike');
  assert.ok(multi);
  assert.equal(multi.waypoints?.length, 1);
  assert.equal(multi.waypoints?.[0].index, 1);
  assert.equal(multi.waypoints?.[0].label, 'Mid Stop');
  assert.ok(multi.steps.some((s) => s.kind === 'waypoint' && s.waypointIndex === 1));
  assert.equal(multi.totalDistanceM, 310);
});

test('sampleElevation performs accurate bilinear interpolation and rejects out-of-bounds coords', () => {
  const grid: ElevationGridData = {
    source: 'test',
    units: 'decimeters_asl',
    scale: 10,
    minLon: 101.650,
    maxLon: 101.660,
    minLat: 3.110,
    maxLat: 3.120,
    cols: 2,
    rows: 2,
    minM: 40,
    maxM: 80,
    // row 0 (lat 3.110): [40.0m, 60.0m], row 1 (lat 3.120): [60.0m, 80.0m]
    values: [400, 600, 600, 800],
  };

  assert.equal(sampleElevation([101.650, 3.110], grid), 40);
  assert.equal(sampleElevation([101.660, 3.120], grid), 80);
  assert.equal(sampleElevation([101.655, 3.115], grid), 60);
  assert.equal(sampleElevation([101.640, 3.115], grid), null);
  assert.equal(sampleElevation([101.655, 3.130], grid), null);
});

test('computeRouteElevationProfile calculates ascent/descent, steep-hill step tags, and remaining climb', () => {
  // 3x2 grid going west -> east: 40m -> 70m (steep uphill) -> 45m (steep downhill)
  const grid: ElevationGridData = {
    source: 'test-hill',
    units: 'decimeters_asl',
    scale: 10,
    minLon: 101.650,
    maxLon: 101.656,
    minLat: 3.118,
    maxLat: 3.122,
    cols: 3,
    rows: 2,
    minM: 40,
    maxM: 70,
    values: [400, 700, 450, 400, 700, 450],
  };

  const mockRoute: ComputedRoute = {
    mode: 'walk',
    stepFreeUsed: false,
    coordinates: [
      [101.650, 3.120],
      [101.653, 3.120],
      [101.656, 3.120],
    ],
    segments: [],
    totalDistanceM: 666,
    estimatedMinutes: 8,
    shortcutCount: 0,
    stepsCount: 0,
    busRoutesUsed: [],
    steps: [
      {
        instruction: 'Climb Bukit Cinta path',
        detail: 'Campus road',
        distanceM: 333,
        kind: 'road',
        coord: [101.650, 3.120],
      },
      {
        instruction: 'Waypoint 1',
        detail: 'Peak',
        distanceM: 0,
        kind: 'waypoint',
        waypointIndex: 1,
        coord: [101.653, 3.120],
      },
      {
        instruction: 'Descend toward Tasik Varsiti',
        detail: 'Footpath',
        distanceM: 333,
        kind: 'footway',
        coord: [101.653, 3.120],
      },
    ],
    waypoints: [{ index: 1, label: 'Hilltop', coord: [101.653, 3.120] }],
    originLabel: 'Start',
    destLabel: 'End',
  };

  const profile = computeRouteElevationProfile(mockRoute, grid);
  assert.ok(profile);
  assert.ok(profile.totalGainM >= 25 && profile.totalGainM <= 32);
  assert.ok(profile.totalDropM >= 20 && profile.totalDropM <= 27);
  assert.equal(profile.steepClimbCount, 1);
  assert.equal(profile.steepDescentCount, 1);
  assert.equal(profile.stepElevations[0]?.hillTag, 'steep-climb');
  assert.equal(profile.stepElevations[1], null); // waypoint skipped
  assert.equal(profile.stepElevations[2]?.hillTag, 'steep-descent');
  assert.equal(profile.waypointOffsets.length, 1);

  // Midway at crest: almost no climb left, ~25m descent left
  const remCrest = computeRemainingElevation(profile, 333);
  assert.ok(remCrest);
  assert.ok(remCrest.remainingGainM <= 2);
  assert.ok(remCrest.remainingDropM >= 20);
});

test('weather comfort predictor classifies heat severity, rain likelihood, Open-Meteo parsing, and KL diurnal fallback', () => {
  assert.equal(classifyHeatLevel(25.5).level, 'cool');
  assert.equal(classifyHeatLevel(29.0).level, 'warm');
  assert.equal(classifyHeatLevel(33.2).level, 'hot');
  assert.equal(classifyHeatLevel(36.5).level, 'very-hot');
  assert.equal(classifyHeatLevel(39.0).level, 'extreme');

  // Peak midday sun raises effective thermal load compared to cloudy night
  const middaySun = computeEffectiveHeatIndexC({
    apparentTempC: 34.0,
    uvIndex: 9,
    cloudCoverPct: 15,
    hour24: 13,
    precipitationMm: 0,
  });
  const nightClear = computeEffectiveHeatIndexC({
    apparentTempC: 34.0,
    uvIndex: 0,
    cloudCoverPct: 15,
    hour24: 22,
    precipitationMm: 0,
  });
  assert.ok(middaySun > nightClear + 1.0);

  // Active rainfall overrides to 'raining'
  const activeRain = predictPrecipitation({
    precipitationMm: 2.4,
    weatherCode: 63,
    hourlyPopWindow: [40, 50],
    humidityPct: 88,
    cloudCoverPct: 95,
    hour24: 16,
  });
  assert.equal(activeRain.level, 'raining');
  assert.ok(activeRain.chancePct >= 85);

  // Parse live Open-Meteo payload
  const parsed = parseOpenMeteoForecast(
    {
      current: {
        time: '2026-11-20T15:00',
        temperature_2m: 32.4,
        apparent_temperature: 36.1,
        relative_humidity_2m: 74,
        is_day: 1,
        precipitation: 0,
        rain: 0,
        weather_code: 2,
        cloud_cover: 60,
        wind_speed_10m: 8,
      },
      hourly: {
        time: [
          '2026-11-20T15:00',
          '2026-11-20T16:00',
          '2026-11-20T17:00',
          '2026-11-20T18:00',
        ],
        temperature_2m: [32.4, 31.8, 30.2, 29.0],
        apparent_temperature: [36.1, 35.0, 33.4, 32.1],
        precipitation_probability: [45, 75, 65, 30],
        precipitation: [0, 1.2, 0.5, 0],
        uv_index: [8.2, 6.0, 3.1, 0.8],
        weather_code: [2, 80, 61, 3],
      },
    },
    new Date('2026-11-20T07:15:00Z'), // 15:15 MYT
  );
  assert.ok(parsed);
  assert.equal(parsed.source, 'live');
  assert.equal(parsed.localHour24, 15);
  assert.ok(parsed.heatLevel === 'very-hot' || parsed.heatLevel === 'hot');
  assert.ok(parsed.rainChancePct >= 65);
  assert.equal(parsed.hourlyOutlook.length, 4);

  // KL diurnal offline fallback adapts cleanly between dawn (06:00 MYT) and afternoon (15:00 MYT)
  const dawnEst = buildDiurnalFallbackWeather(new Date('2026-11-19T22:00:00Z')); // 06:00 MYT
  const afternoonEst = buildDiurnalFallbackWeather(new Date('2026-11-20T07:00:00Z')); // 15:00 MYT
  assert.equal(dawnEst.source, 'estimate');
  assert.ok(afternoonEst.feelsLikeC > dawnEst.feelsLikeC + 3);
  assert.ok(afternoonEst.rainChancePct > dawnEst.rainChancePct);
});

test('Start gating, GPS formatting, polyline projection, and adaptive stop filtering behave accurately', () => {
  const loc: UserLocation = {
    coord: [101.65384, 3.12092],
    accuracy: 8,
    timestamp: Date.now(),
  };

  assert.equal(formatGpsCoords(loc.coord), '3.12092°N, 101.65384°E');
  assert.equal(formatGpsCoords(null), '');

  const myLocOrigin: SearchItem = {
    id: 'user-location',
    kind: 'point',
    title: 'Current location',
    subtitle: 'Device GPS',
    keywords: 'gps',
    center: loc.coord,
    entrance_node: -1,
  };
  const farOrigin = makePoint('FSKTM', 101.6506, 3.1282);
  const nearOrigin = makePoint('Nearby Gate', 101.6539, 3.12095);

  assert.equal(isOriginAtUserLocation(myLocOrigin, loc), true);
  assert.equal(isOriginAtUserLocation(nearOrigin, loc), true);
  assert.equal(isOriginAtUserLocation(farOrigin, loc), false);
  assert.equal(isOriginAtUserLocation(farOrigin, null), false);
  assert.equal(isCoordAtUserLocation(nearOrigin.center, loc), true);
  assert.equal(isCoordAtUserLocation(farOrigin.center, loc), false);

  // Polyline projection (straight line east along lat 3.120)
  const poly: [number, number][] = [
    [101.650, 3.120],
    [101.652, 3.120],
  ];
  const onLine = projectPointOntoPolyline([101.651, 3.120], poly);
  assert.ok(onLine.distanceM < 1);
  assert.ok(onLine.alongM > 100 && onLine.alongM < 120);

  // ~55m north of line -> triggers off-route detection (>24m / >32m)
  const offLine = projectPointOntoPolyline([101.651, 3.1205], poly);
  assert.ok(offLine.distanceM > 45 && offLine.distanceM < 65);

  // Adaptive remaining stop filtering marks stops within 28m as passed
  const stop1 = makePoint('S1', 101.651, 3.120);
  const stop2 = makePoint('S2', 101.653, 3.120);
  const passed = new Set<string>();
  const f1 = filterRemainingStops([stop1, stop2], passed, [101.65105, 3.12002], 28);
  assert.deepEqual(f1.newlyPassedIds, ['building:S1']);
  assert.deepEqual(
    f1.remaining.map((s) => s.id),
    ['S2'],
  );
});

test('extractTurnArrows detects sharp road bends and flags the upcoming navigation turn', () => {
  // L-shaped route: east 110m then north 110m (90° left turn at [101.651, 3.120])
  const route: ComputedRoute = {
    mode: 'walk',
    stepFreeUsed: false,
    coordinates: [
      [101.650, 3.120],
      [101.651, 3.120],
      [101.651, 3.121],
    ],
    segments: [],
    totalDistanceM: 220,
    estimatedMinutes: 3,
    shortcutCount: 0,
    stepsCount: 0,
    busRoutesUsed: [],
    steps: [
      { instruction: 'Head east', detail: 'Road', distanceM: 110, kind: 'road', coord: [101.650, 3.120] },
      { instruction: 'Turn left north', detail: 'Road', distanceM: 110, kind: 'road', coord: [101.651, 3.120] },
    ],
    originLabel: 'A',
    destLabel: 'B',
  };

  const arrows = extractTurnArrows(route, 0);
  assert.equal(arrows.count, 1);
  assert.equal(arrows.lines.features.length, 1);
  assert.equal(arrows.heads.features.length, 1);
  assert.equal((arrows.heads.features[0].properties as Record<string, unknown>).turnDir, 'left');
  assert.equal((arrows.heads.features[0].properties as Record<string, unknown>).isNext, 1);
});

test('Custom route computation, drag-to-snap leg insertion, and named/custom share URL round-trip', () => {
  const miniGraph: GraphData = {
    nodes: [
      [101.650, 3.120],
      [101.651, 3.120],
      [101.652, 3.120],
      [101.651, 3.121],
    ],
    edges: [
      [0, 1, 111, 0, 3, 'Lingkungan Budi'],
      [1, 2, 111, 0, 3, 'Lingkungan Budi'],
      [1, 3, 110, 1, 2, 'Paved Footpath'],
      [3, 2, 156, 1, 2, 'Connector'],
    ],
  };
  const router = new CampusRouter(miniGraph);
  const anchors: CustomRouteAnchor[] = [
    { id: 'a1', coord: [101.650, 3.120], label: 'Start' },
    { id: 'a2', coord: [101.651, 3.120], label: 'Mid' },
    { id: 'a3', coord: [101.652, 3.120], label: 'Finish' },
  ];

  const snapped = computeCustomRoute(router, anchors, 'walk', true);
  assert.ok(snapped);
  assert.equal(snapped.totalDistanceM, 222);

  const freehand = computeCustomRoute(router, anchors, 'bike', false);
  assert.ok(freehand);
  assert.equal(freehand.mode, 'bike');
  assert.equal(freehand.coordinates.length, 3);

  // Dragging near the second leg inserts at leg index 1
  const legIdx = findInsertLegIndex(snapped, anchors, [101.6515, 3.120]);
  assert.equal(legIdx, 1);

  // Custom anchor codec + URL share round-trip with custom route name
  const encoded = encodeCustomAnchors(anchors);
  const decoded = decodeCustomAnchors(encoded);
  assert.equal(decoded.length, 3);
  assert.ok(Math.abs(decoded[1].coord[0] - 101.651) < 1e-4);
  assert.ok(Math.abs(decoded[1].coord[1] - 3.12) < 1e-4);

  const shareCustom = buildAtlasShareUrl('https://um-atlas.example/', {
    customEncoded: encoded,
    customSnap: true,
    mode: 'bike',
    routeName: 'Morning Lake Loop',
  });
  const parsedCustom = parseAtlasUrlParams(new URL(shareCustom).search);
  assert.equal(parsedCustom.customEncoded, encoded);
  assert.equal(parsedCustom.customSnap, true);
  assert.equal(parsedCustom.mode, 'bike');
  assert.equal(parsedCustom.routeName, 'Morning Lake Loop');
  assert.equal(slugifyRouteFilename('Morning Lake Loop!'), 'morning-lake-loop.png');
});





