import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from './components/Icon';
import { DirectionsPanel } from './components/DirectionsPanel';
import { FloorControls } from './components/FloorControls';
import { InspectorPanel } from './components/InspectorPanel';
import { LayerControls } from './components/LayerControls';
import { LiveNavHud } from './components/LiveNavHud';
import { SearchBar, type SearchFilterChip } from './components/SearchBar';
import { ZoneBanner } from './components/ZoneBanner';
import { ZoneDirectoryModal } from './components/ZoneDirectoryModal';
import { type CameraCommand, UmMapCanvas, type UmContextBundle } from './components/UmMapCanvas';
import { CampusRouter, distMeters } from './routing/pathfinder';
import { applyZonePalette, zoneKindLabel } from './theme';
import type {
  BuildingProps,
  ComputedRoute,
  FacultyProps,
  GraphData,
  MapLayerVisibility,
  RoomProps,
  RouteMode,
  RouteStep,
  SearchItem,
  TransitData,
  UserLocation,
} from './types/map';


const EMPTY_FC: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };
const EMPTY_CONTEXT: UmContextBundle = {
  roads: EMPTY_FC,
  water: EMPTY_FC,
  parks: EMPTY_FC,
  pois: EMPTY_FC,
};
const EMPTY_TRANSIT: TransitData = { routes: [], geojson: EMPTY_FC };
const UM_CENTER: [number, number] = [101.6538, 3.1209];

/** Realistic simulation speeds in m/s (walking, campus shuttle, driving). */
const SIM_SPEED_MPS: Record<RouteMode, number> = { walk: 1.4, bus: 6.5, drive: 9 };

function computeBearing(a: [number, number], b: [number, number]): number {
  const dx = (b[0] - a[0]) * Math.cos((a[1] * Math.PI) / 180);
  const dy = b[1] - a[1];
  if (Math.hypot(dx, dy) < 1e-9) return 0;
  return (Math.atan2(dx, dy) * 180) / Math.PI;
}

function userLocationItem(location: UserLocation): SearchItem {
  return {
    id: 'user-location',
    kind: 'point',
    title: 'Current location',
    subtitle: 'Your device location',
    keywords: 'current location my location gps here me',
    center: location.coord,
    entrance_node: -1,
  };
}

function coordsBounds(coords: [number, number][]): [[number, number], [number, number]] | null {
  if (coords.length === 0) return null;
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  for (const [lng, lat] of coords) {
    if (lng < minLng) minLng = lng;
    if (lat < minLat) minLat = lat;
    if (lng > maxLng) maxLng = lng;
    if (lat > maxLat) maxLat = lat;
  }
  return [
    [minLng, minLat],
    [maxLng, maxLat],
  ];
}

export function App() {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [boundary, setBoundary] = useState<GeoJSON.FeatureCollection>(EMPTY_FC);
  const [facultiesGeo, setFacultiesGeo] = useState<GeoJSON.FeatureCollection>(EMPTY_FC);
  const [buildingsGeo, setBuildingsGeo] = useState<GeoJSON.FeatureCollection>(EMPTY_FC);
  const [roomsGeo, setRoomsGeo] = useState<GeoJSON.FeatureCollection>(EMPTY_FC);
  const [context, setContext] = useState<UmContextBundle>(EMPTY_CONTEXT);
  const [transitData, setTransitData] = useState<TransitData>(EMPTY_TRANSIT);
  const [searchItems, setSearchItems] = useState<SearchItem[]>([]);
  const [graphStats, setGraphStats] = useState({ nodes: 0, edges: 0 });
  const routerRef = useRef<CampusRouter | null>(null);

  // Selection / Inspector state
  const [activeFaculty, setActiveFaculty] = useState<FacultyProps | null>(null);
  const [activeBuilding, setActiveBuilding] = useState<BuildingProps | null>(null);
  const [activeRoom, setActiveRoom] = useState<RoomProps | null>(null);
  const [activePoi, setActivePoi] = useState<SearchItem | null>(null);
  const [activeFloor, setActiveFloor] = useState<number | 'all'>('all');
  const [xrayEnabled, setXrayEnabled] = useState(true);
  const [is3D, setIs3D] = useState(true);
  const [visibility, setVisibility] = useState<MapLayerVisibility>({
    boundary: true,
    faculties: true,
    roads: true,
    pathways: true,
    busRoutes: true,
    buildings3d: true,
    pois: true,
    labels: true,
  });

  // Google-Maps-style top filter chip (synced with quick-jump rail)
  const [activeChip, setActiveChip] = useState<SearchFilterChip>('all');
  const [zoneDirectoryOpen, setZoneDirectoryOpen] = useState(false);
  const [searchFocusSignal, setSearchFocusSignal] = useState(0);
  const [layersOpen, setLayersOpen] = useState(false);
  const [userLocation, setUserLocation] = useState<UserLocation | null>(null);
  const [locating, setLocating] = useState(false);
  const [locationNotice, setLocationNotice] = useState<string | null>(null);

  // Directions state: Walk is default (with stepFree disabled by default), Bus 2nd, Drive 3rd
  const [directionsOpen, setDirectionsOpen] = useState(false);
  const [routeMode, setRouteMode] = useState<RouteMode>('walk');
  const [stepFree, setStepFree] = useState(false);
  const [originItem, setOriginItem] = useState<SearchItem | null>(null);
  const [destItem, setDestItem] = useState<SearchItem | null>(null);
  const [pickTarget, setPickTarget] = useState<'origin' | 'destination' | null>(null);

  // Camera command
  const [cameraCmd, setCameraCmd] = useState<CameraCommand | null>(null);
  const camSeqRef = useRef(0);
  const sendCamera = useCallback((cmd: Omit<CameraCommand, 'seq'>) => {
    camSeqRef.current += 1;
    setCameraCmd({ ...cmd, seq: camSeqRef.current });
  }, []);

  /**
   * Ask the browser for a location fix. The site asks once on load and again
   * only when the visitor explicitly presses "Locate" or "Use current location".
   */
  const requestUserLocation = useCallback((announce = false, quiet = false): Promise<UserLocation | null> => {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      if (announce) setLocationNotice('Location is not supported by this browser.');
      return Promise.resolve(null);
    }
    if (!quiet) setLocating(true);
    return new Promise<UserLocation | null>((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const location: UserLocation = {
            coord: [position.coords.longitude, position.coords.latitude],
            accuracy: Number.isFinite(position.coords.accuracy) ? position.coords.accuracy : 0,
            timestamp: position.timestamp,
          };
          setUserLocation(location);
          if (!quiet) setLocating(false);
          setLocationNotice(null);
          resolve(location);
        },
        (error) => {
          if (!quiet) setLocating(false);
          if (announce) {
            setLocationNotice(
              error.code === 1
                ? 'Location permission was denied. Enable it in your browser to use this feature.'
                : 'Could not get a location fix. Check your connection and try again.',
            );
          }
          resolve(null);
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
      );
    });
  }, []);

  // Ask for the visitor's location shortly after the map has loaded.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void requestUserLocation(false, true);
    }, 800);
    return () => window.clearTimeout(timer);
  }, [requestUserLocation]);

  // Location messages are transient.
  useEffect(() => {
    if (!locationNotice) return;
    const timer = window.setTimeout(() => setLocationNotice(null), 7000);
    return () => window.clearTimeout(timer);
  }, [locationNotice]);

  // Live Google-Maps-style Navigation State
  const [navActive, setNavActive] = useState(false);
  const [navSimulating, setNavSimulating] = useState(false);
  const [navPaused, setNavPaused] = useState(false);
  const [navSimSpeed, setNavSimSpeed] = useState<1 | 3>(1);
  const [navFollow, setNavFollow] = useState(true);
  const [navProgressM, setNavProgressM] = useState(0);
  const [liveGpsCoord, setLiveGpsCoord] = useState<[number, number] | null>(null);
  const [liveGpsSpeed, setLiveGpsSpeed] = useState<number | null>(null);
  const lastGpsSampleRef = useRef<{ coord: [number, number]; time: number } | null>(null);
  const [liveGpsHeading, setLiveGpsHeading] = useState<number | null>(null);
  const [gpsStatus, setGpsStatus] = useState<'idle' | 'watching' | 'error'>('idle');
  const [gpsError, setGpsError] = useState<string | null>(null);

  // Fetch static UM dataset on mount
  useEffect(() => {
    let cancelled = false;
    async function loadAll() {
      try {
        const [
          boundaryRes,
          facRes,
          bldRes,
          roomRes,
          ctxRes,
          graphRes,
          transitRes,
          idxRes,
        ] = await Promise.all([
          fetch('/data/um_boundary.geojson'),
          fetch('/data/um_faculties.geojson'),
          fetch('/data/um_buildings.geojson'),
          fetch('/data/um_rooms.geojson'),
          fetch('/data/um_context.geojson'),
          fetch('/data/um_graph.json'),
          fetch('/data/um_transit.json'),
          fetch('/data/um_search_index.json'),
        ]);

        if (
          !boundaryRes.ok ||
          !facRes.ok ||
          !bldRes.ok ||
          !roomRes.ok ||
          !ctxRes.ok ||
          !graphRes.ok ||
          !transitRes.ok ||
          !idxRes.ok
        ) {
          throw new Error('Failed to load UM campus dataset files');
        }

        const [bJson, fJson, buJson, rJson, cJson, gJson, tJson, sJson] = (await Promise.all([
          boundaryRes.json(),
          facRes.json(),
          bldRes.json(),
          roomRes.json(),
          ctxRes.json(),
          graphRes.json(),
          transitRes.json(),
          idxRes.json(),
        ])) as [
          GeoJSON.FeatureCollection,
          GeoJSON.FeatureCollection,
          GeoJSON.FeatureCollection,
          GeoJSON.FeatureCollection,
          Partial<UmContextBundle> & { features?: GeoJSON.Feature[] },
          GraphData,
          TransitData,
          SearchItem[],
        ];

        if (cancelled) return;

        // Parse um_context.geojson (stored as partitioned { roads, water, parks, pois })
        let ctxBundle: UmContextBundle;
        if (cJson.roads && cJson.water && cJson.parks && cJson.pois) {
          ctxBundle = {
            roads: cJson.roads,
            water: cJson.water,
            parks: cJson.parks,
            pois: cJson.pois,
          };
        } else {
          const roadFeats: GeoJSON.Feature[] = [];
          const waterFeats: GeoJSON.Feature[] = [];
          const parkFeats: GeoJSON.Feature[] = [];
          const poiFeats: GeoJSON.Feature[] = [];
          for (const feat of cJson.features ?? []) {
            const kind = String((feat.properties as Record<string, unknown> | null)?.kind ?? '');
            if (kind === 'road' || kind === 'footway' || kind === 'shortcut' || kind === 'steps') {
              roadFeats.push(feat);
            } else if (kind === 'water') {
              waterFeats.push(feat);
            } else if (kind === 'park' || kind === 'pitch' || kind === 'track') {
              parkFeats.push(feat);
            } else {
              poiFeats.push(feat);
            }
          }
          ctxBundle = {
            roads: { type: 'FeatureCollection', features: roadFeats },
            water: { type: 'FeatureCollection', features: waterFeats },
            parks: { type: 'FeatureCollection', features: parkFeats },
            pois: { type: 'FeatureCollection', features: poiFeats },
          };
        }

        applyZonePalette(fJson, buJson);

        setBoundary(bJson);
        setFacultiesGeo(fJson);
        setBuildingsGeo(buJson);
        setRoomsGeo(rJson);
        setContext(ctxBundle);
        setTransitData(tJson);
        setSearchItems(sJson);
        setGraphStats({ nodes: gJson.nodes.length, edges: gJson.edges.length });
        routerRef.current = new CampusRouter(gJson, tJson);

        // Sensible default origin near UM Main Entrance for quick route testing
        const defaultOrigin =
          sJson.find((i) => i.id === 'gate-main') ??
          sJson.find((i) => i.kind === 'gate') ??
          sJson.find((i) => i.id === 'FSKTM') ??
          null;
        setOriginItem(defaultOrigin);

        setLoading(false);
      } catch (err) {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : 'Unable to load map dataset');
          setLoading(false);
        }
      }
    }
    loadAll();
    return () => {
      cancelled = true;
    };
  }, []);

  // Structured lookup tables
  const allFaculties = useMemo<FacultyProps[]>(() => {
    return facultiesGeo.features.map((f) => f.properties as FacultyProps);
  }, [facultiesGeo]);

  const facultyById = useMemo(() => {
    const m = new Map<string, FacultyProps>();
    for (const f of allFaculties) m.set(f.id, f);
    return m;
  }, [allFaculties]);

  const allBuildings = useMemo<BuildingProps[]>(() => {
    return buildingsGeo.features.map((f) => f.properties as BuildingProps);
  }, [buildingsGeo]);

  const buildingById = useMemo(() => {
    const m = new Map<string, BuildingProps>();
    for (const b of allBuildings) m.set(b.id, b);
    return m;
  }, [allBuildings]);

  const allRooms = useMemo<RoomProps[]>(() => {
    return roomsGeo.features.map((f) => f.properties as RoomProps);
  }, [roomsGeo]);

  const roomById = useMemo(() => {
    const m = new Map<string, RoomProps>();
    for (const r of allRooms) m.set(r.id, r);
    return m;
  }, [allRooms]);

  const searchItemByKey = useMemo(() => {
    const m = new Map<string, SearchItem>();
    for (const it of searchItems) m.set(`${it.kind}:${it.id}`, it);
    return m;
  }, [searchItems]);

  const facultyBuildings = useMemo(() => {
    if (!activeFaculty) return [];
    return allBuildings
      .filter((b) => b.faculty_id === activeFaculty.id && !b.is_canopy)
      .sort((a, b) => Number(b.has_rooms) - Number(a.has_rooms) || b.height - a.height);
  }, [allBuildings, activeFaculty]);

  const buildingRooms = useMemo(() => {
    if (!activeBuilding) return [];
    return allRooms
      .filter((r) => r.building_id === activeBuilding.id)
      .sort((a, b) => b.floor - a.floor || a.name.localeCompare(b.name));
  }, [allRooms, activeBuilding]);

  // Compute active route whenever origin/dest/mode/stepFree change
  const computedRoute = useMemo<ComputedRoute | null>(() => {
    if (!routerRef.current || !originItem || !destItem) return null;
    if (originItem.id === destItem.id && originItem.kind === destItem.kind) return null;
    return routerRef.current.computeRoute(originItem, destItem, routeMode, { stepFree });
  }, [originItem, destItem, routeMode, stepFree]);

  // Geometry metrics along computedRoute for Live Navigation
  const routeMetrics = useMemo(() => {
    if (!computedRoute || computedRoute.coordinates.length < 2) {
      return { cumDists: [0], totalGeomM: 0, stepStartsM: [0] };
    }
    const coords = computedRoute.coordinates;
    const cumDists: number[] = [0];
    for (let i = 1; i < coords.length; i++) {
      cumDists.push(cumDists[i - 1] + distMeters(coords[i - 1], coords[i]));
    }
    const totalGeomM = cumDists[cumDists.length - 1] || 1;

    // Map each step's start coord to a cumulative distance along the route
    const stepStartsM: number[] = [];
    let searchFrom = 0;
    for (const s of computedRoute.steps) {
      let bestIdx = searchFrom;
      let bestD = Infinity;
      for (let i = searchFrom; i < coords.length; i++) {
        const d = distMeters(coords[i], s.coord);
        if (d < bestD) {
          bestD = d;
          bestIdx = i;
        }
        if (bestD < 12) break;
      }
      searchFrom = bestIdx;
      stepStartsM.push(cumDists[bestIdx]);
    }
    return { cumDists, totalGeomM, stepStartsM };
  }, [computedRoute]);

  // Simulated Live Follow animation timer when navActive && navSimulating && !navPaused
  useEffect(() => {
    if (!navActive || !navSimulating || navPaused || !computedRoute) return;
    if (routeMetrics.totalGeomM <= 0) return;

    const baseSpeedMps = SIM_SPEED_MPS[routeMode];
    let lastTs = performance.now();
    let rafId = 0;

    const tick = (now: number) => {
      const dt = Math.min(0.12, (now - lastTs) / 1000);
      lastTs = now;
      setNavProgressM((prev) => {
        const next = prev + baseSpeedMps * navSimSpeed * dt;
        if (next >= routeMetrics.totalGeomM) {
          return routeMetrics.totalGeomM;
        }
        return next;
      });
      rafId = window.requestAnimationFrame(tick);
    };

    rafId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(rafId);
  }, [navActive, navSimulating, navPaused, navSimSpeed, routeMode, computedRoute, routeMetrics.totalGeomM]);

  // Real device GPS watcher when navActive && !navSimulating
  useEffect(() => {
    if (!navActive || navSimulating) {
      setGpsStatus('idle');
      return;
    }
    if (!('geolocation' in navigator)) {
      setGpsStatus('error');
      setGpsError('Device GPS is unavailable. Use “Simulate route” to preview the walkthrough.');
      return;
    }

    setGpsStatus('watching');
    setGpsError(null);

    // Wait for a real fix. We never start the simulation automatically.
    let receivedValidFix = false;
    const fallbackTimer = window.setTimeout(() => {
      if (!receivedValidFix) {
        setGpsError('No GPS fix yet. Use “Simulate route” to preview the walkthrough.');
      }
    }, 6000);

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const coord: [number, number] = [pos.coords.longitude, pos.coords.latitude];
        const distFromUm = distMeters(coord, UM_CENTER);
        if (distFromUm > 6500) {
          window.clearTimeout(fallbackTimer);
          setGpsError('You are outside the UM campus. Use “Simulate route” to preview the walkthrough.');
          return;
        }
        receivedValidFix = true;
        window.clearTimeout(fallbackTimer);
        setGpsError(null);
        setLiveGpsCoord(coord);
        if (typeof pos.coords.heading === 'number' && !Number.isNaN(pos.coords.heading)) {
          setLiveGpsHeading(pos.coords.heading);
        }

        const previousSample = lastGpsSampleRef.current;
        let speedMps =
          typeof pos.coords.speed === 'number' && Number.isFinite(pos.coords.speed)
            ? Math.max(0, pos.coords.speed)
            : null;
        if (speedMps === null && previousSample) {
          const seconds = Math.max(0.8, (pos.timestamp - previousSample.time) / 1000);
          speedMps = distMeters(coord, previousSample.coord) / seconds;
        }
        lastGpsSampleRef.current = { coord, time: pos.timestamp };
        setLiveGpsSpeed(speedMps === null ? null : Math.min(speedMps, 40));

        // Snap progress onto nearest point along computed route
        if (computedRoute && computedRoute.coordinates.length >= 2) {
          let bestIdx = 0;
          let bestD = Infinity;
          for (let i = 0; i < computedRoute.coordinates.length; i++) {
            const d = distMeters(coord, computedRoute.coordinates[i]);
            if (d < bestD) {
              bestD = d;
              bestIdx = i;
            }
          }
          setNavProgressM(routeMetrics.cumDists[bestIdx] ?? 0);
        }
      },
      (err) => {
        window.clearTimeout(fallbackTimer);
        setGpsStatus('error');
        setLiveGpsSpeed(null);
        lastGpsSampleRef.current = null;
        setGpsError(`${err.message}. Use “Simulate route” to preview the walkthrough.`);
      },
      { enableHighAccuracy: true, maximumAge: 1500, timeout: 5000 },
    );

    return () => {
      window.clearTimeout(fallbackTimer);
      navigator.geolocation.clearWatch(watchId);
    };
  }, [navActive, navSimulating, computedRoute, routeMetrics.cumDists]);

  // Compute live navigation puck position, heading & step index
  const liveNavState = useMemo(() => {
    if (!navActive || !computedRoute || computedRoute.coordinates.length < 2) {
      return {
        coord: null as [number, number] | null,
        heading: 0,
        stepIndex: 0,
        distanceToNextStepM: 0,
        remainingDistanceM: 0,
        remainingMinutes: 0,
        progressFraction: 0,
        arrived: false,
      };
    }

    const { cumDists, totalGeomM, stepStartsM } = routeMetrics;
    const coords = computedRoute.coordinates;
    const clampedM = Math.max(0, Math.min(navProgressM, totalGeomM));

    // Interpolate along polyline
    let segIdx = 0;
    while (segIdx < cumDists.length - 2 && cumDists[segIdx + 1] < clampedM) {
      segIdx += 1;
    }
    const segStartM = cumDists[segIdx];
    const segEndM = cumDists[segIdx + 1];
    const segLen = Math.max(0.01, segEndM - segStartM);
    const t = Math.max(0, Math.min(1, (clampedM - segStartM) / segLen));
    const a = coords[segIdx];
    const b = coords[segIdx + 1];
    const interpCoord: [number, number] = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    const segHeading = computeBearing(a, b);

    let stepIndex = 0;
    for (let i = 0; i < stepStartsM.length; i++) {
      if (clampedM >= stepStartsM[i] - 5) {
        stepIndex = i;
      }
    }
    const nextStepM = stepStartsM[stepIndex + 1] ?? totalGeomM;
    const distanceToNextStepM = Math.max(0, nextStepM - clampedM);
    const remainingDistanceM = Math.max(0, totalGeomM - clampedM);
    const frac = totalGeomM > 0 ? clampedM / totalGeomM : 1;
    const remainingMinutes = computedRoute.estimatedMinutes * (1 - frac);
    const arrived = clampedM >= totalGeomM - 2;

    return {
      coord: !navSimulating && liveGpsCoord ? liveGpsCoord : interpCoord,
      heading: !navSimulating && liveGpsHeading !== null ? liveGpsHeading : segHeading,
      stepIndex,
      distanceToNextStepM,
      remainingDistanceM,
      remainingMinutes,
      progressFraction: frac,
      arrived,
    };
  }, [navActive, navSimulating, liveGpsCoord, liveGpsHeading, computedRoute, routeMetrics, navProgressM]);

  // Camera & selection handlers
  const resetToCampus = useCallback(() => {
    setNavActive(false);
    setActivePoi(null);
    setActiveRoom(null);
    setActiveBuilding(null);
    setActiveFaculty(null);
    setActiveFloor('all');
    sendCamera({
      center: UM_CENTER,
      zoom: 15.1,
      pitch: 50,
      bearing: -16,
    });
  }, [sendCamera]);

  const selectFaculty = useCallback(
    (fac: FacultyProps) => {
      setActivePoi(null);
      setActiveFaculty(fac);
      setActiveBuilding(null);
      setActiveRoom(null);
      setActiveFloor('all');
      sendCamera({
        center: fac.center,
        zoom: fac.zoom || 17.2,
        pitch: fac.pitch || 54,
        bearing: fac.bearing ?? -16,
      });
    },
    [sendCamera],
  );

  const selectBuilding = useCallback(
    (bld: BuildingProps) => {
      const parentFac = facultyById.get(bld.faculty_id) ?? null;
      setActivePoi(null);
      setActiveFaculty(parentFac);
      setActiveBuilding(bld);
      setActiveRoom(null);
      setActiveFloor('all');
      if (bld.has_rooms) setXrayEnabled(true);
      sendCamera({
        center: bld.center,
        zoom: 18.4,
        pitch: 58,
      });
    },
    [facultyById, sendCamera],
  );

  const selectRoom = useCallback(
    (room: RoomProps) => {
      const parentFac = facultyById.get(room.faculty_id) ?? null;
      const parentBld = buildingById.get(room.building_id) ?? null;
      setActivePoi(null);
      setActiveFaculty(parentFac);
      setActiveBuilding(parentBld);
      setActiveRoom(room);
      setActiveFloor(room.floor);
      setXrayEnabled(true);
      sendCamera({
        center: room.center,
        zoom: 19.2,
        pitch: 62,
      });
    },
    [facultyById, buildingById, sendCamera],
  );

  const selectPoiById = useCallback(
    (poiId: string) => {
      const found =
        searchItems.find(
          (i) =>
            i.id === poiId &&
            (i.kind === 'gate' || i.kind === 'bus_stop' || i.kind === 'rail_station' || i.kind === 'point'),
        ) ?? null;
      if (!found) return;
      setActiveFaculty(null);
      setActiveBuilding(null);
      setActiveRoom(null);
      setActivePoi(found);
      sendCamera({
        center: found.center,
        zoom: found.kind === 'rail_station' ? 16.8 : 17.6,
        pitch: 50,
      });
    },
    [searchItems, sendCamera],
  );

  const handleSelectSearchItem = useCallback(
    (item: SearchItem) => {
      if (item.kind === 'faculty') {
        const fac = facultyById.get(item.id);
        if (fac) selectFaculty(fac);
      } else if (item.kind === 'building') {
        const bld = buildingById.get(item.id);
        if (bld) selectBuilding(bld);
      } else if (item.kind === 'room') {
        const room = roomById.get(item.id);
        if (room) selectRoom(room);
      } else {
        setActiveFaculty(null);
        setActiveBuilding(null);
        setActiveRoom(null);
        setActivePoi(item);
        sendCamera({ center: item.center, zoom: item.kind === 'rail_station' ? 16.8 : 17.6, pitch: 52 });
      }
    },
    [facultyById, buildingById, roomById, selectFaculty, selectBuilding, selectRoom, sendCamera],
  );

  const resolveTargetToSearchItem = useCallback(
    (target: { kind: 'faculty' | 'building' | 'room' | 'poi'; id: string }): SearchItem | null => {
      if (target.kind === 'poi') {
        return (
          searchItems.find(
            (i) =>
              i.id === target.id &&
              (i.kind === 'rail_station' || i.kind === 'bus_stop' || i.kind === 'gate' || i.kind === 'point'),
          ) ?? null
        );
      }
      return searchItemByKey.get(`${target.kind}:${target.id}`) ?? null;
    },
    [searchItems, searchItemByKey],
  );

  const handleNavigateTo = useCallback(
    (target: { kind: 'faculty' | 'building' | 'room' | 'poi'; id: string }) => {
      const dest = resolveTargetToSearchItem(target);
      if (dest) {
        setDestItem(dest);
        setDirectionsOpen(true);
        setPickTarget(null);
        setNavActive(false);
        if (originItem && originItem.id === dest.id) {
          const alt = searchItems.find((i) => i.id !== dest.id && i.kind === 'gate');
          if (alt) setOriginItem(alt);
        }
      }
    },
    [resolveTargetToSearchItem, originItem, searchItems],
  );

  const handleSetOriginTarget = useCallback(
    (target: { kind: 'faculty' | 'building' | 'room' | 'poi'; id: string }) => {
      const org = resolveTargetToSearchItem(target);
      if (org) {
        setOriginItem(org);
        setDirectionsOpen(true);
        setPickTarget(null);
        setNavActive(false);
      }
    },
    [resolveTargetToSearchItem],
  );

  // Fit route when computed in Directions mode (when not already in live navigation)
  useEffect(() => {
    if (!directionsOpen || navActive || !computedRoute || computedRoute.coordinates.length < 2) return;
    const b = coordsBounds(computedRoute.coordinates);
    if (b) {
      sendCamera({
        bounds: b,
        padding: { top: 90, bottom: 90, left: window.innerWidth <= 900 ? 24 : 540, right: 80 },
        pitch: 46,
      });
    }
  }, [directionsOpen, navActive, computedRoute, sendCamera]);

  const handleStartNavigation = useCallback(() => {
    if (!computedRoute || computedRoute.coordinates.length < 2) return;
    setNavProgressM(0);
    setLiveGpsCoord(null);
    setLiveGpsHeading(null);
    setLiveGpsSpeed(null);
    lastGpsSampleRef.current = null;
    setGpsError(null);
    setNavSimulating(false);
    setNavPaused(false);
    setNavFollow(true);
    setNavActive(true);
    setLayersOpen(false);
    setZoneDirectoryOpen(false);

    // Ensure bus routes layer is subtle/clean; zoom smoothly to start of route
    const startCoord = computedRoute.coordinates[0];
    const nextCoord = computedRoute.coordinates[1] ?? startCoord;
    sendCamera({
      center: startCoord,
      zoom: 18.5,
      pitch: 60,
      bearing: computeBearing(startCoord, nextCoord),
    });
  }, [computedRoute, sendCamera]);

  const handleExitNavigation = useCallback(() => {
    setNavActive(false);
    setNavPaused(false);
    setLiveGpsSpeed(null);
    lastGpsSampleRef.current = null;
    setGpsStatus('idle');
    setGpsError(null);
    if (computedRoute && computedRoute.coordinates.length >= 2) {
      const b = coordsBounds(computedRoute.coordinates);
      if (b) {
        sendCamera({
          bounds: b,
          padding: { top: 90, bottom: 90, left: window.innerWidth <= 900 ? 24 : 540, right: 80 },
          pitch: 46,
        });
      }
    }
  }, [computedRoute, sendCamera]);

  const handlePickCoordinate = useCallback(
    (coord: [number, number], labelHint?: string) => {
      const customItem: SearchItem = {
        id: `custom-${Date.now()}`,
        kind: 'point',
        title: labelHint ? `Near ${labelHint}` : `Map Point (${coord[1].toFixed(4)}, ${coord[0].toFixed(4)})`,
        subtitle: 'Custom selected location on UM campus',
        keywords: `${labelHint ?? ''} custom point`,
        center: coord,
        entrance_node: -1,
      };
      if (pickTarget === 'origin') {
        setOriginItem(customItem);
      } else if (pickTarget === 'destination') {
        setDestItem(customItem);
      }
      setPickTarget(null);
    },
    [pickTarget],
  );

  const handleSelectStep = useCallback(
    (step: RouteStep) => {
      sendCamera({ center: step.coord, zoom: 18.6, pitch: 58 });
    },
    [sendCamera],
  );
  const hasLeftSheet = Boolean(activeFaculty || activeBuilding || activeRoom || activePoi);
  const floorOffset = directionsOpen || hasLeftSheet ? 524 : 104;

  const openDirections = useCallback(() => {
    setDirectionsOpen(true);
    setLayersOpen(false);
    setZoneDirectoryOpen(false);
    if (!destItem && (activeRoom || activeBuilding || activeFaculty || activePoi)) {
      if (activeRoom) {
        const it = resolveTargetToSearchItem({ kind: 'room', id: activeRoom.id });
        if (it) setDestItem(it);
      } else if (activeBuilding) {
        const it = resolveTargetToSearchItem({ kind: 'building', id: activeBuilding.id });
        if (it) setDestItem(it);
      } else if (activeFaculty) {
        const it = resolveTargetToSearchItem({ kind: 'faculty', id: activeFaculty.id });
        if (it) setDestItem(it);
      } else if (activePoi) {
        setDestItem(activePoi);
      }
    }
  }, [destItem, activeRoom, activeBuilding, activeFaculty, activePoi, resolveTargetToSearchItem]);

  const clearSelection = useCallback(() => {
    setActivePoi(null);
    setActiveRoom(null);
    setActiveBuilding(null);
    setActiveFaculty(null);
    setActiveFloor('all');
  }, []);

  const handleLocate = useCallback(async () => {
    const location =
      userLocation && Date.now() - userLocation.timestamp < 120000
        ? userLocation
        : (await requestUserLocation(true)) ?? userLocation;
    if (!location) return;
    const awayM = distMeters(location.coord, UM_CENTER);
    if (awayM > 6500) {
      setLocationNotice(`You are about ${Math.round(awayM / 1000)} km from UM — showing your position.`);
    }
    sendCamera({
      center: location.coord,
      zoom: location.accuracy > 400 ? 15.2 : location.accuracy > 120 ? 16.2 : 17.4,
      pitch: 45,
    });
  }, [userLocation, requestUserLocation, sendCamera]);

  const handleUseCurrentLocation = useCallback(async () => {
    const location =
      userLocation && Date.now() - userLocation.timestamp < 120000
        ? userLocation
        : (await requestUserLocation(true)) ?? userLocation;
    if (!location) return;
    setOriginItem(userLocationItem(location));
    setDirectionsOpen(true);
    setLayersOpen(false);
    setZoneDirectoryOpen(false);
    setPickTarget(null);
  }, [userLocation, requestUserLocation]);

  const bannerInfo = useMemo(() => {
    if (navActive || directionsOpen) return null;
    if (activeRoom) {
      return {
        code: activeFaculty?.code ?? 'RM',
        accent: activeFaculty?.accent,
        title: activeRoom.name,
        subtitle: [activeBuilding?.name, activeFaculty?.name].filter(Boolean).join(' · '),
      };
    }
    if (activeBuilding) {
      return {
        code: activeFaculty?.code ?? 'BLD',
        accent: activeFaculty?.accent,
        title: activeBuilding.name,
        subtitle: activeFaculty?.name ?? 'Universiti Malaya',
      };
    }
    if (activeFaculty) {
      return {
        code: activeFaculty.code,
        accent: activeFaculty.accent,
        title: activeFaculty.name,
        subtitle: `${zoneKindLabel(activeFaculty.zone_kind)}${
          activeFaculty.established ? ` · Est. ${activeFaculty.established}` : ''
        }`,
      };
    }
    if (activePoi) {
      return { code: undefined, accent: undefined, title: activePoi.title, subtitle: activePoi.subtitle };
    }
    return null;
  }, [navActive, directionsOpen, activeRoom, activeBuilding, activeFaculty, activePoi]);

  const isMapBusy = directionsOpen || navActive;
  const showMobileSheet = !navActive && (hasLeftSheet || directionsOpen);
  const currentSpeedMps =
    navActive && !liveNavState.arrived
      ? navSimulating
        ? navPaused
          ? 0
          : SIM_SPEED_MPS[routeMode] * navSimSpeed
        : liveGpsSpeed ?? 0
      : 0;

  return (
    <div
      className={`app-shell${hasLeftSheet || directionsOpen ? ' has-left-sheet' : ''}${
        showMobileSheet ? ' has-mobile-sheet' : ''
      }`}
    >
      <UmMapCanvas
        boundary={boundary}
        faculties={facultiesGeo}
        buildings={buildingsGeo}
        rooms={roomsGeo}
        context={context}
        transitGeoJson={transitData.geojson}
        activeFaculty={activeFaculty}
        activeBuilding={activeBuilding}
        activeRoom={activeRoom}
        activeFloor={activeFloor}
        xrayEnabled={xrayEnabled}
        is3D={is3D}
        visibility={visibility}
        userLocation={navActive ? null : userLocation}
        route={directionsOpen || navActive ? computedRoute : null}
        originCoord={directionsOpen || navActive ? originItem?.center ?? null : null}
        destCoord={directionsOpen || navActive ? destItem?.center ?? null : null}
        pickTarget={pickTarget}
        cameraCmd={cameraCmd}
        liveNavActive={navActive}
        liveNavCoord={liveNavState.coord}
        liveNavHeading={liveNavState.heading}
        liveNavFollow={navFollow}
        onUserMapDrag={() => {
          if (navActive) setNavFollow(false);
        }}
        onSelectFaculty={selectFaculty}
        onSelectBuilding={selectBuilding}
        onSelectRoom={selectRoom}
        onSelectPoi={selectPoiById}
        onPickCoordinate={handlePickCoordinate}
      />


      <nav className="app-rail" aria-label="Primary navigation">
        <div className="rail-brand">
          <span className="rail-brand__mark">UM</span>
          <span className="rail-brand__text">3D Atlas</span>
        </div>
        <div className="rail-nav">
          <button
            type="button"
            className="rail-item"
            onClick={() => setSearchFocusSignal((v) => v + 1)}
            disabled={isMapBusy}
            aria-label="Search"
          >
            <span className="rail-item__icon">
              <Icon name="search" size={19} />
            </span>
            <span className="rail-item__label">Search</span>
          </button>
          <button
            type="button"
            className={`rail-item${zoneDirectoryOpen ? ' is-active' : ''}`}
            onClick={() => setZoneDirectoryOpen(true)}
            aria-label="Explore campus zones"
            disabled={navActive}
          >
            <span className="rail-item__icon">
              <Icon name="zones" size={19} />
            </span>
            <span className="rail-item__label">Explore</span>
          </button>
          <button
            type="button"
            className={`rail-item${directionsOpen ? ' is-active' : ''}`}
            onClick={() => {
              if (directionsOpen) {
                setDirectionsOpen(false);
                setPickTarget(null);
              } else {
                openDirections();
              }
            }}
            aria-label="Directions"
            disabled={navActive}
          >
            <span className="rail-item__icon">
              <Icon name="directions" size={19} />
            </span>
            <span className="rail-item__label">Directions</span>
          </button>
          <button
            type="button"
            className={`rail-item${layersOpen ? ' is-active' : ''}`}
            onClick={() => setLayersOpen((v) => !v)}
            aria-label="Map layers"
            disabled={navActive}
          >
            <span className="rail-item__icon">
              <Icon name="layers" size={19} />
            </span>
            <span className="rail-item__label">Layers</span>
          </button>
          <button type="button" className="rail-item" onClick={handleLocate} aria-label="Find my location" disabled={locating}>
            <span className="rail-item__icon">
              <Icon name="locate" size={19} />
            </span>
            <span className="rail-item__label">{locating ? 'Finding' : 'Locate'}</span>
          </button>
        </div>
        <div className="rail-foot">
          <button
            type="button"
            className={`rail-item${!is3D ? ' is-active' : ''}`}
            onClick={() => setIs3D((v) => !v)}
            aria-label={is3D ? 'Switch to flat view' : 'Switch to 3D view'}
          >
            <span className="rail-item__icon">
              <Icon name="box" size={19} />
            </span>
            <span className="rail-item__label">{is3D ? '3D' : '2D'}</span>
          </button>
        </div>
      </nav>

      <button
        type="button"
        className="map-locate"
        onClick={handleLocate}
        disabled={locating}
        aria-label="Find my location"
      >
        <Icon name="locate" size={19} />
      </button>

      <SearchBar
        items={searchItems}
        directionsOpen={directionsOpen}
        navActive={navActive}
        activeChip={activeChip}
        onChangeChip={setActiveChip}
        onSelectItem={handleSelectSearchItem}
        onOpenDirections={openDirections}
        focusSignal={searchFocusSignal}
      />

      {bannerInfo && (
        <ZoneBanner
          code={bannerInfo.code}
          accent={bannerInfo.accent}
          title={bannerInfo.title}
          subtitle={bannerInfo.subtitle}
          onClose={clearSelection}
        />
      )}

      {!directionsOpen && !navActive && (
        <InspectorPanel
          faculty={activeFaculty}
          building={activeBuilding}
          room={activeRoom}
          poi={activePoi}
          facultyBuildings={facultyBuildings}
          buildingRooms={buildingRooms}
          transitRoutes={transitData.routes}
          activeFloor={activeFloor}
          xrayEnabled={xrayEnabled}
          onToggleXray={() => setXrayEnabled((v) => !v)}
          onSelectBuilding={selectBuilding}
          onSelectRoom={selectRoom}
          onSelectFloor={(fl) => setActiveFloor(fl)}
          onResetCampus={resetToCampus}
          onClearBuilding={() => {
            setActiveBuilding(null);
            setActiveRoom(null);
            setActiveFloor('all');
          }}
          onClearRoom={() => setActiveRoom(null)}
          onNavigateTo={handleNavigateTo}
          onSetOrigin={handleSetOriginTarget}
          onClose={clearSelection}
        />
      )}

      <DirectionsPanel
        open={directionsOpen}
        navActive={navActive}
        items={searchItems}
        origin={originItem}
        destination={destItem}
        mode={routeMode}
        stepFree={stepFree}
        route={computedRoute}
        pickTarget={pickTarget}
        hasUserLocation={Boolean(userLocation)}
        locating={locating}
        onUseCurrentLocation={handleUseCurrentLocation}
        onSetOrigin={setOriginItem}
        onSetDestination={setDestItem}
        onSwap={() => {
          setOriginItem(destItem);
          setDestItem(originItem);
        }}
        onChangeMode={(m) => {
          setRouteMode(m);
          if (m === 'bus' && !visibility.busRoutes) {
            setVisibility((v) => ({ ...v, busRoutes: true }));
          }
        }}
        onToggleStepFree={setStepFree}
        onTogglePickTarget={(t) => setPickTarget((prev) => (prev === t ? null : t))}
        onStartNavigation={handleStartNavigation}
        onSelectStep={handleSelectStep}
        onClose={() => {
          setDirectionsOpen(false);
          setPickTarget(null);
        }}
      />


      {navActive && computedRoute && (
        <LiveNavHud
          route={computedRoute}
          mode={routeMode}
          destinationName={destItem?.title ?? 'Destination'}
          currentStepIndex={liveNavState.stepIndex}
          distanceToNextStepM={liveNavState.distanceToNextStepM}
          remainingDistanceM={liveNavState.remainingDistanceM}
          remainingMinutes={liveNavState.remainingMinutes}
          progressFraction={liveNavState.progressFraction}
          isSimulating={navSimulating}
          isPaused={navPaused}
          simSpeed={navSimSpeed}
          isFollowing={navFollow}
          gpsStatus={gpsStatus}
          gpsError={gpsError}
          arrived={liveNavState.arrived}
          speedMps={currentSpeedMps}
          onTogglePause={() => setNavPaused((v) => !v)}
          onToggleSpeed={() => setNavSimSpeed((s) => (s === 1 ? 3 : 1))}
          onToggleSource={() => {
            setNavSimulating((v) => !v);
            setNavPaused(false);
            setGpsError(null);
          }}
          onRecenter={() => setNavFollow(true)}
          onExit={handleExitNavigation}
        />
      )}

      <FloorControls
        building={activeBuilding}
        rooms={buildingRooms}
        activeFloor={activeFloor}
        xrayEnabled={xrayEnabled}
        leftOffset={floorOffset}
        bottomOffset={68}
        onSelectFloor={(fl) => setActiveFloor(fl)}
        onToggleXray={() => setXrayEnabled((v) => !v)}
      />

      <ZoneDirectoryModal
        open={zoneDirectoryOpen}
        zones={allFaculties}
        activeZoneId={activeFaculty?.id}
        onSelectZone={(zone) => {
          selectFaculty(zone);
          setZoneDirectoryOpen(false);
        }}
        onClose={() => setZoneDirectoryOpen(false)}
      />

      <LayerControls
        open={layersOpen && !isMapBusy}
        visibility={visibility}
        is3D={is3D}
        onToggleLayer={(key) => setVisibility((v) => ({ ...v, [key]: !v[key] }))}
        onToggle3D={() => setIs3D((v) => !v)}
        onResetCampus={resetToCampus}
        onClose={() => setLayersOpen(false)}
        stats={{
          faculties: allFaculties.length,
          buildings: allBuildings.filter((b) => !b.is_canopy).length,
          rooms: allRooms.length,
          nodes: graphStats.nodes,
          edges: graphStats.edges,
          busRoutes: transitData.routes.length,
        }}
      />

      <nav className="app-mobilebar" aria-label="Primary navigation">
        <button
          type="button"
          className="mobile-bar__item"
          onClick={() => setSearchFocusSignal((v) => v + 1)}
          disabled={isMapBusy}
        >
          <Icon name="search" size={20} />
          Search
        </button>
        <button
          type="button"
          className="mobile-bar__item"
          onClick={() => setZoneDirectoryOpen(true)}
          disabled={navActive}
        >
          <Icon name="zones" size={20} />
          Explore
        </button>
        <button
          type="button"
          className={`mobile-bar__item${directionsOpen ? ' is-active' : ''}`}
          onClick={() => {
            if (directionsOpen) {
              setDirectionsOpen(false);
              setPickTarget(null);
            } else {
              openDirections();
            }
          }}
          disabled={navActive}
        >
          <Icon name="directions" size={20} />
          Directions
        </button>
        <button
          type="button"
          className={`mobile-bar__item${layersOpen ? ' is-active' : ''}`}
          onClick={() => setLayersOpen((v) => !v)}
          disabled={navActive}
        >
          <Icon name="layers" size={20} />
          Layers
        </button>
      </nav>

      {locationNotice && <div className="notice-toast">{locationNotice}</div>}

      {loading && (
        <div className="loading-screen">
          <div className="loading-mark">UM</div>
          <div className="loading-title">UM 3D Atlas</div>
          <div className="loading-sub">Loading campus geometry and transit data</div>
        </div>
      )}

      {loadError && <div className="error-toast">{loadError}</div>}
    </div>
  );
}

export default App;


