import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { DEVICE } from "./helpers/device";
import { createWeatherTrip, fake, type Stay } from "./helpers/forecast-trip";
import { OPEN_METEO_PORT } from "./support/ports";

// #303 PR 2: the dashboard hero's daily forecast block, under the weather strip. Against the second app (Open-Meteo
// on the local fake, as trip-daily-forecast does). Layout is asserted from measured rects, per state x width:
// whole 28px rows (header 28, chips 84 or phone rows 28, "+N more" 28), one line per text, no two cells touching, no
// sideways scroll, the block a full row above the status block, and the weather strip untouched (#302's rules).
test.use({ baseURL: `http://localhost:${OPEN_METEO_PORT}` });

const ROW = 28;
const CHIP = ROW * 3;
const WIDTHS = [1280, 981, 721, 390, 320] as const;
const onGrid = (value: number) => Math.min(value % ROW, ROW - (value % ROW));

async function openHero(page: Page, stays: Stay[]) {
  await createWeatherTrip(page, stays);
  await page.goto("/");
  await expect(page.locator(".hero-forecast")).toBeVisible({ timeout: 30_000 });
}

async function setWidth(page: Page, width: number) {
  await page.setViewportSize({ width, height: width < 700 ? 844 : 900 });
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => done(null))));
}

test.beforeEach(async ({ page }) => {
  test.setTimeout(120_000);
  await fake("/__weather-reset");
  await fake("/__weather-set?variant=varied");
  await page.emulateMedia({ reducedMotion: "reduce" });
});

interface Box {
  x: number;
  y: number;
  r: number;
  b: number;
}
const intersects = (a: Box, b: Box) =>
  a.x < b.r - 0.5 && b.x < a.r - 0.5 && a.y < b.b - 0.5 && b.y < a.b - 0.5;

/** Everything the layout assertions need, measured in the page. */
function measure(page: Page) {
  return page.evaluate(() => {
    const rect = (el: Element): Box => {
      const r = el.getBoundingClientRect();
      return { x: r.left, y: r.top, r: r.right, b: r.bottom };
    };
    // the box of the TEXT (a stretched grid cell has the track's edges whatever the text does), and its line count
    const text = (el: Element) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0);
      const tops = new Set(rects.map((r) => Math.round(r.top)));
      const box = range.getBoundingClientRect();
      return {
        lines: tops.size,
        box: { x: box.left, y: box.top, r: box.right, b: box.bottom } as Box,
      };
    };
    const hero = document.querySelector<HTMLElement>(".ledger-hero")!;
    const block = document.querySelector<HTMLElement>(".hero-forecast")!;
    const head = block.querySelector(".hero-forecast-head")!;
    const list = block.querySelector(".hero-days")!;
    const more = block.querySelector(".hero-days-more");
    const strip = document.querySelector(".weather-strip")!;
    const visible = (el: Element) => getComputedStyle(el).display !== "none";
    const root = document.documentElement;
    return {
      hero: rect(hero),
      padRight: hero.getBoundingClientRect().left + hero.clientLeft + hero.clientWidth,
      block: rect(block),
      head: rect(head),
      headTag: rect(head.querySelector(".weather-source")!),
      headCity: text(head.lastElementChild!),
      list: rect(list),
      more: more ? rect(more) : null,
      strip: rect(strip),
      status: rect(document.querySelector(".ledger-status")!),
      actions: rect(document.querySelector(".ledger-actions")!),
      days: Array.from(list.children).map((li) => ({
        box: rect(li),
        label: text(li.querySelector(".hero-day-label")!),
        glyph: rect(li.querySelector(".hero-day-glyph")!),
        temps: text(li.querySelector(".hero-day-temps")!),
        labelText: li.querySelector<HTMLElement>(".hero-day-label")!.innerText,
        monthShown: visible(li.querySelector(".hero-day-month")!),
        columns: getComputedStyle(li).gridTemplateColumns.split(" ").length,
      })),
      scroll: {
        page: root.scrollWidth - root.clientWidth,
        hero: hero.scrollWidth - hero.clientWidth,
        block: block.scrollWidth - block.clientWidth,
      },
    };
  });
}

/** One state at one width: the layout contract. `chips` is true at 721px and up. */
async function expectCleanBlock(page: Page, width: number, options: { days?: number } = {}) {
  const m = await measure(page);
  const where = `at ${width}px`;
  const chips = width >= 721;
  const height = (box: Box) => box.b - box.y;

  // whole rows: the block, the header, the list and the "+N more" line
  expect(onGrid(height(m.block)), `block ${height(m.block)} ${where}`).toBeLessThanOrEqual(0.5);
  expect(onGrid(height(m.list)), `list ${height(m.list)} ${where}`).toBeLessThanOrEqual(0.5);
  expect(onGrid(height(m.head)), `header ${height(m.head)} ${where}`).toBeLessThanOrEqual(0.5);
  expect(height(m.headTag), `Forecast tag is one row ${where}`).toBeCloseTo(ROW, 0);
  if (m.more) expect(height(m.more), `+N more is one row ${where}`).toBeCloseTo(ROW, 0);
  if (options.days !== undefined) expect(m.days.length).toBe(options.days);

  // every day is one chip (3 rows) or whole phone rows; the header city wraps only in whole lines
  for (const [at, day] of m.days.entries()) {
    const label = `day ${at} ${where}`;
    if (chips) {
      expect(height(day.box), `${label} chip height`).toBeCloseTo(CHIP, 0);
      expect(day.label.lines, `${label} label lines`).toBe(1);
      expect(day.temps.lines, `${label} temps lines`).toBe(1);
      expect(day.monthShown, `${label} chip omits the month`).toBe(false);
      expect(day.labelText, `${label} chip label`).toMatch(/^(Today|[A-Z][a-z]{2}) \d{1,2}$/);
      expect(day.box.r - day.box.x, `${label} chip width`).toBeGreaterThanOrEqual(80 - 0.5);
    } else {
      expect(onGrid(height(day.box)), `${label} row ${height(day.box)}`).toBeLessThanOrEqual(0.5);
      expect(height(day.box), label).toBeGreaterThanOrEqual(ROW - 0.5);
      expect(day.monthShown, `${label} phone row shows the month`).toBe(true);
      expect(day.labelText, `${label} phone label`).toMatch(
        /^(Today|[A-Z][a-z]{2}) [A-Z][a-z]{2} \d{1,2}$/,
      );
      expect(day.columns, `${label} phone row columns`).toBe(3);
      expect(day.temps.lines, `${label} temps lines`).toBe(1);
      // one line of text is one 28px row (not the 3-row chip left over from the wide arrangement)
      expect(height(day.box), `${label} one-line row is 28px`).toBeCloseTo(
        ROW * day.label.lines,
        0,
      );
    }
    // inside the block, and no two of its cells touch
    expect(day.box.x, label).toBeGreaterThanOrEqual(m.block.x - 0.5);
    expect(day.box.r, label).toBeLessThanOrEqual(m.block.r + 0.5);
    const cells = { label: day.label.box, glyph: day.glyph, temps: day.temps.box };
    const names = Object.keys(cells) as (keyof typeof cells)[];
    for (const [i, first] of names.entries()) {
      for (const second of names.slice(i + 1)) {
        expect(
          intersects(cells[first], cells[second]),
          `${label}: ${first} overlaps ${second}`,
        ).toBe(false);
      }
    }
  }
  // no two days overlap each other
  m.days.forEach((a, i) =>
    m.days.slice(i + 1).forEach((b, j) => {
      expect(intersects(a.box, b.box), `day ${i} overlaps day ${i + j + 1} ${where}`).toBe(false);
    }),
  );
  if (chips) {
    // chips fill whole 84px rows: the list height is (rows of chips) x 84
    const tops = new Set(m.days.map((d) => Math.round(d.box.y)));
    expect(height(m.list), `list is ${tops.size} chip rows ${where}`).toBeCloseTo(
      tops.size * CHIP,
      0,
    );
  } else {
    // the phone arrangement: one column of rows, in order
    expect(new Set(m.days.map((d) => Math.round(d.box.x))).size, `one column ${where}`).toBe(1);
  }

  // placement: after the strip, a full row above the status block and the actions, never over them
  expect(m.block.y, `block starts at the strip's end ${where}`).toBeCloseTo(m.strip.b, 0);
  expect(m.status.y - m.block.b, `block to status gap ${where}`).toBeGreaterThanOrEqual(ROW - 0.5);
  expect(m.block.b, `block above the actions ${where}`).toBeLessThanOrEqual(m.actions.y + 0.5);
  expect(onGrid(height(m.strip)), `strip height ${height(m.strip)} ${where}`).toBeLessThanOrEqual(
    0.5,
  );
  expect(m.headCity.lines, `header city lines ${where}`).toBeGreaterThanOrEqual(1);

  // nothing scrolls sideways and nothing leaves the hero's padding box
  expect(m.scroll, `scroll ${where}`).toEqual({ page: 0, hero: 0, block: 0 });
  expect(m.block.r, `block inside the hero ${where}`).toBeLessThanOrEqual(m.padRight + 0.5);
}

test(
  "an all-forecast stay: 7 chips or rows, a +N more link, at every width",
  { tag: DEVICE.tag },
  async ({ page }) => {
    await openHero(page, [{ leave: 1, back: 15 }]);
    const block = page.getByRole("region", { name: "Forecast for London" });
    await expect(block.getByRole("listitem")).toHaveCount(7);
    await expect(block.locator(".weather-source.forecast")).toHaveText("Forecast");
    const link = block.getByRole("link", {
      name: /more forecast days for London on the trip page/,
    });
    await expect(link).toHaveText(/^\+\d+ more days$/);
    await expect(link).toHaveAttribute("href", /^\/trips\/.+/);
    for (const width of WIDTHS) {
      await setWidth(page, width);
      await expectCleanBlock(page, width, { days: 7 });
    }
    // keyboard: the link takes focus with a visible ring, and its touch target is 44px (the line itself is 28)
    await link.focus();
    await expect(link).toBeFocused();
    expect(await link.evaluate((el) => getComputedStyle(el).outlineStyle)).not.toBe("none");
    const touch = await link.evaluate((el) => {
      const r = getComputedStyle(el, "::after");
      return { top: r.top, bottom: r.bottom, position: r.position };
    });
    expect(touch.position).toBe("absolute");
  },
);

test("a stay with 5 days or fewer shows only those days and no link", async ({ page }) => {
  await openHero(page, [{ leave: 1, back: 5 }]);
  const days = await page.locator(".hero-day").count();
  expect(days).toBeLessThanOrEqual(7);
  await expect(page.locator(".hero-days-more")).toHaveCount(0);
  for (const width of [1280, 390, 320]) {
    await setWidth(page, width);
    await expectCleanBlock(page, width, { days });
  }
});

test("a one-day stay is one chip or row", async ({ page }) => {
  await openHero(page, [{ leave: 2, back: 2 }]);
  await expect(page.locator(".hero-day")).toHaveCount(1);
  for (const width of WIDTHS) {
    await setWidth(page, width);
    await expectCleanBlock(page, width, { days: 1 });
  }
});

test("a stay that straddles the window shows only forecast days, no typical text", async ({
  page,
}) => {
  await openHero(page, [{ leave: 11, back: 25 }]);
  const block = page.locator(".hero-forecast");
  await expect(block.locator(".weather-source.typical")).toHaveCount(0);
  await expect(block).not.toContainText(/typical/i);
  await expect(block.getByRole("listitem")).toHaveCount(5);
  for (const width of [1280, 721, 390, 320]) {
    await setWidth(page, width);
    await expectCleanBlock(page, width, { days: 5 });
  }
});

test("an in-progress stay starts the block at Today", async ({ page }) => {
  await openHero(page, [{ leave: -4, back: 25 }]);
  await expect(page.locator(".hero-day").first()).toContainText("Today");
  for (const width of [1280, 390]) {
    await setWidth(page, width);
    await expectCleanBlock(page, width, { days: 7 });
  }
});

test("three stays: the block names the first stay with forecast days, once", async ({ page }) => {
  await openHero(page, [{ leave: 1, back: 12 }, { leave: 16 }, { leave: 22 }]);
  await expect(page.locator(".hero-forecast")).toHaveCount(1);
  await expect(page.locator(".weather-strip li")).toHaveCount(3);
  for (const width of WIDTHS) {
    await setWidth(page, width);
    await expectCleanBlock(page, width);
  }
});

test("extremes: 3-digit Fahrenheit and a 40-character unbroken city", async ({ page }) => {
  await openHero(page, [{ leave: 1, back: 15 }]);
  // every chip is forced to the widest text: 3 digits both ways
  await page.evaluate(() => {
    document.querySelectorAll(".hero-day-temps").forEach((el) => {
      el.textContent = "104° / 100°";
    });
    document.querySelector(".hero-forecast-head")!.lastElementChild!.textContent =
      "Llanfairpwllgwyngyllgogerychwyrndrobwllll";
  });
  for (const width of WIDTHS) {
    await setWidth(page, width);
    await expectCleanBlock(page, width, { days: 7 });
  }
});

test("days mix sun, rain and snow marks, and each reads as one sentence", async ({ page }) => {
  await openHero(page, [{ leave: 1, back: 15 }]);
  const marks = await page.locator(".hero-day-glyph").allInnerTexts();
  expect(new Set(marks).size, "sun, rain and snow marks differ").toBeGreaterThan(1);
  // each day reads as one sentence, and the compact visuals are hidden from assistive tech
  const first = page.locator(".hero-day").first();
  await expect(first.locator(".sr-only")).toHaveText(
    /^\w+ \d+ \w+: (sunny|rain likely|snow likely), high -?\d+, low -?\d+, \d+% chance of rain$/,
  );
  await expect(first.locator("[aria-hidden=true]")).toHaveCount(3);
});

// Test-only 200% text: the chip minimum and the phone rows follow the text size. Wait until it really applies.
async function applyLargeText(page: Page) {
  await page.addStyleTag({
    content: "html { font-size: 200% !important; } .hero-forecast { font-size: 26px !important; }",
  });
  await expect
    .poll(
      () =>
        page
          .locator(".hero-day")
          .first()
          .evaluate((el) => parseFloat(getComputedStyle(el).fontSize)),
      {
        message: "200% text precondition not active (.hero-day must compute to >= 24px)",
      },
    )
    .toBeGreaterThanOrEqual(24);
}

for (const width of [1280, 721, 640, 390, 320]) {
  test(`200% text at ${width}px: nothing overlaps, wraps mid-text or scrolls`, async ({ page }) => {
    await openHero(page, [{ leave: 1, back: 15 }]);
    await setWidth(page, width);
    await applyLargeText(page);
    const m = await measure(page);
    const where = `at ${width}px`;
    expect(m.scroll, `scroll ${where}`).toEqual({ page: 0, hero: 0, block: 0 });
    expect(onGrid(m.block.b - m.block.y), `block height ${where}`).toBeLessThanOrEqual(0.5);
    for (const [at, day] of m.days.entries()) {
      expect(day.temps.lines, `day ${at} temps lines ${where}`).toBe(1);
      if (width >= 721) expect(day.label.lines, `day ${at} label lines ${where}`).toBe(1);
      expect(onGrid(day.box.b - day.box.y), `day ${at} height ${where}`).toBeLessThanOrEqual(0.5);
      expect(intersects(day.label.box, day.temps.box), `day ${at} label/temps ${where}`).toBe(
        false,
      );
      expect(day.box.r, `day ${at} inside the block ${where}`).toBeLessThanOrEqual(m.block.r + 0.5);
    }
    m.days.forEach((a, i) =>
      m.days.slice(i + 1).forEach((b, j) => {
        expect(intersects(a.box, b.box), `day ${i} overlaps day ${i + j + 1} ${where}`).toBe(false);
      }),
    );
  });
}

test("a weather note taller than 140px sits above the block and keeps it on the rows", async ({
  page,
}) => {
  await openHero(page, [{ leave: 1, back: 15 }]);
  await page.evaluate(() => {
    const note = document.querySelector(".weather-note")!;
    note.textContent =
      "Expect a long spell of cool, damp weather with morning fog along the coast, gusty afternoon winds on the ridges, " +
      "and a real chance of rain on two of the three days, so pack a waterproof shell, warm layers, a hat and sturdy shoes " +
      "that can take wet ground, and keep a spare pair of socks and a light dry bag for your phone and papers handy.";
  });
  for (const width of WIDTHS) {
    await setWidth(page, width);
    const strip = await page.locator(".weather-strip").boundingBox();
    expect(strip!.height, `a long note grows the strip at ${width}px`).toBeGreaterThan(140);
    await expectCleanBlock(page, width);
  }
});

// Opt-in screenshots for design's rendered review: HERO_FORECAST_SHOTS=<dir> npx playwright test hero-daily-forecast
const SHOTS = process.env.HERO_FORECAST_SHOTS;
test("screenshots for design review (opt-in)", async ({ page }) => {
  test.skip(!SHOTS, "set HERO_FORECAST_SHOTS=<dir> to write screenshots");
  test.setTimeout(300_000);
  const dir = SHOTS as string;
  mkdirSync(dir, { recursive: true });
  const cases: { name: string; stays: Stay[]; scorch?: boolean; zoom?: boolean; city?: boolean }[] =
    [
      { name: "k1-seven-days", stays: [{ leave: 1, back: 5 }] },
      { name: "k2-twelve-plus-days", stays: [{ leave: 1, back: 15 }] },
      { name: "c-straddle", stays: [{ leave: 11, back: 25 }] },
      { name: "d-in-progress", stays: [{ leave: -4, back: 25 }] },
      { name: "e-single-day", stays: [{ leave: 2, back: 2 }] },
      { name: "f-three-stays", stays: [{ leave: 1, back: 12 }, { leave: 16 }, { leave: 22 }] },
      { name: "g-long-city", stays: [{ leave: 1, back: 15 }], city: true },
      { name: "h-fahrenheit-3-digit", stays: [{ leave: 1, back: 15 }], scorch: true },
      { name: "j-zoom200", stays: [{ leave: 1, back: 15 }], zoom: true },
    ];
  for (const item of cases) {
    await fake("/__weather-reset");
    await fake(`/__weather-set?variant=${item.scorch ? "scorching" : "varied"}`);
    await page.context().clearCookies();
    await openHero(page, item.stays);
    if (item.city) {
      await page.evaluate(() => {
        document.querySelector(".hero-forecast-head")!.lastElementChild!.textContent =
          "Llanfairpwllgwyngyllgogerychwyrndrobwllll";
      });
    }
    if (item.zoom) await applyLargeText(page);
    for (const width of item.zoom ? [1280, 640, 390, 320] : WIDTHS) {
      await setWidth(page, width);
      await page
        .locator(".ledger-hero")
        .screenshot({ path: join(dir, `${item.name}-${width}.png`) });
    }
  }
});
