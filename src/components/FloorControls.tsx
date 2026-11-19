import { Icon } from './Icon';
import type { BuildingProps, RoomProps } from '../types/map';

interface FloorControlsProps {
  building: BuildingProps | null;
  rooms: RoomProps[];
  activeFloor: number | 'all';
  xrayEnabled: boolean;
  leftOffset?: number;
  bottomOffset?: number;
  onSelectFloor: (floor: number | 'all') => void;
  onToggleXray: () => void;
}

export function FloorControls({
  building,
  rooms,
  activeFloor,
  xrayEnabled,
  leftOffset = 104,
  bottomOffset = 68,
  onSelectFloor,
  onToggleXray,
}: FloorControlsProps) {
  if (!building || !building.has_rooms || rooms.length === 0) return null;

  const floorMap = new Map<number, string>();
  for (const r of rooms) {
    if (!floorMap.has(r.floor)) {
      floorMap.set(r.floor, r.floor_label || `L${r.floor}`);
    }
  }
  const floors = Array.from(floorMap.entries()).sort((a, b) => b[0] - a[0]);

  return (
    <div
      className="floor-ctl"
      style={{ left: leftOffset, bottom: bottomOffset }}
      aria-label="Indoor floor selector"
    >
      <button
        type="button"
        className={`floor-ctl__btn${xrayEnabled ? ' is-selected' : ''}`}
        onClick={onToggleXray}
        title={xrayEnabled ? 'Show solid building shell' : 'Cut away the shell to reveal rooms'}
        aria-label="Toggle building cutaway"
      >
        <Icon name={xrayEnabled ? 'eye' : 'eyeOff'} size={17} />
      </button>

      <span className="floor-ctl__sep" />

      <button
        type="button"
        className={`floor-ctl__btn${activeFloor === 'all' ? ' is-selected' : ''}`}
        onClick={() => onSelectFloor('all')}
        title="All floors"
        aria-label="All floors"
      >
        <Icon name="layers" size={16} />
      </button>

      {floors.map(([floorNum, label]) => {
        const shortLabel = floorNum === 0 ? 'G' : floorNum < 0 ? `B${Math.abs(floorNum)}` : `L${floorNum}`;
        return (
          <button
            key={floorNum}
            type="button"
            className={`floor-ctl__btn${activeFloor === floorNum ? ' is-selected' : ''}`}
            onClick={() => onSelectFloor(floorNum)}
            title={label}
            aria-label={label}
            aria-pressed={activeFloor === floorNum}
          >
            {shortLabel}
          </button>
        );
      })}
    </div>
  );
}
