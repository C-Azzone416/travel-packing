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

To refresh a font, fetch the new file from Google Fonts the same way, replace it here, and re-check the licence.
