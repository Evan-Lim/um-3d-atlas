# UM 3D Atlas — 9:16 Promotional Reel

Standalone promotional video pipeline for Instagram Reels, TikTok, and YouTube Shorts. Everything lives inside `/promo-video/` and makes **zero changes** to the UM 3D Atlas web application codebase.

## Deliverable

- **File:** `promo-video/um-3d-atlas-reel-9x16.mp4`
- **Format:** `1080 × 1920` (9:16 vertical), `30 fps`, H.264 High (`yuv420p`, `+faststart`), AAC 48 kHz stereo
- **Duration:** `35.0 s` (10 acts synced to a 126 BPM upbeat tech-pluck soundtrack)
- **File size:** `~6.3 MB` (compact for direct GitHub push and mobile upload)
- **Visual style:** Edge-to-edge full-screen live 9:16 mobile app capture with real 3D WebGL orbits, zooms, and transitions, understated thin `Inter` (`300 / 400 / 500`) captions, and a clean Light Material 3 end card (`Try UM 3D Atlas →`, site link, `Link in bio`).

## 10-Act Showcase

1. **0.0–2.8 s — 3D Campus Orbit:** Sweeping 3D aerial rotation, pitch dive, and zoom across Universiti Malaya.
2. **2.8–6.2 s — Live Search & Fly-To:** Real-time typing (`FSKTM`) and instant 3D camera fly-to with orbit.
3. **6.2–9.6 s — Indoor 3D Cutaway X-Ray:** Live 3D shell cutaway on FSKTM Block A (M16) cycling floors (`G → L1 → L2`) while orbiting.
4. **9.6–12.4 s — Layers, Dark Mode & Trails:** Campus layers, jogging loops, mid-orbit Light ↔ Dark 3D theme flash, and saved places.
5. **12.4–15.6 s — Transit Hub:** RapidKL (`T815`) and UM campus shuttle route highlight with wide 3D orbit.
6. **15.6–19.4 s — Multi-Stop Directions & Weather:** Mode switch (`Walk → Bike`), stop optimization, elevation profile (`+66m / −37m`), 3D multi-stop orbit, and live UM Campus Conditions popover.
7. **19.4–24.2 s — Live 3D Road Navigation:** 3× 3D chase-cam gliding along Campus Road over painted white road turn arrows with live speed dial, GPS coordinates, and countdown ETA.
8. **24.2–27.8 s — Custom Route Studio:** Snapped custom route (`Tasik Varsiti Loop`) with 3D Route Overview orbit and zoom.
9. **27.8–31.2 s — Share & Export PNG:** Opening `Share & Export Route` with route naming, shareable link, and PNG export cards.
10. **31.2–35.0 s — Light Material 3 End Card:** `UM 3D Atlas`, `Try UM 3D Atlas →`, `um-3d-atlas.netlify.app`, and `Link in bio`.

## Re-rendering Locally

Requires the UM 3D Atlas dev server running on `http://127.0.0.1:3000` (override with `PROMO_APP_URL`), Playwright Chromium, and `ffmpeg`.

```bash
# 1. Generate the 35s 126 BPM soundtrack (.tmp/soundtrack.wav)
node promo-video/synth-audio.mjs

# 2. Record all 9 full-screen 540x960 live 3D mobile WebGL acts (or pass specific act IDs)
node promo-video/capture-live-acts.mjs

# 3. Render overlays + Light M3 end card, chain xfade transitions, and master MP4
PROMO_SITE_URL="um-3d-atlas.netlify.app" node promo-video/render-reel.mjs
```

Remove temporary working files afterwards with `rm -rf promo-video/.tmp`.
