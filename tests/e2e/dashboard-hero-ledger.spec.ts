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
    await page.evaluate(() => {
      const strip = document.createElement("ul");
      strip.className = "weather-strip";
      strip.innerHTML = [1, 2, 3, 4]
        .map(
          (n) =>
            `<li><span class="weather-glyph">☀</span><span class="weather-city">Stop ${n}</span>` +
            `<span class="weather-dates">Oct 2${n} – Oct 2${n + 1}</span>` +
            `<span class="weather-range">61–72°F <small>typical</small></span>` +
            `<span class="weather-note">Mild, pack a light layer</span></li>`,
        )
        .join("");
      document.querySelector(".ledger-hero-top")!.after(strip);
    });
    const strip = await page.locator(".weather-strip").boundingBox();
    const rows = await rowBottoms(page);
    for (const [name, bottom] of Object.entries(rows)) {
      expect(onGrid(bottom), `${name} bottom ${bottom}`).toBeLessThanOrEqual(1);
    }
    expect(onGrid(strip!.height), `strip height ${strip!.height}`).toBeLessThanOrEqual(1);
    expect(await overflow(page)).toEqual({ page: 0, hero: 0 });
  });
}
