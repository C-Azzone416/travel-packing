import { expect, test, type Page } from "@playwright/test";
import { signInAsOwner } from "./helpers/auth";
import { DEVICE } from "./helpers/device";

// "Review your bag" and explicit Ready against a REAL Postgres (#17): what the page shows after a reload is what was
// stored. Each test starts from this project's freshly seeded owner: San Diego partly packed and not Ready, Lisbon
// fully packed and Ready.
const NOW = new Date("2026-10-16T12:00:00");

const ready = (page: Page) => page.getByRole("button", { name: "I’m ready to go" });
const notReady = (page: Page) => page.getByRole("button", { name: "Mark as not ready" });
const unpacked = (page: Page) => page.getByRole("button", { name: /^Mark packed/ });

async function openReview(page: Page, trip: "San Diego" | "Lisbon", id: "san-diego" | "lisbon") {
  await page.clock.setFixedTime(NOW);
  await signInAsOwner(page);
  await expect(page.getByRole("heading", { name: "San Diego", level: 2 })).toBeVisible();
  // The trip's id is stored by the data layer, so reach the review by the link the screens give.
  if (trip === "San Diego") {
    await page.getByRole("link", { name: "Keep packing: San Diego" }).click();
  } else {
    await page.getByRole("button", { name: /Past & archive/ }).click();
    await page.getByRole("link", { name: "Review bag: Lisbon" }).click();
  }
  await expect(page.getByRole("heading", { name: trip, level: 1 })).toBeVisible();
  void id;
}

/** The review is loaded once its sections are there (its title shows while it is still loading). */
const reviewLoaded = (page: Page) =>
  expect(page.getByRole("heading", { name: "Toiletries · Bathroom" })).toBeVisible();

async function goToReview(page: Page) {
  await page.getByRole("link", { name: /^Review bag again$|^Review your bag$/ }).click();
  await reviewLoaded(page);
}

/** Pack every item from the review screen itself, then place the bag. */
async function packEverything(page: Page) {
  const dialog = page.getByRole("dialog", { name: "Toiletry bag in suitcase?" });
  while ((await unpacked(page).count()) > 0) {
    const before = await unpacked(page).count();
    await unpacked(page).first().click();
    await expect.poll(() => unpacked(page).count()).toBeLessThan(before);
    // Checking the last Bathroom item offers bag placement (in the same update); the review does that step below.
    if (await dialog.isVisible()) await dialog.getByRole("button", { name: "Not yet" }).click();
  }
  await page.getByRole("button", { name: "Put bag in suitcase" }).click();
  await dialog.getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByRole("button", { name: "Undo placement" })).toBeVisible();
}

async function openSanDiegoReviewFromTrip(page: Page) {
  await openReview(page, "San Diego", "san-diego");
  // Open the review directly (the "Review your bag" prompt only appears once everything is checked).
  const id = new URL(page.url()).pathname.split("/").pop();
  await page.goto(`/trips/${id}/review`);
  await reviewLoaded(page);
}

test("Ready is explicit: the last item checked does not make it Ready; review, confirm, then it is stored", async ({
  page,
}) => {
  await openSanDiegoReviewFromTrip(page);
  await packEverything(page);
  // Everything is packed and the bag is placed, but the trip is still not Ready until the user says so.
  await expect(page.locator(".status-pill.draft")).toBeVisible();
  await expect(page.getByText("Everything is packed.")).toBeVisible();
  await expect(ready(page)).toHaveAttribute("aria-disabled", "false");

  await ready(page).click();
  await expect(notReady(page)).toBeVisible();
  await expect(notReady(page)).toBeFocused();
  await expect(page.locator(".status-pill.ready")).toBeVisible();
  await page.reload();
  await expect(notReady(page)).toBeVisible();
  await expect(page.locator(".status-pill.ready")).toBeVisible();
});

test("unchecking an item on a Ready trip takes it out of Ready, visibly, and that is stored", async ({
  page,
}) => {
  await openReview(page, "Lisbon", "lisbon");
  await goToReview(page);
  await expect(notReady(page)).toBeVisible();
  const first = page.getByRole("button", { name: /mark unpacked$/ }).first();
  await first.click();
  await expect(page.getByText(/^No longer ready: an item was unchecked$/)).toBeVisible();
  await expect(page.locator(".status-pill.draft")).toBeVisible();
  await expect(ready(page)).toBeVisible();
  await expect(ready(page)).toHaveAttribute("aria-disabled", "true");
  await page.reload();
  await expect(ready(page)).toBeVisible();
  await expect(page.locator(".status-pill.ready")).toHaveCount(0);
});

test("Mark as not ready keeps every packed quantity (checked after a reload)", async ({ page }) => {
  await openReview(page, "Lisbon", "lisbon");
  await goToReview(page);
  const packedBefore = await page.getByRole("button", { name: /^Packed ✓/ }).count();
  expect(packedBefore).toBeGreaterThan(0);
  await notReady(page).click();
  await expect(page.locator(".toast-region").getByText("Progress kept.")).toBeVisible();
  await expect(ready(page)).toBeVisible();
  await expect(ready(page)).toBeFocused();
  await page.reload();
  await expect(ready(page)).toBeVisible();
  await expect(unpacked(page)).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Packed ✓/ })).toHaveCount(packedBefore);
  // It is still fully packed on the trip screen, too.
  await page.getByRole("link", { name: "Back to packing list" }).last().click();
  await expect(page.getByRole("progressbar", { name: "Packing progress" })).toHaveAttribute(
    "aria-valuenow",
    "100",
  );
});

test("the disabled Ready button says why, in text it is described by, and stays focusable", async ({
  page,
}) => {
  await openSanDiegoReviewFromTrip(page);
  const button = ready(page);
  await expect(button).toHaveAttribute("aria-disabled", "true");
  await expect(button).not.toHaveAttribute("disabled", "");
  const reasonId = await button.getAttribute("aria-describedby");
  expect(reasonId).toBeTruthy();
  const count = await unpacked(page).count();
  await expect(page.locator(`#${reasonId}`)).toHaveText(`Check off ${count} more items`);
  await button.focus();
  await expect(button).toBeFocused();
  // Playwright treats aria-disabled as not actionable, so force the press: a real user can still press it.
  await button.click({ force: true });
  await expect(page.locator(".status-pill.ready")).toHaveCount(0);
});

test("a correction keeps focus on the same row", async ({ page }) => {
  await openSanDiegoReviewFromTrip(page);
  const first = unpacked(page).first();
  const row = page.locator("[data-item-id]").filter({ has: first }).first();
  const id = await row.getAttribute("data-item-id");
  await first.click();
  const done = page.locator(`[data-item-id="${id}"]`).getByRole("button", { name: /^Packed ✓/ });
  await expect(done).toBeVisible();
  await expect(done).toBeFocused();
});

test("another owner's trip id is not available", async ({ page }) => {
  await page.clock.setFixedTime(NOW);
  await signInAsOwner(page);
  await page.goto("/trips/00000000-0000-4000-8000-0000000000aa/review");
  await expect(page.getByRole("heading", { name: "That trip isn’t available" })).toBeVisible();
});

// Design's screenshot set for the review screen.
test("screenshots of the review screen", DEVICE, async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const shot = (name: string, fullPage = true) =>
    page.screenshot({
      path: `test-results/screenshots/${testInfo.project.name}-review-${name}.png`,
      fullPage,
    });
  await openSanDiegoReviewFromTrip(page);
  await shot("blocked");
  await packEverything(page);
  await shot("bag-placed");
  await ready(page).click();
  await expect(notReady(page)).toBeVisible();
  await shot("ready");
  await page
    .getByRole("button", { name: /mark unpacked$/ })
    .first()
    .click();
  await expect(page.getByText(/No longer ready/)).toBeVisible();
  await shot("revoked", false);
});

test(
  "every control on the review is a 44px target on phone, and nothing scrolls sideways",
  DEVICE,
  async ({ page }, testInfo) => {
    await openSanDiegoReviewFromTrip(page);
    if (testInfo.project.name === "phone") {
      for (const control of [
        unpacked(page).first(),
        ready(page),
        page.getByRole("link", { name: "Back to packing list" }).last(),
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
