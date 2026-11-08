import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { ownerEmailFor, signInAsOwner } from "./helpers/auth";
import { clearOwnerTrips, setOwnerAppearance } from "./helpers/database";

// Rendered screenshots of the no-trip Home for design review (#409), Ocean only: first run and returning at 1280 (laptop) and
// 390 (phone). Run with HOME_SHOTS=<folder>; without it this is skipped. Synthetic data: the seeded sample trips (returning,
// with the clock after both) or none (first run); the home city is unset, so the nudge shows.
const SHOTS = process.env.HOME_SHOTS;
test.skip(!SHOTS, "set HOME_SHOTS=<folder> to render the design screenshots");

const ownerId = () => `e2e-${ownerEmailFor(test.info().project.name)}`;

async function open(page: Page, width: number, firstRun: boolean) {
  await page.setViewportSize({ width, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.clock.setFixedTime(new Date("2026-12-01T12:00:00"));
  await signInAsOwner(page);
  await setOwnerAppearance(ownerId(), "ocean");
  if (firstRun) await clearOwnerTrips(ownerId());
  await page.context().addCookies([{ name: "appearance", value: "ocean", url: page.url() }]);
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: firstRun ? "Where to first?" : "Where to next?" }),
  ).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-scheme", "ocean");
}

async function shot(page: Page, name: string) {
  mkdirSync(SHOTS!, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

test.describe("laptop", () => {
  test.use({ deviceScaleFactor: 1.5 });
  test("home-l-ocean-1280-first-run", async ({ page }) => {
    await open(page, 1280, true);
    await shot(page, "home-l-ocean-1280-first-run");
  });
  test("home-l-ocean-1280-returning", async ({ page }) => {
    await open(page, 1280, false);
    await shot(page, "home-l-ocean-1280-returning");
  });
});

test.describe("phone", () => {
  test.use({ deviceScaleFactor: 2 });
  test("home-p-ocean-390-first-run", async ({ page }) => {
    await open(page, 390, true);
    await shot(page, "home-p-ocean-390-first-run");
  });
  test("home-p-ocean-390-returning", async ({ page }) => {
    await open(page, 390, false);
    await shot(page, "home-p-ocean-390-returning");
  });
});
