import { useEffect, useMemo, useState } from 'react';
import { Icon } from './Icon';
import { useBottomSheetDrag } from '../hooks/useBottomSheetDrag';
import { zoneAccent, zoneKindLabel } from '../theme';
import { findNearbyStops } from '../utils/atlasUtils';
import type { BuildingProps, FacultyProps, RoomProps, SearchItem, TransitRoute } from '../types/map';

interface InspectorPanelProps {
  faculty: FacultyProps | null;
  building: BuildingProps | null;
  room: RoomProps | null;
  poi: SearchItem | null;
  facultyBuildings: BuildingProps[];
  buildingRooms: RoomProps[];
  transitRoutes: TransitRoute[];
  activeFloor: number | 'all';
  xrayEnabled: boolean;
  isSaved: boolean;
  onToggleSave: () => void;
  onSharePlace: () => void;
  onHighlightTransitRoute: (routeId: string) => void;
  onToggleXray: () => void;
  onSelectBuilding: (b: BuildingProps) => void;
  onSelectRoom: (r: RoomProps) => void;
  onSelectFloor: (fl: number | 'all') => void;
  onResetCampus: () => void;
  onClearBuilding: () => void;
  onClearRoom: () => void;
  onNavigateTo: (target: { kind: 'faculty' | 'building' | 'room' | 'poi'; id: string }) => void;
  onNavigateToCoord: (coord: [number, number], title: string) => void;
  onSetOrigin: (target: { kind: 'faculty' | 'building' | 'room' | 'poi'; id: string }) => void;
  onClose: () => void;
}

const POI_KIND_LABEL: Record<string, string> = {
  bus_stop: 'Bus stop',
  rail_station: 'Transit station',
  gate: 'Campus gate',
  point: 'Map point',
};

export function InspectorPanel({
  faculty,
  building,
  room,
  poi,
  facultyBuildings,
  buildingRooms,
  transitRoutes,
  activeFloor,
  xrayEnabled,
  isSaved,
  onToggleSave,
  onSharePlace,
  onHighlightTransitRoute,
  onToggleXray,
  onSelectBuilding,
  onSelectRoom,
  onSelectFloor,
  onResetCampus,
  onClearBuilding,
  onClearRoom,
  onNavigateTo,
  onNavigateToCoord,
  onSetOrigin,
  onClose,
}: InspectorPanelProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [roomFilter, setRoomFilter] = useState('');
  const selectionKey = `${faculty?.id ?? ''}|${building?.id ?? ''}|${room?.id ?? ''}|${poi?.id ?? ''}`;

  useEffect(() => {
    setCollapsed(false);
    setRoomFilter('');
  }, [selectionKey]);

  const { isDragging, dragStyle, handleProps } = useBottomSheetDrag(collapsed, setCollapsed);

  const targetCoord = room?.center ?? building?.center ?? poi?.center ?? faculty?.center ?? null;

  const nearbyStops = useMemo(() => {
    if (!targetCoord || poi?.kind === 'bus_stop') return [];
    return findNearbyStops(targetCoord, transitRoutes, 680, 3);
  }, [targetCoord, transitRoutes, poi?.kind]);

  if (!faculty && !building && !room && !poi) return null;

  const accent = faculty?.accent ?? zoneAccent(faculty?.zone_kind ?? poi?.zone_kind);
  const actionTarget = room
    ? { kind: 'room' as const, id: room.id }
    : building
      ? { kind: 'building' as const, id: building.id }
      : poi
        ? { kind: 'poi' as const, id: poi.id }
        : { kind: 'faculty' as const, id: faculty!.id };

  const floorsMap = new Map<number, RoomProps[]>();
  for (const r of buildingRooms) {
    const arr = floorsMap.get(r.floor) || [];
    arr.push(r);
    floorsMap.set(r.floor, arr);
  }
  const sortedFloors = Array.from(floorsMap.keys()).sort((a, b) => b - a);
  const rawRoomsForFloor = activeFloor === 'all' ? buildingRooms : floorsMap.get(activeFloor) ?? [];
  const roomsForFloor = roomFilter.trim()
    ? rawRoomsForFloor.filter((r) => {
        const q = roomFilter.trim().toLowerCase();
        return (
          r.name.toLowerCase().includes(q) ||
          r.code.toLowerCase().includes(q) ||
          r.room_type.toLowerCase().includes(q)
        );
      })
    : rawRoomsForFloor;

  const servingRoutes = poi
    ? transitRoutes.filter(
        (tr) =>
          poi.keywords.toLowerCase().includes(tr.code.toLowerCase()) ||
          tr.stops.some((s) => Math.hypot(s.coord[0] - poi.center[0], s.coord[1] - poi.center[1]) < 0.0012),
      )
    : [];

  const title = room?.name || building?.name || poi?.title || faculty?.name || '';
  const alt = faculty && building ? faculty.name : faculty?.name_ms;
  const code = faculty?.code ?? '';

  const compactSummary = room
    ? `${room.floor_label} · ${room.building_name}`
    : building
      ? `${building.levels} ${building.levels === 1 ? 'level' : 'levels'}${
          building.has_rooms ? ` · ${buildingRooms.length} rooms` : ''
        }${faculty ? ` · ${faculty.code}` : ''}`
      : poi
        ? servingRoutes.length > 0
          ? `${POI_KIND_LABEL[poi.kind] ?? 'Stop'} · ${servingRoutes.map((r) => r.code).join(', ')}`
          : poi.subtitle || POI_KIND_LABEL[poi.kind] || 'Place'
        : `${zoneKindLabel(faculty?.zone_kind)} · ${facultyBuildings.length} ${
            facultyBuildings.length === 1 ? 'building' : 'buildings'
          }`;

  return (
    <aside
      className={`inspector m3-panel${collapsed ? ' is-collapsed' : ''}${isDragging ? ' is-dragging' : ''}`}
      style={dragStyle}
      aria-label="Place details"
    >
      <div className="sheet-drag-zone" {...handleProps}>
        <button
          type="button"
          className="sheet-handle"
          aria-label={collapsed ? 'Expand details' : 'Collapse details'}
          aria-expanded={!collapsed}
        >
          <span className="sheet-handle__grip" />
        </button>

        <div className="crumbs">
          <button type="button" className="crumbs__btn" onClick={onResetCampus}>
            UM
          </button>
          {faculty && (
            <>
              <span className="crumbs__sep">/</span>
              <button type="button" className="crumbs__btn" onClick={onClose}>
                {faculty.code}
              </button>
            </>
          )}
          {building && (
            <>
              <span className="crumbs__sep">/</span>
              <button type="button" className="crumbs__btn" onClick={onClearBuilding}>
                {building.name}
              </button>
            </>
          )}
          {room && (
            <>
              <span className="crumbs__sep">/</span>
              <button type="button" className="crumbs__btn" onClick={onClearRoom}>
                {room.code}
              </button>
            </>
          )}
          {poi && (
            <>
              <span className="crumbs__sep">/</span>
              <span>{POI_KIND_LABEL[poi.kind] ?? 'Place'}</span>
            </>
          )}
        </div>

        <div className="inspector__head">
          <span
            className="zone-banner__code"
            style={{ background: accent, width: 'auto', minWidth: 40, height: 40, fontSize: 11.5 }}
          >
            {room ? room.code : building ? building.code || 'B' : poi ? <Icon name={poi.kind === 'bus_stop' ? 'bus' : poi.kind === 'rail_station' ? 'train' : 'pin'} size={17} /> : code}
          </span>
          <div className="inspector__head-body">
            <div className="inspector__kind">
              <span className="m3-meta-line">
                <span>
                  {room
                    ? room.floor_label
                    : building
                      ? 'Building'
                      : poi
                        ? POI_KIND_LABEL[poi.kind] ?? 'Place'
                        : zoneKindLabel(faculty?.zone_kind)}
                </span>
                {building?.has_rooms && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>Indoor 3D rooms</span>
                  </>
                )}
                {faculty?.established && !building && !room && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>Est. {faculty.established}</span>
                  </>
                )}
              </span>
            </div>
            <h2 className="inspector__name">{title}</h2>
            {alt && alt !== title && <p className="inspector__name-alt">{alt}</p>}
            {collapsed && <p className="sheet-peek-sub">{compactSummary}</p>}
          </div>
          <div className="sheet-head-actions">
            {collapsed && (
              <button
                type="button"
                className="m3-icon-btn m3-icon-btn--sm m3-icon-btn--filled"
                onClick={() => onNavigateTo(actionTarget)}
                aria-label="Directions"
                title="Directions"
              >
                <Icon name="directions" size={15} />
              </button>
            )}
            <button type="button" className="m3-icon-btn m3-icon-btn--sm" onClick={onClose} aria-label="Close details">
              <Icon name="close" size={16} />
            </button>
          </div>
        </div>
      </div>

      <div className="inspector__actions">
        <button type="button" className="m3-btn m3-btn--filled" onClick={() => onNavigateTo(actionTarget)}>
          <Icon name="directions" size={16} />
          Directions
        </button>
        <button type="button" className="m3-btn m3-btn--tonal" onClick={() => onSetOrigin(actionTarget)}>
          <Icon name="pin" size={16} />
          Set start
        </button>
        <button
          type="button"
          className={`m3-icon-btn ${isSaved ? 'm3-icon-btn--tonal' : 'm3-btn--outlined'}`}
          onClick={onToggleSave}
          title={isSaved ? 'Remove from saved' : 'Save place'}
          aria-label={isSaved ? 'Remove from saved places' : 'Save place'}
          aria-pressed={isSaved}
        >
          <Icon name={isSaved ? 'bookmarkFilled' : 'bookmark'} size={16} />
        </button>
        <button
          type="button"
          className="m3-icon-btn m3-btn--outlined"
          onClick={onSharePlace}
          title="Copy link to place"
          aria-label="Share link to place"
        >
          <Icon name="share" size={16} />
        </button>
      </div>

      <div className="inspector__scroll m3-scroll">
        {building?.has_rooms && (
          <div
            className="layer-row"
            style={{ background: 'var(--surface-low)', borderRadius: 14, padding: '8px 12px' }}
          >
            <span className="layer-row__label">
              <Icon name={xrayEnabled ? 'eye' : 'eyeOff'} size={15} />
              Cutaway shell
            </span>
            <label className="m3-switch">
              <input
                type="checkbox"
                checked={xrayEnabled}
                onChange={onToggleXray}
                aria-label="Cutaway building shell"
              />
              <span className="m3-switch__track" />
            </label>
          </div>
        )}

        {room && (
          <>
            <div className="meta-grid">
              <div className="meta-cell">
                <div className="meta-cell__label">Room type</div>
                <div className="meta-cell__value">{room.room_type.replace(/_/g, ' ')}</div>
              </div>
              <div className="meta-cell">
                <div className="meta-cell__label">Capacity</div>
                <div className="meta-cell__value m3-mono">{room.capacity || '—'}</div>
              </div>
              <div className="meta-cell">
                <div className="meta-cell__label">Floor</div>
                <div className="meta-cell__value">{room.floor_label}</div>
              </div>
              <div className="meta-cell">
                <div className="meta-cell__label">Source</div>
                <div className="meta-cell__value">{room.osm_verified ? 'OSM verified' : 'Directory'}</div>
              </div>
            </div>
            <div className="zone-description">
              <p>
                {room.building_name}
                {room.faculty_id ? ` · ${room.faculty_id}` : ''}
                {room.code ? ` · Room ${room.code}` : ''}
              </p>
            </div>
          </>
        )}

        {building && (
          <>
            <div className="meta-grid">
              <div className="meta-cell">
                <div className="meta-cell__label">Levels</div>
                <div className="meta-cell__value m3-mono">{building.levels}</div>
              </div>
              <div className="meta-cell">
                <div className="meta-cell__label">Height</div>
                <div className="meta-cell__value m3-mono">{Math.round(building.height)} m</div>
              </div>
              <div className="meta-cell">
                <div className="meta-cell__label">Category</div>
                <div className="meta-cell__value">{building.category.replace(/_/g, ' ')}</div>
              </div>
              <div className="meta-cell">
                <div className="meta-cell__label">Access</div>
                <div className="meta-cell__value">{building.wheelchair}</div>
              </div>
            </div>

            {building.has_rooms && (
              <div className="section">
                <div className="section__title">
                  <span>Indoor Rooms</span>
                  <span className="m3-mono" style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>
                    {roomsForFloor.length} / {buildingRooms.length}
                  </span>
                </div>

                {buildingRooms.length > 5 && (
                  <div className="m3-field m3-field--compact">
                    <Icon name="search" size={15} />
                    <input
                      value={roomFilter}
                      onChange={(e) => setRoomFilter(e.target.value)}
                      placeholder="Filter rooms by name, code or type"
                      aria-label="Filter rooms in building"
                    />
                    {roomFilter && (
                      <button
                        type="button"
                        className="m3-icon-btn m3-icon-btn--sm"
                        onClick={() => setRoomFilter('')}
                        aria-label="Clear room filter"
                      >
                        <Icon name="close" size={13} />
                      </button>
                    )}
                  </div>
                )}

                <div className="floor-strip">
                  <button
                    type="button"
                    className={`floor-chip${activeFloor === 'all' ? ' is-selected' : ''}`}
                    onClick={() => onSelectFloor('all')}
                  >
                    All
                  </button>
                  {sortedFloors.map((fl) => (
                    <button
                      key={fl}
                      type="button"
                      className={`floor-chip${activeFloor === fl ? ' is-selected' : ''}`}
                      onClick={() => onSelectFloor(fl)}
                    >
                      {floorsMap.get(fl)?.[0]?.floor_label || `L${fl}`}
                    </button>
                  ))}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {roomsForFloor.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      className={`room-row${room?.id === r.id ? ' is-selected' : ''}`}
                      onClick={() => onSelectRoom(r)}
                    >
                      <span className="room-row__icon">
                        <Icon name="door" size={15} />
                      </span>
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span className="m3-listitem__title" style={{ display: 'block' }}>
                          {r.name}
                        </span>
                        <span className="m3-listitem__meta" style={{ display: 'block' }}>
                          {r.floor_label} · {r.code}
                        </span>
                      </span>
                      <span className="room-row__type">{r.room_type.replace(/_/g, ' ')}</span>
                    </button>
                  ))}
                  {roomsForFloor.length === 0 && <p className="m3-caption">No matching rooms on this floor.</p>}
                </div>
              </div>
            )}

            {building.website && (
              <a className="link-inline" href={building.website} target="_blank" rel="noreferrer">
                <Icon name="external" size={13} />
                Building page
              </a>
            )}
          </>
        )}

        {faculty && !building && (
          <>
            {(faculty.capacity_stats || faculty.dean_or_office) && (
              <div className="m3-meta-line">
                {faculty.capacity_stats && <span>{faculty.capacity_stats}</span>}
                {faculty.capacity_stats && faculty.dean_or_office && <span aria-hidden="true">·</span>}
                {faculty.dean_or_office && <span>{faculty.dean_or_office}</span>}
              </div>
            )}

            {(faculty.description || faculty.history) && (
              <div className="zone-description">
                <p>{faculty.description}</p>
                {faculty.history && faculty.history !== faculty.description && (
                  <p style={{ marginTop: 8 }}>{faculty.history}</p>
                )}
              </div>
            )}

            {faculty.departments && faculty.departments.length > 0 && (
              <div className="section">
                <p className="section__title">Departments ({faculty.departments.length})</p>
                <div className="m3-text-list">
                  {faculty.departments.join(' · ')}
                </div>
              </div>
            )}

            {faculty.facilities && faculty.facilities.length > 0 && (
              <div className="section">
                <p className="section__title">Facilities</p>
                <div className="m3-text-list">
                  {faculty.facilities.join(' · ')}
                </div>
              </div>
            )}

            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              {faculty.website && (
                <a className="link-inline" href={faculty.website} target="_blank" rel="noreferrer">
                  <Icon name="external" size={13} />
                  Official portal
                </a>
              )}
              {faculty.contact_email && <span className="m3-caption">{faculty.contact_email}</span>}
            </div>

            <div className="section">
              <p className="section__title">
                <span>Buildings</span>
                <span className="m3-mono" style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>
                  {facultyBuildings.length}
                </span>
              </p>
              {facultyBuildings.map((b) => (
                <button key={b.id} type="button" className="zone-building" onClick={() => onSelectBuilding(b)}>
                  <span className="room-row__icon">
                    <Icon name="building" size={15} />
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span className="zone-building__title" style={{ display: 'block' }}>
                      {b.name}
                    </span>
                    <span className="zone-building__meta" style={{ display: 'block' }}>
                      {b.levels} {b.levels === 1 ? 'level' : 'levels'}
                      {b.has_rooms ? ' · 3D indoor rooms' : ''}
                    </span>
                  </span>
                  <Icon name="chevronRight" size={14} />
                </button>
              ))}
              {facultyBuildings.length === 0 && (
                <p className="m3-caption">No mapped buildings in this zone yet.</p>
              )}
            </div>
          </>
        )}

        {poi && (
          <>
            <div className="zone-description">
              <p>{poi.subtitle}</p>
            </div>
            {servingRoutes.length > 0 && (
              <div className="section">
                <p className="section__title">Serving bus & shuttle lines</p>
                {servingRoutes.map((tr) => (
                  <button
                    key={tr.id}
                    type="button"
                    className="zone-building"
                    onClick={() => onHighlightTransitRoute(tr.id)}
                  >
                    <span className="room-row__icon" style={{ background: tr.color, color: '#fff' }}>
                      <Icon name="bus" size={15} />
                    </span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span className="zone-building__title" style={{ display: 'block' }}>
                        {tr.code} · {tr.name}
                      </span>
                      <span className="zone-building__meta" style={{ display: 'block' }}>
                        {tr.operator} · every {tr.headway_min} min · {tr.hours}
                      </span>
                    </span>
                    <Icon name="chevronRight" size={14} />
                  </button>
                ))}
              </div>
            )}
          </>
        )}

        {nearbyStops.length > 0 && (
          <div className="section">
            <div className="section__title">
              <span>Nearest Transit Stops</span>
              <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>Walk access</span>
            </div>
            {nearbyStops.map((stop) => (
              <div key={`${stop.name}-${stop.coord[0]}`} className="nearby-stop-card">
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="nearby-stop-card__title">{stop.name}</div>
                  <div className="nearby-stop-card__meta">
                    <span className="m3-mono">{stop.distanceM} m</span>
                    <span aria-hidden="true">·</span>
                    <span>~{stop.walkMinutes} min walk</span>
                    {stop.ref && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="m3-mono">{stop.ref}</span>
                      </>
                    )}
                  </div>
                  <div className="nearby-stop-card__routes">
                    {stop.routes.map((r) => (
                      <button
                        key={r.id}
                        type="button"
                        className="transit-mini-pill"
                        style={{ borderColor: r.color, color: r.color }}
                        onClick={() => onHighlightTransitRoute(r.id)}
                        title={`Highlight ${r.name} on map`}
                      >
                        {r.code}
                      </button>
                    ))}
                  </div>
                </div>
                <button
                  type="button"
                  className="m3-icon-btn m3-icon-btn--sm m3-icon-btn--tonal"
                  onClick={() => onNavigateToCoord(stop.coord, stop.name)}
                  title={`Walk to ${stop.name}`}
                  aria-label={`Directions to ${stop.name}`}
                >
                  <Icon name="directions" size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}
