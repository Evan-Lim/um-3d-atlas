import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { chromium } from '/usr/local/share/bun-global/node_modules/playwright-core/index.mjs';
import { DURATION_S, SCENE_CUTS, generateSoundtrack } from './synth-audio.mjs';

const CHROMIUM_EXEC =
  '/ms-playwright/chromium_headless_shell-1247/chrome-headless-shell-linux64/chrome-headless-shell';

const WIDTH = 1080;
const HEIGHT = 1920;
const FPS = 30;
const TOTAL_FRAMES = Math.round(DURATION_S * FPS); // 1050 frames exact

const TMP_DIR = path.resolve('promo-video/.tmp');
const FRAMES_DIR = path.join(TMP_DIR, 'frames');
const MANIFEST_PATH = path.join(TMP_DIR, 'manifest.json');
const SOUNDTRACK_WAV = path.join(TMP_DIR, 'soundtrack.wav');
const OUTPUT_MP4 = path.resolve('promo-video/um-3d-atlas-reel-9x16.mp4');

function buildCompositorHtml(manifest) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=1080, initial-scale=1.0" />
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500&family=Roboto+Mono:wght@400&display=swap" rel="stylesheet">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body {
    width: 1080px;
    height: 1920px;
    overflow: hidden;
    background: #F8FAFD;
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    -webkit-font-smoothing: antialiased;
    text-rendering: geometricPrecision;
  }

  #root {
    position: relative;
    width: 1080px;
    height: 1920px;
    background: #F8FAFD;
    overflow: hidden;
  }

  /* Solid opaque white Material 3 header band (Acts 1-9) */
  #header-band {
    position: absolute;
    top: 0;
    left: 0;
    width: 1080px;
    height: 248px;
    background: #FFFFFF;
    border-bottom: 1px solid #E2E8F0;
    box-shadow: 0 4px 20px rgba(15, 23, 42, 0.06);
    padding: 32px 52px 24px;
    z-index: 30;
    display: flex;
    flex-direction: column;
    justify-content: flex-start;
  }

  .progress-row {
    display: flex;
    gap: 8px;
    width: 100%;
    height: 4px;
  }
  .progress-seg {
    flex: 1;
    height: 4px;
    border-radius: 99px;
    background: #E8EEF6;
    overflow: hidden;
    position: relative;
  }
  .progress-seg-fill {
    position: absolute;
    top: 0; left: 0; bottom: 0;
    width: 0%;
    background: #1A73E8;
    border-radius: 99px;
  }

  .header-meta {
    margin-top: 22px;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  #hdr-kicker {
    font-size: 22px;
    font-weight: 500;
    color: #1A73E8;
    letter-spacing: -0.01em;
    line-height: 1.2;
  }
  #hdr-step {
    font-family: 'Roboto Mono', monospace;
    font-size: 18px;
    font-weight: 400;
    color: #64748B;
    font-variant-numeric: tabular-nums;
  }
  #hdr-title {
    margin-top: 8px;
    font-size: 46px;
    font-weight: 400;
    color: #1F1F1F;
    letter-spacing: -0.03em;
    line-height: 1.12;
  }
  #hdr-sub {
    margin-top: 8px;
    font-size: 23px;
    font-weight: 300;
    color: #444746;
    letter-spacing: -0.01em;
    line-height: 1.32;
  }

  /* Viewport container: switches cleanly between full-screen and cutaway frame */
  #stage-wrap {
    position: absolute;
    z-index: 10;
    overflow: hidden;
    background: #FFFFFF;
    transform-origin: center center;
  }
  #stage-wrap.mode-fullscreen {
    top: 248px;
    left: 0;
    width: 1080px;
    height: 1672px;
    border-radius: 0;
    border: none;
    box-shadow: none;
  }
  #stage-wrap.mode-cutaway {
    top: 274px;
    left: 135px;
    width: 810px;
    height: 1254px;
    border-radius: 26px;
    border: 1.5px solid #DCE3ED;
    box-shadow: 0 18px 44px rgba(15, 23, 42, 0.10), 0 2px 8px rgba(15, 23, 42, 0.04);
  }

  #stage-canvas {
    display: block;
    width: 100%;
    height: 100%;
  }

  /* Action Diagram Card (shown cleanly below cutaway in Acts 2, 4, 6, 9) */
  #diagram-card {
    position: absolute;
    left: 56px;
    top: 1554px;
    width: 968px;
    height: 320px;
    background: #FFFFFF;
    border: 1px solid #E2E8F0;
    border-radius: 24px;
    box-shadow: 0 6px 20px rgba(15, 23, 42, 0.05);
    padding: 26px 32px 24px;
    z-index: 20;
    display: none;
    flex-direction: column;
    justify-content: space-between;
  }

  .diag-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .diag-label {
    font-size: 19px;
    font-weight: 500;
    color: #444746;
    letter-spacing: -0.01em;
  }
  .diag-note {
    font-family: 'Roboto Mono', monospace;
    font-size: 16px;
    font-weight: 400;
    color: #5F6368;
    background: #F1F5F9;
    padding: 6px 14px;
    border-radius: 999px;
  }

  .diag-flow {
    display: flex;
    align-items: stretch;
    gap: 14px;
    margin-top: 14px;
    flex: 1;
  }
  .diag-node {
    flex: 1;
    border-radius: 18px;
    background: #F8FAFD;
    border: 1px solid #E2E8F0;
    padding: 18px 18px 16px;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
  }
  .diag-node.active {
    background: #EDF4FF;
    border-color: #1A73E8;
  }
  .diag-node.done {
    background: #FFFFFF;
    border-color: #CBD5E1;
  }
  .diag-node-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .diag-num {
    font-family: 'Roboto Mono', monospace;
    font-size: 15px;
    font-weight: 400;
    width: 30px;
    height: 30px;
    border-radius: 999px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #E8EEF6;
    color: #444746;
  }
  .diag-node.active .diag-num {
    background: #1A73E8;
    color: #FFFFFF;
  }
  .diag-node.done .diag-num {
    background: #E8F0FE;
    color: #1A73E8;
  }
  .diag-icon {
    width: 24px;
    height: 24px;
    color: #64748B;
  }
  .diag-node.active .diag-icon {
    color: #1A73E8;
  }
  .diag-node-title {
    margin-top: 12px;
    font-size: 21px;
    font-weight: 500;
    color: #1F1F1F;
    letter-spacing: -0.015em;
    line-height: 1.2;
  }
  .diag-node.active .diag-node-title {
    color: #1558B0;
  }
  .diag-node-desc {
    margin-top: 5px;
    font-size: 17px;
    font-weight: 300;
    color: #5F6368;
    line-height: 1.3;
  }
  .diag-arrow {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    flex-shrink: 0;
    color: #94A3B8;
  }
  .diag-arrow.lit {
    color: #1A73E8;
  }

  /* Subtle transition curtain for crisp cross-act handoff */
  #transition-veil {
    position: absolute;
    inset: 0;
    background: #F8FAFD;
    opacity: 0;
    pointer-events: none;
    z-index: 40;
  }

  /* Act 10: Clean Light Material 3 End Card */
  #end-card {
    position: absolute;
    inset: 0;
    background: #F8FAFD;
    z-index: 50;
    display: none;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 80px 72px;
    text-align: center;
  }
  .end-top-progress {
    position: absolute;
    top: 32px;
    left: 52px;
    right: 52px;
    display: flex;
    gap: 8px;
    height: 4px;
  }
  .end-emblem {
    width: 112px;
    height: 112px;
    border-radius: 30px;
    background: #1A73E8;
    color: #FFFFFF;
    font-size: 46px;
    font-weight: 500;
    letter-spacing: -0.04em;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 16px 36px rgba(26, 115, 232, 0.24);
  }
  .end-title {
    margin-top: 40px;
    font-size: 72px;
    font-weight: 400;
    color: #1F1F1F;
    letter-spacing: -0.035em;
    line-height: 1.08;
  }
  .end-sub {
    margin-top: 18px;
    font-size: 30px;
    font-weight: 300;
    color: #444746;
    letter-spacing: -0.015em;
    line-height: 1.35;
  }
  .end-chips {
    margin-top: 44px;
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 12px;
  }
  .end-chip {
    background: #FFFFFF;
    border: 1px solid #DCE3ED;
    border-radius: 999px;
    padding: 12px 24px;
    font-size: 20px;
    font-weight: 400;
    color: #3C4043;
  }
  .end-cta {
    margin-top: 52px;
    background: #1A73E8;
    color: #FFFFFF;
    border-radius: 999px;
    padding: 22px 48px;
    font-size: 27px;
    font-weight: 500;
    letter-spacing: -0.01em;
    box-shadow: 0 12px 28px rgba(26, 115, 232, 0.26);
  }
  .end-url-card {
    margin-top: 28px;
    background: #FFFFFF;
    border: 1px solid #DCE3ED;
    border-radius: 18px;
    padding: 18px 34px;
    font-family: 'Roboto Mono', monospace;
    font-size: 24px;
    font-weight: 400;
    color: #1F1F1F;
    letter-spacing: -0.01em;
  }
  .end-bio {
    margin-top: 32px;
    font-size: 22px;
    font-weight: 400;
    color: #5F6368;
    letter-spacing: 0.01em;
  }
</style>
</head>
<body>
<div id="root">
  <div id="header-band">
    <div class="progress-row" id="progress-row"></div>
    <div class="header-meta">
      <div id="hdr-kicker">UM 3D Atlas</div>
      <div id="hdr-step">01 / 09</div>
    </div>
    <div id="hdr-title">Universiti Malaya in 3D</div>
    <div id="hdr-sub">Interactive campus map built for everyday navigation</div>
  </div>

  <div id="stage-wrap" class="mode-fullscreen">
    <canvas id="stage-canvas" width="1080" height="1672"></canvas>
  </div>

  <div id="diagram-card">
    <div class="diag-top">
      <div class="diag-label" id="diag-label">Action flow</div>
      <div class="diag-note" id="diag-note">Live UI capture</div>
    </div>
    <div class="diag-flow" id="diag-flow"></div>
  </div>

  <div id="transition-veil"></div>

  <div id="end-card">
    <div class="end-top-progress" id="end-progress-row"></div>
    <div class="end-emblem" id="end-emblem">UM</div>
    <div class="end-title" id="end-title">UM 3D Atlas</div>
    <div class="end-sub" id="end-sub">Navigate Universiti Malaya in 3D</div>
    <div class="end-chips" id="end-chips">
      <div class="end-chip">KPS Indoor Cutaway</div>
      <div class="end-chip">Live 3D Road Nav</div>
      <div class="end-chip">Transit &amp; Trails</div>
    </div>
    <div class="end-cta" id="end-cta">Try UM 3D Atlas &rarr;</div>
    <div class="end-url-card" id="end-url">um-3d-atlas.netlify.app</div>
    <div class="end-bio" id="end-bio">Link in bio ^</div>
  </div>
</div>

<script>
window.__MANIFEST__ = ${JSON.stringify(manifest)};
window.__SCENE_CUTS__ = ${JSON.stringify(SCENE_CUTS)};
window.__DURATION_S__ = ${DURATION_S};

const ICONS = {
  search: '<svg class="diag-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  tap: '<svg class="diag-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="8" stroke-dasharray="3 3"/></svg>',
  pin: '<svg class="diag-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s7-5.5 7-11a7 7 0 1 0-14 0c0 5.5 7 11 7 11Z"/><circle cx="12" cy="10" r="2.5"/></svg>',
  moon: '<svg class="diag-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z"/></svg>',
  trail: '<svg class="diag-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 18c3-6 5-6 8 0s5 6 8 0"/><circle cx="5" cy="7" r="2"/><circle cx="19" cy="7" r="2"/></svg>',
  bookmark: '<svg class="diag-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4h12v16l-6-4-6 4V4Z"/></svg>',
  route: '<svg class="diag-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="6" r="2.5"/><path d="M8.5 18H13a3 3 0 0 0 0-6h-2a3 3 0 0 1 0-6h4.5"/></svg>',
  hill: '<svg class="diag-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 18 9.5 9l4.5 5 3-3.5L21 18H3Z"/></svg>',
  rain: '<svg class="diag-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 15h11a4 4 0 0 0 .5-7.97A5.5 5.5 0 0 0 6.8 6.5 3.5 3.5 0 0 0 6 15Z"/><path d="M9 19l-1 2M13 19l-1 2M17 19l-1 2"/></svg>',
  image: '<svg class="diag-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="m21 16-5-5-6 6"/></svg>',
  card: '<svg class="diag-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3" width="16" height="18" rx="3"/><path d="M8 8h8M8 12h8M8 16h5"/></svg>',
  link: '<svg class="diag-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.1 0l2.1-2.1a5 5 0 0 0-7.1-7.1L10.8 5"/><path d="M14 11a5 5 0 0 0-7.1 0L4.8 13.1a5 5 0 1 0 7.1 7.1l1.3-1.2"/></svg>',
  arrow: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m13 6 6 6-6 6"/></svg>',
};

const ACTS_META = [
  {
    kicker: 'UM 3D Atlas',
    title: 'Universiti Malaya in 3D',
    sub: 'Interactive campus map built for everyday navigation',
    mode: 'fullscreen',
  },
  {
    kicker: 'Search',
    title: 'Find any landmark fast',
    sub: 'Type KPS to jump straight to Kompleks Perdanasiswa',
    mode: 'cutaway',
    diagram: {
      label: 'Instant campus search',
      note: 'KPS · Perdanasiswa',
      nodes: [
        { icon: 'search', title: 'Type "KPS"', desc: 'Live campus index filters instantly' },
        { icon: 'tap', title: 'Tap result', desc: 'Pick Kompleks Perdanasiswa' },
        { icon: 'pin', title: '3D focus', desc: 'Fly straight to KPS detail sheet' },
      ],
    },
  },
  {
    kicker: 'Indoor view',
    title: 'Look inside KPS floors',
    sub: 'Cutaway 3D shell across Auditorium & student rooms',
    mode: 'fullscreen',
  },
  {
    kicker: 'Layers & theme',
    title: 'Light, dark & campus trails',
    sub: 'Switch appearance, jogging loops and saved places',
    mode: 'cutaway',
    diagram: {
      label: 'Personalize the campus map',
      note: 'Light ↔ Dark',
      nodes: [
        { icon: 'moon', title: 'Dark theme', desc: 'Switch basemap with one tap' },
        { icon: 'trail', title: 'Jogging loops', desc: 'Highlight campus fitness trails' },
        { icon: 'bookmark', title: 'Saved places', desc: 'Quick access to KPS, LIB & DTC' },
      ],
    },
  },
  {
    kicker: 'Transit hub',
    title: 'Shuttle & RapidKL lines',
    sub: 'Inspect bus routes and nearby campus stops',
    mode: 'fullscreen',
  },
  {
    kicker: 'Smart directions',
    title: 'Multi-stop, hills & weather',
    sub: 'Optimize stops, inspect elevation and rain forecast',
    mode: 'cutaway',
    diagram: {
      label: 'Plan multi-stop campus trips',
      note: 'LIB → KPS → DTC → FK',
      nodes: [
        { icon: 'route', title: 'Mode & optimize', desc: 'Switch Bike & reorder stops' },
        { icon: 'hill', title: 'Hill profile', desc: 'Preview campus elevation gain' },
        { icon: 'rain', title: 'Live weather', desc: 'Check rain comfort before going' },
      ],
    },
  },
  {
    kicker: 'Live navigation',
    title: 'Guided right on the road',
    sub: 'Painted road turn arrows, live GPS & ETA',
    mode: 'fullscreen',
  },
  {
    kicker: 'Custom routes',
    title: 'Draw & snap your path',
    sub: 'Snap custom points to campus roads in 3D',
    mode: 'fullscreen',
  },
  {
    kicker: 'Share & export',
    title: 'Share a link or PNG card',
    sub: 'Export whole map or clean route-only summary',
    mode: 'cutaway',
    diagram: {
      label: 'Export & share your route',
      note: 'PNG Card + URL',
      nodes: [
        { icon: 'image', title: 'Whole map PNG', desc: 'Full 3D campus snapshot' },
        { icon: 'card', title: 'Route-only card', desc: 'Clean Light card with steps' },
        { icon: 'link', title: 'Shareable URL', desc: 'Send exact stops in one link' },
      ],
    },
  },
  {
    kicker: 'End',
    title: 'UM 3D Atlas',
    sub: '',
    mode: 'endcard',
  },
];

// Build progress bars once
const progRow = document.getElementById('progress-row');
const endProgRow = document.getElementById('end-progress-row');
const progFills = [];
for (let i = 0; i < 10; i++) {
  const seg = document.createElement('div');
  seg.className = 'progress-seg';
  const fill = document.createElement('div');
  fill.className = 'progress-seg-fill';
  seg.appendChild(fill);
  progRow.appendChild(seg);
  progFills.push(fill);

  const es = document.createElement('div');
  es.className = 'progress-seg';
  const ef = document.createElement('div');
  ef.className = 'progress-seg-fill';
  ef.style.width = '100%';
  es.appendChild(ef);
  endProgRow.appendChild(es);
}

const IMAGE_CACHE = new Map();

function collectImageNames(manifest) {
  const set = new Set();
  for (const act of Object.values(manifest.acts)) {
    for (const [k, v] of Object.entries(act)) {
      if (k === 'boxes') continue;
      if (typeof v === 'string') set.add(v);
      else if (Array.isArray(v)) v.forEach((f) => set.add(f));
    }
  }
  return Array.from(set);
}

window.preloadAll = async function () {
  const names = collectImageNames(window.__MANIFEST__);
  await Promise.all(
    names.map(
      (name) =>
        new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = async () => {
            try {
              if (img.decode) await img.decode();
            } catch {}
            IMAGE_CACHE.set(name, img);
            resolve();
          };
          img.onerror = (e) => reject(new Error('Failed to load ' + name));
          img.src = '/frames/' + name;
        }),
    ),
  );
  if (document.fonts && document.fonts.ready) {
    await document.fonts.ready;
  }
  return names.length;
};

// Easing helpers
function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
function lerp(a, b, t) { return a + (b - a) * t; }
function easeOutCubic(t) { t = clamp01(t); return 1 - Math.pow(1 - t, 3); }
function easeInOutCubic(t) { t = clamp01(t); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
function easeOutQuart(t) { t = clamp01(t); return 1 - Math.pow(1 - t, 4); }
function range01(v, a, b) { return clamp01((v - a) / (b - a)); }

const canvas = document.getElementById('stage-canvas');
const ctx = canvas.getContext('2d', { alpha: false });
const stageWrap = document.getElementById('stage-wrap');
const headerBand = document.getElementById('header-band');
const diagramCard = document.getElementById('diagram-card');
const diagLabel = document.getElementById('diag-label');
const diagNote = document.getElementById('diag-note');
const diagFlow = document.getElementById('diag-flow');
const endCard = document.getElementById('end-card');
const transitionVeil = document.getElementById('transition-veil');
const hdrKicker = document.getElementById('hdr-kicker');
const hdrStep = document.getElementById('hdr-step');
const hdrTitle = document.getElementById('hdr-title');
const hdrSub = document.getElementById('hdr-sub');

let lastActIdx = -1;
let lastActiveDiagStep = -1;

function renderDiagramDOM(actIdx, activeStep) {
  const meta = ACTS_META[actIdx];
  if (!meta.diagram) {
    diagramCard.style.display = 'none';
    return;
  }
  diagramCard.style.display = 'flex';
  if (lastActIdx !== actIdx || lastActiveDiagStep !== activeStep) {
    diagLabel.textContent = meta.diagram.label;
    diagNote.textContent = meta.diagram.note;
    let html = '';
    meta.diagram.nodes.forEach((n, idx) => {
      const cls = idx === activeStep ? 'active' : idx < activeStep ? 'done' : '';
      html += \`
        <div class="diag-node \${cls}">
          <div class="diag-node-head">
            <div class="diag-num">\${idx + 1}</div>
            \${ICONS[n.icon] || ''}
          </div>
          <div>
            <div class="diag-node-title">\${n.title}</div>
            <div class="diag-node-desc">\${n.desc}</div>
          </div>
        </div>
      \`;
      if (idx < meta.diagram.nodes.length - 1) {
        html += \`<div class="diag-arrow \${idx < activeStep ? 'lit' : ''}">\${ICONS.arrow}</div>\`;
      }
    });
    diagFlow.innerHTML = html;
    lastActiveDiagStep = activeStep;
  }
}

function drawRoundedRect(c, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  c.beginPath();
  c.moveTo(x + rr, y);
  c.arcTo(x + w, y, x + w, y + h, rr);
  c.arcTo(x + w, y + h, x, y + h, rr);
  c.arcTo(x, y + h, x, y, rr);
  c.arcTo(x, y, x + w, y, rr);
  c.closePath();
}

/**
 * Draws a frame (or smoothly crossfaded pair of frames) with clamped optical camera zoom
 * locked onto normalized target (cx, cy), plus optional Material 3 tap ring & callout pill.
 */
function drawStageFrame({
  imgA,
  imgB = null,
  blend = 0,
  zoom = 1.0,
  focusX = 0.5,
  focusY = 0.5,
  tap = null, // { box, progress (0..1), label }
}) {
  const dstW = canvas.width;
  const dstH = canvas.height;
  const srcW = imgA.naturalWidth || 1080;
  const srcH = imgA.naturalHeight || 1672;

  const z = Math.max(1.0, zoom);
  const sw = srcW / z;
  const sh = srcH / z;
  const sx = Math.max(0, Math.min(srcW - sw, focusX * srcW - sw / 2));
  const sy = Math.max(0, Math.min(srcH - sh, focusY * srcH - sh / 2));

  ctx.clearRect(0, 0, dstW, dstH);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  ctx.globalAlpha = 1;
  ctx.drawImage(imgA, sx, sy, sw, sh, 0, 0, dstW, dstH);

  if (imgB && blend > 0.001) {
    ctx.globalAlpha = clamp01(blend);
    ctx.drawImage(imgB, sx, sy, sw, sh, 0, 0, dstW, dstH);
    ctx.globalAlpha = 1;
  }

  // Draw Material 3 button outline highlight + tap ring + clean action pill
  if (tap && tap.box && tap.progress > 0 && tap.progress < 1) {
    const p = tap.progress; // 0..1 across ~0.55s tap window
    const b = tap.box;

    // Project normalized box coordinates through the active zoomed viewport
    const bx = ((b.x * srcW - sx) / sw) * dstW;
    const by = ((b.y * srcH - sy) / sh) * dstH;
    const bw = ((b.w * srcW) / sw) * dstW;
    const bh = ((b.h * srcH) / sh) * dstH;
    const cx = ((b.cx * srcW - sx) / sw) * dstW;
    const cy = ((b.cy * srcH - sy) / sh) * dstH;

    // 1. Subtle crisp focus ring around exact tapped control
    const outlineAlpha = p < 0.2 ? p / 0.2 : p > 0.78 ? (1 - p) / 0.22 : 1;
    ctx.save();
    drawRoundedRect(ctx, bx - 5, by - 5, bw + 10, bh + 10, Math.min(18, (bh + 10) / 2));
    ctx.fillStyle = \`rgba(26, 115, 232, \${(0.11 * outlineAlpha).toFixed(3)})\`;
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = \`rgba(26, 115, 232, \${(0.82 * outlineAlpha).toFixed(3)})\`;
    ctx.stroke();
    ctx.restore();

    // 2. Expanding Material 3 ripple ring (starts at p = 0.16)
    if (p >= 0.14) {
      const rp = clamp01((p - 0.14) / 0.72);
      const rOuter = lerp(16, 72, easeOutCubic(rp));
      const rInner = lerp(12, 46, easeOutCubic(rp));
      const aRipple = (1 - rp) * 0.45;
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, rOuter, 0, Math.PI * 2);
      ctx.fillStyle = \`rgba(26, 115, 232, \${(aRipple * 0.32).toFixed(3)})\`;
      ctx.fill();
      ctx.lineWidth = 3.2;
      ctx.strokeStyle = \`rgba(26, 115, 232, \${aRipple.toFixed(3)})\`;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(cx, cy, rInner, 0, Math.PI * 2);
      ctx.lineWidth = 2;
      ctx.strokeStyle = \`rgba(26, 115, 232, \${(aRipple * 0.75).toFixed(3)})\`;
      ctx.stroke();
      ctx.restore();
    }

    // 3. Crisp center touch dot with white halo (tactile press shrink at p ~ 0.22)
    const dotAlpha = p < 0.12 ? p / 0.12 : p > 0.75 ? (1 - p) / 0.25 : 1;
    const pressScale = p >= 0.15 && p <= 0.35 ? 1 - 0.22 * Math.sin(((p - 0.15) / 0.20) * Math.PI) : 1;
    const dotR = 13 * pressScale;
    ctx.save();
    ctx.globalAlpha = clamp01(dotAlpha);
    ctx.beginPath();
    ctx.arc(cx, cy, dotR + 4, 0, Math.PI * 2);
    ctx.fillStyle = '#FFFFFF';
    ctx.shadowColor = 'rgba(15, 23, 42, 0.22)';
    ctx.shadowBlur = 10;
    ctx.shadowOffsetY = 3;
    ctx.fill();

    ctx.shadowColor = 'transparent';
    ctx.beginPath();
    ctx.arc(cx, cy, dotR, 0, Math.PI * 2);
    ctx.fillStyle = '#1A73E8';
    ctx.fill();
    ctx.restore();

    // 4. Clean Material 3 floating action pill naming the tapped action
    if (tap.label) {
      const pillAlpha = p < 0.16 ? p / 0.16 : p > 0.80 ? (1 - p) / 0.20 : 1;
      ctx.save();
      ctx.globalAlpha = clamp01(pillAlpha);
      ctx.font = '500 22px Inter, -apple-system, sans-serif';
      const tw = ctx.measureText(tap.label).width;
      const pw = tw + 34;
      const ph = 46;
      const placeAbove = by > 130;
      const py = placeAbove ? Math.max(24, by - ph - 18) : Math.min(dstH - ph - 24, by + bh + 18);
      const px = Math.max(24, Math.min(dstW - pw - 24, cx - pw / 2));

      ctx.shadowColor = 'rgba(15, 23, 42, 0.20)';
      ctx.shadowBlur = 16;
      ctx.shadowOffsetY = 5;
      drawRoundedRect(ctx, px, py, pw, ph, 999);
      ctx.fillStyle = '#1F1F1F';
      ctx.fill();

      ctx.shadowColor = 'transparent';
      ctx.fillStyle = '#FFFFFF';
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'center';
      ctx.fillText(tap.label, px + pw / 2, py + ph / 2 + 0.5);
      ctx.restore();
    }
  }
}

/**
 * Helper to pick interpolated pair (imgA, imgB, blend) from a smooth frame sequence
 */
function sampleSequence(seq, normT) {
  const t = clamp01(normT);
  const pos = t * (seq.length - 1);
  const i0 = Math.floor(pos);
  const i1 = Math.min(seq.length - 1, i0 + 1);
  return {
    imgA: IMAGE_CACHE.get(seq[i0]),
    imgB: i1 !== i0 ? IMAGE_CACHE.get(seq[i1]) : null,
    blend: pos - i0,
  };
}

function getImg(name) {
  return IMAGE_CACHE.get(name);
}

window.renderFrame = function (t) {
  const cuts = window.__SCENE_CUTS__;
  const durTotal = window.__DURATION_S__;
  const M = window.__MANIFEST__.acts;

  // Determine active act index (0..9)
  let actIdx = cuts.length - 1;
  for (let i = 0; i < cuts.length - 1; i++) {
    if (t >= cuts[i] && t < cuts[i + 1]) {
      actIdx = i;
      break;
    }
  }
  const actStart = cuts[actIdx];
  const actEnd = actIdx < cuts.length - 1 ? cuts[actIdx + 1] : durTotal;
  const actDur = Math.max(0.001, actEnd - actStart);
  const lt = t - actStart; // local time in act
  const p = clamp01(lt / actDur);

  // Update 10-segment progress bar
  for (let i = 0; i < 10; i++) {
    if (i < actIdx) progFills[i].style.width = '100%';
    else if (i > actIdx) progFills[i].style.width = '0%';
    else progFills[i].style.width = (p * 100).toFixed(2) + '%';
  }

  // Soft crisp transition veil at act boundaries (0.12s out / 0.14s in)
  let veil = 0;
  if (actIdx > 0 && lt < 0.14) {
    veil = (1 - easeOutCubic(lt / 0.14)) * 0.72;
  } else if (actIdx < 9 && actEnd - t < 0.11) {
    veil = easeInOutCubic(1 - (actEnd - t) / 0.11) * 0.72;
  }
  transitionVeil.style.opacity = veil.toFixed(3);

  // Act 10: Clean Light Material 3 End Card
  if (actIdx === 9) {
    headerBand.style.display = 'none';
    stageWrap.style.display = 'none';
    diagramCard.style.display = 'none';
    endCard.style.display = 'flex';

    const items = [
      { id: 'end-emblem', d: 0.0 },
      { id: 'end-title', d: 0.10 },
      { id: 'end-sub', d: 0.18 },
      { id: 'end-chips', d: 0.28 },
      { id: 'end-cta', d: 0.40 },
      { id: 'end-url', d: 0.52 },
      { id: 'end-bio', d: 0.64 },
    ];
    for (const it of items) {
      const el = document.getElementById(it.id);
      const e = easeOutQuart(range01(lt, it.d, it.d + 0.55));
      el.style.opacity = e.toFixed(3);
      el.style.transform = \`translateY(\${((1 - e) * 26).toFixed(1)}px)\`;
    }
    lastActIdx = actIdx;
    return;
  }

  // Feature Acts 1–9
  endCard.style.display = 'none';
  headerBand.style.display = 'flex';
  stageWrap.style.display = 'block';

  const meta = ACTS_META[actIdx];
  if (lastActIdx !== actIdx) {
    hdrKicker.textContent = meta.kicker;
    hdrStep.textContent = String(actIdx + 1).padStart(2, '0') + ' / 09';
    hdrTitle.textContent = meta.title;
    hdrSub.textContent = meta.sub;
    stageWrap.className = meta.mode === 'cutaway' ? 'mode-cutaway' : 'mode-fullscreen';
    lastActiveDiagStep = -1;
  }

  // Subtle header entrance reveal
  const hEase = easeOutCubic(range01(lt, 0.0, 0.28));
  hdrTitle.style.opacity = lerp(0.5, 1, hEase).toFixed(3);
  hdrTitle.style.transform = \`translateY(\${((1 - hEase) * 8).toFixed(1)}px)\`;
  hdrSub.style.opacity = lerp(0.45, 1, hEase).toFixed(3);

  // Subtle cutaway float-in
  if (meta.mode === 'cutaway') {
    const cEase = easeOutCubic(range01(lt, 0.0, 0.30));
    stageWrap.style.transform = \`translateY(\${((1 - cEase) * 14).toFixed(1)}px) scale(\${lerp(0.985, 1, cEase).toFixed(4)})\`;
  } else {
    stageWrap.style.transform = 'none';
  }

  // ------------------------------------------------------------------
  // PER-ACT DETERMINISTIC CHOREOGRAPHY
  // ------------------------------------------------------------------
  if (actIdx === 0) {
    // Act 1 (0.0-3.0s): Full-Screen · 3D Campus Overview (gentle natural ~32° turn)
    renderDiagramDOM(0, 0);
    const { imgA, imgB, blend } = sampleSequence(M.act1.seq, easeInOutCubic(p));
    const zoom = lerp(1.0, 1.06, easeInOutCubic(p));
    drawStageFrame({ imgA, imgB, blend, zoom, focusX: 0.5, focusY: 0.48 });
  } else if (actIdx === 1) {
    // Act 2 (3.0-6.5s, dur 3.5s): Cutaway + Diagram · Instant Search ("KPS")
    const A = M.act2;
    const sb = A.boxes.searchInput;
    const rb = A.boxes.kpsResult;
    if (lt < 1.32) {
      renderDiagramDOM(1, 0);
      const z = lerp(1.0, 1.62, easeInOutCubic(range01(lt, 0.08, 0.52)));
      let img = getImg(A.idle);
      if (lt >= 0.48 && lt < 0.72) img = getImg(A.type1);
      else if (lt >= 0.72 && lt < 0.96) img = getImg(A.type2);
      else if (lt >= 0.96) img = getImg(A.results);
      const tapSearch = lt >= 0.25 && lt <= 0.68 ? { box: sb, progress: range01(lt, 0.25, 0.68), label: 'Type "KPS"' } : null;
      drawStageFrame({ imgA: img, zoom: z, focusX: sb.cx, focusY: sb.cy + 0.04, tap: tapSearch });
    } else if (lt < 2.15) {
      renderDiagramDOM(1, 1);
      const panP = easeInOutCubic(range01(lt, 1.32, 1.62));
      const fx = lerp(sb.cx, rb.cx, panP);
      const fy = lerp(sb.cy + 0.04, rb.cy, panP);
      const tapRes = lt >= 1.50 && lt <= 2.10 ? { box: rb, progress: range01(lt, 1.50, 2.10), label: 'Tap "KPS"' } : null;
      drawStageFrame({ imgA: getImg(A.results), zoom: 1.62, focusX: fx, focusY: fy, tap: tapRes });
    } else {
      renderDiagramDOM(1, 2);
      const outP = easeOutCubic(range01(lt, 2.15, 2.58));
      const z = lerp(1.62, 1.0, outP);
      const seqP = range01(lt, 2.25, 3.50);
      const { imgA, imgB, blend } = sampleSequence(A.focusedSeq, seqP);
      const xfade = range01(lt, 2.15, 2.34);
      if (xfade < 1) {
        drawStageFrame({ imgA: getImg(A.results), imgB: imgA, blend: xfade, zoom: z, focusX: lerp(rb.cx, 0.5, outP), focusY: lerp(rb.cy, 0.5, outP) });
      } else {
        drawStageFrame({ imgA, imgB, blend, zoom: z, focusX: 0.5, focusY: 0.5 });
      }
    }
  } else if (actIdx === 2) {
    // Act 3 (6.5-10.2s, dur 3.7s): Full-Screen · KPS Block C Indoor 3D Cutaway
    renderDiagramDOM(2, 0);
    const A = M.act3;
    const cb = A.boxes.cutawayBtn;
    const b1 = A.boxes.floorL1Btn;
    const b2 = A.boxes.floorL2Btn;

    if (lt < 1.02) {
      const z = lerp(1.0, 1.72, easeInOutCubic(range01(lt, 0.06, 0.48)));
      const tap = lt >= 0.44 && lt <= 0.98 ? { box: cb, progress: range01(lt, 0.44, 0.98), label: '3D Cutaway' } : null;
      drawStageFrame({ imgA: getImg(A.shell), zoom: z, focusX: cb.cx, focusY: cb.cy, tap });
    } else if (lt < 1.72) {
      const panP = easeInOutCubic(range01(lt, 1.02, 1.28));
      const fx = lerp(cb.cx, b1.cx, panP);
      const fy = lerp(cb.cy, b1.cy, panP);
      const xfade = range01(lt, 1.02, 1.18);
      const tap = lt >= 1.22 && lt <= 1.70 ? { box: b1, progress: range01(lt, 1.22, 1.70), label: 'Level 1' } : null;
      drawStageFrame({ imgA: xfade < 1 ? getImg(A.shell) : getImg(A.xrayG), imgB: xfade < 1 ? getImg(A.xrayG) : null, blend: xfade < 1 ? xfade : 0, zoom: 1.72, focusX: fx, focusY: fy, tap });
    } else if (lt < 2.40) {
      const panP = easeInOutCubic(range01(lt, 1.72, 1.96));
      const fx = lerp(b1.cx, b2.cx, panP);
      const fy = lerp(b1.cy, b2.cy, panP);
      const xfade = range01(lt, 1.72, 1.88);
      const tap = lt >= 1.90 && lt <= 2.38 ? { box: b2, progress: range01(lt, 1.90, 2.38), label: 'Level 2' } : null;
      drawStageFrame({ imgA: xfade < 1 ? getImg(A.xrayG) : getImg(A.xrayL1), imgB: xfade < 1 ? getImg(A.xrayL1) : null, blend: xfade < 1 ? xfade : 0, zoom: 1.72, focusX: fx, focusY: fy, tap });
    } else {
      const outP = easeOutCubic(range01(lt, 2.40, 2.82));
      const z = lerp(1.72, 1.0, outP);
      const seqP = easeInOutCubic(range01(lt, 2.45, 3.70));
      const { imgA, imgB, blend } = sampleSequence(A.orbitSeq, seqP);
      const xfade = range01(lt, 2.40, 2.56);
      if (xfade < 1) {
        drawStageFrame({ imgA: getImg(A.xrayL1), imgB: imgA, blend: xfade, zoom: z, focusX: lerp(b2.cx, 0.5, outP), focusY: lerp(b2.cy, 0.5, outP) });
      } else {
        drawStageFrame({ imgA, imgB, blend, zoom: z, focusX: 0.5, focusY: 0.5 });
      }
    }
  } else if (actIdx === 3) {
    // Act 4 (10.2-13.4s, dur 3.2s): Cutaway + Diagram · Layers, Dark Mode & Saved
    const A = M.act4;
    const db = A.boxes.darkBtn;
    if (lt < 1.08) {
      renderDiagramDOM(3, 0);
      const z = lerp(1.0, 1.72, easeInOutCubic(range01(lt, 0.06, 0.48)));
      const tap = lt >= 0.48 && lt <= 1.04 ? { box: db, progress: range01(lt, 0.48, 1.04), label: 'Dark theme' } : null;
      drawStageFrame({ imgA: getImg(A.layersLight), zoom: z, focusX: db.cx, focusY: db.cy, tap });
    } else if (lt < 1.48) {
      renderDiagramDOM(3, 0);
      const outP = easeOutCubic(range01(lt, 1.08, 1.46));
      const xfade = range01(lt, 1.08, 1.24);
      drawStageFrame({
        imgA: xfade < 1 ? getImg(A.layersLight) : getImg(A.layersDark),
        imgB: xfade < 1 ? getImg(A.layersDark) : null,
        blend: xfade < 1 ? xfade : 0,
        zoom: lerp(1.72, 1.0, outP),
        focusX: lerp(db.cx, 0.5, outP),
        focusY: lerp(db.cy, 0.5, outP),
      });
    } else if (lt < 2.46) {
      renderDiagramDOM(3, 1);
      const seqP = easeInOutCubic(range01(lt, 1.48, 2.46));
      const { imgA, imgB, blend } = sampleSequence(A.darkSeq, seqP);
      const xfade = range01(lt, 1.48, 1.66);
      if (xfade < 1) {
        drawStageFrame({ imgA: getImg(A.layersDark), imgB: imgA, blend: xfade, zoom: 1.0 });
      } else {
        drawStageFrame({ imgA, imgB, blend, zoom: lerp(1.0, 1.04, seqP) });
      }
    } else {
      renderDiagramDOM(3, 2);
      const xfade = range01(lt, 2.46, 2.66);
      const lastDark = getImg(A.darkSeq[A.darkSeq.length - 1]);
      drawStageFrame({
        imgA: xfade < 1 ? lastDark : getImg(A.savedSheet),
        imgB: xfade < 1 ? getImg(A.savedSheet) : null,
        blend: xfade < 1 ? xfade : 0,
        zoom: 1.0,
      });
    }
  } else if (actIdx === 4) {
    // Act 5 (13.4-16.6s, dur 3.2s): Full-Screen · RapidKL & UM Shuttle Transit (T815)
    renderDiagramDOM(4, 0);
    const A = M.act5;
    const tb = A.boxes.t815Card;
    if (lt < 1.15) {
      const z = lerp(1.0, 1.62, easeInOutCubic(range01(lt, 0.06, 0.50)));
      const tap = lt >= 0.50 && lt <= 1.10 ? { box: tb, progress: range01(lt, 0.50, 1.10), label: 'Route T815' } : null;
      drawStageFrame({ imgA: getImg(A.hub), zoom: z, focusX: tb.cx, focusY: tb.cy, tap });
    } else if (lt < 1.56) {
      const outP = easeOutCubic(range01(lt, 1.15, 1.54));
      const xfade = range01(lt, 1.15, 1.32);
      drawStageFrame({
        imgA: xfade < 1 ? getImg(A.hub) : getImg(A.hubSelected),
        imgB: xfade < 1 ? getImg(A.hubSelected) : null,
        blend: xfade < 1 ? xfade : 0,
        zoom: lerp(1.62, 1.0, outP),
        focusX: lerp(tb.cx, 0.5, outP),
        focusY: lerp(tb.cy, 0.5, outP),
      });
    } else {
      const seqP = easeInOutCubic(range01(lt, 1.56, 3.20));
      const { imgA, imgB, blend } = sampleSequence(A.orbitSeq, seqP);
      const xfade = range01(lt, 1.56, 1.76);
      if (xfade < 1) {
        drawStageFrame({ imgA: getImg(A.hubSelected), imgB: imgA, blend: xfade, zoom: 1.0 });
      } else {
        drawStageFrame({ imgA, imgB, blend, zoom: lerp(1.0, 1.05, seqP) });
      }
    }
  } else if (actIdx === 5) {
    // Act 6 (16.6-20.4s, dur 3.8s): Cutaway + Diagram · Multi-Stop, Hills & Weather
    const A = M.act6;
    const bb = A.boxes.bikeBtn;
    const ob = A.boxes.optimizeBtn;
    const wb = A.boxes.weatherPill;

    if (lt < 0.92) {
      renderDiagramDOM(5, 0);
      const z = lerp(1.0, 1.66, easeInOutCubic(range01(lt, 0.05, 0.40)));
      const tap = lt >= 0.38 && lt <= 0.88 ? { box: bb, progress: range01(lt, 0.38, 0.88), label: 'Bike mode' } : null;
      drawStageFrame({ imgA: getImg(A.walk), zoom: z, focusX: bb.cx, focusY: bb.cy, tap });
    } else if (lt < 1.66) {
      renderDiagramDOM(5, 0);
      const panP = easeInOutCubic(range01(lt, 0.92, 1.18));
      const xfade = range01(lt, 0.92, 1.08);
      const tap = lt >= 1.12 && lt <= 1.62 ? { box: ob, progress: range01(lt, 1.12, 1.62), label: 'Optimize stops' } : null;
      drawStageFrame({
        imgA: xfade < 1 ? getImg(A.walk) : getImg(A.bike),
        imgB: xfade < 1 ? getImg(A.bike) : null,
        blend: xfade < 1 ? xfade : 0,
        zoom: 1.66,
        focusX: lerp(bb.cx, ob.cx, panP),
        focusY: lerp(bb.cy, ob.cy, panP),
        tap,
      });
    } else if (lt < 2.38) {
      renderDiagramDOM(5, 1);
      const outP = easeOutCubic(range01(lt, 1.66, 2.00));
      const xfade1 = range01(lt, 1.66, 1.82);
      const xfade2 = range01(lt, 1.98, 2.18);
      if (lt < 1.98) {
        drawStageFrame({
          imgA: xfade1 < 1 ? getImg(A.bike) : getImg(A.optimized),
          imgB: xfade1 < 1 ? getImg(A.optimized) : null,
          blend: xfade1 < 1 ? xfade1 : 0,
          zoom: lerp(1.66, 1.0, outP),
          focusX: lerp(ob.cx, 0.5, outP),
          focusY: lerp(ob.cy, 0.5, outP),
        });
      } else {
        drawStageFrame({
          imgA: getImg(A.optimized),
          imgB: getImg(A.elevation),
          blend: xfade2,
          zoom: 1.0,
        });
      }
    } else if (lt < 3.16) {
      renderDiagramDOM(5, 2);
      const pillImg = getImg(A.weatherPillImg || A.routeMap);
      const xfade = range01(lt, 2.38, 2.54);
      const z = lerp(1.0, 1.72, easeInOutCubic(range01(lt, 2.44, 2.78)));
      const tap = lt >= 2.68 && lt <= 3.14 ? { box: wb, progress: range01(lt, 2.68, 3.14), label: 'Campus weather' } : null;
      drawStageFrame({
        imgA: xfade < 1 ? getImg(A.elevation) : pillImg,
        imgB: xfade < 1 ? pillImg : null,
        blend: xfade < 1 ? xfade : 0,
        zoom: z,
        focusX: wb.cx,
        focusY: wb.cy,
        tap,
      });
    } else {
      renderDiagramDOM(5, 2);
      const pillImg = getImg(A.weatherPillImg || A.routeMap);
      const outP = easeOutCubic(range01(lt, 3.16, 3.50));
      const xfade = range01(lt, 3.16, 3.34);
      drawStageFrame({
        imgA: xfade < 1 ? pillImg : getImg(A.weatherOpen),
        imgB: xfade < 1 ? getImg(A.weatherOpen) : null,
        blend: xfade < 1 ? xfade : 0,
        zoom: lerp(1.72, 1.0, outP),
        focusX: lerp(wb.cx, 0.5, outP),
        focusY: lerp(wb.cy, 0.5, outP),
      });
    }
  } else if (actIdx === 6) {
    // Act 7 (20.4-25.0s, dur 4.6s): Full-Screen · Live 3D Road Navigation into KPS
    renderDiagramDOM(6, 0);
    const A = M.act7;
    const sb = A.boxes.simBtn;
    const spb = A.boxes.speedBtn;

    if (lt < 0.96) {
      const z = lerp(1.0, 1.72, easeInOutCubic(range01(lt, 0.05, 0.42)));
      const tap = lt >= 0.40 && lt <= 0.92 ? { box: sb, progress: range01(lt, 0.40, 0.92), label: 'Simulate route' } : null;
      drawStageFrame({ imgA: getImg(A.ready), zoom: z, focusX: sb.cx, focusY: sb.cy, tap });
    } else if (lt < 1.66) {
      const panP = easeInOutCubic(range01(lt, 0.96, 1.20));
      const xfade = range01(lt, 0.96, 1.10);
      const tap = lt >= 1.14 && lt <= 1.62 ? { box: spb, progress: range01(lt, 1.14, 1.62), label: '3× speed' } : null;
      drawStageFrame({
        imgA: xfade < 1 ? getImg(A.ready) : getImg(A.sim1x),
        imgB: xfade < 1 ? getImg(A.sim1x) : null,
        blend: xfade < 1 ? xfade : 0,
        zoom: 1.72,
        focusX: lerp(sb.cx, spb.cx, panP),
        focusY: lerp(sb.cy, spb.cy, panP),
        tap,
      });
    } else {
      const outP = easeOutCubic(range01(lt, 1.66, 2.04));
      const z = lerp(1.72, 1.0, outP);
      const seqP = range01(lt, 1.66, 4.60); // linear steady cruising velocity!
      const { imgA, imgB, blend } = sampleSequence(A.navSeq, seqP);
      drawStageFrame({
        imgA,
        imgB,
        blend,
        zoom: z,
        focusX: lerp(spb.cx, 0.5, outP),
        focusY: lerp(spb.cy, 0.5, outP),
      });
    }
  } else if (actIdx === 7) {
    // Act 8 (25.0-28.2s, dur 3.2s): Full-Screen · Custom Route Studio & 3D Overview
    renderDiagramDOM(7, 0);
    const A = M.act8;
    const ob = A.boxes.overviewBtn;
    if (lt < 1.12) {
      const z = lerp(1.0, 1.72, easeInOutCubic(range01(lt, 0.06, 0.48)));
      const tap = lt >= 0.48 && lt <= 1.08 ? { box: ob, progress: range01(lt, 0.48, 1.08), label: '3D Overview' } : null;
      drawStageFrame({ imgA: getImg(A.drawPanel), zoom: z, focusX: ob.cx, focusY: ob.cy, tap });
    } else {
      const outP = easeOutCubic(range01(lt, 1.12, 1.52));
      const z = lerp(1.72, 1.0, outP);
      const seqP = easeInOutCubic(range01(lt, 1.20, 3.20));
      const { imgA, imgB, blend } = sampleSequence(A.orbitSeq, seqP);
      const xfade = range01(lt, 1.12, 1.30);
      if (xfade < 1) {
        drawStageFrame({ imgA: getImg(A.drawPanel), imgB: imgA, blend: xfade, zoom: z, focusX: lerp(ob.cx, 0.5, outP), focusY: lerp(ob.cy, 0.5, outP) });
      } else {
        drawStageFrame({ imgA, imgB, blend, zoom: z, focusX: 0.5, focusY: 0.5 });
      }
    }
  } else if (actIdx === 8) {
    // Act 9 (28.2-31.4s, dur 3.2s): Cutaway + Diagram · Share Link & Export PNG
    const A = M.act9;
    const rb = A.boxes.routeOnlyBtn;
    const lb = A.boxes.lightCardBtn;
    if (lt < 1.10) {
      renderDiagramDOM(8, 0);
      const z = lerp(1.0, 1.68, easeInOutCubic(range01(lt, 0.08, 0.48)));
      const tap = lt >= 0.48 && lt <= 1.06 ? { box: rb, progress: range01(lt, 0.48, 1.06), label: 'Route only' } : null;
      drawStageFrame({ imgA: getImg(A.wholeMap), zoom: z, focusX: rb.cx, focusY: rb.cy, tap });
    } else if (lt < 1.98) {
      renderDiagramDOM(8, 1);
      const panP = easeInOutCubic(range01(lt, 1.10, 1.38));
      const xfade = range01(lt, 1.10, 1.28);
      const tap = lt >= 1.38 && lt <= 1.94 ? { box: lb, progress: range01(lt, 1.38, 1.94), label: 'Light card' } : null;
      drawStageFrame({
        imgA: xfade < 1 ? getImg(A.wholeMap) : getImg(A.routeDark),
        imgB: xfade < 1 ? getImg(A.routeDark) : null,
        blend: xfade < 1 ? xfade : 0,
        zoom: 1.68,
        focusX: lerp(rb.cx, lb.cx, panP),
        focusY: lerp(rb.cy, lb.cy, panP),
        tap,
      });
    } else {
      renderDiagramDOM(8, 2);
      const outP = easeOutCubic(range01(lt, 1.98, 2.38));
      const xfade = range01(lt, 1.98, 2.18);
      drawStageFrame({
        imgA: xfade < 1 ? getImg(A.routeDark) : getImg(A.routeLight),
        imgB: xfade < 1 ? getImg(A.routeLight) : null,
        blend: xfade < 1 ? xfade : 0,
        zoom: lerp(1.68, 1.0, outP),
        focusX: lerp(lb.cx, 0.5, outP),
        focusY: lerp(lb.cy, 0.5, outP),
      });
    }
  }

  lastActIdx = actIdx;
};
</script>
</body>
</html>`;
}

function startStaticServer(htmlContent) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.url === '/' || req.url === '/index.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(htmlContent);
        return;
      }
      if (req.url && req.url.startsWith('/frames/')) {
        const fname = path.basename(req.url.slice('/frames/'.length));
        const fpath = path.join(FRAMES_DIR, fname);
        if (fs.existsSync(fpath)) {
          res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'max-age=3600' });
          fs.createReadStream(fpath).pipe(res);
          return;
        }
      }
      res.writeHead(404);
      res.end('Not found');
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      resolve({ server, port: addr.port });
    });
  });
}

async function main() {
  if (!fs.existsSync(MANIFEST_PATH)) {
    throw new Error(`Missing capture manifest at ${MANIFEST_PATH}. Run capture-live-acts.mjs first.`);
  }
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));

  console.log('1/3 Generating 35.0s 126 BPM soundtrack...');
  generateSoundtrack(SOUNDTRACK_WAV);

  const html = buildCompositorHtml(manifest);
  const { server, port } = await startStaticServer(html);

  console.log(`2/3 Launching 1080x1920 @ 30fps compositor (${TOTAL_FRAMES} deterministic frames)...`);
  const browser = await chromium.launch({
    executablePath: CHROMIUM_EXEC,
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--font-render-hinting=none',
    ],
  });

  const TEMP_MP4 = path.join(TMP_DIR, 'um-3d-atlas-reel-9x16.tmp.mp4');

  // Spawn FFmpeg H.264 High + AAC 128k encoder reading crisp quality-96 JPEG frames via stdin pipe
  const ffmpegArgs = [
    '-y',
    '-f', 'image2pipe',
    '-vcodec', 'mjpeg',
    '-r', String(FPS),
    '-i', '-',
    '-i', SOUNDTRACK_WAV,
    '-map', '0:v:0',
    '-map', '1:a:0',
    '-c:v', 'libx264',
    '-profile:v', 'high',
    '-level:v', '4.2',
    '-pix_fmt', 'yuv420p',
    '-crf', '22',
    '-preset', 'medium',
    '-maxrate', '1500k',
    '-bufsize', '3000k',
    '-af', 'volume=3.0dB',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-ar', '48000',
    '-movflags', '+faststart',
    '-shortest',
    TEMP_MP4,
  ];

  const ffmpeg = spawn('ffmpeg', ffmpegArgs, { stdio: ['pipe', 'ignore', 'pipe'] });
  let ffmpegStderr = '';
  ffmpeg.stderr.on('data', (chunk) => {
    ffmpegStderr += chunk.toString();
  });

  const ffmpegDone = new Promise((resolve, reject) => {
    ffmpeg.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited ${code}:\n${ffmpegStderr.slice(-1200)}`));
    });
    ffmpeg.on('error', reject);
  });

  try {
    const context = await browser.newContext({
      viewport: { width: WIDTH, height: HEIGHT },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle' });

    const loadedCount = await page.evaluate(() => window.preloadAll());
    console.log(`    Preloaded ${loadedCount} crisp HiDPI captured frames + Inter/Roboto Mono fonts.`);

    const cdp = await context.newCDPSession(page);
    const t0 = Date.now();

    for (let f = 0; f < TOTAL_FRAMES; f++) {
      const t = f / FPS;
      await page.evaluate((timeS) => window.renderFrame(timeS), t);

      const { data } = await cdp.send('Page.captureScreenshot', {
        format: 'jpeg',
        quality: 96,
        fromSurface: true,
      });
      const buf = Buffer.from(data, 'base64');

      if (!ffmpeg.stdin.write(buf)) {
        await new Promise((r) => ffmpeg.stdin.once('drain', r));
      }

      if ((f + 1) % 150 === 0 || f === TOTAL_FRAMES - 1) {
        const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
        console.log(`    Rendered frame ${f + 1}/${TOTAL_FRAMES} (${elapsed}s elapsed)`);
      }
    }

    ffmpeg.stdin.end();
    console.log('3/3 Finalizing H.264 + AAC master MP4...');
    await ffmpegDone;
    fs.renameSync(TEMP_MP4, OUTPUT_MP4);

    await context.close();
  } finally {
    await browser.close();
    server.close();
  }

  const stat = fs.statSync(OUTPUT_MP4);
  const mb = (stat.size / (1024 * 1024)).toFixed(2);
  console.log(`Done! Saved ${OUTPUT_MP4} (${mb} MB)`);
}

main().catch((err) => {
  console.error('Render failed:', err);
  process.exit(1);
});
