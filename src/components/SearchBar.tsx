import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon, type IconName } from './Icon';
import type { SearchItem } from '../types/map';

export type SearchFilterChip =
  | 'all'
  | 'faculty'
  | 'college'
  | 'institute'
  | 'room'
  | 'transit'
  | 'gate';

interface SearchBarProps {
  items: SearchItem[];
  directionsOpen: boolean;
  navActive: boolean;
  activeChip: SearchFilterChip;
  onChangeChip: (chip: SearchFilterChip) => void;
  onSelectItem: (item: SearchItem) => void;
  onOpenDirections: () => void;
  /** Incrementing counter used by the navigation rail to focus the field. */
  focusSignal?: number;
}

const CHIPS: { id: SearchFilterChip; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'faculty', label: 'Faculties' },
  { id: 'college', label: 'KK' },
  { id: 'institute', label: 'Institutes' },
  { id: 'room', label: 'Rooms' },
  { id: 'transit', label: 'Transit' },
];

const ICON_FOR_KIND: Record<string, IconName> = {
  faculty: 'graduation',
  building: 'building',
  room: 'door',
  gate: 'pin',
  bus_stop: 'bus',
  rail_station: 'train',
  point: 'pin',
};

export function SearchBar({
  items,
  directionsOpen,
  navActive,
  activeChip,
  onChangeChip,
  onSelectItem,
  onOpenDirections,
  focusSignal = 0,
}: SearchBarProps) {
  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (focusSignal <= 0) return;
    inputRef.current?.focus();
    setFocused(true);
  }, [focusSignal]);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setFocused(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const chipFiltered = useMemo(() => {
    if (activeChip === 'all') return items;
    if (activeChip === 'faculty') {
      return items.filter((i) => i.kind === 'faculty' && (i.zone_kind === 'faculty' || !i.zone_kind));
    }
    if (activeChip === 'college') {
      return items.filter((i) => i.kind === 'faculty' && i.zone_kind === 'college');
    }
    if (activeChip === 'institute') {
      return items.filter(
        (i) =>
          (i.kind === 'faculty' &&
            (i.zone_kind === 'institute' || i.zone_kind === 'medical' || i.zone_kind === 'landmark')) ||
          (i.kind === 'building' && ['research', 'medical', 'library', 'admin'].includes(i.category || '')),
      );
    }
    if (activeChip === 'room') {
      return items.filter((i) => i.kind === 'room');
    }
    if (activeChip === 'transit') {
      return items.filter((i) => i.kind === 'rail_station' || i.kind === 'bus_stop');
    }
    return items.filter((i) => i.kind === 'gate');
  }, [items, activeChip]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      if (activeChip !== 'all') return chipFiltered.slice(0, 24);
      const featured = items.filter(
        (i) =>
          i.kind === 'rail_station' ||
          i.id === 'FSKTM' ||
          i.id === 'FK' ||
          i.id === 'KPPI' ||
          i.id === 'IAS' ||
          i.id === 'KK1' ||
          i.id === 'KK12' ||
          i.title.includes('Perpustakaan Utama') ||
          i.title.includes('Dewan Tunku Canselor'),
      );
      return featured.slice(0, 8);
    }

    const tokens = q.split(/\s+/).filter(Boolean);
    const scored: { item: SearchItem; score: number }[] = [];
    for (const it of chipFiltered) {
      const titleL = it.title.toLowerCase();
      const hay = `${titleL} ${it.subtitle.toLowerCase()} ${it.keywords}`;
      if (!tokens.every((t) => hay.includes(t))) continue;

      let score = 0;
      if (titleL === q) score += 120;
      else if (titleL.startsWith(q)) score += 75;
      else if (titleL.includes(q)) score += 45;
      else score += 20;

      if (it.kind === 'rail_station') score += 16;
      if (it.kind === 'faculty') score += 12;
      if (it.kind === 'building' && it.has_rooms) score += 8;
      if (it.kind === 'room') score += 5;

      scored.push({ item: it, score });
    }
    scored.sort((a, b) => b.score - a.score || a.item.title.localeCompare(b.item.title));
    return scored.slice(0, 20).map((s) => s.item);
  }, [query, activeChip, chipFiltered, items]);

  useEffect(() => {
    setHighlightIdx(0);
  }, [query, activeChip]);

  const pickItem = (item: SearchItem) => {
    onSelectItem(item);
    setQuery(item.title);
    setFocused(false);
  };

  if (navActive || directionsOpen) return null;

  const activeChipLabel = CHIPS.find((c) => c.id === activeChip)?.label ?? 'All';


  return (
    <div className="search-dock" ref={wrapRef}>
      <div className={`search-pill${focused ? ' is-open' : ''}`}>
        <Icon name="search" size={19} className="search-pill__lead" />
        <input
          ref={inputRef}
          className="search-pill__input"
          value={query}
          onFocus={() => setFocused(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setFocused(true);
          }}
          onKeyDown={(e) => {
            if (!focused || results.length === 0) {
              if (e.key === 'Escape') setFocused(false);
              return;
            }
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setHighlightIdx((i) => Math.min(i + 1, results.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setHighlightIdx((i) => Math.max(i - 1, 0));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              pickItem(results[highlightIdx]);
            } else if (e.key === 'Escape') {
              setFocused(false);
            }
          }}
          placeholder="Search buildings, rooms or zones"
          aria-label="Search Universiti Malaya"
          autoComplete="off"
          spellCheck={false}
        />

        {query && (
          <button
            type="button"
            className="m3-icon-btn m3-icon-btn--sm"
            onClick={() => {
              setQuery('');
              inputRef.current?.focus();
              setFocused(true);
            }}
            aria-label="Clear search"
          >
            <Icon name="close" size={15} />
          </button>
        )}

        <button
          type="button"
          className="m3-icon-btn m3-icon-btn--filled"
          onClick={onOpenDirections}
          title="Directions"
          aria-label="Open directions"
        >
          <Icon name="directions" size={17} />
        </button>
      </div>

      {focused && (
        <div className="search-results">
          <div className="search-results__head">
            <span>
              {query.trim()
                ? `${results.length} result${results.length === 1 ? '' : 's'}`
                : activeChip === 'all'
                  ? 'Suggested'
                  : `${activeChipLabel} · ${results.length}`}
            </span>
          </div>
          <div className="search-filter-row no-scrollbar" role="tablist" aria-label="Search filters">
            {CHIPS.map((c) => (
              <button
                key={c.id}
                type="button"
                role="tab"
                aria-selected={activeChip === c.id}
                className={`m3-chip${activeChip === c.id ? ' is-selected' : ''}`}
                onClick={() => onChangeChip(c.id)}
              >
                {c.label}
              </button>
            ))}
          </div>
          {results.length === 0 ? (
            <div className="search-empty">No matches. Try FSKTM, KK12, KPPI, IAS or “library”.</div>
          ) : (
            <div className="search-results__list m3-scroll">
              {results.map((it, idx) => (
                <button
                  key={`${it.kind}:${it.id}`}
                  type="button"
                  className={`search-result${idx === highlightIdx ? ' is-active' : ''}`}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pickItem(it);
                  }}
                  onMouseEnter={() => setHighlightIdx(idx)}
                >
                  <span className="search-result__icon">
                    <Icon name={ICON_FOR_KIND[it.kind] ?? 'pin'} size={17} />
                  </span>
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <span className="search-result__title" style={{ display: 'block' }}>
                      {it.title}
                    </span>
                    <span className="search-result__sub" style={{ display: 'block' }}>
                      {it.subtitle}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

