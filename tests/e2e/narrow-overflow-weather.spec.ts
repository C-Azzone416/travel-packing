import { expect, test } from "@playwright/test";
import { createWeatherTrip, fake } from "./helpers/forecast-trip";
import { DEVICE } from "./helpers/device";
import { expectFits } from "./helpers/overflow";
import { OPEN_METEO_PORT } from "./support/ports";

// #332: the dashboard hero's forecast block and the trip page with weather on, against the second app (Open-Meteo on the local
// fake, as hero-daily-forecast.spec does), at 195px and 160px: no sideways scroll, nothing outside the viewport.
test.use({ baseURL: `http://localhost:${OPEN_METEO_PORT}` });

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
      await createWeatherTrip(page, [{ leave: 2, back: 6 }, { leave: 9 }]);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expectFits(page, `trip with forecast at ${width}px`, `${width}-trip-weather`);
      await page.goto("/");
      await expect(page.locator(".hero-forecast")).toBeVisible({ timeout: 30_000 });
      await expectFits(page, `hero forecast at ${width}px`, `${width}-hero-weather`);
    },
  );
}
