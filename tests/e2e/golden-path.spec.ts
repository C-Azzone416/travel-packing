import { expect, test } from "@playwright/test";
import { signInAsOwner } from "./helpers/auth";
import { DEVICE } from "./helpers/device";

// The one end-to-end walk a person actually makes, on a real phone (WebKit, touch): sign in, create a trip, pack it on the trip
// screen, review the bag, say it is Ready, and find it still Ready after a reload. It runs on desktop too (every test does).
// The pieces are tested in depth elsewhere; this proves they connect on the device people use.
const NOW = new Date("2026-10-16T12:00:00");
// The Bathroom items of the default list (they gate the toiletry bag).
const TOILETRIES = [
  "nice-makeup",
  "last-toothbrush",
  "last-toothpaste",
  "last-deodorant",
  "last-contacts",
];

test(
  "golden path: sign in, create a trip, pack it, review the bag, mark it Ready",
  DEVICE,
  async ({ page }) => {
    // A whole trip, packed one tap at a time with each tap stored: far longer than the 30s a single-screen test gets.
    test.setTimeout(60_000);
    await page.clock.setFixedTime(NOW);
    await signInAsOwner(page);
    await expect(page.getByRole("heading", { name: "San Diego", level: 2 })).toBeVisible();

    // Create: pick a destination, set the dates, continue, save.
    await page.getByRole("link", { name: /New trip/ }).click();
    await page.getByRole("combobox", { name: "Destination search" }).fill("lon");
    await page.getByRole("option", { name: /England/ }).click();
    await page.getByLabel("Leave", { exact: true }).fill("2026-11-12");
    await page.getByLabel("Return", { exact: true }).fill("2026-11-16");
    await page.getByRole("button", { name: "Continue to packing preferences" }).click();
    await expect(page.getByRole("heading", { name: "3 days of everyday clothes" })).toBeVisible();
    await page.getByRole("button", { name: "Save trip" }).click();
    await expect(page.locator(".toast-region")).toContainText("Trip saved");
    await expect(page.getByRole("article", { name: "London" })).toBeVisible();

    // Pack: open the trip and check every item. Finishing the Bathroom items opens the bag prompt; confirm it.
    await page.getByRole("link", { name: "Keep packing: London" }).click();
    await expect(page.getByRole("heading", { name: "London", level: 1 })).toBeVisible();
    const row = (id: string) => page.locator(`[data-item-id="${id}"]`);
    const ids = await page
      .locator("[data-item-id]")
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-item-id") as string));
    // Bathroom items go last: checking the last one opens the toiletry bag prompt, which has to be answered before anything else.
    const bathroom = ids.filter((id) => TOILETRIES.includes(id));
    for (const id of [...ids.filter((entry) => !TOILETRIES.includes(entry)), ...bathroom]) {
      const pack = row(id).getByRole("button", { name: /^Pack all / });
      if (await pack.count()) await pack.click();
    }
    const bagPrompt = page.getByRole("dialog", { name: "Toiletry bag in suitcase?" });
    await expect(bagPrompt).toBeVisible();
    await bagPrompt.getByRole("button", { name: "Confirm" }).click();
    await expect(bagPrompt).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Pack all / })).toHaveCount(0);

    // Packing everything only offers the review; it never marks the trip Ready by itself.
    await expect(page.getByText("You’re ready to go.")).toHaveCount(0);
    await page.getByRole("link", { name: "Review your bag" }).click();
    await expect(page.getByRole("heading", { name: "Toiletries · Bathroom" })).toBeVisible();
    await expect(page.getByText("Everything is packed.")).toBeVisible();

    // Ready is explicit, and stored.
    await page.getByRole("button", { name: "I’m ready to go" }).click();
    const notReady = page.getByRole("button", { name: "Mark as not ready" });
    await expect(notReady).toBeVisible();
    await expect(page.locator(".status-pill.ready")).toBeVisible();
    await page.reload();
    await expect(notReady).toBeVisible();
    await expect(page.locator(".status-pill.ready")).toBeVisible();
  },
);
