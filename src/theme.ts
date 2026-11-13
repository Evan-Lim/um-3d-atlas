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
  '#e3e9fb',
  '#e2eff7',
  '#e4f0e9',
  '#eae6f8',
  '#f7ebe4',
  '#e8eef3',
  '#f1ecf7',
  '#eef2e3',
  '#f8e9ee',
  '#e5f0f1',
];

export const ZONE_ACCENTS = [
  '#33549e',
  '#2c6a86',
  '#2f7666',
  '#5b52a0',
  '#8d5a3d',
  '#446c84',
  '#6b5a9e',
  '#66763f',
  '#944c66',
  '#38717a',
];

const KIND_FALLBACK: Record<string, string> = {
  faculty: '#33549e',
  college: '#5b52a0',
  institute: '#2c6a86',
  medical: '#446c84',
  landmark: '#66763f',
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
