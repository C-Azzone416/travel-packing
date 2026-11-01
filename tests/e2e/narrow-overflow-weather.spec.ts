import { expect, test, type Page } from "@playwright/test";
import { fake, inDays } from "./helpers/forecast-trip";
import { signInAsOwner } from "./helpers/auth";
import { DEVICE } from "./helpers/device";
import { expectFits } from "./helpers/overflow";
import { OPEN_METEO_PORT } from "./support/ports";

// #332: the dashboard hero's forecast block and the trip page with weather on, against the second app (Open-Meteo on the local
// fake, as hero-daily-forecast.spec does), at 195px and 160px: no sideways scroll, nothing outside the viewport.
test.use({ baseURL: `http://localhost:${OPEN_METEO_PORT}` });

// A place no other spec creates trips for (they all use London): the app caches forecasts per place and day, so a shared place
// would let this spec's "varied" forecast leak into theirs if the spec order ever changed.
async function createSpringfieldTrip(page: Page) {
  await signInAsOwner(page);
  await page.getByRole("link", { name: /Plan a trip/ }).click();
  await expect(page.getByRole("heading", { name: "Confirm the trip" })).toBeVisible();
  await page.getByRole("combobox", { name: "Destination search" }).fill("spring");
  await page.getByRole("option", { name: /Sangamon/ }).click();
  await page.getByLabel("Leave", { exact: true }).fill(inDays(11));
  await page.getByLabel("Return", { exact: true }).fill(inDays(14));
  await page.getByRole("button", { name: "+ Add another stop" }).click();
  await page.getByRole("combobox", { name: "Destination search, Stop 2" }).fill("spring");
  await page.getByRole("option", { name: /Cook County/ }).click();
  await page.getByLabel("Leave, Stop 2").fill(inDays(15));
  await page.getByRole("button", { name: "Continue to packing preferences" }).click();
  await expect(page.getByRole("heading", { name: "Shape the list" })).toBeVisible();
  await page.getByRole("button", { name: "Get weather" }).click();
  await expect(page.getByText(/Your list uses the weather for/)).toBeVisible();
  await page.getByRole("button", { name: "Save trip" }).click();
  await page
    .getByRole("link", { name: /^(Continue|Keep) packing: Springfield/ })
    .first()
    .click();
  await page.waitForURL(/\/trips\/(?!new)[^/?#]+$/);
}

// The fake weather service keeps its variant between tests: leave it as found for the specs that run after this one.
test.afterEach(async () => {
  await fake("/__weather-reset");
});

for (const width of [160, 195, 320] as const) {
  test(
    `the forecast hero and the trip page with weather fit at ${width}px`,
    width === 160 ? {} : DEVICE,
    async ({ page }) => {
      test.setTimeout(120_000);
      await fake("/__weather-reset");
      await fake("/__weather-set?variant=varied");
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.setViewportSize({ width, height: 422 });
      await createSpringfieldTrip(page);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expectFits(page, `trip with forecast at ${width}px`, `${width}-trip-weather`);
      await page.goto("/");
      await expect(page.locator(".hero-forecast")).toBeVisible({ timeout: 30_000 });
      await expectFits(page, `hero forecast at ${width}px`, `${width}-hero-weather`);
    },
  );
}
