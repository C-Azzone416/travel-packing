import { expect, test, type Page } from "@playwright/test";
import { signInAsOwner } from "./helpers/auth";

// Fixed clock: San Diego is upcoming, Lisbon is past. In-memory data survives client-side
// navigation (links), not a reload, so every step here navigates by clicking.
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
  await page.getByRole("link", { name: /New trip/ }).click();
  await expect(page.getByRole("heading", { name: "Confirm the trip" })).toBeVisible();
  await page.getByRole("combobox", { name: "Destination search" }).fill("lon");
  await page.getByRole("button", { name: "Cancel draft", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Discard this draft?" });
  await expect(dialog.getByRole("button", { name: "Keep editing" })).toBeFocused();
  await dialog.getByRole("button", { name: "Discard" }).click();
  await expect(page.getByRole("heading", { name: "San Diego", level: 2 })).toBeVisible();
  await expect(upcomingCount(page)).toContainText("1");
  await expect(page.getByRole("heading", { name: "London", level: 2 })).toHaveCount(0);
});

test("cancel at step 2 leaves the dashboard unchanged", async ({ page }) => {
  await openDashboard(page);
  await page.getByRole("link", { name: /New trip/ }).click();
  await pick(page, "lon", /England/);
  await setDates(page, "2026-11-12", "2026-11-16");
  await page.getByRole("button", { name: "Continue to packing preferences" }).click();
  await expect(page.getByRole("heading", { name: "Shape the list" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel draft", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Discard" }).click();
  await expect(upcomingCount(page)).toContainText("1");
  await expect(page.getByRole("heading", { name: "London", level: 2 })).toHaveCount(0);
});

test("an untouched draft cancels straight away, with no prompt", async ({ page }) => {
  await openDashboard(page);
  await page.getByRole("link", { name: /New trip/ }).click();
  await page.getByRole("button", { name: "Cancel draft", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "San Diego", level: 2 })).toBeVisible();
});

test("the ambiguous London requires an explicit choice", async ({ page }) => {
  await openDashboard(page);
  await page.getByRole("link", { name: /New trip/ }).click();
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
  await page.getByRole("link", { name: /New trip/ }).click();
  const box = page.getByRole("combobox", { name: "Destination search" });
  await box.fill("london");
  await box.press("ArrowDown");
  await box.press("ArrowDown");
  await box.press("Enter");
  await expect(page.getByText("Destination confirmed")).toBeVisible();
  await expect(page.getByText(/Ontario · Canada/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Confirm the trip" })).toBeVisible();
});

test("an earlier return moves to the departure, with a visible notice", async ({ page }) => {
  await openDashboard(page);
  await page.getByRole("link", { name: /New trip/ }).click();
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
  await page.getByRole("link", { name: /New trip/ }).click();
  await pick(page, "lon", /England/);
  await setDates(page, "2026-11-12", "2026-11-16");
  await page.getByRole("button", { name: "Continue to packing preferences" }).click();
  await expect(page.getByRole("heading", { name: "3 everyday days" })).toBeVisible();

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
});

test("copy: a new trip with clear progress, and the source trip unchanged", async ({ page }) => {
  await openDashboard(page);
  const source = card(page, "San Diego");
  const before = await source.innerText();
  await source.getByRole("link", { name: "Copy trip: San Diego" }).click();

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
});

test("preference switches are keyboard operable with 44px targets, and no step scrolls sideways at 320px", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await openDashboard(page);
  await page.getByRole("link", { name: /New trip/ }).click();
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
});

test("screenshots of the create flow", async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openDashboard(page);
  await page.getByRole("link", { name: /New trip/ }).click();
  await page.getByRole("combobox", { name: "Destination search" }).fill("lon");
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
