import { computeBikeMetrics, computeWalkMetrics } from './atlasUtils';
import type {
  ComputedRoute,
  RouteElevationProfile,
  RouteExportStyle,
  RouteOnlyBg,
  RouteWaypoint,
} from '../types/map';

export interface RoutePngRenderOptions {
  route: ComputedRoute;
  elevationProfile: RouteElevationProfile | null;
  routeName: string;
  exportStyle: RouteExportStyle;
  routeOnlyBg: RouteOnlyBg;
  darkMode: boolean;
  mapCanvas?: HTMLCanvasElement | null;
  waypoints?: RouteWaypoint[];
}

function formatDist(meters: number): string {
  if (meters >= 1000) return `${(meters / 1000).toFixed(2)} km`;
  return `${Math.round(meters)} m`;
}

function modeTitle(mode: ComputedRoute['mode']): string {
  if (mode === 'bike') return 'Cycling';
  if (mode === 'bus') return 'Transit & Walk';
  if (mode === 'drive') return 'Driving';
  return 'Walking';
}

function segmentColor(kind: ComputedRoute['segments'][number]['kind'], customColor?: string): string {
  if (kind === 'bus') return customColor || '#1a73e8';
  if (kind === 'shortcut') return '#137333';
  if (kind === 'steps') return '#d97706';
  return '#1a73e8';
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function drawPin(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  label: string,
  bg: string,
  fg: string,
  ring: string,
  radius = 15,
) {
  ctx.save();
  ctx.shadowColor = 'rgba(15, 23, 42, 0.35)';
  ctx.shadowBlur = 10;
  ctx.shadowOffsetY = 3;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fillStyle = bg;
  ctx.fill();
  ctx.restore();

  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.lineWidth = 3;
  ctx.strokeStyle = ring;
  ctx.stroke();

  ctx.fillStyle = fg;
  ctx.font = `600 ${Math.round(radius * 0.92)}px Inter, -apple-system, BlinkMacSystemFont, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x, y + 0.5);
}

function drawMiniElevationSparkline(
  ctx: CanvasRenderingContext2D,
  profile: RouteElevationProfile,
  x: number,
  y: number,
  w: number,
  h: number,
  strokeColor: string,
  fillTop: string,
  fillBottom: string,
) {
  const samples = profile.samples;
  if (samples.length < 2) return;
  const maxD = Math.max(1, profile.totalDistanceM);
  const minE = profile.minElevationM - 2;
  const spanE = Math.max(8, profile.maxElevationM + 2 - minE);

  const pts = samples.map((s) => ({
    px: x + (s.distanceM / maxD) * w,
    py: y + h - ((s.elevationM - minE) / spanE) * h,
  }));

  const grad = ctx.createLinearGradient(0, y, 0, y + h);
  grad.addColorStop(0, fillTop);
  grad.addColorStop(1, fillBottom);

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(pts[0].px, y + h);
  for (const p of pts) ctx.lineTo(p.px, p.py);
  ctx.lineTo(pts[pts.length - 1].px, y + h);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(pts[0].px, pts[0].py);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].px, pts[i].py);
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = 2.6;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke();
  ctx.restore();
}

/**
 * Renders a high-resolution (1200x920) route export PNG onto `canvas`.
 * Supports:
 *  - `whole-map`: Captures the live MapLibre WebGL 3D campus map + crisp route summary overlay.
 *  - `route-only`: Renders ONLY the clean route silhouette + markers + stats strip
 *                  on either a true alpha-transparent canvas or a themed Light/Dark card.
 */
export function renderRouteCardToCanvas(
  canvas: HTMLCanvasElement,
  opts: RoutePngRenderOptions,
): void {
  const W = 1200;
  const H = 920;
  if (canvas.width !== W || canvas.height !== H) {
    canvas.width = W;
    canvas.height = H;
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.clearRect(0, 0, W, H);

  const {
    route,
    elevationProfile,
    routeName,
    exportStyle,
    routeOnlyBg,
    darkMode,
    mapCanvas,
    waypoints = route.waypoints ?? [],
  } = opts;

  const isDarkPalette =
    exportStyle === 'whole-map'
      ? darkMode
      : routeOnlyBg === 'dark' || (routeOnlyBg === 'transparent' && darkMode);
  const isTransparent = exportStyle === 'route-only' && routeOnlyBg === 'transparent';

  const titleText =
    routeName.trim() || `${route.originLabel || 'Start'} → ${route.destLabel || 'Destination'}`;

  const walkMetrics = computeWalkMetrics(route);
  const bikeMetrics = computeBikeMetrics(route);
  const stepsCountEst = walkMetrics.stepsEstimate;
  const activeKcal = route.mode === 'bike' ? bikeMetrics.kcalEstimate : walkMetrics.kcalEstimate;
  const maneuverCount = Math.max(
    1,
    route.steps.filter((s) => s.kind !== 'indoor' || !s.instruction.startsWith('Arrive at')).length,
  );

  const footerH = 216;
  const visualH = H - footerH;

  if (exportStyle === 'whole-map') {
    // Base backdrop matching theme
    ctx.fillStyle = isDarkPalette ? '#1b2029' : '#f1f3f4';
    ctx.fillRect(0, 0, W, H);

    // Draw live WebGL map snapshot cropped cleanly (cover fit) into the full canvas
    let capturedMap = false;
    if (mapCanvas && mapCanvas.width > 0 && mapCanvas.height > 0) {
      try {
        const srcAspect = mapCanvas.width / mapCanvas.height;
        const dstAspect = W / H;
        let sx = 0;
        let sy = 0;
        let sw = mapCanvas.width;
        let sh = mapCanvas.height;
        if (srcAspect > dstAspect) {
          sw = mapCanvas.height * dstAspect;
          sx = (mapCanvas.width - sw) / 2;
        } else {
          sh = mapCanvas.width / dstAspect;
          sy = (mapCanvas.height - sh) / 2;
        }
        ctx.drawImage(mapCanvas, sx, sy, sw, sh, 0, 0, W, H);
        capturedMap = true;
      } catch {
        capturedMap = false;
      }
    }

    if (!capturedMap) {
      // Graceful fallback vector projection if WebGL buffer unavailable
      drawNormalizedRouteSilhouette(ctx, route, waypoints, 80, 64, W - 160, visualH - 110, isDarkPalette, false);
    }

    // Subtle bottom contrast gradient scrim over map
    const scrim = ctx.createLinearGradient(0, visualH - 90, 0, H);
    scrim.addColorStop(0, 'rgba(15, 23, 42, 0)');
    scrim.addColorStop(0.35, isDarkPalette ? 'rgba(17, 21, 28, 0.72)' : 'rgba(15, 23, 42, 0.22)');
    scrim.addColorStop(1, isDarkPalette ? 'rgba(17, 21, 28, 0.92)' : 'rgba(15, 23, 42, 0.42)');
    ctx.fillStyle = scrim;
    ctx.fillRect(0, visualH - 90, W, footerH + 90);
  } else {
    // Route-only mode: Transparent OR Solid Light/Dark Card
    if (!isTransparent) {
      ctx.fillStyle = routeOnlyBg === 'dark' ? '#161b22' : '#ffffff';
      drawRoundedRect(ctx, 0, 0, W, H, 32);
      ctx.fill();

      // Subtle hairline frame border
      ctx.strokeStyle = routeOnlyBg === 'dark' ? 'rgba(255,255,255,0.09)' : 'rgba(15,23,42,0.08)';
      ctx.lineWidth = 2;
      drawRoundedRect(ctx, 1, 1, W - 2, H - 2, 31);
      ctx.stroke();
    }

    // Pure route geometry centered with generous breathing room
    drawNormalizedRouteSilhouette(
      ctx,
      route,
      waypoints,
      84,
      64,
      W - 168,
      visualH - 94,
      isDarkPalette,
      isTransparent,
    );
  }

  // Stats Footer Card
  const padX = 36;
  const cardY = H - footerH + 14;
  const cardW = W - padX * 2;
  const cardH = footerH - 42;

  ctx.save();
  if (isTransparent) {
    // Crisp high-legibility translucent dark slate badge so stats read cleanly over any photo/story
    drawRoundedRect(ctx, padX, cardY, cardW, cardH, 24);
    ctx.fillStyle = 'rgba(18, 22, 30, 0.84)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  } else {
    ctx.shadowColor = isDarkPalette ? 'rgba(0,0,0,0.42)' : 'rgba(15,23,42,0.14)';
    ctx.shadowBlur = 24;
    ctx.shadowOffsetY = 8;
    drawRoundedRect(ctx, padX, cardY, cardW, cardH, 24);
    ctx.fillStyle = isDarkPalette ? 'rgba(28, 33, 42, 0.95)' : 'rgba(255, 255, 255, 0.96)';
    ctx.fill();
    ctx.restore();
    ctx.save();
    drawRoundedRect(ctx, padX, cardY, cardW, cardH, 24);
    ctx.strokeStyle = isDarkPalette ? 'rgba(255,255,255,0.1)' : 'rgba(15,23,42,0.09)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
  ctx.restore();

  const textPrimary = isTransparent || isDarkPalette ? '#f8fafc' : '#181c22';
  const textMuted = isTransparent || isDarkPalette ? '#a5b0c2' : '#5f6368';
  const accentColor = isTransparent || isDarkPalette ? '#8ab4f8' : '#1a73e8';

  // Header row inside footer card: Route Title + Mode & Brand
  const innerX = padX + 28;
  const innerRight = padX + cardW - 28;
  const titleY = cardY + 38;

  ctx.fillStyle = textPrimary;
  ctx.font = '600 26px Inter, -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';

  const maxTitleW = cardW - 290;
  let clippedTitle = titleText;
  while (clippedTitle.length > 4 && ctx.measureText(clippedTitle).width > maxTitleW) {
    clippedTitle = `${clippedTitle.slice(0, -2)}…`;
  }
  ctx.fillText(clippedTitle, innerX, titleY);

  // Mode + UM 3D Atlas right-aligned subtitle
  ctx.fillStyle = textMuted;
  ctx.font = '500 15px Inter, -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.textAlign = 'right';
  const stopsLabel = waypoints.length > 0 ? ` · ${waypoints.length} stop${waypoints.length > 1 ? 's' : ''}` : '';
  ctx.fillText(`${modeTitle(route.mode)}${stopsLabel}  ·  UM 3D Atlas`, innerRight, titleY);

  // Subtle horizontal divider
  ctx.beginPath();
  ctx.moveTo(innerX, cardY + 64);
  ctx.lineTo(innerRight, cardY + 64);
  ctx.strokeStyle = isTransparent || isDarkPalette ? 'rgba(255,255,255,0.1)' : 'rgba(15,23,42,0.08)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Metrics row: Distance | Est. Time | Elevation | Steps / Burn | Turns + Mini Elevation Profile
  const hasSparkline = Boolean(elevationProfile && elevationProfile.samples.length >= 2);
  const sparkW = hasSparkline ? 200 : 0;
  const metricsW = innerRight - innerX - (hasSparkline ? sparkW + 28 : 0);

  const metrics: { label: string; value: string; accent?: boolean }[] = [
    { label: 'DISTANCE', value: formatDist(route.totalDistanceM), accent: true },
    { label: 'EST. TIME', value: `${Math.max(1, Math.round(route.estimatedMinutes))} min` },
    {
      label: 'ELEVATION',
      value: elevationProfile
        ? `+${elevationProfile.totalGainM}m / −${elevationProfile.totalDropM}m`
        : '—',
    },
    {
      label: route.mode === 'walk' || route.mode === 'bus' ? 'EST. STEPS' : 'ACTIVE BURN',
      value:
        route.mode === 'walk' || route.mode === 'bus'
          ? `~${stepsCountEst.toLocaleString()}`
          : `${activeKcal} kcal`,
    },
    {
      label: 'TURNS / STEPS',
      value: `${maneuverCount} leg${maneuverCount > 1 ? 's' : ''}`,
    },
  ];

  const colW = metricsW / metrics.length;
  const valY = cardY + 106;
  const lblY = cardY + 138;

  for (let i = 0; i < metrics.length; i++) {
    const m = metrics[i];
    const cx = innerX + i * colW;
    ctx.textAlign = 'left';
    ctx.fillStyle = m.accent ? accentColor : textPrimary;
    ctx.font = '600 22px "Roboto Mono", ui-monospace, SFMono-Regular, monospace';
    ctx.fillText(m.value, cx, valY);

    ctx.fillStyle = textMuted;
    ctx.font = '500 11.5px Inter, -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.fillText(m.label, cx, lblY);
  }

  // Mini elevation profile on right side of footer card
  if (hasSparkline && elevationProfile) {
    const sx = innerRight - sparkW;
    const sy = cardY + 80;
    const sh = 54;
    drawMiniElevationSparkline(
      ctx,
      elevationProfile,
      sx,
      sy,
      sparkW,
      sh,
      accentColor,
      isTransparent || isDarkPalette ? 'rgba(138, 180, 248, 0.32)' : 'rgba(26, 115, 232, 0.24)',
      'rgba(26, 115, 232, 0.0)',
    );
    ctx.textAlign = 'right';
    ctx.fillStyle = textMuted;
    ctx.font = '500 11px "Roboto Mono", ui-monospace, monospace';
    ctx.fillText(
      `${Math.round(elevationProfile.minElevationM)}m – ${Math.round(elevationProfile.maxElevationM)}m ASL`,
      innerRight,
      lblY,
    );
  }
}

function drawNormalizedRouteSilhouette(
  ctx: CanvasRenderingContext2D,
  route: ComputedRoute,
  waypoints: RouteWaypoint[],
  boxX: number,
  boxY: number,
  boxW: number,
  boxH: number,
  darkMode: boolean,
  isTransparent: boolean,
) {
  const coords = route.coordinates;
  if (coords.length < 2) return;

  // Cosine-corrected local equirectangular projection so campus proportions are geometrically true
  let sumLat = 0;
  for (const [, lat] of coords) sumLat += lat;
  const cosLat = Math.cos(((sumLat / coords.length) * Math.PI) / 180);

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [lng, lat] of coords) {
    const px = lng * cosLat;
    const py = lat;
    if (px < minX) minX = px;
    if (px > maxX) maxX = px;
    if (py < minY) minY = py;
    if (py > maxY) maxY = py;
  }

  const spanX = Math.max(1e-5, maxX - minX);
  const spanY = Math.max(1e-5, maxY - minY);
  const scale = Math.min(boxW / spanX, boxH / spanY);
  const drawW = spanX * scale;
  const drawH = spanY * scale;
  const offsetX = boxX + (boxW - drawW) / 2;
  const offsetY = boxY + (boxH - drawH) / 2;

  const project = ([lng, lat]: [number, number]): [number, number] => [
    offsetX + (lng * cosLat - minX) * scale,
    offsetY + drawH - (lat - minY) * scale,
  ];

  // Outer soft glow + white casing so route pops cleanly on transparent or solid cards
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Soft outer halo
  ctx.beginPath();
  const firstPt = project(coords[0]);
  ctx.moveTo(firstPt[0], firstPt[1]);
  for (let i = 1; i < coords.length; i++) {
    const pt = project(coords[i]);
    ctx.lineTo(pt[0], pt[1]);
  }
  ctx.strokeStyle = isTransparent
    ? 'rgba(26, 115, 232, 0.34)'
    : darkMode
      ? 'rgba(138, 180, 248, 0.25)'
      : 'rgba(26, 115, 232, 0.2)';
  ctx.lineWidth = 24;
  ctx.stroke();

  // Crisp white/dark outer casing
  ctx.strokeStyle = isTransparent ? '#ffffff' : darkMode ? '#0f131a' : '#ffffff';
  ctx.lineWidth = 15;
  ctx.stroke();

  // Colored segments matching route kind (walk/road/shortcut/steps/bus)
  for (const seg of route.segments) {
    if (seg.coordinates.length < 2) continue;
    ctx.beginPath();
    const s0 = project(seg.coordinates[0]);
    ctx.moveTo(s0[0], s0[1]);
    for (let i = 1; i < seg.coordinates.length; i++) {
      const sp = project(seg.coordinates[i]);
      ctx.lineTo(sp[0], sp[1]);
    }
    ctx.strokeStyle = segmentColor(seg.kind, seg.color);
    ctx.lineWidth = 9;
    ctx.stroke();
  }

  // Subtle directional flow chevrons spaced along the projected route
  let accumPx = 0;
  const spacingPx = 88;
  for (let i = 1; i < coords.length; i++) {
    const a = project(coords[i - 1]);
    const b = project(coords[i]);
    const segPx = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (segPx < 1) continue;
    accumPx += segPx;
    if (accumPx >= spacingPx) {
      accumPx = 0;
      const mx = (a[0] + b[0]) / 2;
      const my = (a[1] + b[1]) / 2;
      const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
      ctx.save();
      ctx.translate(mx, my);
      ctx.rotate(ang);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.92)';
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(-4, -4.2);
      ctx.lineTo(3.2, 0);
      ctx.lineTo(-4, 4.2);
      ctx.stroke();
      ctx.restore();
    }
  }
  ctx.restore();

  // Start (A), Intermediate Stops (1..N), Destination (B) pins
  const startPt = project(coords[0]);
  const endPt = project(coords[coords.length - 1]);
  for (const wp of waypoints) {
    const wpPt = project(wp.coord);
    drawPin(ctx, wpPt[0], wpPt[1], String(wp.index), '#ffffff', '#1a73e8', '#1a73e8', 14);
  }
  drawPin(ctx, startPt[0], startPt[1], 'A', '#1a73e8', '#ffffff', '#ffffff', 17);
  drawPin(ctx, endPt[0], endPt[1], 'B', '#d93025', '#ffffff', '#ffffff', 17);
}

/**
 * Copies the rendered PNG canvas directly to the system clipboard.
 */
export async function copyCanvasPng(canvas: HTMLCanvasElement): Promise<boolean> {
  if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) {
    return false;
  }
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) return false;
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
  return true;
}

/**
 * Downloads the rendered PNG canvas as a `.png` file.
 */
export async function downloadCanvasPng(
  canvas: HTMLCanvasElement,
  filename: string,
): Promise<boolean> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) return false;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
  return true;
}
