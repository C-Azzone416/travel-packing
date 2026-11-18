import { expect, test, type Page } from "@playwright/test";
import { DEVICE } from "./helpers/device";
import { createWeatherTrip, fake, type Stay } from "./helpers/forecast-trip";
import { OPEN_METEO_PORT } from "./support/ports";

// The one-trip Weather reference fits above the phone navigation. This uses the Open-Meteo test app so the forecast
// is deterministic, but it tests shell geometry rather than Weather behavior (owned by home-phone-weather.spec.ts).
test.use({ baseURL: `http://localhost:${OPEN_METEO_PORT}` });

test.beforeEach(async ({ page }) => {
  test.setTimeout(120_000);
  await fake("/__weather-reset");
  await fake("/__weather-set?variant=varied");
  await page.emulateMedia({ reducedMotion: "reduce" });
});

async function openWeather(page: Page, stays: Stay[], width: number, height: number) {
  await createWeatherTrip(page, stays);
  await page.setViewportSize({ width, height });
  await page.goto("/");
  await page.evaluate(() => document.fonts.ready);
  const pill = page.getByRole("tab", { name: /^Weather/ });
  await expect(pill).not.toContainText("…", { timeout: 30_000 });
  await pill.click();
  return page.getByRole("tabpanel");
}

test.describe("phone Home shell height", DEVICE, () => {
  test("one-trip Weather fits the iPhone 16 Pro content band without a needless page scroll", async ({
    page,
  }) => {
    const panel = await openWeather(page, [{ leave: 3, back: 14 }], 402, 659);
    await expect(panel.getByRole("link", { name: /^\+\d+ more days$/ })).toBeVisible();
    const geometry = await page.evaluate(() => {
      const nav = document.querySelector<HTMLElement>(".bottom-nav")!;
      const panel = document.querySelector<HTMLElement>('[role="tabpanel"]')!;
      const main = document.querySelector<HTMLElement>("main")!;
      const shell = document.querySelector<HTMLElement>(".app-shell")!;
      const preview = document.querySelector<HTMLElement>(".preview-banner");
      return {
        clientHeight: document.documentElement.clientHeight,
        mainBottom: Math.round(main.getBoundingClientRect().bottom),
        navTop: Math.round(nav.getBoundingClientRect().top),
        panelBottom: Math.round(panel.getBoundingClientRect().bottom),
        scrollHeight: document.documentElement.scrollHeight,
        shellHeight: Math.round(shell.getBoundingClientRect().height),
        previewHeight: Math.round(preview?.getBoundingClientRect().height ?? 0),
      };
    });
    expect(geometry.panelBottom, JSON.stringify(geometry)).toBeLessThanOrEqual(geometry.navTop);
    expect(geometry.mainBottom, JSON.stringify(geometry)).toBeLessThanOrEqual(geometry.navTop);
    expect(geometry.shellHeight, JSON.stringify(geometry)).toBeLessThanOrEqual(
      geometry.clientHeight,
    );
    expect(
      geometry.scrollHeight - geometry.clientHeight,
      JSON.stringify(geometry),
    ).toBeLessThanOrEqual(geometry.previewHeight);
  });
});
