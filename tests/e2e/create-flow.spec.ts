import { expect, test, type Page } from "@playwright/test";
import { ownerEmailFor, signIn, signInAsOwner } from "./helpers/auth";
import { chooseFromMenu } from "./helpers/menu";
import { DEVICE } from "./helpers/device";

// Fixed clock: San Diego is upcoming, Lisbon is past. Trips are stored in the e2e database, so what a test saves
// survives a reload and a new session; each test starts from the freshly seeded state (see signInAsOwner).
const NOW = new Date("2026-10-16T12:00:00");

async function openDashboard(page: Page) {
  await page.clock.setFixedTime(NOW);
  await signInAsOwner(page);
  await expect(page.getByRole("heading", { name: "San Diego", level: 2 })).toBeVisible();
}

const upcomingCount = (page: Page) => page.getByRole("button", { name: /^Upcoming/ });
const card = (page: Page, name: string) => page.getByRole("article", { name });

async function pick(page: Page, text: string, option: RegExp) {
  await page.getByRole("combobox", { name: "Destination search" }).fill(text);
  await page.getByRole("option", { name: option }).click();
}

async function setDates(page: Page, start: string, end: string) {
  await page.getByLabel("Leave", { exact: true }).fill(start);
  await page.getByLabel("Return", { exact: true }).fill(end);
}

test("cancel at step 1 leaves the dashboard unchanged", async ({ page }) => {
  await openDashboard(page);
  await page.getByRole("link", { name: /Plan a trip/ }).click();
  await expect(page.getByRole("heading", { name: "Confirm the trip" })).toBeVisible();
  await page.getByRole("combobox", { name: "Destination search" }).fill("lon");
  await page.getByRole("button", { name: "Cancel draft", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Discard this draft?" });
  await expect(dialog.getByRole("button", { name: "Keep editing" })).toBeFocused();
  await dialog.getByRole("button", { name: "Discard" }).click();
  await expect(page.getByRole("heading", { name: "San Diego", level: 2 })).toBeVisible();
  await expect(upcomingCount(page)).toContainText("1");
  await expect(page.getByRole("heading", { name: "London" })).toHaveCount(0);
});

test("cancel at step 2 leaves the dashboard unchanged", async ({ page }) => {
  await openDashboard(page);
  await page.getByRole("link", { name: /Plan a trip/ }).click();
  await pick(page, "lon", /England/);
  await setDates(page, "2026-11-12", "2026-11-16");
  await page.getByRole("button", { name: "Continue to packing preferences" }).click();
  await expect(page.getByRole("heading", { name: "Shape the list" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel draft", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Discard" }).click();
  await expect(upcomingCount(page)).toContainText("1");
  await expect(page.getByRole("heading", { name: "London" })).toHaveCount(0);
});

test("an untouched draft cancels straight away, with no prompt", async ({ page }) => {
  await openDashboard(page);
  await page.getByRole("link", { name: /Plan a trip/ }).click();
  await page.getByRole("button", { name: "Cancel draft", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "San Diego", level: 2 })).toBeVisible();
});

test("the ambiguous London requires an explicit choice", async ({ page }) => {
  await openDashboard(page);
  await page.getByRole("link", { name: /Plan a trip/ }).click();
  await page.getByRole("combobox", { name: "Destination search" }).fill("london");
  const options = page.getByRole("option");
  await expect(options).toHaveCount(2);
  await expect(options.nth(0)).toContainText("England, United Kingdom");
  await expect(options.nth(1)).toContainText("Ontario, Canada");
  await setDates(page, "2026-11-12", "2026-11-16");
  const next = page.getByRole("button", { name: "Continue to packing preferences" });
  await expect(next).toHaveAttribute("aria-disabled", "true");
  // Playwright treats aria-disabled as not enabled; force the press to prove it only surfaces the reason.
  await next.click({ force: true });
  await expect(page.getByRole("heading", { name: "Confirm the trip" })).toBeVisible();
  await expect(page.getByText("Choose a destination from the list to continue.")).toBeVisible();
  await options.nth(1).click();
  await expect(page.getByText("Destination confirmed")).toBeVisible();
  await next.click();
  await expect(page.getByText(/London, Ontario, Canada/)).toBeVisible();
});

test("keyboard: arrow keys and Enter pick a destination without submitting the form", async ({
  page,
}) => {
  await openDashboard(page);
  await page.getByRole("link", { name: /Plan a trip/ }).click();
  const box = page.getByRole("combobox", { name: "Destination search" });
  await box.fill("london");
  // Results arrive after the search debounce and a server round trip; arrows act on what is listed.
  await expect(page.getByRole("option")).toHaveCount(2);
  await box.press("ArrowDown");
  await box.press("ArrowDown");
  await box.press("Enter");
  await expect(page.getByText("Destination confirmed")).toBeVisible();
  await expect(page.getByText(/Ontario · Canada/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Confirm the trip" })).toBeVisible();
});

test("an earlier return moves to the departure, with a visible notice", async ({ page }) => {
  await openDashboard(page);
  await page.getByRole("link", { name: /Plan a trip/ }).click();
  await setDates(page, "2026-11-12", "2026-11-10");
  await expect(page.getByLabel("Return", { exact: true })).toHaveValue("2026-11-12");
  await expect(page.getByRole("status", { name: "Date notice" })).toHaveText(
    "Return date moved to match your departure.",
  );
});

test("create: pick, set dates, shape, save -> the trip is on the dashboard with nothing packed", async ({
  page,
}) => {
  await openDashboard(page);
  await page.getByRole("link", { name: /Plan a trip/ }).click();
  await pick(page, "lon", /England/);
  await setDates(page, "2026-11-12", "2026-11-16");
  await page.getByRole("button", { name: "Continue to packing preferences" }).click();
  await expect(page.getByRole("heading", { name: "3 days of everyday clothes" })).toBeVisible();

  await page.getByRole("switch", { name: "Laundry access" }).check();
  await expect(page.getByRole("status", { name: "List changes" })).toContainText("Everyday tops");
  await page.getByRole("button", { name: "Save trip" }).click();

  await expect(page.getByRole("heading", { name: "San Diego", level: 2 })).toBeVisible();
  await expect(upcomingCount(page)).toContainText("2");
  await expect(page.locator(".toast-region")).toContainText("Trip saved");
  const london = card(page, "London");
  await expect(london).toBeVisible();
  await expect(london.getByText(/^0 of \d+ packed$/)).toBeVisible();
  await expect(london.getByText("Oct 23")).toHaveCount(0);

  // It is in the database, not just in the page: it survives a reload.
  await page.reload();
  await expect(upcomingCount(page)).toContainText("2");
  await expect(card(page, "London").getByText(/^0 of \d+ packed$/)).toBeVisible();
  await expect(card(page, "San Diego")).toBeVisible();
});

test("create: the saved trip is there in a brand-new session (another device)", async ({
  page,
  browser,
}) => {
  await openDashboard(page);
  await page.getByRole("link", { name: /Plan a trip/ }).click();
  await pick(page, "lon", /England/);
  await setDates(page, "2026-11-12", "2026-11-16");
  await page.getByRole("button", { name: "Continue to packing preferences" }).click();
  await page.getByRole("button", { name: "Save trip" }).click();
  await expect(card(page, "London")).toBeVisible();

  const other = await browser.newContext({ viewport: page.viewportSize() ?? undefined });
  try {
    const device = await other.newPage();
    await device.clock.setFixedTime(NOW);
    await signIn(device, ownerEmailFor(test.info().project.name));
    await expect(device).toHaveURL(/\/$/);
    await expect(upcomingCount(device)).toContainText("2");
    await expect(card(device, "London").getByText(/^0 of \d+ packed$/)).toBeVisible();
  } finally {
    await other.close();
  }
});

test("copy: a new trip with clear progress, and the source trip unchanged", async ({ page }) => {
  await openDashboard(page);
  const source = card(page, "San Diego");
  const before = await source.innerText();
  await chooseFromMenu(page, "San Diego", "Copy trip");

  await expect(page.getByText("Copy of San Diego")).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Destination search" })).toHaveValue("");
  await expect(page.getByLabel("Leave", { exact: true })).toHaveValue("");
  await expect(page.getByText(/The original San Diego trip stays unchanged/)).toBeVisible();
  await pick(page, "paris", /Paris/);
  await setDates(page, "2026-12-04", "2026-12-08");
  await page.getByRole("button", { name: "Continue to packing preferences" }).click();
  await expect(page.getByText("Unsaved copy of San Diego")).toBeVisible();
  await page.getByRole("button", { name: "Save trip" }).click();

  await expect(upcomingCount(page)).toContainText("2");
  await expect(card(page, "Paris").getByText(/^0 of \d+ packed$/)).toBeVisible();
  expect(await card(page, "San Diego").innerText()).toBe(before);

  // The copy is stored: it survives a reload, with nothing packed, and the source is still untouched.
  await page.reload();
  await expect(upcomingCount(page)).toContainText("2");
  await expect(card(page, "Paris").getByText(/^0 of \d+ packed$/)).toBeVisible();
  expect(await card(page, "San Diego").innerText()).toBe(before);
});

test(
  "preference switches are keyboard operable with 44px targets, and no step scrolls sideways at 320px",
  DEVICE,
  async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await openDashboard(page);
    await page.getByRole("link", { name: /Plan a trip/ }).click();
    const overflow = () =>
      page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
    expect(await overflow()).toBeLessThanOrEqual(0);
    await pick(page, "lon", /England/);
    await setDates(page, "2026-11-12", "2026-11-16");
    expect(await overflow()).toBeLessThanOrEqual(0);
    await page.getByRole("button", { name: "Continue to packing preferences" }).click();
    await expect(page.getByRole("heading", { name: "Shape the list" })).toBeVisible();
    expect(await overflow()).toBeLessThanOrEqual(0);

    const laundry = page.getByRole("switch", { name: "Laundry access" });
    await laundry.focus();
    await page.keyboard.press("Space");
    await expect(laundry).toBeChecked();
    for (const control of await page.getByRole("switch").all()) {
      const box = (await control.locator("xpath=..").boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(43.9);
    }
  },
);

test("screenshots of the create flow", DEVICE, async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openDashboard(page);
  await page.getByRole("link", { name: /Plan a trip/ }).click();
  await page.getByRole("combobox", { name: "Destination search" }).fill("lon");
  // Take the picture only once the results are on screen: a full-page WebKit screenshot taken mid-search was the
  // likely cause of the option never appearing (#120).
  await expect(page.getByRole("option", { name: /Ontario/ })).toBeVisible();
  await page.screenshot({
    path: `test-results/screenshots/${testInfo.project.name}-create-step1.png`,
    fullPage: true,
  });
  await page.getByRole("option", { name: /Ontario/ }).click();
  await setDates(page, "2026-11-12", "2026-11-10");
  await page.getByRole("button", { name: "Continue to packing preferences" }).click();
  await expect(page.getByRole("heading", { name: "Shape the list" })).toBeVisible();
  await page.screenshot({
    path: `test-results/screenshots/${testInfo.project.name}-create-step2.png`,
    fullPage: true,
  });
});

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
  await page.getByRole("link", { name: /Plan a trip/ }).click();
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
  await page.getByRole("link", { name: /Plan a trip/ }).click();
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
  await setDates(page, "2026-11-12", "2026-11-16");
  await page
    .getByRole("button", { name: "Continue to packing preferences" })
    .click({ force: true });
  await expect(page.getByRole("heading", { name: "Confirm the trip" })).toBeVisible();
  down = false;
  await alert.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByRole("option")).toHaveCount(1);
  await expect(page.getByRole("option")).toContainText("Lisbon District, Portugal");
});

test("on an unavailable provider, the popular destinations are an explicit alternative", async ({
  page,
}) => {
  await openDashboard(page);
  await page.getByRole("link", { name: /Plan a trip/ }).click();
  await page.route("**/api/locations/search**", (route) =>
    route.fulfill({ status: 502, json: { error: "unavailable" } }),
  );
  await page.getByRole("combobox", { name: "Destination search" }).fill("paris");
  await page.getByRole("button", { name: "Choose from popular destinations" }).click();
  await expect(page.getByText("Showing popular destinations.")).toBeVisible();
  await page.getByRole("option", { name: /Paris/ }).click();
  await expect(page.getByText("Destination confirmed")).toBeVisible();
});
