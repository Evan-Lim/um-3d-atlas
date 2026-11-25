# UM 3D Atlas

An interactive 3D campus map and multi-modal navigation web app for **Universiti Malaya (UM)**. Explore faculties, residential colleges (KK1–KK13), institutes, medical zones, indoor rooms, shuttle routes, and jogging loops — and plan or draw routes across campus.

**Live App:** [um-3d-atlas.netlify.app](https://um-3d-atlas.netlify.app/)

---

## Features

- **3D Campus Map & Layer Controls**
  - WebGL 2.5D/3D extruded buildings, canopies, pathways, campus roads, lakes, parks, and boundary overlays rendered with MapLibre GL JS.
  - Distinct tonal tints and dotted borders for faculties, residential colleges, institutes, and medical zones.
  - Light & Dark themes, 2D/3D perspective toggle, and individual map layer toggles.
- **Indoor X-Ray & Floor Inspection**
  - Select supported buildings to inspect interior rooms with an X-ray building shell and per-floor level switcher.
- **Search, Explore & Bookmarks**
  - Instant search across faculties, buildings, rooms, shuttle stops, nearby rail stations, and campus landmarks with category filter chips.
  - Full campus **Zone Directory** and persistent **Saved** & **Recent** places stored locally.
- **Multi-Modal Routing & Elevation Profiles**
  - Point-to-point and multi-stop routing for **Walking** (including optional step-free routing), **Cycling**, **Shuttle Transit & Walk**, and **Driving**.
  - Automatic multi-stop order optimization, mode-by-mode time comparison, step/calorie estimates, and interactive elevation profiles with gain/drop metrics.
- **Custom Route Builder (Draw Route)**
  - Click or drag-to-snap custom walking, jogging, cycling, or driving paths directly on the campus network.
- **Live GPS Navigation & Route Walkthrough**
  - One-tap geolocation with live accuracy halo, **Start from my location** routing, turn-by-turn navigation HUD, and interactive route simulation (`1×` / `3×` speed).
- **Transit Hub & Jogging Loops**
  - Inspect UM shuttle bus lines and stops, highlight individual transit corridors on the map, and view campus jogging routes.
- **Campus Conditions**
  - Compact live weather and campus conditions bar integrated into the map UI.
- **Deep Links & PNG Route Card Export**
  - Shareable URLs for places, multi-stop routes, and custom drawn paths.
  - Export high-resolution route summary cards as PNGs (either over the live 3D map or as clean route-only transparent, light, or dark cards with stats and an elevation sparkline).
- **Mobile-First Interactions**
  - Responsive bottom navigation bar, collapsible detail and route sheets on phones, and non-overlapping floating map controls.

---

## Tech Stack

- **React 19** + **TypeScript 5.8**
- **MapLibre GL JS 5** — WebGL 3D campus rendering
- **Vite 6** — fast dev server and static production builds
- **Custom Material 3 UI** — hand-crafted styles in `src/index.css` and a lightweight SVG icon set in `src/components/Icon.tsx` (zero UI framework bloat)
- **Static Campus Datasets** — GeoJSON & JSON assets in `public/data/`, allowing zero-backend static hosting

> **Note on Geolocation:** Browser geolocation requires a secure context (`https://` or `http://localhost`). Netlify serves the production build over HTTPS automatically.

---

## Getting Started

```bash
# Install dependencies
npm install

# Start the local development server
npm run dev
```

### Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start Vite development server |
| `npm run lint` | Run TypeScript type checking (`tsc -b`) |
| `npm run build` | Type-check and build static production bundles to `dist/` and `netlify-dist/` |
| `npm run preview` | Preview the production build locally |

---

## Deployment (Netlify)

This repository includes `netlify.toml` preconfigured with the build command (`npm run build`), publish directory (`dist`), SPA fallback redirects, and static asset cache headers.

- **Git-connected deploy:** Connect the repository in Netlify and deploy — no environment variables are required.
- **Manual static deploy:** Run `npm run build` and drag-and-drop the generated `netlify-dist/` folder directly into Netlify.

---

## Project Structure

```text
public/
  data/
    um_boundary.geojson       Campus boundary polygon
    um_faculties.geojson      Faculties, residential colleges, institutes & zones
    um_buildings.geojson      3D building footprints, heights & canopies
    um_rooms.geojson          Indoor room polygons & floor metadata
    um_context.geojson        Campus roads, footpaths, water, parks & POIs
    um_jogging.geojson        Campus jogging loops
    um_transit.json           UM shuttle bus routes & stop schedules
    um_graph.json             Multi-modal routing graph (walk/bike/bus/drive)
    um_elevation.json         Campus elevation grid for route profiles
    um_search_index.json      Prebuilt search index
src/
  App.tsx                     Application state, routing workflows & layout
  theme.ts                    Zone tonal palettes & theme helpers
  components/
    UmMapCanvas.tsx           MapLibre 3D scene, vector layers & gestures
    SearchBar.tsx             Search bar & quick category filter chips
    ZoneBanner.tsx            Active campus zone header
    CampusConditionsBar.tsx   Live campus weather & conditions indicator
    InspectorPanel.tsx        Zone, building, room & transit stop details
    FloorControls.tsx         Indoor floor selector & X-ray toggle
    DirectionsPanel.tsx       Multi-modal directions, stops & mode comparison
    CustomRoutePanel.tsx      Custom drawn route builder controls
    ElevationProfileChart.tsx Route elevation gain/drop chart
    RouteOverviewBar.tsx      Step preview & route simulation bar
    LiveNavHud.tsx            Turn-by-turn live navigation HUD
    ShareRouteModal.tsx       Link sharing & PNG route card exporter
    TransitHubModal.tsx       Shuttle lines, stops & route highlighter
    ZoneDirectoryModal.tsx    Full campus zone directory
    SavedPlacesSheet.tsx      Saved bookmarks & recent places sheet
    LayerControls.tsx         Map layer visibility, theme & 2D/3D toggles
    Icon.tsx                  Dependency-free SVG icon set
  routing/
    pathfinder.ts             Multi-modal campus graph router
  utils/
    atlasUtils.ts             URL state, spatial zone lookup & stop ordering
    routeTools.ts             Custom route snapping & geometry helpers
    routeImageExport.ts       High-resolution PNG route card renderer
    elevationUtils.ts         Elevation sampling & profile calculation
    weatherUtils.ts           Campus weather fetcher with diurnal fallback
  types/
    map.ts                    Shared TypeScript interfaces
```

---

## Author & License

Created by **Evan Lim Hong Yan**.  
Released under the [MIT License](LICENSE).
