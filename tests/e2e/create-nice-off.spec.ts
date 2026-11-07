import { expect, test, type Page } from "@playwright/test";
import { legacyPackingLayout } from "./helpers/device";
import { signInAsOwner } from "./helpers/auth";
import { chooseFromMenu, planATrip } from "./helpers/menu";
import { nextButton, planAndCreate, planToList, reviewAndCreate } from "./helpers/plan";

// Home is the laptop suitcase view from 1024px (#387); this spec's subject is the page below it, so it runs there.
test.beforeEach(async ({ page }) => {
  await legacyPackingLayout(page);
});

// #202: a NEW trip made with Nice outfits OFF must have no nice-attire lines, stored and after a reload. A new trip starts
// with it off (#205); Plan a trip (#390) has no Nice outfits switch, so a trip gets it only by copying a trip that has it,
// and a person who does not want that unticks "Copy a past trip". This walks the real screens, the real server action and
// the real database.
const NOW = new Date("2026-10-16T12:00:00");
const NICE_IDS = ["nice-top", "nice-bottom", "nice-shoes", "nice-makeup", "nice-undergarments"];

const row = (page: Page, id: string) => page.locator(`[data-item-id="${id}"]`);

async function expectNoNiceAttire(page: Page) {
  await expect(row(page, "tops")).toBeVisible();
  for (const id of NICE_IDS) await expect(row(page, id)).toHaveCount(0);
  await expect(page.getByText("Nice-attire top")).toHaveCount(0);
  await expect(page.getByText("Dress shoes")).toHaveCount(0);
}

test("a new trip starts with Nice outfits off: no nice-attire items after save and reload", async ({
  page,
}) => {
  await legacyPackingLayout(page);
  test.setTimeout(60_000);
  await page.clock.setFixedTime(NOW);
  await signInAsOwner(page);
  await planATrip(page);
  // Four days, no laundry (the default): the trip in the report.
  await planAndCreate(page, {
    query: "lon",
    option: /England/,
    start: "2026-11-12",
    end: "2026-11-15",
  });
  await expect(page.locator(".toast-region")).toContainText("Trip saved");
  await page.getByRole("link", { name: /(Continue|Keep) packing: London/ }).click();
  await expect(page.getByRole("heading", { name: "London", level: 1 })).toBeVisible();
  await expectNoNiceAttire(page);

  await page.reload();
  await expectNoNiceAttire(page);
});

test("copying a trip that has Nice outfits keeps the nice-attire items (the control for the test above)", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.clock.setFixedTime(NOW);
  await signInAsOwner(page);
  await expect(page.getByRole("heading", { name: "San Diego", level: 2 })).toBeVisible();
  await chooseFromMenu(page, "San Diego", "Copy trip");
  await planToList(page, {
    query: "paris",
    option: /Paris/,
    start: "2026-12-04",
    end: "2026-12-07",
  });
  // The copy starts on San Diego's preferences, Nice outfits among them.
  await expect(page.getByRole("checkbox", { name: /Copy a past trip/ })).toBeChecked();
  await reviewAndCreate(page);
  await expect(page.locator(".toast-region")).toContainText("Trip saved");
  await page
    .getByRole("link", { name: /(Continue|Keep) packing: Paris/ })
    .first()
    .click();
  await expect(row(page, "nice-top")).toBeVisible();
});

test("copy: unticking 'Copy a past trip' makes the trip with the defaults, Nice outfits off", async ({
  page,
}) => {
  await legacyPackingLayout(page);
  test.setTimeout(60_000);
  await page.clock.setFixedTime(NOW);
  await signInAsOwner(page);
  await expect(page.getByRole("heading", { name: "San Diego", level: 2 })).toBeVisible();
  await chooseFromMenu(page, "San Diego", "Copy trip");
  await planToList(page, {
    query: "paris",
    option: /Paris/,
    start: "2026-12-04",
    end: "2026-12-07",
  });
  await page.getByRole("checkbox", { name: /Copy a past trip/ }).uncheck();
  await nextButton(page).click();
  await page.getByRole("button", { name: "Create trip" }).click();
  await expect(page.locator(".toast-region")).toContainText("Trip saved");
  await page.getByRole("link", { name: /(Continue|Keep) packing: Paris/ }).click();
  await expect(page.getByRole("heading", { name: "Paris", level: 1 })).toBeVisible();
  await expectNoNiceAttire(page);
  await page.reload();
  await expectNoNiceAttire(page);
});
