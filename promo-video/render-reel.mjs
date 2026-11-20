import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { generateSoundtrack } from './synth-audio.mjs';
import { captureAllScenes } from './capture-scenes.mjs';

const PW_PATH = '/usr/local/share/bun-global/node_modules/playwright-core/index.mjs';
const CHROME_EXE =
  '/ms-playwright/chromium_headless_shell-1247/chrome-headless-shell-linux64/chrome-headless-shell';

const WIDTH = 1080;
const HEIGHT = 1920;
const FPS = 30;
const DURATION_S = 24.0;
const TOTAL_FRAMES = Math.round(DURATION_S * FPS); // 720 frames

const SITE_URL = process.env.PROMO_SITE_URL || 'um-3d-atlas.netlify.app';
const TMP_DIR = path.resolve('promo-video/.tmp');
const CAPTURE_DIR = path.join(TMP_DIR, 'captures');
const WAV_PATH = path.join(TMP_DIR, 'soundtrack.wav');
const OUTPUT_MP4 = path.resolve('promo-video/um-3d-atlas-reel-9x16.mp4');

function loadDataUri(filename) {
  const full = path.join(CAPTURE_DIR, filename);
  if (!fs.existsSync(full)) {
    throw new Error(`Missing capture file: ${full}`);
  }
  const b64 = fs.readFileSync(full).toString('base64');
  return `data:image/png;base64,${b64}`;
}

function buildStageHtml(imgs, siteUrl) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Roboto+Mono:wght@500;600&display=swap" rel="stylesheet" />
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body {
    width: 1080px;
    height: 1920px;
    overflow: hidden;
    background: #F8FAFD;
    color: #1F1F1F;
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  .mono {
    font-family: 'Roboto Mono', monospace;
    font-variant-numeric: tabular-nums;
  }
  .stage {
    position: relative;
    width: 1080px;
    height: 1920px;
    overflow: hidden;
    background: #F8FAFD;
  }

  /* Subtle M3 Tonal Ambient Orbs (Clean Light Keynote — zero neon) */
  .bg-orb {
    position: absolute;
    border-radius: 999px;
    pointer-events: none;
    will-change: transform;
  }
  .bg-orb--1 {
    width: 920px;
    height: 920px;
    top: -260px;
    right: -240px;
    background: radial-gradient(circle, rgba(211, 227, 253, 0.72) 0%, rgba(211, 227, 253, 0) 70%);
  }
  .bg-orb--2 {
    width: 860px;
    height: 860px;
    bottom: -240px;
    left: -260px;
    background: radial-gradient(circle, rgba(206, 234, 214, 0.42) 0%, rgba(206, 234, 214, 0) 70%);
  }

  /* Top subtle Reels Story Progress Strip (within safe top area) */
  .story-progress {
    position: absolute;
    top: 78px;
    left: 56px;
    right: 56px;
    height: 6px;
    display: flex;
    gap: 8px;
    z-index: 60;
  }
  .story-seg {
    flex: 1;
    height: 6px;
    border-radius: 999px;
    background: rgba(26, 115, 232, 0.14);
    overflow: hidden;
  }
  .story-seg__fill {
    height: 100%;
    width: 0%;
    border-radius: 999px;
    background: #1A73E8;
  }

  /* Persistent subtle top brand eyebrow during feature scenes */
  .top-brand {
    position: absolute;
    top: 112px;
    left: 60px;
    right: 60px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    z-index: 50;
    opacity: 0;
  }
  .top-brand__left {
    display: flex;
    align-items: center;
    gap: 14px;
  }
  .top-brand__mark {
    width: 44px;
    height: 44px;
    border-radius: 14px;
    background: #1A73E8;
    color: #FFFFFF;
    font-size: 18px;
    font-weight: 700;
    letter-spacing: -0.02em;
    display: grid;
    place-items: center;
    box-shadow: 0 6px 18px rgba(26, 115, 232, 0.28);
  }
  .top-brand__name {
    font-size: 24px;
    font-weight: 700;
    letter-spacing: -0.02em;
    color: #1F1F1F;
  }
  .top-brand__tag {
    font-size: 20px;
    font-weight: 500;
    color: #5F6368;
  }

  /* Scenes Layer */
  .scene {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 188px 56px 190px;
    opacity: 0;
    pointer-events: none;
    will-change: transform, opacity;
  }

  /* Shared Typography */
  .eyebrow {
    font-size: 22px;
    font-weight: 600;
    color: #1A73E8;
    letter-spacing: -0.01em;
    margin-bottom: 12px;
    text-align: center;
  }
  .headline {
    font-size: 62px;
    font-weight: 700;
    letter-spacing: -0.036em;
    line-height: 1.06;
    color: #1F1F1F;
    text-align: center;
    max-width: 920px;
  }
  .subcopy {
    margin-top: 16px;
    font-size: 28px;
    font-weight: 400;
    line-height: 1.38;
    color: #444746;
    text-align: center;
    max-width: 840px;
  }
  .headline--hero {
    font-size: 76px;
    line-height: 1.03;
  }

  /* Elevated Material 3 App Showcase Frame */
  .device-frame {
    position: relative;
    width: 960px;
    height: 980px;
    margin-top: 38px;
    border-radius: 40px;
    background: #FFFFFF;
    border: 2px solid rgba(15, 23, 42, 0.08);
    box-shadow:
      0 34px 80px rgba(15, 23, 42, 0.14),
      0 8px 24px rgba(26, 115, 232, 0.08);
    overflow: hidden;
    flex-shrink: 0;
  }
  .device-frame--tall {
    height: 1030px;
  }
  .device-frame--mid {
    height: 910px;
  }
  .device-frame img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    object-position: center top;
    display: block;
    will-change: transform;
  }
  .device-frame__gloss {
    position: absolute;
    inset: 0;
    border-radius: 40px;
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.7);
    pointer-events: none;
  }

  /* M3 Bottom Feature Dock */
  .m3-dock {
    width: 960px;
    margin-top: 28px;
    padding: 24px 28px;
    border-radius: 30px;
    background: #FFFFFF;
    border: 1.5px solid #E0E5EC;
    box-shadow: 0 12px 32px rgba(15, 23, 42, 0.07);
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .m3-dock--tonal {
    background: #EFF3F8;
    border-color: #DCE3ED;
  }
  .m3-dock__row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
  }
  .m3-dock__title {
    font-size: 26px;
    font-weight: 600;
    letter-spacing: -0.02em;
    color: #1F1F1F;
  }
  .m3-dock__meta {
    font-size: 21px;
    font-weight: 500;
    color: #5F6368;
  }

  /* Scene 1: Hero Mark */
  .hero-mark-wrap {
    position: relative;
    width: 124px;
    height: 124px;
    display: grid;
    place-items: center;
    margin-bottom: 26px;
  }
  .hero-mark-ring {
    position: absolute;
    inset: -24px;
    border-radius: 46px;
    border: 3px solid rgba(26, 115, 232, 0.24);
  }
  .hero-mark {
    width: 124px;
    height: 124px;
    border-radius: 36px;
    background: #1A73E8;
    color: #FFFFFF;
    font-size: 48px;
    font-weight: 700;
    letter-spacing: -0.03em;
    display: grid;
    place-items: center;
    box-shadow: 0 22px 46px rgba(26, 115, 232, 0.34);
  }

  /* Scene 2: Floor Selector Bar */
  .floor-strip {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px;
    border-radius: 999px;
    background: #EFF3F8;
  }
  .floor-item {
    flex: 1;
    height: 54px;
    border-radius: 999px;
    display: grid;
    place-items: center;
    font-size: 22px;
    font-weight: 600;
    color: #444746;
  }
  .floor-item.is-active {
    background: #1A73E8;
    color: #FFFFFF;
    box-shadow: 0 6px 16px rgba(26, 115, 232, 0.3);
  }

  /* Scene 3: Segmented Modes */
  .mode-bar {
    position: relative;
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    padding: 8px;
    border-radius: 999px;
    background: #EFF3F8;
    border: 1px solid #E0E5EC;
  }
  .mode-bar__slider {
    position: absolute;
    top: 8px;
    bottom: 8px;
    left: 8px;
    width: calc(25% - 4px);
    border-radius: 999px;
    background: #D3E3FD;
    box-shadow: 0 4px 12px rgba(26, 115, 232, 0.16);
  }
  .mode-bar__item {
    position: relative;
    z-index: 2;
    height: 60px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    font-size: 23px;
    font-weight: 600;
    color: #444746;
  }
  .mode-bar__item.is-active {
    color: #041E49;
  }

  /* Scene 4: Elevation SVG & Weather Split */
  .elev-weather-grid {
    display: grid;
    grid-template-columns: 1.25fr 1fr;
    gap: 18px;
    width: 960px;
    margin-top: 26px;
  }
  .metric-card {
    padding: 22px 24px;
    border-radius: 28px;
    background: #FFFFFF;
    border: 1.5px solid #E0E5EC;
    box-shadow: 0 12px 28px rgba(15, 23, 42, 0.06);
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    gap: 12px;
  }
  .metric-card__label {
    font-size: 19px;
    font-weight: 600;
    color: #5F6368;
  }
  .metric-card__val {
    font-size: 32px;
    font-weight: 700;
    letter-spacing: -0.025em;
    color: #1F1F1F;
  }
  .metric-gain { color: #B45309; }
  .metric-drop { color: #0369A1; }
  .metric-rain { color: #1A73E8; }

  /* Scene 5: Live Nav Feature Stack */
  .nav-cards {
    width: 960px;
    margin-top: 26px;
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 14px;
  }
  .nav-card {
    padding: 20px 20px;
    border-radius: 26px;
    background: #FFFFFF;
    border: 1.5px solid #E0E5EC;
    box-shadow: 0 10px 26px rgba(15, 23, 42, 0.06);
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .nav-card--primary {
    background: #D3E3FD;
    border-color: #B4CEF8;
  }
  .nav-card__title {
    font-size: 22px;
    font-weight: 700;
    color: #1F1F1F;
    letter-spacing: -0.02em;
  }
  .nav-card__sub {
    font-size: 18px;
    font-weight: 500;
    line-height: 1.35;
    color: #444746;
  }

  /* Scene 6: Draw & Overview dual crossfade */
  .dual-img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    object-position: center top;
  }
  .anchor-track {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  .anchor-dot {
    width: 44px;
    height: 44px;
    border-radius: 999px;
    display: grid;
    place-items: center;
    font-size: 20px;
    font-weight: 700;
    flex-shrink: 0;
  }
  .anchor-dot--a { background: #1A73E8; color: #FFFFFF; }
  .anchor-dot--mid { background: #FFFFFF; color: #1A73E8; border: 3px solid #1A73E8; }
  .anchor-dot--b { background: #D93025; color: #FFFFFF; }
  .anchor-line {
    flex: 1;
    height: 6px;
    border-radius: 999px;
    background: #D3E3FD;
    overflow: hidden;
  }
  .anchor-line__fill {
    height: 100%;
    background: #1A73E8;
    border-radius: 999px;
  }

  /* Scene 7: Share Format Switch */
  .export-switch {
    display: grid;
    grid-template-columns: 1fr 1fr;
    padding: 8px;
    border-radius: 999px;
    background: #EFF3F8;
    border: 1px solid #E0E5EC;
    gap: 8px;
  }
  .export-switch__btn {
    height: 58px;
    border-radius: 999px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 23px;
    font-weight: 600;
    color: #444746;
  }
  .export-switch__btn.is-active {
    background: #1A73E8;
    color: #FFFFFF;
    box-shadow: 0 6px 18px rgba(26, 115, 232, 0.28);
  }

  /* Scene 8: Iconic Google M3 End Card */
  .scene--end {
    justify-content: center;
    padding: 180px 72px 200px;
  }
  .end-rings {
    position: relative;
    width: 220px;
    height: 220px;
    display: grid;
    place-items: center;
    margin-bottom: 44px;
  }
  .end-ring {
    position: absolute;
    border-radius: 999px;
    border: 2px solid rgba(26, 115, 232, 0.16);
  }
  .end-ring--1 { width: 280px; height: 280px; }
  .end-ring--2 { width: 390px; height: 390px; border-color: rgba(26, 115, 232, 0.09); }
  .end-ring--3 { width: 510px; height: 510px; border-color: rgba(26, 115, 232, 0.05); }
  .end-logo {
    position: relative;
    z-index: 3;
    width: 172px;
    height: 172px;
    border-radius: 48px;
    background: #1A73E8;
    color: #FFFFFF;
    font-size: 68px;
    font-weight: 800;
    letter-spacing: -0.04em;
    display: grid;
    place-items: center;
    box-shadow: 0 28px 64px rgba(26, 115, 232, 0.36);
  }
  .end-title {
    font-size: 84px;
    font-weight: 800;
    letter-spacing: -0.04em;
    line-height: 1.02;
    color: #1F1F1F;
    text-align: center;
  }
  .end-tagline {
    margin-top: 20px;
    font-size: 32px;
    font-weight: 500;
    color: #5F6368;
    text-align: center;
  }
  .end-cta {
    position: relative;
    overflow: hidden;
    margin-top: 56px;
    height: 92px;
    padding: 0 56px;
    border-radius: 999px;
    background: #1A73E8;
    color: #FFFFFF;
    font-size: 34px;
    font-weight: 600;
    letter-spacing: -0.015em;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 16px;
    box-shadow: 0 18px 42px rgba(26, 115, 232, 0.34);
  }
  .end-cta__sheen {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 120px;
    background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.34), transparent);
    transform: skewX(-20deg) translateX(-260px);
  }
  .end-url-card {
    margin-top: 30px;
    padding: 20px 36px;
    border-radius: 22px;
    background: #FFFFFF;
    border: 1.5px solid #D3E3FD;
    box-shadow: 0 10px 28px rgba(26, 115, 232, 0.08);
    display: inline-flex;
    align-items: center;
    gap: 14px;
    font-size: 28px;
    font-weight: 600;
    color: #0B57D0;
  }
  .end-bio {
    margin-top: 36px;
    display: inline-flex;
    align-items: center;
    gap: 10px;
    font-size: 26px;
    font-weight: 600;
    color: #444746;
    letter-spacing: -0.01em;
  }
</style>
</head>
<body>
<div class="stage" id="stage">
  <div class="bg-orb bg-orb--1" id="orb1"></div>
  <div class="bg-orb bg-orb--2" id="orb2"></div>

  <div class="story-progress" id="storyProgress">
    ${Array.from({ length: 8 }, (_, i) => `<div class="story-seg"><div class="story-seg__fill" id="seg${i}"></div></div>`).join('')}
  </div>

  <div class="top-brand" id="topBrand">
    <div class="top-brand__left">
      <div class="top-brand__mark">UM</div>
      <div class="top-brand__name">UM 3D Atlas</div>
    </div>
    <div class="top-brand__tag" id="topBrandTag">Universiti Malaya</div>
  </div>

  <!-- SCENE 1: 0.0 - 2.8s HERO REVEAL -->
  <section class="scene" id="s0">
    <div class="hero-mark-wrap" id="s0MarkWrap">
      <div class="hero-mark-ring" id="s0Ring"></div>
      <div class="hero-mark">UM</div>
    </div>
    <div class="eyebrow" id="s0Eye">Introducing UM 3D Atlas</div>
    <h1 class="headline headline--hero" id="s0Head">Universiti Malaya.<br/>Now in 3D.</h1>
    <p class="subcopy" id="s0Sub">Every building, shortcut, bus stop, and indoor room — mapped in real time.</p>
    <div class="device-frame device-frame--mid" id="s0Frame">
      <img src="${imgs.hero}" id="s0Img" alt="" />
      <div class="device-frame__gloss"></div>
    </div>
  </section>

  <!-- SCENE 2: 2.8 - 5.8s 3D CAMPUS & INDOOR FLOOR X-RAY -->
  <section class="scene" id="s1">
    <div class="eyebrow">3D Campus &amp; Indoor X-Ray</div>
    <h2 class="headline">See inside every floor.</h2>
    <p class="subcopy">Instant search across faculties, lecture halls, gates, and landmarks.</p>
    <div class="device-frame" id="s1Frame">
      <img src="${imgs.xray}" id="s1Img" alt="" />
      <div class="device-frame__gloss"></div>
    </div>
    <div class="m3-dock" id="s1Dock">
      <div class="m3-dock__row">
        <span class="m3-dock__title">Interactive Floor X-Ray</span>
        <span class="m3-dock__meta">FSKTM · 3D Extruded Rooms</span>
      </div>
      <div class="floor-strip">
        <div class="floor-item" id="fl0">All</div>
        <div class="floor-item" id="fl1">L3</div>
        <div class="floor-item" id="fl2">L2</div>
        <div class="floor-item" id="fl3">L1</div>
      </div>
    </div>
  </section>

  <!-- SCENE 3: 5.8 - 9.0s MULTI-STOP SMART ROUTING & 4 MODES -->
  <section class="scene" id="s2">
    <div class="eyebrow">Multi-Stop Smart Routing</div>
    <h2 class="headline">Four modes.<br/>Unlimited stops.</h2>
    <p class="subcopy">Auto-optimize stop order and prefer bike-friendly paths without stairs.</p>
    <div class="device-frame device-frame--mid" id="s2Frame">
      <img src="${imgs.multistop}" id="s2Img" alt="" />
      <div class="device-frame__gloss"></div>
    </div>
    <div class="m3-dock" id="s2Dock">
      <div class="mode-bar">
        <div class="mode-bar__slider" id="modeSlider"></div>
        <div class="mode-bar__item" id="m0">Walk</div>
        <div class="mode-bar__item" id="m1">Bike</div>
        <div class="mode-bar__item" id="m2">Bus</div>
        <div class="mode-bar__item" id="m3">Drive</div>
      </div>
      <div class="m3-dock__row">
        <span class="m3-dock__title" style="font-size:23px;">Auto-Optimize Shortest Order</span>
        <span class="m3-dock__meta mono" style="color:#1E8E3E;font-weight:600;">−240 m saved · 0 stairs</span>
      </div>
    </div>
  </section>

  <!-- SCENE 4: 9.0 - 12.2s ELEVATION & LIVE WEATHER -->
  <section class="scene" id="s3">
    <div class="eyebrow">Terrain &amp; Live Weather</div>
    <h2 class="headline">Know every hill<br/>and rain cloud.</h2>
    <p class="subcopy">Real UM elevation profiles plus live heat index &amp; rain forecast.</p>
    <div class="device-frame device-frame--mid" id="s3Frame">
      <img src="${imgs.elevWeather}" id="s3Img" alt="" />
      <div class="device-frame__gloss"></div>
    </div>
    <div class="elev-weather-grid" id="s3Grid">
      <div class="metric-card">
        <div class="metric-card__label">Route Elevation Profile</div>
        <svg viewBox="0 0 420 92" width="100%" height="88" style="display:block;overflow:visible;">
          <defs>
            <linearGradient id="elevArea" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#1A73E8" stop-opacity="0.22" />
              <stop offset="100%" stop-color="#1A73E8" stop-opacity="0.01" />
            </linearGradient>
          </defs>
          <path d="M 4 76 C 65 72, 108 32, 165 26 C 228 20, 272 58, 330 40 C 370 28, 396 44, 416 48 L 416 88 L 4 88 Z" fill="url(#elevArea)" id="elevFill" />
          <path d="M 4 76 C 65 72, 108 32, 165 26 C 228 20, 272 58, 330 40 C 370 28, 396 44, 416 48" fill="none" stroke="#1A73E8" stroke-width="5.5" stroke-linecap="round" stroke-dasharray="520" stroke-dashoffset="520" id="elevStroke" />
          <path d="M 102 42 C 122 30, 142 26, 165 26" fill="none" stroke="#D97706" stroke-width="6.5" stroke-linecap="round" id="elevSteep" opacity="0" />
        </svg>
        <div class="m3-dock__meta mono"><span class="metric-gain">+66 m</span> · <span class="metric-drop">−37 m</span> · Steep hill tags</div>
      </div>
      <div class="metric-card">
        <div class="metric-card__label">Live Campus Comfort</div>
        <div class="metric-card__val mono">39.4 m ASL</div>
        <div class="m3-dock__meta" style="line-height:1.4;">
          <strong style="color:#B45309;">Hot · Feels 34°C</strong><br/>
          <span class="metric-rain" style="font-weight:600;">45% Rain Chance</span>
        </div>
      </div>
    </div>
  </section>

  <!-- SCENE 5: 12.2 - 15.6s LIVE NAVIGATION, TURN ARROWS & ADAPTIVE REROUTING -->
  <section class="scene" id="s4">
    <div class="eyebrow">Live 3D Navigation</div>
    <h2 class="headline">Guided right<br/>on the road.</h2>
    <p class="subcopy">On-road turn arrows, zone alerts, live GPS coordinates &amp; auto rerouting.</p>
    <div class="device-frame device-frame--mid" id="s4Frame">
      <img src="${imgs.liveNav}" id="s4Img" alt="" />
      <div class="device-frame__gloss"></div>
    </div>
    <div class="nav-cards">
      <div class="nav-card nav-card--primary" id="nc0">
        <div class="nav-card__title">Road Turn Arrows</div>
        <div class="nav-card__sub">Painted directly onto campus road bends</div>
      </div>
      <div class="nav-card" id="nc1">
        <div class="nav-card__title">Zone &amp; Live GPS</div>
        <div class="nav-card__sub mono" style="font-size:16px;">Entering FSKTM<br/>3.12092°N, 101.65384°E</div>
      </div>
      <div class="nav-card" id="nc2">
        <div class="nav-card__title">Adaptive Reroute</div>
        <div class="nav-card__sub">Recalculates turns &amp; ETA if off-path</div>
      </div>
    </div>
  </section>

  <!-- SCENE 6: 15.6 - 18.8s CUSTOM ROUTE BUILDER & ROUTE OVERVIEW -->
  <section class="scene" id="s5">
    <div class="eyebrow" id="s5Eye">Custom Route Studio</div>
    <h2 class="headline" id="s5Head">Draw, drag &amp; snap<br/>your own path.</h2>
    <p class="subcopy" id="s5Sub">Place custom points, drag to snap onto roads, or preview in 3D Overview.</p>
    <div class="device-frame device-frame--mid" id="s5Frame">
      <img src="${imgs.customDraw}" class="dual-img" id="s5ImgA" alt="" />
      <img src="${imgs.overviewSim}" class="dual-img" id="s5ImgB" style="opacity:0;" alt="" />
      <div class="device-frame__gloss"></div>
    </div>
    <div class="m3-dock" id="s5Dock">
      <div class="anchor-track">
        <div class="anchor-dot anchor-dot--a">A</div>
        <div class="anchor-line"><div class="anchor-line__fill" id="al0" style="width:0%"></div></div>
        <div class="anchor-dot anchor-dot--mid">1</div>
        <div class="anchor-line"><div class="anchor-line__fill" id="al1" style="width:0%"></div></div>
        <div class="anchor-dot anchor-dot--mid">2</div>
        <div class="anchor-line"><div class="anchor-line__fill" id="al2" style="width:0%"></div></div>
        <div class="anchor-dot anchor-dot--b">B</div>
      </div>
      <div class="m3-dock__row">
        <span class="m3-dock__title" style="font-size:23px;" id="s5DockLabel">Snap to Campus Paths &amp; Roads</span>
        <span class="m3-dock__meta">3D Step Overview · Simulate</span>
      </div>
    </div>
  </section>

  <!-- SCENE 7: 18.8 - 21.4s NAME, SHARE LINK & EXPORT PNG -->
  <section class="scene" id="s6">
    <div class="eyebrow">Share &amp; Export</div>
    <h2 class="headline">Name it. Link it.<br/>Export as PNG.</h2>
    <p class="subcopy">Share static links or download route cards with distance, elevation &amp; steps.</p>
    <div class="device-frame device-frame--mid" id="s6Frame">
      <img src="${imgs.shareWhole}" class="dual-img" id="s6ImgA" alt="" />
      <img src="${imgs.shareOnly}" class="dual-img" id="s6ImgB" style="opacity:0;" alt="" />
      <div class="device-frame__gloss"></div>
    </div>
    <div class="m3-dock" id="s6Dock">
      <div class="export-switch">
        <div class="export-switch__btn is-active" id="expWhole">Whole Map PNG</div>
        <div class="export-switch__btn" id="expOnly">Route-Only Card</div>
      </div>
      <div class="m3-dock__row" style="justify-content:center;">
        <span class="m3-dock__meta">Transparent or Solid Background · Instant Shareable URL</span>
      </div>
    </div>
  </section>

  <!-- SCENE 8: 21.4 - 24.0s ICONIC M3 LIGHT END CARD -->
  <section class="scene scene--end" id="s7">
    <div class="end-rings" id="endRings">
      <div class="end-ring end-ring--3" id="er3"></div>
      <div class="end-ring end-ring--2" id="er2"></div>
      <div class="end-ring end-ring--1" id="er1"></div>
      <div class="end-logo" id="endLogo">UM</div>
    </div>
    <h2 class="end-title" id="endTitle">UM 3D Atlas</h2>
    <p class="end-tagline" id="endTag">Navigate Universiti Malaya in 3D</p>
    <div class="end-cta" id="endCta">
      <div class="end-cta__sheen" id="endSheen"></div>
      <span>Try UM 3D Atlas</span>
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m13 5 7 7-7 7"/></svg>
    </div>
    <div class="end-url-card mono" id="endUrl">
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
      <span>${siteUrl}</span>
    </div>
    <div class="end-bio" id="endBio">
      <span>Link in bio</span>
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#1A73E8" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m18 15-6-6-6 6"/></svg>
    </div>
  </section>
</div>

<script>
  const SCENES = [
    { id: 's0', start: 0.0,  end: 2.8,  tag: 'Universiti Malaya' },
    { id: 's1', start: 2.8,  end: 5.8,  tag: '3D Campus & X-Ray' },
    { id: 's2', start: 5.8,  end: 9.0,  tag: 'Smart Directions' },
    { id: 's3', start: 9.0,  end: 12.2, tag: 'Elevation & Weather' },
    { id: 's4', start: 12.2, end: 15.6, tag: 'Live 3D Navigation' },
    { id: 's5', start: 15.6, end: 18.8, tag: 'Custom Route Studio' },
    { id: 's6', start: 18.8, end: 21.4, tag: 'Share & Export PNG' },
    { id: 's7', start: 21.4, end: 24.0, tag: '' },
  ];

  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  const easeOutCubic = (x) => 1 - Math.pow(1 - clamp01(x), 3);
  const easeOutQuart = (x) => 1 - Math.pow(1 - clamp01(x), 4);
  const easeOutBack = (x) => {
    const t = clamp01(x);
    const c1 = 1.4;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  };
  const easeInOutCubic = (x) => {
    const t = clamp01(x);
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  };
  const seg = (t, a, b) => clamp01((t - a) / Math.max(0.0001, b - a));

  window.setReelTime = function(t) {
    // Ambient orbs gentle breathing motion synced to 124 BPM
    const beatPhase = (t * 124) / 60;
    const pulse = Math.sin(beatPhase * Math.PI * 2) * 10;
    document.getElementById('orb1').style.transform =
      'translate(' + (Math.sin(t * 0.45) * 40) + 'px,' + (Math.cos(t * 0.35) * 35 + pulse) + 'px)';
    document.getElementById('orb2').style.transform =
      'translate(' + (Math.cos(t * 0.4) * 35) + 'px,' + (Math.sin(t * 0.38) * 30 - pulse) + 'px)';

    // Story progress bar
    for (let i = 0; i < SCENES.length; i++) {
      const sc = SCENES[i];
      const fill = document.getElementById('seg' + i);
      if (t >= sc.end) fill.style.width = '100%';
      else if (t <= sc.start) fill.style.width = '0%';
      else fill.style.width = (clamp01((t - sc.start) / (sc.end - sc.start)) * 100).toFixed(2) + '%';
    }

    // Active scene index
    let activeIdx = SCENES.length - 1;
    for (let i = 0; i < SCENES.length; i++) {
      if (t >= SCENES[i].start && t < SCENES[i].end) {
        activeIdx = i;
        break;
      }
    }

    // Top brand header visibility (scenes 1..6)
    const topBrand = document.getElementById('topBrand');
    const brandIn = seg(t, 2.8, 3.15);
    const brandOut = 1 - seg(t, 21.1, 21.45);
    topBrand.style.opacity = (brandIn * brandOut).toFixed(3);
    if (SCENES[activeIdx].tag) {
      document.getElementById('topBrandTag').textContent = SCENES[activeIdx].tag;
    }

    // Scene cross-transitions with kinetic slide + scale
    for (let i = 0; i < SCENES.length; i++) {
      const sc = SCENES[i];
      const el = document.getElementById(sc.id);
      const local = t - sc.start;
      const dur = sc.end - sc.start;
      const transDur = 0.28;

      if (t < sc.start - 0.05 || t > sc.end + transDur) {
        el.style.opacity = '0';
        continue;
      }

      const inP = i === 0 ? 1 : easeOutQuart(seg(t, sc.start, sc.start + transDur));
      const outP = i === SCENES.length - 1 ? 0 : easeInOutCubic(seg(t, sc.end - 0.06, sc.end + transDur - 0.06));
      const opacity = clamp01(inP * (1 - outP));
      const enterY = i === 0 ? 0 : (1 - inP) * 56;
      const exitY = -outP * 44;
      const scale = (i === 0 ? 1 : 0.965 + 0.035 * inP) * (1 - outP * 0.025);

      el.style.opacity = opacity.toFixed(3);
      el.style.transform = 'translateY(' + (enterY + exitY).toFixed(2) + 'px) scale(' + scale.toFixed(4) + ')';

      // Per-scene choreography
      if (i === 0) {
        const markP = easeOutBack(seg(local, 0.0, 0.55));
        document.getElementById('s0MarkWrap').style.transform = 'scale(' + (0.55 + 0.45 * markP).toFixed(3) + ')';
        document.getElementById('s0MarkWrap').style.opacity = clamp01(seg(local, 0.0, 0.25)).toFixed(3);
        const ringP = easeOutCubic(seg(local, 0.15, 1.0));
        document.getElementById('s0Ring').style.transform = 'scale(' + (0.85 + 0.5 * ringP).toFixed(3) + ')';
        document.getElementById('s0Ring').style.opacity = (1 - ringP * 0.75).toFixed(3);

        const eyeP = easeOutCubic(seg(local, 0.22, 0.62));
        document.getElementById('s0Eye').style.opacity = eyeP.toFixed(3);
        document.getElementById('s0Eye').style.transform = 'translateY(' + ((1 - eyeP) * 24).toFixed(1) + 'px)';

        const headP = easeOutQuart(seg(local, 0.34, 0.85));
        document.getElementById('s0Head').style.opacity = headP.toFixed(3);
        document.getElementById('s0Head').style.transform = 'translateY(' + ((1 - headP) * 34).toFixed(1) + 'px)';

        const subP = easeOutCubic(seg(local, 0.52, 0.98));
        document.getElementById('s0Sub').style.opacity = subP.toFixed(3);
        document.getElementById('s0Sub').style.transform = 'translateY(' + ((1 - subP) * 24).toFixed(1) + 'px)';

        const frameP = easeOutQuart(seg(local, 0.62, 1.32));
        document.getElementById('s0Frame').style.opacity = frameP.toFixed(3);
        document.getElementById('s0Frame').style.transform =
          'translateY(' + ((1 - frameP) * 90).toFixed(1) + 'px) scale(' + (0.94 + 0.06 * frameP).toFixed(4) + ')';
        const kb = 1.0 + 0.075 * clamp01(local / dur);
        document.getElementById('s0Img').style.transform = 'scale(' + kb.toFixed(4) + ')';
      }

      if (i === 1) {
        const kb = 1.02 + 0.07 * clamp01(local / dur);
        const panY = -18 * clamp01(local / dur);
        document.getElementById('s1Img').style.transform = 'scale(' + kb.toFixed(4) + ') translateY(' + panY.toFixed(1) + 'px)';
        const activeFloorIdx = Math.min(3, Math.floor((local / dur) * 4));
        for (let f = 0; f < 4; f++) {
          document.getElementById('fl' + f).classList.toggle('is-active', f === activeFloorIdx);
        }
        const dockP = easeOutCubic(seg(local, 0.16, 0.56));
        document.getElementById('s1Dock').style.transform = 'translateY(' + ((1 - dockP) * 28).toFixed(1) + 'px)';
        document.getElementById('s1Dock').style.opacity = dockP.toFixed(3);
      }

      if (i === 2) {
        const kb = 1.01 + 0.065 * clamp01(local / dur);
        document.getElementById('s2Img').style.transform = 'scale(' + kb.toFixed(4) + ')';
        // Smoothly animate segmented pill across Walk -> Bike -> Bus -> Drive -> settle on Bike
        const modeStep = Math.min(3, Math.floor((local / dur) * 4));
        const order = [0, 1, 2, 3];
        const curMode = order[modeStep];
        const prevMode = order[Math.max(0, modeStep - 1)];
        const stepFrac = clamp01(((local / dur) * 4) - modeStep);
        const slidePos = prevMode + (curMode - prevMode) * easeOutQuart(stepFrac * 2.2);
        document.getElementById('modeSlider').style.transform = 'translateX(' + (slidePos * 100).toFixed(2) + '%)';
        for (let m = 0; m < 4; m++) {
          document.getElementById('m' + m).classList.toggle('is-active', m === curMode);
        }
      }

      if (i === 3) {
        const kb = 1.0 + 0.065 * clamp01(local / dur);
        document.getElementById('s3Img').style.transform = 'scale(' + kb.toFixed(4) + ')';
        const drawP = easeOutCubic(seg(local, 0.25, 1.55));
        document.getElementById('elevStroke').setAttribute('stroke-dashoffset', (520 * (1 - drawP)).toFixed(1));
        document.getElementById('elevFill').setAttribute('opacity', drawP.toFixed(3));
        document.getElementById('elevSteep').setAttribute('opacity', easeOutCubic(seg(local, 1.05, 1.45)).toFixed(3));
        const gridP = easeOutCubic(seg(local, 0.14, 0.55));
        document.getElementById('s3Grid').style.transform = 'translateY(' + ((1 - gridP) * 30).toFixed(1) + 'px)';
        document.getElementById('s3Grid').style.opacity = gridP.toFixed(3);
      }

      if (i === 4) {
        const kb = 1.02 + 0.075 * clamp01(local / dur);
        document.getElementById('s4Img').style.transform = 'scale(' + kb.toFixed(4) + ')';
        for (let c = 0; c < 3; c++) {
          const cp = easeOutQuart(seg(local, 0.16 + c * 0.26, 0.58 + c * 0.26));
          const card = document.getElementById('nc' + c);
          card.style.opacity = cp.toFixed(3);
          card.style.transform = 'translateY(' + ((1 - cp) * 32).toFixed(1) + 'px)';
        }
      }

      if (i === 5) {
        const kb = 1.0 + 0.06 * clamp01(local / dur);
        const swapP = easeInOutCubic(seg(local, 1.45, 1.85));
        document.getElementById('s5ImgA').style.transform = 'scale(' + kb.toFixed(4) + ')';
        document.getElementById('s5ImgB').style.transform = 'scale(' + (1.0 + 0.05 * swapP).toFixed(4) + ')';
        document.getElementById('s5ImgB').style.opacity = swapP.toFixed(3);
        document.getElementById('s5DockLabel').textContent =
          swapP > 0.5 ? 'Route Overview · Step Preview & 3D Sim' : 'Snap to Campus Paths & Roads';
        document.getElementById('al0').style.width = (easeOutCubic(seg(local, 0.15, 0.65)) * 100).toFixed(1) + '%';
        document.getElementById('al1').style.width = (easeOutCubic(seg(local, 0.55, 1.05)) * 100).toFixed(1) + '%';
        document.getElementById('al2').style.width = (easeOutCubic(seg(local, 0.95, 1.45)) * 100).toFixed(1) + '%';
      }

      if (i === 6) {
        const kb = 1.0 + 0.05 * clamp01(local / dur);
        const flipP = easeInOutCubic(seg(local, 1.15, 1.5));
        document.getElementById('s6ImgA').style.transform = 'scale(' + kb.toFixed(4) + ')';
        document.getElementById('s6ImgB').style.transform = 'scale(' + (1.0 + 0.04 * flipP).toFixed(4) + ')';
        document.getElementById('s6ImgB').style.opacity = flipP.toFixed(3);
        document.getElementById('expWhole').classList.toggle('is-active', flipP < 0.5);
        document.getElementById('expOnly').classList.toggle('is-active', flipP >= 0.5);
      }

      if (i === 7) {
        const logoP = easeOutBack(seg(local, 0.0, 0.58));
        document.getElementById('endLogo').style.transform = 'scale(' + (0.45 + 0.55 * logoP).toFixed(3) + ')';
        document.getElementById('er1').style.transform = 'scale(' + (0.65 + 0.38 * easeOutCubic(seg(local, 0.08, 0.9))).toFixed(3) + ')';
        document.getElementById('er2').style.transform = 'scale(' + (0.6 + 0.42 * easeOutCubic(seg(local, 0.16, 1.15))).toFixed(3) + ')';
        document.getElementById('er3').style.transform = 'scale(' + (0.55 + 0.46 * easeOutCubic(seg(local, 0.24, 1.4))).toFixed(3) + ')';

        const titleP = easeOutQuart(seg(local, 0.18, 0.62));
        document.getElementById('endTitle').style.opacity = titleP.toFixed(3);
        document.getElementById('endTitle').style.transform = 'translateY(' + ((1 - titleP) * 32).toFixed(1) + 'px)';

        const tagP = easeOutCubic(seg(local, 0.3, 0.72));
        document.getElementById('endTag').style.opacity = tagP.toFixed(3);
        document.getElementById('endTag').style.transform = 'translateY(' + ((1 - tagP) * 22).toFixed(1) + 'px)';

        const ctaP = easeOutBack(seg(local, 0.42, 0.92));
        document.getElementById('endCta').style.opacity = clamp01(seg(local, 0.42, 0.68)).toFixed(3);
        document.getElementById('endCta').style.transform = 'scale(' + (0.86 + 0.14 * ctaP).toFixed(3) + ')';
        const sheenP = seg(local, 1.0, 1.65);
        document.getElementById('endSheen').style.transform =
          'skewX(-20deg) translateX(' + (-260 + sheenP * 920).toFixed(1) + 'px)';

        const urlP = easeOutCubic(seg(local, 0.58, 1.0));
        document.getElementById('endUrl').style.opacity = urlP.toFixed(3);
        document.getElementById('endUrl').style.transform = 'translateY(' + ((1 - urlP) * 22).toFixed(1) + 'px)';

        const bioP = easeOutCubic(seg(local, 0.76, 1.18));
        const bob = Math.sin(local * 5.2) * 5;
        document.getElementById('endBio').style.opacity = bioP.toFixed(3);
        document.getElementById('endBio').style.transform = 'translateY(' + ((1 - bioP) * 18 + bob).toFixed(1) + 'px)';
      }
    }
  };
  window.setReelTime(0);
</script>
</body>
</html>`;
}

async function renderVideo() {
  fs.mkdirSync(TMP_DIR, { recursive: true });

  // 1. Ensure soundtrack & live app captures exist
  if (!fs.existsSync(WAV_PATH)) {
    console.log('Synthesizing 24s 124 BPM soundtrack...');
    generateSoundtrack(WAV_PATH);
  }
  if (!fs.existsSync(path.join(CAPTURE_DIR, '08b_share_route_only.png'))) {
    console.log('Capturing live UM 3D Atlas feature views...');
    await captureAllScenes();
  }

  const imgs = {
    hero: loadDataUri('01_hero_3d.png'),
    xray: loadDataUri('02_indoor_xray.png'),
    multistop: loadDataUri('03_multistop_modes.png'),
    elevWeather: loadDataUri('04_elevation_weather.png'),
    liveNav: loadDataUri('05_live_nav.png'),
    customDraw: loadDataUri('06_custom_draw.png'),
    overviewSim: loadDataUri('07_overview_sim.png'),
    shareWhole: loadDataUri('08_share_png.png'),
    shareOnly: loadDataUri('08b_share_route_only.png'),
  };

  const stageHtml = buildStageHtml(imgs, SITE_URL);
  const stageFile = path.join(TMP_DIR, 'stage.html');
  fs.writeFileSync(stageFile, stageHtml);

  const pw = await import(PW_PATH);
  const browser = await pw.chromium.launch({
    executablePath: CHROME_EXE,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  const context = await browser.newContext({
    viewport: { width: WIDTH, height: HEIGHT },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  await page.goto(`file://${stageFile}`, { waitUntil: 'networkidle' });
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await page.waitForTimeout(300);

  console.log(`Rendering ${TOTAL_FRAMES} frames (${WIDTH}x${HEIGHT} @ ${FPS}fps) -> ${OUTPUT_MP4}`);

  const ffmpeg = spawn(
    'ffmpeg',
    [
      '-y',
      '-f', 'image2pipe',
      '-vcodec', 'png',
      '-r', String(FPS),
      '-i', '-',
      '-i', WAV_PATH,
      '-c:v', 'libx264',
      '-profile:v', 'high',
      '-level:v', '4.2',
      '-pix_fmt', 'yuv420p',
      '-crf', '24',
      '-preset', 'slow',
      '-maxrate', '1600k',
      '-bufsize', '3200k',
      '-af', 'volume=3.2dB',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-ar', '48000',
      '-shortest',
      '-movflags', '+faststart',
      OUTPUT_MP4,
    ],
    { stdio: ['pipe', 'inherit', 'pipe'] },
  );

  let ffmpegErr = '';
  ffmpeg.stderr.on('data', (chunk) => {
    ffmpegErr += chunk.toString();
  });

  const startMs = Date.now();
  for (let frame = 0; frame < TOTAL_FRAMES; frame++) {
    const t = frame / FPS;
    await page.evaluate((sec) => window.setReelTime(sec), t);
    const pngBuf = await page.screenshot({ type: 'png' });
    if (!ffmpeg.stdin.write(pngBuf)) {
      await new Promise((resolve) => ffmpeg.stdin.once('drain', resolve));
    }
    if ((frame + 1) % 120 === 0 || frame === TOTAL_FRAMES - 1) {
      const pct = Math.round(((frame + 1) / TOTAL_FRAMES) * 100);
      const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);
      console.log(`Rendered ${frame + 1}/${TOTAL_FRAMES} frames (${pct}%) in ${elapsed}s`);
    }
  }

  ffmpeg.stdin.end();
  await new Promise((resolve, reject) => {
    ffmpeg.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with code ${code}\n${ffmpegErr.slice(-1000)}`));
    });
  });

  await browser.close();
  console.log('Done! Video written to:', OUTPUT_MP4);
}

renderVideo().catch((err) => {
  console.error(err);
  process.exit(1);
});
