import { expect, test, type Page } from "@playwright/test";
import { signInAsOwner } from "./helpers/auth";
import { chooseFromMenu } from "./helpers/menu";
import { DEVICE, legacyPackingLayout } from "./helpers/device";
import {
  createButton,
  nextButton,
  pickPlace,
  planToList,
  setDates,
  toList,
  toWhen,
} from "./helpers/plan";

// Trip themes (#48) against the real e2e database: what a trip saves with is what its card shows after a reload.
// The seeded sample trips are San Diego (Beach) and Lisbon (City).
const NOW = new Date("2026-10-16T12:00:00");

async function openDashboard(page: Page) {
  await page.clock.setFixedTime(NOW);
  await signInAsOwner(page);
  await expect(page.getByRole("heading", { name: "San Diego", level: 2 })).toBeVisible();
}

const card = (page: Page, name: string) => page.getByRole("article", { name });
// A Past & archive card still shows the picture.
const cardArtKey = (page: Page, name: string) =>
  card(page, name).locator("[data-art-key]").getAttribute("data-art-key");
// The Field Ledger dashboard (#143) shows no picture on upcoming trips, so read a trip's theme on its own screen.
async function artKey(page: Page, name: string) {
  await page.getByRole("link", { name: new RegExp(`^(Continue|Keep) packing: ${name}$`) }).click();
  const key = await page.locator(".trip-hero [data-art-key]").getAttribute("data-art-key");
  await page.getByRole("link", { name: "All trips" }).click();
  await expect(card(page, name)).toBeVisible();
  return key;
}

/** Plan a trip up to its Review step, where the trip's picture is chosen. */
async function startTrip(page: Page, place = "lon", option = /England/) {
  await page.getByRole("link", { name: /Plan a trip/ }).click();
  await planToList(page, { query: place, option, start: "2026-11-12", end: "2026-11-16" });
  await nextButton(page).click();
  await expect(page.getByRole("heading", { name: "Review", level: 2 })).toBeVisible();
}

// The Field Ledger dashboard (#143) has no picture on the hero or Later journeys, so a trip's theme shows on the
// Past & archive cards and on the trip screen's header.
test("a seeded trip shows its own theme on its Past & archive card", async ({ page }) => {
  await openDashboard(page);
  await page.getByRole("button", { name: /Past & archive/ }).click();
  expect(await cardArtKey(page, "Lisbon")).toBe("city");
  await expect(card(page, "Lisbon").locator("img")).toHaveAttribute("src", "/themes/city.svg");
});

test("the picker is on the Review step, shows all six thumbnails, and Travel is selected", async ({
  page,
}) => {
  await openDashboard(page);
  await page.getByRole("link", { name: /Plan a trip/ }).click();
  await expect(page.getByRole("group", { name: "Trip theme" })).toHaveCount(0);
  await pickPlace(page, "lon", /England/);
  await expect(page.getByRole("group", { name: "Trip theme" })).toHaveCount(0);
  await toWhen(page);
  await setDates(page, "2026-11-12", "2026-11-16");
  await toList(page);
  await expect(page.getByRole("group", { name: "Trip theme" })).toHaveCount(0);
  await nextButton(page).click();
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
  await legacyPackingLayout(page);
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

  await createButton(page).click();
  await expect(card(page, "London")).toBeVisible();
  expect(await artKey(page, "London")).toBe("beach");
  await page.reload();
  await expect(card(page, "London")).toBeVisible();
  expect(await artKey(page, "London")).toBe("beach");
});

test("a trip saved without touching the picker is Travel", async ({ page }) => {
  await legacyPackingLayout(page);
  await openDashboard(page);
  await startTrip(page);
  await createButton(page).click();
  await expect(card(page, "London")).toBeVisible();
  expect(await artKey(page, "London")).toBe("travel");
});

test("a copy starts on the source trip's theme, and changing it does not touch the source", async ({
  page,
}) => {
  await legacyPackingLayout(page);
  await openDashboard(page);
  await chooseFromMenu(page, "San Diego", "Copy trip");
  await planToList(page, {
    query: "lon",
    option: /England/,
    start: "2026-11-12",
    end: "2026-11-16",
  });
  await nextButton(page).click();
  const group = page.getByRole("group", { name: "Trip theme" });
  await expect(group.getByRole("radio", { name: "Beach" })).toBeChecked();
  await group.getByRole("radio", { name: "Home / family" }).check();
  await createButton(page).click();
  await expect(card(page, "London")).toBeVisible();
  expect(await artKey(page, "London")).toBe("home");
  expect(await artKey(page, "San Diego")).toBe("beach");
});

test("the picker works at 320px with nothing scrolling sideways", DEVICE, async ({ page }) => {
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

test("screenshots of the picker and of cards with themes", DEVICE, async ({ page }, testInfo) => {
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
