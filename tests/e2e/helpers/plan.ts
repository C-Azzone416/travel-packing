import { expect, type Locator, type Page } from "@playwright/test";

// Driving Plan a trip (#390): Where, When, How, Starting list, Review. The helpers keep each spec to what it is about.

export type Mode = "Fly" | "Drive" | "Train or other";

/** The step's Next button (it is also Create trip on the Review step). */
export const nextButton = (page: Page): Locator =>
  page.getByRole("button", { name: "Next", exact: true });

export const createButton = (page: Page): Locator =>
  page.getByRole("button", { name: "Create trip" });

/** Where: search for a place and choose the option. */
export async function pickPlace(
  page: Page,
  text: string,
  option: RegExp,
  label = "Destination search",
): Promise<void> {
  await page.getByRole("combobox", { name: label }).fill(text);
  await page.getByRole("option", { name: option }).first().click();
}

/** When, one stop: the Leave and Return dates. */
export async function setDates(page: Page, start: string, end: string): Promise<void> {
  await page.getByLabel("Leave", { exact: true }).fill(start);
  await page.getByLabel("Return", { exact: true }).fill(end);
}

/** How: choose how you are getting there. */
export async function chooseMode(page: Page, mode: Mode = "Fly"): Promise<void> {
  await page.getByRole("radio", { name: mode }).check();
}

/** Where (one place chosen) to When: press Next. */
export async function toWhen(page: Page): Promise<void> {
  await nextButton(page).click();
  await expect(page.getByLabel("Leave", { exact: true })).toBeVisible();
}

/** When (dates set) to the Starting list, choosing how on the way. */
export async function toList(page: Page, mode: Mode = "Fly"): Promise<void> {
  await nextButton(page).click();
  await chooseMode(page, mode);
  await nextButton(page).click();
  await expect(page.getByRole("heading", { name: "Starting list", level: 2 })).toBeVisible();
}

/** The Starting list to a created trip: Next to Review, then Create trip. */
export async function reviewAndCreate(page: Page, name?: string): Promise<void> {
  await nextButton(page).click();
  if (name !== undefined) await page.getByLabel("Name this trip").fill(name);
  await createButton(page).click();
}

export interface PlanOptions {
  query: string;
  option: RegExp;
  start: string;
  end: string;
  mode?: Mode;
}

/** One place, its dates and how, up to the Starting list. */
export async function planToList(page: Page, options: PlanOptions): Promise<void> {
  await pickPlace(page, options.query, options.option);
  await toWhen(page);
  await setDates(page, options.start, options.end);
  await toList(page, options.mode);
}

/** One place, its dates and how, all the way to Create trip. */
export async function planAndCreate(
  page: Page,
  options: PlanOptions,
  name?: string,
): Promise<void> {
  await planToList(page, options);
  await reviewAndCreate(page, name);
}

export interface RouteStop {
  query: string;
  option: RegExp;
}

/** Where, a route: the first place, then "Add a stop" for each later one (stop N has its own search box). */
export async function pickRoute(page: Page, stops: readonly RouteStop[]): Promise<void> {
  await pickPlace(page, stops[0].query, stops[0].option);
  for (let at = 1; at < stops.length; at += 1) {
    await page.getByRole("button", { name: "Add a stop" }).click();
    await pickPlace(page, stops[at].query, stops[at].option, `Destination search, Stop ${at + 1}`);
  }
}

/** When, a route: the first arrival, then the Leave date of each stop in order (later stops arrive the day the one before leaves). */
export async function setRouteDates(page: Page, dates: readonly string[]): Promise<void> {
  await page.getByLabel("Arrive", { exact: true }).fill(dates[0]);
  await page.getByLabel("Leave", { exact: true }).fill(dates[1]);
  for (let at = 2; at < dates.length; at += 1) {
    await page.getByLabel(`Leave, Stop ${at}`).fill(dates[at]);
  }
}

/** A route and its dates, up to the Starting list. */
export async function planRouteToList(
  page: Page,
  stops: readonly RouteStop[],
  dates: readonly string[],
  mode: Mode = "Fly",
): Promise<void> {
  await pickRoute(page, stops);
  await toWhen(page);
  await expect(page.getByLabel("Arrive", { exact: true })).toBeVisible();
  await setRouteDates(page, dates);
  await toList(page, mode);
}
