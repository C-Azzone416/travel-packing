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

interface Cell {
  /** Open the list of changes (the default on a phone is whatever the 45% rule gives). */
  openList?: boolean;
  /** Fewer edits: only how you are getting there (a short list). */
  short?: boolean;
  /** Scroll the body to Packing preferences (otherwise to the top). */
  prefs?: boolean;
}

async function openEdited(
  page: Page,
  width: number,
  height: number,
  cell: Cell = { openList: true },
) {
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
  if (cell.short) {
    await dialog.getByRole("radio", { name: "Drive" }).check();
  } else {
    await dialog.getByRole("button", { name: "One night more" }).click();
    await dialog.getByRole("button", { name: "One night more" }).click();
    await dialog.getByRole("radio", { name: "Drive" }).check();
    await dialog.getByRole("button", { name: "Packing preferences" }).click();
    await dialog.getByRole("switch", { name: "Laundry on this trip" }).check();
  }
  await expect(dialog.getByRole("button", { name: /^Save \d+ changes?$/ })).toBeVisible();
  const moves = dialog.getByRole("button", { name: /See what moves/ });
  if (
    cell.openList &&
    (await moves.isVisible()) &&
    (await moves.getAttribute("aria-expanded")) === "false"
  )
    await moves.click();
  const body = dialog.locator("[data-edit-body]");
  if (cell.prefs) {
    await dialog.getByRole("button", { name: "Packing preferences" }).scrollIntoViewIfNeeded();
    await body.evaluate((node) => {
      const head = [...node.querySelectorAll("button")].find((b) =>
        b.textContent?.startsWith("Packing preferences"),
      );
      head?.scrollIntoView({ block: "start" });
    });
  } else await body.evaluate((node) => node.scrollTo(0, 0));
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
  test("edit-l-ocean-1280-prefs", async ({ page }) => {
    await openEdited(page, 1280, 1000, { openList: true, prefs: true });
    await shot(page, "edit-l-ocean-1280-prefs");
  });
});

test.describe("phone", () => {
  test.use({ deviceScaleFactor: 2 });
  test("edit-p-ocean-390", async ({ page }) => {
    await openEdited(page, 390, 844);
    await shot(page, "edit-p-ocean-390");
  });
  test("edit-p-ocean-195", async ({ page }) => {
    // The default phone state: a short change list that is still more than 45% of the screen starts folded away.
    const dialog = await openEdited(page, 195, 640, { short: true });
    await expect(dialog.getByRole("button", { name: /See what moves/ })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    await shot(page, "edit-p-ocean-195");
  });
});
