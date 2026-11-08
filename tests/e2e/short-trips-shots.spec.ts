import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { ownerEmailFor } from "./helpers/auth";
import { setOwnerAppearance } from "./helpers/database";
import { DAY, NEXT_DAY, create, planAndOpen } from "./helpers/short-trip";

// Rendered screenshots of short trips for design review (#412): Ocean only. Run with SHORT_SHOTS=<folder>; without it these
// are skipped. Synthetic sample trips only, with fixed dates.
const SHOTS = process.env.SHORT_SHOTS;
test.skip(!SHOTS, "set SHORT_SHOTS=<folder> to render the design screenshots");
test.beforeEach(({}, info) => {
  test.skip(info.project.name !== "desktop", "shots are taken once, on the desktop project");
});
test.use({ deviceScaleFactor: 1.5 });

async function shot(page: Page, name: string) {
  mkdirSync(SHOTS!, { recursive: true });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

async function ocean() {
  await setOwnerAppearance(`e2e-${ownerEmailFor(test.info().project.name)}`, "ocean");
}

test("packing-l-ocean-1280-day-trip and edit-l-ocean-1280-day-trip", async ({ page }) => {
  test.setTimeout(180_000);
  await planAndOpen(page, DAY, DAY);
  await ocean();
  await create(page, 1280);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Packing", level: 1 })).toBeVisible();
  await shot(page, "packing-l-ocean-1280-day-trip");
  await page.getByRole("button", { name: "Edit trip" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Edit trip" });
  await dialog.getByRole("button", { name: /Packing preferences/ }).click();
  await expect(dialog.getByText("No effect on a trip this short.")).toBeVisible();
  await shot(page, "edit-l-ocean-1280-day-trip");
});

test("packing-p-ocean-390-day-trip", async ({ page }) => {
  test.setTimeout(180_000);
  await planAndOpen(page, DAY, DAY);
  await ocean();
  await create(page, 390);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Pack mode", level: 1 })).toBeVisible();
  await shot(page, "packing-p-ocean-390-day-trip");
});

test("packing-p-ocean-390-one-night", async ({ page }) => {
  test.setTimeout(180_000);
  await planAndOpen(page, DAY, NEXT_DAY);
  await ocean();
  await create(page, 390);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Pack mode", level: 1 })).toBeVisible();
  await shot(page, "packing-p-ocean-390-one-night");
});
