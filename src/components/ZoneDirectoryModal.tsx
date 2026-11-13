import { useEffect, useMemo, useState } from 'react';
import { Icon } from './Icon';
import { zoneKindLabel } from '../theme';
import type { FacultyProps } from '../types/map';

interface ZoneDirectoryModalProps {
  open: boolean;
  zones: FacultyProps[];
  activeZoneId?: string;
  onSelectZone: (zone: FacultyProps) => void;
  onClose: () => void;
}

type CategoryTab = 'all' | 'faculty' | 'college' | 'institute' | 'central';

const TABS: { id: CategoryTab; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'faculty', label: 'Faculties' },
  { id: 'college', label: 'KK' },
  { id: 'institute', label: 'Institutes' },
  { id: 'central', label: 'Landmarks' },
];

export function ZoneDirectoryModal({
  open,
  zones,
  activeZoneId,
  onSelectZone,
  onClose,
}: ZoneDirectoryModalProps) {
  const [activeTab, setActiveTab] = useState<CategoryTab>('all');
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const filteredZones = useMemo(() => {
    return zones.filter((z) => {
      if (activeTab === 'faculty' && z.zone_kind !== 'faculty') return false;
      if (activeTab === 'college' && z.zone_kind !== 'college') return false;
      if (activeTab === 'institute' && z.zone_kind !== 'institute' && z.zone_kind !== 'medical') return false;
      if (activeTab === 'central' && z.zone_kind !== 'landmark') return false;

      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase().trim();
      return (
        z.code.toLowerCase().includes(q) ||
        z.name.toLowerCase().includes(q) ||
        z.name_ms.toLowerCase().includes(q) ||
        z.category.toLowerCase().includes(q) ||
        (z.short_label && z.short_label.toLowerCase().includes(q)) ||
        (z.history && z.history.toLowerCase().includes(q))
      );
    });
  }, [zones, activeTab, searchQuery]);

  const counts = useMemo(
    () => ({
      all: zones.length,
      faculty: zones.filter((z) => z.zone_kind === 'faculty').length,
      college: zones.filter((z) => z.zone_kind === 'college').length,
      institute: zones.filter((z) => z.zone_kind === 'institute' || z.zone_kind === 'medical').length,
      central: zones.filter((z) => z.zone_kind === 'landmark').length,
    }),
    [zones],
  );

  if (!open) return null;

  return (
    <div className="directory-scrim" onClick={onClose} role="presentation">
      <div
        className="directory"
        role="dialog"
        aria-modal="true"
        aria-label="Campus directory"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="directory__head">
          <div className="directory__head-text">
            <p className="m3-title">Campus directory</p>
            <p className="m3-caption">Faculties, residential colleges, institutes and landmarks</p>
          </div>
          <div className="directory__search">
            <Icon name="search" size={17} />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter zones"
              aria-label="Filter zones"
            />
            {searchQuery && (
              <button
                type="button"
                className="m3-icon-btn m3-icon-btn--sm"
                onClick={() => setSearchQuery('')}
                aria-label="Clear filter"
              >
                <Icon name="close" size={14} />
              </button>
            )}
          </div>
          <button
            type="button"
            className="m3-icon-btn directory__close"
            onClick={onClose}
            aria-label="Close directory"
          >
            <Icon name="close" size={18} />
          </button>
        </div>

        <div className="directory__tabs" role="tablist">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              className={`m3-chip${activeTab === tab.id ? ' is-selected' : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
              <span style={{ opacity: 0.6, fontSize: 11 }}>{counts[tab.id]}</span>
            </button>
          ))}
        </div>

        <div className="directory__meta">
          <span>
            {filteredZones.length} {filteredZones.length === 1 ? 'zone' : 'zones'}
          </span>
          <span>Select a zone to highlight its buildings</span>
        </div>

        <div className="directory__grid m3-scroll">
          {filteredZones.map((z) => {
            const isActive = activeZoneId === z.id;
            return (
              <button
                key={z.id}
                type="button"
                className={`zone-card${isActive ? ' is-active' : ''}`}
                onClick={() => onSelectZone(z)}
              >
                <span className="zone-card__top">
                  <span className="zone-card__code">{z.code}</span>
                  <span className="zone-card__kind">{zoneKindLabel(z.zone_kind)}</span>
                </span>
                <span>
                  <span className="zone-card__name" style={{ display: 'block' }}>
                    {z.name}
                  </span>
                  {z.name_ms && z.name_ms !== z.name && (
                    <span className="zone-card__name-ms" style={{ display: 'block' }}>
                      {z.name_ms}
                    </span>
                  )}
                </span>
                <span className="zone-card__foot">
                  <span>
                    {z.established ? `Est. ${z.established}` : z.category}
                    {z.departments && z.departments.length > 0
                      ? ` · ${z.departments.length} departments`
                      : ''}
                  </span>
                  <span className="zone-card__open">
                    Open <Icon name="chevronRight" size={12} />
                  </span>
                </span>
              </button>
            );
          })}
          {filteredZones.length === 0 && (
            <div className="search-empty" style={{ gridColumn: '1 / -1' }}>
              No zones match this filter.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
