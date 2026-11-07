import { expect, test, type Page } from "@playwright/test";
import { signInAsOwner } from "./helpers/auth";
import { legacyPackingLayout } from "./helpers/device";
import { allItemIds, expectPacking } from "./helpers/packing";
import { planToList, reviewAndCreate } from "./helpers/plan";
import { FAKE_GEOCODER_PORT, OPEN_METEO_PORT } from "./support/ports";

// #202 with weather on (the preview's setup): a new trip has no nice-attire items, whether the weather suggestions are kept
// or left out, and however weather changes the list. Runs against the second app instance (LOCATION_PROVIDER /
// WEATHER_PROVIDER = open-meteo on a local fake), as weather.spec does.
test.use({ baseURL: `http://localhost:${OPEN_METEO_PORT}` });

const FAKE = `http://127.0.0.1:${FAKE_GEOCODER_PORT}`;
const NICE_IDS = ["nice-top", "nice-bottom", "nice-shoes", "nice-makeup", "nice-undergarments"];
const inDays = (count: number) =>
  new Date(Date.now() + count * 86_400_000).toISOString().slice(0, 10);
const weatherCard = (page: Page) => page.getByRole("checkbox", { name: /Weather suggestions/ });

test.beforeEach(async () => {
  await fetch(`${FAKE}/__weather-reset`);
});

async function toList(page: Page) {
  await signInAsOwner(page);
  await page.getByRole("link", { name: /Plan a trip/ }).click();
  await planToList(page, {
    query: "london",
    option: /England/,
    start: inDays(3),
    end: inDays(6),
  });
}

async function createAndOpen(page: Page) {
  await reviewAndCreate(page);
  await page
    .getByRole("link", { name: /^(Continue|Keep) packing: London/ })
    .first()
    .click();
  await expectPacking(page);
}

async function expectNoNiceAttire(page: Page) {
  // Weather replaces the everyday tops and bottoms with its own clothing lines, so only "the list loaded" is asserted here.
  const ids = await allItemIds(page);
  expect(ids).toContain("underwear");
  for (const id of NICE_IDS) expect(ids).not.toContain(id);
}

test("weather on, suggestions kept: no nice-attire items", async ({ page }) => {
  await legacyPackingLayout(page);
  test.setTimeout(60_000);
  await toList(page);
  await page.getByRole("button", { name: "Get weather" }).click();
  await expect(weatherCard(page)).toBeChecked();
  await createAndOpen(page);
  await expectNoNiceAttire(page);
  await page.reload();
  await expectNoNiceAttire(page);
});

test("weather on, suggestions left out: no nice-attire items", async ({ page }) => {
  await legacyPackingLayout(page);
  test.setTimeout(60_000);
  await toList(page);
  await page.getByRole("button", { name: "Get weather" }).click();
  await expect(weatherCard(page)).toBeChecked();
  await weatherCard(page).uncheck();
  await createAndOpen(page);
  await expectNoNiceAttire(page);
  await page.reload();
  await expectNoNiceAttire(page);
});
