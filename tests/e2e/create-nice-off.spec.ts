import { expect, test, type Page } from "@playwright/test";
import { signInAsOwner } from "./helpers/auth";
import { chooseFromMenu } from "./helpers/menu";

// #202: a NEW trip made with Nice outfits turned OFF must have no nice-attire lines, stored and after a reload, however
// the person moves through the create flow after turning it off. The unit tests prove the calculator and createTrip are
// right when they receive "off"; this walks the real screens, the real server action and the real database.
const NOW = new Date("2026-10-16T12:00:00");
const NICE_IDS = ["nice-top", "nice-bottom", "nice-shoes", "nice-makeup", "nice-undergarments"];

const row = (page: Page, id: string) => page.locator(`[data-item-id="${id}"]`);
const niceSwitch = (page: Page) => page.getByRole("switch", { name: "Nice outfits" });

async function toShape(page: Page) {
  await page.getByRole("link", { name: /Plan a trip/ }).click();
  await page.getByRole("combobox", { name: "Destination search" }).fill("lon");
  await page.getByRole("option", { name: /England/ }).click();
  // Four days, no laundry (the default): the trip in the report.
  await page.getByLabel("Leave", { exact: true }).fill("2026-11-12");
  await page.getByLabel("Return", { exact: true }).fill("2026-11-15");
  await page.getByRole("button", { name: "Continue to packing preferences" }).click();
  await expect(page.getByRole("heading", { name: "Shape the list" })).toBeVisible();
}

async function expectNoNiceAttire(page: Page) {
  await expect(row(page, "tops")).toBeVisible();
  for (const id of NICE_IDS) await expect(row(page, id)).toHaveCount(0);
  await expect(page.getByText("Nice-attire top")).toHaveCount(0);
  await expect(page.getByText("Dress shoes")).toHaveCount(0);
}

test("Nice outfits off on a new trip: no nice-attire items after save and reload", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.clock.setFixedTime(NOW);
  await signInAsOwner(page);
  await toShape(page);
  await expect(niceSwitch(page)).not.toBeChecked(); // a new trip starts with it off (#205)
  // Turn it on and off again, the way a person who changes their mind does: the final choice is what is saved.
  await niceSwitch(page).click();
  await expect(niceSwitch(page)).toBeChecked();
  await niceSwitch(page).click();
  await expect(niceSwitch(page)).not.toBeChecked();
  await expect(page.locator("strong", { hasText: "Dress shoes" })).toHaveCount(0);

  // What a person does next: back to the details, then forward again. The choice must survive the round trip.
  await page.getByRole("button", { name: "Edit trip details" }).click();
  await page.getByRole("button", { name: "Continue to packing preferences" }).click();
  await expect(niceSwitch(page)).not.toBeChecked();

  await page.getByRole("button", { name: "Save trip" }).click();
  await expect(page.locator(".toast-region")).toContainText("Trip saved");
  await page.getByRole("link", { name: /(Continue|Keep) packing: London/ }).click();
  await expect(page.getByRole("heading", { name: "London", level: 1 })).toBeVisible();
  await expectNoNiceAttire(page);

  await page.reload();
  await expectNoNiceAttire(page);
});

test("Nice outfits turned on keeps the nice-attire items (the control for the test above)", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.clock.setFixedTime(NOW);
  await signInAsOwner(page);
  await toShape(page);
  await niceSwitch(page).click(); // it starts off (#205), so the person turns it on
  await expect(niceSwitch(page)).toBeChecked();
  await page.getByRole("button", { name: "Save trip" }).click();
  await expect(page.locator(".toast-region")).toContainText("Trip saved");
  await page
    .getByRole("link", { name: /(Continue|Keep) packing: London/ })
    .first()
    .click();
  await expect(row(page, "nice-top")).toBeVisible();
});

test("copy: Nice outfits turned off on the copy's Shape step is what is saved", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.clock.setFixedTime(NOW);
  await signInAsOwner(page);
  await expect(page.getByRole("heading", { name: "San Diego", level: 2 })).toBeVisible();
  await chooseFromMenu(page, "San Diego", "Copy trip");
  await page.getByRole("combobox", { name: "Destination search" }).fill("paris");
  await page.getByRole("option", { name: /Paris/ }).click();
  await page.getByLabel("Leave", { exact: true }).fill("2026-12-04");
  await page.getByLabel("Return", { exact: true }).fill("2026-12-07");
  await page.getByRole("button", { name: "Continue to packing preferences" }).click();
  await expect(page.getByText("Unsaved copy of San Diego")).toBeVisible();
  await expect(niceSwitch(page)).toBeChecked(); // carried over from the source
  await niceSwitch(page).click();
  await expect(niceSwitch(page)).not.toBeChecked();
  await page.getByRole("button", { name: "Save trip" }).click();
  await expect(page.locator(".toast-region")).toContainText("Trip saved");
  await page.getByRole("link", { name: /(Continue|Keep) packing: Paris/ }).click();
  await expect(page.getByRole("heading", { name: "Paris", level: 1 })).toBeVisible();
  await expectNoNiceAttire(page);
  await page.reload();
  await expectNoNiceAttire(page);
});
