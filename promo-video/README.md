# UM 3D Atlas — 9:16 Promotional Reel

Standalone promotional video assets and generator for Instagram Reels, TikTok, and YouTube Shorts (`1080×1920`, 30 fps, 24 seconds, H.264 + 48 kHz AAC stereo).

Completely isolated from the website source, `package.json`, `dist`, and `netlify-dist`.

## Output

- `um-3d-atlas-reel-9x16.mp4` — Final ready-to-post 9:16 promotional video in Clean Light Google Material 3 + Inter design with a custom 124 BPM upbeat tech soundtrack.

## Re-generating With a Custom Live URL

With the UM 3D Atlas dev server running on port 3000:

```bash
PROMO_SITE_URL="your-live-domain.netlify.app" node promo-video/render-reel.mjs
```

### Scripts

- `capture-scenes.mjs` — Captures high-DPI Light Material 3 screenshots of the live UM 3D Atlas features via headless Chromium.
- `synth-audio.mjs` — Synthesizes the beat-synced 124 BPM upbeat tech plucks & beat stereo soundtrack.
- `render-reel.mjs` — Renders all 720 deterministic `1080×1920` frames and masters the final MP4 with FFmpeg.
