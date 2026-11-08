import { expect, test, type Page } from "@playwright/test";
import { signInAsOwner } from "./helpers/auth";
import { DEVICE, phoneHomeLayout } from "./helpers/device";
import { openPastAndArchive } from "./helpers/menu";
import {
  expectPacking,
  packedRibbon,
  readyRibbon,
  reviewSheet,
  packEverythingLeavingBag,
} from "./helpers/packing";

// All packed, "Review your bag" and explicit Ready against a REAL Postgres (#411, replacing the old review page of #17): what the
// screen shows after a reload is what was stored. Each test starts from this project's freshly seeded owner: San Diego partly
// packed and not Ready, Lisbon fully packed and Ready. Every flow runs on the laptop layout (1280 wide) and on the phone layout.
const NOW = new Date("2026-10-16T12:00:00");
const LAYOUTS = [
  { name: "laptop", width: 1280 },
  { name: "phone", width: 700 },
] as const;

for (const layout of LAYOUTS) {
  test.describe(`${layout.name} layout`, () => {
    test.beforeEach(async ({ page }) => {
      if (layout.name === "phone") await phoneHomeLayout(page);
      else if (test.info().project.name === "desktop")
        await page.setViewportSize({ width: layout.width, height: 900 });
    });

    const ready = (page: Page) =>
      reviewSheet(page).getByRole("button", { name: "I’m ready to go" });
    const notReady = (page: Page) => page.getByRole("button", { name: "Mark as not ready" });

    async function openTrip(page: Page, trip: "San Diego" | "Lisbon") {
      await page.clock.setFixedTime(NOW);
      await signInAsOwner(page);
      await expect(page.getByRole("heading", { name: "San Diego", level: 2 })).toBeVisible();
      if (trip === "San Diego") {
        await page.getByRole("link", { name: "Continue packing: San Diego" }).click();
      } else {
        await openPastAndArchive(page);
        await page.getByRole("link", { name: "Review bag: Lisbon" }).click();
      }
      await expectPacking(page);
    }

    test("all packed -> Review bag sheet -> toiletry gate -> I'm ready to go -> Ready ribbon -> Mark as not ready, all stored", async ({
      page,
    }) => {
      // Packing every item one tap at a time is the slow part.
      test.setTimeout(150_000);
      await openTrip(page, "San Diego");
      await expect(packedRibbon(page)).toHaveCount(0);
      await packEverythingLeavingBag(page);

      // All packed is derived and shown, but nothing is Ready by itself.
      await expect(packedRibbon(page)).toContainText("All packed");
      await expect(readyRibbon(page)).toHaveCount(0);
      const banner = page.locator("[data-packed-banner]");
      await expect(banner).toContainText(
        "Everything is in. Review your bag to mark the trip Ready.",
      );
      await banner.getByRole("button", { name: "Review your bag" }).click();
      const sheet = reviewSheet(page);
      await expect(sheet).toBeVisible();

      // The bag gate blocks Ready, says why, and the button stays focusable.
      await expect(ready(page)).toHaveAttribute("aria-disabled", "true");
      await expect(sheet.getByText("Confirm your toiletry bag is in the suitcase.")).toBeVisible();
      await ready(page).focus();
      await expect(ready(page)).toBeFocused();
      await ready(page).click({ force: true });
      await expect(readyRibbon(page)).toHaveCount(0);

      await sheet.getByRole("button", { name: "Put bag in suitcase" }).click();
      await expect(sheet.getByRole("button", { name: "Undo placement" })).toBeVisible();
      await ready(page).click();
      await expect(sheet).toHaveCount(0);
      await expect(readyRibbon(page)).toContainText("Ready");
      await expect(packedRibbon(page)).toHaveCount(0);
      await expect(page.locator("[data-packed-banner]")).toHaveCount(0);
      await expect(notReady(page)).toBeVisible();
      await page.reload();
      await expectPacking(page);
      await expect(readyRibbon(page)).toBeVisible();

      // Mark as not ready keeps every packed quantity, and that is stored too.
      const total = page.getByText(/^(\d+) of \1 in the bag$/);
      const before = await total.innerText();
      await notReady(page).click();
      await expect(page.locator(".toast-region")).toContainText("Progress kept.");
      await expect(readyRibbon(page)).toHaveCount(0);
      await expect(packedRibbon(page)).toContainText("All packed");
      await page.reload();
      await expectPacking(page);
      await expect(readyRibbon(page)).toHaveCount(0);
      await expect(total).toHaveText(before);
    });

    test("unticking an item in the sheet takes a Ready trip out of Ready, visibly, and that is stored", async ({
      page,
    }) => {
      await openTrip(page, "Lisbon");
      await expect(readyRibbon(page)).toBeVisible();
      await page.getByRole("button", { name: "Review bag" }).click();
      const sheet = reviewSheet(page);
      await expect(sheet).toBeVisible();
      await expect(sheet.getByRole("button", { name: "Mark as not ready" })).toBeVisible();
      await sheet.getByRole("checkbox", { checked: true }).first().uncheck();
      await expect(page.getByText(/^No longer ready: an item was unchecked$/)).toBeVisible();
      await expect(ready(page)).toHaveAttribute("aria-disabled", "true");
      await expect(readyRibbon(page)).toHaveCount(0);
      await expect(packedRibbon(page)).toHaveCount(0);
      await sheet.getByRole("button", { name: "Back to packing list" }).click();
      await expect(sheet).toHaveCount(0);
      await page.reload();
      await expectPacking(page);
      await expect(readyRibbon(page)).toHaveCount(0);
    });

    test("?review=1 opens the sheet on load, Back to packing list closes it and the address is plain again", async ({
      page,
    }) => {
      await openTrip(page, "San Diego");
      const path = new URL(page.url()).pathname;
      await page.goto(`${path}?review=1`);
      const sheet = reviewSheet(page);
      await expect(sheet).toBeVisible();
      // Items still to pack: Ready says how many, in text the button is described by.
      const button = ready(page);
      await expect(button).toHaveAttribute("aria-disabled", "true");
      const reason = await button.getAttribute("aria-describedby");
      expect(reason).toBeTruthy();
      await expect(page.locator(`#${reason}`)).toHaveText(/^Check off \d+ more items$/);
      await sheet.getByRole("button", { name: "Back to packing list" }).click();
      await expect(sheet).toHaveCount(0);
      await expect(page).toHaveURL((url) => url.pathname === path && url.search === "");
    });

    test("/trips/<id>/review forwards to Packing with the sheet open", async ({ page }) => {
      await openTrip(page, "San Diego");
      const path = new URL(page.url()).pathname;
      await page.goto(`${path}/review`);
      await expect(reviewSheet(page)).toBeVisible();
      await expectPacking(page);
    });

    test("another owner's trip id is not available", async ({ page }) => {
      await page.clock.setFixedTime(NOW);
      await signInAsOwner(page);
      await page.goto("/trips/00000000-0000-4000-8000-0000000000aa/review");
      await expect(page.getByRole("heading", { name: "That trip isn’t available" })).toBeVisible();
    });
  });
}

test(
  "every control in the sheet is a 44px target on phone, and nothing scrolls sideways",
  DEVICE,
  async ({ page }, testInfo) => {
    await page.clock.setFixedTime(NOW);
    await signInAsOwner(page);
    await page.getByRole("link", { name: "Continue packing: San Diego" }).click();
    await expectPacking(page);
    await page.goto(`${new URL(page.url()).pathname}?review=1`);
    const sheet = reviewSheet(page);
    await expect(sheet).toBeVisible();
    if (testInfo.project.name === "phone") {
      for (const control of [
        sheet.getByRole("checkbox").first(),
        sheet.getByRole("button", { name: "I’m ready to go" }),
        sheet.getByRole("button", { name: "Back to packing list" }),
      ]) {
        const box = (await control.boundingBox())!;
        expect(Math.round(box.height)).toBeGreaterThanOrEqual(44);
      }
    }
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  },
);
