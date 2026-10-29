import { expect, test, type Page } from "@playwright/test";
import { signInAsOwner } from "./helpers/auth";
import { DEVICE } from "./helpers/device";

// #285: the dashboard hero's metadata, status and actions rows sit on the hero's 28px ledger rules, the status row
// shares one baseline, and nothing overflows at any width. Layout only: the state variants below change the text the
// hero already shows (long place, big counts), never its data.
const NOW = new Date("2026-10-16T12:00:00");
const ROW = 28;
const WIDTHS = [1280, 981, 721, 390, 320] as const;

async function openHero(page: Page, width: number) {
  await page.setViewportSize({ width, height: width < 700 ? 844 : 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.clock.setFixedTime(NOW);
  await signInAsOwner(page);
  await expect(page.getByRole("heading", { name: "San Diego", level: 2 })).toBeVisible();
  return page.locator(".ledger-hero");
}

/** Bottoms of the rows, in px below the hero's padding-box top (inside its 4px top border). */
function rowBottoms(page: Page) {
  return page.evaluate(() => {
    const hero = document.querySelector<HTMLElement>(".ledger-hero")!;
    const top = hero.getBoundingClientRect().top + hero.clientTop;
    const bottom = (selector: string) =>
      hero.querySelector(selector)!.getBoundingClientRect().bottom - top;
    return {
      meta: bottom(".ledger-meta"),
      status: bottom(".ledger-status"),
      actions: bottom(".ledger-actions"),
    };
  });
}

/** The text baseline of an element (a zero-size inline-block probe sits on it), or the bottom edge of a box. */
function baselines(page: Page) {
  return page.evaluate(() => {
    const hero = document.querySelector<HTMLElement>(".ledger-hero")!;
    const probeBottom = (selector: string) => {
      const host = hero.querySelector(selector)!;
      const probe = document.createElement("span");
      probe.style.cssText = "display:inline-block;width:0;height:0";
      host.append(probe);
      const bottom = probe.getBoundingClientRect().bottom;
      probe.remove();
      return bottom;
    };
    return {
      numeral: probeBottom(".days-to-go strong"),
      counts: probeBottom(".ledger-counts > span:first-child"),
      track: hero.querySelector(".progress-track")!.getBoundingClientRect().bottom,
    };
  });
}

const overflow = (page: Page) =>
  page.evaluate(() => {
    const hero = document.querySelector<HTMLElement>(".ledger-hero")!;
    const root = document.documentElement;
    return {
      page: root.scrollWidth - root.clientWidth,
      hero: hero.scrollWidth - hero.clientWidth,
    };
  });

/** A weather strip built from the real markup (four stays); the seeded data has the strip off. */
async function injectWeather(page: Page, note: string) {
  await page.evaluate((text) => {
    const strip = document.createElement("ul");
    strip.className = "weather-strip";
    strip.innerHTML = [1, 2, 3, 4]
      .map(
        (n) =>
          `<li><div class="weather-cell-top"><span class="weather-glyph">☀</span><span class="weather-city">Stop ${n}</span>` +
          `<span class="weather-dates">Oct 2${n} – Oct 2${n + 1}</span>` +
          `<span class="weather-range">61–72°F <small>typical</small></span></div>` +
          `<span class="weather-note">${text}</span></li>`,
      )
      .join("");
    document.querySelector(".ledger-hero-top")!.after(strip);
  }, note);
}

const onGrid = (value: number) => {
  const off = value % ROW;
  return Math.min(off, ROW - off);
};

for (const width of WIDTHS) {
  test(
    `hero rows sit on the 28px ledger rules at ${width}px`,
    { tag: DEVICE.tag },
    async ({ page }) => {
      await openHero(page, width);
      const rows = await rowBottoms(page);
      for (const [name, bottom] of Object.entries(rows)) {
        expect(onGrid(bottom), `${name} bottom ${bottom}`).toBeLessThanOrEqual(1);
      }
      expect(rows.meta).toBeLessThan(rows.status);
      expect(rows.status).toBeLessThan(rows.actions);
      expect(await overflow(page)).toEqual({ page: 0, hero: 0 });
    },
  );

  test(`hero holds with long text and big counts at ${width}px`, async ({ page }) => {
    await openHero(page, width);
    // The hero's own copy, made as long as the spec's extremes: a long place, a 3-digit days count, 5-digit counts.
    await page.evaluate(() => {
      const set = (selector: string, text: string) => {
        const el = document.querySelector(selector);
        if (el) el.textContent = text;
      };
      set(".ledger-hero h2", "San Francisco Bay Area and Napa Valley");
      set(
        ".ledger-meta-place",
        "Northern California coast and wine country, United States of America",
      );
      set(".days-to-go strong", "365");
      set(".days-to-go span", "jours restants");
      const counts = document.querySelectorAll(".ledger-counts > span");
      if (counts[0]) counts[0].textContent = "12,480 of 13,000 packed";
      if (counts[1]) counts[1].textContent = "520 left";
    });
    const rows = await rowBottoms(page);
    for (const [name, bottom] of Object.entries(rows)) {
      expect(onGrid(bottom), `${name} bottom ${bottom}`).toBeLessThanOrEqual(1);
    }
    expect(await overflow(page)).toEqual({ page: 0, hero: 0 });
  });
}

for (const width of [1280, 981, 721]) {
  test(`the numeral, counts and track share a baseline at ${width}px`, async ({ page }) => {
    await openHero(page, width);
    const { numeral, counts, track } = await baselines(page);
    expect(Math.abs(numeral - counts)).toBeLessThanOrEqual(2);
    expect(Math.abs(numeral - track)).toBeLessThanOrEqual(2);
    // one row: the three groups sit side by side
    const tops = await page
      .locator(".ledger-status-row > *")
      .evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().left)));
    expect(tops).toEqual([...tops].sort((a, b) => a - b));
    const track96 = await page.locator(".progress-track").boundingBox();
    expect(track96!.width).toBeGreaterThanOrEqual(96);
  });
}

test("the status row stacks into three rows on a phone, and the actions stay 44px tall", async ({
  page,
}) => {
  await openHero(page, 390);
  const days = await page.locator(".days-to-go").boundingBox();
  const track = await page.locator(".progress-track").boundingBox();
  const counts = await page.locator(".ledger-counts").boundingBox();
  const hero = await page.locator(".ledger-hero").boundingBox();
  expect(track!.y).toBeGreaterThan(days!.y);
  expect(counts!.y).toBeGreaterThan(track!.y);
  expect(track!.width).toBeGreaterThan(hero!.width / 2);
  const slot = await page.locator("[data-stamp-slot]").boundingBox();
  expect(Math.round(slot!.height)).toBe(112);
  for (const button of await page
    .locator(".ledger-actions .button, .ledger-actions button")
    .all()) {
    expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
});

test("days to go, the progress bar, packed, then remaining read in that order", async ({
  page,
}) => {
  const hero = await openHero(page, 1280);
  const order = await hero
    .locator(".days-to-go, [role=progressbar], .ledger-counts > span")
    .evaluateAll((els) => els.map((el) => el.getAttribute("role") ?? el.className ?? el.tagName));
  expect(order).toEqual(["days-to-go", "progressbar", "", ""]);
  const bar = hero.getByRole("progressbar", { name: "San Diego packing progress" });
  await expect(bar).toHaveAttribute("aria-valuetext", /^\d+% packed$/);
});

// The weather strip is off in the seeded data, so build one from its real markup: four stays. Rows after it must still
// land on a rule, and the strip itself is whole rows.
for (const width of [1280, 721, 390]) {
  test(`a weather strip keeps the rows after it on the rules at ${width}px`, async ({ page }) => {
    await openHero(page, width);
    await injectWeather(page, "Mild, pack a light layer");
    const strip = await page.locator(".weather-strip").boundingBox();
    const rows = await rowBottoms(page);
    for (const [name, bottom] of Object.entries(rows)) {
      expect(onGrid(bottom), `${name} bottom ${bottom}`).toBeLessThanOrEqual(1);
    }
    expect(onGrid(strip!.height), `strip height ${strip!.height}`).toBeLessThanOrEqual(1);
    expect(await overflow(page)).toEqual({ page: 0, hero: 0 });
  });
}

for (const width of [390, 320]) {
  test(`the stacked status rows are visible and clear of the actions at ${width}px`, async ({
    page,
  }) => {
    await openHero(page, width);
    const box = async (selector: string) => (await page.locator(selector).first().boundingBox())!;
    const days = await box(".days-to-go");
    const track = await box(".progress-track");
    const packed = await box(".ledger-counts > span:first-child");
    const left = await box(".ledger-counts > span:last-child");
    const actions = await box(".ledger-actions");
    const status = await box(".ledger-status");
    await expect(page.locator(".progress-track")).toBeVisible();
    await expect(page.locator(".ledger-counts > span:first-child")).toBeVisible();
    await expect(page.locator(".ledger-counts > span:last-child")).toBeVisible();
    expect(track.y).toBeGreaterThanOrEqual(days.y + days.height - 1);
    expect(packed.y).toBeGreaterThanOrEqual(track.y);
    expect(left.y).toBeGreaterThanOrEqual(track.y);
    for (const part of [track, packed, left]) {
      expect(part.y + part.height).toBeLessThanOrEqual(actions.y + 0.5);
    }
    expect(status.y + status.height).toBeLessThanOrEqual(actions.y + 0.5);
    const rows = await rowBottoms(page);
    expect(onGrid(rows.status), `status bottom ${rows.status}`).toBeLessThanOrEqual(1);
    // the visible link text, not just its accessible name
    // (the seeded trip is not ready, so the exact string is "Continue packing"; the ready string is unit-tested)
    await expect(page.locator(".ledger-actions a").first()).toHaveText("Continue packing");
  });

  test(`an unbroken 30-character destination does not overflow at ${width}px`, async ({ page }) => {
    await openHero(page, width);
    await page.evaluate(() => {
      document.querySelector(".ledger-hero h2")!.textContent = "Llanfairpwllgwyngyllgogeryc";
      document.querySelector(".ledger-hero h2")!.textContent += "hh";
    });
    expect(await overflow(page)).toEqual({ page: 0, hero: 0 });
    const rows = await rowBottoms(page);
    for (const [name, bottom] of Object.entries(rows)) {
      expect(onGrid(bottom), `${name} bottom ${bottom}`).toBeLessThanOrEqual(1);
    }
  });
}

// ---- #290: the worst case (every extreme at once) wraps in whole 28px rows and never overflows or overlaps ----

/** Row caps from the design spec (v2), by viewport width: the most 28px rows the status block may take. */
const ROW_CAP: Record<number, number> = { 1280: 3, 981: 4, 721: 4, 390: 5, 320: 5 };

/** 4-digit days, 5-digit counts, labels about 40% longer, a long place and a long title, all at once. */
async function worstCase(page: Page) {
  await page.evaluate(() => {
    const set = (selector: string, text: string) => {
      const el = document.querySelector(selector);
      if (el) el.textContent = text;
    };
    set(".ledger-hero h2", "San Francisco Bay Area and Napa Valley");
    set(
      ".ledger-meta-place",
      "Northern California coast and wine country, United States of America",
    );
    set(".days-to-go strong", "1000");
    set(".days-to-go span", "days remaining");
    const counts = document.querySelectorAll(".ledger-counts > span");
    if (counts[0]) counts[0].textContent = "12,480 of 13,000 items packed";
    if (counts[1]) counts[1].textContent = "52,000 items left";
  });
}

interface Box {
  x: number;
  y: number;
  r: number;
  b: number;
}

/** Measured rects (page coordinates) for the hero's parts. */
function heroRects(page: Page) {
  return page.evaluate(() => {
    const rect = (selector: string): Box => {
      const box = document.querySelector(selector)!.getBoundingClientRect();
      return { x: box.left, y: box.top, r: box.right, b: box.bottom };
    };
    const hero = document.querySelector<HTMLElement>(".ledger-hero")!;
    const box = hero.getBoundingClientRect();
    const status = document.querySelector<HTMLElement>(".ledger-status")!;
    const row = document.querySelector<HTMLElement>(".ledger-status-row")!;
    return {
      hero: rect(".ledger-hero"),
      // the hero's padding box (inside its border) is the limit for every child
      padRight: box.left + hero.clientLeft + hero.clientWidth,
      status: rect(".ledger-status"),
      days: rect(".days-to-go"),
      track: rect(".progress-track"),
      packed: rect(".ledger-counts > span:first-child"),
      left: rect(".ledger-counts > span:last-child"),
      actions: rect(".ledger-actions"),
      stamp: rect("[data-stamp-slot]"),
      childRights: [...status.querySelectorAll("*")].map((el) => el.getBoundingClientRect().right),
      scroll: {
        hero: hero.scrollWidth - hero.clientWidth,
        status: status.scrollWidth - status.clientWidth,
        row: row.scrollWidth - row.clientWidth,
        page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      },
    };
  });
}

const intersects = (a: Box, b: Box) =>
  a.x < b.r - 0.5 && b.x < a.r - 0.5 && a.y < b.b - 0.5 && b.y < a.b - 0.5;

for (const width of WIDTHS) {
  test(
    `the worst case wraps in whole rows with no overlap or overflow at ${width}px`,
    { tag: DEVICE.tag },
    async ({ page }) => {
      await openHero(page, width);
      await worstCase(page);
      const m = await heroRects(page);
      const statusHeight = m.status.b - m.status.y;

      // overflow: nothing scrolls sideways, and every part of the status block is inside the hero's padding box
      expect(m.scroll, "scroll overflow").toEqual({ hero: 0, status: 0, row: 0, page: 0 });
      for (const right of m.childRights) expect(right).toBeLessThanOrEqual(m.padRight + 0.5);
      expect(m.status.r).toBeLessThanOrEqual(m.padRight + 0.5);

      // grid: the block is whole 28px rows, and no more than the spec's cap for this width
      expect(onGrid(statusHeight), `status height ${statusHeight}`).toBeLessThanOrEqual(1);
      expect(Math.round(statusHeight / ROW)).toBeLessThanOrEqual(ROW_CAP[width]);

      // line counts from rects: each count is one line, the days numeral stays within its two rows
      expect(m.packed.b - m.packed.y).toBeLessThanOrEqual(ROW + 1);
      expect(m.left.b - m.left.y).toBeLessThanOrEqual(ROW + 1);
      expect(m.days.b - m.days.y).toBeLessThanOrEqual(ROW * 2 + 1);

      // overlap: the parts never intersect each other, the stamp, or the actions row
      const parts = { days: m.days, track: m.track, packed: m.packed, left: m.left };
      const names = Object.keys(parts) as (keyof typeof parts)[];
      for (const [i, a] of names.entries()) {
        for (const b of names.slice(i + 1)) {
          expect(intersects(parts[a], parts[b]), `${a} overlaps ${b}`).toBe(false);
        }
        expect(intersects(parts[a], m.actions), `${a} overlaps the actions`).toBe(false);
        expect(intersects(parts[a], m.stamp), `${a} overlaps the stamp`).toBe(false);
      }
      // the status block is inside the hero and ends on or above the actions row's top rule (the actions follow it in
      // flow; the spec's "28px" is the whole-row growth, there is no extra gap between the two)
      expect(m.status.b, "status bottom <= actions top").toBeLessThanOrEqual(m.actions.y + 0.5);
      expect(m.status.b).toBeLessThanOrEqual(m.hero.b);
      expect(m.track.r - m.track.x).toBeGreaterThanOrEqual(96 - 0.5);
    },
  );
}

// The middle dot (spec v2): between the counts only when both share a line; never at the start of a line, and not in
// the phone arrangement (the container is at most 440px wide, which is a 390 or 320px viewport).
for (const width of WIDTHS) {
  test(`the dot between the counts follows the line they sit on at ${width}px`, async ({
    page,
  }) => {
    await openHero(page, width);
    await worstCase(page);
    const m = await heroRects(page);
    const info = await page.evaluate(() => {
      const second = document.querySelector(".ledger-counts > span:last-child")!;
      const counts = document.querySelector<HTMLElement>(".ledger-counts")!;
      return {
        dot: getComputedStyle(second, "::before").content,
        clip: getComputedStyle(counts).overflow,
        offset: second.getBoundingClientRect().left - counts.getBoundingClientRect().left,
      };
    });
    const sameLine = Math.abs(m.packed.y - m.left.y) < 2;
    if (width <= 440) {
      expect(info.dot).toBe("none");
    } else if (sameLine) {
      expect(info.dot).toBe('"·"');
      expect(info.offset, "room before the second count for the dot").toBeGreaterThan(16);
    } else {
      // the second count starts a line: its dot sits left of the box, so the wrapper must clip it
      expect(info.clip).toBe("hidden");
      expect(info.offset).toBeLessThan(1);
    }
  });
}

for (const width of [390, 320]) {
  test(
    `the phone stack is days (2 rows), track (1 row), counts at ${width}px`,
    { tag: DEVICE.tag },
    async ({ page }) => {
      await openHero(page, width);
      const m = await heroRects(page);
      expect(Math.round((m.status.b - m.status.y) / ROW)).toBe(4);
      expect(m.track.y).toBeGreaterThanOrEqual(m.days.b - 1);
      expect(m.packed.y).toBeGreaterThanOrEqual(m.track.b - 1);
      expect(Math.abs(m.packed.y - m.left.y)).toBeLessThan(2);
    },
  );
}

// A real long weather note (taller than the 140px a one-line note takes): the strip grows in whole 28px rows, nothing is
// clipped, and the rows after it stay on the rules.
const LONG_NOTE =
  "Expect a long spell of cool, damp weather with morning fog along the coast, gusty afternoon winds on the ridges, " +
  "and a real chance of rain on two of the three days, so pack a waterproof shell, warm layers, a hat and sturdy shoes " +
  "that can take wet ground, and keep a spare pair of socks and a light dry bag for your phone and papers handy.";
for (const width of WIDTHS) {
  test(`a weather note taller than 140px grows the strip in whole rows at ${width}px`, async ({
    page,
  }) => {
    await openHero(page, width);
    await injectWeather(page, "Mild and dry");
    const short = await page.locator(".weather-strip").boundingBox();
    // a one-line note keeps each cell at today's five rows (stacked below 721px: four cells)
    const stays = width <= 720 ? 4 : 1;
    expect(Math.round(short!.height), "one-line note").toBe(140 * stays);
    await page.evaluate((text) => {
      for (const note of document.querySelectorAll(".weather-note")) note.textContent = text;
    }, LONG_NOTE);
    const strip = await page.locator(".weather-strip").boundingBox();
    expect(strip!.height).toBeGreaterThan(140 * stays);
    expect(onGrid(strip!.height), `strip height ${strip!.height}`).toBeLessThanOrEqual(1);
    for (const cell of await page.locator(".weather-strip li").all()) {
      const box = (await cell.boundingBox())!;
      expect(onGrid(box.height), `cell height ${box.height}`).toBeLessThanOrEqual(1);
      const note = (await cell.locator(".weather-note").boundingBox())!;
      expect(note.y + note.height, "note inside its cell").toBeLessThanOrEqual(
        box.y + box.height + 0.5,
      );
    }
    const lineHeight = await page
      .locator(".weather-note")
      .first()
      .evaluate((el) => getComputedStyle(el).lineHeight);
    expect(lineHeight).toBe("28px");
    const rows = await rowBottoms(page);
    for (const [name, bottom] of Object.entries(rows)) {
      expect(onGrid(bottom), `${name} bottom ${bottom}`).toBeLessThanOrEqual(1);
    }
    expect(await overflow(page)).toEqual({ page: 0, hero: 0 });
  });
}

// Opt-in screenshots for design review (#290): HERO_SHOTS=<folder> renders the baseline and the worst case at each width,
// and the worst case with a long weather note. Skipped otherwise; nothing is written into the repo.
const SHOTS = process.env.HERO_SHOTS;
for (const width of WIDTHS) {
  test(`screenshots of the hero at ${width}px`, async ({ page }) => {
    test.skip(!SHOTS, "set HERO_SHOTS=<folder> to render the hero screenshots");
    const hero = await openHero(page, width);
    await hero.screenshot({ path: `${SHOTS}/baseline-${width}.png` });
    await worstCase(page);
    await hero.screenshot({ path: `${SHOTS}/worst-${width}.png` });
    await injectWeather(page, LONG_NOTE);
    await hero.screenshot({ path: `${SHOTS}/worst-weather-${width}.png` });
  });
}
