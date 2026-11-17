import { useEffect, useMemo, useState } from 'react';
import { Icon } from './Icon';
import type { TransitRoute, TransitStop } from '../types/map';

interface TransitHubModalProps {
  open: boolean;
  routes: TransitRoute[];
  highlightedRouteId: string | null;
  onHighlightRoute: (routeId: string | null) => void;
  onSelectStop: (stop: TransitStop, route: TransitRoute) => void;
  onNavigateToStop: (stop: TransitStop, route: TransitRoute) => void;
  onClose: () => void;
}

type OperatorFilter = 'all' | 'um' | 'rapidkl';

export function TransitHubModal({
  open,
  routes,
  highlightedRouteId,
  onHighlightRoute,
  onSelectStop,
  onNavigateToStop,
  onClose,
}: TransitHubModalProps) {
  const [filter, setFilter] = useState<OperatorFilter>('all');
  const [selectedRouteId, setSelectedRouteId] = useState<string>(routes[0]?.id ?? 'UM-AB');
  const [stopQuery, setStopQuery] = useState('');

  useEffect(() => {
    if (routes.length > 0 && !routes.some((r) => r.id === selectedRouteId)) {
      setSelectedRouteId(routes[0].id);
    }
  }, [routes, selectedRouteId]);

  useEffect(() => {
    if (highlightedRouteId) {
      setSelectedRouteId(highlightedRouteId);
    }
  }, [highlightedRouteId]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const filteredRoutes = useMemo(() => {
    return routes.filter((r) => {
      if (filter === 'um') return r.operator.toLowerCase().includes('um');
      if (filter === 'rapidkl') return r.operator.toLowerCase().includes('rapidkl');
      return true;
    });
  }, [routes, filter]);

  const activeRoute = useMemo(() => {
    return (
      filteredRoutes.find((r) => r.id === selectedRouteId) ??
      filteredRoutes[0] ??
      routes[0] ??
      null
    );
  }, [filteredRoutes, selectedRouteId, routes]);

  const totalRouteKm = useMemo(() => {
    if (!activeRoute) return '0.0';
    const sumM = activeRoute.leg_distances_m.reduce((acc, v) => acc + v, 0);
    return (sumM / 1000).toFixed(1);
  }, [activeRoute]);

  const filteredStops = useMemo(() => {
    if (!activeRoute) return [];
    const q = stopQuery.trim().toLowerCase();
    return activeRoute.stops.map((s, idx) => ({ stop: s, idx })).filter(({ stop }) => {
      if (!q) return true;
      return stop.name.toLowerCase().includes(q) || (stop.ref && stop.ref.toLowerCase().includes(q));
    });
  }, [activeRoute, stopQuery]);

  if (!open) return null;

  return (
    <div className="directory-scrim" onClick={onClose} role="presentation">
      <div
        className="directory transit-hub"
        role="dialog"
        aria-modal="true"
        aria-label="Campus Transit & Shuttle Explorer"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="directory__head">
          <div className="directory__head-text">
            <p className="m3-title">Campus Transit & Shuttle Hub</p>
            <p className="m3-caption">
              RapidKL MRT/LRT feeders (T789, T815) and free UM Campus Shuttles (AB, BA, C, D, E)
            </p>
          </div>

          <div className="directory__search">
            <Icon name="search" size={17} />
            <input
              value={stopQuery}
              onChange={(e) => setStopQuery(e.target.value)}
              placeholder="Search bus stops or ref code"
              aria-label="Search bus stops"
            />
            {stopQuery && (
              <button
                type="button"
                className="m3-icon-btn m3-icon-btn--sm"
                onClick={() => setStopQuery('')}
                aria-label="Clear stop search"
              >
                <Icon name="close" size={14} />
              </button>
            )}
          </div>

          <button
            type="button"
            className="m3-icon-btn directory__close"
            onClick={onClose}
            aria-label="Close transit hub"
          >
            <Icon name="close" size={18} />
          </button>
        </div>

        <div className="directory__tabs" role="tablist" aria-label="Transit operators">
          {(
            [
              { id: 'all', label: 'All Lines', count: routes.length },
              {
                id: 'um',
                label: 'UM Free Shuttles',
                count: routes.filter((r) => r.operator.toLowerCase().includes('um')).length,
              },
              {
                id: 'rapidkl',
                label: 'RapidKL Rail Feeders',
                count: routes.filter((r) => r.operator.toLowerCase().includes('rapidkl')).length,
              },
            ] as const
          ).map((t) => {
            const selected = filter === t.id;
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={selected}
                className={`m3-chip${selected ? ' is-selected' : ''}`}
                onClick={() => setFilter(t.id)}
              >
                {selected && <Icon name="check" size={14} />}
                <span>{t.label}</span>
                <span className="m3-mono" style={{ opacity: 0.72, fontSize: 11 }}>
                  {t.count}
                </span>
              </button>
            );
          })}

          {highlightedRouteId && (
            <button
              type="button"
              className="m3-btn m3-btn--text m3-btn--sm"
              style={{ marginLeft: 'auto' }}
              onClick={() => onHighlightRoute(null)}
            >
              Clear map highlight
            </button>
          )}
        </div>

        <div className="transit-hub__split">
          <div className="transit-hub__routes m3-scroll" role="listbox" aria-label="Bus routes">
            {filteredRoutes.map((route) => {
              const isSelected = activeRoute?.id === route.id;
              const isHighlighted = highlightedRouteId === route.id;
              return (
                <button
                  key={route.id}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  className={`transit-route-card${isSelected ? ' is-active' : ''}`}
                  onClick={() => setSelectedRouteId(route.id)}
                >
                  <div className="transit-route-card__top">
                    <span
                      className="transit-route-badge"
                      style={{ background: route.color, color: '#ffffff' }}
                    >
                      <Icon name="bus" size={13} />
                      {route.code}
                    </span>
                    <span className="m3-caption m3-mono">Every ~{route.headway_min}m</span>
                  </div>
                  <div className="transit-route-card__title">{route.name}</div>
                  <div className="transit-route-card__meta">
                    <span>{route.operator}</span>
                    <span aria-hidden="true">·</span>
                    <span>{route.stops.length} stops</span>
                  </div>
                  {isHighlighted && (
                    <div className="transit-route-card__pin">Highlighted on 3D map</div>
                  )}
                </button>
              );
            })}
          </div>

          {activeRoute && (
            <div className="transit-hub__detail m3-scroll">
              <div className="transit-detail-banner">
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span
                      className="transit-route-badge"
                      style={{ background: activeRoute.color, color: '#ffffff' }}
                    >
                      {activeRoute.code}
                    </span>
                    <span className="m3-caption">{activeRoute.operator}</span>
                  </div>
                  <h3 className="m3-subtitle" style={{ fontSize: 16 }}>
                    {activeRoute.name}
                  </h3>
                  <div className="transit-detail-stats">
                    <span>
                      <Icon name="clock" size={13} /> Every {activeRoute.headway_min} min
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>{activeRoute.hours}</span>
                    <span aria-hidden="true">·</span>
                    <span className="m3-mono">{totalRouteKm} km loop</span>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 8, flexShrink: 0, flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className={`m3-btn m3-btn--sm ${
                      highlightedRouteId === activeRoute.id ? 'm3-btn--tonal' : 'm3-btn--filled'
                    }`}
                    onClick={() => {
                      if (highlightedRouteId === activeRoute.id) {
                        onHighlightRoute(null);
                      } else {
                        onHighlightRoute(activeRoute.id);
                        onClose();
                      }
                    }}
                  >
                    <Icon name="layers" size={15} />
                    {highlightedRouteId === activeRoute.id ? 'Highlighted' : 'Highlight on map'}
                  </button>
                </div>
              </div>

              <div className="section">
                <div className="section__title">
                  <span>Stop Sequence ({filteredStops.length})</span>
                  <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>
                    Select a stop to inspect or route
                  </span>
                </div>

                <div className="transit-stop-timeline">
                  {filteredStops.map(({ stop, idx }) => {
                    const nextDist = activeRoute.leg_distances_m[idx];
                    return (
                      <div key={`${stop.name}-${idx}`} className="transit-stop-row">
                        <div className="transit-stop-row__rail">
                          <span
                            className="transit-stop-row__dot"
                            style={{ borderColor: activeRoute.color }}
                          />
                          {idx < activeRoute.stops.length - 1 && (
                            <span
                              className="transit-stop-row__line"
                              style={{ background: activeRoute.color }}
                            />
                          )}
                        </div>
                        <div className="transit-stop-row__body">
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div className="transit-stop-row__name">
                              <span className="m3-mono" style={{ opacity: 0.6, fontSize: 11, marginRight: 6 }}>
                                {String(idx + 1).padStart(2, '0')}
                              </span>
                              {stop.name}
                            </div>
                            <div className="transit-stop-row__sub">
                              {stop.ref ? `Stop ID ${stop.ref}` : 'Campus shuttle stop'}
                              {typeof nextDist === 'number' && nextDist > 0
                                ? ` · ${Math.round(nextDist)} m to next stop`
                                : ''}
                            </div>
                          </div>
                          <div className="transit-stop-row__actions">
                            <button
                              type="button"
                              className="m3-btn m3-btn--text m3-btn--sm"
                              onClick={() => {
                                onSelectStop(stop, activeRoute);
                                onClose();
                              }}
                            >
                              View
                            </button>
                            <button
                              type="button"
                              className="m3-btn m3-btn--tonal m3-btn--sm"
                              onClick={() => {
                                onNavigateToStop(stop, activeRoute);
                                onClose();
                              }}
                            >
                              <Icon name="directions" size={14} />
                              Go
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
