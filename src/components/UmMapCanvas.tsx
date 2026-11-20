import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import maplibregl, {
  type GeoJSONSource,
  type LngLatBoundsLike,
  type MapGeoJSONFeature,
  type StyleSpecification,
} from 'maplibre-gl';
import type {
  BuildingProps,
  ComputedRoute,
  CustomRouteAnchor,
  FacultyProps,
  MapLayerVisibility,
  PickTarget,
  RoomProps,
  RouteWaypoint,
  UserLocation,
} from '../types/map';
import { zoneAccent } from '../theme';
import { extractTurnArrows, projectPointOntoPolyline } from '../utils/routeTools';

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
  joggingRoutes: GeoJSON.FeatureCollection;
  transitGeoJson: GeoJSON.FeatureCollection;
  activeFaculty: FacultyProps | null;
  activeBuilding: BuildingProps | null;
  activeRoom: RoomProps | null;
  activeFloor: number | 'all';
  xrayEnabled: boolean;
  is3D: boolean;
  darkMode: boolean;
  highlightedTransitId: string | null;
  visibility: MapLayerVisibility;
  userLocation: UserLocation | null;
  route: ComputedRoute | null;
  originCoord: [number, number] | null;
  destCoord: [number, number] | null;
  stopWaypoints?: RouteWaypoint[];
  pickTarget: PickTarget;
  cameraCmd: CameraCommand | null;
  liveNavActive: boolean;
  liveNavCoord: [number, number] | null;
  liveNavHeading: number;
  liveNavFollow: boolean;
  activeTurnStepIndex?: number;
  drawMode?: boolean;
  customAnchors?: CustomRouteAnchor[];
  mapCanvasRef?: MutableRefObject<HTMLCanvasElement | null>;
  onAddDrawAnchor?: (coord: [number, number], labelHint?: string) => void;
  onMoveDrawAnchor?: (id: string, coord: [number, number]) => void;
  onRemoveDrawAnchor?: (id: string) => void;
  onCommitRouteDrag?: (grabCoord: [number, number], dropCoord: [number, number]) => void;
  onUserMapDrag: () => void;
  onSelectFaculty: (f: FacultyProps) => void;
  onSelectBuilding: (b: BuildingProps) => void;
  onSelectRoom: (r: RoomProps) => void;
  onSelectPoi: (id: string) => void;
  onPickCoordinate: (coord: [number, number], labelHint?: string) => void;
  onCenterChange?: (coord: [number, number]) => void;
}

const UM_DEFAULT_CENTER: [number, number] = [101.6538, 3.1209];

const ZONE_FILL_EXPR = ['coalesce', ['get', 'color'], '#e8f0fe'] as unknown as maplibregl.ExpressionSpecification;
const ZONE_ACCENT_EXPR = ['coalesce', ['get', 'accent'], '#1a73e8'] as unknown as maplibregl.ExpressionSpecification;

function createFallbackStyle(darkMode: boolean): StyleSpecification {
  return {
    version: 8,
    name: 'UM Atlas Base',
    glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    sources: {},
    layers: [
      {
        id: 'bg-canvas',
        type: 'background',
        paint: {
          'background-color': darkMode ? '#1f242c' : '#f5f5f3',
        },
      },
    ],
  };
}

/**
 * Generates crisp, high-DPI programmatic Material 3 map marker icons
 * (bus stops, rail stations, campus gates) so transit stops are immediately
 * readable on the 3D map canvas without external image requests.
 */
function registerMapIcons(map: maplibregl.Map) {
  const addBadge = (
    name: string,
    bg: string,
    ring: string,
    size: number,
    drawGlyph: (ctx: CanvasRenderingContext2D, s: number) => void,
  ) => {
    if (map.hasImage(name)) return;
    const scale = 2;
    const px = size * scale;
    const canvas = document.createElement('canvas');
    canvas.width = px;
    canvas.height = px;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.scale(scale, scale);

    // Subtle elevation shadow
    ctx.save();
    ctx.shadowColor = 'rgba(12, 18, 34, 0.28)';
    ctx.shadowBlur = 4;
    ctx.shadowOffsetY = 1.5;

    const r = size / 2 - 2.2;
    const cx = size / 2;
    const cy = size / 2;

    // Rounded badge / circle
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = bg;
    ctx.fill();
    ctx.restore();

    // Crisp outer ring
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.lineWidth = 2;
    ctx.strokeStyle = ring;
    ctx.stroke();

    // Inner glyph
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#ffffff';
    drawGlyph(ctx, size);

    const imgData = ctx.getImageData(0, 0, px, px);
    map.addImage(name, { width: px, height: px, data: imgData.data }, { pixelRatio: scale });
  };

  // Bus stop badge (classic Google Maps blue bus glyph)
  addBadge('icon-bus-stop', '#1a73e8', '#ffffff', 24, (ctx, s) => {
    const cx = s / 2;
    const cy = s / 2;
    ctx.beginPath();
    ctx.roundRect(cx - 4.4, cy - 5.2, 8.8, 9.2, 2);
    ctx.fill();
    ctx.fillStyle = '#1a73e8';
    ctx.beginPath();
    ctx.roundRect(cx - 3.2, cy - 3.6, 6.4, 3.6, 0.8);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx - 2.3, cy + 2.1, 0.9, 0, Math.PI * 2);
    ctx.arc(cx + 2.3, cy + 2.1, 0.9, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(cx - 3.6, cy + 3.8, 1.8, 1.4);
    ctx.fillRect(cx + 1.8, cy + 3.8, 1.8, 1.4);
  });

  // Rail station badge (classic transit green MRT/LRT train icon)
  addBadge('icon-rail-station', '#137333', '#ffffff', 28, (ctx, s) => {
    const cx = s / 2;
    const cy = s / 2;
    ctx.beginPath();
    ctx.roundRect(cx - 4.8, cy - 6.2, 9.6, 10.4, 2.8);
    ctx.fill();
    ctx.fillStyle = '#137333';
    ctx.beginPath();
    ctx.roundRect(cx - 3.4, cy - 4.4, 6.8, 4.2, 1);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx - 2.2, cy + 2.0, 0.95, 0, Math.PI * 2);
    ctx.arc(cx + 2.2, cy + 2.0, 0.95, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx - 3.2, cy + 4.4);
    ctx.lineTo(cx - 4.8, cy + 6.4);
    ctx.moveTo(cx + 3.2, cy + 4.4);
    ctx.lineTo(cx + 4.8, cy + 6.4);
    ctx.stroke();
  });

  // Campus gate badge (neutral charcoal slate)
  addBadge('icon-gate', '#5f6368', '#ffffff', 22, (ctx, s) => {
    const cx = s / 2;
    const cy = s / 2;
    ctx.lineWidth = 1.7;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(cx - 4.2, cy + 3.8);
    ctx.lineTo(cx - 4.2, cy - 1.2);
    ctx.arc(cx, cy - 1.2, 4.2, Math.PI, 0, false);
    ctx.lineTo(cx + 4.2, cy + 3.8);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - 5.2, cy - 3.8);
    ctx.lineTo(cx + 5.2, cy - 3.8);
    ctx.stroke();
  });

  // Directional chevron arrow rendered along active navigation route lines
  if (!map.hasImage('icon-route-arrow')) {
    const scale = 2;
    const size = 16;
    const px = size * scale;
    const canvas = document.createElement('canvas');
    canvas.width = px;
    canvas.height = px;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.scale(scale, scale);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.94)';
      ctx.lineWidth = 2.2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(5.2, 3.6);
      ctx.lineTo(10.6, 8);
      ctx.lineTo(5.2, 12.4);
      ctx.stroke();
      const imgData = ctx.getImageData(0, 0, px, px);
      map.addImage('icon-route-arrow', { width: px, height: px, data: imgData.data }, { pixelRatio: scale });
    }
  }

  // Google Maps-style road-painted turning arrowheads (pointing North / 0° so icon-rotate aligns with bearing)
  const addTurnHead = (name: string, size: number, fill: string, stroke: string) => {
    if (map.hasImage(name)) return;
    const scale = 2;
    const px = size * scale;
    const canvas = document.createElement('canvas');
    canvas.width = px;
    canvas.height = px;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(scale, scale);

    const cx = size / 2;
    ctx.beginPath();
    ctx.moveTo(cx, 2.2);
    ctx.lineTo(size - 3.2, size - 4.2);
    ctx.lineTo(cx, size - 8.2);
    ctx.lineTo(3.2, size - 4.2);
    ctx.closePath();

    ctx.lineJoin = 'round';
    ctx.lineWidth = 3.2;
    ctx.strokeStyle = stroke;
    ctx.stroke();

    ctx.fillStyle = fill;
    ctx.fill();

    const imgData = ctx.getImageData(0, 0, px, px);
    map.addImage(name, { width: px, height: px, data: imgData.data }, { pixelRatio: scale });
  };

  addTurnHead('icon-turn-head', 22, '#ffffff', '#173a70');
  addTurnHead('icon-turn-head-next', 28, '#ffffff', '#0f2d5e');
}

/**
 * Recolors OpenFreeMap Positron base layers in-place to match classic
 * Google Maps Light and Dark cartography with zero reload flicker.
 */
function syncBaseStyleTheme(map: maplibregl.Map, darkMode: boolean) {
  const style = map.getStyle();
  if (!style?.layers) return;

  for (const layer of style.layers) {
    if (layer.id.startsWith('um-')) continue;
    const id = layer.id.toLowerCase();

    try {
      if (layer.type === 'background') {
        map.setPaintProperty(layer.id, 'background-color', darkMode ? '#1f242c' : '#f5f5f3');
      } else if (layer.type === 'fill') {
        if (id.includes('water')) {
          map.setPaintProperty(layer.id, 'fill-color', darkMode ? '#17324d' : '#aadaff');
        } else if (id.includes('park') || id.includes('green') || id.includes('wood') || id.includes('grass') || id.includes('landcover')) {
          map.setPaintProperty(layer.id, 'fill-color', darkMode ? '#1d3328' : '#cde8cc');
        } else if (id.includes('landuse') || id.includes('residential') || id.includes('industrial') || id.includes('commercial')) {
          map.setPaintProperty(layer.id, 'fill-color', darkMode ? '#242a34' : '#eeefee');
        }
      } else if (layer.type === 'line') {
        if (id.includes('water')) {
          map.setPaintProperty(layer.id, 'line-color', darkMode ? '#22486e' : '#99cef8');
        } else if (id.includes('motorway') || id.includes('trunk')) {
          if (id.includes('casing') || id.includes('outline')) {
            map.setPaintProperty(layer.id, 'line-color', darkMode ? '#5c4d2d' : '#eab338');
          } else {
            map.setPaintProperty(layer.id, 'line-color', darkMode ? '#4a3f28' : '#fde293');
          }
        } else if (id.includes('primary')) {
          if (id.includes('casing') || id.includes('outline')) {
            map.setPaintProperty(layer.id, 'line-color', darkMode ? '#252c38' : '#e0c784');
          } else {
            map.setPaintProperty(layer.id, 'line-color', darkMode ? '#373e4c' : '#fef3c7');
          }
        } else if (id.includes('road') || id.includes('highway') || id.includes('street') || id.includes('tunnel') || id.includes('bridge')) {
          if (id.includes('casing') || id.includes('outline')) {
            map.setPaintProperty(layer.id, 'line-color', darkMode ? '#181d26' : '#dadce0');
          } else {
            map.setPaintProperty(layer.id, 'line-color', darkMode ? '#2f3642' : '#ffffff');
          }
        } else if (id.includes('boundary')) {
          map.setPaintProperty(layer.id, 'line-color', darkMode ? '#343c4a' : '#d2d6dc');
        }
      } else if (layer.type === 'symbol') {
        if (id.includes('place') || id.includes('road') || id.includes('water') || id.includes('label') || id.includes('poi')) {
          map.setPaintProperty(layer.id, 'text-color', darkMode ? '#8a92a1' : '#70757a');
          map.setPaintProperty(
            layer.id,
            'text-halo-color',
            darkMode ? 'rgba(31, 36, 44, 0.92)' : 'rgba(245, 245, 243, 0.92)',
          );
        }
      }
    } catch {
      // Ignore layers whose paint spec does not support a given property
    }
  }
}

function accuracyPolygon(center: [number, number], accuracy: number): GeoJSON.FeatureCollection {
  const radius = Math.max(8, Math.min(accuracy > 0 ? accuracy : 25, 400));
  const points = 48;
  const latRadius = radius / 110540;
  const lngRadius = radius / (111320 * Math.cos((center[1] * Math.PI) / 180));
  const ring: [number, number][] = [];
  for (let i = 0; i <= points; i += 1) {
    const angle = (i / points) * Math.PI * 2;
    ring.push([center[0] + Math.cos(angle) * lngRadius, center[1] + Math.sin(angle) * latRadius]);
  }
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {},
        geometry: { type: 'Polygon', coordinates: [ring] },
      },
    ],
  };
}

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
    faculty_color: String(raw.faculty_color ?? '#1a73e8'),
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
    color: String(raw.color ?? '#e3e9fb'),
    accent: raw.accent ? String(raw.accent) : undefined,
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
    joggingRoutes,
    transitGeoJson,
    activeFaculty,
    activeBuilding,
    activeRoom,
    activeFloor,
    xrayEnabled,
    is3D,
    darkMode,
    highlightedTransitId,
    visibility,
    userLocation,
    route,
    originCoord,
    destCoord,
    stopWaypoints = [],
    pickTarget,
    cameraCmd,
    liveNavActive,
    liveNavCoord,
    liveNavHeading,
    liveNavFollow,
    activeTurnStepIndex = -1,
    drawMode = false,
    customAnchors = [],
  } = props;

  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const readyRef = useRef(false);
  const [mapReadySeq, setMapReadySeq] = useState(0);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const originMarkerRef = useRef<maplibregl.Marker | null>(null);
  const destMarkerRef = useRef<maplibregl.Marker | null>(null);
  const stopMarkersRef = useRef<maplibregl.Marker[]>([]);
  const customAnchorMarkersRef = useRef<maplibregl.Marker[]>([]);
  const dragHandleMarkerRef = useRef<maplibregl.Marker | null>(null);
  const routeDragStateRef = useRef<{
    active: boolean;
    hoverCoord: [number, number] | null;
    grabCoord: [number, number] | null;
  }>({ active: false, hoverCoord: null, grabCoord: null });
  const liveNavMarkerRef = useRef<maplibregl.Marker | null>(null);
  const userMarkerRef = useRef<maplibregl.Marker | null>(null);
  const coneElRef = useRef<HTMLDivElement | null>(null);

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

  const turnArrows = useMemo(
    () => extractTurnArrows(route, activeTurnStepIndex),
    [route, activeTurnStepIndex],
  );

  const applyUserLocation = (map: maplibregl.Map, location: UserLocation | null) => {
    const source = map.getSource('um-user-area') as GeoJSONSource | undefined;
    if (!location) {
      source?.setData({ type: 'FeatureCollection', features: [] });
      userMarkerRef.current?.remove();
      userMarkerRef.current = null;
      return;
    }

    source?.setData(accuracyPolygon(location.coord, location.accuracy));

    if (!userMarkerRef.current) {
      const element = document.createElement('div');
      element.className = 'user-loc-wrap';
      element.title = 'Your current location';
      element.innerHTML = '<span class="user-loc-halo"></span><span class="user-loc-dot"></span>';
      userMarkerRef.current = new maplibregl.Marker({ element, anchor: 'center' })
        .setLngLat(location.coord)
        .addTo(map);
    } else {
      userMarkerRef.current.setLngLat(location.coord);
    }
  };

  /**
   * Authoritative dynamic state & theme synchronizer.
   * Called BOTH immediately after custom layers install AND whenever any
   * theme, selection, transit highlight, or visibility prop changes.
   */
  const syncMapVisualState = (map: maplibregl.Map, cur: UmMapCanvasProps) => {
    const dark = cur.darkMode;
    syncBaseStyleTheme(map, dark);

    map.setLight({
      anchor: 'viewport',
      color: dark ? '#dce4f0' : '#ffffff',
      intensity: dark ? 0.4 : 0.32,
      position: [1.35, 120, 48],
    });

    const bId = cur.activeBuilding?.id ?? '__none__';
    const hasRooms = Boolean(cur.activeBuilding?.has_rooms);
    const useXray = hasRooms && cur.xrayEnabled;
    const routeFocusActive = Boolean((cur.route && cur.route.segments.length > 0) || cur.liveNavActive);
    const activeBusCodes = routeFocusActive && cur.route?.mode === 'bus' ? cur.route.busRoutesUsed : [];

    // Ground & outer mask (Classic Google Maps warm neutral & dark slate)
    if (map.getLayer('um-outer-mask')) {
      map.setPaintProperty('um-outer-mask', 'fill-color', dark ? '#171b22' : '#e8eaed');
      map.setPaintProperty('um-outer-mask', 'fill-opacity', dark ? 0.5 : 0.34);
    }
    if (map.getLayer('um-campus-ground')) {
      map.setPaintProperty('um-campus-ground', 'fill-color', dark ? '#1f242c' : '#f5f5f3');
      map.setPaintProperty('um-campus-ground', 'fill-opacity', dark ? 0.72 : 0.42);
    }

    // Parks & water (clean Polygon lakes + LineString streams)
    if (map.getLayer('um-parks-fill')) {
      map.setPaintProperty(
        'um-parks-fill',
        'fill-color',
        dark
          ? ['match', ['get', 'kind'], 'pitch', '#1e3b2d', 'track', '#352b22', '#1d3328']
          : ['match', ['get', 'kind'], 'pitch', '#bfe2bf', 'track', '#f0dfd1', '#cde8cc'],
      );
      map.setPaintProperty('um-parks-fill', 'fill-opacity', dark ? 0.86 : 0.78);
    }
    if (map.getLayer('um-water-fill')) {
      map.setPaintProperty('um-water-fill', 'fill-color', dark ? '#17324d' : '#aadaff');
      map.setPaintProperty('um-water-fill', 'fill-outline-color', dark ? '#204569' : '#8bc4f9');
    }
    if (map.getLayer('um-water-stream')) {
      map.setPaintProperty('um-water-stream', 'line-color', dark ? '#22486e' : '#99cef8');
    }

    // Faculty / college / institute / medical color overlays (fade cleanly during navigation focus)
    if (map.getLayer('um-faculties-fill')) {
      map.setPaintProperty('um-faculties-fill', 'fill-color', dark ? ZONE_ACCENT_EXPR : ZONE_FILL_EXPR);
      map.setPaintProperty(
        'um-faculties-fill',
        'fill-opacity',
        routeFocusActive ? (dark ? 0.07 : 0.14) : dark ? 0.18 : 0.4,
      );
    }
    if (map.getLayer('um-faculties-outline-casing')) {
      map.setPaintProperty('um-faculties-outline-casing', 'line-color', dark ? '#1a1f28' : '#ffffff');
      map.setPaintProperty(
        'um-faculties-outline-casing',
        'line-opacity',
        routeFocusActive ? 0.15 : dark ? 0.42 : 0.55,
      );
    }
    if (map.getLayer('um-faculties-outline')) {
      map.setPaintProperty(
        'um-faculties-outline',
        'line-opacity',
        routeFocusActive ? 0.22 : dark ? 0.58 : 0.68,
      );
    }
    if (map.getLayer('um-faculties-selected-fill')) {
      map.setFilter(
        'um-faculties-selected-fill',
        ['==', ['get', 'id'], routeFocusActive ? '__none__' : cur.activeFaculty?.id ?? '__none__'],
      );
      map.setPaintProperty('um-faculties-selected-fill', 'fill-color', dark ? ZONE_ACCENT_EXPR : ZONE_FILL_EXPR);
      map.setPaintProperty('um-faculties-selected-fill', 'fill-opacity', dark ? 0.3 : 0.72);
    }
    if (map.getLayer('um-faculties-selected')) {
      map.setFilter(
        'um-faculties-selected',
        ['==', ['get', 'id'], routeFocusActive ? '__none__' : cur.activeFaculty?.id ?? '__none__'],
      );
    }

    // Roads, footpaths & shortcuts (fade competing footpaths when navigating)
    if (map.getLayer('um-roads-casing')) {
      map.setPaintProperty('um-roads-casing', 'line-color', dark ? '#181d26' : '#dadce0');
    }
    if (map.getLayer('um-roads-line')) {
      map.setPaintProperty('um-roads-line', 'line-color', dark ? '#2f3642' : '#ffffff');
    }
    if (map.getLayer('um-footways-line')) {
      map.setPaintProperty('um-footways-line', 'line-color', dark ? '#64748b' : '#8091a5');
      map.setPaintProperty(
        'um-footways-line',
        'line-opacity',
        routeFocusActive ? 0.14 : dark ? 0.58 : 0.62,
      );
    }
    if (map.getLayer('um-shortcuts-glow')) {
      map.setPaintProperty('um-shortcuts-glow', 'line-color', dark ? '#2a5a66' : '#a7d7c5');
      map.setPaintProperty('um-shortcuts-glow', 'line-opacity', routeFocusActive ? 0.06 : 0.24);
    }
    if (map.getLayer('um-shortcuts-line')) {
      map.setPaintProperty('um-shortcuts-line', 'line-color', dark ? '#59b59a' : '#2e7d6b');
      map.setPaintProperty('um-shortcuts-line', 'line-opacity', routeFocusActive ? 0.14 : 0.8);
    }
    if (map.getLayer('um-steps-line')) {
      map.setPaintProperty('um-steps-line', 'line-opacity', routeFocusActive ? 0.14 : 0.78);
    }

    // Popular UM jogging loops (subtle dashed green trail; fades during route focus)
    if (map.getLayer('um-jogging-casing')) {
      map.setPaintProperty('um-jogging-casing', 'line-color', dark ? '#181d26' : '#ffffff');
      map.setPaintProperty('um-jogging-casing', 'line-opacity', routeFocusActive ? 0.05 : 0.45);
    }
    if (map.getLayer('um-jogging-line')) {
      map.setPaintProperty('um-jogging-line', 'line-color', dark ? '#62ba93' : '#2e7d5b');
      map.setPaintProperty('um-jogging-line', 'line-opacity', routeFocusActive ? 0.1 : dark ? 0.66 : 0.64);
    }

    // Campus boundary
    if (map.getLayer('um-boundary-line')) {
      map.setPaintProperty('um-boundary-line', 'line-color', dark ? '#8ab4f8' : '#1a73e8');
      map.setPaintProperty('um-boundary-line', 'line-opacity', routeFocusActive ? 0.34 : 0.72);
    }
    if (map.getLayer('um-boundary-glow')) {
      map.setPaintProperty('um-boundary-glow', 'line-color', dark ? '#4d73b8' : '#a8c7fa');
      map.setPaintProperty('um-boundary-glow', 'line-opacity', routeFocusActive ? 0.1 : dark ? 0.2 : 0.28);
    }

    // Transit lines: fade heavily during route focus unless actively ridden in Bus mode
    const hiRoute = cur.highlightedTransitId;
    if (map.getLayer('um-transit-casing')) {
      map.setPaintProperty('um-transit-casing', 'line-color', dark ? '#181d26' : '#ffffff');
      if (routeFocusActive) {
        if (activeBusCodes.length > 0) {
          map.setPaintProperty('um-transit-casing', 'line-opacity', [
            'case',
            ['in', ['get', 'code'], ['literal', activeBusCodes]],
            0.88,
            0.06,
          ]);
          map.setPaintProperty('um-transit-casing', 'line-width', [
            'case',
            ['in', ['get', 'code'], ['literal', activeBusCodes]],
            6.8,
            1.8,
          ]);
        } else {
          map.setPaintProperty('um-transit-casing', 'line-opacity', 0.06);
          map.setPaintProperty('um-transit-casing', 'line-width', 1.8);
        }
      } else {
        map.setPaintProperty(
          'um-transit-casing',
          'line-opacity',
          hiRoute ? ['case', ['==', ['get', 'id'], hiRoute], 0.92, 0.16] : 0.52,
        );
        map.setPaintProperty(
          'um-transit-casing',
          'line-width',
          hiRoute
            ? ['case', ['==', ['get', 'id'], hiRoute], 8.0, 2.4]
            : ['interpolate', ['linear'], ['zoom'], 14, 2.6, 18, 5.0],
        );
      }
    }
    if (map.getLayer('um-transit-line')) {
      if (routeFocusActive) {
        if (activeBusCodes.length > 0) {
          map.setPaintProperty('um-transit-line', 'line-opacity', [
            'case',
            ['in', ['get', 'code'], ['literal', activeBusCodes]],
            0.9,
            0.08,
          ]);
          map.setPaintProperty('um-transit-line', 'line-width', [
            'case',
            ['in', ['get', 'code'], ['literal', activeBusCodes]],
            4.2,
            1.1,
          ]);
        } else {
          map.setPaintProperty('um-transit-line', 'line-opacity', 0.1);
          map.setPaintProperty('um-transit-line', 'line-width', 1.1);
        }
      } else {
        map.setPaintProperty(
          'um-transit-line',
          'line-opacity',
          hiRoute ? ['case', ['==', ['get', 'id'], hiRoute], 0.98, 0.16] : dark ? 0.72 : 0.62,
        );
        map.setPaintProperty(
          'um-transit-line',
          'line-width',
          hiRoute
            ? ['case', ['==', ['get', 'id'], hiRoute], 4.6, 1.3]
            : ['interpolate', ['linear'], ['zoom'], 14, 1.6, 18, 3.0],
        );
      }
    }

    // 3D buildings (grounded architectural neutral grey/off-white)
    if (map.getLayer('um-buildings-outline')) {
      map.setPaintProperty('um-buildings-outline', 'line-color', dark ? '#272e3a' : '#d5d9df');
    }
    if (map.getLayer('um-buildings-3d')) {
      map.setFilter('um-buildings-3d', ['all', ['!=', ['get', 'id'], bId], ['!=', ['get', 'is_canopy'], true]]);
      const baseRooms = dark ? '#414b5c' : '#f8f9fa';
      const baseMedical = dark ? '#2f4356' : '#edf3fa';
      const baseDefault = dark ? '#343c4a' : '#eceef1';
      const inactiveFac = dark ? '#282f3b' : '#e4e7eb';
      const mutedBg = dark ? '#262d38' : '#e3e6eb';

      map.setPaintProperty(
        'um-buildings-3d',
        'fill-extrusion-color',
        cur.activeBuilding && !routeFocusActive
          ? mutedBg
          : cur.activeFaculty && !routeFocusActive
            ? [
                'case',
                ['==', ['get', 'faculty_id'], cur.activeFaculty.id],
                ['get', 'faculty_color'],
                inactiveFac,
              ]
            : [
                'case',
                ['==', ['get', 'has_rooms'], true],
                baseRooms,
                ['==', ['get', 'category'], 'medical'],
                baseMedical,
                baseDefault,
              ],
      );
      // Keep surrounding buildings solid opaque so neighboring extrusions never WebGL bleed-through during cutaway orbit
      map.setPaintProperty('um-buildings-3d', 'fill-extrusion-opacity', routeFocusActive ? 0.92 : 0.96);
    }

    if (map.getLayer('um-canopies-3d')) {
      map.setPaintProperty('um-canopies-3d', 'fill-extrusion-color', dark ? '#363f4e' : '#dcdfe4');
    }

    // Clean cutaway mode: hide translucent 3D shell walls completely when X-ray cutaway is active,
    // and show crisp ground floorplate + perimeter outline beneath open, solid 3D rooms.
    if (map.getLayer('um-building-focus-floorplate')) {
      map.setFilter(
        'um-building-focus-floorplate',
        useXray ? ['==', ['get', 'id'], bId] : ['==', ['get', 'id'], '__none__'],
      );
      map.setPaintProperty('um-building-focus-floorplate', 'fill-color', dark ? '#293445' : '#e8f0fe');
      map.setPaintProperty('um-building-focus-floorplate', 'fill-opacity', dark ? 0.88 : 0.78);
    }
    if (map.getLayer('um-building-focus-shell')) {
      map.setFilter(
        'um-building-focus-shell',
        cur.activeBuilding && !useXray ? ['==', ['get', 'id'], bId] : ['==', ['get', 'id'], '__none__'],
      );
      map.setPaintProperty('um-building-focus-shell', 'fill-extrusion-opacity', 1);
      map.setPaintProperty(
        'um-building-focus-shell',
        'fill-extrusion-color',
        dark ? '#5b8def' : '#1a73e8',
      );
    }
    if (map.getLayer('um-building-focus-outline')) {
      map.setFilter('um-building-focus-outline', ['==', ['get', 'id'], bId]);
      map.setPaintProperty('um-building-focus-outline', 'line-color', dark ? '#8ab4f8' : '#1a73e8');
      map.setPaintProperty('um-building-focus-outline', 'line-width', useXray ? 2.6 : 2.2);
    }

    const facBldgFilter: maplibregl.FilterSpecification = [
      'all',
      ['==', ['get', 'faculty_id'], routeFocusActive ? '__none__' : cur.activeFaculty?.id ?? '__none__'],
      ['!=', ['get', 'is_canopy'], true],
    ];
    if (map.getLayer('um-faculty-buildings-outline-glow')) {
      map.setFilter('um-faculty-buildings-outline-glow', facBldgFilter);
      map.setPaintProperty('um-faculty-buildings-outline-glow', 'line-color', dark ? '#181d26' : '#ffffff');
    }
    if (map.getLayer('um-faculty-buildings-outline')) {
      map.setFilter('um-faculty-buildings-outline', facBldgFilter);
      map.setPaintProperty(
        'um-faculty-buildings-outline',
        'line-color',
        cur.activeFaculty?.accent ?? zoneAccent(cur.activeFaculty?.zone_kind),
      );
    }

    // Indoor rooms: only visible in clean cutaway mode; exclude activeRoom from base layer to eliminate coplanar wall z-fighting
    const activeRoomId = cur.activeRoom?.id ?? '__none__';
    const roomLabelFilter: maplibregl.FilterSpecification = !useXray
      ? ['==', ['get', 'building_id'], '__none__']
      : cur.activeBuilding && cur.activeFloor !== 'all'
        ? ['all', ['==', ['get', 'building_id'], bId], ['==', ['get', 'floor'], cur.activeFloor]]
        : ['==', ['get', 'building_id'], bId];

    const room3dFilter: maplibregl.FilterSpecification = !useXray
      ? ['==', ['get', 'building_id'], '__none__']
      : cur.activeBuilding && cur.activeFloor !== 'all'
        ? [
            'all',
            ['==', ['get', 'building_id'], bId],
            ['==', ['get', 'floor'], cur.activeFloor],
            ['!=', ['get', 'id'], activeRoomId],
          ]
        : ['all', ['==', ['get', 'building_id'], bId], ['!=', ['get', 'id'], activeRoomId]];

    if (map.getLayer('um-rooms-3d')) map.setFilter('um-rooms-3d', room3dFilter);
    if (map.getLayer('um-rooms-label')) map.setFilter('um-rooms-label', roomLabelFilter);
    if (map.getLayer('um-room-selected-3d')) {
      map.setFilter(
        'um-room-selected-3d',
        useXray && cur.activeRoom ? ['==', ['get', 'id'], activeRoomId] : ['==', ['get', 'id'], '__none__'],
      );
    }

    // Active navigation route spotlight (Google Maps Blue + outer halo + crisp casing)
    if (map.getLayer('um-route-glow')) {
      map.setPaintProperty('um-route-glow', 'line-color', dark ? '#669df6' : '#1a73e8');
      map.setPaintProperty('um-route-glow', 'line-opacity', routeFocusActive ? (dark ? 0.3 : 0.24) : 0);
    }
    if (map.getLayer('um-route-casing')) {
      map.setPaintProperty('um-route-casing', 'line-color', dark ? '#11161f' : '#ffffff');
      map.setPaintProperty('um-route-casing', 'line-width', routeFocusActive ? 11.2 : 10);
    }
    if (map.getLayer('um-route-line')) {
      const routePrimary = dark ? '#669df6' : '#1a73e8';
      const routeShortcut = dark ? '#5bb974' : '#137333';
      map.setPaintProperty('um-route-line', 'line-color', [
        'match',
        ['get', 'kind'],
        'bus',
        ['case', ['!=', ['get', 'color'], ''], ['get', 'color'], routePrimary],
        'shortcut',
        routeShortcut,
        'steps',
        '#d97706',
        'indoor',
        '#4285f4',
        routePrimary,
      ]);
      map.setPaintProperty('um-route-line', 'line-width', routeFocusActive ? 6.4 : 5.4);
    }

    // Labels theme contrast (clean Google Maps neutral ink)
    if (map.getLayer('um-faculties-label')) {
      map.setPaintProperty('um-faculties-label', 'text-color', dark ? '#e8eaed' : '#3c4043');
      map.setPaintProperty(
        'um-faculties-label',
        'text-halo-color',
        dark ? 'rgba(24, 29, 38, 0.92)' : 'rgba(255, 255, 255, 0.96)',
      );
      map.setPaintProperty('um-faculties-label', 'text-opacity', routeFocusActive ? 0.65 : 1);
    }
    if (map.getLayer('um-buildings-label')) {
      map.setPaintProperty('um-buildings-label', 'text-color', dark ? '#bdc1c6' : '#4a4e54');
      map.setPaintProperty(
        'um-buildings-label',
        'text-halo-color',
        dark ? 'rgba(24, 29, 38, 0.9)' : 'rgba(255, 255, 255, 0.95)',
      );
    }
    if (map.getLayer('um-pois-label')) {
      map.setPaintProperty(
        'um-pois-label',
        'text-color',
        dark
          ? ['match', ['get', 'kind'], 'rail_station', '#81c995', 'bus_stop', '#8ab4f8', '#bdc1c6']
          : ['match', ['get', 'kind'], 'rail_station', '#137333', 'bus_stop', '#1a73e8', '#5f6368'],
      );
      map.setPaintProperty(
        'um-pois-label',
        'text-halo-color',
        dark ? 'rgba(24, 29, 38, 0.94)' : 'rgba(255, 255, 255, 0.96)',
      );
    }
    if (map.getLayer('um-rooms-label')) {
      map.setPaintProperty('um-rooms-label', 'text-color', dark ? '#e8eaed' : '#202124');
      map.setPaintProperty(
        'um-rooms-label',
        'text-halo-color',
        dark ? 'rgba(24, 29, 38, 0.94)' : 'rgba(255, 255, 255, 0.96)',
      );
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
    setVis(
      ['um-faculties-fill', 'um-faculties-outline-casing', 'um-faculties-outline', 'um-faculties-selected-fill', 'um-faculties-selected'],
      cur.visibility.faculties,
    );
    setVis(['um-roads-casing', 'um-roads-line'], cur.visibility.roads);
    setVis(['um-footways-line', 'um-shortcuts-glow', 'um-shortcuts-line', 'um-steps-line'], cur.visibility.pathways);
    setVis(['um-jogging-casing', 'um-jogging-line'], cur.visibility.joggingRoutes);
    setVis(['um-transit-casing', 'um-transit-line'], cur.visibility.busRoutes);
    setVis(
      [
        'um-buildings-outline',
        'um-faculty-buildings-outline-glow',
        'um-faculty-buildings-outline',
        'um-buildings-3d',
        'um-canopies-3d',
        'um-building-focus-floorplate',
        'um-building-focus-shell',
        'um-building-focus-outline',
        'um-rooms-3d',
        'um-room-selected-3d',
      ],
      cur.visibility.buildings3d,
    );
    setVis(['um-pois-icon'], cur.visibility.pois);
    setVis(['um-faculties-label', 'um-buildings-label', 'um-pois-label', 'um-rooms-label'], cur.visibility.labels);
  };

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
      canvasContextAttributes: { preserveDrawingBuffer: true },
    });

    mapRef.current = map;
    if (latestRef.current.mapCanvasRef) {
      latestRef.current.mapCanvasRef.current = map.getCanvas();
    }
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-right');
    map.addControl(new maplibregl.ScaleControl({ maxWidth: 110, unit: 'metric' }), 'bottom-left');

    const hoverPopup = new maplibregl.Popup({
      closeButton: false,
      closeOnClick: false,
      offset: 14,
      maxWidth: '280px',
    });
    popupRef.current = hoverPopup;

    const fallbackTimer = window.setTimeout(() => {
      if (!styleLoaded) {
        map.setStyle(createFallbackStyle(latestRef.current.darkMode));
      }
    }, 4500);

    map.on('error', () => {
      if (!styleLoaded) {
        map.setStyle(createFallbackStyle(latestRef.current.darkMode));
      }
    });

    const installCustomLayers = () => {
      styleLoaded = true;
      window.clearTimeout(fallbackTimer);

      if (map.getSource('um-boundary')) return;

      const cur = latestRef.current;

      // Hide Positron's flat 2D building polygons so 3D UM extrusions stay crisp without z-fighting
      for (const layerId of ['building', 'building-3d', 'building_3d']) {
        if (map.getLayer(layerId)) {
          map.setLayoutProperty(layerId, 'visibility', 'none');
        }
      }

      // Register crisp high-DPI bus stop, rail station, and campus gate badges
      registerMapIcons(map);

      map.addSource('um-boundary', { type: 'geojson', data: cur.boundary });
      map.addSource('um-parks', { type: 'geojson', data: cur.context.parks });
      map.addSource('um-water', { type: 'geojson', data: cur.context.water });
      map.addSource('um-faculties', { type: 'geojson', data: cur.faculties });
      map.addSource('um-roads', { type: 'geojson', data: cur.context.roads });
      map.addSource('um-jogging', { type: 'geojson', data: cur.joggingRoutes });
      map.addSource('um-transit', { type: 'geojson', data: cur.transitGeoJson });
      map.addSource('um-buildings', { type: 'geojson', data: cur.buildings });
      map.addSource('um-rooms', { type: 'geojson', data: cur.rooms });
      map.addSource('um-pois', { type: 'geojson', data: cur.context.pois });
      map.addSource('um-user-area', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      map.addSource('um-route', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      map.addSource('um-turn-lines', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      map.addSource('um-turn-heads', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      map.addSource('um-drag-preview', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });

      // 1. Outer campus dimming mask & campus interior ground
      map.addLayer({
        id: 'um-outer-mask',
        type: 'fill',
        source: 'um-boundary',
        filter: ['==', ['get', 'kind'], 'mask'],
        paint: {
          'fill-color': '#e6eaf3',
          'fill-opacity': 0.44,
        },
      });

      map.addLayer({
        id: 'um-campus-ground',
        type: 'fill',
        source: 'um-boundary',
        filter: ['==', ['get', 'id'], 'um-boundary'],
        paint: {
          'fill-color': '#f7f8fc',
          'fill-opacity': 0.35,
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
            '#d7eadc',
            'track',
            '#efe2d3',
            '#e1efe4',
          ],
          'fill-opacity': 0.72,
        },
      });

      // 3. Water bodies (closed Polygon lakes vs LineString rivers/streams — prevents auto-closed triangle glitches)
      map.addLayer({
        id: 'um-water-fill',
        type: 'fill',
        source: 'um-water',
        filter: ['==', ['geometry-type'], 'Polygon'],
        paint: {
          'fill-color': '#aadaff',
          'fill-opacity': 0.95,
          'fill-outline-color': '#8bc4f9',
        },
      });

      map.addLayer({
        id: 'um-water-stream',
        type: 'line',
        source: 'um-water',
        filter: ['==', ['geometry-type'], 'LineString'],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#99cef8',
          'line-width': ['interpolate', ['linear'], ['zoom'], 13.5, 1.4, 17.5, 4.2],
          'line-opacity': 0.92,
        },
      });

      // 3b. Visitor location accuracy halo
      map.addLayer({
        id: 'um-user-area',
        type: 'fill',
        source: 'um-user-area',
        paint: {
          'fill-color': '#1a73e8',
          'fill-opacity': 0.12,
        },
      });

      map.addLayer({
        id: 'um-user-area-line',
        type: 'line',
        source: 'um-user-area',
        paint: {
          'line-color': '#1a73e8',
          'line-width': 1.2,
          'line-opacity': 0.4,
        },
      });

      // 4. Faculty, college, institute & medical zone color overlays
      map.addLayer({
        id: 'um-faculties-fill',
        type: 'fill',
        source: 'um-faculties',
        paint: {
          'fill-color': ZONE_FILL_EXPR,
          'fill-opacity': 0.58,
        },
      });

      map.addLayer({
        id: 'um-faculties-outline-casing',
        type: 'line',
        source: 'um-faculties',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#ffffff',
          'line-width': 2.8,
          'line-opacity': 0.6,
        },
      });

      map.addLayer({
        id: 'um-faculties-outline',
        type: 'line',
        source: 'um-faculties',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': ZONE_ACCENT_EXPR,
          'line-width': 1.2,
          'line-opacity': 0.68,
          'line-dasharray': [2.5, 2],
        },
      });

      map.addLayer({
        id: 'um-faculties-selected-fill',
        type: 'fill',
        source: 'um-faculties',
        filter: ['==', ['get', 'id'], '__none__'],
        paint: {
          'fill-color': ZONE_FILL_EXPR,
          'fill-opacity': 0.88,
        },
      });

      map.addLayer({
        id: 'um-faculties-selected',
        type: 'line',
        source: 'um-faculties',
        filter: ['==', ['get', 'id'], '__none__'],
        paint: {
          'line-color': ZONE_ACCENT_EXPR,
          'line-width': 2.6,
          'line-opacity': 0.98,
        },
      });

      // 5. Campus roads
      map.addLayer({
        id: 'um-roads-casing',
        type: 'line',
        source: 'um-roads',
        filter: ['==', ['get', 'kind'], 'road'],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#cfd5e2',
          'line-width': ['interpolate', ['linear'], ['zoom'], 14, 3.0, 17.5, 8.6],
          'line-opacity': 0.82,
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
          'line-width': ['interpolate', ['linear'], ['zoom'], 14, 1.8, 17.5, 6.0],
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
          'line-color': '#859bb9',
          'line-width': ['interpolate', ['linear'], ['zoom'], 14, 1.0, 18, 2.5],
          'line-opacity': 0.7,
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
          'line-width': ['interpolate', ['linear'], ['zoom'], 14, 3.6, 18, 7.2],
          'line-opacity': 0.28,
        },
      });

      map.addLayer({
        id: 'um-shortcuts-line',
        type: 'line',
        source: 'um-roads',
        filter: ['==', ['get', 'kind'], 'shortcut'],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#3a7f97',
          'line-width': ['interpolate', ['linear'], ['zoom'], 14, 1.6, 18, 3.2],
          'line-opacity': 0.88,
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
          'line-width': ['interpolate', ['linear'], ['zoom'], 14, 1.4, 18, 3.0],
          'line-dasharray': [1, 1.2],
        },
      });

      // 6a. Popular UM jogging loops (subtle dashed green running trails)
      map.addLayer({
        id: 'um-jogging-casing',
        type: 'line',
        source: 'um-jogging',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#ffffff',
          'line-width': ['interpolate', ['linear'], ['zoom'], 13.8, 3.2, 17.5, 5.2],
          'line-opacity': 0.45,
        },
      });

      map.addLayer({
        id: 'um-jogging-line',
        type: 'line',
        source: 'um-jogging',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#2e7d5b',
          'line-width': ['interpolate', ['linear'], ['zoom'], 13.8, 1.6, 17.5, 3.0],
          'line-opacity': 0.64,
          'line-dasharray': [3, 2.4],
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
          'line-width': ['interpolate', ['linear'], ['zoom'], 14, 3.0, 18, 5.6],
          'line-opacity': 0.62,
        },
      });

      map.addLayer({
        id: 'um-transit-line',
        type: 'line',
        source: 'um-transit',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': ['coalesce', ['get', 'color'], '#1a73e8'],
          'line-width': ['interpolate', ['linear'], ['zoom'], 14, 1.8, 18, 3.4],
          'line-opacity': 0.68,
        },
      });

      // 7. UM Campus Boundary
      map.addLayer({
        id: 'um-boundary-glow',
        type: 'line',
        source: 'um-boundary',
        filter: ['==', ['get', 'id'], 'um-boundary'],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#b7c5f0',
          'line-width': 6,
          'line-blur': 3,
          'line-opacity': 0.38,
        },
      });

      map.addLayer({
        id: 'um-boundary-line',
        type: 'line',
        source: 'um-boundary',
        filter: ['==', ['get', 'id'], 'um-boundary'],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#1a73e8',
          'line-width': 2,
          'line-opacity': 0.88,
        },
      });

      // 8. 3D Buildings (UM Campus, PPUM, UMSC, Wisma R&D, Masjid Ar-Rahman)
      map.addLayer({
        id: 'um-buildings-outline',
        type: 'line',
        source: 'um-buildings',
        filter: ['!=', ['get', 'is_canopy'], true],
        paint: {
          'line-color': '#cfd6e4',
          'line-width': 0.8,
          'line-opacity': 0.85,
        },
      });

      map.addLayer({
        id: 'um-faculty-buildings-outline-glow',
        type: 'line',
        source: 'um-buildings',
        filter: ['all', ['==', ['get', 'faculty_id'], '__none__'], ['!=', ['get', 'is_canopy'], true]],
        paint: {
          'line-color': '#ffffff',
          'line-width': 4.8,
          'line-opacity': 0.88,
        },
      });

      map.addLayer({
        id: 'um-faculty-buildings-outline',
        type: 'line',
        source: 'um-buildings',
        filter: ['all', ['==', ['get', 'faculty_id'], '__none__'], ['!=', ['get', 'is_canopy'], true]],
        paint: {
          'line-color': '#33549e',
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
          'fill-extrusion-height': ['coalesce', ['to-number', ['get', 'height'], 8], 8],
          'fill-extrusion-color': [
            'case',
            ['==', ['get', 'has_rooms'], true],
            '#ffffff',
            ['==', ['get', 'category'], 'medical'],
            '#f1f7fc',
            '#f0f3fa',
          ],
          'fill-extrusion-opacity': 0.95,
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
          'fill-extrusion-color': '#d5dceb',
          'fill-extrusion-opacity': 0.4,
        },
      });

      map.addLayer({
        id: 'um-building-focus-floorplate',
        type: 'fill',
        source: 'um-buildings',
        filter: ['==', ['get', 'id'], '__none__'],
        paint: {
          'fill-color': '#e8f0fe',
          'fill-opacity': 0.78,
        },
      });

      map.addLayer({
        id: 'um-building-focus-shell',
        type: 'fill-extrusion',
        source: 'um-buildings',
        filter: ['==', ['get', 'id'], '__none__'],
        paint: {
          'fill-extrusion-base': 0,
          'fill-extrusion-height': ['coalesce', ['to-number', ['get', 'height'], 8], 8],
          'fill-extrusion-color': '#1a73e8',
          'fill-extrusion-opacity': 1,
          'fill-extrusion-vertical-gradient': true,
        },
      });

      map.addLayer({
        id: 'um-building-focus-outline',
        type: 'line',
        source: 'um-buildings',
        filter: ['==', ['get', 'id'], '__none__'],
        paint: {
          'line-color': '#1a73e8',
          'line-width': 2.6,
          'line-opacity': 0.96,
        },
      });

      // 9. 3D Indoor Rooms (opaque fill-extrusion-opacity: 1 eliminates WebGL offscreen translucency flicker)
      map.addLayer({
        id: 'um-rooms-3d',
        type: 'fill-extrusion',
        source: 'um-rooms',
        filter: ['==', ['get', 'building_id'], '__none__'],
        paint: {
          'fill-extrusion-base': ['coalesce', ['to-number', ['get', 'base_height'], 0.15], 0.15],
          'fill-extrusion-height': [
            '+',
            ['coalesce', ['to-number', ['get', 'base_height'], 0.15], 0.15],
            ['coalesce', ['to-number', ['get', 'height'], 3.2], 3.2],
          ],
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
          'fill-extrusion-opacity': 1,
          'fill-extrusion-vertical-gradient': true,
        },
      });

      map.addLayer({
        id: 'um-room-selected-3d',
        type: 'fill-extrusion',
        source: 'um-rooms',
        filter: ['==', ['get', 'id'], '__none__'],
        paint: {
          'fill-extrusion-base': ['coalesce', ['to-number', ['get', 'base_height'], 0.15], 0.15],
          'fill-extrusion-height': [
            '+',
            ['coalesce', ['to-number', ['get', 'base_height'], 0.15], 0.15],
            ['+', ['coalesce', ['to-number', ['get', 'height'], 3.2], 3.2], 0.35],
          ],
          'fill-extrusion-color': '#d97706',
          'fill-extrusion-opacity': 1,
          'fill-extrusion-vertical-gradient': true,
        },
      });

      // 10. Wayfinding Active Route Layers (Spotlight halo + casing + vibrant Google Blue + directional arrows)
      map.addLayer({
        id: 'um-route-glow',
        type: 'line',
        source: 'um-route',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#1a73e8',
          'line-width': 16,
          'line-blur': 4,
          'line-opacity': 0.24,
        },
      });

      map.addLayer({
        id: 'um-route-casing',
        type: 'line',
        source: 'um-route',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#ffffff',
          'line-width': 11.2,
          'line-opacity': 0.98,
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
            ['case', ['!=', ['get', 'color'], ''], ['get', 'color'], '#1a73e8'],
            'shortcut',
            '#137333',
            'steps',
            '#d97706',
            'indoor',
            '#4285f4',
            '#1a73e8',
          ],
          'line-width': 6.4,
          'line-opacity': 0.99,
        },
      });

      map.addLayer({
        id: 'um-route-arrows',
        type: 'symbol',
        source: 'um-route',
        layout: {
          'symbol-placement': 'line',
          'symbol-spacing': 56,
          'icon-image': 'icon-route-arrow',
          'icon-size': 0.72,
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
          'icon-rotation-alignment': 'map',
        },
      });

      // 10b. Google Maps-style road-hugging turning arrows at maneuver corners
      map.addLayer({
        id: 'um-turn-arrow-casing',
        type: 'line',
        source: 'um-turn-lines',
        minzoom: 14.2,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#173a70',
          'line-width': [
            'interpolate',
            ['linear'],
            ['zoom'],
            14.5,
            ['case', ['==', ['get', 'isNext'], 1], 6.4, 5.0],
            18,
            ['case', ['==', ['get', 'isNext'], 1], 11.4, 8.8],
          ],
          'line-opacity': 0.94,
        },
      });

      map.addLayer({
        id: 'um-turn-arrow-shaft',
        type: 'line',
        source: 'um-turn-lines',
        minzoom: 14.2,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#ffffff',
          'line-width': [
            'interpolate',
            ['linear'],
            ['zoom'],
            14.5,
            ['case', ['==', ['get', 'isNext'], 1], 3.4, 2.5],
            18,
            ['case', ['==', ['get', 'isNext'], 1], 6.2, 4.6],
          ],
          'line-opacity': 1,
        },
      });

      map.addLayer({
        id: 'um-turn-arrow-head',
        type: 'symbol',
        source: 'um-turn-heads',
        minzoom: 14.2,
        layout: {
          'icon-image': ['case', ['==', ['get', 'isNext'], 1], 'icon-turn-head-next', 'icon-turn-head'],
          'icon-size': ['interpolate', ['linear'], ['zoom'], 14.5, 0.56, 17, 0.85, 19, 1.05],
          'icon-rotate': ['get', 'bearing'],
          'icon-rotation-alignment': 'map',
          'icon-pitch-alignment': 'map',
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
        },
      });

      // 10c. Desktop drag-to-snap live rubber-band preview line
      map.addLayer({
        id: 'um-drag-preview-line',
        type: 'line',
        source: 'um-drag-preview',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#1a73e8',
          'line-width': 4,
          'line-dasharray': [2, 2],
          'line-opacity': 0.88,
        },
      });

      // 11. Prominent Bus Stop, Rail Station & Campus Gate Map Badges
      map.addLayer({
        id: 'um-pois-icon',
        type: 'symbol',
        source: 'um-pois',
        minzoom: 13.4,
        layout: {
          'icon-image': [
            'match',
            ['get', 'kind'],
            'rail_station',
            'icon-rail-station',
            'gate',
            'icon-gate',
            'icon-bus-stop',
          ],
          'icon-size': [
            'interpolate',
            ['linear'],
            ['zoom'],
            13.6,
            ['match', ['get', 'kind'], 'rail_station', 0.85, 0.56],
            15.2,
            ['match', ['get', 'kind'], 'rail_station', 0.96, 0.78],
            17.5,
            ['match', ['get', 'kind'], 'rail_station', 1.08, 0.98],
          ],
          'icon-padding': 4,
          'icon-allow-overlap': false,
          'symbol-sort-key': [
            'match',
            ['get', 'kind'],
            'rail_station',
            1,
            'gate',
            2,
            3,
          ],
        },
      });

      // 12. Streamlined, Calm Typography Labels
      map.addLayer({
        id: 'um-faculties-label',
        type: 'symbol',
        source: 'um-faculties',
        minzoom: 13.2,
        maxzoom: 17.8,
        layout: {
          'text-field': [
            'step',
            ['zoom'],
            ['coalesce', ['get', 'map_code'], ['get', 'code']],
            15.3,
            ['coalesce', ['get', 'short_label'], ['get', 'code']],
          ],
          'text-size': ['interpolate', ['linear'], ['zoom'], 13.5, 10.5, 15.6, 11.8, 17.2, 13],
          'text-font': ['Noto Sans Regular'],
          'text-letter-spacing': 0.02,
          'text-max-width': 11,
          'text-padding': 14,
          'text-variable-anchor': ['center', 'top', 'bottom'],
          'text-radial-offset': 0.4,
          'text-allow-overlap': false,
          'symbol-sort-key': [
            'match',
            ['get', 'zone_kind'],
            'medical',
            1,
            'landmark',
            2,
            'faculty',
            3,
            'institute',
            4,
            5,
          ],
        },
        paint: {
          'text-color': '#18254d',
          'text-halo-color': 'rgba(255, 255, 255, 0.96)',
          'text-halo-width': 2.2,
          'text-halo-blur': 0.4,
        },
      });

      map.addLayer({
        id: 'um-buildings-label',
        type: 'symbol',
        source: 'um-buildings',
        minzoom: 16.5,
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
          'text-size': ['interpolate', ['linear'], ['zoom'], 16.5, 9.8, 18.5, 11.2],
          'text-max-width': 11,
          'text-padding': 12,
          'text-font': ['Noto Sans Regular'],
          'text-allow-overlap': false,
        },
        paint: {
          'text-color': '#3d4558',
          'text-halo-color': 'rgba(255, 255, 255, 0.94)',
          'text-halo-width': 1.8,
        },
      });

      map.addLayer({
        id: 'um-pois-label',
        type: 'symbol',
        source: 'um-pois',
        minzoom: 15.4,
        layout: {
          'text-field': ['get', 'name'],
          'text-size': [
            'match',
            ['get', 'kind'],
            'rail_station',
            11,
            'bus_stop',
            9.6,
            10,
          ],
          'text-offset': [0, 1.35],
          'text-anchor': 'top',
          'text-max-width': 12,
          'text-padding': 8,
          'text-font': ['Noto Sans Regular'],
          'text-allow-overlap': false,
        },
        paint: {
          'text-color': [
            'match',
            ['get', 'kind'],
            'rail_station',
            '#005c51',
            'bus_stop',
            '#1e3c8f',
            '#384052',
          ],
          'text-halo-color': 'rgba(255, 255, 255, 0.96)',
          'text-halo-width': 2.0,
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
          'text-size': 10.2,
          'text-max-width': 10,
          'text-font': ['Noto Sans Regular'],
          'text-allow-overlap': false,
        },
        paint: {
          'text-color': '#182442',
          'text-halo-color': 'rgba(255, 255, 255, 0.96)',
          'text-halo-width': 1.8,
        },
      });

      readyRef.current = true;
      // Apply persisted darkMode + current filters immediately on style load
      syncMapVisualState(map, latestRef.current);
      applyUserLocation(map, latestRef.current.userLocation);

      if (map.getLayer('um-user-area') && map.getLayer('um-pois-icon')) {
        map.moveLayer('um-user-area', 'um-pois-icon');
        map.moveLayer('um-user-area-line', 'um-pois-icon');
      }

      setMapReadySeq((n) => n + 1);
    };

    map.on('style.load', installCustomLayers);

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

    let lastCenterEmit = 0;
    const emitCenter = (force: boolean) => {
      const cb = latestRef.current.onCenterChange;
      if (!cb) return;
      const now = performance.now();
      if (!force && now - lastCenterEmit < 180) return;
      lastCenterEmit = now;
      const c = map.getCenter();
      cb([c.lng, c.lat]);
    };
    map.on('move', () => emitCenter(false));
    map.on('moveend', () => emitCenter(true));

    // Interactive cursor + clean hover tooltips (including jogging loops & selected cutaway rooms)
    const hoverTargets = [
      'um-room-selected-3d',
      'um-rooms-3d',
      'um-pois-icon',
      'um-pois-label',
      'um-faculties-label',
      'um-buildings-label',
      'um-buildings-3d',
      'um-building-focus-shell',
      'um-building-focus-floorplate',
      'um-jogging-line',
      'um-faculties-fill',
    ];

    const clearDragHandle = () => {
      dragHandleMarkerRef.current?.remove();
      dragHandleMarkerRef.current = null;
      routeDragStateRef.current.hoverCoord = null;
    };

    const setDragPreview = (a: [number, number] | null, b: [number, number] | null) => {
      const src = map.getSource('um-drag-preview') as GeoJSONSource | undefined;
      if (!src) return;
      if (!a || !b) {
        src.setData({ type: 'FeatureCollection', features: [] });
        return;
      }
      src.setData({
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: {},
            geometry: { type: 'LineString', coordinates: [a, b] },
          },
        ],
      });
    };

    map.on('mousedown', (e) => {
      if (!readyRef.current || e.originalEvent.button !== 0) return;
      const cur = latestRef.current;
      if (!cur.drawMode || !routeDragStateRef.current.hoverCoord) return;

      e.preventDefault();
      map.dragPan.disable();
      routeDragStateRef.current.active = true;
      routeDragStateRef.current.grabCoord = routeDragStateRef.current.hoverCoord;
      map.getCanvas().style.cursor = 'grabbing';
      setDragPreview(routeDragStateRef.current.grabCoord, [e.lngLat.lng, e.lngLat.lat]);
    });

    map.on('mouseup', (e) => {
      if (!routeDragStateRef.current.active) return;
      const grab = routeDragStateRef.current.grabCoord;
      routeDragStateRef.current.active = false;
      routeDragStateRef.current.grabCoord = null;
      map.dragPan.enable();
      setDragPreview(null, null);
      clearDragHandle();
      map.getCanvas().style.cursor = latestRef.current.drawMode ? 'crosshair' : '';

      if (grab && latestRef.current.onCommitRouteDrag) {
        latestRef.current.onCommitRouteDrag(grab, [e.lngLat.lng, e.lngLat.lat]);
      }
    });

    map.on('mousemove', (e) => {
      if (!readyRef.current) return;
      const cur = latestRef.current;

      if (routeDragStateRef.current.active && routeDragStateRef.current.grabCoord) {
        const dropCoord: [number, number] = [e.lngLat.lng, e.lngLat.lat];
        setDragPreview(routeDragStateRef.current.grabCoord, dropCoord);
        dragHandleMarkerRef.current?.setLngLat(dropCoord);
        map.getCanvas().style.cursor = 'grabbing';
        hoverPopup.remove();
        return;
      }

      if (cur.drawMode) {
        hoverPopup.remove();
        // Desktop drag-to-snap handle when hovering near the active custom route line
        if (cur.route && cur.route.coordinates.length >= 2 && map.getLayer('um-route-line')) {
          const pad = 12;
          const hits = map.queryRenderedFeatures(
            [
              [e.point.x - pad, e.point.y - pad],
              [e.point.x + pad, e.point.y + pad],
            ],
            { layers: ['um-route-line'] },
          );
          if (hits.length > 0) {
            const proj = projectPointOntoPolyline([e.lngLat.lng, e.lngLat.lat], cur.route.coordinates);
            routeDragStateRef.current.hoverCoord = proj.closestCoord;
            if (!dragHandleMarkerRef.current) {
              const handleEl = document.createElement('div');
              handleEl.className = 'route-drag-handle';
              handleEl.title = 'Drag to snap route onto another road or path';
              dragHandleMarkerRef.current = new maplibregl.Marker({
                element: handleEl,
                anchor: 'center',
              })
                .setLngLat(proj.closestCoord)
                .addTo(map);
            } else {
              dragHandleMarkerRef.current.setLngLat(proj.closestCoord);
            }
            map.getCanvas().style.cursor = 'grab';
            return;
          }
        }
        clearDragHandle();
        map.getCanvas().style.cursor = 'crosshair';
        return;
      }

      clearDragHandle();

      if (cur.pickTarget) {
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

      if (f.layer.id === 'um-rooms-3d' || f.layer.id === 'um-room-selected-3d') {
        html = `
          <div class="map-tip__title">${title}</div>
          <div class="map-tip__meta">${String(p.floor_label ?? '')} · ${String(p.room_type ?? 'room').replace(/_/g, ' ')}</div>
          <div class="map-tip__meta">${String(p.building_name ?? '')}</div>
        `;
      } else if (f.layer.id === 'um-pois-icon' || f.layer.id === 'um-pois-label') {
        if (p.kind === 'bus_stop') {
          const refText = p.ref ? ` · ${String(p.ref)}` : '';
          html = `
            <div class="map-tip__row">
              <span class="map-tip__tag">Bus stop</span>
              <span class="map-tip__meta" style="margin:0">${refText ? String(p.ref) : 'Transit'}</span>
            </div>
            <div class="map-tip__title">${title}</div>
            <div class="map-tip__meta">Routes: ${String(p.routes || 'RapidKL & UM Shuttle')}</div>
          `;
        } else if (p.kind === 'rail_station') {
          html = `
            <div class="map-tip__row">
              <span class="map-tip__tag map-tip__tag--rail">Rail station</span>
            </div>
            <div class="map-tip__title">${title}</div>
            <div class="map-tip__meta">${String(p.line ?? 'Klang Valley rail')} · Feeder T789 / T815</div>
          `;
        } else if (p.kind === 'gate') {
          html = `
            <div class="map-tip__row">
              <span class="map-tip__tag">Campus gate</span>
            </div>
            <div class="map-tip__title">${title}</div>
          `;
        } else {
          html = `<div class="map-tip__title">${title}</div>`;
        }
      } else if (
        f.layer.id === 'um-buildings-3d' ||
        f.layer.id === 'um-building-focus-shell' ||
        f.layer.id === 'um-building-focus-floorplate' ||
        f.layer.id === 'um-buildings-label'
      ) {
        const hasRooms = p.has_rooms === true || p.has_rooms === 'true';
        const lvls = Number(p.levels ?? 1);
        html = `
          <div class="map-tip__row">
            <span class="map-tip__tag">${String(p.faculty_id ?? 'UM')}</span>
            <span class="map-tip__meta" style="margin:0">${lvls} ${lvls === 1 ? 'level' : 'levels'}</span>
          </div>
          <div class="map-tip__title">${title}</div>
          ${hasRooms ? '<div class="map-tip__meta">3D indoor rooms · Click to inspect</div>' : ''}
        `;
      } else if (f.layer.id === 'um-jogging-line') {
        const km = Number(p.distance_km ?? 0);
        const distLabel = km > 0 ? `${km.toFixed(2)} km loop` : 'Campus loop';
        html = `
          <div class="map-tip__row">
            <span class="map-tip__tag map-tip__tag--rail">Jogging route</span>
            <span class="map-tip__meta" style="margin:0">${distLabel}</span>
          </div>
          <div class="map-tip__title">${title}</div>
          <div class="map-tip__meta">${String(p.terrain ?? 'Popular UM running loop')}</div>
        `;
      } else if (f.layer.id === 'um-faculties-fill' || f.layer.id === 'um-faculties-label') {
        const zk = String(p.zone_kind ?? '');
        const kindLabel =
          zk === 'college'
            ? 'Residential college'
            : zk === 'institute'
              ? 'Research institute'
              : zk === 'medical'
                ? 'Medical centre'
                : zk === 'landmark'
                  ? 'Campus landmark'
                  : 'Faculty';
        html = `
          <div class="map-tip__row">
            <span class="map-tip__tag">${String(p.code ?? 'ZONE')}</span>
            <span class="map-tip__meta" style="margin:0">${kindLabel}</span>
          </div>
          <div class="map-tip__title">${title}</div>
          <div class="map-tip__meta">Click to inspect buildings &amp; transit</div>
        `;
      }

      hoverPopup
        .setLngLat(e.lngLat)
        .setHTML(`<div class="map-tip">${html || `<div class="map-tip__title">${title}</div>`}</div>`)
        .addTo(map);
    });

    map.on('mouseleave', () => {
      hoverPopup.remove();
      if (!routeDragStateRef.current.active) {
        clearDragHandle();
      }
    });

    // Click selection handler
    map.on('click', (e) => {
      if (!readyRef.current) return;
      const cur = latestRef.current;

      if (cur.drawMode && cur.onAddDrawAnchor) {
        const clickable = [
          'um-rooms-3d',
          'um-pois-icon',
          'um-pois-label',
          'um-buildings-3d',
          'um-building-focus-shell',
          'um-buildings-label',
          'um-faculties-label',
        ].filter((id) => Boolean(map.getLayer(id)));
        const hits = map.queryRenderedFeatures(e.point, { layers: clickable });
        const hitName = hits.length > 0 ? String((hits[0].properties as Record<string, unknown>)?.name ?? '') : '';
        cur.onAddDrawAnchor([e.lngLat.lng, e.lngLat.lat], hitName || undefined);
        return;
      }

      if (cur.pickTarget) {
        const clickable = [
          'um-rooms-3d',
          'um-pois-icon',
          'um-pois-label',
          'um-buildings-3d',
          'um-building-focus-shell',
          'um-buildings-label',
        ].filter((id) => Boolean(map.getLayer(id)));
        const hits = map.queryRenderedFeatures(e.point, { layers: clickable });
        const hitName = hits.length > 0 ? String((hits[0].properties as Record<string, unknown>)?.name ?? '') : '';
        cur.onPickCoordinate([e.lngLat.lng, e.lngLat.lat], hitName || undefined);
        return;
      }

      const priorityLayers = [
        'um-room-selected-3d',
        'um-rooms-3d',
        'um-pois-icon',
        'um-pois-label',
        'um-faculties-label',
        'um-buildings-label',
        'um-buildings-3d',
        'um-building-focus-shell',
        'um-building-focus-floorplate',
        'um-faculties-fill',
      ].filter((id) => Boolean(map.getLayer(id)));

      const feats = map.queryRenderedFeatures(e.point, { layers: priorityLayers });
      if (!feats.length) return;

      const top = feats[0] as MapGeoJSONFeature;
      const raw = (top.properties ?? {}) as Record<string, unknown>;

      if (top.layer.id === 'um-rooms-3d' || top.layer.id === 'um-room-selected-3d') {
        cur.onSelectRoom(toRoomProps(raw));
      } else if (top.layer.id === 'um-pois-icon' || top.layer.id === 'um-pois-label') {
        cur.onSelectPoi(String(raw.id ?? ''));
      } else if (
        top.layer.id === 'um-buildings-3d' ||
        top.layer.id === 'um-building-focus-shell' ||
        top.layer.id === 'um-building-focus-floorplate' ||
        top.layer.id === 'um-buildings-label'
      ) {
        cur.onSelectBuilding(toBuildingProps(raw));
      } else if (top.layer.id === 'um-faculties-fill' || top.layer.id === 'um-faculties-label') {
        cur.onSelectFaculty(toFacultyProps(raw));
      }
    });

    return () => {
      window.clearTimeout(fallbackTimer);
      originMarkerRef.current?.remove();
      destMarkerRef.current?.remove();
      for (const m of stopMarkersRef.current) m.remove();
      stopMarkersRef.current = [];
      for (const m of customAnchorMarkersRef.current) m.remove();
      customAnchorMarkersRef.current = [];
      clearDragHandle();
      liveNavMarkerRef.current?.remove();
      userMarkerRef.current?.remove();
      hoverPopup.remove();
      if (latestRef.current.mapCanvasRef) {
        latestRef.current.mapCanvasRef.current = null;
      }
      map.remove();
      mapRef.current = null;
      readyRef.current = false;
    };
  }, []);

  // Keep visitor location dot and accuracy halo in sync
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    applyUserLocation(map, userLocation);
  }, [userLocation, mapReadySeq]);

  // Sync dynamic filters, theme paints, route focus dimming & visibility
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    syncMapVisualState(map, latestRef.current);
  }, [
    activeFaculty,
    activeBuilding,
    activeRoom,
    activeFloor,
    xrayEnabled,
    visibility,
    darkMode,
    highlightedTransitId,
    route,
    liveNavActive,
    mapReadySeq,
  ]);

  // Sync active route line, road turning arrows & A / 1..N / B pins (or draggable custom anchors)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;

    const src = map.getSource('um-route') as GeoJSONSource | undefined;
    if (src) {
      src.setData(routeGeoJson);
    }

    (map.getSource('um-turn-lines') as GeoJSONSource | undefined)?.setData(turnArrows.lines);
    (map.getSource('um-turn-heads') as GeoJSONSource | undefined)?.setData(turnArrows.heads);

    originMarkerRef.current?.remove();
    destMarkerRef.current?.remove();
    for (const m of stopMarkersRef.current) m.remove();
    for (const m of customAnchorMarkersRef.current) m.remove();
    originMarkerRef.current = null;
    destMarkerRef.current = null;
    stopMarkersRef.current = [];
    customAnchorMarkersRef.current = [];

    const makePin = (letter: string, bg: string, draggable = false) => {
      const wrap = document.createElement('div');
      wrap.style.cssText =
        `width:26px;height:26px;border-radius:999px;background:${bg};color:#fff;` +
        'font-family:var(--font-sans);font-size:11.5px;font-weight:500;display:grid;place-items:center;' +
        `border:2.5px solid #fff;box-shadow:0 2px 8px rgba(32,33,36,0.34);${draggable ? 'cursor:grab;' : ''}`;
      wrap.textContent = letter;
      return wrap;
    };

    const makeStopPin = (num: number, label: string, draggable = false, isShaping = false) => {
      const wrap = document.createElement('div');
      wrap.title = draggable
        ? `${label} · Drag to move · Right-click to remove`
        : `Stop ${num}: ${label}`;
      if (isShaping) {
        wrap.style.cssText =
          'width:16px;height:16px;border-radius:999px;background:#ffffff;' +
          'border:3px solid #1a73e8;box-shadow:0 2px 6px rgba(32,33,36,0.32);cursor:grab;';
      } else {
        wrap.style.cssText =
          'width:24px;height:24px;border-radius:999px;background:#ffffff;color:#1a73e8;' +
          'font-family:var(--font-mono);font-size:11px;font-weight:600;display:grid;place-items:center;' +
          `border:2.5px solid #1a73e8;box-shadow:0 2px 7px rgba(32,33,36,0.3);${draggable ? 'cursor:grab;' : ''}`;
        wrap.textContent = String(num);
      }
      return wrap;
    };

    if (drawMode && customAnchors.length > 0) {
      customAnchors.forEach((anchor, idx) => {
        const isFirst = idx === 0;
        const isLast = idx === customAnchors.length - 1 && customAnchors.length > 1;
        const el = isFirst
          ? makePin('A', '#1a73e8', true)
          : isLast
            ? makePin('B', '#d93025', true)
            : makeStopPin(idx, anchor.label || `Point ${idx + 1}`, true, Boolean(anchor.isShapingPoint));
        el.title = `${anchor.label || `Point ${idx + 1}`} · Drag to move · Right-click to remove`;
        el.addEventListener('contextmenu', (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          latestRef.current.onRemoveDrawAnchor?.(anchor.id);
        });
        const marker = new maplibregl.Marker({ element: el, draggable: true })
          .setLngLat(anchor.coord)
          .addTo(map);
        marker.on('dragend', () => {
          const ll = marker.getLngLat();
          latestRef.current.onMoveDrawAnchor?.(anchor.id, [ll.lng, ll.lat]);
        });
        customAnchorMarkersRef.current.push(marker);
      });
      return;
    }

    if (originCoord) {
      originMarkerRef.current = new maplibregl.Marker({ element: makePin('A', '#1a73e8') })
        .setLngLat(originCoord)
        .addTo(map);
    }
    for (const wp of stopWaypoints) {
      const marker = new maplibregl.Marker({ element: makeStopPin(wp.index, wp.label) })
        .setLngLat(wp.coord)
        .addTo(map);
      stopMarkersRef.current.push(marker);
    }
    if (destCoord) {
      destMarkerRef.current = new maplibregl.Marker({ element: makePin('B', '#d93025') })
        .setLngLat(destCoord)
        .addTo(map);
    }
  }, [routeGeoJson, turnArrows, originCoord, destCoord, stopWaypoints, drawMode, customAnchors, mapReadySeq]);

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
        '<svg viewBox="0 0 44 44" width="44" height="44"><defs><linearGradient id="umCone" x1="0" y1="1" x2="0" y2="0"><stop offset="0%" stop-color="#1a73e8" stop-opacity="0.42"/><stop offset="100%" stop-color="#1a73e8" stop-opacity="0"/></linearGradient></defs><path d="M22 30 L7 4 Q22 -1 37 4 Z" fill="url(#umCone)"/></svg>';
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

  // Ensure initial GeoJSON data updates whenever loaded asynchronously
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    (map.getSource('um-boundary') as GeoJSONSource | undefined)?.setData(boundary);
    (map.getSource('um-faculties') as GeoJSONSource | undefined)?.setData(faculties);
    (map.getSource('um-buildings') as GeoJSONSource | undefined)?.setData(buildings);
    (map.getSource('um-rooms') as GeoJSONSource | undefined)?.setData(rooms);
    (map.getSource('um-roads') as GeoJSONSource | undefined)?.setData(context.roads);
    (map.getSource('um-jogging') as GeoJSONSource | undefined)?.setData(joggingRoutes);
    (map.getSource('um-transit') as GeoJSONSource | undefined)?.setData(transitGeoJson);
    (map.getSource('um-water') as GeoJSONSource | undefined)?.setData(context.water);
    (map.getSource('um-parks') as GeoJSONSource | undefined)?.setData(context.parks);
    (map.getSource('um-pois') as GeoJSONSource | undefined)?.setData(context.pois);
  }, [boundary, faculties, buildings, rooms, context, joggingRoutes, transitGeoJson, mapReadySeq]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      {(pickTarget || drawMode) && (
        <div className="pick-hint">
          <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 999, background: 'var(--primary)' }} />
          {drawMode
            ? customAnchors.length < 2
              ? 'Click the map to add route points'
              : 'Click to extend · Drag pins or drag the route line to snap'
            : pickTarget === 'origin'
              ? 'Select a starting point'
              : pickTarget === 'destination'
                ? 'Select a destination'
                : 'Select a stop on the map'}
        </div>
      )}
    </div>
  );
}
