import type { FacultyProps } from './types/map';

/**
 * Shared visual language for the atlas.
 *
 * The campus data ships with a wide rainbow palette per zone. To keep the map
 * looking like a single designed product we translate every zone into one
 * restrained, tonal UM-blue family. The hue shifts slightly by zone type so
 * faculties, residential colleges and institutes remain distinguishable
 * without turning the map into confetti.
 */
export type ZoneKind = NonNullable<FacultyProps['zone_kind']>;

export const ZONE_ACCENTS: Record<string, string> = {
  faculty: '#2f5bb7',
  college: '#5468b8',
  institute: '#3d6c96',
  medical: '#5c6fa8',
  landmark: '#3a4a72',
};

export function zoneAccent(kind?: string | null): string {
  if (!kind) return ZONE_ACCENTS.faculty;
  return ZONE_ACCENTS[kind] ?? ZONE_ACCENTS.faculty;
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
