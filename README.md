# UM 3D Atlas

An interactive 3D campus atlas for Universiti Malaya. Browse faculties, residential
colleges (KK1–KK13), institutes and landmarks; inspect buildings and indoor rooms;
and plan walking, shuttle or driving routes across campus.

## Stack

- **React 19** + **TypeScript** — UI runtime, bundled at build time (no CDN).
- **MapLibre GL JS** — WebGL 2.5D/3D map renderer.
- **Vite** — development server and static production build.
- Hand-rolled Material 3 Expressive design system in `src/index.css` and a small
  icon set in `src/components/Icon.tsx`. No UI kit, no icon package.
- Google Sans (Google Fonts) for type, with a system fallback stack.

All campus data is static GeoJSON/JSON under `public/data`, so the app deploys as
a plain static site.

## Development

```bash
npm install
npm run dev
```

## Production build

```bash
npm run build   # type-check + bundle to dist/
npm run preview # serve the built site locally
```

## Deploying to Netlify

`netlify.toml` is committed with the build command (`npm run build`), publish
directory (`dist`), SPA redirect and cache headers. Connect the repository in
Netlify and deploy — no environment variables are required.

## Project layout

```
src/
  App.tsx                    state, data loading and screen composition
  theme.ts                   tonal palette helpers for faculty zones
  components/
    UmMapCanvas.tsx          MapLibre scene, layers and interactions
    SearchBar.tsx            docked search + filter chips
    ZoneBanner.tsx           translucent active-zone header
    InspectorPanel.tsx       zone / building / room / stop details
    DirectionsPanel.tsx      travel modes, endpoints and route steps
    LiveNavHud.tsx           turn-by-turn navigation HUD
    ZoneDirectoryModal.tsx   full campus directory
    LayerControls.tsx        layer switches and data notes
    FloorControls.tsx        indoor floor selector
    Icon.tsx                 dependency-free icon set
  routing/pathfinder.ts      graph routing (walk / bus / drive, step-free)
  types/map.ts               shared data contracts
```
