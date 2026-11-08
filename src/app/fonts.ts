import localFont from "next/font/local";

// Suitcase type (#380): DM Sans for the UI and body text, Fraunces for headings and big numbers. Both are served from the
// committed files in ./font-files (#182), so a build makes no request to Google Fonts. The files are the Google-served
// subsets under the SIL Open Font License (see ./font-files/README.md). Each is one variable file per subset, so a single
// file covers every weight the design uses (DM Sans 400-700, Fraunces 700-800).
//
// Each family comes in two next/font families, the latin subset and the latin-ext subset, because next/font/local cannot
// give a face a unicode-range. globals.css composes them into one stack, latin first and latin-ext after it, so a page of
// plain Latin text never downloads latin-ext, while a name like "Gdańsk" or "Łódź" still renders in the app font. The ext
// families skip preload and carry the latin-ext unicode-range for the same reason, and none adds next's own metric
// fallback: a fallback in the middle of the stack would draw ł and ń before the latin-ext face got its turn, so
// globals.css declares the two fallbacks itself and puts them last.
// Every ext face carries the unicode-range Google gives its latin-ext faces (the same value in both ext families below:
// next/font only accepts literals, so it cannot be a shared constant). Without it the browser would download the ext
// faces for any symbol the latin face lacks (✓ ← ⌂ ＋), not only for letters like ł and ń.
const bodyLatin = localFont({
  src: [{ path: "./font-files/dm-sans-latin.woff2", weight: "400 700", style: "normal" }],
  display: "swap",
  variable: "--font-body-latin",
  adjustFontFallback: false,
});
const bodyExt = localFont({
  src: [{ path: "./font-files/dm-sans-latin-ext.woff2", weight: "400 700", style: "normal" }],
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
const displayLatin = localFont({
  src: [{ path: "./font-files/fraunces-latin.woff2", weight: "700 800", style: "normal" }],
  display: "swap",
  variable: "--font-display-latin",
  adjustFontFallback: false,
});
const displayExt = localFont({
  src: [{ path: "./font-files/fraunces-latin-ext.woff2", weight: "700 800", style: "normal" }],
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

export const fontClassNames = [
  bodyLatin.variable,
  bodyExt.variable,
  displayLatin.variable,
  displayExt.variable,
].join(" ");
