import assert from 'node:assert/strict';
import {
  decodeZeroWidthWatermark,
  embedImageDataLsbWatermark,
  encodeZeroWidthWatermark,
  evaluateRuntimeEnvironment,
  extractImageDataLsbWatermark,
  extractPngTextChunks,
  getAtlasIdentity,
  injectPngTextChunks,
  resolveShareBaseUrl,
} from './atlasProvenance.ts';

function runTest(name: string, fn: () => void): void {
  fn();
  console.log(`PASS: ${name}`);
}

// Minimal valid 1x1 PNG buffer (signature + IHDR + IDAT + IEND) for tEXt chunk round-trip tests.
const MINIMAL_PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41,
  0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00,
  0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
]);

runTest('decodes obfuscated identity tables accurately', () => {
  const id = getAtlasIdentity();
  assert.equal(id.brand, 'UM 3D Atlas');
  assert.equal(id.creator, 'Evan Lim Hong Yan');
  assert.equal(id.host, 'um-3d-atlas.netlify.app');
  assert.equal(id.canonicalUrl, 'https://um-3d-atlas.netlify.app/');
  assert.equal(id.shortCode, 'UM3DA:ELHY');
  assert.equal(id.byline, 'UM 3D Atlas · Evan Lim Hong Yan');
  assert.match(id.digest, /^[0-9a-f]{8}$/);
});

runTest('classifies official, localhost, preview, foreign hosts, and unauthorized iframes', () => {
  const official = evaluateRuntimeEnvironment({
    hostname: 'um-3d-atlas.netlify.app',
    isEmbedded: false,
  });
  assert.equal(official.shouldShowSourceBanner, false);
  assert.equal(official.reason, 'official');

  const local = evaluateRuntimeEnvironment({
    hostname: 'localhost',
    isEmbedded: false,
  });
  assert.equal(local.shouldShowSourceBanner, false);
  assert.equal(local.reason, 'trusted-dev');

  const preview = evaluateRuntimeEnvironment({
    hostname: 'ais-dev-abc123.asia-southeast1.run.app',
    isEmbedded: true,
    ancestorOrigins: ['https://aistudio.google.com'],
  });
  assert.equal(preview.shouldShowSourceBanner, false);
  assert.equal(preview.reason, 'trusted-dev');

  const foreign = evaluateRuntimeEnvironment({
    hostname: 'copycat-campus-wrapper.vercel.app',
    isEmbedded: false,
  });
  assert.equal(foreign.shouldShowSourceBanner, true);
  assert.equal(foreign.isForeignHost, true);
  assert.equal(foreign.reason, 'foreign-host');

  const wrappedIframe = evaluateRuntimeEnvironment({
    hostname: 'um-3d-atlas.netlify.app',
    isEmbedded: true,
    ancestorOrigins: ['https://fake-wrapper.example.com'],
  });
  assert.equal(wrappedIframe.shouldShowSourceBanner, true);
  assert.equal(wrappedIframe.isUnauthorizedEmbed, true);
  assert.equal(wrappedIframe.reason, 'unauthorized-embed');
});

runTest('canonicalizes share base URL on foreign domains and unauthorized iframes', () => {
  assert.equal(
    resolveShareBaseUrl({
      hostname: 'copycat.example.com',
      origin: 'https://copycat.example.com',
      pathname: '/map',
      isEmbedded: false,
    }),
    'https://um-3d-atlas.netlify.app/',
  );

  assert.equal(
    resolveShareBaseUrl({
      hostname: 'localhost',
      origin: 'http://localhost:3000',
      pathname: '/',
      isEmbedded: false,
    }),
    'http://localhost:3000/',
  );
});

runTest('round-trips invisible zero-width Unicode watermark cleanly', () => {
  const invisible = encodeZeroWidthWatermark();
  const visibleText = `Loading campus geometry and transit data${invisible}`;
  assert.equal(visibleText.startsWith('Loading campus geometry and transit data'), true);
  const decoded = decodeZeroWidthWatermark(visibleText);
  assert.ok(decoded);
  assert.match(decoded, /^UM3DA:ELHY\|Evan Lim Hong Yan\|um-3d-atlas\.netlify\.app\|[0-9a-f]{8}$/);
});

runTest('embeds and extracts LSB pixel steganography while preserving alpha channel', () => {
  const width = 120;
  const height = 24;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    // First 8 pixels transparent (must be skipped & preserved), rest opaque.
    const transparent = i < 32;
    data[i] = 28;
    data[i + 1] = 34;
    data[i + 2] = 46;
    data[i + 3] = transparent ? 0 : 240;
  }

  const ok = embedImageDataLsbWatermark({ data, width, height });
  assert.equal(ok, true);
  assert.equal(data[3], 0, 'transparent pixel alpha must remain 0');
  assert.equal(data[35], 240, 'opaque pixel alpha must remain untouched');

  const extracted = extractImageDataLsbWatermark({ data, width, height });
  assert.ok(extracted);
  assert.match(extracted, /^UM3DA:ELHY\|Evan Lim Hong Yan\|um-3d-atlas\.netlify\.app\|[0-9a-f]{8}$/);
});

runTest('injects and verifies CRC32-valid PNG tEXt metadata chunks before IEND', () => {
  const tagged = injectPngTextChunks(MINIMAL_PNG);
  assert.ok(tagged.length > MINIMAL_PNG.length);

  // Verify IEND stays at the very end of the file.
  const tailType = String.fromCharCode(
    tagged[tagged.length - 8],
    tagged[tagged.length - 7],
    tagged[tagged.length - 6],
    tagged[tagged.length - 5],
  );
  assert.equal(tailType, 'IEND');

  const meta = extractPngTextChunks(tagged);
  assert.equal(meta.Author, 'Evan Lim Hong Yan');
  assert.equal(meta.Software, 'UM 3D Atlas');
  assert.equal(meta.Source, 'https://um-3d-atlas.netlify.app/');
  assert.equal(meta.Copyright, 'UM 3D Atlas by Evan Lim Hong Yan');
  assert.match(meta.Provenance, /^UM3DA:ELHY:[0-9a-f]{8}$/);
});

console.log('All atlas provenance tests passed.');
