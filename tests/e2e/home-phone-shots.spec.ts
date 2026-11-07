import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { ownerEmailFor } from "./helpers/auth";
import { createWeatherTrip } from "./helpers/forecast-trip";
import { planATrip } from "./helpers/menu";
import { planAndCreate } from "./helpers/plan";
import { setOwnerAppearance } from "./helpers/database";
import { FAKE_GEOCODER_PORT, OPEN_METEO_PORT } from "./support/ports";

// Rendered screenshots of the phone Home for design review (#388), Ocean only: 390 Pack, 390 Weather with an ALERT, 390
// Future, and 195 Pack. Run with HOME_SHOTS=<folder>; without it this is skipped. The trips go through the real create flow on
// the second app (the one wired to the fake Open-Meteo): a two-stop London trip in three days with its forecast turned on from
// the Packing page (rain on the second stay), and two later trips for the Future pill.
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
  await page.emulateMedia({ reducedMotion: "reduce" });
  // Signs in, plans the two-stop London trip with its forecast on (rain on the second stay), and opens its Packing page.
  await createWeatherTrip(page, [{ leave: 3, back: 6 }, { leave: 9 }]);
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

  await page.getByRole("tab", { name: /^Weather/ }).click();
  await expect(page.getByRole("tab", { name: "Weather ALERT" })).toBeVisible();
  await shot(page, "home-p-ocean-390-weather-alert");

  await page.getByRole("tab", { name: /^Future/ }).click();
  await expect(page.getByRole("list", { name: "Future trips" })).toBeVisible();
  await shot(page, "home-p-ocean-390-future");

  await page.setViewportSize({ width: 195, height: 900 });
  await page.getByRole("tab", { name: /^Pack/ }).click();
  await shot(page, "home-p-ocean-195-pack");
});
