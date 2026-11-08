import { expect, test } from "@playwright/test";
import { signInAsOwner } from "./helpers/auth";
import {
  allItemIds,
  expectPacking,
  itemRow,
  packedRibbon,
  readyRibbon,
  reviewSheet,
  tick,
} from "./helpers/packing";
import { DEVICE, phoneHomeLayout } from "./helpers/device";
import { planToList, reviewAndCreate } from "./helpers/plan";
import { planATrip, openTripFromHome, futureRow } from "./helpers/menu";

// The one end-to-end walk a person actually makes, on a real phone (WebKit, touch): sign in, create a trip, pack it on the trip
// screen, review the bag, say it is Ready, and find it still Ready after a reload. It runs on desktop too (every test does).
// The pieces are tested in depth elsewhere; this proves they connect on the device people use.
const NOW = new Date("2026-10-16T12:00:00");
// The Bathroom items of the default list (they gate the toiletry bag).
const TOILETRIES = ["last-toothbrush", "last-toothpaste", "last-deodorant", "last-contacts"];

test(
  "golden path: sign in, create a trip, pack it, review the bag, mark it Ready",
  DEVICE,
  async ({ page }) => {
    await phoneHomeLayout(page);
    // A whole trip, packed one tap at a time with each tap stored: far longer than the 30s a single-screen test gets.
    test.setTimeout(60_000);
    await page.clock.setFixedTime(NOW);
    await signInAsOwner(page);
    await expect(page.getByRole("heading", { name: "San Diego", level: 2 })).toBeVisible();

    // Create: pick a destination, set the dates, continue, save.
    await planATrip(page);
    await planToList(page, {
      query: "lon",
      option: /England/,
      start: "2026-11-12",
      end: "2026-11-16",
    });
    await expect(page.getByRole("heading", { name: "Starting list", level: 2 })).toBeVisible();
    await reviewAndCreate(page);
    await expect(page.locator(".toast-region")).toContainText("Trip saved");
    await expect(await futureRow(page, /London/)).toBeVisible();

    // Pack: open the trip and check every item. Finishing the Bathroom items opens the bag prompt; confirm it.
    await openTripFromHome(page, "London");
    await expectPacking(page);
    const ids = await allItemIds(page);
    // Bathroom items go last: checking the last one opens the toiletry bag prompt, which has to be answered before anything else.
    const bathroom = ids.filter((id) => TOILETRIES.includes(id));
    for (const id of [...ids.filter((entry) => !TOILETRIES.includes(entry)), ...bathroom])
      await tick(page, id);
    const bagPrompt = page.getByRole("dialog", { name: "Toiletry bag in suitcase?" });
    await expect(bagPrompt).toBeVisible();
    await bagPrompt.getByRole("button", { name: "Confirm" }).click();
    await expect(bagPrompt).toHaveCount(0);
    await expect(itemRow(page, bathroom[0]).getByRole("checkbox")).toBeChecked();

    // Packing everything only offers the review; it never marks the trip Ready by itself.
    await expect(packedRibbon(page)).toContainText("All packed");
    await expect(readyRibbon(page)).toHaveCount(0);
    await page
      .locator("[data-packed-banner]")
      .getByRole("button", { name: "Review your bag" })
      .click();
    const sheet = reviewSheet(page);
    await expect(sheet.getByRole("heading", { name: "Toiletries", level: 3 })).toBeVisible();

    // Ready is explicit, and stored.
    await sheet.getByRole("button", { name: "I’m ready to go" }).click();
    await expect(sheet).toHaveCount(0);
    const notReady = page.getByRole("button", { name: "Mark as not ready" });
    await expect(notReady).toBeVisible();
    await expect(readyRibbon(page)).toBeVisible();
    await page.reload();
    await expect(notReady).toBeVisible();
    await expect(readyRibbon(page)).toBeVisible();
  },
);
