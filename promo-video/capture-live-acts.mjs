import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '/usr/local/share/bun-global/node_modules/playwright-core/index.mjs';

const BASE_URL = process.env.PROMO_BASE_URL || 'http://127.0.0.1:3000';
const CHROMIUM_EXEC =
  '/ms-playwright/chromium_headless_shell-1247/chrome-headless-shell-linux64/chrome-headless-shell';

// Exact 540 x 836 aspect match under the 248px solid white Material 3 header band!
// DPR 1.5 -> 810 x 1254 (exact 1:1 for Cutaway frames, crisp HD for Full-Screen)
const VIEWPORT = { width: 540, height: 836 };
const DPR = 1.5;

const TMP_DIR = path.resolve('promo-video/.tmp');
const FRAMES_DIR = path.join(TMP_DIR, 'frames');
const MANIFEST_PATH = path.join(TMP_DIR, 'manifest.json');

const SEED_SAVED = ['faculty:KPS', 'faculty:LIB', 'faculty:DTC'];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitMapReady(page, extraMs = 1800) {
  await page.waitForSelector('canvas.maplibregl-canvas', { timeout: 25000 });
  await sleep(extraMs);
}

async function snap(cdp, filename) {
  const fullPath = path.join(FRAMES_DIR, filename);
  const { data } = await cdp.send('Page.captureScreenshot', {
    format: 'jpeg',
    quality: 92,
    fromSurface: true,
  });
  fs.writeFileSync(fullPath, Buffer.from(data, 'base64'));
  return filename;
}

async function getNormBox(page, locator, label) {
  try {
    await locator.first().waitFor({ state: 'visible', timeout: 7000 });
    await locator.first().scrollIntoViewIfNeeded();
    await sleep(120);
    const box = await locator.first().boundingBox();
    if (!box) throw new Error('null boundingBox');
    return {
      x: box.x / VIEWPORT.width,
      y: box.y / VIEWPORT.height,
      w: box.width / VIEWPORT.width,
      h: box.height / VIEWPORT.height,
      cx: (box.x + box.width / 2) / VIEWPORT.width,
      cy: (box.y + box.height / 2) / VIEWPORT.height,
    };
  } catch (err) {
    console.warn(`[warn] bbox fallback for ${label}:`, err.message);
    return { x: 0.42, y: 0.45, w: 0.16, h: 0.06, cx: 0.5, cy: 0.48 };
  }
}

/**
 * Suppress accidental MapLibre cursor hover tooltips during programmatic camera drags.
 * Runs only in the headless capture page (zero edits to app code).
 */
async function hideHoverPopups(page) {
  await page.addStyleTag({
    content:
      '.maplibregl-popup, .maplibregl-popup-content, .map-tip { display: none !important; opacity: 0 !important; visibility: hidden !important; pointer-events: none !important; }',
  });
}

/**
 * Captures a gentle, natural 3D camera turn without frantic spinning or hover tooltips.
 * MapLibre drag sensitivity is ~0.75 deg/px, so totalDx ~26-40px produces a natural ~20-30 deg turn.
 */
async function captureGentleTurn(
  page,
  cdp,
  prefix,
  steps,
  totalDx,
  totalDy,
  startX = 90,
  startY = 580,
  delayMs = 90,
) {
  await hideHoverPopups(page);
  const files = [];
  await page.mouse.move(4, 4);
  await sleep(60);
  files.push(await snap(cdp, `${prefix}_000.jpg`));

  await page.mouse.move(startX, startY);
  await page.mouse.down({ button: 'right' });
  await sleep(45);

  let curX = startX;
  let curY = startY;
  const stepDx = totalDx / steps;
  const stepDy = totalDy / steps;

  for (let i = 1; i <= steps; i++) {
    curX += stepDx;
    curY += stepDy;
    await page.mouse.move(curX, curY, { steps: 1 });
    await sleep(delayMs);
    const fname = `${prefix}_${String(i).padStart(3, '0')}.jpg`;
    files.push(await snap(cdp, fname));
  }

  await page.mouse.up({ button: 'right' });
  await page.mouse.move(4, 4);
  await sleep(50);
  return files;
}

async function newContextPage(browser, geolocation = { latitude: 3.120298, longitude: 101.654054 }) {
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: DPR,
    hasTouch: true,
    isMobile: true,
    geolocation,
    permissions: ['geolocation'],
  });
  await context.addInitScript(
    ({ saved }) => {
      try {
        localStorage.setItem('um-atlas-theme-v1', 'light');
        localStorage.setItem('um-atlas-saved-v1', JSON.stringify(saved));
      } catch {
        // ignore
      }
    },
    { saved: SEED_SAVED },
  );
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  const cdp = await context.newCDPSession(page);
  return { context, page, cdp };
}

function saveManifest(manifest) {
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
}

async function main() {
  const onlyActs = process.env.PROMO_ACTS
    ? new Set(process.env.PROMO_ACTS.split(',').map((s) => s.trim()))
    : null;

  fs.mkdirSync(FRAMES_DIR, { recursive: true });
  let manifest = {
    viewport: VIEWPORT,
    pixelSize: { width: Math.round(VIEWPORT.width * DPR), height: Math.round(VIEWPORT.height * DPR) },
    acts: {},
  };
  if (onlyActs && fs.existsSync(MANIFEST_PATH)) {
    manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  }

  const shouldRun = (id) => !onlyActs || onlyActs.has(id);

  const t0 = Date.now();
  console.log('Launching headless Chromium for deterministic HiDPI capture (810x1254)...');
  const browser = await chromium.launch({
    executablePath: CHROMIUM_EXEC,
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--enable-webgl',
      '--ignore-gpu-blocklist',
      '--font-render-hinting=none',
    ],
  });

  try {
    // ------------------------------------------------------------------
    // ACT 1: Full-Screen · 3D Campus Overview (gentle ~28° natural turn)
    // ------------------------------------------------------------------
    if (shouldRun('act1')) {
      console.log('Capturing Act 1: 3D Campus Overview...');
      const { context, page, cdp } = await newContextPage(browser);
      await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded' });
      await waitMapReady(page, 2400);

      await page.mouse.move(270, 420);
      await page.mouse.wheel(0, -130);
      await sleep(900);

      const seq = await captureGentleTurn(page, cdp, 'act1', 14, -38, 7, 90, 580, 90);
      manifest.acts.act1 = { seq };
      saveManifest(manifest);
      await context.close();
      console.log(`  Act 1 done (${seq.length} frames, ${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    }

    // ------------------------------------------------------------------
    // ACT 2: Cutaway + Diagram · Instant Search ("KPS")
    // ------------------------------------------------------------------
    if (shouldRun('act2')) {
      console.log('Capturing Act 2: Instant Search (KPS)...');
      const { context, page, cdp } = await newContextPage(browser);
      await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded' });
      await waitMapReady(page, 2000);
      await hideHoverPopups(page);

      const searchInput = page.locator('input[aria-label="Search Universiti Malaya"]');
      const searchBox = await getNormBox(page, searchInput, 'searchInput');
      const idle = await snap(cdp, 'act2_idle.jpg');

      await searchInput.click();
      await sleep(180);
      await page.keyboard.type('K', { delay: 25 });
      await sleep(180);
      const type1 = await snap(cdp, 'act2_type1.jpg');

      await page.keyboard.type('P', { delay: 25 });
      await sleep(180);
      const type2 = await snap(cdp, 'act2_type2.jpg');

      await page.keyboard.type('S', { delay: 25 });
      await sleep(500);

      const kpsBtn = page
        .locator('.search-results__list button')
        .filter({ hasText: /Kompleks Perdanasiswa/i })
        .first();
      const targetResult = (await kpsBtn.count()) > 0 ? kpsBtn : page.locator('.search-results__list button').first();
      const resultBox = await getNormBox(page, targetResult, 'kpsResult');
      const results = await snap(cdp, 'act2_results.jpg');

      await targetResult.click();
      await sleep(2200);
      const focusedSeq = await captureGentleTurn(page, cdp, 'act2_focus', 5, 16, 3, 90, 220, 90);

      manifest.acts.act2 = {
        idle,
        type1,
        type2,
        results,
        focusedSeq,
        boxes: { searchInput: searchBox, kpsResult: resultBox },
      };
      saveManifest(manifest);
      await context.close();
      console.log(`  Act 2 done (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    }

    // ------------------------------------------------------------------
    // ACT 3: Full-Screen · KPS Block C (Auditorium KPS) Indoor 3D Cutaway
    // ------------------------------------------------------------------
    if (shouldRun('act3')) {
      console.log('Capturing Act 3: KPS Block C Indoor 3D Cutaway...');
      const { context, page, cdp } = await newContextPage(browser);
      await page.goto(`${BASE_URL}/?place=building:way/1007727348`, { waitUntil: 'domcontentloaded' });
      await waitMapReady(page, 2600);
      await hideHoverPopups(page);

      // Zoom slightly closer so KPS Block C sits boldly above the mobile inspector sheet
      await page.mouse.move(260, 260);
      await page.mouse.wheel(0, -100);
      await sleep(800);

      // Mobile inspector sheet has the real Cutaway shell switch & floor chips (.floor-chip)
      const cutawaySwitch = page.locator('.inspector .m3-switch').first();
      const cutawayInput = page.locator('input[aria-label="Cutaway building shell"]').first();

      // If cutaway starts ON by default, toggle it OFF first so we can show solid shell -> cutaway!
      if ((await cutawayInput.count()) > 0 && (await cutawayInput.isChecked())) {
        await cutawaySwitch.click();
        await sleep(750);
      }

      const cutawayBox = await getNormBox(page, cutawaySwitch, 'cutawayBtn');
      const shell = await snap(cdp, 'act3_shell.jpg');

      // Tap Cutaway switch ON -> peels KPS Block C open!
      await cutawaySwitch.click();
      await sleep(850);

      const floorL1Btn = page.locator('.inspector .floor-chip').filter({ hasText: /Level 1|^L1$/i }).first();
      const l1Box = await getNormBox(page, floorL1Btn, 'floorL1Btn');
      const xrayG = await snap(cdp, 'act3_xray_g.jpg');

      await floorL1Btn.click();
      await sleep(750);
      const floorL2Btn = page.locator('.inspector .floor-chip').filter({ hasText: /Level 2|^L2$/i }).first();
      const l2Box = await getNormBox(page, floorL2Btn, 'floorL2Btn');
      const xrayL1 = await snap(cdp, 'act3_xray_l1.jpg');

      await floorL2Btn.click();
      await sleep(750);

      // Collapse inspector sheet for unobstructed 3D cutaway showcase turn around KPS Block C
      const sheetHandle = page.locator('.inspector .sheet-handle').first();
      if ((await sheetHandle.count()) > 0 && (await sheetHandle.isVisible())) {
        await sheetHandle.click();
        await sleep(600);
      }
      const orbitSeq = await captureGentleTurn(page, cdp, 'act3_orbit', 8, 28, 5, 90, 560, 90);

      manifest.acts.act3 = {
        shell,
        xrayG,
        xrayL1,
        orbitSeq,
        boxes: { cutawayBtn: cutawayBox, floorL1Btn: l1Box, floorL2Btn: l2Box },
      };
      saveManifest(manifest);
      await context.close();
      console.log(`  Act 3 done (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    }

    // ------------------------------------------------------------------
    // ACT 4: Cutaway + Diagram · Layers, Dark Mode, Trails & Saved Places
    // ------------------------------------------------------------------
    if (shouldRun('act4')) {
      console.log('Capturing Act 4: Layers, Dark Mode & Saved Places...');
      const { context, page, cdp } = await newContextPage(browser);
      await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded' });
      await waitMapReady(page, 2000);
      await hideHoverPopups(page);

      await page.locator('.mobile-bar__item').filter({ hasText: /^Layers$/i }).first().click();
      await sleep(550);

      const darkBtn = page.locator('.layers-panel button').filter({ hasText: /^Dark$/i }).first();
      const darkBox = await getNormBox(page, darkBtn, 'darkBtn');
      const layersLight = await snap(cdp, 'act4_layers_light.jpg');

      await darkBtn.click();
      await sleep(1600);
      const layersDark = await snap(cdp, 'act4_layers_dark.jpg');

      await page.locator('button[aria-label="Close layers"]').first().click();
      await sleep(450);

      const darkSeq = await captureGentleTurn(page, cdp, 'act4_dark', 8, -26, 5, 90, 580, 90);

      // Switch back to Light and open Saved Places sheet (KPS, LIB, DTC)
      await page.locator('.mobile-bar__item').filter({ hasText: /^Layers$/i }).first().click();
      await sleep(400);
      await page.locator('.layers-panel button').filter({ hasText: /^Light$/i }).first().click();
      await sleep(1400);
      await page.locator('button[aria-label="Close layers"]').first().click();
      await sleep(350);

      const savedTab = page.locator('.mobile-bar__item').filter({ hasText: /^Saved$/i }).first();
      const savedTabBox = await getNormBox(page, savedTab, 'savedTab');
      await savedTab.click();
      await sleep(600);
      const savedSheet = await snap(cdp, 'act4_saved.jpg');

      manifest.acts.act4 = {
        layersLight,
        layersDark,
        darkSeq,
        savedSheet,
        boxes: { darkBtn: darkBox, savedTab: savedTabBox },
      };
      saveManifest(manifest);
      await context.close();
      console.log(`  Act 4 done (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    }

    // ------------------------------------------------------------------
    // ACT 5: Full-Screen · RapidKL & UM Shuttle Transit (T815)
    // ------------------------------------------------------------------
    if (shouldRun('act5')) {
      console.log('Capturing Act 5: Transit Hub (T815)...');
      const { context, page, cdp } = await newContextPage(browser);
      await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded' });
      await waitMapReady(page, 2000);
      await hideHoverPopups(page);

      await page.locator('.mobile-bar__item').filter({ hasText: /^Transit$/i }).first().click();
      await sleep(650);

      const t815Card = page.locator('.transit-route-card').filter({ hasText: /T815/i }).first();
      const t815Box = await getNormBox(page, t815Card, 't815Card');
      const hub = await snap(cdp, 'act5_hub.jpg');

      await t815Card.click();
      await sleep(900);
      const hubSelected = await snap(cdp, 'act5_selected.jpg');

      await page.locator('button[aria-label="Close transit hub"]').first().click();
      await sleep(750);

      const orbitSeq = await captureGentleTurn(page, cdp, 'act5_orbit', 8, 30, 5, 90, 580, 90);

      manifest.acts.act5 = {
        hub,
        hubSelected,
        orbitSeq,
        boxes: { t815Card: t815Box },
      };
      saveManifest(manifest);
      await context.close();
      console.log(`  Act 5 done (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    }

    // ------------------------------------------------------------------
    // ACT 6: Cutaway + Diagram · Multi-Stop (LIB -> KPS -> DTC -> FK), Hills & Weather
    // ------------------------------------------------------------------
    if (shouldRun('act6')) {
      console.log('Capturing Act 6: Multi-Stop Directions, Hills & Weather...');
      const { context, page, cdp } = await newContextPage(browser);
      await page.goto(
        `${BASE_URL}/?from=faculty:LIB&stops=faculty:KPS,faculty:DTC&to=faculty:FK&mode=walk&name=UM+Campus+Tour`,
        { waitUntil: 'domcontentloaded' },
      );
      await waitMapReady(page, 2400);
      await hideHoverPopups(page);

      const bikeBtn = page.locator('.m3-segmented--modes button').filter({ hasText: /Bike/i }).first();
      const bikeBox = await getNormBox(page, bikeBtn, 'bikeBtn');
      const walk = await snap(cdp, 'act6_walk.jpg');

      await bikeBtn.click();
      await sleep(1000);

      const optBtn = page.locator('.directions button').filter({ hasText: /Optimize/i }).first();
      const optBox = await getNormBox(page, optBtn, 'optimizeBtn');
      const bike = await snap(cdp, 'act6_bike.jpg');

      if ((await optBtn.count()) > 0 && (await optBtn.isVisible())) {
        await optBtn.click();
        await sleep(1000);
      }
      const optimized = await snap(cdp, 'act6_optimized.jpg');

      await page.evaluate(() => {
        const el = document.querySelector('.directions__body');
        if (el) el.scrollTop = 340;
      });
      await sleep(450);
      const elevation = await snap(cdp, 'act6_elevation.jpg');

      const dirHandle = page.locator('.directions .sheet-handle').first();
      if ((await dirHandle.count()) > 0 && (await dirHandle.isVisible())) {
        await dirHandle.click();
        await sleep(700);
      }
      const routeMap = await snap(cdp, 'act6_route_map.jpg');

      // Close collapsed route bar so the live UM Campus Conditions pill (.conditions-bar) is exposed
      const closeRouteBtn = page.locator('.directions button[aria-label="Close directions"], .directions button[aria-label="Close"]').first();
      if ((await closeRouteBtn.count()) > 0 && (await closeRouteBtn.isVisible())) {
        await closeRouteBtn.click();
        await sleep(600);
      } else {
        await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded' });
        await waitMapReady(page, 1800);
      }

      const weatherPill = page.locator('.conditions-bar').first();
      const weatherBox = await getNormBox(page, weatherPill, 'weatherPill');
      const weatherPillImg = await snap(cdp, 'act6_weather_pill.jpg');

      if ((await weatherPill.count()) > 0 && (await weatherPill.isVisible())) {
        await weatherPill.click();
        await sleep(650);
      }
      const weatherOpen = await snap(cdp, 'act6_weather.jpg');

      manifest.acts.act6 = {
        walk,
        bike,
        optimized,
        elevation,
        routeMap,
        weatherPillImg,
        weatherOpen,
        boxes: { bikeBtn: bikeBox, optimizeBtn: optBox, weatherPill: weatherBox },
      };
      saveManifest(manifest);
      await context.close();
      console.log(`  Act 6 done (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    }

    // ------------------------------------------------------------------
    // ACT 7: Full-Screen · Live 3D Road Navigation (FK -> KPS, Bike 3x)
    // ------------------------------------------------------------------
    if (shouldRun('act7')) {
      console.log('Capturing Act 7: Live 3D Road Navigation into KPS...');
      const { context, page, cdp } = await newContextPage(browser, {
        latitude: 3.11785,
        longitude: 101.65535,
      });
      await page.goto(`${BASE_URL}/?from=faculty:FK&to=faculty:KPS&mode=bike`, {
        waitUntil: 'domcontentloaded',
      });
      await waitMapReady(page, 2400);
      await hideHoverPopups(page);

      const startBtn = page
        .locator('.route-summary__action-bar button:not([disabled])')
        .filter({ hasText: /Start/i })
        .first();
      if ((await startBtn.count()) > 0 && (await startBtn.isVisible())) {
        await startBtn.click();
      } else {
        const altStart = page.locator('.route-summary__action-bar button:not([disabled])').first();
        if ((await altStart.count()) > 0) await altStart.click();
      }
      await page.waitForSelector('.nav-hud', { timeout: 12000 });
      await sleep(1600);

      const simBtn = page.locator('.nav-hud button').filter({ hasText: /Simulate route/i }).first();
      const simBox = await getNormBox(page, simBtn, 'simBtn');
      const ready = await snap(cdp, 'act7_ready.jpg');

      await simBtn.click();
      await sleep(450);

      // CRITICAL: Click speed toggle ONCE (toggles 1x -> 3x only!)
      const speedBtn = page.locator('.nav-hud button[aria-label="Simulation speed 1x"]').first();
      const speedBox = await getNormBox(page, speedBtn, 'speedBtn');
      const sim1x = await snap(cdp, 'act7_sim1x.jpg');

      if ((await speedBtn.count()) > 0 && (await speedBtn.isVisible())) {
        await speedBtn.click();
      }
      await sleep(250);

      // Capture 18 crisp sequential chase-cam frames gliding smoothly along Campus Road into KPS
      const navSeq = [];
      for (let i = 0; i < 18; i++) {
        navSeq.push(await snap(cdp, `act7_nav_${String(i).padStart(3, '0')}.jpg`));
        await sleep(130);
      }

      manifest.acts.act7 = {
        ready,
        sim1x,
        navSeq,
        boxes: { simBtn: simBox, speedBtn: speedBox },
      };
      saveManifest(manifest);
      await context.close();
      console.log(`  Act 7 done (${navSeq.length} nav frames, ${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    }

    // ------------------------------------------------------------------
    // ACT 8 & ACT 9: Custom Route Studio (KPS & Lake Loop) + Share/Export PNG
    // ------------------------------------------------------------------
    if (shouldRun('act8') || shouldRun('act9')) {
      console.log('Capturing Act 8 (Custom Route) & Act 9 (Share & Export PNG)...');
      const { context, page, cdp } = await newContextPage(browser);
      await page.goto(
        `${BASE_URL}/?custom=3.120298,101.654054;3.120678,101.655742;3.121463,101.656450;3.123200,101.653700&mode=walk&snap=1&name=KPS+%26+Lake+Loop`,
        { waitUntil: 'domcontentloaded' },
      );
      await waitMapReady(page, 2400);
      await hideHoverPopups(page);

      const overviewBtn = page.locator('.draw-panel button').filter({ hasText: /Overview/i }).first();
      const overviewBox = await getNormBox(page, overviewBtn, 'overviewBtn');
      const drawPanel = await snap(cdp, 'act8_draw.jpg');

      await overviewBtn.click();
      await sleep(1200);

      if (shouldRun('act8')) {
        const orbitSeq = await captureGentleTurn(page, cdp, 'act8_orbit', 8, -30, 5, 90, 580, 90);
        manifest.acts.act8 = {
          drawPanel,
          orbitSeq,
          boxes: { overviewBtn: overviewBox },
        };
        saveManifest(manifest);
        console.log(`  Act 8 done (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
      }

      if (shouldRun('act9')) {
        const shareBtn = page.locator('.overview-bar button').filter({ hasText: /Share/i }).first();
        if ((await shareBtn.count()) > 0 && (await shareBtn.isVisible())) {
          await shareBtn.click();
        } else {
          await page.locator('.draw-panel button').filter({ hasText: /Share/i }).first().click();
        }
        await page.waitForSelector('.share-modal', { timeout: 10000 });
        await sleep(2200);

        const routeOnlyBtn = page.locator('.share-modal button').filter({ hasText: /Route only/i }).first();
        const routeOnlyBox = await getNormBox(page, routeOnlyBtn, 'routeOnlyBtn');
        const wholeMap = await snap(cdp, 'act9_whole.jpg');

        await routeOnlyBtn.click();
        await sleep(1600);

        const lightCardBtn = page.locator('.share-modal button').filter({ hasText: /Light card/i }).first();
        const lightCardBox = await getNormBox(page, lightCardBtn, 'lightCardBtn');
        const routeDark = await snap(cdp, 'act9_route_dark.jpg');

        if ((await lightCardBtn.count()) > 0 && (await lightCardBtn.isVisible())) {
          await lightCardBtn.click();
          await sleep(1600);
        }
        const routeLight = await snap(cdp, 'act9_route_light.jpg');

        manifest.acts.act9 = {
          wholeMap,
          routeDark,
          routeLight,
          boxes: { routeOnlyBtn: routeOnlyBox, lightCardBtn: lightCardBox },
        };
        saveManifest(manifest);
        console.log(`  Act 9 done (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
      }

      await context.close();
    }
  } finally {
    await browser.close();
  }

  saveManifest(manifest);
  console.log(`All captures complete in ${((Date.now() - t0) / 1000).toFixed(1)}s -> ${MANIFEST_PATH}`);
}

main().catch((err) => {
  console.error('Capture failed:', err);
  process.exit(1);
});
