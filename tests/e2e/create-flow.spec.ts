import { expect, test, type Page } from "@playwright/test";
import { ownerEmailFor, signIn, signInAsOwner } from "./helpers/auth";
import { readTripTravel, setOwnerHomeCity } from "./helpers/database";
import { chooseFromMenu, futureRow, futureTab, planATrip } from "./helpers/menu";
import { DEVICE, laptopPlanLayout, phoneHomeLayout } from "./helpers/device";
import {
  chooseMode,
  createButton,
  nextButton,
  pickPlace,
  planToList,
  reviewAndCreate,
  setDates,
  toList,
  toWhen,
} from "./helpers/plan";

// Home is the laptop suitcase view from 1024px (#387); this spec's subject is the page below it, so it runs there.
test.beforeEach(async ({ page }) => {
  await phoneHomeLayout(page);
});

// Plan a trip (#390) against the real database. Fixed clock: San Diego is upcoming, Lisbon is past. Trips are stored in the
// e2e database, so what a test saves survives a reload and a new session; each test starts from the freshly seeded state (see
// signInAsOwner).
const NOW = new Date("2026-10-16T12:00:00");

async function openDashboard(page: Page) {
  await page.clock.setFixedTime(NOW);
  await signInAsOwner(page);
  await expect(page.getByRole("heading", { name: "San Diego", level: 2 })).toBeVisible();
}

const ownerId = () => `e2e-${ownerEmailFor(test.info().project.name)}`;
const SEATTLE = {
  id: "us-wa-seattle",
  city: "Seattle",
  region: "Washington",
  country: "United States",
  countryCode: "US",
  label: "Seattle, Washington, United States",
};

// The phone Home (#388): the trips after the next one are under the Future pill, and a trip's own numbers are on its page.
const futureRowNamed = (page: Page, name: string) => futureRow(page, new RegExp(name));
const tag = (page: Page, name: string) => page.getByRole("region", { name });
const plan = (page: Page) => planATrip(page);
const planAtLaptop = async (page: Page) => {
  await plan(page);
  await laptopPlanLayout(page);
};
const aboutItems = (page: Page) =>
  page
    .getByRole("complementary", { name: "Live preview of your trip" })
    .getByText(/^About \d+ items? to start$/);

test("leaving mid-plan saves nothing: the dashboard is unchanged", async ({ page }) => {
  await openDashboard(page);
  await plan(page);
  await expect(page.getByRole("heading", { name: "Plan a trip", level: 1 })).toBeVisible();
  await pickPlace(page, "lon", /England/);
  await toWhen(page);
  await setDates(page, "2026-11-12", "2026-11-16");
  // The close button (phone) or the Trips link (laptop) asks nothing: the plan lives in memory until Create trip.
  await page
    .getByRole("main")
    .getByRole("link", { name: /^(Close and return to trips|Trips)$/ })
    .click();
  await expect(page.getByRole("heading", { name: "San Diego", level: 2 })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(futureTab(page)).toContainText("0 trips");
  await expect(page.getByRole("heading", { name: "London" })).toHaveCount(0);
});

test("the ambiguous London requires an explicit choice", async ({ page }) => {
  await openDashboard(page);
  await planAtLaptop(page);
  await page.getByRole("combobox", { name: "Destination search" }).fill("london");
  const options = page.getByRole("option");
  await expect(options).toHaveCount(2);
  await expect(options.nth(0)).toContainText("England, United Kingdom");
  await expect(options.nth(1)).toContainText("Ontario, Canada");
  const next = nextButton(page);
  await expect(next).toHaveAttribute("aria-disabled", "true");
  // Playwright treats aria-disabled as not enabled; force the press to prove it only surfaces the reason.
  await next.click({ force: true });
  await expect(page.getByRole("region", { name: "Where" })).toHaveAttribute("aria-current", "step");
  await expect(page.getByText("Choose a destination from the list to continue.")).toHaveCount(1);
  await options.nth(1).click();
  await expect(page.getByRole("button", { name: "Change London" })).toBeVisible();
  await next.click();
  await expect(page.getByRole("heading", { name: "When", level: 2 })).toBeFocused();
  await setDates(page, "2026-11-12", "2026-11-16");
  await toList(page);
  await reviewAndCreate(page);
  await phoneHomeLayout(page);
  const london = await futureRowNamed(page, "London");
  await expect(london).toBeVisible();
  // The chosen London is the Ontario one: the Edit trip sheet (from the row's own menu) names the place with its region.
  await page.getByRole("button", { name: "More actions for London" }).click();
  await page.getByRole("menuitem", { name: "Edit trip", exact: true }).click();
  await expect(page.getByRole("dialog").getByText("London · Ontario · Canada")).toBeVisible();
  await page.keyboard.press("Escape");
  await london.click();
  await expect(page.getByRole("heading", { name: "Pack mode", level: 1 })).toBeVisible();
});

test("keyboard: arrow keys and Enter pick a destination without moving to the next step", async ({
  page,
}) => {
  await openDashboard(page);
  await planAtLaptop(page);
  const box = page.getByRole("combobox", { name: "Destination search" });
  await box.fill("london");
  // Results arrive after the search debounce and a server round trip; arrows act on what is listed.
  await expect(page.getByRole("option")).toHaveCount(2);
  await box.press("ArrowDown");
  await box.press("ArrowDown");
  await box.press("Enter");
  await expect(page.getByRole("button", { name: "Change London" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Where" })).toHaveAttribute("aria-current", "step");
  await expect(page.getByLabel("Leave", { exact: true })).toHaveCount(0);
});

test("an earlier return moves to the departure, with a visible notice", async ({ page }) => {
  await openDashboard(page);
  await plan(page);
  await pickPlace(page, "lon", /England/);
  await toWhen(page);
  await setDates(page, "2026-11-12", "2026-11-10");
  await expect(page.getByLabel("Return", { exact: true })).toHaveValue("2026-11-12");
  await expect(page.getByRole("status", { name: "Date notice" })).toHaveText(
    "Return date moved to match your departure.",
  );
});

test("each step moves focus to its heading, and Back returns to the one before", async ({
  page,
}) => {
  await openDashboard(page);
  await plan(page);
  await pickPlace(page, "lon", /England/);
  await nextButton(page).click();
  await expect(page.getByRole("heading", { name: "When", level: 2 })).toBeFocused();
  await setDates(page, "2026-11-12", "2026-11-16");
  await nextButton(page).click();
  await expect(page.getByRole("heading", { name: "How", level: 2 })).toBeFocused();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByRole("heading", { name: "When", level: 2 })).toBeFocused();
  await nextButton(page).click();
  await chooseMode(page, "Drive");
  await nextButton(page).click();
  await expect(page.getByRole("heading", { name: "Starting list", level: 2 })).toBeFocused();
  await nextButton(page).click();
  await expect(page.getByRole("heading", { name: "Review", level: 2 })).toBeFocused();
});

test("create: where, when, how, the list, review -> the trip is on the dashboard with nothing packed, and the preview was right", async ({
  page,
}) => {
  await openDashboard(page);
  await planAtLaptop(page);
  await planToList(page, {
    query: "lon",
    option: /England/,
    start: "2026-11-12",
    end: "2026-11-16",
  });
  const count = async () =>
    Number(/About (\d+) items/.exec((await aboutItems(page).textContent()) ?? "")![1]);
  const without = await count();
  await page.getByRole("checkbox", { name: /I’ll have laundry/ }).check();
  await expect.poll(count).toBeLessThan(without);
  const preview = await count();
  await nextButton(page).click();
  await createButton(page).click();
  await phoneHomeLayout(page);

  await expect(page.getByRole("heading", { name: "San Diego", level: 2 })).toBeVisible();
  await expect(futureTab(page)).toContainText("1 trip");
  await expect(page.locator(".toast-region")).toContainText("Trip saved");
  const london = await futureRowNamed(page, "London");
  await expect(london).toBeVisible();
  await expect(london).toContainText("12 NOV");
  await expect(london).not.toContainText("23 OCT");
  // What the preview said is what was created, none packed (the trip's own page says so).
  await london.click();
  await expect(page.getByRole("button", { name: /^Toiletries/ })).toBeVisible();
  await expect(page.getByText(`0 of ${preview} in the bag`)).toBeVisible();
  await page
    .getByRole("navigation", { name: "Primary navigation" })
    .getByRole("link", { name: "Trips" })
    .click();
  await expect(page.getByRole("tablist", { name: "Trip sections" })).toBeVisible();

  // It is in the database, not just in the page: it survives a reload.
  await page.reload();
  await expect(futureTab(page)).toContainText("1 trip");
  await (await futureRowNamed(page, "London")).click();
  await expect(page.getByText(`0 of ${preview} in the bag`)).toBeVisible();
  await page
    .getByRole("navigation", { name: "Primary navigation" })
    .getByRole("link", { name: "Trips" })
    .click();
  await expect(page.getByRole("tablist", { name: "Trip sections" })).toBeVisible();
});

test("create: the saved trip is there in a brand-new session (another device)", async ({
  page,
  browser,
}) => {
  await openDashboard(page);
  await plan(page);
  await planToList(page, {
    query: "lon",
    option: /England/,
    start: "2026-11-12",
    end: "2026-11-16",
  });
  await reviewAndCreate(page, "Winter in London");
  await expect(await futureRowNamed(page, "London")).toBeVisible();

  const other = await browser.newContext({ viewport: page.viewportSize() ?? undefined });
  try {
    const device = await other.newPage();
    await device.clock.setFixedTime(NOW);
    await signIn(device, ownerEmailFor(test.info().project.name));
    await expect(device).toHaveURL(/\/$/);
    await expect(futureTab(device)).toContainText("1 trip");
    await (await futureRowNamed(device, "London")).click();
    await expect(device.getByText(/^0 of \d+ in the bag$/)).toBeAttached();
  } finally {
    await other.close();
  }
});

test("From is the home city, changeable for this one trip; the trip keeps its origin, how and name", async ({
  page,
}) => {
  await openDashboard(page);
  await setOwnerHomeCity(ownerId(), SEATTLE);
  await plan(page);
  const from = page.getByRole("button", { name: /^From: Seattle \(home\)/ });
  await expect(from).toBeVisible();
  await expect(from).toContainText("· home");
  await pickPlace(page, "lon", /England/);
  await toWhen(page);
  await setDates(page, "2026-11-12", "2026-11-16");
  await toList(page, "Drive");
  await reviewAndCreate(page, "Weekend away");
  await expect(await futureRowNamed(page, "London")).toBeVisible();
  expect(await readTripTravel(ownerId(), "London")).toEqual({
    origin: "Seattle",
    mode: "drive",
    name: "Weekend away",
  });

  // Changing From for a trip changes that trip only: the account's home city is still Seattle on the next plan.
  await plan(page);
  await page.getByRole("button", { name: /^From: Seattle/ }).click();
  await pickPlace(page, "chic", /Illinois/, "From");
  await expect(page.getByRole("button", { name: "From: Chicago. Change" })).toBeVisible();
  await pickPlace(page, "par", /Paris/);
  await toWhen(page);
  await setDates(page, "2026-12-04", "2026-12-08");
  await toList(page, "Train or other");
  await reviewAndCreate(page);
  await expect(await futureRowNamed(page, "Paris")).toBeVisible();
  expect(await readTripTravel(ownerId(), "Paris")).toEqual({
    origin: "Chicago",
    mode: "other",
    name: null,
  });
  await plan(page);
  await expect(page.getByRole("button", { name: /^From: Seattle \(home\)/ })).toBeVisible();
});

test("copy: a new trip from the plan, and the source trip unchanged", async ({ page }) => {
  await openDashboard(page);
  const source = tag(page, "San Diego");
  const before = await source.innerText();
  // The source trip's packed/total quantities (the Pack pill): a copy must not change them.
  const packBefore = await page.getByRole("tab", { name: /^Pack \d+\/\d+$/ }).innerText();
  await chooseFromMenu(page, "San Diego", "Copy trip");

  await expect(page.getByRole("heading", { name: "Plan a trip", level: 1 })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Destination search" })).toHaveValue("");
  await planToList(page, {
    query: "paris",
    option: /Paris/,
    start: "2026-12-04",
    end: "2026-12-08",
  });
  // The copy is the Starting list's own choice: San Diego's preferences, ticked, and the way to untick it.
  await expect(page.getByRole("checkbox", { name: /Copy a past trip/ })).toBeChecked();
  await expect(page.getByRole("radio", { name: /San Diego/ })).toBeChecked();
  await reviewAndCreate(page);

  await expect(futureTab(page)).toContainText("1 trip");
  await (await futureRowNamed(page, "Paris")).click();
  await expect(page.getByText(/^0 of \d+ in the bag$/)).toBeAttached();
  await page
    .getByRole("navigation", { name: "Primary navigation" })
    .getByRole("link", { name: "Trips" })
    .click();
  expect(await tag(page, "San Diego").innerText()).toBe(before);
  expect(await page.getByRole("tab", { name: /^Pack \d+\/\d+$/ }).innerText()).toBe(packBefore);

  // The copy is stored: it survives a reload, with nothing packed, and the source is still untouched.
  await page.reload();
  await expect(futureTab(page)).toContainText("1 trip");
  await (await futureRowNamed(page, "Paris")).click();
  await expect(page.getByText(/^0 of \d+ in the bag$/)).toBeAttached();
  await page
    .getByRole("navigation", { name: "Primary navigation" })
    .getByRole("link", { name: "Trips" })
    .click();
  expect(await tag(page, "San Diego").innerText()).toBe(before);
  expect(await page.getByRole("tab", { name: /^Pack \d+\/\d+$/ }).innerText()).toBe(packBefore);
});

test("Copy a past trip offers the latest past trip, and copies its preferences", async ({
  page,
}) => {
  await openDashboard(page);
  await plan(page);
  await planToList(page, {
    query: "paris",
    option: /Paris/,
    start: "2026-12-04",
    end: "2026-12-08",
  });
  const copy = page.getByRole("checkbox", { name: /Copy a past trip/ });
  await expect(copy).not.toBeChecked();
  await expect(copy).toHaveAccessibleDescription(/^Lisbon · Sep 2026 · \d+ items$/);
  await copy.check();
  await expect(page.getByRole("radio", { name: /Lisbon · Sep 2026/ })).toBeChecked();
  await reviewAndCreate(page);
  await expect(await futureRowNamed(page, "Paris")).toBeVisible();
});

test(
  "no step scrolls sideways at 320px, and the controls are 44px or taller",
  DEVICE,
  async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await openDashboard(page);
    await plan(page);
    const overflow = () =>
      page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
    const tall = async (locator: ReturnType<Page["locator"]>) => {
      const box = (await locator.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(43.9);
    };
    expect(await overflow()).toBeLessThanOrEqual(0);
    await pickPlace(page, "lon", /England/);
    await expect(page.getByRole("button", { name: "Add a stop" })).toBeVisible();
    await tall(page.getByRole("button", { name: "Add a stop" }));
    await tall(nextButton(page));
    expect(await overflow()).toBeLessThanOrEqual(0);
    await toWhen(page);
    await setDates(page, "2026-11-12", "2026-11-16");
    expect(await overflow()).toBeLessThanOrEqual(0);
    await nextButton(page).click();
    for (const mode of await page.getByRole("radio").all()) await tall(mode.locator("xpath=.."));
    expect(await overflow()).toBeLessThanOrEqual(0);
    await chooseMode(page);
    await nextButton(page).click();
    await expect(page.getByRole("heading", { name: "Starting list", level: 2 })).toBeVisible();
    expect(await overflow()).toBeLessThanOrEqual(0);

    const laundry = page.getByRole("checkbox", { name: /I’ll have laundry/ });
    await laundry.focus();
    await page.keyboard.press("Space");
    await expect(laundry).toBeChecked();
    await tall(laundry.locator("xpath=ancestor::label"));
    await nextButton(page).click();
    await expect(page.getByRole("heading", { name: "Review", level: 2 })).toBeVisible();
    expect(await overflow()).toBeLessThanOrEqual(0);
  },
);

test("place search goes only through this app's own endpoint, never to a geocoder", async ({
  page,
}) => {
  const external: string[] = [];
  const searches: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname === "/api/locations/search") searches.push(`${url.origin}${url.pathname}`);
    else if (url.origin !== new URL(page.url()).origin && !url.protocol.startsWith("data"))
      external.push(url.hostname);
  });
  await openDashboard(page);
  await plan(page);
  await page.getByRole("combobox", { name: "Destination search" }).fill("Lon");
  await expect(page.getByRole("option")).toHaveCount(3);
  await expect(page.getByRole("option").nth(0)).toContainText("England, United Kingdom");
  await expect(page.getByRole("option").nth(1)).toContainText("Ontario, Canada");
  expect(searches.length).toBeGreaterThan(0);
  expect(new Set(searches).size).toBe(1);
  expect(external.filter((host) => /open-meteo|geocod/i.test(host))).toEqual([]);
  // This app runs with the curated list, so there is no provider to credit.
  await expect(page.getByText(/Place search by/)).toHaveCount(0);
});

test("shows a clear error with Retry when search is unavailable, never falling back to free text", async ({
  page,
}) => {
  await openDashboard(page);
  await planAtLaptop(page);
  let down = true;
  await page.route("**/api/locations/search**", (route) =>
    down ? route.fulfill({ status: 502, json: { error: "unavailable" } }) : route.continue(),
  );
  await page.getByRole("combobox", { name: "Destination search" }).fill("lisbon");
  const alert = page
    .getByRole("alert")
    .filter({ hasText: "Location search is unavailable right now. Try again." });
  await expect(alert).toBeVisible();
  await expect(page.getByRole("option")).toHaveCount(0);
  await nextButton(page).click({ force: true });
  await expect(page.getByRole("region", { name: "Where" })).toHaveAttribute("aria-current", "step");
  down = false;
  await alert.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByRole("option")).toHaveCount(1);
  await expect(page.getByRole("option")).toContainText("Lisbon District, Portugal");
});

test("on an unavailable provider, the popular destinations are an explicit alternative", async ({
  page,
}) => {
  await openDashboard(page);
  await plan(page);
  await page.route("**/api/locations/search**", (route) =>
    route.fulfill({ status: 502, json: { error: "unavailable" } }),
  );
  await page.getByRole("combobox", { name: "Destination search" }).fill("paris");
  await page.getByRole("button", { name: "Choose from popular destinations" }).click();
  await expect(page.getByText("Showing popular destinations.")).toBeVisible();
  await page.getByRole("option", { name: /Paris/ }).click();
  await expect(page.getByRole("button", { name: "Change Paris" })).toBeVisible();
});
