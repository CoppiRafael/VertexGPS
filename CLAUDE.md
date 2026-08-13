# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

VERTEX GPS — local-only dashboard for trail-running route analysis and race briefing creation (athlete + coach). Loads `.gpx` files client-side, computes distance/D+/D-/elevation/gradient/pace/effort, and lets a coach build a briefing (profile, time goal, sector decisions, notes) saved to the browser's IndexedDB. No backend, no build step, no server-side data: GPX and briefing data never leave the device.

## Running locally

No package manager, no build step — plain HTML/CSS/JS served statically. A server is required only because `index.html` fetches component partials from `components/` (won't work via `file://`).

```powershell
python -m http.server 8005
```
Open `http://localhost:8005`.

There is no test suite, linter, or build/bundle command in this repo.

## Architecture

**Component loading**: `index.html` is a near-empty shell (`<main id="app">`). `assets/js/components.js` fetches each partial in `components/*.html` (listed in `componentNames`), concatenates them into `#app`, then dispatches a `vertex:ready` event on `document`. All app logic waits for that event before touching the DOM — `assets/js/app.js`'s bottom-level `document.addEventListener('vertex:ready', ...)` is the real entry point, not page load.

**Single global script, load order matters**: `assets/js/app.js` (~1300 lines) is one script, not modules — everything is top-level `function`/`let`/`const` in global scope, loaded via a plain `<script defer>` tag (no bundler). Route/split/gpx state lives in module-level `let` globals declared at the top (`P`, `S`, `G`, `T3`, `metrics`, `rawRoutePoints`, `autoSectors`, `customSectors`, etc.) and mutated in place by whichever function runs. Note some function names are defined twice further down the file (`initSplits`, `calcTotal`, `setupTabs`) — later definitions win (hoisting/overwrite), reflecting how the file was split out of a legacy monolith; check for a later duplicate before editing an early one.

**Data flow**: GPX upload → `parseGpx` → `loadGpx` → `buildAnalysis` (haversine distances, smoothing, D+/D-, per-km splits `S`, per-km grade `G`, top-3 climbs `T3`) → renders across tabs (Visão geral, Altimetria, Splits, Gradiente, Carga, Insights, Estratégia, and conditionally Briefing once a GPX is loaded). Tabs are wired in `setupTabs()`, which lazily draws charts (canvas-based, hand-rolled — no chart library) only when a tab is first activated.

**Map**: Leaflet (via CDN, `assets/js/app.js` `initMap()`), synced to the elevation profile — hovering/clicking the elevation chart drives `updateMapElevationFocus`/`queueMapElevationFocus`, moving a marker on the map (`nearestRouteIndex`, `routeIndexAtDistance`).

**Persistence** (all client-side, no server):
- Briefings: IndexedDB, DB `vertex-gps-briefings`, store `briefings` (`briefingDb`/`briefingStore`).
- Elevation annotations (markers/climb labels) and per-km/per-sector notes: `localStorage`, keyed per-GPX via `annotationsStorageKey`/`notesStorageKey`.

**Legacy origin**: `legacy/vertex_la_mision_v3.html` is the original single-file monolith. `tools/split_legacy.ps1` is the one-time script that split it into `components/*.html` + `assets/css/main.css` + `assets/js/data.js`/`app.js`. Don't re-run it against current files — it's a historical record of the split, not a build step.

## Conventions

- UI text and formatting are pt-BR (`Intl.NumberFormat('pt-BR', ...)`, all copy in Portuguese).
- No CSS/JS framework: hand-written CSS in `assets/css/main.css`, hand-rolled canvas charts (no chart library) in `app.js`.
- External deps loaded via CDN in `index.html` (Leaflet only) — don't introduce npm/build tooling without discussing first, since the project's whole point is zero-install, `python -m http.server` and it works.
