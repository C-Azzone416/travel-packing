import { expect, test, type Locator, type Page } from "@playwright/test";
import { signInAsOwner } from "./helpers/auth";
import { overflow } from "./helpers/layout";
import { expectPacking } from "./helpers/packing";

// Tablet follow-up (#469; spec #393 part 2 sections 5.2 and 5.3): Edit trip is a centred 560 modal from 768 to 1023, and the
// 1024-1179 small-laptop values. Every number is measured from the rendered page.
// E2E_MUTANT_CSS injects CSS after load so a reviewer can prove each assertion can fail.
const MUTANT_CSS = process.env.E2E_MUTANT_CSS;
const NOW = new Date("2026-10-16T12:00:00");

async function start(page: Page, width: number, height = 900) {
  await page.setViewportSize({ width, height });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.clock.setFixedTime(NOW);
  await signInAsOwner(page);
}
async function inject(page: Page) {
  if (MUTANT_CSS) await page.addStyleTag({ content: MUTANT_CSS });
}
const box = async (locator: Locator) => (await locator.first().boundingBox())!;

async function openEdit(page: Page) {
  await page.getByRole("link", { name: "Continue packing: San Diego" }).click();
  await expectPacking(page);
  await page.getByRole("button", { name: "Edit trip" }).click();
  const dialog = page.getByRole("dialog", { name: "Edit trip" });
  await expect(dialog).toBeVisible();
  await inject(page);
  return dialog;
}

for (const width of [768, 1000]) {
  test(`${width}px: Edit trip is a centred 560px modal over a scrim`, async ({ page }) => {
    await start(page, width);
    const dialog = await openEdit(page);
    const d = await box(dialog);
    expect(d.width).toBeGreaterThanOrEqual(559.5);
    expect(d.width).toBeLessThanOrEqual(560.5);
    expect(Math.abs(d.x - (width - d.x - d.width)), "centred across").toBeLessThanOrEqual(1);
    expect(Math.abs(d.y - (900 - d.y - d.height)), "centred down").toBeLessThanOrEqual(1);
    expect(d.height).toBeLessThanOrEqual(900 * 0.9 + 0.5);
    const backdrop = await dialog.evaluate(
      (el) => getComputedStyle(el.parentElement!).backgroundColor,
    );
    expect(backdrop, "a scrim, not the page colour").toMatch(/\/ 0\.55\)$/);
    // The "What changes" panel stays pinned inside the sheet, under the body.
    const save = dialog.getByRole("button", { name: /^(Save|Nothing)/ }).last();
    const s = await box(save);
    expect(s.y + s.height).toBeLessThanOrEqual(d.y + d.height + 0.5);
    expect(await overflow(page)).toBeLessThanOrEqual(0);
  });
}

test("767px: Edit trip is still a full screen", async ({ page }) => {
  await start(page, 767);
  const d = await box(await openEdit(page));
  expect(d.width).toBeGreaterThanOrEqual(766.5);
  expect(d.height).toBeGreaterThanOrEqual(899.5);
});

test("1180px: Edit trip is a 560px sheet on the right", async ({ page }) => {
  await start(page, 1180);
  const d = await box(await openEdit(page));
  expect(d.width).toBeGreaterThanOrEqual(559.5);
  expect(d.width).toBeLessThanOrEqual(560.5);
  expect(Math.abs(d.x + d.width - 1180)).toBeLessThanOrEqual(1);
});

test("1100px: Edit trip is a 420px sheet on the right, full height", async ({ page }) => {
  await start(page, 1100);
  const d = await box(await openEdit(page));
  expect(d.width).toBeGreaterThanOrEqual(419.5);
  expect(d.width).toBeLessThanOrEqual(420.5);
  expect(Math.abs(d.x + d.width - 1100)).toBeLessThanOrEqual(1);
  expect(d.height).toBeGreaterThanOrEqual(899.5);
});

test("Review your bag keeps its 560px sheet at 1100 (the 420 rule is Edit trip only)", async ({
  page,
}) => {
  await start(page, 1100);
  const link = page.getByRole("link", { name: "Continue packing: San Diego" });
  const href = (await link.getAttribute("href"))!;
  await page.goto(`${href.split("?")[0]}?review=1`);
  const dialog = page.getByRole("dialog", { name: "Review your bag" });
  await expect(dialog).toBeVisible();
  await inject(page);
  const d = await box(dialog);
  expect(d.width).toBeGreaterThanOrEqual(559.5);
  expect(d.width).toBeLessThanOrEqual(560.5);
});

test.describe("small laptop, 1024 to 1179", () => {
  test("Staples: one column of cube cards and a 300px preview at 1100, laptop values at 1180", async ({
    page,
  }) => {
    await start(page, 1100);
    await page.goto("/staples");
    const cards = page.locator("section[aria-labelledby^='staples-']");
    await expect(cards.first()).toBeVisible();
    await inject(page);
    const xs = await cards.evaluateAll((els) =>
      els.map((e) => Math.round(e.getBoundingClientRect().left)),
    );
    expect(new Set(xs).size, "one column").toBe(1);
    const preview = await box(page.getByLabel("Preview"));
    expect(preview.width).toBeGreaterThanOrEqual(299.5);
    expect(preview.width).toBeLessThanOrEqual(300.5);
    expect(await overflow(page)).toBeLessThanOrEqual(0);

    await page.setViewportSize({ width: 1180, height: 900 });
    const wide = await box(page.getByLabel("Preview"));
    expect(wide.width).toBeGreaterThanOrEqual(339.5);
    expect(wide.width).toBeLessThanOrEqual(340.5);
  });

  test("Stamps: the past-trips column is 340 wide at 1100", async ({ page }) => {
    await start(page, 1100);
    await page.goto("/stamps");
    const grid = page.getByLabel("Trip stickers");
    await expect(grid).toBeVisible();
    await inject(page);
    // The past-trips column (the case's sibling in the layout grid) is the narrow one.
    const w = await grid.evaluate(
      (el) =>
        el.closest("[class*='stickerCase']")!.nextElementSibling!.getBoundingClientRect().width,
    );
    expect(w).toBeGreaterThanOrEqual(339.5);
    expect(w).toBeLessThanOrEqual(340.5);
    expect(await overflow(page)).toBeLessThanOrEqual(0);
  });

  test("Plan a trip: the live preview column is 400 wide at 1100", async ({ page }) => {
    await start(page, 1100);
    await page.goto("/trips/new");
    const preview = page.getByRole("complementary", { name: "Live preview of your trip" });
    await expect(preview).toBeVisible();
    await inject(page);
    const b = await box(preview);
    expect(b.width).toBeGreaterThanOrEqual(399.5);
    expect(b.width).toBeLessThanOrEqual(400.5);
    expect(await overflow(page)).toBeLessThanOrEqual(0);
  });

  for (const [width, cols] of [
    [1024, 2],
    [1099, 2],
    [1100, 3],
  ] as const) {
    test(`Home: the cube grid has ${cols} columns at ${width}`, async ({ page }) => {
      await start(page, width);
      const tiles = page.locator("[class*='cubes'] > li");
      await expect(tiles.first()).toBeVisible();
      await inject(page);
      const xs = await tiles.evaluateAll((els) =>
        els.map((e) => Math.round(e.getBoundingClientRect().left)),
      );
      expect(new Set(xs).size).toBe(cols);
    });
  }

  for (const [width, moved] of [
    [1024, true],
    [1099, true],
    [1100, true],
    [1180, false],
  ] as const) {
    test(`Stamps: the packed count is ${moved ? "under the dates" : "in its own column"} at ${width}`, async ({
      page,
    }) => {
      await start(page, width);
      await page.goto("/stamps");
      const row = page.locator("button[class*='tripRow']").first();
      await expect(row).toBeVisible();
      await inject(page);
      const { copy, packed } = await row.evaluate((el) => ({
        copy: el.children[1].getBoundingClientRect().left,
        packed: el.children[2].getBoundingClientRect().left,
      }));
      if (moved) expect(Math.abs(packed - copy)).toBeLessThanOrEqual(1);
      else expect(packed).toBeGreaterThan(copy + 20);
    });
  }

  test("Plan a trip: the preview title is 32px at 1100 and 38px at 1180", async ({ page }) => {
    await start(page, 1100);
    await page.goto("/trips/new");
    const title = page
      .getByRole("complementary", { name: "Live preview of your trip" })
      .locator("[class*='tagTitle']");
    await expect(title).toBeVisible();
    await inject(page);
    const size = () => title.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(await size()).toBe(32);
    await page.setViewportSize({ width: 1180, height: 900 });
    expect(await size()).toBe(38);
  });

  test("Top bar: nav pills pad 14 from 1024 to 1099 and 16 from 1100, no overflow", async ({
    page,
  }) => {
    await start(page, 1024);
    const link = page.locator(".bottom-nav .nav-link").first();
    await expect(link).toBeVisible();
    await inject(page);
    const pad = () => link.evaluate((el) => parseFloat(getComputedStyle(el).paddingLeft));
    expect(await pad()).toBe(14);
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    await page.setViewportSize({ width: 1099, height: 900 });
    expect(await pad()).toBe(14);
    await page.setViewportSize({ width: 1100, height: 900 });
    expect(await pad()).toBe(16);
  });
});
