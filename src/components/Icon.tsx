import type { CSSProperties, ReactNode } from 'react';

/**
 * Material 3 expressive stroke & filled glyph set for the UM 3D Atlas.
 */
export type IconName =
  | 'search'
  | 'directions'
  | 'layers'
  | 'reset'
  | 'zones'
  | 'building'
  | 'graduation'
  | 'door'
  | 'bus'
  | 'train'
  | 'pin'
  | 'close'
  | 'chevronRight'
  | 'chevronDown'
  | 'arrowUp'
  | 'swap'
  | 'checkCircle'
  | 'check'
  | 'locate'
  | 'pause'
  | 'play'
  | 'walk'
  | 'car'
  | 'accessible'
  | 'external'
  | 'eye'
  | 'eyeOff'
  | 'box'
  | 'database'
  | 'crosshair'
  | 'radio'
  | 'globe'
  | 'bookmark'
  | 'bookmarkFilled'
  | 'share'
  | 'sun'
  | 'moon'
  | 'clock'
  | 'compass';

const PATHS: Record<IconName, ReactNode> = {
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m16.4 16.4 4.6 4.6" />
    </>
  ),
  directions: (
    <path d="M3.6 11.2 20.4 3.4a.6.6 0 0 1 .8.8l-7.8 16.8a.6.6 0 0 1-1.1 0l-2.7-5.9-5.9-2.7a.6.6 0 0 1-.1-1.2Z" />
  ),
  layers: (
    <>
      <path d="m12 3 9 5-9 5-9-5 9-5Z" />
      <path d="m3 12.5 9 5 9-5" />
      <path d="m3 17 9 5 9-5" />
    </>
  ),
  reset: (
    <>
      <path d="M20 11a8 8 0 1 0-2.4 6.2" />
      <path d="M20 4v7h-7" />
    </>
  ),
  zones: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="2" />
      <rect x="14" y="3" width="7" height="7" rx="2" />
      <rect x="3" y="14" width="7" height="7" rx="2" />
      <rect x="14" y="14" width="7" height="7" rx="2" />
    </>
  ),
  building: (
    <>
      <rect x="4" y="3" width="16" height="18" rx="2.5" />
      <path d="M9 7h2M13 7h2M9 11h2M13 11h2M9 15h2M13 15h2" />
      <path d="M10 21v-2.5h4V21" />
    </>
  ),
  graduation: (
    <>
      <path d="m2.5 8.8 9.5-4.6 9.5 4.6-9.5 4.6-9.5-4.6Z" />
      <path d="M6.5 11.2v4.4c0 1.5 2.5 2.9 5.5 2.9s5.5-1.4 5.5-2.9v-4.4" />
      <path d="M21.5 8.8v5.4" />
    </>
  ),
  door: (
    <>
      <path d="M5 21V4.5A1.5 1.5 0 0 1 6.5 3h11A1.5 1.5 0 0 1 19 4.5V21" />
      <path d="M3 21h18" />
      <circle cx="15" cy="12" r="1" />
    </>
  ),
  bus: (
    <>
      <rect x="3.5" y="3.5" width="17" height="13" rx="3" />
      <path d="M3.5 10.5h17" />
      <path d="M7 16.5V19M17 16.5V19" />
      <circle cx="7.5" cy="13.5" r="0.9" />
      <circle cx="16.5" cy="13.5" r="0.9" />
    </>
  ),
  train: (
    <>
      <rect x="5" y="3" width="14" height="15" rx="4" />
      <path d="M5 11h14" />
      <circle cx="9" cy="14.5" r="0.9" />
      <circle cx="15" cy="14.5" r="0.9" />
      <path d="m8.5 21 1.7-3M15.5 21l-1.7-3M8 21h8" />
    </>
  ),
  pin: (
    <>
      <path d="M12 21s6.8-6 6.8-11a6.8 6.8 0 1 0-13.6 0C5.2 15 12 21 12 21Z" />
      <circle cx="12" cy="9.8" r="2.4" />
    </>
  ),
  close: <path d="M6 6l12 12M18 6 6 18" />,
  chevronRight: <path d="m9.5 5.5 6.5 6.5-6.5 6.5" />,
  chevronDown: <path d="m5.5 9.5 6.5 6.5 6.5-6.5" />,
  arrowUp: <path d="M12 20V4M6 10l6-6 6 6" />,
  swap: (
    <>
      <path d="M8 4.5v15M4 8.5l4-4 4 4" />
      <path d="M16 19.5v-15M12 15.5l4 4 4-4" />
    </>
  ),
  checkCircle: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m8.2 12.4 2.6 2.6 5-5.4" />
    </>
  ),
  check: <path d="m5 12.5 4.5 4.5 9.5-10" />,
  locate: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
      <circle cx="12" cy="12" r="7" />
    </>
  ),
  pause: <path d="M9 5v14M15 5v14" />,
  play: <path d="M8 5.2 19 12 8 18.8V5.2Z" />,
  walk: (
    <>
      <circle cx="13" cy="4.2" r="1.8" />
      <path d="M11 21.5 12.6 16 10 13.5l1.4-4.6 3.1 1.8 2.6 1.2" />
      <path d="M12.6 16l3 3.6M10 13.5l-2.6 3" />
    </>
  ),
  car: (
    <>
      <path d="M4.5 16.5 6 10.8A2.2 2.2 0 0 1 8.1 9.2h7.8a2.2 2.2 0 0 1 2.1 1.6l1.5 5.7" />
      <path d="M3 16.5h18v4h-2.5M6.5 20.5H3v-4" />
      <circle cx="7" cy="18.4" r="1.4" />
      <circle cx="17" cy="18.4" r="1.4" />
    </>
  ),
  accessible: (
    <>
      <circle cx="12" cy="4.6" r="1.8" />
      <path d="M5.5 9.2 12 10.8l6.5-1.6" />
      <path d="M12 10.8v4.4M12 15.2l-3.2 5.4M12 15.2l3.2 5.4" />
    </>
  ),
  external: (
    <>
      <path d="M14 4h6v6" />
      <path d="m20 4-8.5 8.5" />
      <path d="M19 14.5V19a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h4.5" />
    </>
  ),
  eye: (
    <>
      <path d="M2.5 12S6.2 5.5 12 5.5 21.5 12 21.5 12 17.8 18.5 12 18.5 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  eyeOff: (
    <>
      <path d="M10.6 6.2A9.6 9.6 0 0 1 12 6c5.8 0 9.5 6 9.5 6a16 16 0 0 1-2.4 3.1" />
      <path d="M6.4 7.6A16 16 0 0 0 2.5 12s3.7 6 9.5 6a9.4 9.4 0 0 0 4-.9" />
      <path d="M4 4l16 16" />
    </>
  ),
  box: (
    <>
      <path d="m12 3 8.5 4.6v8.8L12 21l-8.5-4.6V7.6L12 3Z" />
      <path d="m3.5 7.6 8.5 4.5 8.5-4.5M12 12.1V21" />
    </>
  ),
  database: (
    <>
      <ellipse cx="12" cy="5.5" rx="7.5" ry="2.8" />
      <path d="M4.5 5.5v6c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8v-6" />
      <path d="M4.5 11.5v6c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8v-6" />
    </>
  ),
  crosshair: (
    <>
      <circle cx="12" cy="12" r="7" />
      <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
    </>
  ),
  radio: (
    <>
      <circle cx="12" cy="12" r="2" />
      <path d="M7.8 16.2a6 6 0 0 1 0-8.4M16.2 7.8a6 6 0 0 1 0 8.4" />
      <path d="M4.9 19.1a10 10 0 0 1 0-14.2M19.1 4.9a10 10 0 0 1 0 14.2" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3.2 9.5h17.6M3.2 14.5h17.6" />
      <path d="M12 3c2.4 2.5 3.6 5.5 3.6 9s-1.2 6.5-3.6 9c-2.4-2.5-3.6-5.5-3.6-9S9.6 5.5 12 3Z" />
    </>
  ),
  bookmark: (
    <path d="M6 4.5A1.5 1.5 0 0 1 7.5 3h9A1.5 1.5 0 0 1 18 4.5v16l-6-3.8-6 3.8v-16Z" />
  ),
  bookmarkFilled: (
    <path
      d="M6 4.5A1.5 1.5 0 0 1 7.5 3h9A1.5 1.5 0 0 1 18 4.5v16l-6-3.8-6 3.8v-16Z"
      fill="currentColor"
    />
  ),
  share: (
    <>
      <circle cx="18" cy="5" r="2.5" />
      <circle cx="6" cy="12" r="2.5" />
      <circle cx="18" cy="19" r="2.5" />
      <path d="m8.3 13.3 7.4 4.4M15.7 6.3 8.3 10.7" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2.2M12 19.3v2.2M4.9 4.9l1.6 1.6M17.5 17.5l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.9 19.1l1.6-1.6M17.5 6.5l1.6-1.6" />
    </>
  ),
  moon: (
    <path d="M20.2 14.8A8.5 8.5 0 0 1 9.2 3.8a8.5 8.5 0 1 0 11 11Z" />
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3.2 2" />
    </>
  ),
  compass: (
    <>
      <circle cx="12" cy="12" r="9" />
      <polygon points="15.8,8.2 13.4,13.4 8.2,15.8 10.6,10.6" />
    </>
  ),
};

export interface IconProps {
  name: IconName;
  size?: number;
  strokeWidth?: number;
  className?: string;
  style?: CSSProperties;
}

export function Icon({ name, size = 20, strokeWidth = 1.75, className, style }: IconProps) {
  return (
    <svg
      className={className}
      style={style}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
