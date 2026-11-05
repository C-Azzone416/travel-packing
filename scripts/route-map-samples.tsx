// Usage: tsx scripts/route-map-samples.tsx [outDir]   (default /tmp/route-map-samples)
// Renders sample routes in all three schemes to PNG with Playwright, for design review of #382. Dev tooling only: it is
// not part of the app, so no route exists in any build. Needs the Playwright Chromium browser (`npx playwright install
// chromium`).

import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { chromium } from "@playwright/test";

// `server-only` throws outside a server build; pre-fill its cache entry so this script can import the map.
const require = createRequire(import.meta.url);
require.cache[require.resolve("server-only")] = {
  id: "server-only",
  filename: "server-only",
  loaded: true,
  exports: {},
} as unknown as NodeJS.Module;

const SCHEMES: Record<string, string> = {
  ocean:
    "--dark:#142b3b;--ink:#162b3d;--muted:#4c6372;--page:#dce5e5;--paper:#f7f1e5;--accent:#b66c4d;--accentSoft:#f3e0d6;--gold:#d7c095;--info:#3b7f91;--sea:#c9dadb;--seaLine:#b5c9cb;--coast:#9fb3b5;",
  evergreen:
    "--dark:#1f3a30;--ink:#1d2a24;--muted:#5a6a60;--page:#eeebe0;--paper:#fbf9f2;--accent:#c0612f;--accentSoft:#f6e2d4;--gold:#d4a644;--info:#3f7a8c;--sea:#d5e3e3;--seaLine:#c3d4d3;--coast:#a9b39f;",
  dusk: "--dark:#2f2d4f;--ink:#262438;--muted:#625f78;--page:#efeaee;--paper:#fdfafb;--accent:#e06c55;--accentSoft:#fbe1da;--gold:#e9b65c;--info:#5866a8;--sea:#dfe0ee;--seaLine:#cfd0e3;--coast:#b3b0c6;",
};

const home = (label: string, code: string, lat: number, lng: number) => ({
  kind: "home" as const,
  label,
  code,
  lat,
  lng,
});
const stop = (label: string, code: string, lat: number, lng: number) => ({
  kind: "stop" as const,
  label,
  code,
  lat,
  lng,
});

const ROUTES = {
  transatlantic: {
    mode: "fly" as const,
    points: [
      home("New York", "NYC", 40.64, -73.78),
      stop("Lisbon", "LIS", 38.77, -9.13),
      stop("Porto", "OPO", 41.24, -8.68),
    ],
  },
  "us-domestic": {
    mode: "drive" as const,
    points: [
      home("Chicago", "CHI", 41.98, -87.9),
      stop("Denver", "DEN", 39.86, -104.67),
      stop("San Francisco", "SFO", 37.62, -122.38),
    ],
  },
  pacific: {
    mode: "fly" as const,
    points: [
      home("Honolulu", "HNL", 21.32, -157.92),
      stop("Tokyo", "HND", 35.55, 139.78),
      stop("Seoul", "ICN", 37.46, 126.44),
    ],
  },
  "stops-only-short": {
    mode: "drive" as const,
    points: [stop("Lisbon", "LIS", 38.77, -9.13), stop("Porto", "OPO", 41.24, -8.68)],
  },
  "single-stop": { mode: "other" as const, points: [stop("Lisbon", "LIS", 38.77, -9.13)] },
};

async function main() {
  const out = process.argv[2] ?? "/tmp/route-map-samples";
  mkdirSync(out, { recursive: true });
  const { RouteMap } = await import("../src/components/route-map/RouteMap");
  const browser = await chromium.launch();
  try {
    for (const [scheme, tokens] of Object.entries(SCHEMES)) {
      for (const [name, route] of Object.entries(ROUTES)) {
        const html = (w: number, size?: { width: number; height: number }) =>
          `<!doctype html><html data-scheme="${scheme}"><body style="margin:0;background:var(--page);padding:20px;box-sizing:border-box;width:${w}px"><style>:root{${tokens}}</style>` +
          renderToStaticMarkup(
            <div style={{ background: "var(--paper)", padding: 14, borderRadius: 24 }}>
              <RouteMap points={route.points} mode={route.mode} {...size} />
            </div>,
          ) +
          `</body></html>`;
        for (const [label, w, size] of [
          ["laptop", 690, undefined],
          ["phone", 390, { width: 346, height: 133 }],
          ["w195", 195, { width: 346, height: 133 }],
        ] as const) {
          const page = await browser.newPage({ viewport: { width: w, height: 400 } });
          writeFileSync(join(out, `${name}-${scheme}-${label}.html`), html(w, size));
          await page.setContent(html(w, size));
          const overflow = await page.evaluate(
            () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
          );
          if (overflow) console.error(`OVERFLOW ${name} ${scheme} ${label}`);
          await page.screenshot({
            path: join(out, `${name}-${scheme}-${label}.png`),
            fullPage: true,
          });
          await page.close();
        }
      }
    }
  } finally {
    await browser.close();
  }
  console.log(`wrote screenshots to ${out}`);
}

void main();
