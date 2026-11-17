import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { ownerEmailFor, signInAsOwner } from "./helpers/auth";
import { setOwnerHomeCity, setTripDates } from "./helpers/database";

// A trip made before a Home city is saved (#497): the Home draws its destination-only map with a way to set a start; once Home
// is saved the same trip starts from it, on the next load and after navigating back from Settings. Seed trips have no origin.
// Run with HOME_ORIGIN_SHOTS=<folder> to also save the screenshots for design review.
const SHOTS = process.env.HOME_ORIGIN_SHOTS;
const inDays = (count: number) =>
  new Date(Date.now() + count * 86_400_000).toISOString().slice(0, 10);
const ownerId = () => `e2e-${ownerEmailFor(test.info().project.name)}`;
const SEATTLE = {
  id: "us-wa-seattle",
  city: "Seattle",
  region: "Washington",
  country: "United States",
  countryCode: "US",
  label: "Seattle, Washington, United States",
};

async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

test.afterEach(async () => {
  await setOwnerHomeCity(ownerId(), null);
});

for (const width of [1280, 390]) {
  test(`${width}px: a trip with no origin starts from the Home saved later, and keeps its map`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await setOwnerHomeCity(ownerId(), null);
    await signInAsOwner(page);
    await setTripDates(ownerId(), "San Diego", inDays(7), inDays(11));
    await page.goto("/");

    const map = page.getByRole("img", { name: /^Route map: / });
    const unavailable = page.getByRole("img", { name: "Route map unavailable" });
    const nudge = page.getByRole("link", { name: "Set your Home city" });
    await expect(map.first()).toBeVisible();
    await expect(nudge).toHaveAttribute("href", "/settings");
    await expect(unavailable).toHaveCount(0);
    await shot(page, `ocean-${width}-no-home`);

    // Save Home (as Settings would), go to Settings and come back by the navigation, then reload.
    await setOwnerHomeCity(ownerId(), SEATTLE);
    await page.goto("/settings");
    await page.goto("/");
    await expect(map.first()).toBeVisible();
    await expect(unavailable).toHaveCount(0);
    await expect(nudge).toHaveCount(0);
    await expect(map.first()).toHaveAttribute("aria-label", /Seattle/);
    await shot(page, `ocean-${width}-home-saved`);
    await page.reload();
    await expect(map.first()).toBeVisible();
    await expect(unavailable).toHaveCount(0);
  });
}
