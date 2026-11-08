# Art sources

Trip-theme illustrations were removed as part of the Suitcase UI rollout (#392). The historical theme id remains in
stored trip records for backwards compatibility, but the app no longer renders or lets people choose trip art.

## Retired: destination art (#32)

These painterly images were used per destination until #48. They are no longer in the app or the tree; they remain in
the repository history only.

| Filename                    | Destination ID    | Date       | Tool                             | Prompt theme                     | License note                     |
| --------------------------- | ----------------- | ---------- | -------------------------------- | -------------------------------- | -------------------------------- |
| `destination-san-diego.jpg` | `us-ca-san-diego` | 2026-10-16 | Built-in image generator (Codex) | San Diego coastline              | Original, no third-party content |
| `destination-lisbon.jpg`    | `pt-lisbon`       | 2026-10-16 | Built-in image generator (Codex) | Lisbon hills and tram            | Original, no third-party content |
| `destination-london.jpg`    | `gb-eng-london`   | 2026-10-16 | Built-in image generator (Codex) | London Westminster riverfront    | Original, no third-party content |
| `destination-fallback.jpg`  | _(fallback)_      | 2026-10-16 | Built-in image generator (Codex) | Landmark-neutral route and hills | Original, no third-party content |

## Retired: trip theme illustrations (#48)

These hand-built SVGs were used per trip until #392. They are no longer in the app or the tree; the table remains as
provenance for repository history only.

| Filename         | Theme id     | Date       | Tool                    | Subject                                                                            | License note                     |
| ---------------- | ------------ | ---------- | ----------------------- | ---------------------------------------------------------------------------------- | -------------------------------- |
| `travel.svg`     | `travel`     | 2026-10-17 | Hand-built SVG, by hand | Plane on a dotted route, suitcase, folded map                                      | Original, no third-party content |
| `city.svg`       | `city`       | 2026-10-17 | Hand-built SVG, by hand | Layered skyline of plain buildings, lit windows, river                             | Original, no third-party content |
| `beach.svg`      | `beach`      | 2026-10-17 | Hand-built SVG, by hand | Striped umbrella, palm, layered waves, sailboat, sun                               | Original, no third-party content |
| `outdoors.svg`   | `outdoors`   | 2026-10-17 | Hand-built SVG, by hand | Three layered peaks with snow caps, pines, tent, trail                             | Original, no third-party content |
| `theme_park.svg` | `theme_park` | 2026-10-17 | Hand-built SVG, by hand | Ferris wheel, coaster track, bunting, striped tent                                 | Original, no third-party content |
| `home.svg`       | `home`       | 2026-10-17 | Hand-built SVG, by hand | House with lit windows and chimney, trees, string lights, picnic blanket, lanterns | Original, no third-party content |

## Route map geography (#382)

The route map (`src/components/route-map/`) draws real geography from bundled data. No tiles, no network calls at
runtime, no API keys. The data is read and turned into SVG on the server only (`server-only`), so none of it is in the
browser bundle.

| Package / file                       | Version | Licence   | What it is                                                                           |
| ------------------------------------ | ------- | --------- | ------------------------------------------------------------------------------------ |
| `world-atlas` `countries-50m.json`   | 2.0.2   | ISC       | Natural Earth 1:50m countries and land, as TopoJSON. Natural Earth is public domain. |
| `us-atlas` `states-10m.json`         | 3.0.1   | ISC       | US state boundaries (US Census cartographic boundaries, public domain), as TopoJSON. |
| `d3-geo` (+ `d3-array`, `internmap`) | 3.1.2   | ISC       | Projection and path generation (Mercator), server-side only.                         |
| `topojson-client` (+ `commander`)    | 3.1.0   | ISC / MIT | TopoJSON to GeoJSON and border meshes, server-side only.                             |

Countries use the 1:50m file rather than 1:110m: at 1:110m a short trip (Lisbon to Porto, a Caribbean hop) draws as a
blob. The 740 KB file is only ever read on the server. Sample renders for review come from
`npx tsx scripts/route-map-samples.tsx` (dev tooling, not part of any build).
