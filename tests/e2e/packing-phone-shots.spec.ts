import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { ownerEmailFor, signInAsOwner } from "./helpers/auth";
import { setOwnerAppearance } from "./helpers/database";

// Rendered screenshots of the phone Packing view for design review (#386), Ocean only: the cube list at 195 and at 195 with 200%
// text (words wrap between words only) and Pack mode at 390 after the theme-control removal. Run with PACKING_SHOTS=<folder>;
// without it these are skipped, so the normal run neither writes files nor pays for them. The trip is the seeded San Diego one.
const SHOTS = process.env.PACKING_SHOTS;
test.skip(!SHOTS, "set PACKING_SHOTS=<folder> to render the design screenshots");
test.use({ deviceScaleFactor: 2 });

async function shot(page: Page, name: string) {
  mkdirSync(SHOTS!, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

async function open(page: Page, width: number, height: number) {
  await page.setViewportSize({ width, height });
  await page.clock.setFixedTime(new Date("2026-10-16T12:00:00"));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await signInAsOwner(page);
  await setOwnerAppearance(`e2e-${ownerEmailFor(test.info().project.name)}`, "ocean");
  await page.reload();
  await page.getByRole("link", { name: "Continue packing: San Diego" }).click();
  await expect(page.getByRole("heading", { name: "Pack mode", level: 1 })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-scheme", "ocean");
}

test("ocean 390: Pack mode", async ({ page }) => {
  await open(page, 390, 844);
  await shot(page, "pk-p-ocean-390");
});

test("ocean 195: the cube list wraps between words", async ({ page }) => {
  await open(page, 195, 1300);
  await shot(page, "pk-p-ocean-195");
});

test("ocean 195 at 200% text: the cube list wraps between words", async ({ page }) => {
  await open(page, 195, 1300);
  await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
  await expect
    .poll(() =>
      page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize)),
    )
    .toBeGreaterThanOrEqual(31.9);
  await shot(page, "pk-p-ocean-195-200pct");
});

// #496: quick add. 390 with the add row open, 390 on an empty list (Packed filter on a cube with nothing packed), 195 at 200%.
test("ocean 390: quick add row open", async ({ page }) => {
  await open(page, 390, 844);
  await page.getByRole("button", { name: "Add an item to Clothing" }).click();
  await expect(page.getByPlaceholder("+ Add an item")).toBeFocused();
  await shot(page, "qa-p-ocean-390-open");
});

test("ocean 390: quick add on an empty list", async ({ page }) => {
  await open(page, 390, 844);
  await page.getByRole("button", { name: /^Packed/ }).click();
  await expect(page.getByRole("button", { name: "Add an item to Clothing" })).toBeVisible();
  await shot(page, "qa-p-ocean-390-empty");
});

test("ocean 195 at 200% text: quick add button", async ({ page }) => {
  await open(page, 195, 640);
  await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
  await expect
    .poll(() =>
      page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize)),
    )
    .toBeGreaterThanOrEqual(31.9);
  await expect(page.getByRole("button", { name: "Add an item to Clothing" })).toBeVisible();
  // At 200% text the page scrolls (natural flow), so take the whole page to show the button in place.
  mkdirSync(SHOTS!, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/qa-p-ocean-195-200pct.png`, fullPage: true });
});
