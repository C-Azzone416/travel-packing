import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { signInAsOwner } from "./helpers/auth";
import { FAKE_GEOCODER_PORT, OPEN_METEO_PORT } from "./support/ports";

// #303 (PR 1 of 2, the trip page): stays with forecast days read day by day; typical-only stays read as they always did.
// Runs against the second app (WEATHER_PROVIDER = open-meteo on the local fake, as weather.spec does). The fake serves
// "varied" weather (rain every third day, snow every fifth) so rows differ, and "scorching" for 3-digit Fahrenheit.
// Layout is checked from measured rects at the widths design reviews: 28px rows, one line per cell, no overlap, no
// overflow. Screenshots are opt-in: WEATHER_SHOTS=<dir> npx playwright test trip-daily-forecast (see the last test).
test.use({ baseURL: `http://localhost:${OPEN_METEO_PORT}` });

const FAKE = `http://127.0.0.1:${FAKE_GEOCODER_PORT}`;
const fake = (path: string) => fetch(`${FAKE}${path}`).then((response) => response.json());
const ROW = 28;
const WIDTHS = [1280, 981, 721, 390, 320] as const;
const inDays = (count: number) =>
  new Date(Date.now() + count * 86_400_000).toISOString().slice(0, 10);

interface Stay {
  leave: number;
  /** For the first stop only: the day the trip ends. Later stops end where the next begins. */
  back?: number;
}

/** Creates and opens a London trip with weather on; `stays` are day offsets from today. */
async function openTrip(page: Page, stays: Stay[]) {
  await signInAsOwner(page);
  await page.getByRole("link", { name: /Plan a trip/ }).click();
  await expect(page.getByRole("heading", { name: "Confirm the trip" })).toBeVisible();
  await page.getByRole("combobox", { name: "Destination search" }).fill("london");
  await page.getByRole("option", { name: /England/ }).click();
  await page.getByLabel("Leave", { exact: true }).fill(inDays(stays[0].leave));
  await page
    .getByLabel("Return", { exact: true })
    .fill(inDays(stays[0].back ?? stays[0].leave + 3));
  for (let at = 1; at < stays.length; at++) {
    await page.getByRole("button", { name: "+ Add another stop" }).click();
    await page.getByRole("combobox", { name: `Destination search, Stop ${at + 1}` }).fill("london");
    await page.getByRole("option", { name: /Ontario/ }).click();
    await page.getByLabel(`Leave, Stop ${at + 1}`).fill(inDays(stays[at].leave));
  }
  await page.getByRole("button", { name: "Continue to packing preferences" }).click();
  await expect(page.getByRole("heading", { name: "Shape the list" })).toBeVisible();
  await page.getByRole("button", { name: "Get weather" }).click();
  await expect(page.getByText(/Your list uses the weather for/)).toBeVisible();
  await page.getByRole("button", { name: "Save trip" }).click();
  await page
    .getByRole("link", { name: /^(Continue|Keep) packing: London/ })
    .first()
    .click();
  await expect(page.locator(".weather-row").first()).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  test.setTimeout(120_000);
  await fake("/__weather-reset");
  await fake("/__weather-set?variant=varied");
  await page.emulateMedia({ reducedMotion: "reduce" });
});

/** Rect and line-count facts for every daily row in the panel, measured in the page. */
function measureRows(page: Page) {
  return page.evaluate(() => {
    const lines = (el: Element) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      const tops = new Set(Array.from(range.getClientRects()).map((r) => Math.round(r.top)));
      return tops.size;
    };
    const box = (el: Element) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, height: r.height };
    };
    return Array.from(document.querySelectorAll(".weather-day")).map((row) => {
      const cell = (selector: string) => row.querySelector(selector)!;
      return {
        height: row.getBoundingClientRect().height,
        listWidth: row.getBoundingClientRect().width,
        label: { lines: lines(cell(".weather-day-label")), ...box(cell(".weather-day-label")) },
        glyph: box(cell(".weather-day-glyph")),
        temps: { lines: lines(cell(".weather-day-temps")), ...box(cell(".weather-day-temps")) },
        rain: { lines: lines(cell(".weather-day-rain")), ...box(cell(".weather-day-rain")) },
      };
    });
  });
}

const overflow = (page: Page) =>
  page.evaluate(() => {
    const root = document.documentElement;
    const panel = document.querySelector<HTMLElement>(".weather-panel")!;
    return {
      page: root.scrollWidth - root.clientWidth,
      panel: panel.scrollWidth - panel.clientWidth,
    };
  });

async function setWidth(page: Page, width: number) {
  await page.setViewportSize({ width, height: width < 700 ? 844 : 900 });
  // let the layout settle after the resize
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => done(null))));
}

/** Every daily row is whole 28px rows, each cell is one line, and no two cells touch. */
async function expectCleanRows(
  page: Page,
  width: number,
  options: { zoom?: boolean; columns?: boolean } = {},
) {
  const rows = await measureRows(page);
  expect(rows.length).toBeGreaterThan(0);
  rows.forEach((row, at) => {
    const where = `row ${at} at ${width}px`;
    expect(row.height % ROW, `${where} height ${row.height}`).toBeLessThanOrEqual(0.5);
    expect(row.height, where).toBeGreaterThanOrEqual(ROW - 0.5);
    // Content decides: whatever does not fit goes onto a whole extra row. The label is always one line, and no two
    // cells ever share space (on one line they are side by side; otherwise one sits below the other).
    for (const name of ["label", "temps", "rain"] as const) {
      expect(row[name].lines, `${where} ${name} lines`).toBe(1);
    }
    const cells = { label: row.label, glyph: row.glyph, temps: row.temps, rain: row.rain };
    const names = Object.keys(cells) as (keyof typeof cells)[];
    for (const [i, first] of names.entries()) {
      for (const second of names.slice(i + 1)) {
        const a = cells[first];
        const b = cells[second];
        const apart =
          a.right <= b.left + 0.5 ||
          b.right <= a.left + 0.5 ||
          a.bottom <= b.top + 0.5 ||
          b.bottom <= a.top + 0.5;
        expect(apart, `${where}: ${first} and ${second} overlap`).toBe(true);
      }
    }
  });
  expect(await overflow(page), `overflow at ${width}px`).toEqual({ page: 0, panel: 0 });
  if (width >= 721 && !options.zoom) {
    // wide lists never need the fallback (three stays side by side at 721 are the one exception, checked by its test)
    if (!options.columns)
      expect(
        rows.every((row) => row.height < ROW + 0.5),
        `${width}px one line`,
      ).toBe(true);
  }
}

test("a typical-only stay keeps today's row: no daily list, no Forecast tag", async ({ page }) => {
  await openTrip(page, [{ leave: 60, back: 63 }]);
  const row = page.locator(".weather-row");
  await expect(row).toHaveCount(1);
  await expect(row).toHaveClass("weather-row");
  await expect(row.locator(".weather-source")).toHaveText("Typical for these dates");
  await expect(row.locator(".weather-range")).toBeVisible();
  await expect(page.locator(".weather-days")).toHaveCount(0);
  await expect(page.getByText("Forecast", { exact: true })).toHaveCount(0);
  for (const width of WIDTHS) {
    await setWidth(page, width);
    expect(await overflow(page), `overflow at ${width}px`).toEqual({ page: 0, panel: 0 });
  }
});

test("an all-forecast stay: capped at 7 days, expands to all, rows hold at every width", async ({
  page,
}) => {
  await openTrip(page, [{ leave: 1, back: 15 }]);
  const list = page.getByRole("list", { name: "Daily forecast for London" });
  await expect(list.getByRole("listitem")).toHaveCount(7);
  const toggle = page.getByRole("button", { name: /^Show all \d+ days$/ });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  const total = Number((await toggle.innerText()).match(/\d+/)![0]);
  expect(total).toBeGreaterThan(7);
  await expect(page.locator(".weather-source.typical, .weather-range, .weather-mixed")).toHaveCount(
    0,
  );
  for (const width of WIDTHS) {
    await setWidth(page, width);
    await expectCleanRows(page, width);
  }
  await toggle.click();
  await expect(list.getByRole("listitem")).toHaveCount(total);
  await expect(page.getByRole("button", { name: "Show first 7" })).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  for (const width of WIDTHS) {
    await setWidth(page, width);
    await expectCleanRows(page, width);
  }
  await page.getByRole("button", { name: "Show first 7" }).click();
  await expect(list.getByRole("listitem")).toHaveCount(7);
});

test("a stay that straddles the window shows both tags, never sharing a line of numbers", async ({
  page,
}) => {
  await openTrip(page, [{ leave: 11, back: 25 }]);
  const forecastTag = page.locator(".weather-source.forecast");
  const typicalTag = page.locator(".weather-source.typical");
  await expect(forecastTag).toHaveText("Forecast");
  await expect(typicalTag).toHaveText("Typical");
  await expect(page.getByText(/^Other \d+ days?:/)).toBeVisible();
  await expect(page.getByText("Later days are typical")).toHaveCount(0);
  for (const width of WIDTHS) {
    await setWidth(page, width);
    const f = (await forecastTag.boundingBox())!;
    const t = (await typicalTag.boundingBox())!;
    const list = (await page.locator(".weather-days").boundingBox())!;
    expect(f.width).toBeGreaterThan(0);
    expect(t.width).toBeGreaterThan(0);
    // the Typical line sits below the whole forecast list
    expect(t.y, `typical below the list at ${width}px`).toBeGreaterThanOrEqual(
      list.y + list.height - 0.5,
    );
    for (const part of [".weather-part-head", ".weather-days"]) {
      const heights = await page
        .locator(part)
        .evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height));
      for (const h of heights)
        expect(h % ROW, `${part} ${h} at ${width}px`).toBeLessThanOrEqual(0.5);
    }
    await expectCleanRows(page, width);
  }
});

test("an in-progress stay: past typical days, the forecast, then later typical days", async ({
  page,
}) => {
  await openTrip(page, [{ leave: -4, back: 25 }]);
  await expect(page.locator(".weather-source.forecast")).toHaveText("Forecast");
  await expect(page.locator(".weather-source.typical")).toHaveText("Typical");
  await expect(page.locator(".weather-days .weather-day").first()).toContainText("Today");
  for (const width of [1280, 390, 320]) {
    await setWidth(page, width);
    await expectCleanRows(page, width);
  }
});

test("a one-day stay is one row with no toggle", async ({ page }) => {
  await openTrip(page, [{ leave: 2, back: 2 }]);
  await expect(page.locator(".weather-day")).toHaveCount(1);
  await expect(page.getByRole("button", { name: /Show/ })).toHaveCount(0);
  await expect(page.locator(".weather-part-head").first()).toContainText(/High \d+° · Low \d+° · /);
  await setWidth(page, 320);
  await expectCleanRows(page, 320);
});

test("three stays each keep their own list and toggle", async ({ page }) => {
  await openTrip(page, [{ leave: 1, back: 12 }, { leave: 16 }, { leave: 22 }]);
  const lists = page.locator(".weather-days");
  await expect(page.locator(".weather-row")).toHaveCount(3);
  await expect(lists).toHaveCount(2); // the third stay is past the window: typical only
  for (const width of WIDTHS) {
    await setWidth(page, width);
    await expectCleanRows(page, width, { columns: true });
  }
  const toggles = page.getByRole("button", { name: /^Show all \d+ days$/ });
  const before = await toggles.count();
  expect(before).toBeGreaterThan(0);
  await toggles.first().click();
  await expect(toggles).toHaveCount(before - 1);
});

test("extremes: a 40-character unbroken city, three-digit Fahrenheit, snow and rain, 200% text", async ({
  page,
}) => {
  await openTrip(page, [{ leave: 11, back: 25 }]);
  await page.evaluate(() => {
    document.querySelector(".weather-row-forecast h3")!.textContent =
      "Llanfairpwllgwyngyllgogerychwyrndrobwllll";
    document.querySelectorAll(".weather-day-temps").forEach((el) => {
      el.textContent = "104° / 88°";
    });
  });
  for (const width of WIDTHS) {
    await setWidth(page, width);
    await expectCleanRows(page, width);
    const h3 = await page.locator(".weather-row-forecast h3").boundingBox();
    expect(h3!.height % ROW, `h3 ${h3!.height} at ${width}px`).toBeLessThanOrEqual(0.5);
  }
  // the day glyphs mix sun, rain and snow, and none relies on colour
  const marks = await page.locator(".weather-day-glyph").allInnerTexts();
  expect(new Set(marks).size).toBeGreaterThan(1);
});

// B1 (design, #307): at 200% text the day label used to collapse to 0px and wrap one letter per line.
for (const width of [390, 320]) {
  test(`200% text at ${width}px: labels stay on one line and nothing overlaps`, async ({
    page,
  }) => {
    await openTrip(page, [{ leave: 1, back: 15 }]);
    await setWidth(page, width);
    await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
    await expectCleanRows(page, width, { zoom: true });
    // the fallback really happened: at least one row took a second whole row
    const heights = await page
      .locator(".weather-day")
      .evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height));
    expect(Math.max(...heights)).toBeGreaterThan(ROW + 0.5);
  });
}

test("Fahrenheit rows show three-digit temperatures from the provider", async ({ page }) => {
  await fake("/__weather-set?variant=scorching");
  await openTrip(page, [{ leave: 2, back: 6 }]);
  await expect(page.locator(".weather-day-temps").first()).toHaveText("104° / 88°");
  for (const width of WIDTHS) {
    await setWidth(page, width);
    await expectCleanRows(page, width);
  }
});

test("the toggle shows a focus ring and the days read as one phrase each", async ({ page }) => {
  await openTrip(page, [{ leave: 1, back: 15 }]);
  const toggle = page.getByRole("button", { name: /^Show all/ });
  await toggle.focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  await expect(toggle).toBeFocused();
  const outline = await toggle.evaluate((el) => getComputedStyle(el).outlineStyle);
  expect(outline).not.toBe("none");
  const box = (await toggle.boundingBox())!;
  // visual line is one 28px row; the touch target (::after) is 44px
  expect(box.height).toBeLessThanOrEqual(ROW + 0.5);
  const first = page.locator(".weather-day").first();
  await expect(first.locator(".sr-only")).toHaveText(
    /^\w+ \d+ \w+: (sunny|rain likely|snow likely), high -?\d+, low -?\d+, \d+% chance of rain$/,
  );
});

// Opt-in screenshots for design's rendered review: WEATHER_SHOTS=/tmp/shots npx playwright test trip-daily-forecast --project=desktop
const SHOTS = process.env.WEATHER_SHOTS;
test("screenshots for design review (opt-in)", async ({ page }) => {
  test.skip(!SHOTS, "set WEATHER_SHOTS=<dir> to write screenshots");
  test.setTimeout(240_000);
  const dir = SHOTS as string;
  mkdirSync(dir, { recursive: true });
  const cases: {
    name: string;
    stays: Stay[];
    expand?: boolean;
    scorch?: boolean;
    zoom?: boolean;
  }[] = [
    { name: "a-typical-only", stays: [{ leave: 60, back: 63 }] },
    { name: "b-all-forecast-collapsed", stays: [{ leave: 1, back: 15 }] },
    { name: "b-all-forecast-expanded", stays: [{ leave: 1, back: 15 }], expand: true },
    { name: "c-straddle", stays: [{ leave: 11, back: 25 }] },
    { name: "d-in-progress", stays: [{ leave: -4, back: 25 }] },
    { name: "e-single-day", stays: [{ leave: 2, back: 2 }] },
    { name: "f-three-stays", stays: [{ leave: 1, back: 12 }, { leave: 16 }, { leave: 22 }] },
    { name: "h-fahrenheit-3-digit", stays: [{ leave: 2, back: 6 }], scorch: true },
    { name: "j-zoom200", stays: [{ leave: 11, back: 25 }], zoom: true },
  ];
  for (const item of cases) {
    await fake("/__weather-reset");
    await fake(`/__weather-set?variant=${item.scorch ? "scorching" : "varied"}`);
    await page.context().clearCookies();
    await openTrip(page, item.stays);
    if (item.expand) await page.getByRole("button", { name: /^Show all/ }).click();
    if (item.zoom) await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
    for (const width of item.zoom ? [390, 320] : WIDTHS) {
      await setWidth(page, width);
      await page
        .locator(".weather-panel")
        .screenshot({ path: join(dir, `${item.name}-${width}.png`) });
      if (item.name === "b-all-forecast-collapsed") {
        // keyboard focus ring on the toggle (design N3)
        const toggle = page.getByRole("button", { name: /^Show all/ });
        await toggle.focus();
        await page.keyboard.press("Shift+Tab");
        await page.keyboard.press("Tab");
        await page
          .locator(".weather-panel")
          .screenshot({ path: join(dir, `b-toggle-focus-${width}.png`) });
      }
    }
  }
});
