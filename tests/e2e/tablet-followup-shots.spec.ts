import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { signInAsOwner } from "./helpers/auth";
import { expectPacking } from "./helpers/packing";

// Rendered screenshots for the tablet follow-up (#469), Ocean only. Run with TABLET_SHOTS=<folder>; without it these are skipped.
// Cells: Edit trip at 820, Staples at 1100, Plan a trip at 1100.
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

test("edit-t-ocean-820", async ({ page }) => {
  await start(page, 820, 1100);
  await page.getByRole("link", { name: "Continue packing: San Diego" }).click();
  await expectPacking(page);
  await page.getByRole("button", { name: "Edit trip" }).click();
  await expect(page.getByRole("dialog", { name: "Edit trip" })).toBeVisible();
  await shot(page, "edit-t-ocean-820");
});

test("staples-sl-ocean-1100", async ({ page }) => {
  await start(page, 1100, 900);
  await page.goto("/staples");
  await expect(page.getByLabel("Preview").first()).toBeVisible();
  await shot(page, "staples-sl-ocean-1100");
});

test("plan-sl-ocean-1100", async ({ page }) => {
  await start(page, 1100, 900);
  await page.goto("/trips/new");
  await expect(
    page.getByRole("complementary", { name: "Live preview of your trip" }),
  ).toBeVisible();
  await shot(page, "plan-sl-ocean-1100");
});
