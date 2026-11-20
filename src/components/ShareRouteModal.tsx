import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';
import {
  copyCanvasPng,
  downloadCanvasPng,
  renderRouteCardToCanvas,
} from '../utils/routeImageExport';
import { slugifyRouteFilename } from '../utils/routeTools';
import type {
  ComputedRoute,
  RouteElevationProfile,
  RouteExportStyle,
  RouteOnlyBg,
  RouteWaypoint,
} from '../types/map';

interface ShareRouteModalProps {
  open: boolean;
  route: ComputedRoute | null;
  elevationProfile: RouteElevationProfile | null;
  waypoints: RouteWaypoint[];
  routeName: string;
  shareUrl: string;
  darkMode: boolean;
  getMapCanvas: () => HTMLCanvasElement | null;
  onChangeRouteName: (name: string) => void;
  onNotify: (msg: string) => void;
  onClose: () => void;
}

export function ShareRouteModal({
  open,
  route,
  elevationProfile,
  waypoints,
  routeName,
  shareUrl,
  darkMode,
  getMapCanvas,
  onChangeRouteName,
  onNotify,
  onClose,
}: ShareRouteModalProps) {
  const [exportStyle, setExportStyle] = useState<RouteExportStyle>('whole-map');
  const [routeOnlyBg, setRouteOnlyBg] = useState<RouteOnlyBg>('transparent');
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedPng, setCopiedPng] = useState(false);
  const [busy, setBusy] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!open || !route || !canvasRef.current) return;
    renderRouteCardToCanvas(canvasRef.current, {
      route,
      elevationProfile,
      routeName,
      exportStyle,
      routeOnlyBg,
      darkMode,
      mapCanvas: exportStyle === 'whole-map' ? getMapCanvas() : null,
      waypoints,
    });
  }, [open, route, elevationProfile, routeName, exportStyle, routeOnlyBg, darkMode, waypoints, getMapCanvas]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open || !route) return null;

  const handleCopyLink = async () => {
    try {
      window.history.replaceState(null, '', shareUrl);
      await navigator.clipboard.writeText(shareUrl);
      setCopiedLink(true);
      onNotify('Route link copied to clipboard');
      window.setTimeout(() => setCopiedLink(false), 2000);
    } catch {
      onNotify('Link ready — select and copy from the field');
    }
  };

  const handleCopyPng = async () => {
    if (!canvasRef.current || busy) return;
    setBusy(true);
    try {
      const ok = await copyCanvasPng(canvasRef.current);
      if (ok) {
        setCopiedPng(true);
        onNotify('Route PNG copied to clipboard');
        window.setTimeout(() => setCopiedPng(false), 2200);
      } else {
        await downloadCanvasPng(
          canvasRef.current,
          slugifyRouteFilename(routeName || `${route.originLabel}-to-${route.destLabel}`),
        );
        onNotify('Clipboard image copy unavailable here — downloaded PNG instead');
      }
    } catch {
      onNotify('Could not copy PNG to clipboard — try Download PNG');
    } finally {
      setBusy(false);
    }
  };

  const handleDownloadPng = async () => {
    if (!canvasRef.current || busy) return;
    setBusy(true);
    try {
      const filename = slugifyRouteFilename(
        routeName || `${route.originLabel}-to-${route.destLabel}`,
      );
      await downloadCanvasPng(canvasRef.current, filename);
      onNotify(`Downloaded ${filename}`);
    } finally {
      setBusy(false);
    }
  };

  const handleRefreshMapCapture = () => {
    if (!canvasRef.current || !route) return;
    renderRouteCardToCanvas(canvasRef.current, {
      route,
      elevationProfile,
      routeName,
      exportStyle,
      routeOnlyBg,
      darkMode,
      mapCanvas: getMapCanvas(),
      waypoints,
    });
  };

  return (
    <div
      className="directory-scrim"
      role="dialog"
      aria-modal="true"
      aria-label="Share and export route"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="directory share-modal">
        <div className="share-modal__head">
          <div style={{ minWidth: 0, flex: 1 }}>
            <h2 className="m3-title" style={{ fontSize: 19 }}>
              Share &amp; Export Route
            </h2>
            <p className="m3-caption">
              Give your route a custom name, share its link, or export a PNG route card
            </p>
          </div>
          <button
            type="button"
            className="m3-icon-btn m3-icon-btn--sm"
            onClick={onClose}
            aria-label="Close share dialog"
          >
            <Icon name="close" size={17} />
          </button>
        </div>

        <div className="share-modal__body m3-scroll">
          <div className="share-field">
            <label className="share-field__label" htmlFor="share-route-name">
              Route name
            </label>
            <input
              id="share-route-name"
              type="text"
              className="share-input"
              value={routeName}
              maxLength={64}
              onChange={(e) => onChangeRouteName(e.target.value)}
              placeholder={`${route.originLabel} → ${route.destLabel}`}
            />
          </div>

          <div className="share-field">
            <label className="share-field__label" htmlFor="share-route-url">
              Shareable link
            </label>
            <div className="share-url-row">
              <input
                id="share-route-url"
                type="text"
                readOnly
                className="share-input m3-mono"
                value={shareUrl}
                onFocus={(e) => e.currentTarget.select()}
              />
              <button
                type="button"
                className="m3-btn m3-btn--tonal m3-btn--sm"
                onClick={handleCopyLink}
              >
                <Icon name={copiedLink ? 'check' : 'copy'} size={14} />
                {copiedLink ? 'Copied' : 'Copy link'}
              </button>
            </div>
          </div>

          <div className="share-export-controls">
            <div className="share-export-controls__group">
              <span className="share-field__label">Image layout</span>
              <div className="m3-segmented" role="tablist" aria-label="Image export style">
                <button
                  type="button"
                  role="tab"
                  aria-selected={exportStyle === 'whole-map'}
                  className={`m3-segmented__item${exportStyle === 'whole-map' ? ' is-active' : ''}`}
                  onClick={() => setExportStyle('whole-map')}
                >
                  <Icon name="overview" size={14} />
                  Whole map
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={exportStyle === 'route-only'}
                  className={`m3-segmented__item${exportStyle === 'route-only' ? ' is-active' : ''}`}
                  onClick={() => setExportStyle('route-only')}
                >
                  <Icon name="draw" size={14} />
                  Route only
                </button>
              </div>
            </div>

            {exportStyle === 'route-only' ? (
              <div className="share-export-controls__group">
                <span className="share-field__label">Background</span>
                <div className="m3-segmented" role="tablist" aria-label="Route only background">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={routeOnlyBg === 'transparent'}
                    className={`m3-segmented__item${routeOnlyBg === 'transparent' ? ' is-active' : ''}`}
                    onClick={() => setRouteOnlyBg('transparent')}
                  >
                    Transparent
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={routeOnlyBg === 'light'}
                    className={`m3-segmented__item${routeOnlyBg === 'light' ? ' is-active' : ''}`}
                    onClick={() => setRouteOnlyBg('light')}
                  >
                    Light card
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={routeOnlyBg === 'dark'}
                    className={`m3-segmented__item${routeOnlyBg === 'dark' ? ' is-active' : ''}`}
                    onClick={() => setRouteOnlyBg('dark')}
                  >
                    Dark card
                  </button>
                </div>
              </div>
            ) : (
              <div className="share-export-controls__group" style={{ justifyContent: 'flex-end' }}>
                <span className="share-field__label">&nbsp;</span>
                <button
                  type="button"
                  className="m3-btn m3-btn--outlined m3-btn--sm"
                  onClick={handleRefreshMapCapture}
                  title="Re-capture current map camera view"
                >
                  <Icon name="reset" size={13} />
                  Re-capture view
                </button>
              </div>
            )}
          </div>

          <div
            className={`share-preview-frame${
              exportStyle === 'route-only' && routeOnlyBg === 'transparent'
                ? ' is-checkerboard'
                : ''
            }`}
          >
            <canvas
              ref={canvasRef}
              className="share-preview-canvas"
              aria-label="Route PNG export preview"
            />
          </div>
        </div>

        <div className="share-modal__foot">
          <span className="m3-caption" style={{ flex: 1, minWidth: 0 }}>
            Includes route name, distance, ETA, elevation profile, steps &amp; turns
          </span>
          <button
            type="button"
            className="m3-btn m3-btn--tonal m3-btn--sm"
            onClick={handleCopyPng}
            disabled={busy}
          >
            <Icon name={copiedPng ? 'check' : 'copy'} size={14} />
            {copiedPng ? 'Copied PNG' : 'Copy PNG'}
          </button>
          <button
            type="button"
            className="m3-btn m3-btn--filled m3-btn--sm"
            onClick={handleDownloadPng}
            disabled={busy}
          >
            <Icon name="download" size={14} />
            Download PNG
          </button>
        </div>
      </div>
    </div>
  );
}
