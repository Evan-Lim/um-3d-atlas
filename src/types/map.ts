export type RouteMode = 'walk' | 'bus' | 'drive';

export interface UserLocation {
  coord: [number, number];
  accuracy: number;
  timestamp: number;
}

export interface FacultyProps {
  id: string;
  code: string;
  zone_kind?: 'faculty' | 'college' | 'institute' | 'medical' | 'landmark';
  short_label?: string;
  name: string;
  name_ms: string;
  category: string;
  color: string;
  accent?: string;
  website: string;
  center: [number, number];
  zoom: number;
  pitch: number;
  bearing: number;
  description: string;
  osm_ref: string;
  established?: number | string;
  dean_or_office?: string;
  history?: string;
  departments?: string[];
  facilities?: string[];
  capacity_stats?: string;
  contact_email?: string;
  phone?: string;
}

export interface BuildingProps {
  id: string;
  name: string;
  name_ms: string;
  code: string;
  faculty_id: string;
  faculty_color: string;
  levels: number;
  height: number;
  category: string;
  is_canopy?: boolean;
  is_inferred_name?: boolean;
  wheelchair: string;
  website: string;
  center: [number, number];
  entrance_node: number;
  has_rooms: boolean;
}

export interface RoomProps {
  id: string;
  code: string;
  name: string;
  building_id: string;
  building_name: string;
  faculty_id: string;
  floor: number;
  floor_label: string;
  base_height: number;
  height: number;
  room_type: string;
  capacity: number;
  center: [number, number];
  source: string;
  osm_verified: boolean;
}

export interface SearchItem {
  id: string;
  kind: 'faculty' | 'building' | 'room' | 'gate' | 'bus_stop' | 'rail_station' | 'point';
  zone_kind?: 'faculty' | 'college' | 'institute' | 'medical' | 'landmark';
  title: string;
  subtitle: string;
  faculty_id?: string;
  building_id?: string;
  floor?: number;
  category?: string;
  room_type?: string;
  center: [number, number];
  entrance_node: number;
  has_rooms?: boolean;
  keywords: string;
}

export interface GraphData {
  // [lon, lat]
  nodes: [number, number][];
  // [u, v, dist_m, kind(0=road,1=footway,2=shortcut,3=steps), flags(1=drivable,2=accessible), name]
  edges: [number, number, number, number, number, string][];
}

export interface TransitStop {
  name: string;
  ref: string;
  coord: [number, number];
  walk_node: number;
}

export interface TransitRoute {
  id: string;
  code: string;
  name: string;
  operator: string;
  color: string;
  headway_min: number;
  hours: string;
  stops: TransitStop[];
  leg_distances_m: number[];
}

export interface TransitData {
  routes: TransitRoute[];
  geojson: GeoJSON.FeatureCollection;
}

export interface RouteStep {
  instruction: string;
  detail: string;
  distanceM: number;
  kind: 'road' | 'footway' | 'shortcut' | 'steps' | 'indoor' | 'bus';
  routeCode?: string;
  routeColor?: string;
  coord: [number, number];
}

export interface ComputedRoute {
  mode: RouteMode;
  stepFreeUsed: boolean;
  coordinates: [number, number][];
  segments: {
    coordinates: [number, number][];
    kind: 'road' | 'footway' | 'shortcut' | 'steps' | 'bus';
    color?: string;
    routeCode?: string;
  }[];
  totalDistanceM: number;
  estimatedMinutes: number;
  shortcutCount: number;
  stepsCount: number;
  busRoutesUsed: string[];
  steps: RouteStep[];
  originLabel: string;
  destLabel: string;
}

export interface MapLayerVisibility {
  boundary: boolean;
  faculties: boolean;
  roads: boolean;
  pathways: boolean;
  joggingRoutes: boolean;
  busRoutes: boolean;
  buildings3d: boolean;
  pois: boolean;
  labels: boolean;
}
