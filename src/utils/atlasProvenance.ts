// Provenance, environment classification, steganographic watermarking, and PNG metadata utilities.

export interface AtlasIdentity {
  readonly brand: string;
  readonly creator: string;
  readonly host: string;
  readonly canonicalUrl: string;
  readonly shortCode: string;
  readonly byline: string;
  readonly digest: string;
}

export interface RuntimeEnvironmentReport {
  readonly hostname: string;
  readonly isEmbedded: boolean;
  readonly isTrustedHost: boolean;
  readonly isTrustedParent: boolean;
  readonly isForeignHost: boolean;
  readonly isUnauthorizedEmbed: boolean;
  readonly shouldShowSourceBanner: boolean;
  readonly reason: 'official' | 'trusted-dev' | 'foreign-host' | 'unauthorized-embed';
}

export interface RuntimeEnvOverride {
  hostname?: string;
  href?: string;
  origin?: string;
  pathname?: string;
  isEmbedded?: boolean;
  referrer?: string;
  ancestorOrigins?: readonly string[];
}

export interface LsbEmbedRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Encoded identity tables (XOR-keyed per byte index so strings are not trivially greppable).
const T_A = [15, 44, 72, 92, 50, 93, 197, 255, 254, 248, 211] as const;
const T_B = [120, 50, 42, 60, 121, 44, 14, 3, 85, 52, 236, 228, 246, 184, 198, 199, 195] as const;
const T_C = [
  18, 3, 88, 79, 231, 167, 240, 236, 243, 199, 222, 154,
  213, 167, 189, 188, 190, 184, 156, 194, 146, 138, 113,
] as const;
const T_D = [
  36, 39, 46, 17, 27, 85, 89, 82, 241, 230, 191, 170, 196, 138, 207, 193,
  208, 162, 185, 255, 182, 186, 146, 129, 157, 157, 123, 39, 113, 103, 110, 10,
] as const;
const T_E = [124, 125, 4, 122, 4, 118, 22, 22, 41, 49] as const;

function decodeTable(bytes: readonly number[], seed: number): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 1) {
    out += String.fromCharCode(bytes[i] ^ ((seed + i * 7) & 0xff));
  }
  return out;
}

function fnv1a32(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function fnv1a16Bytes(bytes: Uint8Array): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i += 1) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193);
  }
  return ((h >>> 16) ^ (h & 0xffff)) & 0xffff;
}

let cachedIdentity: AtlasIdentity | null = null;

export function getAtlasIdentity(): AtlasIdentity {
  if (cachedIdentity) return cachedIdentity;
  const brand = decodeTable(T_A, 0x5a);
  const creator = decodeTable(T_B, 0x3d);
  const host = decodeTable(T_C, 0x67);
  const canonicalUrl = decodeTable(T_D, 0x4c);
  const shortCode = decodeTable(T_E, 0x29);
  const byline = `${brand} · ${creator}`;
  const digest = fnv1a32(`${shortCode}|${brand}|${creator}|${host}`);

  cachedIdentity = Object.freeze({
    brand,
    creator,
    host,
    canonicalUrl,
    shortCode,
    byline,
    digest,
  });
  return cachedIdentity;
}

const TRUSTED_DEV_EXACT_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
const TRUSTED_SUFFIXES = [
  '.run.app',
  '.aistudio.google.com',
  '.googleusercontent.com',
] as const;

export function isOfficialHost(hostname: string): boolean {
  const h = hostname.trim().toLowerCase();
  if (!h) return false;
  const official = getAtlasIdentity().host.toLowerCase();
  return h === official || h.endsWith(`.${official}`);
}

export function isTrustedDevHost(hostname: string): boolean {
  const h = hostname.trim().toLowerCase();
  if (!h) return false;
  if (TRUSTED_DEV_EXACT_HOSTS.has(h)) return true;
  if (h === 'aistudio.google.com') return true;
  return TRUSTED_SUFFIXES.some((suffix) => h.endsWith(suffix));
}

export function isTrustedHost(hostname: string): boolean {
  return isOfficialHost(hostname) || isTrustedDevHost(hostname);
}

function parseHostnameSafe(urlLike: string): string | null {
  if (!urlLike) return null;
  try {
    return new URL(urlLike).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function evaluateRuntimeEnvironment(
  override?: RuntimeEnvOverride,
): RuntimeEnvironmentReport {
  const hasWindow = typeof window !== 'undefined';
  const hostname = (
    override?.hostname ??
    (hasWindow ? window.location.hostname : '')
  ).toLowerCase();

  let isEmbedded = override?.isEmbedded ?? false;
  if (override?.isEmbedded === undefined && hasWindow) {
    try {
      isEmbedded = window.self !== window.top;
    } catch {
      isEmbedded = true;
    }
  }

  const hostTrusted = isTrustedHost(hostname);
  const hostOfficial = isOfficialHost(hostname);

  let isTrustedParent = true;
  if (isEmbedded) {
    const ancestorHosts: string[] = [];

    if (override?.ancestorOrigins) {
      for (const origin of override.ancestorOrigins) {
        const parsed = parseHostnameSafe(origin);
        if (parsed) ancestorHosts.push(parsed);
      }
    } else if (hasWindow && window.location.ancestorOrigins) {
      for (let i = 0; i < window.location.ancestorOrigins.length; i += 1) {
        const parsed = parseHostnameSafe(window.location.ancestorOrigins[i]);
        if (parsed) ancestorHosts.push(parsed);
      }
    }

    const referrer =
      override?.referrer ??
      (typeof document !== 'undefined' ? document.referrer : '');
    const referrerHost = parseHostnameSafe(referrer);
    if (referrerHost) ancestorHosts.push(referrerHost);

    if (ancestorHosts.length === 0) {
      // Cross-origin frame hiding both ancestorOrigins and referrer: treat as unauthorized wrapper
      // unless running on localhost/dev preview.
      isTrustedParent = isTrustedDevHost(hostname);
    } else {
      isTrustedParent = ancestorHosts.every((h) => isTrustedHost(h));
    }
  }

  const isForeignHost = Boolean(hostname) && !hostTrusted;
  const isUnauthorizedEmbed = isEmbedded && !isTrustedParent;
  const shouldShowSourceBanner = isForeignHost || isUnauthorizedEmbed;

  const reason: RuntimeEnvironmentReport['reason'] = isForeignHost
    ? 'foreign-host'
    : isUnauthorizedEmbed
      ? 'unauthorized-embed'
      : hostOfficial
        ? 'official'
        : 'trusted-dev';

  return Object.freeze({
    hostname,
    isEmbedded,
    isTrustedHost: hostTrusted,
    isTrustedParent,
    isForeignHost,
    isUnauthorizedEmbed,
    shouldShowSourceBanner,
    reason,
  });
}

export function resolveShareBaseUrl(override?: RuntimeEnvOverride): string {
  const id = getAtlasIdentity();
  const env = evaluateRuntimeEnvironment(override);
  if (env.shouldShowSourceBanner) {
    return id.canonicalUrl;
  }

  if (override?.origin !== undefined) {
    return `${override.origin}${override.pathname ?? '/'}`;
  }

  if (typeof window !== 'undefined' && window.location?.origin) {
    return `${window.location.origin}${window.location.pathname}`;
  }

  return id.canonicalUrl;
}

// --- Zero-width Unicode invisible watermark (2 bits per invisible character) ---
const ZW_ALPHABET = ['\u200B', '\u200C', '\u200D', '\uFEFF'] as const;
const ZW_START = '\u2060\u200B';
const ZW_END = '\u200B\u2060';

export function encodeZeroWidthWatermark(payload?: string): string {
  const id = getAtlasIdentity();
  const raw = payload ?? `${id.shortCode}|${id.creator}|${id.host}|${id.digest}`;
  const bytes = new TextEncoder().encode(raw);
  let out = ZW_START;
  for (let i = 0; i < bytes.length; i += 1) {
    const b = bytes[i];
    out += ZW_ALPHABET[(b >> 6) & 3];
    out += ZW_ALPHABET[(b >> 4) & 3];
    out += ZW_ALPHABET[(b >> 2) & 3];
    out += ZW_ALPHABET[b & 3];
  }
  out += ZW_END;
  return out;
}

export function decodeZeroWidthWatermark(text: string): string | null {
  const startIdx = text.indexOf(ZW_START);
  if (startIdx < 0) return null;
  const bodyStart = startIdx + ZW_START.length;
  const endIdx = text.indexOf(ZW_END, bodyStart);
  if (endIdx < 0) return null;
  const encoded = text.slice(bodyStart, endIdx);
  if (encoded.length === 0 || encoded.length % 4 !== 0) return null;

  const bytes = new Uint8Array(encoded.length / 4);
  for (let i = 0; i < bytes.length; i += 1) {
    const c0 = ZW_ALPHABET.indexOf(encoded[i * 4] as (typeof ZW_ALPHABET)[number]);
    const c1 = ZW_ALPHABET.indexOf(encoded[i * 4 + 1] as (typeof ZW_ALPHABET)[number]);
    const c2 = ZW_ALPHABET.indexOf(encoded[i * 4 + 2] as (typeof ZW_ALPHABET)[number]);
    const c3 = ZW_ALPHABET.indexOf(encoded[i * 4 + 3] as (typeof ZW_ALPHABET)[number]);
    if (c0 < 0 || c1 < 0 || c2 < 0 || c3 < 0) return null;
    bytes[i] = (c0 << 6) | (c1 << 4) | (c2 << 2) | c3;
  }
  return new TextDecoder().decode(bytes);
}

// --- LSB Pixel Steganography for PNG Route Card Exports ---
const LSB_MAGIC = [0x55, 0x33, 0x44, 0x41] as const; // "U3DA"

function buildLsbFrame(payload: string): Uint8Array {
  const payloadBytes = new TextEncoder().encode(payload);
  const len = Math.min(payloadBytes.length, 4096);
  const sliced = payloadBytes.subarray(0, len);
  const checksum = fnv1a16Bytes(sliced);
  const frame = new Uint8Array(4 + 2 + 2 + len);
  frame[0] = LSB_MAGIC[0];
  frame[1] = LSB_MAGIC[1];
  frame[2] = LSB_MAGIC[2];
  frame[3] = LSB_MAGIC[3];
  frame[4] = (len >> 8) & 0xff;
  frame[5] = len & 0xff;
  frame[6] = (checksum >> 8) & 0xff;
  frame[7] = checksum & 0xff;
  frame.set(sliced, 8);
  return frame;
}

export function embedImageDataLsbWatermark(
  imageData: { data: Uint8ClampedArray; width: number; height: number },
  payload?: string,
): boolean {
  const id = getAtlasIdentity();
  const text = payload ?? `${id.shortCode}|${id.creator}|${id.host}|${id.digest}`;
  const frame = buildLsbFrame(text);
  const totalBits = frame.length * 8;
  const data = imageData.data;

  // Count usable pixels (opaque/near-opaque pixels only so transparency is never corrupted).
  let bitIdx = 0;
  for (let p = 0; p < data.length && bitIdx < totalBits; p += 4) {
    if (data[p + 3] < 180) continue;
    for (let ch = 0; ch < 3 && bitIdx < totalBits; ch += 1) {
      const byteIdx = bitIdx >> 3;
      const bitPos = 7 - (bitIdx & 7);
      const bit = (frame[byteIdx] >> bitPos) & 1;
      data[p + ch] = (data[p + ch] & 0xfe) | bit;
      bitIdx += 1;
    }
  }
  return bitIdx === totalBits;
}

export function extractImageDataLsbWatermark(
  imageData: { data: Uint8ClampedArray; width: number; height: number },
): string | null {
  const data = imageData.data;
  const bits: number[] = [];

  // Read up to 8-byte header first (64 bits).
  let p = 0;
  const readBits = (count: number): boolean => {
    while (bits.length < count && p < data.length) {
      if (data[p + 3] >= 180) {
        for (let ch = 0; ch < 3; ch += 1) {
          bits.push(data[p + ch] & 1);
        }
      }
      p += 4;
    }
    return bits.length >= count;
  };

  const readByte = (byteIndex: number): number => {
    let val = 0;
    const base = byteIndex * 8;
    for (let b = 0; b < 8; b += 1) {
      val = (val << 1) | bits[base + b];
    }
    return val;
  };

  if (!readBits(64)) return null;
  if (
    readByte(0) !== LSB_MAGIC[0] ||
    readByte(1) !== LSB_MAGIC[1] ||
    readByte(2) !== LSB_MAGIC[2] ||
    readByte(3) !== LSB_MAGIC[3]
  ) {
    return null;
  }

  const len = (readByte(4) << 8) | readByte(5);
  const expectedCrc = (readByte(6) << 8) | readByte(7);
  if (len <= 0 || len > 4096) return null;

  if (!readBits((8 + len) * 8)) return null;
  const payloadBytes = new Uint8Array(len);
  for (let i = 0; i < len; i += 1) {
    payloadBytes[i] = readByte(8 + i);
  }
  if (fnv1a16Bytes(payloadBytes) !== expectedCrc) return null;
  return new TextDecoder().decode(payloadBytes);
}

export function embedCanvasLsbWatermark(
  ctx: CanvasRenderingContext2D,
  rect: LsbEmbedRect,
  payload?: string,
): boolean {
  try {
    const rx = Math.max(0, Math.floor(rect.x));
    const ry = Math.max(0, Math.floor(rect.y));
    const rw = Math.min(ctx.canvas.width - rx, Math.floor(rect.width));
    const rh = Math.min(ctx.canvas.height - ry, Math.floor(rect.height));
    if (rw <= 0 || rh <= 0) return false;
    const imgData = ctx.getImageData(rx, ry, rw, rh);
    const ok = embedImageDataLsbWatermark(imgData, payload);
    if (ok) {
      ctx.putImageData(imgData, rx, ry);
    }
    return ok;
  } catch {
    return false;
  }
}

// --- PNG Binary tEXt Chunk Injection & Extraction (IEEE 802.3 CRC32) ---
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10] as const;

let crcTable: Uint32Array | null = null;
function getCrc32Table(): Uint32Array {
  if (crcTable) return crcTable;
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  crcTable = table;
  return table;
}

export function crc32(bytes: Uint8Array): number {
  const table = getCrc32Table();
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    c = table[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function encodeLatin1(str: string): Uint8Array {
  const out = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i += 1) {
    const code = str.charCodeAt(i);
    out[i] = code <= 0xff ? code : 0x3f;
  }
  return out;
}

function buildPngTextChunk(keyword: string, value: string): Uint8Array {
  const keyBytes = encodeLatin1(keyword.slice(0, 79));
  const valBytes = encodeLatin1(value);
  const dataLen = keyBytes.length + 1 + valBytes.length;

  const chunk = new Uint8Array(4 + 4 + dataLen + 4);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, dataLen, false);

  // Chunk type: "tEXt"
  chunk[4] = 0x74;
  chunk[5] = 0x45;
  chunk[6] = 0x58;
  chunk[7] = 0x74;

  chunk.set(keyBytes, 8);
  chunk[8 + keyBytes.length] = 0; // null separator
  chunk.set(valBytes, 9 + keyBytes.length);

  const crc = crc32(chunk.subarray(4, 8 + dataLen));
  view.setUint32(8 + dataLen, crc, false);
  return chunk;
}

export function getDefaultPngProvenanceEntries(): Record<string, string> {
  const id = getAtlasIdentity();
  return {
    Author: id.creator,
    Software: id.brand,
    Source: id.canonicalUrl,
    Copyright: `${id.brand} by ${id.creator}`,
    Provenance: `${id.shortCode}:${id.digest}`,
  };
}

export function injectPngTextChunks(
  pngBytes: Uint8Array,
  entries: Record<string, string> = getDefaultPngProvenanceEntries(),
): Uint8Array {
  if (pngBytes.length < 24) return pngBytes;
  for (let i = 0; i < PNG_SIGNATURE.length; i += 1) {
    if (pngBytes[i] !== PNG_SIGNATURE[i]) return pngBytes;
  }

  // Locate IEND chunk so we insert metadata cleanly right before it.
  const view = new DataView(pngBytes.buffer, pngBytes.byteOffset, pngBytes.byteLength);
  let offset = 8;
  let iendOffset = -1;
  while (offset + 12 <= pngBytes.length) {
    const len = view.getUint32(offset, false);
    const type =
      String.fromCharCode(
        pngBytes[offset + 4],
        pngBytes[offset + 5],
        pngBytes[offset + 6],
        pngBytes[offset + 7],
      );
    if (type === 'IEND') {
      iendOffset = offset;
      break;
    }
    const next = offset + 12 + len;
    if (next <= offset || next > pngBytes.length) return pngBytes;
    offset = next;
  }

  if (iendOffset < 0) return pngBytes;

  const chunks = Object.entries(entries).map(([k, v]) => buildPngTextChunk(k, v));
  const injectedSize = chunks.reduce((acc, c) => acc + c.length, 0);
  const out = new Uint8Array(pngBytes.length + injectedSize);
  out.set(pngBytes.subarray(0, iendOffset), 0);
  let cursor = iendOffset;
  for (const chunk of chunks) {
    out.set(chunk, cursor);
    cursor += chunk.length;
  }
  out.set(pngBytes.subarray(iendOffset), cursor);
  return out;
}

export function extractPngTextChunks(pngBytes: Uint8Array): Record<string, string> {
  const result: Record<string, string> = {};
  if (pngBytes.length < 24) return result;
  for (let i = 0; i < PNG_SIGNATURE.length; i += 1) {
    if (pngBytes[i] !== PNG_SIGNATURE[i]) return result;
  }

  const view = new DataView(pngBytes.buffer, pngBytes.byteOffset, pngBytes.byteLength);
  let offset = 8;
  while (offset + 12 <= pngBytes.length) {
    const len = view.getUint32(offset, false);
    const next = offset + 12 + len;
    if (next > pngBytes.length) break;

    const type = String.fromCharCode(
      pngBytes[offset + 4],
      pngBytes[offset + 5],
      pngBytes[offset + 6],
      pngBytes[offset + 7],
    );

    if (type === 'tEXt' && len > 1) {
      const expectedCrc = view.getUint32(offset + 8 + len, false);
      const actualCrc = crc32(pngBytes.subarray(offset + 4, offset + 8 + len));
      if (expectedCrc === actualCrc) {
        const data = pngBytes.subarray(offset + 8, offset + 8 + len);
        const nullIdx = data.indexOf(0);
        if (nullIdx > 0) {
          const key = Array.from(data.subarray(0, nullIdx))
            .map((b) => String.fromCharCode(b))
            .join('');
          const val = Array.from(data.subarray(nullIdx + 1))
            .map((b) => String.fromCharCode(b))
            .join('');
          result[key] = val;
        }
      }
    }

    if (type === 'IEND') break;
    offset = next;
  }
  return result;
}

// --- Runtime Forensic Symbol, Verification Hook & Cartographic GeoJSON Provenance ---
const PROVENANCE_SYMBOL = Symbol.for('um3da.provenance.v1');
let runtimeInstalled = false;

export function attachCartographicProvenance<T extends object>(geojson: T): T {
  const id = getAtlasIdentity();
  try {
    if (!(PROVENANCE_SYMBOL in geojson)) {
      Object.defineProperty(geojson, PROVENANCE_SYMBOL, {
        value: Object.freeze({
          source: id.brand,
          author: id.creator,
          origin: id.canonicalUrl,
          sig: `${id.shortCode}:${id.digest}`,
        }),
        enumerable: false,
        configurable: false,
        writable: false,
      });
    }
  } catch {
    // Ignore frozen objects safely.
  }
  return geojson;
}

export function installRuntimeProvenance(): void {
  if (runtimeInstalled || typeof window === 'undefined') return;
  runtimeInstalled = true;

  const id = getAtlasIdentity();
  const env = evaluateRuntimeEnvironment();
  const record = Object.freeze({
    brand: id.brand,
    creator: id.creator,
    canonicalUrl: id.canonicalUrl,
    shortCode: id.shortCode,
    digest: id.digest,
    runtime: env.reason,
  });

  try {
    const win = window as unknown as Record<PropertyKey, unknown>;
    if (!(PROVENANCE_SYMBOL in win)) {
      Object.defineProperty(win, PROVENANCE_SYMBOL, {
        value: record,
        enumerable: false,
        configurable: false,
        writable: false,
      });
    }

    if (!('__um3daVerify' in win)) {
      Object.defineProperty(win, '__um3daVerify', {
        get: () => ({
          ...record,
          environment: evaluateRuntimeEnvironment(),
        }),
        enumerable: false,
        configurable: false,
      });
    }
  } catch {
    // Ignore read-only window environments.
  }

  // Single tasteful DevTools signature.
  try {
    console.info(
      `%c${id.brand}%c  by ${id.creator} · ${id.host} [${id.digest}]`,
      'background:#0B57D0;color:#ffffff;font-weight:700;padding:2px 7px;border-radius:4px;',
      'color:#5f6368;font-weight:500;',
    );
  } catch {
    // Ignore console restrictions.
  }
}
