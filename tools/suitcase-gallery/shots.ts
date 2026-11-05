// Rendered proof for the Suitcase primitives (#381): `npx tsx tools/suitcase-gallery/shots.ts <outDir> [port]`.
// Bundles tools/suitcase-gallery/gallery.tsx with Vite (CSS modules and all), serves it on 127.0.0.1, and for each of the
// three colour schemes at 1280, 390 and 195 CSS px: screenshots the page, checks there is no horizontal overflow, and runs
// axe. It is a script, not a route: nothing in the app imports the gallery and nothing ships. Heavy: take the heavy-run lock.
import { createServer } from "node:http";
import { mkdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { chromium } from "@playwright/test";
import react from "@vitejs/plugin-react";
import { build } from "vite";

const root = process.cwd();
const outDir = resolve(process.argv[2] ?? "/tmp/suitcase-shots-381");
const port = Number(process.argv[3] ?? 3114);
const distDir = join(outDir, ".bundle");
const SCHEMES = ["ocean", "evergreen", "dusk"] as const;
const WIDTHS = [1280, 390, 195] as const;
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"];

async function main() {
  mkdirSync(outDir, { recursive: true });

  await build({
    root: resolve(root, "tools/suitcase-gallery"),
    configFile: false,
    logLevel: "warn",
    plugins: [react()],
    resolve: {
      alias: {
        "next/link": resolve(root, "tools/suitcase-gallery/link-stub.tsx"),
        "@": resolve(root, "src"),
      },
    },
    build: { outDir: distDir, emptyOutDir: true, assetsInlineLimit: 0, modulePreload: false },
  });

  const TYPES: Record<string, string> = {
    ".html": "text/html",
    ".js": "text/javascript",
    ".css": "text/css",
    ".woff2": "font/woff2",
  };
  const server = createServer((request, response) => {
    const path = decodeURIComponent((request.url ?? "/").split("?")[0]);
    const file = join(distDir, path === "/" ? "index.html" : path);
    if (!file.startsWith(distDir) || !existsSync(file) || !statSync(file).isFile()) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
    response.end(readFileSync(file));
  });
  await new Promise<void>((done) => server.listen(port, "127.0.0.1", done));

  const browser = await chromium.launch();
  let failures = 0;
  try {
    for (const scheme of SCHEMES) {
      for (const width of WIDTHS) {
        const context = await browser.newContext({ viewport: { width, height: 900 } });
        const page = await context.newPage();
        await page.emulateMedia({ reducedMotion: "reduce" });
        await page.goto(`http://127.0.0.1:${port}/`);
        await page.evaluate(
          (id) => document.documentElement.setAttribute("data-scheme", id),
          scheme,
        );
        await page.evaluate(() => document.fonts.ready);
        const label = `${scheme} @ ${width}`;

        const overflow = await page.evaluate(() => ({
          page: document.documentElement.scrollWidth - window.innerWidth,
          wide: [...document.querySelectorAll<HTMLElement>("body *")]
            .filter((node) => {
              if (node.closest("[data-scroll-container]")) return false;
              const box = node.getBoundingClientRect();
              return box.right > window.innerWidth + 1 || box.left < -1;
            })
            .slice(0, 8)
            .map(
              (node) =>
                `${node.tagName}.${node.className} ${Math.round(node.getBoundingClientRect().left)}..${Math.round(node.getBoundingClientRect().right)}`,
            ),
        }));
        if (overflow.page > 0 || overflow.wide.length > 0) {
          failures += 1;
          console.error(`OVERFLOW ${label}: page +${overflow.page}px`, overflow.wide);
        }

        // Colour contrast is the one rule off: the palette is Caroline's, used verbatim, and its shortfalls are tracked in #377.
        const axe = await new AxeBuilder({ page })
          .withTags(TAGS)
          .disableRules(["color-contrast"])
          .analyze();
        if (axe.violations.length > 0) {
          failures += 1;
          console.error(
            `AXE ${label}`,
            axe.violations.map(
              (v) => `${v.id} x${v.nodes.length}: ${v.nodes[0]?.target.join(" ")}`,
            ),
          );
        }

        await page.screenshot({
          path: join(outDir, `gallery-${scheme}-${width}.png`),
          fullPage: true,
        });
        if (scheme === "ocean") {
          for (const section of await page.locator("[data-section]").all()) {
            const id = await section.getAttribute("data-section");
            await section.screenshot({ path: join(outDir, `section-${id}-${width}.png`) });
          }
        }
        console.log(`ok ${label}`);
        await context.close();
      }
    }
  } finally {
    await browser.close();
    server.close();
  }
  if (failures > 0) {
    console.error(`${failures} failing checks`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
