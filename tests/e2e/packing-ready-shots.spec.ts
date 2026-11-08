import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { signInAsOwner } from "./helpers/auth";
import {
  expectPacking,
  packEverythingLeavingBag,
  readyRibbon,
  reviewSheet,
} from "./helpers/packing";

// Rendered screenshots for design review of all packed, the "Review your bag" sheet and Ready (#411): Ocean, laptop 1280 and
// phone 390. Run with PACKING_READY_SHOTS=<folder>; without it these are skipped, so the normal run neither writes files nor
// pays for them. The data is the seeded sample owner (San Diego), packed through the real screen.
const SHOTS = process.env.PACKING_READY_SHOTS;
test.skip(!SHOTS, "set PACKING_READY_SHOTS=<folder> to render the design screenshots");
const NOW = new Date("2026-10-16T12:00:00");

async function shot(page: Page, name: string) {
  mkdirSync(SHOTS!, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });
}

async function packEverything(page: Page) {
  await page.clock.setFixedTime(NOW);
  await signInAsOwner(page);
  await page.getByRole("link", { name: "Continue packing: San Diego" }).click();
  await expectPacking(page);
  await packEverythingLeavingBag(page);
  await expect(page.locator("[data-packed-banner]")).toBeVisible();
}

test("laptop 1280, Ocean: all packed, then the Review sheet", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await packEverything(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(page, "packing-l-ocean-1280-all-packed");
  await page
    .locator("[data-packed-banner]")
    .getByRole("button", { name: "Review your bag" })
    .click();
  await expect(reviewSheet(page)).toBeVisible();
  await shot(page, "packing-l-ocean-1280-review-sheet");
});

test("phone 390, Ocean: the Review sheet, then Ready", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await packEverything(page);
  await page.getByRole("button", { name: "Review your bag" }).first().click();
  const sheet = reviewSheet(page);
  await expect(sheet).toBeVisible();
  await shot(page, "packing-p-ocean-390-review-sheet");
  await sheet.getByRole("button", { name: "Put bag in suitcase" }).click();
  await sheet.getByRole("button", { name: "I’m ready to go" }).click();
  await expect(sheet).toHaveCount(0);
  await expect(readyRibbon(page)).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(page, "packing-p-ocean-390-ready");
});
