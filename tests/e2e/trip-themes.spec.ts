import { expect, test, type Page } from "@playwright/test";
import { signInAsOwner } from "./helpers/auth";
import { chooseFromMenu } from "./helpers/menu";
import { legacyPackingLayout } from "./helpers/device";
import { createButton, nextButton, planToList } from "./helpers/plan";

// The trip-theme UI is retired by the Suitcase design. Stored values remain for compatibility until
// the data column is migrated separately: old trips and copied trips keep their value, while a new
// trip keeps the existing default without exposing a picker.
const NOW = new Date("2026-10-16T12:00:00");

async function openDashboard(page: Page) {
  await page.clock.setFixedTime(NOW);
  await signInAsOwner(page);
  await expect(page.getByRole("heading", { name: "San Diego", level: 2 })).toBeVisible();
}

const card = (page: Page, name: string) => page.getByRole("article", { name });

const cardArtKey = (page: Page, name: string) =>
  card(page, name).locator("[data-art-key]").getAttribute("data-art-key");

async function artKey(page: Page, name: string) {
  await page.getByRole("link", { name: new RegExp(`^(Continue|Keep) packing: ${name}$`) }).click();
  const key = await page.locator(".trip-hero [data-art-key]").getAttribute("data-art-key");
  await page.getByRole("link", { name: "All trips" }).click();
  await expect(card(page, name)).toBeVisible();
  return key;
}

async function startTrip(page: Page, place = "lon", option = /England/) {
  await page.getByRole("link", { name: /Plan a trip/ }).click();
  await planToList(page, { query: place, option, start: "2026-11-12", end: "2026-11-16" });
  await nextButton(page).click();
  await expect(page.getByRole("heading", { name: "Review", level: 2 })).toBeVisible();
}

test("a stored trip theme remains readable before the compatibility column is migrated", async ({
  page,
}) => {
  await openDashboard(page);
  await page.getByRole("button", { name: /Past & archive/ }).click();
  expect(await cardArtKey(page, "Lisbon")).toBe("city");
});

test("Plan never exposes a trip-theme picker and a new trip keeps the compatibility default", async ({
  page,
}) => {
  await legacyPackingLayout(page);
  await openDashboard(page);
  await startTrip(page);
  await expect(page.getByRole("group", { name: "Trip theme" })).toHaveCount(0);
  await createButton(page).click();
  await expect(card(page, "London")).toBeVisible();
  expect(await artKey(page, "London")).toBe("travel");
});

test("copying a trip preserves its stored theme without exposing a picker", async ({ page }) => {
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
  await expect(page.getByRole("group", { name: "Trip theme" })).toHaveCount(0);
  await createButton(page).click();
  await expect(card(page, "London")).toBeVisible();
  expect(await artKey(page, "London")).toBe("beach");
  expect(await artKey(page, "San Diego")).toBe("beach");
});
