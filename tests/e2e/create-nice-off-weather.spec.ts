import { expect, test, type Page } from "@playwright/test";
import { signInAsOwner } from "./helpers/auth";
import { FAKE_GEOCODER_PORT, OPEN_METEO_PORT } from "./support/ports";

// #202 with weather on (the preview's setup): turning Nice outfits off must still leave a new trip with no nice-attire
// items, whether it is turned off before or after "Get weather", and however weather changes the list. Runs against the
// second app instance (LOCATION_PROVIDER / WEATHER_PROVIDER = open-meteo on a local fake), as weather.spec does.
test.use({ baseURL: `http://localhost:${OPEN_METEO_PORT}` });

const FAKE = `http://127.0.0.1:${FAKE_GEOCODER_PORT}`;
const NICE_IDS = ["nice-top", "nice-bottom", "nice-shoes", "nice-makeup", "nice-undergarments"];
const inDays = (count: number) =>
  new Date(Date.now() + count * 86_400_000).toISOString().slice(0, 10);
const row = (page: Page, id: string) => page.locator(`[data-item-id="${id}"]`);
const niceSwitch = (page: Page) => page.getByRole("switch", { name: "Nice outfits" });

test.beforeEach(async () => {
  await fetch(`${FAKE}/__weather-reset`);
});

async function toShape(page: Page) {
  await signInAsOwner(page);
  await page.getByRole("link", { name: /Plan a trip/ }).click();
  await page.getByRole("combobox", { name: "Destination search" }).fill("london");
  await page.getByRole("option", { name: /England/ }).click();
  await page.getByLabel("Leave", { exact: true }).fill(inDays(3));
  await page.getByLabel("Return", { exact: true }).fill(inDays(6));
  await page.getByRole("button", { name: "Continue to packing preferences" }).click();
  await expect(page.getByRole("heading", { name: "Shape the list" })).toBeVisible();
}

async function saveAndOpen(page: Page) {
  await page.getByRole("button", { name: "Save trip" }).click();
  await page
    .getByRole("link", { name: /^(Continue|Keep) packing: London/ })
    .first()
    .click();
  await expect(page.getByRole("heading", { name: "London", level: 1 })).toBeVisible();
}

async function expectNoNiceAttire(page: Page) {
  // Weather replaces the everyday tops and bottoms with its own clothing lines, so only "the list loaded" is asserted here.
  await expect(row(page, "underwear")).toBeVisible();
  for (const id of NICE_IDS) await expect(row(page, id)).toHaveCount(0);
}

test("weather on, Nice outfits turned off AFTER Get weather: no nice-attire items", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await toShape(page);
  await niceSwitch(page).click(); // a new trip starts with Nice outfits off (#205): turn it on first
  await expect(niceSwitch(page)).toBeChecked();
  await page.getByRole("button", { name: "Get weather" }).click();
  await expect(page.getByText(/Your list uses the weather for/)).toBeVisible();
  await niceSwitch(page).click();
  await expect(niceSwitch(page)).not.toBeChecked();
  await saveAndOpen(page);
  await expectNoNiceAttire(page);
  await page.reload();
  await expectNoNiceAttire(page);
});

test("weather on, Nice outfits turned off BEFORE Get weather: no nice-attire items", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await toShape(page);
  await niceSwitch(page).click(); // on (it starts off, #205)...
  await expect(niceSwitch(page)).toBeChecked();
  await niceSwitch(page).click(); // ...and off again, before Get weather
  await expect(niceSwitch(page)).not.toBeChecked();
  await page.getByRole("button", { name: "Get weather" }).click();
  await expect(page.getByText(/Your list uses the weather for/)).toBeVisible();
  await expect(niceSwitch(page)).not.toBeChecked();
  await saveAndOpen(page);
  await expectNoNiceAttire(page);
  await page.reload();
  await expectNoNiceAttire(page);
});
