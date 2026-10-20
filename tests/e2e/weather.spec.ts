import { expect, test, type Page } from "@playwright/test";
import { expectAccessible } from "./helpers/a11y";
import { ownerEmailFor, signInAsOwner } from "./helpers/auth";
import { markTripReady } from "./helpers/database";
import { DEVICE } from "./helpers/device";
import { FAKE_GEOCODER_PORT, OPEN_METEO_PORT } from "./support/ports";

// Weather for every stop (epic #107, #113). The app runs a second time with LOCATION_PROVIDER=open-meteo and
// WEATHER_PROVIDER=open-meteo, both pointed at one local fake (support/fake-open-meteo.mjs): it serves places with
// coordinates, serves weather, counts every weather request and can change what it answers. No real network is used.
// The fake's first London (England) is hot and dry, its second (Ontario) cool and rainy; "dry" makes both hot and dry.
test.use({ baseURL: `http://localhost:${OPEN_METEO_PORT}` });

const FAKE = `http://127.0.0.1:${FAKE_GEOCODER_PORT}`;
const fake = (path: string) => fetch(`${FAKE}${path}`).then((response) => response.json());
const weatherCalls = async () => (await fake("/__weather-calls")) as unknown[];

// The server picks forecast or typical from its own clock, so trip dates are relative to the real today.
const inDays = (count: number) =>
  new Date(Date.now() + count * 86_400_000).toISOString().slice(0, 10);

test.beforeEach(async () => {
  await fake("/__weather-reset");
});

async function newTrip(page: Page) {
  await signInAsOwner(page);
  await page.getByRole("link", { name: /New trip/ }).click();
  await expect(page.getByRole("heading", { name: "Confirm the trip" })).toBeVisible();
}

async function fillTwoStops(page: Page) {
  await page.getByRole("combobox", { name: "Destination search" }).fill("london");
  await page.getByRole("option", { name: /England/ }).click();
  await page.getByLabel("Leave", { exact: true }).fill(inDays(3));
  await page.getByLabel("Return", { exact: true }).fill(inDays(6));
  await page.getByRole("button", { name: "+ Add another stop" }).click();
  await page.getByRole("combobox", { name: "Destination search, Stop 2" }).fill("london");
  await page.getByRole("option", { name: /Ontario/ }).click();
  await page.getByLabel("Leave, Stop 2").fill(inDays(9));
  await page.getByRole("button", { name: "Continue to packing preferences" }).click();
  await expect(page.getByRole("heading", { name: "Shape the list" })).toBeVisible();
}

const row = (page: Page, id: string) => page.locator(`[data-item-id="${id}"]`);

/** Create the two-stop trip with weather on, save it, and open it. */
async function createWeatherTrip(page: Page) {
  await newTrip(page);
  await fillTwoStops(page);
  await page.getByRole("button", { name: "Get weather" }).click();
  await expect(page.getByText("Weather is shaping this list")).toBeVisible();
  await page.getByRole("button", { name: "Save trip" }).click();
  await page
    .getByRole("link", { name: /^Keep packing/ })
    .first()
    .click();
  await expect(page.locator(".weather-row")).toHaveCount(2);
}

test("opt in while shaping a 2-stop trip: weather-based lines with reasons, saved, and shown per stop", async ({
  page,
}) => {
  await newTrip(page);
  await fillTwoStops(page);
  // Nothing is asked of the weather service until the person says yes.
  await expect(page.getByRole("heading", { name: "Get weather for your stops?" })).toBeVisible();
  expect(await weatherCalls()).toHaveLength(0);
  await expect(page.getByText("Everyday tops")).toBeVisible();

  await page.getByRole("button", { name: "Get weather" }).click();
  await expect(page.getByText("Weather is shaping this list")).toBeVisible();
  for (const name of [
    "Short-sleeve tops",
    "Long-sleeve tops",
    "Shorts",
    "Pants",
    "Compact umbrella",
    "Rain jacket",
    "Sunscreen",
  ]) {
    await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
  }
  await expect(page.getByText(/Rain likely in London/).first()).toBeVisible();
  await expect(page.getByText("Everyday tops")).toHaveCount(0);
  // Only coordinates and dates were sent: no name, no trip, no identity.
  const calls = (await weatherCalls()) as { params: Record<string, string> }[];
  expect(calls.length).toBeGreaterThan(0);
  for (const call of calls) {
    expect(Object.keys(call.params).sort()).toEqual([
      "daily",
      "end_date",
      "latitude",
      "longitude",
      "start_date",
      "timezone",
    ]);
  }

  await page.getByRole("button", { name: "Save trip" }).click();
  await page
    .getByRole("link", { name: /^Keep packing/ })
    .first()
    .click();
  const rows = page.locator(".weather-row");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText("Forecast");
  await expect(rows.nth(0)).toContainText("High 86° · Low 68°");
  await expect(rows.nth(1)).toContainText("High 59° · Low 46°");
  await expect(rows.nth(1)).toContainText("Rain on");
  await expect(page.getByRole("link", { name: "Weather data by Open-Meteo.com" })).toBeVisible();
  for (const id of [
    "tops-short",
    "tops-long",
    "bottoms-shorts",
    "bottoms-pants",
    "weather-umbrella",
    "weather-rain-jacket",
    "weather-sunscreen",
  ]) {
    await expect(row(page, id)).toHaveCount(1);
  }
  await expect(row(page, "tops")).toHaveCount(0);

  await page.reload();
  await expect(row(page, "tops-short")).toHaveCount(1);
  await expect(row(page, "weather-rain-jacket")).toHaveCount(1);
  // Nothing to review: the saved list is what the weather recommends.
  await expect(page.getByText(/weather changes? to review/)).toHaveCount(0);
});

test("a changed forecast offers itemized changes; accepting some revokes Ready, skipping one sticks across a reload", async ({
  page,
}) => {
  await createWeatherTrip(page);
  // The same trip, a day later, with a dry forecast: a new request and a different answer.
  await fake("/__weather-set?variant=dry");
  await page.getByRole("button", { name: "Edit route" }).click();
  const sheet = page.getByRole("dialog", { name: "Edit route" });
  await sheet.getByLabel("Arrive", { exact: true }).fill(inDays(4));
  await sheet.getByRole("button", { name: "Save route" }).click();
  await expect(sheet).toHaveCount(0);
  // Editing the route took the trip out of Ready; make it Ready again so the review has something to revoke.
  await markTripReady(`e2e-${ownerEmailFor(test.info().project.name)}`, "London → London");
  await page.reload();
  await expect(page.getByText("You’re ready to go.")).toBeVisible();

  const banner = page.locator(".weather-review-banner");
  await expect(banner).toContainText(/\d+ weather changes? to review/);
  await banner.getByRole("button", { name: "Review" }).click();
  const review = page.getByRole("dialog", { name: "Weather changes" });
  await expect(
    review.getByText("Based on the weather for your stops. Choose what to add."),
  ).toBeVisible();
  const boxes = review.getByRole("checkbox");
  const total = await boxes.count();
  // The first box is "Select all"; keep the first change and skip the rest by unchecking them.
  expect(total).toBeGreaterThan(2);
  for (let at = 2; at < total; at++) await boxes.nth(at).uncheck();
  await expect(review.getByRole("button", { name: "Add selected (1)" })).toBeVisible();
  await expect(review.getByText(/Adding these takes this trip out of Ready/)).toBeVisible();
  await review.getByRole("button", { name: /^Add selected/ }).click();
  await expect(review).toHaveCount(0);
  await expect(page.getByText("You’re ready to go.")).toHaveCount(0);

  // The unchecked changes are suppressed: they do not come back after a reload.
  await page.reload();
  await expect(row(page, "tops-short")).toHaveCount(1);
  const remaining = await page.locator(".weather-review-banner").count();
  expect(remaining).toBe(0);
});

test("opting out sends no weather request and keeps the Everyday tops and bottoms", async ({
  page,
}) => {
  await newTrip(page);
  await fillTwoStops(page);
  await page.getByRole("button", { name: "Not now" }).click();
  await expect(page.getByText("Weather is off")).toBeVisible();
  await expect(page.getByText("Everyday tops")).toBeVisible();
  await page.getByRole("button", { name: "Save trip" }).click();
  await page
    .getByRole("link", { name: /^Keep packing/ })
    .first()
    .click();
  await expect(page.getByText("Weather is off.")).toBeVisible();
  await expect(row(page, "tops")).toHaveCount(1);
  await expect(row(page, "tops-short")).toHaveCount(0);
  await page.reload();
  await expect(page.getByText("Weather is off.")).toBeVisible();
  expect(await weatherCalls()).toHaveLength(0);
});

test("settings: turning weather on and switching to °C shows Celsius on the trip", async ({
  page,
}) => {
  await createWeatherTrip(page);
  await expect(page.locator(".weather-row").nth(0)).toContainText("High 86° · Low 68°");
  await page.goto("/settings");
  const celsius = page.getByRole("radio", { name: /°C/ });
  await celsius.check();
  await page.goBack();
  await page.reload();
  await expect(page.locator(".weather-row").nth(0)).toContainText("High 30° · Low 20°");
});

test("a provider failure shows Unavailable and leaves the list as it was", async ({ page }) => {
  await createWeatherTrip(page);
  const before = await page.locator("[data-item-id]").count();
  await fake("/__weather-set?fail=1");
  // A different range, so the server cannot answer from its memory of the last one.
  await page.getByRole("button", { name: "Edit route" }).click();
  const sheet = page.getByRole("dialog", { name: "Edit route" });
  await sheet.getByLabel("Arrive", { exact: true }).fill(inDays(5));
  await sheet.getByRole("button", { name: "Save route" }).click();
  await expect(
    page.getByText("We couldn’t reach the weather service. Your list is unchanged."),
  ).toBeVisible();
  await expect(page.locator(".weather-review-banner")).toHaveCount(0);
  expect(await page.locator("[data-item-id]").count()).toBe(before);
});

test(
  "a11y: the opt-in prompt, the weather panel and the review sheet",
  DEVICE,
  async ({ page }) => {
    // Creates a trip, saves it, edits its route and runs axe on four screens: more than 30 s on a slow phone runner.
    test.slow();
    await newTrip(page);
    await fillTwoStops(page);
    await expectAccessible(page, "shape step with the weather prompt");
    await page.getByRole("button", { name: "Get weather" }).click();
    await expect(page.getByText("Weather is shaping this list")).toBeVisible();
    await expectAccessible(page, "shape step with weather");
    await page.getByRole("button", { name: "Save trip" }).click();
    await page
      .getByRole("link", { name: /^Keep packing/ })
      .first()
      .click();
    await expect(page.locator(".weather-row")).toHaveCount(2);
    await expectAccessible(page, "trip with the weather panel");
    await fake("/__weather-set?variant=dry");
    await page.getByRole("button", { name: "Edit route" }).click();
    const sheet = page.getByRole("dialog", { name: "Edit route" });
    await sheet.getByLabel("Arrive", { exact: true }).fill(inDays(4));
    await sheet.getByRole("button", { name: "Save route" }).click();
    await page.locator(".weather-review-banner").getByRole("button", { name: "Review" }).click();
    await expect(page.getByRole("dialog", { name: "Weather changes" })).toBeVisible();
    await expectAccessible(page, "weather review sheet");
  },
);
