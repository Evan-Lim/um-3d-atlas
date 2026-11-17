import { useState } from 'react';
import { Icon, type IconName } from './Icon';
import type { SearchItem } from '../types/map';

interface SavedPlacesSheetProps {
  open: boolean;
  savedItems: SearchItem[];
  recentItems: SearchItem[];
  onSelectItem: (item: SearchItem) => void;
  onNavigateToItem: (item: SearchItem) => void;
  onRemoveSaved: (itemKey: string) => void;
  onClearRecent: () => void;
  onSeedDefaults: () => void;
  onClose: () => void;
}

const KIND_ICON: Record<string, IconName> = {
  faculty: 'graduation',
  building: 'building',
  room: 'door',
  gate: 'pin',
  bus_stop: 'bus',
  rail_station: 'train',
  point: 'pin',
};

export function SavedPlacesSheet({
  open,
  savedItems,
  recentItems,
  onSelectItem,
  onNavigateToItem,
  onRemoveSaved,
  onClearRecent,
  onSeedDefaults,
  onClose,
}: SavedPlacesSheetProps) {
  const [tab, setTab] = useState<'saved' | 'recent'>('saved');

  if (!open) return null;

  const activeList = tab === 'saved' ? savedItems : recentItems;

  return (
    <aside className="saved-sheet m3-panel" aria-label="Saved places and recent history">
      <div className="panel-head">
        <div>
          <p className="m3-title">Saved & Recent</p>
          <p className="m3-caption">Bookmarked faculties, lecture rooms and transit stops</p>
        </div>
        <button type="button" className="m3-icon-btn m3-icon-btn--sm" onClick={onClose} aria-label="Close saved places">
          <Icon name="close" size={16} />
        </button>
      </div>

      <div style={{ padding: '0 18px 12px' }}>
        <div className="m3-segmented" role="tablist" aria-label="Saved or recent places">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'saved'}
            className={`m3-segmented__item${tab === 'saved' ? ' is-active' : ''}`}
            onClick={() => setTab('saved')}
          >
            <Icon name="bookmark" size={15} />
            <span>Saved ({savedItems.length})</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'recent'}
            className={`m3-segmented__item${tab === 'recent' ? ' is-active' : ''}`}
            onClick={() => setTab('recent')}
          >
            <Icon name="clock" size={15} />
            <span>Recent ({recentItems.length})</span>
          </button>
        </div>
      </div>

      <div className="saved-sheet__body m3-scroll">
        {activeList.length === 0 ? (
          <div className="saved-empty">
            <span className="saved-empty__icon">
              <Icon name={tab === 'saved' ? 'bookmark' : 'clock'} size={22} />
            </span>
            <p className="m3-subtitle">
              {tab === 'saved' ? 'No saved places yet' : 'No recent campus searches'}
            </p>
            <p className="m3-caption" style={{ maxWidth: 260, margin: '4px auto 14px' }}>
              {tab === 'saved'
                ? 'Save frequently visited faculties, lecture halls, or residential colleges for 1-tap access.'
                : 'Places you inspect or search for on the 3D campus map will appear here.'}
            </p>
            {tab === 'saved' && (
              <button type="button" className="m3-btn m3-btn--tonal m3-btn--sm" onClick={onSeedDefaults}>
                Add UM Campus Essentials
              </button>
            )}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {tab === 'recent' && (
              <div style={{ display: 'flex', justifyContent: 'flex-end', paddingBottom: 4 }}>
                <button type="button" className="m3-btn m3-btn--text m3-btn--sm" onClick={onClearRecent}>
                  Clear history
                </button>
              </div>
            )}
            {activeList.map((item) => {
              const key = `${item.kind}:${item.id}`;
              return (
                <div key={key} className="saved-item-card">
                  <button
                    type="button"
                    className="saved-item-card__main"
                    onClick={() => {
                      onSelectItem(item);
                    }}
                  >
                    <span className="search-result__icon">
                      <Icon name={KIND_ICON[item.kind] ?? 'pin'} size={17} />
                    </span>
                    <span style={{ minWidth: 0, flex: 1 }}>
                      <span className="search-result__title" style={{ display: 'block' }}>
                        {item.title}
                      </span>
                      <span className="search-result__sub" style={{ display: 'block' }}>
                        {item.subtitle}
                      </span>
                    </span>
                  </button>
                  <div className="saved-item-card__actions">
                    <button
                      type="button"
                      className="m3-icon-btn m3-icon-btn--sm m3-icon-btn--tonal"
                      onClick={() => onNavigateToItem(item)}
                      title="Directions here"
                      aria-label={`Directions to ${item.title}`}
                    >
                      <Icon name="directions" size={14} />
                    </button>
                    {tab === 'saved' && (
                      <button
                        type="button"
                        className="m3-icon-btn m3-icon-btn--sm"
                        onClick={() => onRemoveSaved(key)}
                        title="Remove from saved"
                        aria-label={`Remove ${item.title} from saved`}
                      >
                        <Icon name="close" size={14} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </aside>
  );
}
