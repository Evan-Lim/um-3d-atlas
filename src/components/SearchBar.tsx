import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon, type IconName } from './Icon';
import type { SearchItem } from '../types/map';
import type { RecommendedPlace } from '../utils/atlasUtils';

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
  savedKeys: string[];
  recentKeys: string[];
  directionsOpen: boolean;
  navActive: boolean;
  hasLeftSheet: boolean;
  activeChip: SearchFilterChip;
  recommendedPlaces: RecommendedPlace[];
  recommendationsNearby: boolean;
  onChangeChip: (chip: SearchFilterChip) => void;
  onSelectItem: (item: SearchItem) => void;
  onNavigateRecommendation: (rec: RecommendedPlace) => void;
  onOpenDirections: () => void;
  focusSignal?: number;
}

const CHIPS: { id: SearchFilterChip; label: string; icon: IconName }[] = [
  { id: 'all', label: 'All', icon: 'zones' },
  { id: 'faculty', label: 'Faculties', icon: 'graduation' },
  { id: 'college', label: 'Colleges (KK)', icon: 'building' },
  { id: 'institute', label: 'Institutes', icon: 'globe' },
  { id: 'room', label: 'Rooms', icon: 'door' },
  { id: 'transit', label: 'Transit', icon: 'bus' },
  { id: 'gate', label: 'Gates', icon: 'pin' },
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

const REC_ICON: Record<RecommendedPlace['category'], IconName> = {
  jogging: 'walk',
  faculty: 'graduation',
  landmark: 'pin',
  transit: 'train',
};

export function SearchBar({
  items,
  savedKeys,
  recentKeys,
  directionsOpen,
  navActive,
  hasLeftSheet,
  activeChip,
  recommendedPlaces,
  recommendationsNearby,
  onChangeChip,
  onSelectItem,
  onNavigateRecommendation,
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

  // Global "/" shortcut to focus the Material 3 search bar
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = (e.target as HTMLElement | null)?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      if (navActive || directionsOpen) return;
      e.preventDefault();
      inputRef.current?.focus();
      setFocused(true);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [navActive, directionsOpen]);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setFocused(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const savedSet = useMemo(() => new Set(savedKeys), [savedKeys]);
  const recentSet = useMemo(() => new Set(recentKeys), [recentKeys]);

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

      // Prioritize saved & recent items first when in "All" mode
      const prioritized: SearchItem[] = [];
      const seen = new Set<string>();
      for (const key of [...savedKeys, ...recentKeys]) {
        const found = items.find((i) => `${i.kind}:${i.id}` === key);
        if (found && !seen.has(key)) {
          seen.add(key);
          prioritized.push(found);
        }
      }

      const featured = items.filter(
        (i) =>
          !seen.has(`${i.kind}:${i.id}`) &&
          (i.kind === 'rail_station' ||
            i.id === 'FSKTM' ||
            i.id === 'FK' ||
            i.id === 'KPPI' ||
            i.id === 'IAS' ||
            i.id === 'KK1' ||
            i.id === 'KK12' ||
            i.title.includes('Perpustakaan Utama') ||
            i.title.includes('Dewan Tunku Canselor')),
      );
      return [...prioritized, ...featured].slice(0, 10);
    }

    const tokens = q.split(/\s+/).filter(Boolean);
    const scored: { item: SearchItem; score: number }[] = [];
    for (const it of chipFiltered) {
      const titleL = it.title.toLowerCase();
      const hay = `${titleL} ${it.subtitle.toLowerCase()} ${it.keywords}`;
      if (!tokens.every((t) => hay.includes(t))) continue;

      let score = 0;
      const idL = it.id.toLowerCase();
      if (it.kind === 'faculty' && idL === q) score += 220;
      else if (titleL === q) score += 160;
      else if (it.kind === 'faculty' && (titleL.includes(`(${q}`) || it.subtitle.toLowerCase().startsWith(q))) score += 150;
      else if (titleL.startsWith(q)) score += 85;
      else if (titleL.includes(q)) score += 45;
      else score += 20;

      const key = `${it.kind}:${it.id}`;
      if (savedSet.has(key)) score += 18;
      if (it.kind === 'faculty') score += 22;
      if (it.kind === 'rail_station') score += 16;
      if (it.kind === 'building' && it.has_rooms) score += 8;
      if (it.kind === 'room') score += 5;

      scored.push({ item: it, score });
    }
    scored.sort((a, b) => b.score - a.score || a.item.title.localeCompare(b.item.title));
    return scored.slice(0, 20).map((s) => s.item);
  }, [query, activeChip, chipFiltered, items, savedKeys, recentKeys, savedSet]);

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
          placeholder="Search faculties, KK, rooms or bus stops"
          aria-label="Search Universiti Malaya"
          autoComplete="off"
          spellCheck={false}
        />

        {!query && !focused && (
          <kbd className="search-pill__kbd" aria-hidden="true">
            /
          </kbd>
        )}

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

      {/* Persistent M3 Filter Chips Bar on map when dropdown & inspector are closed */}
      {!focused && !hasLeftSheet && (
        <>
          <div className="search-chips no-scrollbar" role="tablist" aria-label="Quick category filter">
            {CHIPS.map((c) => {
              const selected = activeChip === c.id;
              return (
                <button
                  key={c.id}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  className={`m3-chip m3-chip--elevated${selected ? ' is-selected' : ''}`}
                  onClick={() => {
                    onChangeChip(c.id);
                    setFocused(true);
                  }}
                >
                  <Icon name={selected ? 'check' : c.icon} size={14} />
                  <span>{c.label}</span>
                </button>
              );
            })}
          </div>

          {recommendedPlaces.length > 0 && (
            <div
              className="search-recs no-scrollbar"
              aria-label={recommendationsNearby ? 'Recommended places near your location' : 'Suggested campus directions'}
            >
              <span className="search-recs__label">
                {recommendationsNearby ? 'Near you' : 'Quick go'}
              </span>
              {recommendedPlaces.map((rec) => (
                <button
                  key={rec.id}
                  type="button"
                  className={`rec-chip${rec.category === 'jogging' ? ' rec-chip--jog' : ''}`}
                  onClick={() => onNavigateRecommendation(rec)}
                  title={`Get directions to ${rec.destination.title}`}
                >
                  <Icon name={REC_ICON[rec.category]} size={13} />
                  <span>{rec.label}</span>
                  {rec.distanceLabel && (
                    <span className="rec-chip__dist">{rec.distanceLabel}</span>
                  )}
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {focused && (
        <div className="search-results">
          <div className="search-results__head">
            <span>
              {query.trim()
                ? `${results.length} result${results.length === 1 ? '' : 's'}`
                : activeChip === 'all'
                  ? 'Suggested & Saved Places'
                  : `${activeChipLabel} · ${results.length}`}
            </span>
            <span className="m3-mono" style={{ fontSize: 10.5, opacity: 0.72 }}>
              ↑↓ Enter
            </span>
          </div>
          <div className="search-filter-row no-scrollbar" role="tablist" aria-label="Search filters">
            {CHIPS.map((c) => {
              const selected = activeChip === c.id;
              return (
                <button
                  key={c.id}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  className={`m3-chip${selected ? ' is-selected' : ''}`}
                  onClick={() => onChangeChip(c.id)}
                >
                  {selected && <Icon name="check" size={13} />}
                  <span>{c.label}</span>
                </button>
              );
            })}
          </div>
          {results.length === 0 ? (
            <div className="search-empty">No matches. Try FSKTM, KK12, KPPI, IAS or “library”.</div>
          ) : (
            <div className="search-results__list m3-scroll">
              {results.map((it, idx) => {
                const key = `${it.kind}:${it.id}`;
                const isSaved = savedSet.has(key);
                const isRecent = !isSaved && recentSet.has(key);
                return (
                  <button
                    key={key}
                    type="button"
                    className={`search-result${idx === highlightIdx ? ' is-active' : ''}`}
                    onMouseDown={(e) => {
                      e.preventDefault();
                    }}
                    onClick={() => pickItem(it)}
                    onMouseEnter={() => setHighlightIdx(idx)}
                  >
                    <span className="search-result__icon">
                      <Icon name={isSaved ? 'bookmarkFilled' : ICON_FOR_KIND[it.kind] ?? 'pin'} size={17} />
                    </span>
                    <span style={{ minWidth: 0, flex: 1 }}>
                      <span className="search-result__title" style={{ display: 'block' }}>
                        {it.title}
                      </span>
                      <span className="search-result__sub" style={{ display: 'block' }}>
                        {isSaved ? 'Saved · ' : isRecent ? 'Recent · ' : ''}
                        {it.subtitle}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
