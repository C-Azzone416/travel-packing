import { mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { ownerEmailFor, signInAsOwner } from "./helpers/auth";
import { setOwnerAppearance } from "./helpers/database";

// Rendered screenshot of the laptop Packing view with the quick add button (#496), Ocean, 1280 at DPR 1.5. Run with
// PACKING_SHOTS=<folder>; skipped without it. The phone cells are in packing-phone-shots.spec.ts.
const SHOTS = process.env.PACKING_SHOTS;
test.skip(!SHOTS, "set PACKING_SHOTS=<folder> to render the design screenshots");
test.use({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1.5 });

test("ocean 1280: Clothing cube with the Add an item button", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-10-16T12:00:00"));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await signInAsOwner(page);
  await setOwnerAppearance(`e2e-${ownerEmailFor(test.info().project.name)}`, "ocean");
  await page.reload();
  await page.getByRole("link", { name: "Continue packing: San Diego" }).click();
  await expect(page.getByRole("heading", { name: "Packing", level: 1 })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add an item to Clothing" })).toBeVisible();
  mkdirSync(SHOTS!, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/qa-l-ocean-1280.png`, fullPage: true });
});
