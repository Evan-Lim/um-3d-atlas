import { Icon } from './Icon';

interface ZoneBannerProps {
  code?: string;
  title: string;
  subtitle: string;
  onClose: () => void;
}

/**
 * A quiet, semi-transparent Material surface that keeps the selected
 * faculty / residential college / institute name legible over the 3D map.
 */
export function ZoneBanner({ code, title, subtitle, onClose }: ZoneBannerProps) {
  return (
    <div className="zone-banner" role="status" aria-live="polite">
      {code && <span className="zone-banner__code">{code}</span>}
      <div className="zone-banner__body">
        <p className="zone-banner__title">{title}</p>
        <p className="zone-banner__meta">{subtitle}</p>
      </div>
      <button type="button" className="m3-icon-btn m3-icon-btn--sm" onClick={onClose} aria-label="Dismiss">
        <Icon name="close" size={16} />
      </button>
    </div>
  );
}
