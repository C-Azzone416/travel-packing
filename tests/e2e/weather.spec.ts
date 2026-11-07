import { expect, test, type Page } from "@playwright/test";
import { expectAccessible } from "./helpers/a11y";
import { ownerEmailFor, signInAsOwner } from "./helpers/auth";
import { markTripReady } from "./helpers/database";
import { allItemIds, expectItem, expectNoItem, expectPacking } from "./helpers/packing";
import { DEVICE, legacyPackingLayout } from "./helpers/device";
import { planRouteToList, reviewAndCreate } from "./helpers/plan";
import { FAKE_GEOCODER_PORT, OPEN_METEO_PORT } from "./support/ports";

// Home is the laptop suitcase view from 1024px (#387); this spec's subject is the page below it, so it runs there.
test.beforeEach(async ({ page }) => {
  await legacyPackingLayout(page);
});

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
  await page.getByRole("link", { name: /Plan a trip/ }).click();
  await expect(page.getByRole("heading", { name: "Plan a trip", level: 1 })).toBeVisible();
}

const weatherCard = (page: Page) => page.getByRole("checkbox", { name: /Weather suggestions/ });

async function fillTwoStops(page: Page) {
  await planRouteToList(
    page,
    [
      { query: "london", option: /England/ },
      { query: "london", option: /Ontario/ },
    ],
    [inDays(3), inDays(6), inDays(9)],
  );
}

// One city's forecast list is on screen on a phone, one per stop on a laptop: either way the first one is there.
const forecastList = (page: Page) =>
  page.getByRole("list", { name: /^Daily forecast for London/ }).first();
const reviewButton = (page: Page) => page.getByRole("button", { name: /\d+ to review/ }).first();

/** Create the two-stop trip with weather on, save it, and open it. */
async function createWeatherTrip(page: Page) {
  await newTrip(page);
  await fillTwoStops(page);
  await page.getByRole("button", { name: "Get weather" }).click();
  await expect(weatherCard(page)).toBeChecked();
  await reviewAndCreate(page);
  await page
    .getByRole("link", { name: /^(Continue|Keep) packing: London/ })
    .first()
    .click();
  await expectPacking(page);
  await expect(forecastList(page)).toBeVisible();
}

test("opt in while shaping a 2-stop trip: weather-based lines with reasons, saved, and shown per stop", async ({
  page,
}) => {
  await newTrip(page);
  await fillTwoStops(page);
  // Nothing is asked of the weather service until the person says yes.
  await expect(weatherCard(page)).toBeDisabled();
  await expect(
    page.getByText(/Only map coordinates and dates are sent to Open-Meteo/),
  ).toBeVisible();
  expect(await weatherCalls()).toHaveLength(0);

  await page.getByRole("button", { name: "Get weather" }).click();
  await expect(weatherCard(page)).toBeChecked();
  // The card says what the weather added (the forecast rows beside the preview are in the laptop layout; see plan-shots).
  await expect(weatherCard(page)).toHaveAccessibleDescription(/ · \d+ added$/);
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

  await reviewAndCreate(page);
  await page
    .getByRole("link", { name: /^(Continue|Keep) packing: London/ })
    .first()
    .click();
  await expectPacking(page);
  await expect(forecastList(page)).toBeVisible();
  // The first London is hot and dry, in Fahrenheit.
  await expect(forecastList(page)).toContainText("86°");
  await expect(
    page.getByRole("link", { name: "Weather data by Open-Meteo.com" }).first(),
  ).toBeVisible();
  const ids = await allItemIds(page);
  for (const id of [
    "tops-short",
    "tops-long",
    "bottoms-shorts",
    "bottoms-pants",
    "weather-umbrella",
    "weather-rain-jacket",
    "weather-sunscreen",
  ]) {
    expect(ids, id).toContain(id);
  }
  expect(ids).not.toContain("tops");

  await page.reload();
  await expectItem(page, "tops-short");
  await expectItem(page, "weather-rain-jacket");
  // Nothing to review: the saved list is what the weather recommends.
  await expect(page.getByRole("button", { name: /\d+ to review/ })).toHaveCount(0);
});

test("a changed forecast offers itemized changes; accepting some revokes Ready, skipping one sticks across a reload", async ({
  page,
}) => {
  await createWeatherTrip(page);
  // The same trip, a day later, with a dry forecast: a new request and a different answer.
  await fake("/__weather-set?variant=dry");
  await page.getByRole("button", { name: "Edit trip" }).click();
  const sheet = page.getByRole("dialog", { name: "Edit trip" });
  await sheet.getByLabel("Leave", { exact: true }).fill(inDays(4));
  await sheet.getByRole("button", { name: /^Save \d+ changes?$/ }).click();
  await expect(sheet).toHaveCount(0);
  // Editing the route took the trip out of Ready; make it Ready again so the review has something to revoke.
  await markTripReady(`e2e-${ownerEmailFor(test.info().project.name)}`, "London → London");
  await page.reload();
  await expect(page.getByText("You’re ready to go.")).toBeVisible();

  // The dry forecast no longer calls for the hot-weather lines: they come as rows to add or dismiss, inside the forecast card.
  await expect(reviewButton(page)).toBeVisible();
  await reviewButton(page).click();
  const rows = page.getByRole("button", { name: /^(Add|Remove) / });
  const total = await rows.count();
  expect(total).toBeGreaterThan(1);
  // Dismiss the first row: it is suppressed and does not come back.
  await page
    .getByRole("button", { name: /^Dismiss / })
    .first()
    .click();
  await expect(rows).toHaveCount(total - 1);
  // Accepting one revokes Ready.
  await rows.first().click();
  await expect(page.getByText("You’re ready to go.")).toHaveCount(0);

  // The dismissed change does not come back after a reload.
  await page.reload();
  const pending = await page.getByRole("button", { name: /\d+ to review/ }).count();
  if (pending > 0) {
    await reviewButton(page).click();
    expect(await rows.count()).toBeLessThanOrEqual(total - 2);
  }
});

test("opting out sends no weather request and keeps the Everyday tops and bottoms", async ({
  page,
}) => {
  await newTrip(page);
  await fillTwoStops(page);
  await page.getByRole("button", { name: "Not now" }).click();
  await expect(page.getByText("Weather is off.")).toBeVisible();
  await reviewAndCreate(page);
  await page
    .getByRole("link", { name: /^(Continue|Keep) packing: London/ })
    .first()
    .click();
  await expect(page.getByText("Weather is off.")).toBeVisible();
  await expectItem(page, "tops");
  await expectNoItem(page, "tops-short");
  await page.reload();
  await expect(page.getByText("Weather is off.")).toBeVisible();
  expect(await weatherCalls()).toHaveLength(0);
});

test("settings: turning weather on and switching to °C shows Celsius on the trip", async ({
  page,
}) => {
  await createWeatherTrip(page);
  await expect(forecastList(page)).toContainText("86°");
  await page.goto("/settings");
  const celsius = page.getByRole("radio", { name: /°C/ });
  await celsius.check();
  await page.goBack();
  await page.reload();
  await expect(forecastList(page)).toContainText("30°");
});

test("a provider failure shows Unavailable and leaves the list as it was", async ({ page }) => {
  await createWeatherTrip(page);
  const before = (await allItemIds(page)).length;
  await fake("/__weather-set?fail=1");
  // A different range, so the server cannot answer from its memory of the last one.
  await page.getByRole("button", { name: "Edit trip" }).click();
  const sheet = page.getByRole("dialog", { name: "Edit trip" });
  await sheet.getByLabel("Leave", { exact: true }).fill(inDays(5));
  await sheet.getByRole("button", { name: /^Save \d+ changes?$/ }).click();
  await expect(
    page.getByText("We couldn’t reach the weather service. Your list is unchanged."),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /\d+ to review/ })).toHaveCount(0);
  expect((await allItemIds(page)).length).toBe(before);
});

test("a11y: the opt-in prompt, the forecast and its review rows", DEVICE, async ({ page }) => {
  await legacyPackingLayout(page);
  // Creates a trip, saves it, edits its route and runs axe on four screens: more than 30 s on a slow phone runner.
  test.slow();
  await newTrip(page);
  await fillTwoStops(page);
  await expectAccessible(page, "plan: starting list with the weather prompt");
  await page.getByRole("button", { name: "Get weather" }).click();
  await expect(weatherCard(page)).toBeChecked();
  await expectAccessible(page, "plan: starting list with weather");
  await reviewAndCreate(page);
  await page
    .getByRole("link", { name: /^(Continue|Keep) packing: London/ })
    .first()
    .click();
  await expectPacking(page);
  await expect(forecastList(page)).toBeVisible();
  // Colour contrast of the redesigned Packing screen is tracked in #377 and exempted here only.
  await expectAccessible(page, "trip with the forecast", { disable: ["color-contrast"] });
  await fake("/__weather-set?variant=dry");
  await page.getByRole("button", { name: "Edit trip" }).click();
  const sheet = page.getByRole("dialog", { name: "Edit trip" });
  await sheet.getByLabel("Leave", { exact: true }).fill(inDays(4));
  await sheet.getByRole("button", { name: /^Save \d+ changes?$/ }).click();
  // Wait for the review button itself (the weather is fetched again after the route edit), so a failure says what was missing.
  await expect(reviewButton(page)).toBeVisible();
  await reviewButton(page).click();
  await expect(page.getByRole("button", { name: /^Dismiss / }).first()).toBeVisible();
  await expectAccessible(page, "forecast with its review rows", { disable: ["color-contrast"] });
});
