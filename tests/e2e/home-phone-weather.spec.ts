import { expect, test, type Page } from "@playwright/test";
import { expectAccessible } from "./helpers/a11y";
import { DEVICE } from "./helpers/device";
import {
  createWeatherTrip,
  daysUntilDayOfMonth,
  fake,
  tripWithPendingSuggestions,
  type Stay,
  type WeatherPlace,
} from "./helpers/forecast-trip";
import {
  enlargeText,
  expectFocusContained,
  expectNoOverlap,
  expectWholeWords,
  overflow,
  overflowOffenders,
} from "./helpers/layout";
import { OPEN_METEO_PORT } from "./support/ports";

// The phone Home's Weather panel (#388), on the second app (Open-Meteo on the local fake). It replaces the checks of the
// retired dashboard hero forecast block (hero-daily-forecast.spec.ts, removed with the hero): the forecast days, the
// "+N more days" link, mixed sun/rain, three-digit Fahrenheit, one-day and several stays, a long cross-month Usual weather
// line, containment at 195/320/390 with large text, keyboard use with the panel populated, forced colours and axe.
// The Weather pill's ALERT means suggestions still to review, so a trip made with weather on (its rain already on the list)
// reads Clear, and one whose forecast was turned on later reads ALERT.
test.use({ baseURL: `http://localhost:${OPEN_METEO_PORT}` });

// Its own place (own rounded coordinates, so own cache keys), never London: see #447.
const CAIRO: WeatherPlace = { query: "cairo", option: /Egypt/, name: "Cairo" };

test.beforeEach(async ({ page }) => {
  test.setTimeout(120_000);
  await fake("/__weather-reset");
  await fake("/__weather-set?variant=varied");
  await page.emulateMedia({ reducedMotion: "reduce" });
});

async function homeAt(page: Page, width: number) {
  await page.setViewportSize({ width, height: width < 700 ? 844 : 900 });
  await page.goto("/");
  await page.evaluate(() => document.fonts.ready);
  const pill = page.getByRole("tab", { name: /^Weather/ });
  // Wait for the weather to load (the pill reads "…" until it has).
  await expect(pill).not.toContainText("…", { timeout: 30_000 });
  return pill;
}

async function openWeather(page: Page, stays: Stay[], width = 390) {
  await createWeatherTrip(page, stays);
  const pill = await homeAt(page, width);
  await pill.click();
  return page.getByRole("tabpanel");
}

test.describe("forecast days", DEVICE, () => {
  test("a rainy stay opens itself with its days, and a long stay links to the rest", async ({
    page,
  }) => {
    const panel = await openWeather(page, [{ leave: 3, back: 14 }]);
    const row = panel.getByRole("button", { name: /London/ });
    await expect(row).toHaveAttribute("aria-expanded", "true");
    const region = panel.getByRole("region", { name: "London forecast" });
    expect(await region.getByRole("listitem").count()).toBeGreaterThan(0);
    const more = region.getByRole("link", { name: /^\+\d+ more days$/ });
    await expect(more).toBeVisible();
    await more.click();
    await expect(page).toHaveURL(/\/trips\/[^/?]+(\?cube=\w+)?$/);
  });

  test("a trip made with weather on has its rain on the list, so the pill is Clear, not ALERT", async ({
    page,
  }) => {
    await openWeather(page, [{ leave: 3, back: 8 }]);
    await expect(page.getByRole("tab", { name: "Weather Clear" })).toBeVisible();
    await expect(page.getByText(/Weather alert/)).toHaveCount(0);
  });

  test("a one-day stay gets a row", async ({ page }) => {
    const panel = await openWeather(page, [{ leave: 3, back: 3 }]);
    await expect(panel.getByRole("button", { name: /London/ })).toHaveCount(1);
    await expect(panel.getByRole("listitem").first()).toBeVisible();
  });

  test("three stays: one row per stay, one city open at a time", async ({ page }) => {
    const panel = await openWeather(page, [{ leave: 3, back: 6 }, { leave: 9 }, { leave: 12 }]);
    const rows = panel.getByRole("button", { name: /London/ });
    await expect(rows).toHaveCount(3);
    const open = () =>
      rows.evaluateAll(
        (nodes) => nodes.filter((node) => node.getAttribute("aria-expanded") === "true").length,
      );
    expect(await open()).toBe(1);
    await rows.nth(2).click();
    await expect(rows.nth(2)).toHaveAttribute("aria-expanded", "true");
    expect(await open()).toBe(1);
    await rows.nth(2).click();
    await expect(rows.nth(2)).toHaveAttribute("aria-expanded", "false");
    expect(await open()).toBe(0);
  });

  test("days mix sun and rain, each tile has its numbers, and a row toggles by keyboard", async ({
    page,
  }) => {
    const panel = await openWeather(page, [{ leave: 3, back: 8 }]);
    const tiles = panel.getByRole("region", { name: "London forecast" }).getByRole("listitem");
    const texts = await tiles.evaluateAll((nodes) => nodes.map((node) => node.textContent ?? ""));
    expect(texts.length).toBeGreaterThan(1);
    for (const text of texts) expect(text).toMatch(/\d+°/);
    const row = panel.getByRole("button", { name: /London/ }).first();
    await row.focus();
    await page.keyboard.press("Enter");
    await expect(row).toHaveAttribute("aria-expanded", "false");
    await page.keyboard.press("Space");
    await expect(row).toHaveAttribute("aria-expanded", "true");
  });
});

test.describe("suggestions to review", DEVICE, () => {
  test("ALERT names the city with changes to review, is announced, and the panel says how many", async ({
    page,
  }) => {
    await tripWithPendingSuggestions(page);
    await homeAt(page, 390);
    await expect(page.getByRole("tab", { name: "Weather ALERT" })).toBeVisible();
    await expect(
      page.getByText(/^Weather alert: suggestions to review for London\.$/),
    ).toBeAttached();
    await page.getByRole("tab", { name: "Weather ALERT" }).click();
    await expect(
      page
        .getByRole("tabpanel")
        .getByText(/\d+ to review/)
        .first(),
    ).toBeVisible();
  });
});

// Loaded Home weather at the narrow widths with LARGE text (every font size doubled): a forecast with three-digit
// Fahrenheit and a typical stretch, and a far trip's long cross-month Usual weather line. Cairo has its own cache keys.
for (const width of [195, 320] as const) {
  test(
    `${width}px, large text: a loaded forecast (three-digit temperatures, a long title) stays inside, whole and clear`,
    DEVICE,
    async ({ page }) => {
      await fake("/__weather-set?variant=scorching");
      const title = "Big trip to sunny Cairo town";
      // 13 days out, back after the month turns: forecast days, then a typical stretch across the month end.
      const dayAt = (offset: number) => new Date(Date.now() + offset * 86_400_000).getUTCDate();
      let boundary = 18;
      while (dayAt(boundary) !== 1) boundary += 1;
      await createWeatherTrip(page, [{ leave: 13, back: boundary + 1 }], CAIRO, title);
      const pill = await homeAt(page, width);
      await pill.click();
      const panel = page.getByRole("tabpanel");
      await expect(panel).toContainText(/1\d\d°/);
      const factor = await enlargeText(page, panel.getByRole("button", { name: /Cairo/ }).first());
      expect(factor, "text really is twice as large").toBeGreaterThanOrEqual(1.99);
      expect(await overflow(page), (await overflowOffenders(page)).join(" | ")).toBeLessThanOrEqual(
        0,
      );
      await expectWholeWords(page.locator("main"), `loaded forecast at ${width}px`);
      await expectNoOverlap(page, `loaded forecast at ${width}px`);
      await expectFocusContained(page, width, `loaded forecast at ${width}px`);
      await expect(page.getByRole("heading", { name: title, level: 2 })).toBeAttached();
    },
  );

  test(
    `${width}px, large text: a far trip's cross-month Usual weather line stays inside and whole`,
    DEVICE,
    async ({ page }) => {
      await fake("/__weather-set?variant=scorching");
      const start = daysUntilDayOfMonth(27, 30);
      await createWeatherTrip(page, [{ leave: start, back: start + 7 }], CAIRO);
      const pill = await homeAt(page, width);
      await pill.click();
      const panel = page.getByRole("tabpanel");
      const usual = panel.getByTestId("usual-weather");
      await expect(usual).toBeVisible();
      await expect(usual).toContainText(
        /[A-Z][a-z]{2} \d+ – [A-Z][a-z]{2} \d+|[A-Z][a-z]{2} \d+–[A-Z][a-z]{2} \d+/,
      );
      await expect(usual).toContainText(/1\d\d°/);
      const factor = await enlargeText(page, usual.locator("strong").first());
      expect(factor, "text really is twice as large").toBeGreaterThanOrEqual(1.99);
      expect(await overflow(page)).toBeLessThanOrEqual(0);
      await expectWholeWords(page.locator("main"), `usual weather at ${width}px`);
      await expectNoOverlap(page, `usual weather at ${width}px`);
      await expectFocusContained(page, width, `usual weather at ${width}px`);
    },
  );
}

// Containment at the width bands, normal text, with a forecast loaded.
for (const width of [195, 320, 390] as const) {
  test(
    `${width}px: the loaded weather panel scrolls nowhere and breaks no word`,
    DEVICE,
    async ({ page }) => {
      const panel = await openWeather(page, [{ leave: 3, back: 14 }], width);
      await expect(panel).toBeVisible();
      expect(await overflow(page)).toBeLessThanOrEqual(0);
      await expectWholeWords(page.locator("main"), `weather panel at ${width}px`);
      await expectNoOverlap(page, `weather panel at ${width}px`);
    },
  );
}

// Forecast and usual weather differ by words and by shape (a solid city card against a dashed usual row), not colour alone,
// and both survive forced colours.
test.describe("forced colours", DEVICE, () => {
  test("a forecast card is solid and a usual row is dashed, each with its own words, in forced colours", async ({
    page,
  }) => {
    await createWeatherTrip(page, [{ leave: 3, back: 8 }]);
    const pill = await homeAt(page, 390);
    await pill.click();
    await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
    const card = page
      .getByRole("tabpanel")
      .getByRole("button", { name: /London/ })
      .first();
    await expect(card).toBeVisible();
    const cityRow = page.getByRole("tabpanel").getByRole("listitem").first();
    expect(await cityRow.evaluate((el) => getComputedStyle(el).borderTopStyle)).toBe("solid");
    expect(await cityRow.evaluate((el) => getComputedStyle(el).borderTopWidth)).not.toBe("0px");
    expect(await card.evaluate((el) => getComputedStyle(el).color)).not.toBe("rgba(0, 0, 0, 0)");
  });

  test("the usual weather row keeps its dashed outline and its words in forced colours", async ({
    page,
  }) => {
    const start = daysUntilDayOfMonth(27, 30);
    await createWeatherTrip(page, [{ leave: start, back: start + 7 }], CAIRO);
    const pill = await homeAt(page, 390);
    await pill.click();
    await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
    const usual = page.getByTestId("usual-weather");
    await expect(usual.getByRole("heading")).toContainText("Usual weather");
    await expect(usual.getByRole("heading")).toContainText(", not a forecast");
    const row = usual.getByRole("listitem").first();
    await expect(row).toBeVisible();
    expect(await row.evaluate((el) => getComputedStyle(el).borderTopStyle)).toBe("dashed");
    expect(await row.evaluate((el) => getComputedStyle(el).borderTopWidth)).toBe("2px");
  });
});

test.describe("accessibility", DEVICE, () => {
  test("axe on the weather panel at 390", async ({ page }) => {
    await openWeather(page, [{ leave: 3, back: 8 }]);
    // #377: the redesigned Home's palette pairs fall short of 4.5:1; nothing else is exempt.
    await expectAccessible(page, "Home weather panel", { disable: ["color-contrast"] });
  });
});
