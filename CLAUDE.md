# Project
Room-scale mixed reality data experience for Meta Quest 3, deployed via GitHub Pages.
Built for a BUSINFO715 FinTech workshop demo.

This is NOT a page-based visualisation. The user places a 1m globe in their
physical room (immersive-ar + hit-test) and walks around it. Spatial arrangement,
reachability, and comfortable viewing distance are real design constraints —
objects must occupy the room sensibly, not be laid out as if on a screen.
The drill-down cube is placed beside the globe specifically so the user walks
between two coexisting objects.

## Hard constraints
- App is index.html + data.js only. No build step, no bundler.
  (build-data.js and coverage-report.js are dev-time tooling, never shipped logic.)
- No network fetches at runtime — all data inlined in data.js.
  Regenerate with `node build-data.js` (reads the four DBnomics FAS CSVs;
  centroids/regions/areas cached in centroids-cache.json).
- A-Frame 1.5 from CDN. Must work in the Quest browser.
- Flat desktop mode (WASD + mouse-look; `?debug` forces it) is mandatory —
  it is the only path the author can verify (no headset available). But it is
  a testing surface, not the design target. Design for the room; verify flat.

## The visuals
Two coexisting objects in the room:

1. **Globe** — 1m sphere, two spikes per country (physical infrastructure vs
   mobile money), all 192 countries, floating time scrubber 2004–2024.
   Two modes: access points (shared global 95th-percentile scale, clipped
   spikes ringed) and adoption (per-country normalisation, different units).
2. **Drill-down cube** — space-time cube for 2–5 selected countries,
   beside the globe.

## Data principles
- Null = not reported. Never interpolate, zero-fill, or confuse with zero.
- Annotate anomalies (reporting-perimeter breaks like Nigeria's 2021 agent
  jump), never correct the data.
- Source: IMF Financial Access Survey; mobile money series begin ~2010,
  ~80 countries report.

## Performance
192 countries × 2 spikes via InstancedMesh; year changes mutate instance
matrices in place, never rebuild the scene graph. Target 72fps standalone.
