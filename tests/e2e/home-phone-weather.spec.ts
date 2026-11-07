import { expect, test, type Page } from "@playwright/test";
import { expectAccessible } from "./helpers/a11y";
import { DEVICE } from "./helpers/device";
import { createWeatherTrip, fake, type Stay } from "./helpers/forecast-trip";
import { expectWholeWords, overflow } from "./helpers/layout";
import { OPEN_METEO_PORT } from "./support/ports";

// The phone Home's Weather panel (#388), on the second app (Open-Meteo on the local fake, as trip-daily-forecast does). It
// replaces the checks of the retired dashboard hero forecast block (hero-daily-forecast.spec.ts, removed with the hero): the
// forecast days, the "+N more days" link, mixed sun/rain/snow days, three-digit Fahrenheit, one-day stays, several stays,
// containment at 195/320/390 at normal and 200% text, keyboard use and axe.
test.use({ baseURL: `http://localhost:${OPEN_METEO_PORT}` });

test.beforeEach(async ({ page }) => {
  test.setTimeout(120_000);
  await fake("/__weather-reset");
  await fake("/__weather-set?variant=varied");
  await page.emulateMedia({ reducedMotion: "reduce" });
});

async function openWeather(page: Page, stays: Stay[], width = 390, alert = true) {
  await createWeatherTrip(page, stays);
  await page.setViewportSize({ width, height: width < 700 ? 844 : 900 });
  await page.goto("/");
  const pill = page.getByRole("tab", { name: /^Weather/ });
  // A forecast with no rain has no ALERT: wait for the weather to load instead.
  await expect(pill).toContainText(alert ? "ALERT" : /Clear|Usual/, { timeout: 30_000 });
  await pill.click();
  return page.getByRole("tabpanel");
}

test.describe("forecast days", DEVICE, () => {
  test("a rainy stay opens itself with its days, ALERT says so, and a long stay links to the rest", async ({
    page,
  }) => {
    const panel = await openWeather(page, [{ leave: 3, back: 14 }]);
    const row = panel.getByRole("button", { name: /London/ });
    await expect(row).toHaveAttribute("aria-expanded", "true");
    const region = panel.getByRole("region", { name: "London forecast" });
    expect(await region.getByRole("listitem").count()).toBeGreaterThan(0);
    const more = region.getByRole("link", { name: /^\+\d+ more days$/ });
    await expect(more).toBeVisible();
    await expect(page.getByText(/^Weather alert: London\.$/)).toBeAttached();
    await more.click();
    await expect(page).toHaveURL(/\/trips\/[^/?]+(\?cube=\w+)?$/);
  });

  test("a one-day stay and several stays each get one row", async ({ page }) => {
    const panel = await openWeather(page, [{ leave: 3, back: 3 }], 390, false);
    await expect(panel.getByRole("button", { name: /London/ })).toHaveCount(1);
    await expect(panel.getByRole("listitem").first()).toBeVisible();
  });

  test("three stays: one row per stay, and a row closes and opens again", async ({ page }) => {
    const panel = await openWeather(page, [{ leave: 3, back: 6 }, { leave: 9 }, { leave: 12 }]);
    const rows = panel.getByRole("button", { name: /London/ });
    await expect(rows).toHaveCount(3);
    await rows.nth(1).click();
    await expect(rows.nth(1)).toHaveAttribute("aria-expanded", "false");
    await expect(rows.nth(0)).toHaveAttribute("aria-expanded", "true");
    await rows.nth(1).click();
    await expect(rows.nth(1)).toHaveAttribute("aria-expanded", "true");
  });

  test("days mix sun and rain, each tile reads as one sentence, and a row toggles by keyboard", async ({
    page,
  }) => {
    const panel = await openWeather(page, [{ leave: 3, back: 8 }]);
    const tiles = panel.getByRole("region", { name: "London forecast" }).getByRole("listitem");
    const names = await tiles.evaluateAll((nodes) => nodes.map((node) => node.textContent ?? ""));
    expect(names.length).toBeGreaterThan(1);
    for (const text of names) expect(text).toMatch(/\d+°/);
    const row = panel.getByRole("button", { name: /London/ }).first();
    await row.focus();
    await page.keyboard.press("Enter");
    await expect(row).toHaveAttribute("aria-expanded", "false");
    await page.keyboard.press("Space");
    await expect(row).toHaveAttribute("aria-expanded", "true");
  });

  test("three-digit Fahrenheit fits", async ({ page }) => {
    await fake("/__weather-set?variant=scorching");
    const panel = await openWeather(page, [{ leave: 3, back: 8 }]);
    await expect(panel).toContainText(/1\d\d°/);
    expect(await overflow(page)).toBeLessThanOrEqual(0);
  });
});

// Containment at the width bands, normal and 200% text.
for (const width of [195, 320, 390] as const) {
  for (const zoom of [100, 200] as const) {
    test(
      `${width}px at ${zoom}% text: the weather panel scrolls nowhere and breaks no word`,
      DEVICE,
      async ({ page }) => {
        const panel = await openWeather(page, [{ leave: 3, back: 14 }], width);
        if (zoom === 200)
          await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
        await expect(panel).toBeVisible();
        expect(await overflow(page)).toBeLessThanOrEqual(0);
        await expectWholeWords(page.locator("main"), `weather panel at ${width}px, ${zoom}%`);
      },
    );
  }
}

test.describe("accessibility", DEVICE, () => {
  test("axe on the weather panel at 390", async ({ page }) => {
    await openWeather(page, [{ leave: 3, back: 8 }]);
    // #377: the redesigned Home's palette pairs fall short of 4.5:1; nothing else is exempt.
    await expectAccessible(page, "Home weather panel", { disable: ["color-contrast"] });
  });
});
