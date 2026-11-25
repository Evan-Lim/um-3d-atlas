import {
  evaluateRuntimeEnvironment,
  getAtlasIdentity,
  type RuntimeEnvOverride,
} from './atlasProvenance';

export interface SelfHealingAttributionOptions {
  darkMode: boolean;
  envOverride?: RuntimeEnvOverride;
}

export interface SelfHealingAttributionHandle {
  updateDarkMode: (dark: boolean) => void;
  destroy: () => void;
}

function randomToken(): string {
  return Math.random().toString(36).slice(2, 8);
}

export function mountSelfHealingAttribution(
  options: SelfHealingAttributionOptions,
): SelfHealingAttributionHandle {
  if (typeof document === 'undefined' || !document.body) {
    return {
      updateDarkMode: () => {},
      destroy: () => {},
    };
  }

  let darkMode = options.darkMode;
  let destroyed = false;
  let hostEl: HTMLElement | null = null;
  let innerRoot: HTMLElement | null = null;
  let styleEl: HTMLStyleElement | null = null;
  let bodyObserver: MutationObserver | null = null;
  let attrObserver: MutationObserver | null = null;
  let intervalId: number | null = null;
  let healing = false;

  const identity = getAtlasIdentity();
  const env = evaluateRuntimeEnvironment(options.envOverride);
  const showBanner = env.shouldShowSourceBanner;

  const buildStyles = (dark: boolean): string => {
    if (showBanner) {
      // Non-blocking prominent source bar for foreign hosts / unauthorized wrapper iframes.
      // Outer host is pointer-events: none; ONLY the compact link surface accepts pointer events.
      const bg = dark ? 'rgba(20, 26, 36, 0.94)' : 'rgba(255, 255, 255, 0.95)';
      const border = dark ? 'rgba(168, 199, 250, 0.34)' : 'rgba(11, 87, 208, 0.24)';
      const text = dark ? '#E3E7F0' : '#1F2937';
      const accent = dark ? '#A8C7FA' : '#0B57D0';
      const shadow = dark
        ? '0 4px 16px rgba(0, 0, 0, 0.45)'
        : '0 4px 14px rgba(15, 23, 42, 0.14)';

      return `
        :host {
          all: initial;
          position: fixed !important;
          top: 8px !important;
          left: 0 !important;
          right: 0 !important;
          z-index: 2147483000 !important;
          display: flex !important;
          justify-content: center !important;
          pointer-events: none !important;
          visibility: visible !important;
          opacity: 1 !important;
          padding: 0 12px !important;
          box-sizing: border-box !important;
        }
        .wrap {
          pointer-events: auto;
          display: inline-flex;
          align-items: center;
          gap: 8px;
          max-width: min(560px, calc(100vw - 24px));
          height: 30px;
          padding: 0 12px;
          border-radius: 10px;
          background: ${bg};
          border: 1px solid ${border};
          box-shadow: ${shadow};
          backdrop-filter: blur(10px);
          -webkit-backdrop-filter: blur(10px);
          font-family: "Inter", "Roboto", system-ui, -apple-system, sans-serif;
          font-size: 11.5px;
          line-height: 1;
          color: ${text};
          text-decoration: none;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          transition: transform 140ms ease, border-color 140ms ease;
        }
        .wrap:hover {
          transform: translateY(-0.5px);
          border-color: ${accent};
        }
        .tag {
          font-weight: 700;
          letter-spacing: 0.01em;
          color: ${accent};
        }
        .sep {
          opacity: 0.45;
        }
        .meta {
          font-weight: 500;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .link {
          font-weight: 600;
          color: ${accent};
          flex-shrink: 0;
        }
      `;
    }

    // Official / trusted host: whisper-subtle unboxed cartographic attribution mark.
    // Completely non-blocking (pointer-events: none) and tucked beside the scale/attribution margin.
    const fg = dark ? 'rgba(214, 224, 240, 0.50)' : 'rgba(30, 41, 59, 0.48)';
    const halo = dark
      ? '0 1px 2px rgba(10, 14, 20, 0.72)'
      : '0 1px 2px rgba(255, 255, 255, 0.85)';

    return `
      :host {
        all: initial;
        position: fixed !important;
        left: 128px !important;
        bottom: 10px !important;
        z-index: 45 !important;
        display: block !important;
        pointer-events: none !important;
        visibility: visible !important;
        opacity: 1 !important;
        user-select: none !important;
        -webkit-user-select: none !important;
      }
      @media (max-width: 767px) {
        :host {
          left: auto !important;
          right: 12px !important;
          bottom: 78px !important;
        }
      }
      .mark {
        font-family: "Inter", "Roboto", system-ui, -apple-system, sans-serif;
        font-size: 10.5px;
        font-weight: 500;
        letter-spacing: 0.015em;
        line-height: 1.2;
        color: ${fg};
        text-shadow: ${halo};
        white-space: nowrap;
      }
    `;
  };

  const detachObservers = () => {
    bodyObserver?.disconnect();
    attrObserver?.disconnect();
    bodyObserver = null;
    attrObserver = null;
  };

  const mountFreshNode = () => {
    if (destroyed || !document.body) return;
    healing = true;
    try {
      detachObservers();
      if (hostEl && hostEl.parentNode) {
        hostEl.parentNode.removeChild(hostEl);
      }

      const el = document.createElement('div');
      // Non-semantic attribute so casual CSS selectors like [class*="watermark"] cannot target it.
      el.setAttribute(`data-m3-${randomToken()}`, '');
      el.setAttribute('aria-label', `${identity.brand} by ${identity.creator}`);

      const shadow = el.attachShadow({ mode: 'closed' });
      const style = document.createElement('style');
      style.textContent = buildStyles(darkMode);
      shadow.appendChild(style);

      if (showBanner) {
        const anchor = document.createElement('a');
        anchor.className = 'wrap';
        anchor.href = identity.canonicalUrl;
        anchor.target = '_blank';
        anchor.rel = 'noopener noreferrer';

        const tag = document.createElement('span');
        tag.className = 'tag';
        tag.textContent = identity.brand;

        const sep1 = document.createElement('span');
        sep1.className = 'sep';
        sep1.textContent = '·';

        const meta = document.createElement('span');
        meta.className = 'meta';
        meta.textContent = `Original by ${identity.creator}`;

        const sep2 = document.createElement('span');
        sep2.className = 'sep';
        sep2.textContent = '·';

        const link = document.createElement('span');
        link.className = 'link';
        link.textContent = `${identity.host} ↗`;

        anchor.append(tag, sep1, meta, sep2, link);
        shadow.appendChild(anchor);
        innerRoot = anchor;
      } else {
        const span = document.createElement('span');
        span.className = 'mark';
        span.textContent = identity.byline;
        shadow.appendChild(span);
        innerRoot = span;
      }

      document.body.appendChild(el);
      hostEl = el;
      styleEl = style;

      bodyObserver = new MutationObserver(() => {
        if (destroyed || healing) return;
        if (!hostEl || !hostEl.isConnected) {
          mountFreshNode();
        }
      });
      bodyObserver.observe(document.body, { childList: true });

      attrObserver = new MutationObserver(() => {
        if (destroyed || healing) return;
        checkIntegrity();
      });
      attrObserver.observe(el, {
        attributes: true,
        attributeFilter: ['style', 'class', 'hidden'],
      });
    } finally {
      healing = false;
    }
  };

  const checkIntegrity = () => {
    if (destroyed || healing || document.hidden) return;
    if (!hostEl || !hostEl.isConnected) {
      mountFreshNode();
      return;
    }

    const cs = window.getComputedStyle(hostEl);
    const rect = hostEl.getBoundingClientRect();
    const opacity = Number.parseFloat(cs.opacity || '1');
    const tampered =
      hostEl.hasAttribute('hidden') ||
      cs.display === 'none' ||
      cs.visibility === 'hidden' ||
      cs.visibility === 'collapse' ||
      Number.isNaN(opacity) ||
      opacity < 0.7 ||
      cs.clipPath === 'inset(100%)' ||
      rect.width < 8 ||
      rect.height < 6;

    if (tampered) {
      mountFreshNode();
    }
  };

  mountFreshNode();

  intervalId = window.setInterval(() => {
    checkIntegrity();
  }, 2400);

  return {
    updateDarkMode(dark: boolean) {
      if (destroyed) return;
      darkMode = dark;
      if (styleEl && innerRoot) {
        styleEl.textContent = buildStyles(darkMode);
      }
    },
    destroy() {
      destroyed = true;
      detachObservers();
      if (intervalId !== null) {
        window.clearInterval(intervalId);
        intervalId = null;
      }
      if (hostEl && hostEl.parentNode) {
        hostEl.parentNode.removeChild(hostEl);
      }
      hostEl = null;
      innerRoot = null;
      styleEl = null;
    },
  };
}
