import localFont from "next/font/local";

// Field Ledger type (#139 §3), served from the committed files in ./font-files (#182), so a build makes no request to
// Google Fonts: Barlow for the UI, Bricolage Grotesque for display, Literata italic for the category index blurb only.
// Each sets a CSS variable that globals.css reads. The files are the latin subsets Google serves, under the SIL Open
// Font License (see ./font-files/README.md for the source and the licence texts).
const body = localFont({
  src: [
    { path: "./font-files/barlow-400-latin.woff2", weight: "400", style: "normal" },
    { path: "./font-files/barlow-500-latin.woff2", weight: "500", style: "normal" },
    { path: "./font-files/barlow-600-latin.woff2", weight: "600", style: "normal" },
    { path: "./font-files/barlow-700-latin.woff2", weight: "700", style: "normal" },
  ],
  display: "swap",
  variable: "--font-body",
  adjustFontFallback: "Arial",
});
// One variable file covers both weights the design uses.
const display = localFont({
  src: [
    { path: "./font-files/bricolage-grotesque-latin.woff2", weight: "700 800", style: "normal" },
  ],
  display: "swap",
  variable: "--font-display",
  adjustFontFallback: "Arial",
});
const serif = localFont({
  src: [{ path: "./font-files/literata-italic-400-latin.woff2", weight: "400", style: "italic" }],
  display: "swap",
  variable: "--font-serif",
  adjustFontFallback: "Times New Roman",
});

export const fontClassNames = [body.variable, display.variable, serif.variable].join(" ");
