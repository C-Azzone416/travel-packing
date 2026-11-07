import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { signInAsOwner } from "./helpers/auth";
import { setOwnerAppearance } from "./helpers/database";
import { ownerEmailFor } from "./helpers/auth";

// Rendered screenshots of Edit trip for design review (#389): Ocean only, an edited section with the live "What changes in your
// list" panel, at the laptop side sheet (1280), the phone full screen (390) and 195. Run with EDIT_SHOTS=<folder>; without it
// these are skipped. Synthetic sample trip only (San Diego).
const SHOTS = process.env.EDIT_SHOTS;
test.skip(!SHOTS, "set EDIT_SHOTS=<folder> to render the design screenshots");
test.beforeEach(({}, info) => {
  test.skip(info.project.name !== "desktop", "shots are taken once, on the desktop project");
});
const NOW = new Date("2026-10-16T12:00:00");

async function openEdited(page: Page, width: number, height: number) {
  await page.setViewportSize({ width, height });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.clock.setFixedTime(NOW);
  await signInAsOwner(page);
  await setOwnerAppearance(`e2e-${ownerEmailFor(test.info().project.name)}`, "ocean");
  await page.goto("/");
  await page.getByRole("link", { name: "Continue packing: San Diego" }).click();
  await expect(page).toHaveURL(/\/trips\/[^/]+$/);
  await expect(async () => {
    await page.getByRole("button", { name: "Edit trip" }).first().click();
    await expect(page.getByRole("dialog", { name: "Edit trip" })).toBeVisible({ timeout: 1000 });
  }).toPass();
  const dialog = page.getByRole("dialog", { name: "Edit trip" });
  await dialog.getByRole("button", { name: "One night more" }).click();
  await dialog.getByRole("button", { name: "One night more" }).click();
  await dialog.getByRole("radio", { name: "Drive" }).check();
  await dialog.getByRole("button", { name: "Packing preferences" }).click();
  await dialog.getByRole("switch", { name: "Laundry on this trip" }).check();
  await expect(dialog.getByRole("button", { name: /^Save \d+ changes$/ })).toBeVisible();
  // The live list open (a phone starts it folded away when it is long).
  const moves = dialog.getByRole("button", { name: /See what moves/ });
  if ((await moves.isVisible()) && (await moves.getAttribute("aria-expanded")) === "false")
    await moves.click();
  await expect(dialog.getByRole("list", { name: "What changes in your list" })).toBeVisible();
  await dialog.locator("[data-edit-body]").evaluate((body) => body.scrollTo(0, 0));
  return dialog;
}

async function shot(page: Page, name: string) {
  mkdirSync(SHOTS!, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

test.describe("laptop", () => {
  test.use({ deviceScaleFactor: 1.5 });
  test("edit-l-ocean-1280", async ({ page }) => {
    await openEdited(page, 1280, 1000);
    await shot(page, "edit-l-ocean-1280");
  });
});

test.describe("phone", () => {
  test.use({ deviceScaleFactor: 2 });
  test("edit-p-ocean-390", async ({ page }) => {
    await openEdited(page, 390, 844);
    await shot(page, "edit-p-ocean-390");
  });
  test("edit-p-ocean-195", async ({ page }) => {
    await openEdited(page, 195, 640);
    await shot(page, "edit-p-ocean-195");
  });
});
