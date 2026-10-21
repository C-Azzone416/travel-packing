import { Barlow, Bricolage_Grotesque, Literata } from "next/font/google";

// Field Ledger type (#139 §3), self-hosted by next/font at build time: Barlow for the UI, Bricolage Grotesque for
// display, Literata italic for the category index blurb only. Each sets a CSS variable that globals.css reads.
const body = Barlow({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
  variable: "--font-body",
});
const display = Bricolage_Grotesque({
  subsets: ["latin"],
  weight: ["700", "800"],
  display: "swap",
  variable: "--font-display",
});
const serif = Literata({
  subsets: ["latin"],
  style: ["italic"],
  weight: ["400"],
  display: "swap",
  variable: "--font-serif",
});

export const fontClassNames = [body.variable, display.variable, serif.variable].join(" ");
