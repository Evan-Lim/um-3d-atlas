import { useEffect, useMemo, useRef } from 'react';
import maplibregl, {
  type GeoJSONSource,
  type LngLatBoundsLike,
  type MapGeoJSONFeature,
  type StyleSpecification,
} from 'maplibre-gl';
import type {
  BuildingProps,
  ComputedRoute,
  FacultyProps,
  MapLayerVisibility,
  RoomProps,
} from '../types/map';
import { zoneAccent } from '../theme';

export interface UmContextBundle {
  roads: GeoJSON.FeatureCollection;
  water: GeoJSON.FeatureCollection;
  parks: GeoJSON.FeatureCollection;
  pois: GeoJSON.FeatureCollection;
}

export interface CameraCommand {
  seq: number;
  center?: [number, number];
  zoom?: number;
  pitch?: number;
  bearing?: number;
  bounds?: [[number, number], [number, number]];
  padding?: { top: number; bottom: number; left: number; right: number };
}

interface UmMapCanvasProps {
  boundary: GeoJSON.FeatureCollection;
  faculties: GeoJSON.FeatureCollection;
  buildings: GeoJSON.FeatureCollection;
  rooms: GeoJSON.FeatureCollection;
  context: UmContextBundle;
  transitGeoJson: GeoJSON.FeatureCollection;
  activeFaculty: FacultyProps | null;
  activeBuilding: BuildingProps | null;
  activeRoom: RoomProps | null;
  activeFloor: number | 'all';
  xrayEnabled: boolean;
  is3D: boolean;
  visibility: MapLayerVisibility;
  route: ComputedRoute | null;
  originCoord: [number, number] | null;
  destCoord: [number, number] | null;
  pickTarget: 'origin' | 'destination' | null;
  cameraCmd: CameraCommand | null;
  liveNavActive: boolean;
  liveNavCoord: [number, number] | null;
  liveNavHeading: number;
  liveNavFollow: boolean;
  onUserMapDrag: () => void;
  onSelectFaculty: (f: FacultyProps) => void;
  onSelectBuilding: (b: BuildingProps) => void;
  onSelectRoom: (r: RoomProps) => void;
  onSelectPoi: (id: string) => void;
  onPickCoordinate: (coord: [number, number], labelHint?: string) => void;
}

const UM_DEFAULT_CENTER: [number, number] = [101.6538, 3.1209];

/**
 * Campus data carries a different colour per zone. The atlas maps those into a
 * single tonal UM-blue family so the map reads as one designed product.
 */
const ZONE_COLOR_EXPR = [
  'match',
  ['get', 'zone_kind'],
  'college',
  '#5468b8',
  'institute',
  '#3d6c96',
  'medical',
  '#5c6fa8',
  'landmark',
  '#3a4a72',
  '#2f5bb7',
] as unknown as maplibregl.ExpressionSpecification;

const FALLBACK_LIGHT_STYLE: StyleSpecification = {
  version: 8,
  name: 'UM Atlas Base',
  glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
  sources: {},
  layers: [
    {
      id: 'bg-canvas',
      type: 'background',
      paint: {
        'background-color': '#eef1f8',
      },
    },
  ],
};


function parseProp<T>(val: unknown, fallback: T): T {
  if (typeof val === 'string') {
    try {
      return JSON.parse(val) as T;
    } catch {
      return fallback;
    }
  }
  return (val as T) ?? fallback;
}

function toBuildingProps(raw: Record<string, unknown>): BuildingProps {
  return {
    id: String(raw.id ?? ''),
    name: String(raw.name ?? 'UM Building'),
    name_ms: String(raw.name_ms ?? ''),
    code: String(raw.code ?? ''),
    faculty_id: String(raw.faculty_id ?? 'CORE'),
    faculty_color: String(raw.faculty_color ?? '#0284c7'),
    levels: Number(raw.levels ?? 2),
    height: Number(raw.height ?? 8),
    category: String(raw.category ?? 'academic'),
    wheelchair: String(raw.wheelchair ?? 'unknown'),
    website: String(raw.website ?? ''),
    center: parseProp<[number, number]>(raw.center, UM_DEFAULT_CENTER),
    entrance_node: Number(raw.entrance_node ?? 0),
    has_rooms: raw.has_rooms === true || raw.has_rooms === 'true',
    is_canopy: raw.is_canopy === true || raw.is_canopy === 'true',
    is_inferred_name: raw.is_inferred_name === true || raw.is_inferred_name === 'true',
  };
}

function toFacultyProps(raw: Record<string, unknown>): FacultyProps {
  const zk = String(raw.zone_kind ?? '') as FacultyProps['zone_kind'];
  return {
    id: String(raw.id ?? ''),
    code: String(raw.code ?? ''),
    name: String(raw.name ?? ''),
    name_ms: String(raw.name_ms ?? ''),
    category: String(raw.category ?? ''),
    zone_kind: zk || undefined,
    color: String(raw.color ?? '#2f5bb7'),
    website: String(raw.website ?? ''),
    center: parseProp<[number, number]>(raw.center, UM_DEFAULT_CENTER),
    zoom: Number(raw.zoom ?? 17.2),
    pitch: Number(raw.pitch ?? 54),
    bearing: Number(raw.bearing ?? -16),
    description: String(raw.description ?? ''),
    osm_ref: String(raw.osm_ref ?? ''),
  };
}

function toRoomProps(raw: Record<string, unknown>): RoomProps {
  return {
    id: String(raw.id ?? ''),
    code: String(raw.code ?? ''),
    name: String(raw.name ?? ''),
    building_id: String(raw.building_id ?? ''),
    building_name: String(raw.building_name ?? ''),
    faculty_id: String(raw.faculty_id ?? ''),
    floor: Number(raw.floor ?? 0),
    floor_label: String(raw.floor_label ?? 'Ground (G)'),
    base_height: Number(raw.base_height ?? 0.15),
    height: Number(raw.height ?? 3.6),
    room_type: String(raw.room_type ?? 'room'),
    capacity: Number(raw.capacity ?? 30),
    center: parseProp<[number, number]>(raw.center, UM_DEFAULT_CENTER),
    source: String(raw.source ?? ''),
    osm_verified: raw.osm_verified === true || raw.osm_verified === 'true',
  };
}

export function UmMapCanvas(props: UmMapCanvasProps) {
  const {
    boundary,
    faculties,
    buildings,
    rooms,
    context,
    transitGeoJson,
    activeFaculty,
    activeBuilding,
    activeRoom,
    activeFloor,
    xrayEnabled,
    is3D,
    visibility,
    route,
    originCoord,
    destCoord,
    pickTarget,
    cameraCmd,
    liveNavActive,
    liveNavCoord,
    liveNavHeading,
    liveNavFollow,
  } = props;

  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const readyRef = useRef(false);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const originMarkerRef = useRef<maplibregl.Marker | null>(null);
  const destMarkerRef = useRef<maplibregl.Marker | null>(null);
  const liveNavMarkerRef = useRef<maplibregl.Marker | null>(null);
  const coneElRef = useRef<HTMLDivElement | null>(null);

  // Latest state & callbacks in refs so MapLibre event listeners always read fresh values
  const latestRef = useRef(props);
  latestRef.current = props;

  const routeGeoJson = useMemo<GeoJSON.FeatureCollection>(() => {
    if (!route || route.segments.length === 0) {
      return { type: 'FeatureCollection', features: [] };
    }
    return {
      type: 'FeatureCollection',
      features: route.segments.map((seg, idx) => ({
        type: 'Feature',
        properties: {
          idx,
          kind: seg.kind,
          color: seg.color ?? '',
          routeCode: seg.routeCode ?? '',
        },
        geometry: {
          type: 'LineString',
          coordinates: seg.coordinates,
        },
      })),
    };
  }, [route]);

  // Initialize MapLibre instance
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    let styleLoaded = false;

    const map = new maplibregl.Map({
      container: el,
      style: 'https://tiles.openfreemap.org/styles/positron',
      center: UM_DEFAULT_CENTER,
      zoom: 15.1,
      pitch: 50,
      bearing: -16,
      maxPitch: 76,
      minZoom: 13.4,
      maxZoom: 21,
      attributionControl: false,
    });

    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-right');
    map.addControl(new maplibregl.ScaleControl({ maxWidth: 110, unit: 'metric' }), 'bottom-left');

    const hoverPopup = new maplibregl.Popup({
      closeButton: false,
      closeOnClick: false,
      offset: 12,
    });
    popupRef.current = hoverPopup;

    // Fallback to clean futuristic canvas if external vector style stalls or fails
    const fallbackTimer = window.setTimeout(() => {
      if (!styleLoaded) {
        map.setStyle(FALLBACK_LIGHT_STYLE);
      }
    }, 4500);

    map.on('error', () => {
      if (!styleLoaded) {
        map.setStyle(FALLBACK_LIGHT_STYLE);
      }
    });

    const installCustomLayers = () => {
      styleLoaded = true;
      window.clearTimeout(fallbackTimer);

      if (map.getSource('um-boundary')) return;

      const cur = latestRef.current;

      // Remove OpenFreeMap Positron's flat 2D building footprint layer so 3D UM extrusions never z-fight
      for (const layerId of ['building', 'building-3d', 'building_3d']) {
        if (map.getLayer(layerId)) {
          map.setLayoutProperty(layerId, 'visibility', 'none');
        }
      }

      map.setLight({
        anchor: 'viewport',
        color: '#ffffff',
        intensity: 0.3,
        position: [1.4, 110, 50],
      });

      map.addSource('um-boundary', { type: 'geojson', data: cur.boundary });
      map.addSource('um-parks', { type: 'geojson', data: cur.context.parks });
      map.addSource('um-water', { type: 'geojson', data: cur.context.water });
      map.addSource('um-faculties', { type: 'geojson', data: cur.faculties });
      map.addSource('um-roads', { type: 'geojson', data: cur.context.roads });
      map.addSource('um-transit', { type: 'geojson', data: cur.transitGeoJson });
      map.addSource('um-buildings', { type: 'geojson', data: cur.buildings });
      map.addSource('um-rooms', { type: 'geojson', data: cur.rooms });
      map.addSource('um-pois', { type: 'geojson', data: cur.context.pois });
      map.addSource('um-route', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });

      // 1. Outer campus dimming mask
      map.addLayer({
        id: 'um-outer-mask',
        type: 'fill',
        source: 'um-boundary',
        filter: ['==', ['get', 'kind'], 'mask'],
        paint: {
          'fill-color': '#e9edf6',
          'fill-opacity': 0.5,
        },
      });

      // 2. Parks & green spaces
      map.addLayer({
        id: 'um-parks-fill',
        type: 'fill',
        source: 'um-parks',
        paint: {
          'fill-color': [
            'match',
            ['get', 'kind'],
            'pitch',
            '#dbeadf',
            'track',
            '#f0e4d6',
            '#e4efe6',
          ],
          'fill-opacity': 0.7,
        },
      });

      // 3. Water bodies (Tasik Varsiti & Pantai River)
      map.addLayer({
        id: 'um-water-fill',
        type: 'fill',
        source: 'um-water',
        paint: {
          'fill-color': '#d8e7f7',
          'fill-opacity': 0.9,
          'fill-outline-color': '#b9d1ea',
        },
      });

      // 4. Faculty zones
      map.addLayer({
        id: 'um-faculties-fill',
        type: 'fill',
        source: 'um-faculties',
        paint: {
          'fill-color': ZONE_COLOR_EXPR,
          'fill-opacity': 0.09,
        },
      });

      map.addLayer({
        id: 'um-faculties-outline',
        type: 'line',
        source: 'um-faculties',
        paint: {
          'line-color': ZONE_COLOR_EXPR,
          'line-width': 1.2,
          'line-opacity': 0.45,
          'line-dasharray': [4, 3],
        },
      });

      map.addLayer({
        id: 'um-faculties-selected-fill',
        type: 'fill',
        source: 'um-faculties',
        filter: ['==', ['get', 'id'], '__none__'],
        paint: {
          'fill-color': ZONE_COLOR_EXPR,
          'fill-opacity': 0.2,
        },
      });

      map.addLayer({
        id: 'um-faculties-selected',
        type: 'line',
        source: 'um-faculties',
        filter: ['==', ['get', 'id'], '__none__'],
        paint: {
          'line-color': ZONE_COLOR_EXPR,
          'line-width': 2.6,
          'line-opacity': 0.95,
        },
      });

      // 5. Campus roads (high contrast highlighted arteries)
      map.addLayer({
        id: 'um-roads-casing',
        type: 'line',
        source: 'um-roads',
        filter: ['==', ['get', 'kind'], 'road'],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#c7ccd9',
          'line-width': ['interpolate', ['linear'], ['zoom'], 14, 3.2, 17.5, 9],
          'line-opacity': 0.8,
        },
      });

      map.addLayer({
        id: 'um-roads-line',
        type: 'line',
        source: 'um-roads',
        filter: ['==', ['get', 'kind'], 'road'],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#ffffff',
          'line-width': ['interpolate', ['linear'], ['zoom'], 14, 2, 17.5, 6.2],
        },
      });

      // 6. Footpaths, covered shortcuts & stairs
      map.addLayer({
        id: 'um-footways-line',
        type: 'line',
        source: 'um-roads',
        filter: ['==', ['get', 'kind'], 'footway'],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#7f97b8',
          'line-width': ['interpolate', ['linear'], ['zoom'], 14, 1.1, 18, 2.8],
          'line-opacity': 0.75,
          'line-dasharray': [2, 2],
        },
      });

      map.addLayer({
        id: 'um-shortcuts-glow',
        type: 'line',
        source: 'um-roads',
        filter: ['==', ['get', 'kind'], 'shortcut'],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#a9c3d4',
          'line-width': ['interpolate', ['linear'], ['zoom'], 14, 4, 18, 8],
          'line-opacity': 0.3,
        },
      });

      map.addLayer({
        id: 'um-shortcuts-line',
        type: 'line',
        source: 'um-roads',
        filter: ['==', ['get', 'kind'], 'shortcut'],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#4f8fa8',
          'line-width': ['interpolate', ['linear'], ['zoom'], 14, 1.8, 18, 3.5],
          'line-opacity': 0.9,
        },
      });

      map.addLayer({
        id: 'um-steps-line',
        type: 'line',
        source: 'um-roads',
        filter: ['==', ['get', 'kind'], 'steps'],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#c08a3e',
          'line-width': ['interpolate', ['linear'], ['zoom'], 14, 1.6, 18, 3.4],
          'line-dasharray': [1, 1.2],
        },
      });

      // 6b. Transit routes (RapidKL T789, T815 & UM Shuttles AB/BA/C/D/E)
      map.addLayer({
        id: 'um-transit-casing',
        type: 'line',
        source: 'um-transit',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#ffffff',
          'line-width': ['interpolate', ['linear'], ['zoom'], 14, 3.4, 18, 6.2],
          'line-opacity': 0.72,
        },
      });

      map.addLayer({
        id: 'um-transit-line',
        type: 'line',
        source: 'um-transit',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': ['coalesce', ['get', 'color'], '#24439c'],
          'line-width': ['interpolate', ['linear'], ['zoom'], 14, 2, 18, 3.8],
          'line-opacity': 0.7,
        },
      });

      // 7. True UM Administrative Boundary (clean Royal Navy campus border)
      map.addLayer({
        id: 'um-boundary-glow',
        type: 'line',
        source: 'um-boundary',
        filter: ['==', ['get', 'id'], 'um-boundary'],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#b7c5f0',
          'line-width': 7,
          'line-blur': 3,
          'line-opacity': 0.4,
        },
      });

      map.addLayer({
        id: 'um-boundary-line',
        type: 'line',
        source: 'um-boundary',
        filter: ['==', ['get', 'id'], 'um-boundary'],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#24439c',
          'line-width': 2.2,
          'line-opacity': 0.9,
        },
      });

      // 8. 3D Buildings & Crisp Footprints (+ Selected Area Building Outlines)
      map.addLayer({
        id: 'um-buildings-outline',
        type: 'line',
        source: 'um-buildings',
        filter: ['!=', ['get', 'is_canopy'], true],
        paint: {
          'line-color': '#d5dae6',
          'line-width': 0.8,
          'line-opacity': 0.9,
        },
      });

      map.addLayer({
        id: 'um-faculty-buildings-outline-glow',
        type: 'line',
        source: 'um-buildings',
        filter: ['all', ['==', ['get', 'faculty_id'], '__none__'], ['!=', ['get', 'is_canopy'], true]],
        paint: {
          'line-color': '#ffffff',
          'line-width': 5,
          'line-opacity': 0.9,
        },
      });

      map.addLayer({
        id: 'um-faculty-buildings-outline',
        type: 'line',
        source: 'um-buildings',
        filter: ['all', ['==', ['get', 'faculty_id'], '__none__'], ['!=', ['get', 'is_canopy'], true]],
        paint: {
          'line-color': '#2f5bb7',
          'line-width': 2,
          'line-opacity': 0.95,
        },
      });

      map.addLayer({
        id: 'um-buildings-3d',
        type: 'fill-extrusion',
        source: 'um-buildings',
        filter: ['all', ['!=', ['get', 'id'], '__none__'], ['!=', ['get', 'is_canopy'], true]],
        paint: {
          'fill-extrusion-base': 0,
          'fill-extrusion-height': ['get', 'height'],
          'fill-extrusion-color': [
            'case',
            ['==', ['get', 'has_rooms'], true],
            '#fbfcff',
            '#eef1f8',
          ],
          'fill-extrusion-opacity': 0.96,
          'fill-extrusion-vertical-gradient': true,
        },
      });

      map.addLayer({
        id: 'um-canopies-3d',
        type: 'fill-extrusion',
        source: 'um-buildings',
        filter: ['==', ['get', 'is_canopy'], true],
        paint: {
          'fill-extrusion-base': 2.2,
          'fill-extrusion-height': 2.7,
          'fill-extrusion-color': '#d7dcea',
          'fill-extrusion-opacity': 0.4,
        },
      });

      // Focused building outer shell (supports X-Ray glass mode to reveal 3D rooms inside)
      map.addLayer({
        id: 'um-building-focus-shell',
        type: 'fill-extrusion',
        source: 'um-buildings',
        filter: ['==', ['get', 'id'], '__none__'],
        paint: {
          'fill-extrusion-base': 0,
          'fill-extrusion-height': ['get', 'height'],
          'fill-extrusion-color': '#24439c',
          'fill-extrusion-opacity': 0.2,
          'fill-extrusion-vertical-gradient': true,
        },
      });

      map.addLayer({
        id: 'um-building-focus-outline',
        type: 'line',
        source: 'um-buildings',
        filter: ['==', ['get', 'id'], '__none__'],
        paint: {
          'line-color': '#24439c',
          'line-width': 2.2,
          'line-opacity': 0.95,
        },
      });

      // 9. 3D Indoor Rooms
      map.addLayer({
        id: 'um-rooms-3d',
        type: 'fill-extrusion',
        source: 'um-rooms',
        filter: ['==', ['get', 'building_id'], '__none__'],
        paint: {
          'fill-extrusion-base': ['get', 'base_height'],
          'fill-extrusion-height': ['+', ['get', 'base_height'], ['get', 'height']],
          'fill-extrusion-color': [
            'match',
            ['get', 'room_type'],
            'lecture_hall',
            '#2f5bb7',
            'lab',
            '#2f7d74',
            'library',
            '#5468b8',
            'auditorium',
            '#7a5a8e',
            'tutorial',
            '#4f8fa8',
            'office',
            '#6a7080',
            '#8a93a8',
          ],
          'fill-extrusion-opacity': 0.94,
          'fill-extrusion-vertical-gradient': true,
        },
      });

      // Highlighted selected room
      map.addLayer({
        id: 'um-room-selected-3d',
        type: 'fill-extrusion',
        source: 'um-rooms',
        filter: ['==', ['get', 'id'], '__none__'],
        paint: {
          'fill-extrusion-base': ['get', 'base_height'],
          'fill-extrusion-height': ['+', ['get', 'base_height'], ['+', ['get', 'height'], 0.35]],
          'fill-extrusion-color': '#c98a3a',
          'fill-extrusion-opacity': 0.98,
        },
      });

      // 10. Wayfinding Active Route Layers
      map.addLayer({
        id: 'um-route-casing',
        type: 'line',
        source: 'um-route',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#ffffff',
          'line-width': 10,
          'line-opacity': 0.94,
        },
      });

      map.addLayer({
        id: 'um-route-line',
        type: 'line',
        source: 'um-route',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': [
            'match',
            ['get', 'kind'],
            'bus',
            ['case', ['!=', ['get', 'color'], ''], ['get', 'color'], '#24439c'],
            'shortcut',
            '#0c6a5e',
            'steps',
            '#b07a2e',
            'indoor',
            '#5c6fa8',
            '#24439c',
          ],
          'line-width': 5.2,
          'line-opacity': 0.98,
        },
      });

      // 11. MRT/LRT Stations, Bus Stops & Campus Gates
      map.addLayer({
        id: 'um-pois-circle',
        type: 'circle',
        source: 'um-pois',
        paint: {
          'circle-radius': [
            'match',
            ['get', 'kind'],
            'rail_station',
            ['interpolate', ['linear'], ['zoom'], 13.5, 5.5, 17.5, 8.5],
            ['interpolate', ['linear'], ['zoom'], 14, 2.8, 18, 4.4],
          ],
          'circle-color': '#ffffff',
          'circle-stroke-color': [
            'match',
            ['get', 'kind'],
            'rail_station',
            '#0c6a5e',
            'gate',
            '#3a4a72',
            '#24439c',
          ],
          'circle-stroke-width': [
            'match',
            ['get', 'kind'],
            'rail_station',
            2.6,
            1.8,
          ],
        },
      });

      // 12. Crisp Pressable Labels (Zones, KKs, Institutes, Buildings, Transit POIs, Focused Rooms)
      map.addLayer({
        id: 'um-faculties-label',
        type: 'symbol',
        source: 'um-faculties',
        minzoom: 13.0,
        maxzoom: 17.8,
        layout: {
          'text-field': [
            'case',
            ['!=', ['coalesce', ['get', 'short_label'], ''], ''],
            ['get', 'short_label'],
            ['get', 'code'],
          ],
          'text-size': ['interpolate', ['linear'], ['zoom'], 13.5, 11.5, 16.5, 13.5],
          'text-font': ['Noto Sans Bold'],
          'text-max-width': 12,
          'text-padding': 12,
          'text-allow-overlap': false,
        },
        paint: {
          'text-color': '#14224f',
          'text-halo-color': 'rgba(250, 251, 255, 0.98)',
          'text-halo-width': 3.4,
          'text-halo-blur': 0.4,
        },
      });

      map.addLayer({
        id: 'um-buildings-label',
        type: 'symbol',
        source: 'um-buildings',
        minzoom: 16.8,
        filter: [
          'all',
          ['!=', ['get', 'is_canopy'], true],
          ['!=', ['get', 'is_inferred_name'], true],
          ['!=', ['get', 'category'], 'shelter'],
          ['!=', ['get', 'category'], 'parking'],
          ['!=', ['get', 'name'], ''],
        ],
        layout: {
          'text-field': ['get', 'name'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 16.8, 9.8, 18.5, 11.5],
          'text-max-width': 11,
          'text-padding': 12,
          'text-font': ['Noto Sans Bold'],
          'text-allow-overlap': false,
        },
        paint: {
          'text-color': '#474b56',
          'text-halo-color': 'rgba(250, 251, 255, 0.96)',
          'text-halo-width': 1.8,
        },
      });

      map.addLayer({
        id: 'um-pois-label',
        type: 'symbol',
        source: 'um-pois',
        minzoom: 16.2,
        layout: {
          'text-field': ['get', 'name'],
          'text-size': [
            'match',
            ['get', 'kind'],
            'rail_station',
            11,
            'bus_stop',
            9.5,
            10,
          ],
          'text-offset': [0, 1.2],
          'text-anchor': 'top',
          'text-padding': 8,
          'text-font': ['Noto Sans Bold'],
          'text-allow-overlap': false,
        },
        paint: {
          'text-color': [
            'match',
            ['get', 'kind'],
            'rail_station',
            '#0c6a5e',
            'bus_stop',
            '#24439c',
            '#3a3f4a',
          ],
          'text-halo-color': 'rgba(255,255,255,0.98)',
          'text-halo-width': 2.6,
        },
      });

      map.addLayer({
        id: 'um-rooms-label',
        type: 'symbol',
        source: 'um-rooms',
        filter: ['==', ['get', 'building_id'], '__none__'],
        minzoom: 17.5,
        layout: {
          'text-field': ['get', 'name'],
          'text-size': 10.5,
          'text-max-width': 10,
          'text-font': ['Noto Sans Bold'],
          'text-allow-overlap': false,
        },
        paint: {
          'text-color': '#1b2a4a',
          'text-halo-color': 'rgba(255,255,255,0.96)',
          'text-halo-width': 2,
        },
      });

      readyRef.current = true;
      syncAllDynamicState();
    };

    const syncAllDynamicState = () => {
      if (!readyRef.current) return;
      const cur = latestRef.current;

      // Update building & room highlights/filters
      const bId = cur.activeBuilding?.id ?? '__none__';
      const hasRooms = Boolean(cur.activeBuilding?.has_rooms);
      const useXray = hasRooms && cur.xrayEnabled;

      if (map.getLayer('um-buildings-3d')) {
        map.setFilter('um-buildings-3d', ['all', ['!=', ['get', 'id'], bId], ['!=', ['get', 'is_canopy'], true]]);
        map.setPaintProperty(
          'um-buildings-3d',
          'fill-extrusion-color',
          cur.activeFaculty
            ? [
                'case',
                ['==', ['get', 'faculty_id'], cur.activeFaculty.id],
                '#2f5bb7',
                '#e6eaf3',
              ]
            : ['case', ['==', ['get', 'has_rooms'], true], '#fbfcff', '#eef1f8'],
        );
        map.setPaintProperty(
          'um-buildings-3d',
          'fill-extrusion-opacity',
          cur.activeBuilding ? 0.45 : cur.activeFaculty ? 0.78 : 0.94,
        );
      }

      if (map.getLayer('um-building-focus-shell')) {
        map.setFilter('um-building-focus-shell', ['==', ['get', 'id'], bId]);
        map.setPaintProperty('um-building-focus-shell', 'fill-extrusion-opacity', useXray ? 0.16 : 0.92);
        map.setPaintProperty(
          'um-building-focus-shell',
          'fill-extrusion-color',
          useXray ? '#c3d4f4' : '#24439c',
        );
      }

      if (map.getLayer('um-building-focus-outline')) {
        map.setFilter('um-building-focus-outline', ['==', ['get', 'id'], bId]);
      }

      if (map.getLayer('um-faculties-selected-fill')) {
        map.setFilter(
          'um-faculties-selected-fill',
          ['==', ['get', 'id'], cur.activeFaculty?.id ?? '__none__'],
        );
      }

      if (map.getLayer('um-faculties-selected')) {
        map.setFilter(
          'um-faculties-selected',
          ['==', ['get', 'id'], cur.activeFaculty?.id ?? '__none__'],
        );
      }

      const facBldgFilter: maplibregl.FilterSpecification = [
        'all',
        ['==', ['get', 'faculty_id'], cur.activeFaculty?.id ?? '__none__'],
        ['!=', ['get', 'is_canopy'], true],
      ];
      if (map.getLayer('um-faculty-buildings-outline-glow')) {
        map.setFilter('um-faculty-buildings-outline-glow', facBldgFilter);
      }
      if (map.getLayer('um-faculty-buildings-outline')) {
        map.setFilter('um-faculty-buildings-outline', facBldgFilter);
        map.setPaintProperty(
          'um-faculty-buildings-outline',
          'line-color',
          zoneAccent(cur.activeFaculty?.zone_kind),
        );
      }

      const roomFilter: maplibregl.FilterSpecification =
        cur.activeBuilding && cur.activeFloor !== 'all'
          ? ['all', ['==', ['get', 'building_id'], bId], ['==', ['get', 'floor'], cur.activeFloor]]
          : ['==', ['get', 'building_id'], bId];

      if (map.getLayer('um-rooms-3d')) {
        map.setFilter('um-rooms-3d', roomFilter);
      }
      if (map.getLayer('um-rooms-label')) {
        map.setFilter('um-rooms-label', roomFilter);
      }
      if (map.getLayer('um-room-selected-3d')) {
        map.setFilter('um-room-selected-3d', ['==', ['get', 'id'], cur.activeRoom?.id ?? '__none__']);
      }

      // Layer visibility toggles
      const setVis = (ids: string[], on: boolean) => {
        for (const id of ids) {
          if (map.getLayer(id)) {
            map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
          }
        }
      };
      setVis(['um-boundary-line', 'um-boundary-glow', 'um-outer-mask'], cur.visibility.boundary);
      setVis(['um-faculties-fill', 'um-faculties-outline', 'um-faculties-selected-fill', 'um-faculties-selected'], cur.visibility.faculties);
      setVis(['um-roads-casing', 'um-roads-line'], cur.visibility.roads);
      setVis(['um-footways-line', 'um-shortcuts-glow', 'um-shortcuts-line', 'um-steps-line'], cur.visibility.pathways);
      setVis(['um-transit-casing', 'um-transit-line'], cur.visibility.busRoutes);
      setVis(
        ['um-buildings-outline', 'um-faculty-buildings-outline-glow', 'um-faculty-buildings-outline', 'um-buildings-3d', 'um-canopies-3d', 'um-building-focus-shell', 'um-building-focus-outline', 'um-rooms-3d', 'um-room-selected-3d'],
        cur.visibility.buildings3d,
      );
      setVis(['um-pois-circle'], cur.visibility.pois);
      setVis(['um-faculties-label', 'um-buildings-label', 'um-pois-label', 'um-rooms-label'], cur.visibility.labels);
    };

    map.on('style.load', installCustomLayers);

    // Pause camera auto-follow if the user drags or scrolls manually during live navigation
    map.on('dragstart', (e) => {
      if (e.originalEvent && latestRef.current.liveNavActive) {
        latestRef.current.onUserMapDrag();
      }
    });
    map.on('wheel', (e) => {
      if (e.originalEvent && latestRef.current.liveNavActive) {
        latestRef.current.onUserMapDrag();
      }
    });

    // Interactive cursor + lightweight hover tooltip (including clickable text labels)
    const hoverTargets = [
      'um-rooms-3d',
      'um-pois-label',
      'um-pois-circle',
      'um-faculties-label',
      'um-buildings-label',
      'um-buildings-3d',
      'um-building-focus-shell',
      'um-faculties-fill',
    ];
    map.on('mousemove', (e) => {
      if (!readyRef.current) return;
      if (latestRef.current.pickTarget) {
        map.getCanvas().style.cursor = 'crosshair';
        hoverPopup.remove();
        return;
      }

      const activeTargets = hoverTargets.filter((id) => Boolean(map.getLayer(id)));
      const feats = map.queryRenderedFeatures(e.point, { layers: activeTargets });
      if (!feats.length) {
        map.getCanvas().style.cursor = '';
        hoverPopup.remove();
        return;
      }
      map.getCanvas().style.cursor = 'pointer';

      const f = feats[0] as MapGeoJSONFeature;
      const p = (f.properties ?? {}) as Record<string, unknown>;
      const title = String(p.name ?? '');
      let html = '';
      if (f.layer.id === 'um-rooms-3d') {
        html = `
          <div class="map-tip__title">${title}</div>
          <div class="map-tip__meta">${String(p.floor_label ?? '')} · ${String(p.room_type ?? 'room').replace('_', ' ')}</div>
          <div class="map-tip__meta">${String(p.building_name ?? '')}</div>
        `;
      } else if (f.layer.id === 'um-buildings-3d' || f.layer.id === 'um-building-focus-shell' || f.layer.id === 'um-buildings-label') {
        const hasRooms = p.has_rooms === true || p.has_rooms === 'true';
        html = `
          <div style="display:flex;align-items:center;gap:7px;margin-bottom:5px">
            <span class="map-tip__tag" style="margin:0">${String(p.faculty_id ?? 'UM')}</span>
            <span class="map-tip__meta" style="margin:0">${Number(p.levels ?? 1)} levels</span>
          </div>
          <div class="map-tip__title">${title}</div>
          ${hasRooms ? '<div class="map-tip__meta">Indoor rooms available</div>' : ''}
        `;
      } else if (f.layer.id === 'um-pois-circle' || f.layer.id === 'um-pois-label') {
        if (p.kind === 'bus_stop') {
          html = `
            <div class="map-tip__tag">Bus stop</div>
            <div class="map-tip__title">${title}</div>
            <div class="map-tip__meta">Routes: ${p.routes || 'T789, T815, RapidKL and UM shuttle'}</div>
            <div class="map-tip__meta">Every 10–15 min at peak · Step-free boarding</div>
          `;
        } else if (p.kind === 'rail_station') {
          html = `
            <div class="map-tip__tag">Transit station</div>
            <div class="map-tip__title">${title}</div>
            <div class="map-tip__meta">${String(p.line ?? 'Klang Valley line')} · feeder buses T789 and T815</div>
          `;
        } else if (p.kind === 'gate') {
          html = `
            <div class="map-tip__tag">Campus gate</div>
            <div class="map-tip__title">${title}</div>
          `;
        } else {
          html = `<div class="map-tip__title">${title}</div>`;
        }
      } else if (f.layer.id === 'um-faculties-fill' || f.layer.id === 'um-faculties-label') {
        const zk = String(p.zone_kind ?? '');
        const kindLabel =
          zk === 'college'
            ? 'Residential college'
            : zk === 'institute'
              ? 'Research institute'
              : zk === 'medical'
                ? 'Medical centre'
                : 'Faculty';
        html = `
          <div style="display:flex;align-items:center;gap:7px;margin-bottom:5px">
            <span class="map-tip__tag" style="margin:0">${String(p.code ?? 'ZONE')}</span>
            <span class="map-tip__meta" style="margin:0">${kindLabel}</span>
          </div>
          <div class="map-tip__title">${title}</div>
          <div class="map-tip__meta">Select to highlight its buildings</div>
        `;
      }

      hoverPopup
        .setLngLat(e.lngLat)
        .setHTML(`<div style="padding:1px 3px">${html || `<div class="map-tip__title">${title}</div>`}</div>`)
        .addTo(map);
    });

    map.on('mouseleave', () => {
      hoverPopup.remove();
    });

    // Click selection handler (names & 3D volumes both pressable)
    map.on('click', (e) => {
      if (!readyRef.current) return;
      const cur = latestRef.current;

      if (cur.pickTarget) {
        const clickable = ['um-rooms-3d', 'um-buildings-3d', 'um-building-focus-shell', 'um-pois-circle', 'um-pois-label', 'um-buildings-label'].filter((id) =>
          Boolean(map.getLayer(id)),
        );
        const hits = map.queryRenderedFeatures(e.point, { layers: clickable });
        const hitName = hits.length > 0 ? String((hits[0].properties as Record<string, unknown>)?.name ?? '') : '';
        cur.onPickCoordinate([e.lngLat.lng, e.lngLat.lat], hitName || undefined);
        return;
      }

      const priorityLayers = [
        'um-rooms-3d',
        'um-pois-label',
        'um-pois-circle',
        'um-faculties-label',
        'um-buildings-label',
        'um-buildings-3d',
        'um-building-focus-shell',
        'um-faculties-fill',
      ].filter((id) => Boolean(map.getLayer(id)));

      const feats = map.queryRenderedFeatures(e.point, { layers: priorityLayers });
      if (!feats.length) return;

      const top = feats[0] as MapGeoJSONFeature;
      const raw = (top.properties ?? {}) as Record<string, unknown>;

      if (top.layer.id === 'um-rooms-3d') {
        cur.onSelectRoom(toRoomProps(raw));
      } else if (top.layer.id === 'um-buildings-3d' || top.layer.id === 'um-building-focus-shell' || top.layer.id === 'um-buildings-label') {
        cur.onSelectBuilding(toBuildingProps(raw));
      } else if (top.layer.id === 'um-pois-circle' || top.layer.id === 'um-pois-label') {
        cur.onSelectPoi(String(raw.id ?? ''));
      } else if (top.layer.id === 'um-faculties-fill' || top.layer.id === 'um-faculties-label') {
        cur.onSelectFaculty(toFacultyProps(raw));
      }
    });

    return () => {
      window.clearTimeout(fallbackTimer);
      originMarkerRef.current?.remove();
      destMarkerRef.current?.remove();
      liveNavMarkerRef.current?.remove();
      hoverPopup.remove();
      map.remove();
      mapRef.current = null;
      readyRef.current = false;
    };
  }, []);

  // Sync dynamic filters, paints & visibility whenever React state changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;

    const bId = activeBuilding?.id ?? '__none__';
    const useXray = Boolean(activeBuilding?.has_rooms && xrayEnabled);

    if (map.getLayer('um-buildings-3d')) {
      map.setFilter('um-buildings-3d', ['all', ['!=', ['get', 'id'], bId], ['!=', ['get', 'is_canopy'], true]]);
      map.setPaintProperty(
        'um-buildings-3d',
        'fill-extrusion-color',
        activeFaculty
          ? [
              'case',
              ['==', ['get', 'faculty_id'], activeFaculty.id],
              '#2f5bb7',
              '#e6eaf3',
            ]
          : ['case', ['==', ['get', 'has_rooms'], true], '#fbfcff', '#eef1f8'],
      );
      map.setPaintProperty(
        'um-buildings-3d',
        'fill-extrusion-opacity',
        activeBuilding ? 0.45 : activeFaculty ? 0.78 : 0.94,
      );
    }

    if (map.getLayer('um-building-focus-shell')) {
      map.setFilter('um-building-focus-shell', ['==', ['get', 'id'], bId]);
      map.setPaintProperty('um-building-focus-shell', 'fill-extrusion-opacity', useXray ? 0.16 : 0.92);
      map.setPaintProperty(
        'um-building-focus-shell',
        'fill-extrusion-color',
        useXray ? '#c3d4f4' : '#24439c',
      );
    }

    if (map.getLayer('um-building-focus-outline')) {
      map.setFilter('um-building-focus-outline', ['==', ['get', 'id'], bId]);
    }

    if (map.getLayer('um-faculties-selected-fill')) {
      map.setFilter('um-faculties-selected-fill', ['==', ['get', 'id'], activeFaculty?.id ?? '__none__']);
    }

    if (map.getLayer('um-faculties-selected')) {
      map.setFilter('um-faculties-selected', ['==', ['get', 'id'], activeFaculty?.id ?? '__none__']);
    }

    const facBldgFilter: maplibregl.FilterSpecification = [
      'all',
      ['==', ['get', 'faculty_id'], activeFaculty?.id ?? '__none__'],
      ['!=', ['get', 'is_canopy'], true],
    ];
    if (map.getLayer('um-faculty-buildings-outline-glow')) {
      map.setFilter('um-faculty-buildings-outline-glow', facBldgFilter);
    }
    if (map.getLayer('um-faculty-buildings-outline')) {
      map.setFilter('um-faculty-buildings-outline', facBldgFilter);
      map.setPaintProperty(
        'um-faculty-buildings-outline',
        'line-color',
        zoneAccent(activeFaculty?.zone_kind),
      );
    }

    const roomFilter: maplibregl.FilterSpecification =
      activeBuilding && activeFloor !== 'all'
        ? ['all', ['==', ['get', 'building_id'], bId], ['==', ['get', 'floor'], activeFloor]]
        : ['==', ['get', 'building_id'], bId];

    if (map.getLayer('um-rooms-3d')) map.setFilter('um-rooms-3d', roomFilter);
    if (map.getLayer('um-rooms-label')) map.setFilter('um-rooms-label', roomFilter);
    if (map.getLayer('um-room-selected-3d')) {
      map.setFilter('um-room-selected-3d', ['==', ['get', 'id'], activeRoom?.id ?? '__none__']);
    }

    const setVis = (ids: string[], on: boolean) => {
      for (const id of ids) {
        if (map.getLayer(id)) {
          map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
        }
      }
    };
    setVis(['um-boundary-line', 'um-boundary-glow', 'um-outer-mask'], visibility.boundary);
    setVis(['um-faculties-fill', 'um-faculties-outline', 'um-faculties-selected-fill', 'um-faculties-selected'], visibility.faculties);
    setVis(['um-roads-casing', 'um-roads-line'], visibility.roads);
    setVis(['um-footways-line', 'um-shortcuts-glow', 'um-shortcuts-line', 'um-steps-line'], visibility.pathways);
    setVis(['um-transit-casing', 'um-transit-line'], visibility.busRoutes);
    setVis(
      ['um-buildings-outline', 'um-faculty-buildings-outline-glow', 'um-faculty-buildings-outline', 'um-buildings-3d', 'um-canopies-3d', 'um-building-focus-shell', 'um-building-focus-outline', 'um-rooms-3d', 'um-room-selected-3d'],
      visibility.buildings3d,
    );
    setVis(['um-pois-circle'], visibility.pois);
    setVis(['um-faculties-label', 'um-buildings-label', 'um-pois-label', 'um-rooms-label'], visibility.labels);
  }, [activeFaculty, activeBuilding, activeRoom, activeFloor, xrayEnabled, visibility]);

  // Sync active route line & A/B pins
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;

    const src = map.getSource('um-route') as GeoJSONSource | undefined;
    if (src) {
      src.setData(routeGeoJson);
    }

    originMarkerRef.current?.remove();
    destMarkerRef.current?.remove();
    originMarkerRef.current = null;
    destMarkerRef.current = null;

    const makePin = (letter: 'A' | 'B', bg: string) => {
      const wrap = document.createElement('div');
      wrap.style.cssText =
        `width:26px;height:26px;border-radius:999px;background:${bg};color:#fff;` +
        'font-family:var(--font-sans);font-size:11.5px;font-weight:500;display:grid;place-items:center;' +
        'border:2.5px solid #fff;box-shadow:0 4px 12px rgba(18,26,52,0.28);';
      wrap.textContent = letter;
      return wrap;
    };

    if (originCoord) {
      originMarkerRef.current = new maplibregl.Marker({ element: makePin('A', '#24439c') })
        .setLngLat(originCoord)
        .addTo(map);
    }
    if (destCoord) {
      destMarkerRef.current = new maplibregl.Marker({ element: makePin('B', '#0c6a5e') })
        .setLngLat(destCoord)
        .addTo(map);
    }
  }, [routeGeoJson, originCoord, destCoord]);

  // Respond to explicit 3D/2D pitch toggle
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    map.easeTo({
      pitch: is3D ? 52 : 0,
      bearing: is3D ? map.getBearing() : 0,
      duration: 550,
    });
  }, [is3D]);

  // Execute programmatic camera commands
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !cameraCmd) return;
    if (cameraCmd.bounds) {
      map.fitBounds(cameraCmd.bounds as LngLatBoundsLike, {
        padding: cameraCmd.padding ?? { top: 100, bottom: 90, left: 540, right: 80 },
        pitch: is3D ? (cameraCmd.pitch ?? 48) : 0,
        duration: 950,
        maxZoom: 18.6,
      });
    } else if (cameraCmd.center) {
      map.flyTo({
        center: cameraCmd.center,
        zoom: cameraCmd.zoom ?? 17.5,
        pitch: is3D ? (cameraCmd.pitch ?? 54) : 0,
        bearing: is3D ? (cameraCmd.bearing ?? map.getBearing()) : 0,
        duration: 950,
        essential: true,
      });
    }
  }, [cameraCmd, is3D]);

  // Live Navigation pulsing GPS puck + auto-tilted follow camera
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;

    if (!liveNavActive || !liveNavCoord) {
      liveNavMarkerRef.current?.remove();
      liveNavMarkerRef.current = null;
      coneElRef.current = null;
      return;
    }

    if (!liveNavMarkerRef.current) {
      const wrap = document.createElement('div');
      wrap.className = 'live-nav-puck-wrap';

      const halo = document.createElement('div');
      halo.className = 'live-nav-halo';
      wrap.appendChild(halo);

      const cone = document.createElement('div');
      cone.className = 'live-nav-cone';
      cone.innerHTML =
        '<svg viewBox="0 0 44 44" width="44" height="44"><defs><linearGradient id="umCone" x1="0" y1="1" x2="0" y2="0"><stop offset="0%" stop-color="#24439c" stop-opacity="0.42"/><stop offset="100%" stop-color="#24439c" stop-opacity="0"/></linearGradient></defs><path d="M22 30 L7 4 Q22 -1 37 4 Z" fill="url(#umCone)"/></svg>';
      wrap.appendChild(cone);
      coneElRef.current = cone;

      const puck = document.createElement('div');
      puck.className = 'live-nav-puck';
      wrap.appendChild(puck);

      liveNavMarkerRef.current = new maplibregl.Marker({ element: wrap, anchor: 'center' })
        .setLngLat(liveNavCoord)
        .addTo(map);
    } else {
      liveNavMarkerRef.current.setLngLat(liveNavCoord);
    }

    if (coneElRef.current) {
      const relAngle = liveNavHeading - map.getBearing();
      coneElRef.current.style.transform = `rotate(${relAngle}deg)`;
    }

    if (liveNavFollow) {
      map.easeTo({
        center: liveNavCoord,
        zoom: Math.max(map.getZoom(), 18.4),
        pitch: is3D ? 60 : 0,
        bearing: liveNavHeading,
        duration: 420,
        essential: true,
      });
    }
  }, [liveNavActive, liveNavCoord, liveNavHeading, liveNavFollow, is3D]);

  // Also ensure initial data updates if loaded asynchronously after mount
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    (map.getSource('um-boundary') as GeoJSONSource | undefined)?.setData(boundary);
    (map.getSource('um-faculties') as GeoJSONSource | undefined)?.setData(faculties);
    (map.getSource('um-buildings') as GeoJSONSource | undefined)?.setData(buildings);
    (map.getSource('um-rooms') as GeoJSONSource | undefined)?.setData(rooms);
    (map.getSource('um-roads') as GeoJSONSource | undefined)?.setData(context.roads);
    (map.getSource('um-transit') as GeoJSONSource | undefined)?.setData(transitGeoJson);
    (map.getSource('um-water') as GeoJSONSource | undefined)?.setData(context.water);
    (map.getSource('um-parks') as GeoJSONSource | undefined)?.setData(context.parks);
    (map.getSource('um-pois') as GeoJSONSource | undefined)?.setData(context.pois);
  }, [boundary, faculties, buildings, rooms, context, transitGeoJson]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      {pickTarget && (
        <div className="pick-hint">
          <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 999, background: 'var(--primary)' }} />
          {pickTarget === 'origin' ? 'Select a starting point' : 'Select a destination'}
        </div>
      )}
    </div>
  );
}
