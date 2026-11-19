import type { FacultyProps } from './types/map';

/**
 * Shared visual language for the atlas.
 *
 * Every zone receives a very light tint plus a deeper accent from the same
 * tonal family. This keeps the map calm while still letting adjacent faculties,
 * residential colleges and institutes read as separate places.
 */
export type ZoneKind = NonNullable<FacultyProps['zone_kind']>;

export const ZONE_FILLS = [
  '#e8f0fe',
  '#e6f4ea',
  '#fef3e2',
  '#e8eef2',
  '#f3eee8',
  '#e4f2f1',
  '#f4f1e6',
  '#ebeef5',
  '#f6ecea',
  '#eaf3ea',
];

export const ZONE_ACCENTS = [
  '#1a73e8',
  '#1e7e4f',
  '#b06000',
  '#4c6b82',
  '#7a5c47',
  '#1d7a74',
  '#6e7039',
  '#4f658a',
  '#9c4a47',
  '#2e7d5b',
];

const KIND_FALLBACK: Record<string, string> = {
  faculty: '#1a73e8',
  college: '#6b5b47',
  institute: '#1d7a74',
  medical: '#c53929',
  landmark: '#2e7d5b',
};

export function zoneAccent(kind?: string | null): string {
  if (!kind) return KIND_FALLBACK.faculty;
  return KIND_FALLBACK[kind] ?? KIND_FALLBACK.faculty;
}

/** Assign a stable light fill + accent pair to each zone and its buildings. */
export function applyZonePalette(
  faculties: GeoJSON.FeatureCollection,
  buildings: GeoJSON.FeatureCollection,
): void {
  const accentById = new Map<string, string>();

  faculties.features.forEach((feature, index) => {
    if (!feature.properties) feature.properties = {};
    const props = feature.properties as Record<string, unknown>;
    const fill = ZONE_FILLS[index % ZONE_FILLS.length];
    const accent = ZONE_ACCENTS[index % ZONE_ACCENTS.length];
    props.color = fill;
    props.accent = accent;
    accentById.set(String(props.id ?? ''), accent);
  });

  for (const feature of buildings.features) {
    if (!feature.properties) feature.properties = {};
    const props = feature.properties as Record<string, unknown>;
    const accent = accentById.get(String(props.faculty_id ?? ''));
    if (accent) props.faculty_color = accent;
  }
}

export const ZONE_KIND_LABEL: Record<string, string> = {
  faculty: 'Faculty',
  college: 'Residential college',
  institute: 'Research institute',
  medical: 'Medical centre',
  landmark: 'Campus landmark',
};

export function zoneKindLabel(kind?: string | null): string {
  if (!kind) return 'Faculty';
  return ZONE_KIND_LABEL[kind] ?? 'Faculty';
}

export const SEARCH_KIND_LABEL: Record<string, string> = {
  faculty: 'Zone',
  building: 'Building',
  room: 'Room',
  gate: 'Gate',
  bus_stop: 'Bus stop',
  rail_station: 'Transit',
  point: 'Map point',
};

export function searchKindLabel(kind?: string | null): string {
  if (!kind) return '';
  return SEARCH_KIND_LABEL[kind] ?? '';
}
