import { expect, type Page } from "@playwright/test";
import { signInAsOwner } from "./auth";
import { phoneHomeLayout } from "./device";
import { openTripFromHome, planATrip } from "./menu";
import { planToList, reviewAndCreate } from "./plan";

// Short trips (#412): plan a one-place trip through the real flow with FIXED dates, then open its Packing page at a width.
export const NOW = new Date("2026-10-16T12:00:00");
export const DAY = "2026-12-05";
export const NEXT_DAY = "2026-12-06";

/** Plan a one-place trip from the phone Home and open it on its Packing page at the width under test. */
export async function planAndOpen(page: Page, start: string, end: string) {
  await phoneHomeLayout(page);
  await page.clock.setFixedTime(NOW);
  await signInAsOwner(page);
  await planATrip(page);
  await planToList(page, { query: "lon", option: /England/, start, end, mode: "Drive" });
}

export async function create(page: Page, width: number) {
  await reviewAndCreate(page);
  await openTripFromHome(page, "London");
  // The trip is opened from the phone Home (a later trip is under its Future pill); the page then takes the width under test.
  await page.setViewportSize({ width, height: 900 });
  await expect(
    page.getByRole("heading", { name: /^(Packing|Pack mode)$/, level: 1 }),
  ).toBeVisible();
}
