# Self-hosted fonts (#182)

The Field Ledger type (#139 §3) is served from these committed files through `next/font/local`, so a build makes no
request to Google Fonts (`next/font/google` fetched the CSS at build time, and that fetch flaked the CI build job).

| Family                                            | Used for                                       | Files                             | Licence                                                    |
| ------------------------------------------------- | ---------------------------------------------- | --------------------------------- | ---------------------------------------------------------- |
| Barlow (400, 500, 600, 700)                       | UI and body text (`--font-body`)               | `barlow-<weight>-latin.woff2`     | [OFL-barlow.txt](OFL-barlow.txt)                           |
| Bricolage Grotesque (700, 800; one variable file) | display headings (`--font-display`)            | `bricolage-grotesque-latin.woff2` | [OFL-bricolage-grotesque.txt](OFL-bricolage-grotesque.txt) |
| Literata (italic 400)                             | the category index blurb only (`--font-serif`) | `literata-italic-400-latin.woff2` | [OFL-literata.txt](OFL-literata.txt)                       |

**Source.** The `latin` subset woff2 files exactly as Google Fonts serves them (fetched 2026-10-22 from
`fonts.gstatic.com` via the css2 API for `Barlow:wght@400;500;600;700`, `Bricolage+Grotesque:wght@700;800` and
`Literata:ital,wght@1,400`), which are the same files `next/font/google` downloaded for the same `subsets: ["latin"]`.
The licence texts are the `OFL.txt` files from <https://github.com/google/fonts> (`ofl/barlow`,
`ofl/bricolagegrotesque`, `ofl/literata`).

**Licence.** All three are under the SIL Open Font License 1.1, which permits using, embedding and redistributing the
fonts (including in a bundled app) provided the copyright notice and the licence text travel with them (they do: the
`OFL-*.txt` files here) and the fonts are not sold on their own. The files are not modified, so the Reserved Font Name
clause does not come into play. `src/app/fonts.test.ts` fails if a font file is added without a licence or a Google
import comes back.

**Latin-ext (PM decision, #182).** Destination names are core content and Open-Meteo returns local spellings (Gdańsk, Łódź,
Plzeň, İzmir), so Barlow and Bricolage also ship their `latin-ext` subset. `next/font/local` cannot give a face a
`unicode-range`, so each of the two families is declared twice (`--font-body-latin` and `--font-body-ext`, likewise for
display), the ext call carries Google's latin-ext `unicode-range` as a declaration, and `globals.css` composes the stack:
latin, then latin-ext, then a hand-written metric-matched Arial fallback (`Barlow Fallback`, `Bricolage Grotesque
Fallback`). Because of the range, and because the ext families are not preloaded, a page that has no latin-ext letters
never downloads them, even though it has symbols such as ✓ and ← that the latin face lacks. The generated fallback is
switched off in the four composed families: it would sit between latin and latin-ext and draw ł and ń itself. The
values in the two `@font-face` fallbacks are the ones next/font computed for these files. `tests/e2e/fonts.spec.ts` checks
in Chromium that "Gdańsk Łódź Plzeň İzmir" is drawn only by the bundled fonts and that latin-ext is fetched only then.
Vietnamese is not bundled (not needed for the destinations); add it the same way if it ever is.

**Known difference.** The fallback glyphs the ledger fonts lack (the ← arrow, the ⌂ tab icon) come from the Arial
fallback, whose metrics are now hand-written instead of generated, so they can sit about 1px differently from before.
Text set in Barlow, Bricolage Grotesque or Literata is unchanged.

To refresh a font, fetch the new file from Google Fonts the same way, replace it here, and re-check the licence.
