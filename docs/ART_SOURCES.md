# Destination art sources

Every illustration shipped in `public/destinations/` has a row here (#32).
**New art must add a row in the same PR** that adds the image, plus one entry in
`src/domain/destination-art.ts`.

Art policy: generated originals in the approved Lagoon & Linen style. No
provider-sourced or third-party images. No text, logos or people. One asset per
destination ID, same format and aspect ratio as the existing images, decorative
only (empty alt text, no caption).

| Filename                    | Destination ID    | Date       | Tool                             | Prompt theme                     | License note                     |
| --------------------------- | ----------------- | ---------- | -------------------------------- | -------------------------------- | -------------------------------- |
| `destination-san-diego.jpg` | `us-ca-san-diego` | 2026-10-16 | Built-in image generator (Codex) | San Diego coastline              | Original, no third-party content |
| `destination-lisbon.jpg`    | `pt-lisbon`       | 2026-10-16 | Built-in image generator (Codex) | Lisbon hills and tram            | Original, no third-party content |
| `destination-london.jpg`    | `gb-eng-london`   | 2026-10-16 | Built-in image generator (Codex) | London Westminster riverfront    | Original, no third-party content |
| `destination-fallback.jpg`  | _(fallback)_      | 2026-10-16 | Built-in image generator (Codex) | Landmark-neutral route and hills | Original, no third-party content |

The fallback is used for every destination without its own art, including
custom typed destinations. Source: the approved prototype
(`reference/prototype/dist/assets/`), copied unmodified.

## Trip theme illustrations (#48)

Hand-built SVG, original, in `public/themes/`. One per theme id; `viewBox` 1600×480, focal cluster at about 72% across
and 58% down, shown with `object-position: 72% 58%`. Existing Lagoon & Linen tokens only. No text, people or landmarks.

| Filename     | Theme id | Date       | Tool                    | Subject                                       | License note                     |
| ------------ | -------- | ---------- | ----------------------- | --------------------------------------------- | -------------------------------- |
| `travel.svg` | `travel` | 2026-10-17 | Hand-built SVG, by hand | Plane on a dotted route, suitcase, folded map | Original, no third-party content |
