// Usage: tsx scripts/usual-weather-shots.tsx [outDir]   (default /tmp/usual-weather-shots)
// Renders the Usual weather and Weather is off blocks (#408) in all three schemes at 390 and 1280 to PNG with
// Playwright, for design review. Dev tooling only: not part of the app, so no route exists in any build. Fonts are the
// system fallbacks (next/font is not available here). Needs `npx playwright install chromium`.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { chromium } from "@playwright/test";
import {
  UsualWeatherBlock,
  WeatherOffBlock,
  type UsualWeatherRow,
} from "../src/components/ui/UsualWeather";

const outDir = process.argv[2] ?? "/tmp/usual-weather-shots";
mkdirSync(outDir, { recursive: true });

const css = ["src/app/scheme-tokens.css", "src/app/type-scale.css", "src/app/globals.css"]
  .map((file) => readFileSync(file, "utf8"))
  .join("\n");

const ROWS: UsualWeatherRow[] = [
  {
    id: "lis",
    city: "Lisbon",
    dates: "14 – 18 Mar",
    line: "usually mild, about 3 rainy days",
    range: "64° / 51°",
  },
  {
    id: "opo",
    city: "Porto",
    dates: "18 – 24 Mar",
    line: "usually cool, about 6 rainy days",
    range: "59° / 46°",
  },
  { id: "mad", city: "Madrid", dates: "24 – 26 Mar", unavailable: true },
];

function page(scheme: string): string {
  const body = renderToStaticMarkup(
    <main style={{ display: "grid", gap: 28, maxWidth: 560, padding: 20 }}>
      <UsualWeatherBlock start="2027-03-14" today="2027-01-10" rows={ROWS} />
      <UsualWeatherBlock
        start="2027-03-14"
        today="2027-03-09"
        rows={ROWS.slice(0, 1)}
        headingLevel={3}
        showNote={false}
      />
      <WeatherOffBlock />
    </main>,
  );
  return `<!doctype html><html data-scheme="${scheme}"><head><meta name="viewport" content="width=device-width"><style>${css}</style></head><body style="background:var(--page);margin:0">${body}</body></html>`;
}

async function main() {
  const browser = await chromium.launch();
  try {
    for (const scheme of ["ocean", "evergreen", "dusk"]) {
      const html = page(scheme);
      writeFileSync(join(outDir, `${scheme}.html`), html);
      for (const width of [390, 1280]) {
        const tab = await browser.newPage({
          viewport: { width, height: 900 },
          deviceScaleFactor: 2,
        });
        await tab.setContent(html);
        await tab.screenshot({
          path: join(outDir, `usual-weather-${scheme}-${width}.png`),
          fullPage: true,
        });
        await tab.close();
      }
    }
  } finally {
    await browser.close();
  }
  console.log(`Wrote screenshots to ${outDir}`);
}

void main();
