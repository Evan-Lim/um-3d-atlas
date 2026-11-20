import fs from 'node:fs';
import path from 'node:path';

const PW_PATH = '/usr/local/share/bun-global/node_modules/playwright-core/index.mjs';
const CHROME_EXE =
  '/ms-playwright/chromium_headless_shell-1247/chrome-headless-shell-linux64/chrome-headless-shell';

const BASE_URL = process.env.PROMO_APP_URL || 'http://127.0.0.1:3000';
const OUT_DIR = path.resolve('promo-video/.tmp/captures');
const ONLY = process.env.PROMO_ONLY
  ? new Set(process.env.PROMO_ONLY.split(',').map((s) => s.trim()))
  : null;

const shouldRun = (key) => !ONLY || ONLY.has(key);

async function openReadyPage(ctx, urlPath, extraMs = 2600) {
  const page = await ctx.newPage();
  await page.goto(`${BASE_URL}${urlPath}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('.loading-screen', { state: 'detached', timeout: 25000 }).catch(() => {});
  await page.waitForTimeout(extraMs);
  return page;
}

async function snap(page, filename) {
  const fullPath = path.join(OUT_DIR, filename);
  await page.screenshot({ path: fullPath, animations: 'disabled', timeout: 45000 });
  const kb = Math.round(fs.statSync(fullPath).size / 1024);
  console.log(`  saved ${filename} (${kb} KB)`);
}

export async function captureAllScenes() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
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

  // 1080x1180 @ 1.5x -> crisp 1620x1770 captures while keeping SwiftShader GPU readback fast
  const ctx = await browser.newContext({
    viewport: { width: 1080, height: 1180 },
    deviceScaleFactor: 1.5,
    geolocation: { latitude: 3.12092, longitude: 101.65384 },
    permissions: ['geolocation'],
  });

  await ctx.addInitScript(() => {
    try {
      localStorage.setItem('um-atlas-theme-v1', 'light');
    } catch {
      // ignore
    }
  });

  // 1. Full 3D Campus Hero View
  if (shouldRun('1')) {
    console.log('1/9 Capturing 01_hero_3d...');
    const page = await openReadyPage(ctx, '/', 2800);
    await snap(page, '01_hero_3d.png');
    await page.close();
  }

  // 2. 3D Campus & Indoor Floor X-Ray (FSKTM Block A M16 with floor switcher & 3D rooms)
  if (shouldRun('2')) {
    console.log('2/9 Capturing 02_indoor_xray...');
    const page = await openReadyPage(ctx, '/?place=building:way/359487784', 2600);
    const levelBtn = page.locator('.floor-ctl__btn', { hasText: /L2|2/ }).first();
    if (await levelBtn.isVisible().catch(() => false)) {
      await levelBtn.click();
      await page.waitForTimeout(1400);
    }
    await snap(page, '02_indoor_xray.png');
    await page.close();
  }

  // 3 & 4. Multi-Stop Smart Routing + 4 Modes, then Elevation Profile & Live Weather Popover
  if (shouldRun('3') || shouldRun('4')) {
    const page = await openReadyPage(
      ctx,
      '/?from=faculty:LIB&stops=faculty:FK,faculty:DTC&to=faculty:FSKTM&mode=bike&name=Campus+Bike+Tour',
      3800,
    );
    if (shouldRun('3')) {
      console.log('3/9 Capturing 03_multistop_modes...');
      await snap(page, '03_multistop_modes.png');
    }
    if (shouldRun('4')) {
      console.log('4/9 Capturing 04_elevation_weather...');
      await page
        .locator('.directions__body')
        .evaluate((el) => {
          el.scrollTop = 210;
        })
        .catch(() => {});
      const condBtn = page.locator('.conditions-bar').first();
      if (await condBtn.isVisible().catch(() => false)) {
        await condBtn.click();
        await page.waitForTimeout(800);
      }
      await snap(page, '04_elevation_weather.png');
    }
    await page.close();
  }

  // 5. Live Turn-by-Turn Navigation (Use My Location -> Start -> GPS coords + Zone Badge + On-Road Turn Arrows)
  if (shouldRun('5')) {
    console.log('5/9 Capturing 05_live_nav...');
    const page = await openReadyPage(
      ctx,
      '/?from=faculty:LIB&to=faculty:FSKTM&mode=walk',
      2800,
    );
    const useMyLocBtn = page.locator('.route-start-gate-btn').first();
    if (await useMyLocBtn.isVisible().catch(() => false)) {
      await useMyLocBtn.click();
      await page.waitForTimeout(1800);
    }
    const startBtn = page.locator('.route-summary__action-bar button', { hasText: 'Start' }).first();
    if (await startBtn.isEnabled().catch(() => false)) {
      await startBtn.click();
      // Wait for camera follow easeTo to settle completely so screenshot is instant & crisp
      await page.waitForTimeout(2600);
    }
    await snap(page, '05_live_nav.png');
    await page.close();
  }

  // 6, 7, 8, 8b. Custom Drawn Route Studio -> Route Overview -> Share Modal (Whole Map + Route-Only)
  if (shouldRun('6') || shouldRun('7') || shouldRun('8') || shouldRun('9')) {
    const page = await openReadyPage(
      ctx,
      '/?custom=3.12092,101.65384;3.12285,101.65540;3.12610,101.65240;3.12820,101.65060&mode=walk&snap=1&name=Tasik+Varsiti+Loop',
      3000,
    );
    if (shouldRun('6')) {
      console.log('6/9 Capturing 06_custom_draw...');
      await snap(page, '06_custom_draw.png');
    }
    if (shouldRun('7') || shouldRun('8') || shouldRun('9')) {
      const ovBtn = page.locator('.draw-panel .route-summary__action-bar button', { hasText: 'Overview' }).first();
      if (await ovBtn.isVisible().catch(() => false)) {
        await ovBtn.click();
        await page.waitForTimeout(1800);
      }
      if (shouldRun('7')) {
        console.log('7/9 Capturing 07_overview_sim...');
        await snap(page, '07_overview_sim.png');
      }
    }
    if (shouldRun('8') || shouldRun('9')) {
      const shareBtn = page.locator('.overview-bar button', { hasText: 'Share / PNG' }).first();
      if (await shareBtn.isVisible().catch(() => false)) {
        await shareBtn.click();
        await page.waitForTimeout(1400);
      }
      if (shouldRun('8')) {
        console.log('8/9 Capturing 08_share_png...');
        await snap(page, '08_share_png.png');
      }
      if (shouldRun('9')) {
        console.log('9/9 Capturing 08b_share_route_only...');
        const routeOnlyBtn = page.locator('.share-modal button', { hasText: 'Route only' }).first();
        if (await routeOnlyBtn.isVisible().catch(() => false)) {
          await routeOnlyBtn.click();
          await page.waitForTimeout(900);
          const lightCardBtn = page.locator('.share-modal button', { hasText: 'Light card' }).first();
          if (await lightCardBtn.isVisible().catch(() => false)) {
            await lightCardBtn.click();
            await page.waitForTimeout(900);
          }
        }
        await snap(page, '08b_share_route_only.png');
      }
    }
    await page.close();
  }

  await browser.close();
  console.log('Scene capture complete:', OUT_DIR);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  captureAllScenes().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
