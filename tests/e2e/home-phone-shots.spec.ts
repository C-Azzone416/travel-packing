import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { ownerEmailFor } from "./helpers/auth";
import { tripWithPendingSuggestions } from "./helpers/forecast-trip";
import { planATrip } from "./helpers/menu";
import { planAndCreate } from "./helpers/plan";
import { setOwnerAppearance } from "./helpers/database";
import { FAKE_GEOCODER_PORT, OPEN_METEO_PORT } from "./support/ports";

// Rendered screenshots of the phone Home for design review (#388), Ocean only: 390 Pack (the map-only card), 195 Weather with a
// city that has suggestions to review (ALERT) expanded, and 195 Future with its populated mini tags. Run with HOME_SHOTS=<folder>;
// without it this is skipped. The trip goes through the real create flow on the second app (the one wired to the fake
// Open-Meteo): a London trip made with the forecast off, then turned on from Packing so its rain arrives as suggestions to
// review, and two later trips for the Future pill.
const SHOTS = process.env.HOME_SHOTS;
test.skip(!SHOTS, "set HOME_SHOTS=<folder> to render the design screenshots");
test.use({ baseURL: `http://localhost:${OPEN_METEO_PORT}`, deviceScaleFactor: 2 });

const FAKE = `http://127.0.0.1:${FAKE_GEOCODER_PORT}`;
const inDays = (count: number) =>
  new Date(Date.now() + count * 86_400_000).toISOString().slice(0, 10);

async function shot(page: Page, name: string) {
  mkdirSync(SHOTS!, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

test("home-p-ocean: the phone Home at 390 and 195", async ({ page }) => {
  test.setTimeout(240_000);
  await fetch(`${FAKE}/__weather-reset`);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await tripWithPendingSuggestions(page);
  await setOwnerAppearance(`e2e-${ownerEmailFor(test.info().project.name)}`, "ocean");
  await page
    .context()
    .addCookies([
      { name: "appearance", value: "ocean", url: `http://localhost:${OPEN_METEO_PORT}` },
    ]);

  // Two later trips for the Future pill.
  await page.goto("/");
  await planATrip(page);
  await planAndCreate(page, {
    query: "springfield",
    option: /Sangamon/,
    start: inDays(20),
    end: inDays(23),
  });
  await planATrip(page);
  await planAndCreate(page, {
    query: "london",
    option: /Ontario/,
    start: inDays(40),
    end: inDays(43),
  });

  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto("/");
  await expect(page.getByRole("tablist", { name: "Trip sections" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-scheme", "ocean");
  await shot(page, "home-p-ocean-390-pack");

  await page.setViewportSize({ width: 195, height: 900 });
  await page.getByRole("tab", { name: /^Weather/ }).click();
  await expect(page.getByRole("tab", { name: "Weather ALERT" })).toBeVisible();
  await shot(page, "home-p-ocean-195-weather-alert");

  await page.getByRole("tab", { name: /^Future/ }).click();
  await expect(page.getByRole("list", { name: "Future trips" })).toBeVisible();
  await shot(page, "home-p-ocean-195-future");
});
