import { expect, test, type Page } from "@playwright/test";
import { signInAsOwner } from "./helpers/auth";

// Trip themes (#48) against the real e2e database: what a trip saves with is what its card shows after a reload.
// The seeded sample trips are San Diego (Beach) and Lisbon (City).
const NOW = new Date("2026-10-16T12:00:00");

async function openDashboard(page: Page) {
  await page.clock.setFixedTime(NOW);
  await signInAsOwner(page);
  await expect(page.getByRole("heading", { name: "San Diego", level: 2 })).toBeVisible();
}

const card = (page: Page, name: string) => page.getByRole("article", { name });
const artKey = (page: Page, name: string) =>
  card(page, name).locator("[data-art-key]").getAttribute("data-art-key");

async function startTrip(page: Page, place = "lon", option = /England/) {
  await page.getByRole("link", { name: /New trip/ }).click();
  await page.getByRole("combobox", { name: "Destination search" }).fill(place);
  await page.getByRole("option", { name: option }).click();
  await page.getByLabel("Leave", { exact: true }).fill("2026-11-12");
  await page.getByLabel("Return", { exact: true }).fill("2026-11-16");
}

test("the seeded trips show their own themes on their cards", async ({ page }) => {
  await openDashboard(page);
  expect(await artKey(page, "San Diego")).toBe("beach");
  await expect(card(page, "San Diego").locator("img")).toHaveAttribute("src", "/themes/beach.svg");
  await page.getByRole("button", { name: /Past & archive/ }).click();
  expect(await artKey(page, "Lisbon")).toBe("city");
});

test("the picker appears after the destination, shows all six thumbnails, and Travel is selected", async ({
  page,
}) => {
  await openDashboard(page);
  await page.getByRole("link", { name: /New trip/ }).click();
  await expect(page.getByRole("group", { name: "Trip theme" })).toHaveCount(0);
  await page.getByRole("combobox", { name: "Destination search" }).fill("lon");
  await page.getByRole("option", { name: /England/ }).click();
  const group = page.getByRole("group", { name: "Trip theme" });
  await expect(group).toBeVisible();
  await expect(
    group.getByText("Pick a picture for your trip. You can change it later."),
  ).toBeVisible();
  await expect(group.getByRole("radio")).toHaveCount(6);
  await expect(group.getByRole("radio", { name: "Travel" })).toBeChecked();
  for (const label of [
    "Travel",
    "City",
    "Beach",
    "Mountain / outdoors",
    "Theme park",
    "Home / family",
  ])
    await expect(group.getByText(label, { exact: true })).toBeVisible();
  // Every thumbnail really loaded (a missing file would leave the neutral box).
  const loaded = await group
    .locator("img")
    .evaluateAll((images) => images.map((image) => (image as HTMLImageElement).naturalWidth > 0));
  expect(loaded).toEqual([true, true, true, true, true, true]);
  // Tiles are at least 44px high.
  for (const tile of await group.locator(".theme-tile").all())
    expect((await tile.boundingBox())!.height).toBeGreaterThanOrEqual(44);
});

test("keyboard only: arrow keys pick a theme, the choice is saved, and the card shows it after a reload", async ({
  page,
}) => {
  await openDashboard(page);
  await startTrip(page);
  const group = page.getByRole("group", { name: "Trip theme" });
  await group.getByRole("radio", { name: "Travel" }).focus();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await expect(group.getByRole("radio", { name: "Beach" })).toBeChecked();
  await expect(group.getByRole("radio", { name: "Beach" })).toBeFocused();
  // Selected is visible without colour: the check badge.
  await expect(group.locator('[data-theme-id="beach"] .theme-check')).toBeVisible();
  await expect(group.locator('[data-theme-id="travel"] .theme-check')).toBeHidden();

  await page.getByRole("button", { name: "Continue to packing preferences" }).click();
  await page.getByRole("button", { name: "Save trip" }).click();
  await expect(page.getByRole("heading", { name: "London", level: 2 })).toBeVisible();
  expect(await artKey(page, "London")).toBe("beach");
  await page.reload();
  await expect(page.getByRole("heading", { name: "London", level: 2 })).toBeVisible();
  expect(await artKey(page, "London")).toBe("beach");
});

test("a trip saved without touching the picker is Travel", async ({ page }) => {
  await openDashboard(page);
  await startTrip(page);
  await page.getByRole("button", { name: "Continue to packing preferences" }).click();
  await page.getByRole("button", { name: "Save trip" }).click();
  await expect(page.getByRole("heading", { name: "London", level: 2 })).toBeVisible();
  expect(await artKey(page, "London")).toBe("travel");
});

test("a copy starts on the source trip's theme, and changing it does not touch the source", async ({
  page,
}) => {
  await openDashboard(page);
  await card(page, "San Diego").getByRole("link", { name: "Copy trip: San Diego" }).click();
  await page.getByRole("combobox", { name: "Destination search" }).fill("lon");
  await page.getByRole("option", { name: /England/ }).click();
  await page.getByLabel("Leave", { exact: true }).fill("2026-11-12");
  await page.getByLabel("Return", { exact: true }).fill("2026-11-16");
  const group = page.getByRole("group", { name: "Trip theme" });
  await expect(group.getByRole("radio", { name: "Beach" })).toBeChecked();
  await group.getByRole("radio", { name: "Home / family" }).check();
  await page.getByRole("button", { name: "Continue to packing preferences" }).click();
  await page.getByRole("button", { name: "Save trip" }).click();
  await expect(page.getByRole("heading", { name: "London", level: 2 })).toBeVisible();
  expect(await artKey(page, "London")).toBe("home");
  expect(await artKey(page, "San Diego")).toBe("beach");
});

test("the picker works at 320px with nothing scrolling sideways", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await openDashboard(page);
  await startTrip(page);
  await expect(page.getByRole("group", { name: "Trip theme" })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(0);
});

test("screenshots of the picker and of cards with themes", async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openDashboard(page);
  await page.screenshot({
    path: `test-results/screenshots/${testInfo.project.name}-themes-dashboard.png`,
    fullPage: true,
  });
  await startTrip(page);
  const group = page.getByRole("group", { name: "Trip theme" });
  await group.getByRole("radio", { name: "Theme park" }).check();
  await group.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: `test-results/screenshots/${testInfo.project.name}-themes-picker.png`,
    fullPage: true,
  });
});
