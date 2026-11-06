import { expect, test, type Page } from "@playwright/test";
import { ownerEmailFor, signInAsOwner } from "./helpers/auth";
import { readTripTheme } from "./helpers/database";
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

const ownerId = () => `e2e-${ownerEmailFor(test.info().project.name)}`;

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
  expect(await readTripTheme(ownerId(), "Lisbon")).toBe("city");
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
  expect(await readTripTheme(ownerId(), "London")).toBe("travel");
});

test("copying a trip preserves its stored theme without exposing a picker", async ({ page }) => {
  await legacyPackingLayout(page);
  await openDashboard(page);
  const sourceTheme = await readTripTheme(ownerId(), "San Diego");
  expect(sourceTheme).toBe("beach");
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
  expect(await readTripTheme(ownerId(), "London")).toBe(sourceTheme);
  expect(await readTripTheme(ownerId(), "San Diego")).toBe(sourceTheme);
});
