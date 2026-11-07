import { expect, type Page } from "@playwright/test";
import { signInAsOwner } from "./auth";
import { planATrip } from "./menu";
import { pickRoute, reviewAndCreate, setDates, setRouteDates, toList, toWhen } from "./plan";
import { FAKE_GEOCODER_PORT } from "../support/ports";

// Shared by the daily-forecast specs (#303), which run against the second app (WEATHER_PROVIDER = open-meteo on the
// local fake, as weather.spec does). The fake serves "varied" weather (rain every third day, snow every fifth) and
// "scorching" for 3-digit Fahrenheit.
const FAKE = `http://127.0.0.1:${FAKE_GEOCODER_PORT}`;
export const fake = (path: string) => fetch(`${FAKE}${path}`).then((response) => response.json());

export const inDays = (count: number) =>
  new Date(Date.now() + count * 86_400_000).toISOString().slice(0, 10);

export interface Stay {
  leave: number;
  /** For the first stop only: the day the trip ends. Later stops end where the next begins. */
  back?: number;
}

/** Signs in, creates a London trip with weather on (`stays` are day offsets from today), and opens its packing page. */
export async function createWeatherTrip(page: Page, stays: Stay[]) {
  await signInAsOwner(page);
  await planATrip(page);
  await expect(page.getByRole("heading", { name: "Plan a trip", level: 1 })).toBeVisible();
  const stops = stays.map((_, at) =>
    at === 0 ? { query: "london", option: /England/ } : { query: "london", option: /Ontario/ },
  );
  // The first arrival, the first stop's Leave (the day the trip ends for one stop), then each later stop's Leave.
  const dates = [
    inDays(stays[0].leave),
    inDays(stays[0].back ?? stays[0].leave + 3),
    ...stays.slice(1).map((stay) => inDays(stay.leave)),
  ];
  await pickRoute(page, stops);
  await toWhen(page);
  if (stays.length === 1) {
    await setDates(page, dates[0], dates[1]);
  } else {
    await setRouteDates(page, dates);
  }
  await toList(page);
  await page.getByRole("button", { name: "Get weather" }).click();
  await expect(page.getByRole("checkbox", { name: /Weather suggestions/ })).toBeChecked();
  await reviewAndCreate(page);
  await page
    .getByRole("link", { name: /^(Continue packing|Start packing|Open list|Keep packing): London/ })
    .first()
    .click();
  await page.waitForURL(/\/trips\/(?!new)[^/?#]+$/);
}
