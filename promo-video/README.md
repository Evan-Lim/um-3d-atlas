# UM 3D Atlas — Zero-Lag 9:16 Promotional Reel (KPS Edition)

Standalone video production pipeline for the 35-second vertical (`1080 × 1920`, `30 fps`, H.264 High + AAC 48 kHz stereo) promotional Reel showcasing **UM 3D Atlas** (`um-3d-atlas.netlify.app`). Strictly isolated from the web application codebase.

## Output

- **Master Video:** `promo-video/um-3d-atlas-reel-9x16.mp4`
- **Specs:** `1080 × 1920` (9:16), `30 fps`, `35.0 s`, `yuv420p`, `~6.0 MB` (`+faststart`), stereo AAC 48 kHz (`mean -15.8 dB`, `max -0.7 dB`).

## Visual Architecture

- **Solid White Material 3 Header Band:** Opaque `#FFFFFF` top band with hairline `#E2E8F0` divider, 10-segment progress indicator, and thin **Inter (`300 / 400 / 500`, max weight `500`)** + `Roboto Mono (400)` typography.
- **Even 50/50 Full-Screen & Cutaway Rhythm:** Alternates full-screen live mobile app views (Acts 1, 3, 5, 7, 8) with framed Light Material 3 website cutaways paired with synced step-flow action diagrams below (Acts 2, 4, 6, 9), closing on a clean Light Material 3 End Card (Act 10).
- **Zero-Lag Deterministic 30 fps Pipeline:** Captures crisp HiDPI (`540 × 836 @ 1.5×`) app states, gentle natural 3D camera turns (~22°–30°), live road navigation frames, and exact normalized DOM button bounding boxes, then composites optical zoom-ins, Material 3 tap rings, and sub-frame-blended motion deterministically at 30 fps into FFmpeg.
- **Kompleks Perdanasiswa (KPS) Spotlight:** Features instant `KPS` search, **KPS Block C (Auditorium KPS)** 3D indoor cutaway (`Ground (G)`, `Level 1`, `Level 2`), KPS-connected multi-stop directions, live 3D road navigation into KPS, and the `KPS & Lake Loop` custom route & PNG card export.

## Regenerating the Video

Ensure the UM 3D Atlas dev server is running on `http://127.0.0.1:3000`, then run:

```bash
node promo-video/capture-live-acts.mjs
node promo-video/render-reel.mjs
```

Optional: recapture specific acts only (updates `promo-video/.tmp/manifest.json` incrementally):

```bash
PROMO_ACTS=act1,act3 node promo-video/capture-live-acts.mjs
node promo-video/render-reel.mjs
```

Remove temporary caches after rendering:

```bash
rm -rf promo-video/.tmp
```
