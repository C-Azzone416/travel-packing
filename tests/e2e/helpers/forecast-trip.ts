import { expect, type Page } from "@playwright/test";
import { signInAsOwner } from "./auth";
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
  await page.getByRole("link", { name: /Plan a trip/ }).click();
  await expect(page.getByRole("heading", { name: "Confirm the trip" })).toBeVisible();
  await page.getByRole("combobox", { name: "Destination search" }).fill("london");
  await page.getByRole("option", { name: /England/ }).click();
  await page.getByLabel("Leave", { exact: true }).fill(inDays(stays[0].leave));
  await page
    .getByLabel("Return", { exact: true })
    .fill(inDays(stays[0].back ?? stays[0].leave + 3));
  for (let at = 1; at < stays.length; at++) {
    await page.getByRole("button", { name: "+ Add another stop" }).click();
    await page.getByRole("combobox", { name: `Destination search, Stop ${at + 1}` }).fill("london");
    await page.getByRole("option", { name: /Ontario/ }).click();
    await page.getByLabel(`Leave, Stop ${at + 1}`).fill(inDays(stays[at].leave));
  }
  await page.getByRole("button", { name: "Continue to packing preferences" }).click();
  await expect(page.getByRole("heading", { name: "Shape the list" })).toBeVisible();
  await page.getByRole("button", { name: "Get weather" }).click();
  await expect(page.getByText(/Your list uses the weather for/)).toBeVisible();
  await page.getByRole("button", { name: "Save trip" }).click();
  await page
    .getByRole("link", { name: /^(Continue|Keep) packing: London/ })
    .first()
    .click();
  await page.waitForURL(/\/trips\/(?!new)[^/?#]+$/);
}
