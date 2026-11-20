import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';
import type { CampusWeatherReport, HeatLevel, RainLevel } from '../types/map';

interface CampusConditionsBarProps {
  elevationM: number | null;
  elevationSource: 'gps' | 'place' | 'map';
  weather: CampusWeatherReport | null;
  weatherLoading: boolean;
  hasRightBanner: boolean;
  onRefreshWeather: () => void;
}

function heatToneClass(level: HeatLevel): string {
  if (level === 'extreme' || level === 'very-hot') return 'is-heat-high';
  if (level === 'hot') return 'is-heat-mid';
  if (level === 'warm') return 'is-heat-warm';
  return 'is-heat-cool';
}

function rainToneClass(level: RainLevel): string {
  if (level === 'raining' || level === 'likely') return 'is-rain-high';
  if (level === 'possible') return 'is-rain-mid';
  return 'is-rain-low';
}

function sourceLabel(src: 'gps' | 'place' | 'map'): string {
  if (src === 'gps') return 'Your GPS position';
  if (src === 'place') return 'Selected campus place';
  return 'Map centre';
}

export function CampusConditionsBar({
  elevationM,
  elevationSource,
  weather,
  weatherLoading,
  hasRightBanner,
  onRefreshWeather,
}: CampusConditionsBarProps) {
  const [expanded, setExpanded] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!expanded) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setExpanded(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setExpanded(false);
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [expanded]);

  if (elevationM === null && !weather) return null;

  const rainCompact =
    weather?.rainLevel === 'raining'
      ? 'Raining'
      : weather
        ? `${weather.rainChancePct}% rain`
        : '—';

  return (
    <div
      ref={rootRef}
      className={`conditions-dock${hasRightBanner ? ' has-banner-above' : ''}`}
      aria-label="Campus elevation and weather conditions"
    >
      <button
        type="button"
        className={`conditions-bar${expanded ? ' is-open' : ''}`}
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-label="Toggle elevation and weather comfort details"
      >
        {elevationM !== null && (
          <span className="conditions-bar__item">
            <Icon name="mountain" size={14} />
            <span className="m3-mono">{Math.round(elevationM)} m</span>
          </span>
        )}

        {elevationM !== null && weather && (
          <span className="conditions-bar__sep" aria-hidden="true">·</span>
        )}

        {weather && (
          <>
            <span className={`conditions-bar__item ${heatToneClass(weather.heatLevel)}`}>
              <Icon name={weather.isDay ? 'sun' : 'moon'} size={14} />
              <span>{weather.heatLabel}</span>
              <span className="m3-mono">{Math.round(weather.feelsLikeC)}°</span>
            </span>

            <span className="conditions-bar__sep" aria-hidden="true">·</span>

            <span className={`conditions-bar__item ${rainToneClass(weather.rainLevel)}`}>
              <Icon name={weather.rainLevel === 'raining' || weather.rainLevel === 'likely' ? 'cloudRain' : 'droplet'} size={13} />
              <span className="m3-mono">{rainCompact}</span>
            </span>
          </>
        )}

        <Icon
          name="chevronDown"
          size={13}
          className={`conditions-bar__chev${expanded ? ' is-rotated' : ''}`}
        />
      </button>

      {expanded && (
        <div className="conditions-popover m3-panel" role="dialog" aria-label="Campus conditions outlook">
          <div className="conditions-popover__head">
            <div>
              <p className="conditions-popover__title">UM Campus Conditions</p>
              <p className="conditions-popover__sub">
                {weather ? `${weather.localTimeLabel} · ${weather.conditionLabel}` : 'Universiti Malaya'}
              </p>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <button
                type="button"
                className="m3-icon-btn m3-icon-btn--sm"
                onClick={onRefreshWeather}
                disabled={weatherLoading}
                title="Refresh live weather"
                aria-label="Refresh live weather"
              >
                <Icon name="reset" size={14} />
              </button>
              <button
                type="button"
                className="m3-icon-btn m3-icon-btn--sm"
                onClick={() => setExpanded(false)}
                aria-label="Close conditions"
              >
                <Icon name="close" size={14} />
              </button>
            </div>
          </div>

          {elevationM !== null && (
            <div className="conditions-popover__elev">
              <div className="conditions-popover__elev-main">
                <Icon name="mountain" size={15} />
                <span>Elevation</span>
                <span className="conditions-popover__elev-val m3-mono">{elevationM.toFixed(1)} m ASL</span>
              </div>
              <span className="conditions-popover__elev-src">{sourceLabel(elevationSource)}</span>
            </div>
          )}

          {weather && (
            <>
              <div className="conditions-popover__grid">
                <div className="conditions-metric">
                  <div className="conditions-metric__eyebrow">
                    <Icon name="thermometer" size={13} />
                    <span>Heat level</span>
                  </div>
                  <div className={`conditions-metric__val ${heatToneClass(weather.heatLevel)}`}>
                    {weather.heatLabel}
                  </div>
                  <div className="conditions-metric__sub m3-mono">
                    Feels {weather.feelsLikeC.toFixed(0)}°C · Air {weather.temperatureC.toFixed(0)}°C
                  </div>
                  <div className="conditions-metric__sub">
                    Humidity {weather.humidityPct}% · UV {weather.uvIndex.toFixed(0)}
                  </div>
                </div>

                <div className="conditions-metric">
                  <div className="conditions-metric__eyebrow">
                    <Icon name="cloudRain" size={13} />
                    <span>Precipitation</span>
                  </div>
                  <div className={`conditions-metric__val ${rainToneClass(weather.rainLevel)}`}>
                    {weather.rainLabel}
                  </div>
                  <div className="conditions-metric__sub m3-mono">
                    {weather.rainChancePct}% chance
                    {weather.precipitationMm > 0 ? ` · ${weather.precipitationMm} mm` : ''}
                  </div>
                  <div className="conditions-metric__sub">
                    Clouds {weather.cloudCoverPct}% · Wind {weather.windKmh} km/h
                  </div>
                </div>
              </div>

              <p className="conditions-popover__advice">{weather.routeAdvisory}</p>

              {weather.hourlyOutlook.length > 0 && (
                <div className="conditions-hourly" aria-label="Next hours outlook">
                  {weather.hourlyOutlook.map((slot) => (
                    <div key={slot.hourLabel} className="conditions-hourly__cell">
                      <span className="conditions-hourly__time m3-mono">{slot.hourLabel}</span>
                      <span className={`conditions-hourly__temp m3-mono ${heatToneClass(slot.heatLevel)}`}>
                        {Math.round(slot.feelsLikeC)}°
                      </span>
                      <span className="conditions-hourly__heat">{slot.heatLabel}</span>
                      <span className={`conditions-hourly__rain m3-mono ${rainToneClass(slot.rainLevel)}`}>
                        {slot.rainChancePct}%
                      </span>
                    </div>
                  ))}
                </div>
              )}

              <div className="conditions-popover__foot">
                <span>
                  {weather.source === 'live'
                    ? 'Live Open-Meteo · UM (3.12°N, 101.65°E)'
                    : 'KL time-of-day estimate (offline fallback)'}
                </span>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
