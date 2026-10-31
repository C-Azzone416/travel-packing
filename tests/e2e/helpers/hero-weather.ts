import { expect, type Page } from "@playwright/test";
import type { Stay } from "./forecast-trip";

// The dashboard hero's weather band (#357, #358): the strip of stay cells, the daily-forecast block and the typical row
// read as one band. These helpers measure it in the page and assert the layout contract from the rects, never by eye.
// The mode (stacked, wide stack, two column, phone) is DERIVED from the measured band width and the em thresholds in
// globals.css (30em and 40em of the band's own font size), so a CSS change that moves a threshold fails here.

export const ROW = 28;
export const CHIP = ROW * 3;
export const WIDE_EM = 30;
export const TWO_COL_EM = 40;
export const MIN_CELL_EM = 14;
export const LEFT_MAX_EM = 17;

export const onGrid = (value: number) => Math.min(value % ROW, ROW - (value % ROW));

export interface Box {
  x: number;
  y: number;
  r: number;
  b: number;
}
export const heightOf = (box: Box) => box.b - box.y;
export const widthOf = (box: Box) => box.r - box.x;
export const intersects = (a: Box, b: Box) =>
  a.x < b.r - 0.5 && b.x < a.r - 0.5 && a.y < b.b - 0.5 && b.y < a.b - 0.5;

/** The trips the hero specs build. `cards` and `typical` are the split the fixture is meant to produce. */
export interface Fixture {
  name: string;
  stays: Stay[];
  /** Forecast cards shown (capped at 7). */
  cards: number;
  /** "+N more days" link, 0 for none. */
  more: number;
  /** Typical days in the first forecast stay's Typical row, 0 for none. */
  typical: number;
  /** Strip cells (one per stay). */
  cellCount: number;
  /** Another stay has forecast days: the "Daily forecast for the other stays" link. */
  otherStays: boolean;
  /** The footnote under the band (a typical-only stay and no Typical row to explain it). */
  foot: boolean;
}

// Day offsets from today (UTC). A single stop includes its leave day, so leave 2 / back 5 is 4 days; the forecast window
// is days 0..15.
export const F1: Fixture = {
  name: "F1 all forecast, 4 days",
  stays: [{ leave: 2, back: 5 }],
  cards: 4,
  more: 0,
  typical: 0,
  cellCount: 1,
  otherStays: false,
  foot: false,
};
export const F2: Fixture = {
  name: "F2 2 forecast + 2 typical",
  stays: [{ leave: 14, back: 17 }],
  cards: 2,
  more: 0,
  typical: 2,
  cellCount: 1,
  otherStays: false,
  foot: false,
};
export const F3: Fixture = {
  name: "F3 all typical, 4 days",
  stays: [{ leave: 30, back: 33 }],
  cards: 0,
  more: 0,
  typical: 0,
  cellCount: 1,
  otherStays: false,
  foot: true,
};
export const F4: Fixture = {
  name: "F4 1 forecast + 3 typical",
  stays: [{ leave: 15, back: 18 }],
  cards: 1,
  more: 0,
  typical: 3,
  cellCount: 1,
  otherStays: false,
  foot: false,
};
export const F5: Fixture = {
  name: "F5 5 days",
  stays: [{ leave: 3, back: 7 }],
  cards: 5,
  more: 0,
  typical: 0,
  cellCount: 1,
  otherStays: false,
  foot: false,
};
export const F6: Fixture = {
  name: "F6 7 days",
  stays: [{ leave: 2, back: 8 }],
  cards: 7,
  more: 0,
  typical: 0,
  cellCount: 1,
  otherStays: false,
  foot: false,
};
export const F7: Fixture = {
  name: "F7 9 days, +2 more",
  stays: [{ leave: 2, back: 10 }],
  cards: 7,
  more: 2,
  typical: 0,
  cellCount: 1,
  otherStays: false,
  foot: false,
};
export const F8: Fixture = {
  name: "F8 two stops, forecast then typical",
  stays: [{ leave: 12, back: 16 }, { leave: 30 }],
  cards: 4,
  more: 0,
  typical: 0,
  cellCount: 2,
  otherStays: false,
  foot: true,
};
export const F9: Fixture = {
  name: "F9 four stops, all forecast",
  stays: [{ leave: 2, back: 4 }, { leave: 6 }, { leave: 8 }, { leave: 10 }],
  cards: 2,
  more: 0,
  typical: 0,
  cellCount: 4,
  otherStays: true,
  foot: false,
};
export const F10: Fixture = {
  name: "F10 two stops, first mixed, second typical",
  stays: [{ leave: 14, back: 18 }, { leave: 30 }],
  cards: 2,
  more: 0,
  typical: 2,
  cellCount: 2,
  otherStays: false,
  foot: false,
};
export const F11: Fixture = {
  name: "F11 two stops, both forecast, first has +N more",
  stays: [{ leave: 2, back: 10 }, { leave: 13 }],
  cards: 7,
  more: 1,
  typical: 0,
  cellCount: 2,
  otherStays: true,
  foot: false,
};

export type Mode = "phone" | "stacked" | "wide" | "two-col";

/** Everything the band assertions need, measured in the page. */
export function measureBand(page: Page) {
  return page.evaluate(() => {
    const rect = (el: Element | null): Box | null => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left, y: r.top, r: r.right, b: r.bottom };
    };
    const must = (el: Element | null): Box => rect(el)!;
    const lines = (el: Element) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      return new Set(
        Array.from(range.getClientRects())
          .filter((r) => r.width > 0)
          .map((r) => Math.round(r.top)),
      ).size;
    };
    const clipped = (el: Element) => el.scrollWidth - el.clientWidth;
    const hero = document.querySelector<HTMLElement>(".ledger-hero")!;
    const band = document.querySelector<HTMLElement>(".hero-weather")!;
    const heroRect = hero.getBoundingClientRect();
    const forecast = document.querySelector<HTMLElement>(".hero-forecast");
    const typical = document.querySelector<HTMLElement>(".hero-typical");
    const root = document.documentElement;
    const inside = Array.from(band.querySelectorAll("*"))
      .filter((el) => !el.classList.contains("sr-only") && !el.closest(".sr-only"))
      .map((el) => ({ el, box: must(el) }))
      .filter(({ box }) => box.r - box.x > 0 || box.b - box.y > 0)
      .map(({ el, box }) => ({ name: `${el.tagName.toLowerCase()}.${el.className}`, box }));
    return {
      phone: matchMedia("(max-width: 720px)").matches,
      vw: innerWidth,
      gridTop: heroRect.top + hero.clientTop,
      hero: must(hero),
      padRight: heroRect.left + hero.clientLeft + hero.clientWidth,
      scroll: { page: root.scrollWidth - root.clientWidth, hero: clipped(hero) },
      band: must(band),
      em: parseFloat(getComputedStyle(band).fontSize),
      listEm: parseFloat(getComputedStyle(document.querySelector(".hero-days") ?? band).fontSize),
      stays: Number(band.dataset.stays),
      bandClipped: clipped(band),
      strip: must(band.querySelector(".weather-strip")),
      cells: Array.from(band.querySelectorAll(".weather-strip > li")).map((li) => ({
        box: must(li),
        clipped: clipped(li),
        top: must(li.querySelector(".weather-cell-top")),
      })),
      forecast: rect(forecast),
      forecastClipped: forecast ? clipped(forecast) : 0,
      head: rect(document.querySelector(".hero-forecast-head")),
      headTag: rect(document.querySelector(".hero-forecast-head .weather-source")),
      chips: Array.from(document.querySelectorAll(".hero-day")).map(must),
      list: rect(document.querySelector(".hero-days")),
      typical: rect(typical),
      typicalClipped: typical
        ? Math.max(...Array.from(typical.children).map((child) => clipped(child)), clipped(typical))
        : 0,
      typicalLines: typical
        ? Array.from(typical.querySelectorAll("p")).map((line) => lines(line))
        : [],
      typicalTag: rect(document.querySelector(".hero-typical .weather-source")),
      segmentLines: Array.from(document.querySelectorAll(".hero-typical .hero-seg")).map((seg) =>
        lines(seg),
      ),
      moreLinks: Array.from(document.querySelectorAll(".hero-days-more")).map(must),
      foot: rect(document.querySelector(".hero-weather-foot")),
      footClipped: (() => {
        const foot = document.querySelector(".hero-weather-foot");
        return foot ? clipped(foot) : 0;
      })(),
      status: must(document.querySelector(".ledger-status")),
      actions: must(document.querySelector(".ledger-actions")),
      separate: [
        ["days-to-go", ".days-to-go"],
        ["progress-track", ".progress-track"],
        ["ledger-counts", ".ledger-counts"],
      ].map(([name, selector]) => ({ name, box: must(document.querySelector(selector)) })),
      controls: Array.from(document.querySelectorAll(".ledger-actions > *")).map((el, at) => ({
        name: `action ${at}`,
        box: must(el),
      })),
      inside,
    };
  });
}

export type BandFacts = Awaited<ReturnType<typeof measureBand>>;

export function modeOf(m: BandFacts): Mode {
  if (m.phone) return "phone";
  const width = widthOf(m.band);
  if (width >= TWO_COL_EM * m.em && m.stays === 1 && m.forecast) return "two-col";
  if (width >= WIDE_EM * m.em) return "wide";
  return "stacked";
}

export interface BandOptions {
  /** A segment wider than the line may wrap inside itself (200% text on a narrow screen with a long date range). */
  allowSegmentWrap?: boolean;
  /** The body's 320px minimum belongs to #332: below 320px only containment is asserted. */
  containmentOnly?: boolean;
}

/**
 * The layout contract for one fixture at one width (E1, E2, E6, E7, E8, E9): the mode matches the measured width, whole
 * 28px rows, no overlap, nothing leaves the hero, no clipped text.
 */
export function expectBand(
  m: BandFacts,
  fixture: Fixture,
  width: number,
  options: BandOptions = {},
) {
  const where = `${fixture.name} at ${width}px`;
  const mode = modeOf(m);
  const em = m.em;
  const grid = (value: number, label: string) =>
    expect(onGrid(value), `${label} ${value} is whole rows, ${where}`).toBeLessThanOrEqual(1);

  // E1: the layout matches the mode the width calls for
  const cell = m.cells[0].box;
  if (mode === "two-col") {
    const forecast = m.forecast!;
    expect(forecast.x, `forecast to the right of the cell, ${where}`).toBeGreaterThanOrEqual(
      cell.r - 1,
    );
    expect(Math.abs(forecast.y - cell.y), `cell and forecast tops, ${where}`).toBeLessThanOrEqual(
      1,
    );
    // E2: no stranded space; the summary column is at most 17em and the days start at the cell's top
    expect(cell.r - m.band.x, `summary column width, ${where}`).toBeLessThanOrEqual(
      LEFT_MAX_EM * em + 1,
    );
    expect(cell.x, `cell starts at the band, ${where}`).toBeCloseTo(m.band.x, 0);
    expect(
      Math.abs(m.head!.y - cell.y),
      `days start at the cell's top, ${where}`,
    ).toBeLessThanOrEqual(1);
    expect(m.forecast!.r, `forecast reaches the band's right edge, ${where}`).toBeCloseTo(
      m.band.r,
      0,
    );
    for (const chip of m.chips) {
      // one to three days get wider chips (12em) so they fill more of the column; four or more stay at 8.5em
      // (the chips' em is the block's own 13px text, not the band's)
      const max = m.chips.length <= 3 ? 12 : 8.5;
      expect(widthOf(chip), `chip is at most ${max}em, ${where}`).toBeLessThanOrEqual(
        max * m.listEm + 0.5,
      );
      if (m.chips.length <= 3) {
        expect(widthOf(chip), `chip is 12em wide, ${where}`).toBeGreaterThanOrEqual(
          12 * m.listEm - 1,
        );
      }
    }
  } else {
    if (m.forecast) {
      expect(m.forecast.y, `forecast below the strip, ${where}`).toBeGreaterThanOrEqual(
        m.strip.b - 1,
      );
      expect(m.forecast.y, `forecast starts at the strip's end, ${where}`).toBeCloseTo(
        m.strip.b,
        0,
      );
      expect(m.forecast.x, `forecast full width, ${where}`).toBeCloseTo(m.band.x, 0);
      expect(m.forecast.r, `forecast full width, ${where}`).toBeCloseTo(m.band.r, 0);
    }
    if (mode === "wide") {
      // the cells are columns of at least 14em; a row of them when they fit, else they wrap
      // four stays are a balanced 2 x 2
      const fit = Math.max(1, Math.floor(widthOf(m.band) / (MIN_CELL_EM * em)));
      const perRow = m.cells.length === 4 ? Math.min(2, fit) : fit;
      const firstRow = m.cells.filter((c) => Math.abs(c.box.y - m.cells[0].box.y) < 1).length;
      expect(firstRow, `cells in the first row, ${where}`).toBe(Math.min(m.cells.length, perRow));
      for (const c of m.cells) {
        expect(widthOf(c.box), `cell is at least 14em, ${where}`).toBeGreaterThanOrEqual(
          Math.min(MIN_CELL_EM * em, widthOf(m.band)) - 1,
        );
      }
    } else {
      // stacked and phone: one cell per row
      m.cells.forEach((c, at) => {
        expect(c.box.x, `cell ${at} full width, ${where}`).toBeCloseTo(m.band.x, 0);
        if (at > 0) {
          expect(c.box.y, `cell ${at} below the previous, ${where}`).toBeGreaterThanOrEqual(
            m.cells[at - 1].box.b - 1,
          );
        }
      });
    }
  }
  expect(m.cells.length, `a cell per stay, ${where}`).toBe(fixture.cellCount);

  // E6: rhythm. Heights are whole rows; tops sit on the 28px rules of the hero
  grid(m.band.y - m.gridTop, "band top");
  for (const [at, c] of m.cells.entries()) {
    grid(heightOf(c.top), `cell ${at} top block`);
    grid(heightOf(c.box), `cell ${at} height`);
  }
  grid(heightOf(m.band), "band height");
  if (m.forecast) grid(heightOf(m.forecast), "forecast height");
  if (m.list) grid(heightOf(m.list), "list height");
  if (m.head) {
    grid(heightOf(m.head), "forecast head height");
    expect(heightOf(m.headTag!), `Forecast tag is one row, ${where}`).toBeCloseTo(ROW, 0);
  }
  for (const [at, chip] of m.chips.entries()) {
    if (!m.phone) expect(heightOf(chip), `chip ${at} height, ${where}`).toBeCloseTo(CHIP, 0);
    else grid(heightOf(chip), `phone row ${at} height`);
    grid(chip.y - m.gridTop, `chip ${at} top`);
  }
  for (const [at, link] of m.moreLinks.entries()) {
    expect(heightOf(link), `link row ${at} is one row, ${where}`).toBeCloseTo(ROW, 0);
    grid(link.y - m.gridTop, `link row ${at} top`);
  }
  if (m.typical) {
    grid(heightOf(m.typical), "typical row height");
    grid(m.typical.y - m.gridTop, "typical row top");
    expect(heightOf(m.typicalTag!), `Typical tag is one row, ${where}`).toBeCloseTo(ROW, 0);
    // the line breaks only between its " · " segments: each segment is one line
    expect(m.segmentLines.length, `typical segments, ${where}`).toBeGreaterThanOrEqual(3);
    if (!options.allowSegmentWrap) {
      for (const [at, count] of m.segmentLines.entries()) {
        expect(count, `typical segment ${at} is one line, ${where}`).toBe(1);
      }
    }
    // E9: the row is its two parts, each a whole number of 28px lines
    expect(m.typicalLines.length, `typical row has two parts, ${where}`).toBe(2);
    expect(
      heightOf(m.typical),
      `typical row is at least two lines, ${where}`,
    ).toBeGreaterThanOrEqual(ROW * 2 - 0.5);
  }
  if (m.foot) {
    grid(heightOf(m.foot), "footnote height");
    grid(m.foot.y - m.gridTop, "footnote top");
  }

  // E7: nothing overlaps, in the band or against what follows it
  const named: { name: string; box: Box }[] = [
    ...m.cells.map((c, at) => ({ name: `cell ${at}`, box: c.box })),
    ...(m.head ? [{ name: "forecast head", box: m.head }] : []),
    ...m.chips.map((box, at) => ({ name: `chip ${at}`, box })),
    ...(m.typical ? [{ name: "typical row", box: m.typical }] : []),
    ...m.moreLinks.map((box, at) => ({ name: `link row ${at}`, box })),
    ...(m.foot ? [{ name: "footnote", box: m.foot }] : []),
    ...m.separate,
    ...m.controls,
  ];
  named.forEach((a, i) =>
    named.slice(i + 1).forEach((b) => {
      expect(intersects(a.box, b.box), `${a.name} overlaps ${b.name}, ${where}`).toBe(false);
    }),
  );
  expect(m.status.y - m.band.b, `band to status gap, ${where}`).toBeGreaterThanOrEqual(ROW - 0.5);
  expect(m.band.b, `band above the actions, ${where}`).toBeLessThanOrEqual(m.actions.y + 0.5);

  // E8: nothing leaves the hero, nothing scrolls sideways
  for (const item of m.inside) {
    expect(item.box.x, `${item.name} inside the hero, ${where}`).toBeGreaterThanOrEqual(
      m.hero.x - 1,
    );
    expect(item.box.r, `${item.name} inside the hero, ${where}`).toBeLessThanOrEqual(
      m.padRight + 1,
    );
  }
  expect(m.bandClipped, `band does not scroll sideways, ${where}`).toBeLessThanOrEqual(0);
  // E9: no clipped text
  for (const [at, c] of m.cells.entries()) {
    expect(c.clipped, `cell ${at} text is not clipped, ${where}`).toBeLessThanOrEqual(0);
  }
  expect(m.forecastClipped, `forecast text is not clipped, ${where}`).toBeLessThanOrEqual(0);
  expect(m.typicalClipped, `typical text is not clipped, ${where}`).toBeLessThanOrEqual(0);
  expect(m.footClipped, `footnote is not clipped, ${where}`).toBeLessThanOrEqual(0);
  if (!options.containmentOnly) {
    expect(m.scroll, `scroll, ${where}`).toEqual({ page: 0, hero: 0 });
  }
}

/** E7, second half: the element at the centre of each neighbour is that neighbour (nothing paints over it). */
export function expectNothingCovered(page: Page, where: string) {
  return page
    .evaluate(() => {
      const failures: string[] = [];
      const probes: [string, Element][] = [];
      const one = (name: string, selector: string) => {
        const el = document.querySelector(selector);
        if (el) probes.push([name, el]);
      };
      one("days-to-go number", ".days-to-go strong");
      one("progress track", ".progress-track");
      document
        .querySelectorAll(".ledger-counts > span")
        .forEach((el, at) => probes.push([`count ${at}`, el]));
      document
        .querySelectorAll(".ledger-actions > *")
        .forEach((el, at) => probes.push([`action ${at}`, el]));
      for (const [name, el] of probes) {
        el.scrollIntoView({ block: "center", inline: "nearest" });
        const r = el.getBoundingClientRect();
        // a control that is not shown (the inline Add item form's buttons) has no box to cover
        if (r.width === 0 || r.height === 0) continue;
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        if (!hit || !(el === hit || el.contains(hit)))
          failures.push(`${name} hit ${hit?.tagName}.${hit?.className} ${JSON.stringify(r)}`);
      }
      window.scrollTo(0, 0);
      return failures;
    })
    .then((failures) => expect(failures, `covered by something else, ${where}`).toEqual([]));
}
