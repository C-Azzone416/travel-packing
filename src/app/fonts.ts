import localFont from "next/font/local";

// Field Ledger type (#139 §3), served from the committed files in ./font-files (#182), so a build makes no request to
// Google Fonts: Barlow for the UI, Bricolage Grotesque for display, Literata italic for the category index blurb only.
// The files are the Google-served subsets under the SIL Open Font License (see ./font-files/README.md).
//
// Barlow and Bricolage each come in two families, the latin subset and the latin-ext subset, because next/font/local
// cannot give a face a unicode-range. globals.css composes them into one stack, latin first and latin-ext after it, so
// a page of plain Latin text never downloads latin-ext, while a name like "Gdańsk" or "Łódź" still renders in the
// ledger font. The ext families skip preload and carry the latin-ext unicode-range for the same reason, and none of the
// four adds next's own metric fallback: a
// fallback in the middle of the stack would draw ł and ń before the latin-ext face got its turn, so globals.css
// declares the two fallbacks itself and puts them last.
// Every ext face carries the unicode-range Google gives its latin-ext faces (the same value in both ext families below:
// next/font only accepts literals, so it cannot be a shared constant). Without it the browser would download the ext
// faces for any symbol the latin face lacks (✓ ← ⌂ ＋), not only for letters like ł and ń.
const bodyLatin = localFont({
  src: [
    { path: "./font-files/barlow-400-latin.woff2", weight: "400", style: "normal" },
    { path: "./font-files/barlow-500-latin.woff2", weight: "500", style: "normal" },
    { path: "./font-files/barlow-600-latin.woff2", weight: "600", style: "normal" },
    { path: "./font-files/barlow-700-latin.woff2", weight: "700", style: "normal" },
  ],
  display: "swap",
  variable: "--font-body-latin",
  adjustFontFallback: false,
});
const bodyExt = localFont({
  src: [
    { path: "./font-files/barlow-400-latin-ext.woff2", weight: "400", style: "normal" },
    { path: "./font-files/barlow-500-latin-ext.woff2", weight: "500", style: "normal" },
    { path: "./font-files/barlow-600-latin-ext.woff2", weight: "600", style: "normal" },
    { path: "./font-files/barlow-700-latin-ext.woff2", weight: "700", style: "normal" },
  ],
  display: "swap",
  variable: "--font-body-ext",
  adjustFontFallback: false,
  preload: false,
  declarations: [
    {
      prop: "unicode-range",
      value:
        "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C4, U+2113, U+2C60-2C7F, U+A720-A7FF",
    },
  ],
});
// One variable file per subset covers both weights the design uses.
const displayLatin = localFont({
  src: [
    { path: "./font-files/bricolage-grotesque-latin.woff2", weight: "700 800", style: "normal" },
  ],
  display: "swap",
  variable: "--font-display-latin",
  adjustFontFallback: false,
});
const displayExt = localFont({
  src: [
    {
      path: "./font-files/bricolage-grotesque-latin-ext.woff2",
      weight: "700 800",
      style: "normal",
    },
  ],
  display: "swap",
  variable: "--font-display-ext",
  adjustFontFallback: false,
  preload: false,
  declarations: [
    {
      prop: "unicode-range",
      value:
        "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C4, U+2113, U+2C60-2C7F, U+A720-A7FF",
    },
  ],
});
const serif = localFont({
  src: [{ path: "./font-files/literata-italic-400-latin.woff2", weight: "400", style: "italic" }],
  display: "swap",
  variable: "--font-serif",
  adjustFontFallback: "Times New Roman",
});

export const fontClassNames = [
  bodyLatin.variable,
  bodyExt.variable,
  displayLatin.variable,
  displayExt.variable,
  serif.variable,
].join(" ");
