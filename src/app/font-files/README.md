# Self-hosted fonts (#182, #380)

The Suitcase type (epic #375, design authority `tokens.css` plus the build spec on #376) is served from these committed
files through `next/font/local`, so a build makes no request to Google Fonts (`next/font/google` fetched the CSS at
build time, and that fetch flaked the CI build job). The earlier Field Ledger fonts (Barlow, Bricolage Grotesque,
Literata) were removed in #380.

| Family                                           | Used for                                                | Files                                              | Licence                              |
| ------------------------------------------------ | ------------------------------------------------------- | -------------------------------------------------- | ------------------------------------ |
| DM Sans (400-700; one variable file per subset)  | UI and body text (`--font-body`)                        | `dm-sans-latin.woff2`, `dm-sans-latin-ext.woff2`   | [OFL-dm-sans.txt](OFL-dm-sans.txt)   |
| Fraunces (700-800; one variable file per subset) | headings, big numbers, sticker codes (`--font-display`) | `fraunces-latin.woff2`, `fraunces-latin-ext.woff2` | [OFL-fraunces.txt](OFL-fraunces.txt) |

**Source.** The `latin` and `latin-ext` subset woff2 files exactly as Google Fonts serves them (fetched 2026-11-04 from
`fonts.gstatic.com` via the css2 API for `DM+Sans:opsz,wght@9..40,400..700` and `Fraunces:opsz,wght@9..144,700..800`,
Chrome user agent), which are the same files `next/font/google` would download for `subsets: ["latin"]`. Both are
variable fonts: DM Sans covers weights 400-700 and Fraunces 700-800 (with its optical-size axis on auto). The licence
texts are the `OFL.txt` files from <https://github.com/google/fonts> (`ofl/dmsans`, `ofl/fraunces`).

**Licence.** Both are under the SIL Open Font License 1.1, which permits using, embedding and redistributing the fonts
(including in a bundled app) provided the copyright notice and the licence text travel with them (they do: the
`OFL-*.txt` files here) and the fonts are not sold on their own. The files are not modified, so the Reserved Font Name
clause does not come into play. `src/app/fonts.test.ts` fails if a font file is added without a licence or a Google
import comes back.

**Latin-ext (PM decision, #182).** Destination names are core content and Open-Meteo returns local spellings (Gdańsk,
Łódź, Plzeň, İzmir), so both families also ship their `latin-ext` subset. `next/font/local` cannot give a face a
`unicode-range`, so each family is declared twice (`--font-body-latin` and `--font-body-ext`, likewise for display), the
ext call carries Google's latin-ext `unicode-range` as a declaration, and `globals.css` composes the stack: latin, then
latin-ext, then a hand-written metric-matched Arial fallback (`DM Sans Fallback`, `Fraunces Fallback`). Because of the
range, and because the ext families are not preloaded, a page that has no latin-ext letters never downloads them, even
though it has symbols such as ✓ and ← that the latin face lacks. The generated fallback is switched off in the four
composed families: it would sit between latin and latin-ext and draw ł and ń itself. `tests/e2e/fonts.spec.ts` checks in
Chromium that "Gdańsk Łódź Plzeň İzmir" is drawn only by the bundled fonts and that latin-ext is fetched only then.
Vietnamese is not bundled (not needed for the destinations); add it the same way if it ever is.

**Fallback metrics.** The Fraunces fallback values are computed the way next/font does it from its bundled Capsize
metrics (Fraunces 700 against Arial). DM Sans is not in that table, so its `DM Sans Fallback` values are an estimate
(about 2% wider than Arial); the only effect is a slightly different line height before the web font swaps in.

**Known difference.** The fallback glyphs the fonts lack (the ← arrow, the ⌂ tab icon) come from the Arial fallback.

To refresh a font, fetch the new file from Google Fonts the same way, replace it here, and re-check the licence.
