import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const PW_PATH = '/usr/local/share/bun-global/node_modules/playwright-core/index.mjs';
const CHROME_EXE =
  '/ms-playwright/chromium_headless_shell-1247/chrome-headless-shell-linux64/chrome-headless-shell';

const BASE_URL = process.env.PROMO_APP_URL || 'http://127.0.0.1:3000';
const CLIPS_DIR = path.resolve('promo-video/.tmp/clips');
const META_PATH = path.join(CLIPS_DIR, 'meta.json');

// Exact 9:16 mobile portrait (540x960 @ 1x) matching recordVideo.size 1:1 -> zero gray borders,
// clean 2x Lanczos upscale to 1080x1920, stays inside <=900px mobile layout, fast on SwiftShader.
const VIEWPORT = { width: 540, height: 960 };
const VID_SIZE = { width: 540, height: 960 };

const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

async function smoothOrbit(
  page,
  {
    dx = 220,
    dy = -95,
    wheelTotal = 0,
    steps = 16,
    stepMs = 46,
    startX = 270,
    startY = 460,
  },
) {
  await page.mouse.move(startX, startY);
  await page.mouse.down({ button: 'right' });
  let prevW = 0;
  for (let i = 1; i <= steps; i++) {
    const p = easeInOut(i / steps);
    await page.mouse.move(startX + dx * p, startY + dy * p);
    if (wheelTotal !== 0) {
      const curW = wheelTotal * p;
      const dw = curW - prevW;
      prevW = curW;
      if (Math.abs(dw) > 1) {
        await page.mouse.wheel(0, dw);
      }
    }
    await page.waitForTimeout(stepMs);
  }
  await page.mouse.up({ button: 'right' });
}

async function smoothZoom(page, wheelTotal, steps = 9, stepMs = 42, x = 270, y = 440) {
  await page.mouse.move(x, y);
  let prevW = 0;
  for (let i = 1; i <= steps; i++) {
    const p = easeInOut(i / steps);
    const curW = wheelTotal * p;
    const dw = curW - prevW;
    prevW = curW;
    await page.mouse.wheel(0, dw);
    await page.waitForTimeout(stepMs);
  }
}

function probeWebmDurationS(filePath) {
  try {
    const out = execFileSync('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=nw=1:nk=1',
      filePath,
    ]).toString().trim();
    const parsed = Number.parseFloat(out);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  } catch {
    // fallback below
  }
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

async function recordAct(browser, id, targetDur, urlPath, runChoreography, setupBeforeRecord = null) {
  const actDir = path.join(CLIPS_DIR, id);
  fs.rmSync(actDir, { recursive: true, force: true });
  fs.mkdirSync(actDir, { recursive: true });

  const ctx = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
    geolocation: { latitude: 3.12092, longitude: 101.65384 },
    permissions: ['geolocation'],
    recordVideo: { dir: actDir, size: VID_SIZE },
  });

  await ctx.addInitScript(() => {
    try {
      localStorage.setItem('um-atlas-theme-v1', 'light');
      localStorage.setItem(
        'um-atlas-saved-v1',
        JSON.stringify(['faculty:FSKTM', 'faculty:LIB', 'faculty:DTC']),
      );
    } catch {
      // ignore
    }
  });

  const recEpoch = Date.now();
  const page = await ctx.newPage();
  await page.goto(`${BASE_URL}${urlPath}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('.loading-screen', { state: 'detached', timeout: 25000 }).catch(() => {});
  await page.waitForTimeout(1600);

  if (setupBeforeRecord) {
    await setupBeforeRecord(page);
  }

  const actionStartWall = (Date.now() - recEpoch) / 1000;
  await runChoreography(page);
  const actionEndWall = (Date.now() - recEpoch) / 1000;

  const rawVideoPath = await page.video().path();
  await ctx.close();
  const closeWall = (Date.now() - recEpoch) / 1000;

  const finalWebm = path.join(CLIPS_DIR, `${id}.webm`);
  fs.copyFileSync(rawVideoPath, finalWebm);
  fs.rmSync(actDir, { recursive: true, force: true });

  // Map wall-clock timestamps proportionally into actual WebM duration so trim never lags behind
  const webmDur = probeWebmDurationS(finalWebm);
  const scale = closeWall > 0 ? webmDur / closeWall : 1;
  const startS = Math.max(0, Math.min(webmDur - 1.2, +(actionStartWall * scale).toFixed(3)));
  const endS = Math.max(startS + 0.8, Math.min(webmDur - 0.05, +(actionEndWall * scale).toFixed(3)));

  console.log(
    `  recorded ${id}: webm=${webmDur.toFixed(2)}s, trim=${startS.toFixed(2)}s..${endS.toFixed(2)}s (span ${(endS - startS).toFixed(2)}s -> target ${targetDur}s)`,
  );
  return { id, file: finalWebm, startS, endS, targetDur };
}

export async function captureAllLiveActs(onlyIds = null) {
  fs.mkdirSync(CLIPS_DIR, { recursive: true });
  const pw = await import(PW_PATH);
  const browser = await pw.chromium.launch({
    executablePath: CHROME_EXE,
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-webgl',
      '--ignore-gpu-blocklist',
      '--disable-dev-shm-usage',
    ],
  });

  const jobs = [
    // ACT 1 (0.0 - 2.8s): Sweeping 3D Campus Orbit + Steep Pitch Dive + Zoom-In
    {
      id: 'act01_orbit',
      run: () =>
        recordAct(browser, 'act01_orbit', 2.8, '/', async (page) => {
          await smoothOrbit(page, {
            dx: 245,
            dy: -135,
            wheelTotal: -400,
            steps: 16,
            stepMs: 46,
            startX: 270,
            startY: 500,
          });
          await smoothOrbit(page, {
            dx: 110,
            dy: 28,
            wheelTotal: -160,
            steps: 9,
            stepMs: 44,
            startX: 270,
            startY: 480,
          });
        }),
    },

    // ACT 2 (2.8 - 6.2s): Live Search Typing "FSKTM" + Sweeping 3D Fly-To & Orbit
    {
      id: 'act02_search_fly',
      run: () =>
        recordAct(browser, 'act02_search_fly', 3.4, '/', async (page) => {
          const input = page.locator('input[aria-label="Search Universiti Malaya"]').first();
          await input.click();
          await page.waitForTimeout(140);
          await input.type('FSKTM', { delay: 75 });
          await page.waitForTimeout(420);
          const firstHit = page.locator('.search-results__list button').first();
          if (await firstHit.isVisible().catch(() => false)) {
            await firstHit.click();
          }
          await page.waitForTimeout(1250);
          const handle = page.locator('.inspector .sheet-handle').first();
          if (await handle.isVisible().catch(() => false)) {
            await handle.click();
            await page.waitForTimeout(180);
          }
          await smoothOrbit(page, {
            dx: -220,
            dy: -85,
            wheelTotal: -240,
            steps: 15,
            stepMs: 46,
            startX: 270,
            startY: 440,
          });
        }),
    },

    // ACT 3 (6.2 - 9.6s): Live Indoor 3D Building Cutaway X-Ray & Floor Cycling (G -> L1 -> L2) + Orbit
    {
      id: 'act03_indoor_xray',
      run: () =>
        recordAct(
          browser,
          'act03_indoor_xray',
          3.4,
          '/?place=building:way/359487784',
          async (page) => {
            await smoothZoom(page, -260, 8, 40, 270, 440);
            const xrayBtn = page.locator('.floor-ctl__btn[aria-label="Toggle building cutaway"]').first();
            if (await xrayBtn.isVisible().catch(() => false)) {
              await xrayBtn.click();
              await page.waitForTimeout(280);
            }
            await smoothOrbit(page, { dx: 135, dy: -55, steps: 9, stepMs: 46, startX: 270, startY: 440 });
            for (const label of ['L1', 'L2']) {
              const fl = page.locator('.floor-ctl__btn', { hasText: label }).first();
              if (await fl.isVisible().catch(() => false)) {
                await fl.click();
                await page.waitForTimeout(280);
              }
              await smoothOrbit(page, { dx: 115, dy: -16, steps: 8, stepMs: 46, startX: 270, startY: 440 });
            }
          },
          async (page) => {
            const handle = page.locator('.inspector .sheet-handle').first();
            if (await handle.isVisible().catch(() => false)) {
              await handle.click();
              await page.waitForTimeout(300);
            }
          },
        ),
    },

    // ACT 4 (9.6 - 12.4s): Campus Layers + Jogging Loops + Light -> Dark Flash Orbit -> Light + Saved
    {
      id: 'act04_dark_layers',
      run: () =>
        recordAct(browser, 'act04_dark_layers', 2.8, '/', async (page) => {
          const layersBtn = page.locator('.mobile-bar__item', { hasText: 'Layers' }).first();
          await layersBtn.click();
          await page.waitForTimeout(340);
          const darkBtn = page.locator('.layers-panel button', { hasText: 'Dark' }).first();
          if (await darkBtn.isVisible().catch(() => false)) {
            await darkBtn.click();
            await page.waitForTimeout(360);
          }
          const closeLayers = page.locator('button[aria-label="Close layers"]').first();
          if (await closeLayers.isVisible().catch(() => false)) {
            await closeLayers.click();
            await page.waitForTimeout(180);
          }
          await smoothOrbit(page, {
            dx: -230,
            dy: -95,
            wheelTotal: -220,
            steps: 13,
            stepMs: 46,
            startX: 270,
            startY: 480,
          });
          await layersBtn.click();
          await page.waitForTimeout(240);
          const lightBtn = page.locator('.layers-panel button', { hasText: 'Light' }).first();
          if (await lightBtn.isVisible().catch(() => false)) {
            await lightBtn.click();
            await page.waitForTimeout(260);
          }
          const savedBtn = page.locator('.mobile-bar__item', { hasText: 'Saved' }).first();
          await savedBtn.click();
          await page.waitForTimeout(550);
        }),
    },

    // ACT 5 (12.4 - 15.6s): RapidKL & UM Shuttle Transit Hub + Wide 3D Route Orbit
    {
      id: 'act05_transit',
      run: () =>
        recordAct(browser, 'act05_transit', 3.2, '/', async (page) => {
          const transitBtn = page.locator('.mobile-bar__item', { hasText: 'Transit' }).first();
          await transitBtn.click();
          await page.waitForTimeout(550);
          const t815 = page.locator('.transit-route-card', { hasText: 'T815' }).first();
          if (await t815.isVisible().catch(() => false)) {
            await t815.click();
            await page.waitForTimeout(480);
          }
          const closeBtn = page.locator('button[aria-label="Close transit hub"]').first();
          if (await closeBtn.isVisible().catch(() => false)) {
            await closeBtn.click();
            await page.waitForTimeout(260);
          }
          await smoothOrbit(page, {
            dx: 240,
            dy: -90,
            wheelTotal: 190,
            steps: 16,
            stepMs: 46,
            startX: 270,
            startY: 480,
          });
        }),
    },

    // ACT 6 (15.6 - 19.4s): Multi-Stop Directions + Elevation Profile + Sweeping 3D Route + Live Weather Popover
    {
      id: 'act06_multistop_weather',
      run: () =>
        recordAct(
          browser,
          'act06_multistop_weather',
          3.8,
          '/?from=faculty:LIB&stops=faculty:FK,faculty:DTC&to=faculty:FSKTM&mode=walk&name=Campus+Bike+Tour',
          async (page) => {
            const bikeBtn = page.locator('.m3-segmented--modes button', { hasText: 'Bike' }).first();
            if (await bikeBtn.isVisible().catch(() => false)) {
              await bikeBtn.click();
              await page.waitForTimeout(380);
            }
            const optBtn = page.locator('.directions button', { hasText: 'Optimize' }).first();
            if (await optBtn.isVisible().catch(() => false)) {
              await optBtn.click();
              await page.waitForTimeout(360);
            }
            await page
              .locator('.directions__body')
              .evaluate(async (el) => {
                for (let y = 0; y <= 260; y += 26) {
                  el.scrollTop = y;
                  await new Promise((r) => setTimeout(r, 22));
                }
              })
              .catch(() => {});
            await page.waitForTimeout(420);
            // Collapse the Directions sheet (keeping the blue multi-stop route live on the 3D map!)
            const collapseDir = page.locator('.directions .sheet-handle').first();
            if (await collapseDir.isVisible().catch(() => false)) {
              await collapseDir.click();
              await page.waitForTimeout(260);
            }
            await smoothOrbit(page, {
              dx: -170,
              dy: -75,
              wheelTotal: -120,
              steps: 11,
              stepMs: 46,
              startX: 270,
              startY: 420,
            });
            const condBtn = page.locator('.conditions-bar').first();
            if (await condBtn.isVisible().catch(() => false)) {
              await condBtn.click();
              await page.waitForTimeout(1050);
            }
          },
        ),
    },

    // ACT 7 (19.4 - 24.2s): Live 3D Chase-Cam Road Navigation (Gliding Swiftly Along Roads at 3x Bike Speed!)
    {
      id: 'act07_live_nav',
      run: () =>
        recordAct(
          browser,
          'act07_live_nav',
          4.8,
          '/?from=faculty:LIB&to=faculty:FSKTM&mode=bike',
          async (page) => {
            // Already gliding live in 3x 3D chase-cam! Let it cruise down Campus Road around turns & arrows
            await page.waitForTimeout(8800);
          },
          async (page) => {
            const useMyLoc = page.locator('.route-start-gate-btn').first();
            if (await useMyLoc.isVisible().catch(() => false)) {
              await useMyLoc.click();
              await page.waitForTimeout(1200);
            }
            const startBtn = page.locator('.route-summary__action-bar button:not([disabled])', { hasText: 'Start' }).first();
            await startBtn.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
            if (await startBtn.isEnabled().catch(() => false)) {
              await startBtn.click();
            }
            await page.locator('.nav-hud').waitFor({ state: 'visible', timeout: 6000 }).catch(() => {});
            await page.waitForTimeout(600);
            const simBtn = page.locator('.nav-hud button', { hasText: /Simulate route/i }).first();
            if (await simBtn.isVisible().catch(() => false)) {
              await simBtn.click();
              await page.waitForTimeout(300);
            }
            // Click ONCE to toggle 1x -> 3x (App.tsx toggles 1 <-> 3!)
            const speedBtn = page.locator('.nav-hud button[aria-label="Simulation speed 1x"]').first();
            if (await speedBtn.isVisible().catch(() => false)) {
              await speedBtn.click();
              await page.waitForTimeout(300);
            }
            console.log(`    act07_live_nav running live 3x bike chase-cam!`);
            await page.waitForTimeout(900);
          },
        ),
    },

    // ACT 8 (24.2 - 27.8s): Draw Custom Route + Snap to Roads + 3D Overview Sweeping Orbit & Zoom
    {
      id: 'act08_draw_overview',
      run: () =>
        recordAct(
          browser,
          'act08_draw_overview',
          3.6,
          '/?custom=3.12092,101.65384;3.12285,101.65540;3.12610,101.65240;3.12820,101.65060&mode=walk&snap=1&name=Tasik+Varsiti+Loop',
          async (page) => {
            await page.waitForTimeout(650);
            const ovBtn = page.locator('.draw-panel button', { hasText: 'Overview' }).first();
            if (await ovBtn.isVisible().catch(() => false)) {
              await ovBtn.click();
              await page.waitForTimeout(750);
            }
            await smoothOrbit(page, {
              dx: 245,
              dy: -95,
              wheelTotal: -280,
              steps: 15,
              stepMs: 46,
              startX: 270,
              startY: 430,
            });
            await smoothOrbit(page, {
              dx: 120,
              dy: 40,
              wheelTotal: 220,
              steps: 9,
              stepMs: 46,
              startX: 270,
              startY: 430,
            });
          },
        ),
    },

    // ACT 9 (27.8 - 31.2s): Name, Shareable Link & Export PNG (Whole Map -> Route-Only Light/Dark Card)
    {
      id: 'act09_share_png',
      run: () =>
        recordAct(
          browser,
          'act09_share_png',
          3.4,
          '/?custom=3.12092,101.65384;3.12285,101.65540;3.12610,101.65240;3.12820,101.65060&mode=walk&snap=1&name=Tasik+Varsiti+Loop',
          async (page) => {
            // Share modal is ALREADY open with rendered Whole map preview!
            await page.waitForTimeout(1300);
            const routeOnlyBtn = page.locator('.share-modal button', { hasText: 'Route only' }).first();
            if (await routeOnlyBtn.isVisible().catch(() => false)) {
              await routeOnlyBtn.click();
              await page.waitForTimeout(1150);
            }
            const lightBtn = page.locator('.share-modal button', { hasText: 'Light card' }).first();
            if (await lightBtn.isVisible().catch(() => false)) {
              await lightBtn.click();
              await page.waitForTimeout(1050);
            }
            const darkBtn = page.locator('.share-modal button', { hasText: 'Dark card' }).first();
            if (await darkBtn.isVisible().catch(() => false)) {
              await darkBtn.click();
              await page.waitForTimeout(850);
            }
            if (await lightBtn.isVisible().catch(() => false)) {
              await lightBtn.click();
              await page.waitForTimeout(650);
            }
          },
          async (page) => {
            const ovBtn = page.locator('.draw-panel button', { hasText: 'Overview' }).first();
            await ovBtn.waitFor({ state: 'visible', timeout: 6000 }).catch(() => {});
            if (await ovBtn.isVisible().catch(() => false)) {
              await ovBtn.click();
              await page.locator('.overview-bar').waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
              await page.waitForTimeout(650);
            }
            const shareBtn = page.locator('.overview-bar button, .draw-panel button', { hasText: 'Share / PNG' }).first();
            if (await shareBtn.isVisible().catch(() => false)) {
              await shareBtn.click();
            }
            await page.locator('.share-modal').waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
            // Wait for Whole map PNG preview to finish rendering before actionStart
            await page.waitForTimeout(1400);
            console.log(`    act09_share_png ShareModal ready!`);
          },
        ),
    },
  ];

  const existing = fs.existsSync(META_PATH) ? JSON.parse(fs.readFileSync(META_PATH, 'utf8')) : [];
  const byId = new Map(existing.map((m) => [m.id, m]));

  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i];
    if (onlyIds && !onlyIds.includes(job.id)) continue;
    console.log(`Recording live act ${i + 1}/${jobs.length} (${job.id})...`);
    const item = await job.run();
    byId.set(job.id, item);
    const ordered = jobs.map((j) => byId.get(j.id)).filter(Boolean);
    fs.writeFileSync(META_PATH, JSON.stringify(ordered, null, 2));
  }

  await browser.close();
  const finalOrdered = jobs.map((j) => byId.get(j.id)).filter(Boolean);
  console.log('Recorded live 3D acts cleanly ->', META_PATH);
  return finalOrdered;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  captureAllLiveActs(args.length > 0 ? args : null).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
