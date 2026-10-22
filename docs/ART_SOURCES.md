# Art sources

A trip's picture is its theme (#48). Every illustration shipped in `public/themes/` has a row in the table below,
and **new art must add a row in the same PR** that adds the file, plus its entry in `src/domain/themes.ts`.

Art policy: original illustrations in the approved Lagoon & Linen style. No provider-sourced or third-party images.
No text, logos or people. Decorative only (empty alt text, no caption).

## Retired: destination art (#32)

These painterly images were used per destination until #48. They are no longer in the app or the tree; they remain in
the repository history only.

| Filename                    | Destination ID    | Date       | Tool                             | Prompt theme                     | License note                     |
| --------------------------- | ----------------- | ---------- | -------------------------------- | -------------------------------- | -------------------------------- |
| `destination-san-diego.jpg` | `us-ca-san-diego` | 2026-10-16 | Built-in image generator (Codex) | San Diego coastline              | Original, no third-party content |
| `destination-lisbon.jpg`    | `pt-lisbon`       | 2026-10-16 | Built-in image generator (Codex) | Lisbon hills and tram            | Original, no third-party content |
| `destination-london.jpg`    | `gb-eng-london`   | 2026-10-16 | Built-in image generator (Codex) | London Westminster riverfront    | Original, no third-party content |
| `destination-fallback.jpg`  | _(fallback)_      | 2026-10-16 | Built-in image generator (Codex) | Landmark-neutral route and hills | Original, no third-party content |

## Trip theme illustrations (#48)

Hand-built SVG, original, in `public/themes/`. One per theme id; `viewBox` 1600×480, focal cluster at about 72% across
and 58% down, shown with `object-position: 72% 58%`. Existing Lagoon & Linen tokens only. No text, people or landmarks.

| Filename         | Theme id     | Date       | Tool                    | Subject                                                                            | License note                     |
| ---------------- | ------------ | ---------- | ----------------------- | ---------------------------------------------------------------------------------- | -------------------------------- |
| `travel.svg`     | `travel`     | 2026-10-17 | Hand-built SVG, by hand | Plane on a dotted route, suitcase, folded map                                      | Original, no third-party content |
| `city.svg`       | `city`       | 2026-10-17 | Hand-built SVG, by hand | Layered skyline of plain buildings, lit windows, river                             | Original, no third-party content |
| `beach.svg`      | `beach`      | 2026-10-17 | Hand-built SVG, by hand | Striped umbrella, palm, layered waves, sailboat, sun                               | Original, no third-party content |
| `outdoors.svg`   | `outdoors`   | 2026-10-17 | Hand-built SVG, by hand | Three layered peaks with snow caps, pines, tent, trail                             | Original, no third-party content |
| `theme_park.svg` | `theme_park` | 2026-10-17 | Hand-built SVG, by hand | Ferris wheel, coaster track, bunting, striped tent                                 | Original, no third-party content |
| `home.svg`       | `home`       | 2026-10-17 | Hand-built SVG, by hand | House with lit windows and chimney, trees, string lights, picnic blanket, lanterns | Original, no third-party content |
