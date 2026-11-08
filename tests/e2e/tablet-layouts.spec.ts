import { expect, test, type Locator, type Page } from "@playwright/test";
import { signInAsOwner } from "./helpers/auth";
import { createWeatherTrip } from "./helpers/forecast-trip";
import { overflow } from "./helpers/layout";
import { OPEN_METEO_PORT } from "./support/ports";

// Tablet layouts (#414; spec #393 part 2 section 5, DESIGN REC 14): 601-767 is the phone layout in a 640 column; 768-1023 is a 960
// container with the Packing rail and panel (action bar as the panel footer), two columns on Staples and Settings, and Home in
// its 640 column. The one shell switch stays at 1024. Every number is measured from the rendered page.
// E2E_MUTANT_CSS injects CSS after load so a reviewer can prove each assertion can fail.
const MUTANT_CSS = process.env.E2E_MUTANT_CSS;
const NOW = new Date("2026-10-16T12:00:00");
const WIDTHS = [640, 768, 1000] as const;

async function start(page: Page, width: number) {
  await page.setViewportSize({ width, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.clock.setFixedTime(NOW);
  await signInAsOwner(page);
}
async function inject(page: Page) {
  if (MUTANT_CSS) await page.addStyleTag({ content: MUTANT_CSS });
}
const box = async (locator: Locator) => (await locator.first().boundingBox())!;
/** The element is centred in the viewport (equal gaps either side, within a pixel). */
function expectCentred(b: { x: number; width: number }, viewport: number, label: string) {
  expect(Math.abs(b.x - (viewport - b.x - b.width)), `${label} is centred`).toBeLessThanOrEqual(1);
}
/** How many distinct left edges the boxes have: the column count. */
async function columns(locator: Locator) {
  const xs = await locator.evaluateAll((els) =>
    els.map((el) => Math.round(el.getBoundingClientRect().left)),
  );
  return new Set(xs).size;
}

for (const width of WIDTHS) {
  test.describe(`${width}px`, () => {
    test("Home: the phone Home in a 640 column, centred, no sideways scroll", async ({ page }) => {
      await start(page, width);
      const tag = page.getByRole("region", { name: "San Diego" });
      await expect(tag).toBeVisible();
      await inject(page);
      const b = await box(tag);
      expect(b.width).toBeLessThanOrEqual(640.5);
      expectCentred(b, width, "Home tag");
      expect(await overflow(page)).toBeLessThanOrEqual(0);
    });

    test("Packing: phone at 640, rail and panel with the action bar as footer from 768", async ({
      page,
    }) => {
      await start(page, width);
      await page.getByRole("link", { name: "Continue packing: San Diego" }).click();
      const layout = page.locator("[data-packing-layout]");
      await expect(layout).toBeVisible();
      await inject(page);
      const b = await box(layout);
      expectCentred(b, width, "Packing");
      expect(await overflow(page)).toBeLessThanOrEqual(0);
      if (width < 768) {
        await expect(layout).toHaveAttribute("data-packing-layout", "phone");
        expect(b.width).toBeLessThanOrEqual(640.5);
        return;
      }
      await expect(layout).toHaveAttribute("data-packing-layout", "tablet");
      expect(b.width).toBeLessThanOrEqual(960.5);
      const rail = await box(page.getByRole("navigation", { name: "Cubes" }));
      const panel = page.locator("section[data-cube]");
      const p = await box(panel);
      expect(rail.x + rail.width, "the rail is left of the panel").toBeLessThanOrEqual(p.x + 1);
      expect(rail.width).toBeGreaterThanOrEqual(199);
      expect(rail.width).toBeLessThanOrEqual(262);
      const allIn = await box(panel.getByRole("button", { name: /^All in/ }));
      const next = await box(panel.getByRole("button", { name: /^Next: /, includeHidden: false }));
      for (const part of [allIn, next]) {
        expect(part.x).toBeGreaterThanOrEqual(p.x - 1);
        expect(part.x + part.width).toBeLessThanOrEqual(p.x + p.width + 1);
        expect(part.y + part.height).toBeLessThanOrEqual(p.y + p.height + 1);
        expect(part.height).toBeGreaterThanOrEqual(51);
      }
      // Header: a title row, the progress full width under it, then the actions right-aligned (section 5.2).
      const title = await box(layout.getByRole("heading", { level: 1 }));
      const progress = await box(layout.locator("[class*='progressZone']"));
      const actions = await box(layout.locator("[class*='actions']").first());
      expect(progress.y).toBeGreaterThanOrEqual(title.y + title.height - 1);
      expect(progress.width).toBeGreaterThanOrEqual(b.width - 2);
      expect(actions.y).toBeGreaterThanOrEqual(progress.y + progress.height - 1);
      const lastAction = await box(layout.locator("[class*='actions'] > *").last());
      expect(Math.abs(lastAction.x + lastAction.width - (b.x + b.width))).toBeLessThanOrEqual(2);
      // ONE checklist column across the whole band.
      expect(await columns(panel.locator("li[data-item-id]"))).toBe(1);
      // The footer is the panel's sticky foot: it stays on screen above the tab bar however long the list is.
      const tabBar = await box(page.locator(".bottom-nav"));
      expect(allIn.y + allIn.height).toBeLessThanOrEqual(tabBar.y + 1);
      expect(
        await panel.locator("[class*='tabletBar']").evaluate((el) => getComputedStyle(el).position),
      ).toBe("sticky");
      // The tab bar (not the top bar) is the shell here.
      await expect(page.locator(".bottom-nav")).toBeVisible();
    });

    test("Staples: 640 column at 640, two columns of cube cards from 768", async ({ page }) => {
      await start(page, width);
      await page.goto("/staples");
      const cards = page.locator("section[aria-labelledby^='staples-']");
      await expect(cards.first()).toBeVisible();
      await inject(page);
      expect(await columns(cards)).toBe(width >= 768 ? 2 : 1);
      const screen = await box(page.locator("main > section").first());
      expect(screen.width).toBeLessThanOrEqual(width >= 768 ? 960.5 : 640.5);
      expectCentred(screen, width, "Staples");
      expect(await overflow(page)).toBeLessThanOrEqual(0);
    });

    test("Settings: one cube column at 640, two from 768, inside the container", async ({
      page,
    }) => {
      await start(page, width);
      await page.goto("/settings");
      const cubes = page.locator(".settings-cube");
      await expect(cubes.first()).toBeVisible();
      await inject(page);
      expect(await columns(cubes)).toBe(width >= 768 ? 2 : 1);
      const screen = await box(page.locator("main > section").first());
      expect(screen.width).toBeLessThanOrEqual(width >= 768 ? 960.5 : 640.5);
      expectCentred(screen, width, "Settings");
      expect(await overflow(page)).toBeLessThanOrEqual(0);
    });

    test("Stamps: stickers four across and past trips two columns from 768", async ({ page }) => {
      await start(page, width);
      await page.goto("/stamps");
      const stickers = page.locator("button[class*='stickerButton']");
      await expect(stickers.first()).toBeVisible();
      await inject(page);
      const screen = await box(page.locator("main > section").first());
      expect(screen.width).toBeLessThanOrEqual(width >= 768 ? 960.5 : 640.5);
      const tracks = (selector: string) =>
        page
          .locator(selector)
          .first()
          .evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(" ").length);
      if (width >= 768) {
        expect(await tracks("[class*='stickerGrid']")).toBe(4);
        expect(await tracks("[class*='totals']")).toBe(4);
        expect(await tracks("[class*='tripList']")).toBe(2);
      } else {
        expect(await tracks("[class*='tripList']")).toBe(1);
      }
      expect(await overflow(page)).toBeLessThanOrEqual(0);
    });
  });
}

// The Home Weather panel (on the second app, with the local Open-Meteo fake): the city cards sit two across from 768.
test.describe("Home Weather panel", () => {
  test.use({ baseURL: `http://localhost:${OPEN_METEO_PORT}` });
  for (const width of WIDTHS) {
    test(`${width}px: city cards ${width >= 768 ? "two across" : "one column"}`, async ({
      page,
    }) => {
      test.setTimeout(120_000);
      await page.emulateMedia({ reducedMotion: "reduce" });
      await createWeatherTrip(page, [{ leave: 8, back: 11 }, { leave: 14 }, { leave: 15 }]);
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");
      const pill = page.getByRole("tab", { name: /^Weather/ });
      await expect(pill).not.toContainText("…", { timeout: 30_000 });
      await pill.click();
      await inject(page);
      const list = page.getByRole("tabpanel").locator("[class*='cityList']").first();
      await expect(list).toBeVisible();
      const tracks = await list.evaluate(
        (el) => getComputedStyle(el).gridTemplateColumns.split(" ").length,
      );
      expect(tracks).toBe(width >= 768 ? 2 : 1);
      expect(await overflow(page)).toBeLessThanOrEqual(0);
    });
  }
});

// The open cube and its filter survive crossing 768px in both directions (a rotation, a split view).
test("crossing 768px keeps the open cube and its filter", async ({ page }) => {
  await start(page, 767);
  await page.getByRole("link", { name: "Continue packing: San Diego" }).click();
  await expect(page.locator('[data-packing-layout="phone"]')).toBeVisible();
  await page
    .getByRole("navigation", { name: "Cubes" })
    .getByRole("button", { name: /Toiletries/ })
    .click();
  await page.getByRole("button", { name: /^To pack/ }).click();
  for (const [width, layout] of [
    [768, "tablet"],
    [700, "phone"],
    [1100, "laptop"],
  ] as const) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.locator(`[data-packing-layout="${layout}"]`)).toBeVisible();
    await expect(page.locator("section[data-cube]")).toHaveAttribute("data-cube", "toiletries");
    await expect(page.getByRole("button", { name: /^To pack/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  }
});

// Review your bag stays a 560px sheet on the right from 768 to 1023 (it is a full screen below 768).
for (const width of [768, 1000]) {
  test(`${width}px: Review your bag is a 560px side sheet`, async ({ page }) => {
    await start(page, width);
    const link = page.getByRole("link", { name: "Continue packing: San Diego" });
    const href = (await link.getAttribute("href"))!;
    await page.goto(`${href.split("?")[0]}?review=1`);
    const dialog = page.getByRole("dialog", { name: "Review your bag" });
    await expect(dialog).toBeVisible();
    await inject(page);
    const d = await box(dialog);
    expect(d.width).toBeLessThanOrEqual(560.5);
    expect(Math.abs(d.x + d.width - width)).toBeLessThanOrEqual(1);
  });
}

// The Packing forecast on a tablet: a two-column grid, and an unpaired third stop takes one cell.
test.describe("Packing forecast on a tablet", () => {
  test.use({ baseURL: `http://localhost:${OPEN_METEO_PORT}` });
  for (const width of [768, 1000]) {
    test(`${width}px: forecast cards two across, the third stop one cell`, async ({ page }) => {
      test.setTimeout(120_000);
      await page.emulateMedia({ reducedMotion: "reduce" });
      await createWeatherTrip(page, [{ leave: 8, back: 11 }, { leave: 14 }, { leave: 15 }]);
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");
      await page.getByRole("link", { name: /^(Start|Continue) packing/ }).click();
      const cards = page.locator("[class*='cards']").first();
      await expect(cards).toBeVisible();
      await inject(page);
      const cells = cards.locator("> *");
      await expect(cells).toHaveCount(3);
      const [first, third] = [await box(cells.nth(0)), await box(cells.nth(2))];
      expect(await columns(cells)).toBe(2);
      expect(Math.abs(third.width - first.width)).toBeLessThanOrEqual(1);
      expect(await overflow(page)).toBeLessThanOrEqual(0);
    });
  }
});
