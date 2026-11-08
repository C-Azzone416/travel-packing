import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { signInAsOwner } from "./helpers/auth";

// Rendered screenshots of the tablet layouts (#414) for design's review (Ocean only). Run with TABLET_SHOTS=<folder>; without it
// these are skipped. Cells: Packing at 820 and 640, Home at 820, Staples at 820.
const SHOTS = process.env.TABLET_SHOTS;
test.skip(!SHOTS, "set TABLET_SHOTS=<folder> to render the design screenshots");

async function start(page: Page, width: number, height: number) {
  await page.setViewportSize({ width, height });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.clock.setFixedTime(new Date("2026-10-16T12:00:00"));
  await signInAsOwner(page);
}
async function shot(page: Page, name: string) {
  mkdirSync(SHOTS!, { recursive: true });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

test("packing-t-ocean-820", async ({ page }) => {
  await start(page, 820, 1100);
  await page.getByRole("link", { name: "Continue packing: San Diego" }).click();
  await expect(page.locator('[data-packing-layout="tablet"]')).toBeVisible();
  await shot(page, "packing-t-ocean-820");
});

test("packing-t-ocean-640", async ({ page }) => {
  await start(page, 640, 1000);
  await page.getByRole("link", { name: "Continue packing: San Diego" }).click();
  await expect(page.locator('[data-packing-layout="phone"]')).toBeVisible();
  await shot(page, "packing-t-ocean-640");
});

test("home-t-ocean-820", async ({ page }) => {
  await start(page, 820, 1100);
  await expect(page.getByRole("region", { name: "San Diego" })).toBeVisible();
  await shot(page, "home-t-ocean-820");
});

test("staples-t-ocean-820", async ({ page }) => {
  await start(page, 820, 1100);
  await page.goto("/staples");
  await expect(page.getByRole("region", { name: "Clothing" })).toBeVisible();
  await shot(page, "staples-t-ocean-820");
});
