import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { ownerEmailFor, signInAsOwner } from "./helpers/auth";
import { setOwnerAppearance, setOwnerWeatherOptIn } from "./helpers/database";

// Rendered screenshots of the Home during the trip and the Welcome home card for design review (#410), Ocean only. Run with
// HOME_SHOTS=<folder>; without it this is skipped. Synthetic data: the seeded San Diego trip (23-27 Oct 2026) with a fixed clock.
const SHOTS = process.env.HOME_SHOTS;
test.skip(!SHOTS, "set HOME_SHOTS=<folder> to render the design screenshots");

const ownerId = () => `e2e-${ownerEmailFor(test.info().project.name)}`;

async function open(page: Page, width: number, now: string, heading: string) {
  await page.setViewportSize({ width, height: 900 });
  // Reduced motion: the Welcome home sticker is solid at once, so the shot is the settled card.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.clock.setFixedTime(new Date(now));
  await signInAsOwner(page);
  await setOwnerAppearance(ownerId(), "ocean");
  await page.context().addCookies([{ name: "appearance", value: "ocean", url: page.url() }]);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: heading })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-scheme", "ocean");
}

async function shot(page: Page, name: string) {
  mkdirSync(SHOTS!, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

test.describe("laptop", () => {
  test.use({ deviceScaleFactor: 1.5 });
  test("home-l-ocean-1280-during", async ({ page }) => {
    await open(page, 1280, "2026-10-25T12:00:00", "San Diego");
    await expect(page.getByText("Day 3 of 5")).toBeVisible();
    await shot(page, "home-l-ocean-1280-during");
  });
  test("home-l-ocean-1280-welcome-home", async ({ page }) => {
    await open(page, 1280, "2026-10-28T12:00:00", "San Diego is inked.");
    await shot(page, "home-l-ocean-1280-welcome-home");
  });
});

test.describe("phone", () => {
  test.use({ deviceScaleFactor: 2 });
  test("home-p-ocean-390-during", async ({ page }) => {
    await open(page, 390, "2026-10-25T12:00:00", "San Diego");
    await expect(page.getByText("Day 3 of 5")).toBeVisible();
    await shot(page, "home-p-ocean-390-during");
  });
  test("home-p-ocean-390-last-day", async ({ page }) => {
    await open(page, 390, "2026-10-27T12:00:00", "San Diego");
    await expect(page.getByText("Last day")).toBeVisible();
    await shot(page, "home-p-ocean-390-last-day");
  });

  test("home-p-ocean-390-during-unavailable", async ({ page }) => {
    // Weather on, the service down: the stay the person is in still says "You're here", in the dashed "not live" row.
    await page.route("**/api/weather**", (route) => route.fulfill({ status: 503, body: "{}" }));
    await open(page, 390, "2026-10-25T12:00:00", "San Diego");
    // Signing in resets the account (weather off), so the opt-in comes after it.
    await setOwnerWeatherOptIn(ownerId(), true);
    await page.reload();
    await page.getByRole("tab", { name: "Weather N/A" }).click();
    await expect(page.getByText("You're here")).toBeVisible();
    await shot(page, "home-p-ocean-390-during-unavailable");
  });
});
