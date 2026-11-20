export type RouteMode = 'walk' | 'bike' | 'bus' | 'drive';

export interface RouteStopSlot {
  id: string;
  item: SearchItem | null;
}

export type PickTarget = 'origin' | 'destination' | { stopId: string } | null;

export interface RouteWaypoint {
  index: number;
  label: string;
  coord: [number, number];
}

export interface ZoneTransitionEvent {
  id: number;
  type: 'enter' | 'leave' | 'cross';
  leavingZone: FacultyProps | null;
  enteringZone: FacultyProps | null;
}

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
  kind: 'road' | 'footway' | 'shortcut' | 'steps' | 'indoor' | 'bus' | 'waypoint';
  routeCode?: string;
  routeColor?: string;
  waypointIndex?: number;
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
  waypoints?: RouteWaypoint[];
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

export interface ElevationGridData {
  source: string;
  units: string;
  scale: number;
  minLon: number;
  maxLon: number;
  minLat: number;
  maxLat: number;
  cols: number;
  rows: number;
  minM: number;
  maxM: number;
  values: number[];
}

export interface ElevationProfilePoint {
  distanceM: number;
  elevationM: number;
  gradePct: number;
  coord: [number, number];
}

export interface RouteStepElevation {
  startElevationM: number;
  endElevationM: number;
  deltaM: number;
  gradePct: number;
  hillTag: 'steep-climb' | 'steep-descent' | null;
}

export interface RouteElevationProfile {
  totalGainM: number;
  totalDropM: number;
  minElevationM: number;
  maxElevationM: number;
  startElevationM: number;
  endElevationM: number;
  netChangeM: number;
  totalDistanceM: number;
  steepClimbCount: number;
  steepDescentCount: number;
  samples: ElevationProfilePoint[];
  waypointOffsets: {
    index: number;
    label: string;
    distanceM: number;
    elevationM: number;
  }[];
  stepElevations: (RouteStepElevation | null)[];
}

export type HeatLevel = 'cool' | 'warm' | 'hot' | 'very-hot' | 'extreme';
export type RainLevel = 'dry' | 'low' | 'possible' | 'likely' | 'raining';

export interface WeatherForecastSlot {
  hourLabel: string;
  hour24: number;
  tempC: number;
  feelsLikeC: number;
  rainChancePct: number;
  precipitationMm: number;
  uvIndex: number;
  heatLevel: HeatLevel;
  heatLabel: string;
  rainLevel: RainLevel;
}

export interface CampusWeatherReport {
  source: 'live' | 'estimate';
  fetchedAt: number;
  localTimeLabel: string;
  localHour24: number;
  isDay: boolean;
  conditionLabel: string;
  temperatureC: number;
  feelsLikeC: number;
  humidityPct: number;
  cloudCoverPct: number;
  windKmh: number;
  uvIndex: number;
  precipitationMm: number;
  heatLevel: HeatLevel;
  heatLabel: string;
  heatAdvice: string;
  rainChancePct: number;
  rainLevel: RainLevel;
  rainLabel: string;
  rainAdvice: string;
  routeAdvisory: string;
  hourlyOutlook: WeatherForecastSlot[];
}

