import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { generateSoundtrack, DURATION_S } from './synth-audio.mjs';
import { captureAllLiveActs } from './capture-live-acts.mjs';

const PW_PATH = '/usr/local/share/bun-global/node_modules/playwright-core/index.mjs';
const CHROME_EXE =
  '/ms-playwright/chromium_headless_shell-1247/chrome-headless-shell-linux64/chrome-headless-shell';

const WIDTH = 1080;
const HEIGHT = 1920;
const FPS = 30;
const XFADE_DUR = 0.36;

const SITE_URL = process.env.PROMO_SITE_URL || 'um-3d-atlas.netlify.app';
const TMP_DIR = path.resolve('promo-video/.tmp');
const CLIPS_DIR = path.join(TMP_DIR, 'clips');
const OVERLAY_DIR = path.join(TMP_DIR, 'overlays');
const META_PATH = path.join(CLIPS_DIR, 'meta.json');
const WAV_PATH = path.join(TMP_DIR, 'soundtrack.wav');
const ENDCARD_MP4 = path.join(TMP_DIR, 'act10_endcard.mp4');
const OUTPUT_MP4 = path.resolve('promo-video/um-3d-atlas-reel-9x16.mp4');

// Clean, understated human captions in thin Inter (strictly max weight 500)
const ACT_SPECS = [
  {
    id: 'act01_orbit',
    dur: 2.8,
    pos: 'bottom',
    kicker: 'UM 3D Atlas',
    title: 'Universiti Malaya in 3D',
    sub: 'Interactive campus map, built for everyday navigation',
    transitionToNext: 'circleopen',
  },
  {
    id: 'act02_search_fly',
    dur: 3.4,
    pos: 'bottom',
    kicker: 'Search',
    title: 'Find any building fast',
    sub: 'Faculties, lecture halls, colleges and gates',
    transitionToNext: 'smoothleft',
  },
  {
    id: 'act03_indoor_xray',
    dur: 3.4,
    pos: 'top',
    kicker: 'Indoor view',
    title: 'Look inside every floor',
    sub: 'Cutaway 3D shell with room-level floor switching',
    transitionToNext: 'smoothup',
  },
  {
    id: 'act04_dark_layers',
    dur: 2.8,
    pos: 'top',
    kicker: 'Layers & appearance',
    title: 'Light, dark & campus trails',
    sub: 'Jogging loops, saved places and clean 3D map layers',
    transitionToNext: 'smoothright',
  },
  {
    id: 'act05_transit',
    dur: 3.2,
    pos: 'top',
    kicker: 'Transit',
    title: 'Shuttle & RapidKL lines',
    sub: 'Highlight campus bus routes and nearby stops',
    transitionToNext: 'radial',
  },
  {
    id: 'act06_multistop_weather',
    dur: 3.8,
    pos: 'bottom',
    kicker: 'Directions & conditions',
    title: 'Multi-stop, hills & weather',
    sub: 'Route optimization, elevation gain and rain forecast',
    transitionToNext: 'smoothleft',
  },
  {
    id: 'act07_live_nav',
    dur: 4.8,
    pos: 'bottom',
    kicker: 'Live navigation',
    title: 'Guided right on the road',
    sub: 'Turn arrows on road, live GPS, zone alerts & auto reroute',
    transitionToNext: 'smoothup',
  },
  {
    id: 'act08_draw_overview',
    dur: 3.6,
    pos: 'top',
    kicker: 'Custom routes',
    title: 'Draw & snap your path',
    sub: 'Place points, snap to campus roads & preview in 3D',
    transitionToNext: 'dissolve',
  },
  {
    id: 'act09_share_png',
    dur: 3.4,
    pos: 'bottom-low',
    kicker: 'Share & export',
    title: 'Share a link or PNG card',
    sub: 'Whole map or route-only export with distance & steps',
    transitionToNext: 'fadewhite',
  },
];

// End card fills remaining timeline cleanly up to DURATION_S (35.0s)
const LIVE_NET_SUM = ACT_SPECS.reduce((acc, a) => acc + a.dur, 0); // 31.2s
const ENDCARD_NET_DUR = +(DURATION_S - LIVE_NET_SUM).toFixed(2); // 3.8s

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    proc.stderr.on('data', (c) => {
      err += c.toString();
    });
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited ${code}:\n${err.slice(-1600)}`));
    });
  });
}

function probeDurationS(filePath) {
  const out = execFileSync('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=nw=1:nk=1',
    filePath,
  ]).toString().trim();
  const parsed = Number.parseFloat(out);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  // Fallback: count frames at 25fps for WebM streams without container duration
  const frames = execFileSync('ffprobe', [
    '-v', 'error',
    '-count_frames',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=nb_read_frames',
    '-of', 'default=nw=1:nk=1',
    filePath,
  ]).toString().trim();
  return Math.max(1, Number.parseInt(frames, 10) / 25);
}

/**
 * Generates transparent PNG overlay cards for each live act (thin Inter <= 500, clean M3)
 * and renders the crisp Light Material 3 End Card clip (30 fps).
 */
async function renderTypographyAssets() {
  fs.mkdirSync(OVERLAY_DIR, { recursive: true });
  const pw = await import(PW_PATH);
  const browser = await pw.chromium.launch({
    executablePath: CHROME_EXE,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  const ctx = await browser.newContext({
    viewport: { width: WIDTH, height: HEIGHT },
    deviceScaleFactor: 1,
  });

  // 1. Render crisp transparent PNG overlays for Acts 1..9
  const ovPage = await ctx.newPage();
  for (let i = 0; i < ACT_SPECS.length; i++) {
    const act = ACT_SPECS[i];
    const cardPosCss =
      act.pos === 'top'
        ? 'top: 74px;'
        : act.pos === 'bottom-low'
          ? 'bottom: 36px;'
          : 'bottom: 186px;';
    const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500&display=swap" rel="stylesheet" />
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body {
    width: 1080px;
    height: 1920px;
    background: transparent;
    overflow: hidden;
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  .progress {
    position: absolute;
    top: 40px;
    left: 44px;
    right: 44px;
    height: 4px;
    display: flex;
    gap: 6px;
  }
  .seg {
    flex: 1;
    height: 4px;
    border-radius: 999px;
    background: rgba(15, 23, 42, 0.16);
    overflow: hidden;
  }
  .seg.is-done {
    background: rgba(26, 115, 232, 0.92);
  }
  .seg.is-cur {
    background: rgba(26, 115, 232, 0.55);
  }
  .card {
    position: absolute;
    left: 44px;
    right: 44px;
    ${cardPosCss}
    padding: 18px 26px;
    border-radius: 22px;
    background: rgba(255, 255, 255, 0.92);
    border: 1px solid rgba(15, 23, 42, 0.08);
    box-shadow: 0 12px 30px rgba(15, 23, 42, 0.12);
  }
  .kicker {
    font-size: 19px;
    font-weight: 500;
    color: #1A73E8;
    letter-spacing: -0.01em;
    margin-bottom: 4px;
  }
  .title {
    font-size: 40px;
    font-weight: 400;
    letter-spacing: -0.028em;
    line-height: 1.12;
    color: #1F1F1F;
  }
  .sub {
    margin-top: 6px;
    font-size: 21px;
    font-weight: 300;
    line-height: 1.3;
    color: #444746;
  }
</style>
</head>
<body>
  <div class="progress">
    ${Array.from({ length: 10 }, (_, k) => `<div class="seg ${k < i ? 'is-done' : k === i ? 'is-cur' : ''}"></div>`).join('')}
  </div>
  <div class="card">
    <div class="kicker">${act.kicker}</div>
    <div class="title">${act.title}</div>
    <div class="sub">${act.sub}</div>
  </div>
</body>
</html>`;
    await ovPage.setContent(html, { waitUntil: 'networkidle' });
    await ovPage.evaluate(() => document.fonts.ready);
    await ovPage.screenshot({
      path: path.join(OVERLAY_DIR, `${act.id}.png`),
      omitBackground: true,
    });
  }
  await ovPage.close();

  // 2. Render smooth 30fps Light Material 3 End Card (clean, thin Inter <= 500, zero AI gimmicks)
  const endDur = +(ENDCARD_NET_DUR + XFADE_DUR).toFixed(2);
  const endFrames = Math.round(endDur * FPS);
  const endHtml = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500&family=Roboto+Mono:wght@400;500&display=swap" rel="stylesheet" />
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body {
    width: 1080px;
    height: 1920px;
    overflow: hidden;
    background: #F8FAFD;
    color: #1F1F1F;
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  .stage {
    position: relative;
    width: 1080px;
    height: 1920px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 160px 72px 200px;
    background: #F8FAFD;
  }
  .progress {
    position: absolute;
    top: 64px;
    left: 44px;
    right: 44px;
    height: 4px;
    display: flex;
    gap: 6px;
  }
  .seg {
    flex: 1;
    height: 4px;
    border-radius: 999px;
    background: rgba(26, 115, 232, 0.92);
  }
  .mark {
    width: 132px;
    height: 132px;
    border-radius: 34px;
    background: #1A73E8;
    color: #FFFFFF;
    font-size: 50px;
    font-weight: 500;
    letter-spacing: -0.03em;
    display: grid;
    place-items: center;
    box-shadow: 0 18px 40px rgba(26, 115, 232, 0.24);
    margin-bottom: 40px;
  }
  .title {
    font-size: 76px;
    font-weight: 400;
    letter-spacing: -0.035em;
    line-height: 1.05;
    color: #1F1F1F;
    text-align: center;
  }
  .sub {
    margin-top: 18px;
    font-size: 30px;
    font-weight: 300;
    color: #5F6368;
    text-align: center;
  }
  .cta {
    margin-top: 56px;
    height: 84px;
    padding: 0 48px;
    border-radius: 999px;
    background: #1A73E8;
    color: #FFFFFF;
    font-size: 30px;
    font-weight: 500;
    letter-spacing: -0.015em;
    display: inline-flex;
    align-items: center;
    gap: 14px;
    box-shadow: 0 14px 32px rgba(26, 115, 232, 0.26);
  }
  .url-card {
    margin-top: 28px;
    padding: 18px 34px;
    border-radius: 20px;
    background: #FFFFFF;
    border: 1px solid #DCE3ED;
    display: inline-flex;
    align-items: center;
    gap: 12px;
    font-family: 'Roboto Mono', monospace;
    font-size: 25px;
    font-weight: 400;
    color: #0B57D0;
  }
  .bio {
    margin-top: 34px;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-size: 24px;
    font-weight: 400;
    color: #5F6368;
  }
</style>
</head>
<body>
  <div class="stage">
    <div class="progress">
      ${Array.from({ length: 10 }, () => `<div class="seg"></div>`).join('')}
    </div>
    <div class="mark" id="mark">UM</div>
    <h1 class="title" id="title">UM 3D Atlas</h1>
    <p class="sub" id="sub">Navigate Universiti Malaya in 3D</p>
    <div class="cta" id="cta">
      <span>Try UM 3D Atlas</span>
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m13 5 7 7-7 7"/></svg>
    </div>
    <div class="url-card" id="url">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
      <span>${SITE_URL}</span>
    </div>
    <div class="bio" id="bio">
      <span>Link in bio</span>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#1A73E8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m18 15-6-6-6 6"/></svg>
    </div>
  </div>
<script>
  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  const easeOut = (x) => 1 - Math.pow(1 - clamp01(x), 3);
  const seg = (t, a, b) => clamp01((t - a) / Math.max(0.001, b - a));
  window.setEndTime = function(t) {
    const items = [
      ['mark', 0.15, 0.65, 24],
      ['title', 0.28, 0.80, 26],
      ['sub', 0.42, 0.92, 20],
      ['cta', 0.56, 1.05, 22],
      ['url', 0.72, 1.22, 18],
      ['bio', 0.92, 1.40, 14],
    ];
    for (const [id, a, b, dy] of items) {
      const p = easeOut(seg(t, a, b));
      const el = document.getElementById(id);
      el.style.opacity = p.toFixed(3);
      el.style.transform = 'translateY(' + ((1 - p) * dy).toFixed(1) + 'px)';
    }
  };
  window.setEndTime(0);
</script>
</body>
</html>`;

  const endPage = await ctx.newPage();
  await endPage.setContent(endHtml, { waitUntil: 'networkidle' });
  await endPage.evaluate(() => document.fonts.ready);

  const enc = spawn(
    'ffmpeg',
    [
      '-y',
      '-f', 'image2pipe',
      '-vcodec', 'png',
      '-r', String(FPS),
      '-i', '-',
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-crf', '16',
      '-preset', 'fast',
      ENDCARD_MP4,
    ],
    { stdio: ['pipe', 'ignore', 'pipe'] },
  );
  let encErr = '';
  enc.stderr.on('data', (c) => {
    encErr += c.toString();
  });

  for (let f = 0; f < endFrames; f++) {
    await endPage.evaluate((sec) => window.setEndTime(sec), f / FPS);
    const png = await endPage.screenshot({ type: 'png' });
    if (!enc.stdin.write(png)) {
      await new Promise((r) => enc.stdin.once('drain', r));
    }
  }
  enc.stdin.end();
  await new Promise((resolve, reject) => {
    enc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`End card ffmpeg exited ${code}:\n${encErr.slice(-800)}`));
    });
  });

  await browser.close();
  console.log(`Rendered 9 thin-Inter overlays + ${endDur}s Light M3 end card.`);
}

async function renderVideo() {
  fs.mkdirSync(TMP_DIR, { recursive: true });

  if (!fs.existsSync(WAV_PATH)) {
    console.log('Generating 35s 126 BPM soundtrack...');
    generateSoundtrack(WAV_PATH);
  }
  if (!fs.existsSync(META_PATH)) {
    console.log('Recording all 9 live full-screen 3D acts...');
    await captureAllLiveActs();
  }

  const metaList = JSON.parse(fs.readFileSync(META_PATH, 'utf8'));
  const metaById = new Map(metaList.map((m) => [m.id, m]));

  await renderTypographyAssets();

  // Step 1: Normalize each live WebM clip cleanly -> exact 1080x1920 @ 30fps, speed-ramped to match beat + xfade tail,
  // with crisp thin-Inter (<= 500) floating overlay composited cleanly on top
  const preparedClips = [];
  for (let i = 0; i < ACT_SPECS.length; i++) {
    const spec = ACT_SPECS[i];
    const meta = metaById.get(spec.id);
    if (!meta || !fs.existsSync(meta.file)) {
      throw new Error(`Missing recorded act clip: ${spec.id}`);
    }

    const rawTotal = probeDurationS(meta.file);
    // Keep a safe slice inside the actual recorded duration
    const startS = Math.max(0, Math.min(meta.startS, Math.max(0, rawTotal - 1.2)));
    const endS = Math.min(rawTotal - 0.05, Math.max(startS + 0.8, meta.endS));
    const spanS = Math.max(0.8, endS - startS);

    // Every act needs extra XFADE_DUR overlap for outgoing transition (and first clip only has outgoing; middle clips share overlap)
    const clipOutDur = +(spec.dur + XFADE_DUR).toFixed(3);
    const speedFactor = clipOutDur / spanS; // setpts=PTS*speedFactor stretches/compresses smoothly!

    const overlayPng = path.join(OVERLAY_DIR, `${spec.id}.png`);
    const outClip = path.join(TMP_DIR, `${spec.id}_prep.mp4`);

    console.log(
      `Preparing ${spec.id}: trim ${startS.toFixed(2)}s..${endS.toFixed(2)}s (${spanS.toFixed(2)}s -> ${clipOutDur.toFixed(2)}s, ${(1 / speedFactor).toFixed(2)}x speed)`,
    );

    const filterComplex = [
      `[0:v]trim=start=${startS.toFixed(3)}:end=${endS.toFixed(3)},setpts=(PTS-STARTPTS)*${speedFactor.toFixed(5)},scale=${WIDTH}:${HEIGHT}:flags=lanczos,fps=${FPS},format=rgba[base]`,
      // Fade overlay caption cleanly in (0.28s) and out right before cut
      `[1:v]format=rgba,fade=t=in:st=0.14:d=0.26:alpha=1,fade=t=out:st=${(clipOutDur - 0.48).toFixed(3)}:d=0.22:alpha=1[ov]`,
      `[base][ov]overlay=0:0:shortest=1,format=yuv420p[vout]`,
    ].join(';');

    await runFfmpeg([
      '-y',
      '-i', meta.file,
      '-loop', '1',
      '-t', String(clipOutDur + 0.2),
      '-i', overlayPng,
      '-filter_complex', filterComplex,
      '-map', '[vout]',
      '-t', String(clipOutDur),
      '-r', String(FPS),
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-crf', '16',
      '-preset', 'fast',
      outClip,
    ]);

    preparedClips.push({ id: spec.id, file: outClip, netDur: spec.dur, transitionToNext: spec.transitionToNext });
  }

  // Append Act 10 End Card
  preparedClips.push({ id: 'act10_endcard', file: ENDCARD_MP4, netDur: ENDCARD_NET_DUR, transitionToNext: null });

  // Step 2: Chain all 10 clips with smooth FFmpeg xfade transitions synced to the 126 BPM soundtrack
  const inputs = [];
  for (const c of preparedClips) {
    inputs.push('-i', c.file);
  }
  inputs.push('-i', WAV_PATH);
  const audioIdx = preparedClips.length;

  const filters = [];
  let prevLabel = '[0:v]';
  let offset = 0;

  for (let i = 0; i < preparedClips.length - 1; i++) {
    const cur = preparedClips[i];
    offset = +(offset + cur.netDur).toFixed(3);
    const outLabel = i === preparedClips.length - 2 ? '[vfinal]' : `[xf${i}]`;
    const tr = cur.transitionToNext || 'fade';
    filters.push(
      `${prevLabel}[${i + 1}:v]xfade=transition=${tr}:duration=${XFADE_DUR}:offset=${offset}${outLabel}`,
    );
    prevLabel = outLabel;
  }

  console.log(`Mastering 35.0s 1080x1920 @ 30fps Reel with 9 smooth xfade transitions -> ${OUTPUT_MP4}`);
  await runFfmpeg([
    '-y',
    ...inputs,
    '-filter_complex', filters.join(';'),
    '-map', '[vfinal]',
    '-map', `${audioIdx}:a`,
    '-t', String(DURATION_S),
    '-r', String(FPS),
    '-c:v', 'libx264',
    '-profile:v', 'high',
    '-level:v', '4.2',
    '-pix_fmt', 'yuv420p',
    '-crf', '24',
    '-preset', 'slow',
    '-maxrate', '1550k',
    '-bufsize', '3100k',
    '-af', 'volume=3.2dB',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-ar', '48000',
    '-movflags', '+faststart',
    OUTPUT_MP4,
  ]);

  const sizeMb = (fs.statSync(OUTPUT_MP4).size / (1024 * 1024)).toFixed(2);
  console.log(`Done! Mastered ${OUTPUT_MP4} (${sizeMb} MB)`);
}

renderVideo().catch((err) => {
  console.error(err);
  process.exit(1);
});
