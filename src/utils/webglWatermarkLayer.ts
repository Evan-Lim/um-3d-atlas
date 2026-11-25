import type { CustomLayerInterface, Map as MapLibreMap } from 'maplibre-gl';
import { getAtlasIdentity } from './atlasProvenance';

export interface WebglWatermarkHandle {
  readonly layer: CustomLayerInterface;
  setDarkMode: (dark: boolean) => void;
}

const VERT_SRC = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = vec2((a_pos.x + 1.0) * 0.5, (1.0 - a_pos.y) * 0.5);
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

const FRAG_SRC = `
precision mediump float;
uniform sampler2D u_tex;
varying vec2 v_uv;
void main() {
  gl_FragColor = texture2D(u_tex, v_uv);
}
`;

function compileShader(
  gl: WebGLRenderingContext,
  type: number,
  source: string,
): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function paintWatermarkCanvas(
  canvas: HTMLCanvasElement,
  cssWidth: number,
  cssHeight: number,
  dpr: number,
  darkMode: boolean,
): void {
  const id = getAtlasIdentity();
  const pxW = Math.max(1, Math.round(cssWidth * dpr));
  const pxH = Math.max(1, Math.round(cssHeight * dpr));
  if (canvas.width !== pxW || canvas.height !== pxH) {
    canvas.width = pxW;
    canvas.height = pxH;
  }

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssWidth, cssHeight);

  // 1. Ultra-subtle staggered cartographic micro-grid baked directly into the WebGL framebuffer.
  // Virtually invisible during normal viewing, undeniable under screenshot inspection or cropping.
  const tileX = 320;
  const tileY = 230;
  const gridLabel = `${id.brand} · ${id.creator}`;
  ctx.save();
  ctx.font = '500 10.5px "Inter", "Roboto", system-ui, -apple-system, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = darkMode ? 'rgba(218, 226, 240, 0.045)' : 'rgba(28, 36, 52, 0.042)';

  for (let row = -1; row * tileY < cssHeight + tileY; row += 1) {
    const offsetX = row % 2 === 0 ? 0 : tileX * 0.5;
    for (let col = -1; col * tileX < cssWidth + tileX; col += 1) {
      const cx = col * tileX + offsetX + 90;
      const cy = row * tileY + 80;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(-0.21); // gentle -12 deg cartographic angle
      ctx.fillText(gridLabel, 0, 0);
      ctx.restore();
    }
  }
  ctx.restore();

  // 2. Crisp cartographic micro-signature baked into the map pixels (unboxed, whisper-clean).
  // Positioned clear of mobile bottom navigation and desktop right-hand FAB rail.
  const isMobile = cssWidth < 768;
  const stampText = `${id.brand}  ·  ${id.creator}`;
  const subText = id.host;

  ctx.save();
  ctx.font = '600 10.5px "Inter", "Roboto", system-ui, -apple-system, sans-serif';
  ctx.textBaseline = 'bottom';

  const padX = isMobile ? 12 : 16;
  const baseY = isMobile ? cssHeight - 102 : cssHeight - 14;
  ctx.textAlign = 'right';
  const anchorX = isMobile ? cssWidth - padX : cssWidth - 76;

  // Soft legibility halo matching map theme
  ctx.lineJoin = 'round';
  ctx.lineWidth = 3;
  ctx.strokeStyle = darkMode ? 'rgba(15, 19, 25, 0.62)' : 'rgba(248, 250, 253, 0.78)';
  ctx.fillStyle = darkMode ? 'rgba(212, 222, 238, 0.44)' : 'rgba(34, 44, 62, 0.40)';

  ctx.strokeText(stampText, anchorX, baseY);
  ctx.fillText(stampText, anchorX, baseY);

  ctx.font = '500 9px "Inter", "Roboto", system-ui, -apple-system, sans-serif';
  ctx.fillStyle = darkMode ? 'rgba(184, 196, 214, 0.34)' : 'rgba(54, 66, 86, 0.32)';
  ctx.strokeText(subText, anchorX, baseY - 13);
  ctx.fillText(subText, anchorX, baseY - 13);
  ctx.restore();

  ctx.restore();
}

export function createWebglWatermarkLayer(initialDarkMode: boolean): WebglWatermarkHandle {
  let darkMode = initialDarkMode;
  let mapRef: MapLibreMap | null = null;
  let glRef: WebGLRenderingContext | null = null;
  let program: WebGLProgram | null = null;
  let buffer: WebGLBuffer | null = null;
  let texture: WebGLTexture | null = null;
  let posLoc = -1;
  let texLoc: WebGLUniformLocation | null = null;

  const overlayCanvas = document.createElement('canvas');
  let lastCssW = 0;
  let lastCssH = 0;
  let lastDpr = 0;
  let lastDark = !initialDarkMode;
  let textureDirty = true;

  const syncTexture = (gl: WebGLRenderingContext) => {
    if (!texture || !mapRef) return;
    const mapCanvas = mapRef.getCanvas();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cssW = Math.max(1, Math.round(mapCanvas.clientWidth || mapCanvas.width / dpr));
    const cssH = Math.max(1, Math.round(mapCanvas.clientHeight || mapCanvas.height / dpr));

    if (
      !textureDirty &&
      cssW === lastCssW &&
      cssH === lastCssH &&
      dpr === lastDpr &&
      darkMode === lastDark
    ) {
      return;
    }

    paintWatermarkCanvas(overlayCanvas, cssW, cssH, dpr, darkMode);
    lastCssW = cssW;
    lastCssH = cssH;
    lastDpr = dpr;
    lastDark = darkMode;
    textureDirty = false;

    const prevActive = gl.getParameter(gl.ACTIVE_TEXTURE);
    const prevTex = gl.getParameter(gl.TEXTURE_BINDING_2D);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, overlayCanvas);

    gl.bindTexture(gl.TEXTURE_2D, prevTex);
    gl.activeTexture(prevActive);
  };

  const layer: CustomLayerInterface = {
    id: 'um-atlas-gl-imprint',
    type: 'custom',
    renderingMode: '2d',

    onAdd(map: MapLibreMap, gl: WebGLRenderingContext) {
      mapRef = map;
      glRef = gl;

      const vs = compileShader(gl, gl.VERTEX_SHADER, VERT_SRC);
      const fs = compileShader(gl, gl.FRAGMENT_SHADER, FRAG_SRC);
      if (!vs || !fs) return;

      const prog = gl.createProgram();
      if (!prog) return;
      gl.attachShader(prog, vs);
      gl.attachShader(prog, fs);
      gl.linkProgram(prog);
      gl.deleteShader(vs);
      gl.deleteShader(fs);

      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        gl.deleteProgram(prog);
        return;
      }

      program = prog;
      posLoc = gl.getAttribLocation(program, 'a_pos');
      texLoc = gl.getUniformLocation(program, 'u_tex');

      buffer = gl.createBuffer();
      const prevArrayBuf = gl.getParameter(gl.ARRAY_BUFFER_BINDING);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
        gl.STATIC_DRAW,
      );
      gl.bindBuffer(gl.ARRAY_BUFFER, prevArrayBuf);

      texture = gl.createTexture();
      textureDirty = true;
      syncTexture(gl);
    },

    render(gl: WebGLRenderingContext) {
      if (!program || !buffer || !texture || posLoc < 0) return;
      syncTexture(gl);

      // Snapshot WebGL state so MapLibre's 3D buildings, lines, and symbols stay completely untouched.
      const prevProgram = gl.getParameter(gl.CURRENT_PROGRAM);
      const prevActiveTex = gl.getParameter(gl.ACTIVE_TEXTURE);
      const prevTex2d = gl.getParameter(gl.TEXTURE_BINDING_2D);
      const prevArrayBuf = gl.getParameter(gl.ARRAY_BUFFER_BINDING);
      const prevBlend = gl.isEnabled(gl.BLEND);
      const prevDepth = gl.isEnabled(gl.DEPTH_TEST);
      const prevCull = gl.isEnabled(gl.CULL_FACE);
      const prevScissor = gl.isEnabled(gl.SCISSOR_TEST);
      const prevSrcRgb = gl.getParameter(gl.BLEND_SRC_RGB);
      const prevDstRgb = gl.getParameter(gl.BLEND_DST_RGB);
      const prevSrcAlpha = gl.getParameter(gl.BLEND_SRC_ALPHA);
      const prevDstAlpha = gl.getParameter(gl.BLEND_DST_ALPHA);

      gl.useProgram(program);
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.CULL_FACE);
      gl.disable(gl.SCISSOR_TEST);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      if (texLoc) gl.uniform1i(texLoc, 0);

      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.enableVertexAttribArray(posLoc);
      gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      // Restore every modified WebGL state cleanly.
      gl.bindBuffer(gl.ARRAY_BUFFER, prevArrayBuf);
      gl.bindTexture(gl.TEXTURE_2D, prevTex2d);
      gl.activeTexture(prevActiveTex);
      gl.blendFuncSeparate(prevSrcRgb, prevDstRgb, prevSrcAlpha, prevDstAlpha);
      if (!prevBlend) gl.disable(gl.BLEND);
      if (prevDepth) gl.enable(gl.DEPTH_TEST);
      if (prevCull) gl.enable(gl.CULL_FACE);
      if (prevScissor) gl.enable(gl.SCISSOR_TEST);
      gl.useProgram(prevProgram);
    },

    onRemove(_map: MapLibreMap, gl: WebGLRenderingContext) {
      if (texture) gl.deleteTexture(texture);
      if (buffer) gl.deleteBuffer(buffer);
      if (program) gl.deleteProgram(program);
      texture = null;
      buffer = null;
      program = null;
      glRef = null;
      mapRef = null;
    },
  };

  return {
    layer,
    setDarkMode(dark: boolean) {
      if (darkMode === dark) return;
      darkMode = dark;
      textureDirty = true;
      if (glRef) {
        syncTexture(glRef);
      }
      mapRef?.triggerRepaint();
    },
  };
}
