// @vitest-environment jsdom
import { cleanup, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderInApp } from "@/test/providers";
import { sampleLifecycleState } from "./fixtures";
import { NextDeparture, type NextDepartureProps } from "./NextDeparture";
import { departureView, tripCardView, type HeroForecast } from "./view";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: vi.fn() }),
}));

const TODAY = "2026-10-16";

function setup(
  over: Partial<ReturnType<typeof tripCardView>> = {},
  props: Partial<NextDepartureProps> = {},
) {
  const trip = sampleLifecycleState().trips[0];
  const view = { ...tripCardView(trip, TODAY, "upcoming"), ...over };
  renderInApp(
    <NextDeparture
      trip={trip}
      view={view}
      departure={departureView(trip, TODAY)}
      weather={{ phase: "none" }}
      busy={false}
      onEdit={vi.fn()}
      onAddItem={vi.fn()}
      onBathroom={vi.fn()}
      onEditExisting={vi.fn()}
      onArchive={vi.fn()}
      onRemove={vi.fn()}
      {...props}
    />,
  );
  return { view };
}

const hero = () => screen.getByRole("article");
const meta = () => hero().querySelector(".ledger-meta") as HTMLElement;

describe("the hero's metadata line (#285)", () => {
  it("shows the place, then the dates and nights, as two segments of one line", () => {
    setup({ place: "California, United States", route: [] });
    const segments = meta().querySelectorAll(".ledger-meta-line > span");
    expect(segments).toHaveLength(2);
    expect(segments[0].textContent).toContain("California, United States");
    expect(segments[0].classList.contains("ledger-meta-place")).toBe(true);
    expect(segments[1].classList.contains("ledger-meta-dates")).toBe(true);
    expect(segments[1].textContent).toMatch(/\d nights?$/);
  });

  it("keeps a very long place in one segment (it wraps inside itself)", () => {
    const place = "San Francisco Bay Area and Napa Valley, California, United States of America";
    setup({ place, route: [] });
    expect(meta().querySelectorAll(".ledger-meta-place")).toHaveLength(1);
    expect(meta().textContent).toContain(place);
  });

  it("shows the route in the place segment for a multi-stop trip", () => {
    setup({ route: ["Lisbon", "Porto", "Madrid"], routeIsTitle: false, place: "ignored" });
    const place = meta().querySelector(".ledger-meta-place") as HTMLElement;
    expect(within(place).getByText("Route: Lisbon, then Porto, then Madrid.")).toBeTruthy();
    expect(meta().textContent).not.toContain("ignored");
  });

  it("shows dates only when the route is the title", () => {
    setup({ route: ["Lisbon", "Porto"], routeIsTitle: true, place: "Portugal" });
    expect(meta().querySelector(".ledger-meta-place")).toBeNull();
    expect(meta().querySelectorAll(".ledger-meta-line > span")).toHaveLength(1);
  });

  it("shows dates only when there is no place", () => {
    setup({ place: null, route: [] });
    expect(meta().querySelector(".ledger-meta-place")).toBeNull();
    expect(meta().querySelector(".ledger-meta-dates")).not.toBeNull();
  });

  it("does not reuse the shared .item-meta or .ledger-dates classes", () => {
    setup({ place: "Somewhere", route: [] });
    expect(hero().querySelector(".item-meta, .ledger-dates, .ledger-hero-bottom")).toBeNull();
  });
});

describe("the hero's status row (#285)", () => {
  it("reads days to go, the progress bar, packed, then remaining, in the DOM", () => {
    setup({ packed: 6, total: 32, remaining: 26, percent: 19, ready: false });
    const row = hero().querySelector(".ledger-status-row") as HTMLElement;
    const kids = Array.from(row.children);
    expect(kids.map((el) => el.className)).toEqual([
      "days-to-go",
      "progress-track",
      "ledger-counts",
    ]);
    const counts = Array.from(kids[2].children).map((el) => el.textContent);
    expect(counts).toEqual(["6 of 32 packed", "26 left"]);
  });

  it("names the progress bar and gives its value text", () => {
    setup({ packed: 6, total: 32, remaining: 26, percent: 19, ready: false });
    const bar = screen.getByRole("progressbar", { name: /packing progress$/ });
    expect(bar.getAttribute("aria-valuenow")).toBe("19");
    expect(bar.getAttribute("aria-valuetext")).toBe("19% packed");
    expect((bar.firstElementChild as HTMLElement).style.width).toBe("19%");
  });

  it("shows an empty track at 0%", () => {
    setup({ packed: 0, total: 32, remaining: 32, percent: 0, ready: false });
    const bar = screen.getByRole("progressbar");
    expect(bar.getAttribute("aria-valuetext")).toBe("0% packed");
    expect((bar.firstElementChild as HTMLElement).style.width).toBe("0%");
    expect(screen.getByText("32 left")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Continue packing/ })).toBeTruthy();
  });

  it("shows the exact link text per state: Continue packing when not ready, Review bag when ready (#290)", () => {
    setup({ packed: 6, total: 32, remaining: 26, percent: 19, ready: false });
    const link = () => hero().querySelector(".ledger-actions a") as HTMLElement;
    expect(link().textContent).toBe("Continue packing");
    cleanup();
    setup({ packed: 32, total: 32, remaining: 0, percent: 100, ready: true });
    expect(link().textContent).toBe("Review bag");
  });

  it("shows a full track, Ready to go and Review bag at 100%", () => {
    setup({ packed: 32, total: 32, remaining: 0, percent: 100, ready: true });
    const bar = screen.getByRole("progressbar");
    expect(bar.getAttribute("aria-valuetext")).toBe("100% packed");
    expect((bar.firstElementChild as HTMLElement).style.width).toBe("100%");
    expect(screen.getByText("Ready to go")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Review bag/ })).toBeTruthy();
  });

  it("puts the actions after the status row, outside it", () => {
    setup();
    const status = hero().querySelector(".ledger-status") as HTMLElement;
    const actions = hero().querySelector(".ledger-actions") as HTMLElement;
    expect(status.compareDocumentPosition(actions) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(status.contains(actions)).toBe(false);
    expect(actions.firstElementChild?.textContent).toMatch(/Continue packing|Review bag/);
  });

  it("keeps everything above the weather note in one fixed-height block, and the note after it (#290)", () => {
    setup(
      {},
      {
        weather: {
          phase: "ready",
          cells: [
            {
              stopIndex: 0,
              city: "Lisbon",
              dates: "Oct 20 – Oct 24",
              glyph: "rain",
              range: "14° / 9°",
              note: "Rain on 2 of 5 days",
              source: "Forecast",
            },
          ],
        },
      },
    );
    const cell = hero().querySelector(".weather-strip li") as HTMLElement;
    const top = cell.querySelector(":scope > .weather-cell-top") as HTMLElement;
    expect(within(top).getByText("Lisbon")).toBeTruthy();
    expect(top.textContent).toContain("14° / 9° Forecast");
    expect(top.querySelector(".weather-note")).toBeNull();
    expect(cell.lastElementChild?.className).toBe("weather-note");
    expect(cell.lastElementChild?.textContent).toBe("Rain on 2 of 5 days");
  });
});

describe("the daily forecast block (#303)", () => {
  const cell = {
    stopIndex: 0,
    city: "Lisbon",
    dates: "Oct 20 – Oct 24",
    glyph: "rain" as const,
    range: "14° / 9°",
    note: "Rain on 2 of 5 days",
    source: "Forecast",
  };
  const day = (n: number, glyph: "sun" | "rain" | "snow", month = "Oct") => ({
    date: `2026-10-${20 + n}`,
    label: `Mon ${month} ${20 + n}`,
    parts: { weekday: "Mon", month, day: 20 + n },
    spoken: `Monday ${20 + n} October: ${glyph}, high 14, low 9, 10% chance of rain`,
    glyph,
    high: 14,
    low: 9,
    rainPercent: 10,
  });
  const forecast = (days: number, more = 0, over: Partial<HeroForecast> = {}): HeroForecast => ({
    city: "Lisbon",
    days: Array.from({ length: days }, (_, n) => day(n, (["sun", "rain", "snow"] as const)[n % 3])),
    more,
    forecastTotal: days + more,
    totalDays: days + more,
    typical: null,
    otherForecastStays: false,
    ...over,
  });
  const ready = (forecastValue?: HeroForecast | null) => ({
    phase: "ready" as const,
    cells: [cell],
    forecast: forecastValue,
  });
  const block = () => hero().querySelector(".hero-forecast") as HTMLElement | null;

  it("renders no block without a forecast (typical-only, or the field absent)", () => {
    setup({}, { weather: ready(null) });
    expect(block()).toBeNull();
    cleanup();
    setup({}, { weather: ready(undefined) });
    expect(block()).toBeNull();
  });

  it("sits right after the weather strip as its sibling, never inside a cell", () => {
    setup({}, { weather: ready(forecast(3)) });
    const strip = hero().querySelector(".weather-strip") as HTMLElement;
    expect(strip.nextElementSibling).toBe(block());
    expect(strip.contains(block())).toBe(false);
    expect(strip.querySelector(".hero-days, .hero-day")).toBeNull();
  });

  it("is a labelled section: the Forecast tag, the city, then one list item per day", () => {
    setup({}, { weather: ready(forecast(3)) });
    const section = screen.getByRole("region", { name: "Forecast for Lisbon" });
    expect(section).toBe(block());
    expect(section.querySelector(".weather-source.forecast")?.textContent).toBe("Forecast");
    expect(section.querySelector(".hero-forecast-head")?.textContent).toBe("ForecastLisbon");
    expect(within(section).getAllByRole("listitem")).toHaveLength(3);
    expect(section.querySelector(".hero-days-more")).toBeNull();
  });

  it("reads each day as one sentence and hides the compact visuals", () => {
    setup({}, { weather: ready(forecast(2)) });
    const first = within(block()!).getAllByRole("listitem")[0];
    expect(first.querySelector(".sr-only")?.textContent).toBe(
      "Monday 20 October: sun, high 14, low 9, 10% chance of rain",
    );
    for (const name of ["label", "glyph", "temps"]) {
      expect(first.querySelector(`.hero-day-${name}`)?.getAttribute("aria-hidden")).toBe("true");
    }
    expect(first.getAttribute("aria-label")).toBeNull();
    expect(first.querySelector(".hero-day-label")?.textContent).toBe("Mon Oct 20");
    expect(first.querySelector(".hero-day-month")?.textContent).toBe("Oct ");
    expect(first.querySelector(".hero-day-temps")?.textContent).toBe("14° / 9°");
  });

  it("draws the sun, rain and snow marks from the day glyph, not from colour", () => {
    setup({}, { weather: ready(forecast(3)) });
    const marks = [...block()!.querySelectorAll(".hero-day-glyph")].map((el) => el.textContent);
    expect(marks).toEqual(["☀", "☂", "❄"]);
  });

  it("links to the trip page with the number of days left out, and no link at exactly 7", () => {
    setup({}, { weather: ready(forecast(7, 5)) });
    const link = screen.getByRole("link", {
      name: "5 more forecast days for Lisbon on the trip page",
    });
    expect(link.textContent).toBe("+5 more days");
    expect(link.getAttribute("href")).toMatch(/^\/trips\/.+/);
    cleanup();
    setup({}, { weather: ready(forecast(7, 1)) });
    const one = screen.getByRole("link", {
      name: "1 more forecast day for Lisbon on the trip page",
    });
    expect(one.textContent).toBe("+1 more day");
    cleanup();
    setup({}, { weather: ready(forecast(7, 0)) });
    expect(screen.queryByRole("link", { name: /more forecast/ })).toBeNull();
  });
});

describe("the weather band: typical days and the other stays (#357, #358)", () => {
  const cell = (over: Record<string, string | number> = {}) => ({
    stopIndex: 0,
    city: "Lisbon",
    dates: "Oct 20 – Oct 24",
    glyph: "sun" as const,
    range: "14° / 9°",
    note: "Mostly dry",
    source: "Forecast",
    ...over,
  });
  const day = (n: number) => ({
    date: `2026-10-${20 + n}`,
    label: `Mon Oct ${20 + n}`,
    parts: { weekday: "Mon", month: "Oct", day: 20 + n },
    spoken: `Monday ${20 + n} October: sunny, high 14, low 9, 10% chance of rain`,
    glyph: "sun" as const,
    high: 14,
    low: 9,
    rainPercent: 10,
  });
  const mixed = (over: Partial<HeroForecast> = {}): HeroForecast => ({
    city: "Lisbon",
    days: [day(0), day(1)],
    more: 0,
    forecastTotal: 2,
    totalDays: 4,
    typical: {
      line: "Other 2 days · Oct 22–23: High 18° · Low 11° · Rarely rains",
      range: "Oct 22–23",
      days: 2,
      note: "Beyond the 16-day forecast, so these days use the average of the last 5 years.",
    },
    otherForecastStays: false,
    ...over,
  });
  const band = () => hero().querySelector(".hero-weather") as HTMLElement;
  const FOOT = "Typical weather is an average of the last 5 years, not a forecast.";

  it("wraps the strip and the block in one band that knows how many stays it has", () => {
    setup({}, { weather: { phase: "ready", cells: [cell()], forecast: mixed() } });
    expect(band().getAttribute("data-stays")).toBe("1");
    const inner = band().firstElementChild as HTMLElement;
    expect(inner.className).toBe("hero-weather-band");
    expect([...inner.children].map((el) => el.className)).toEqual([
      "weather-strip",
      "hero-forecast",
    ]);
    cleanup();
    setup(
      {},
      {
        weather: { phase: "ready", cells: [cell(), cell({ stopIndex: 1, city: "Porto" })] },
      },
    );
    expect(band().getAttribute("data-stays")).toBe("2");
  });

  it("names the forecast days out of all days only when the stay also has typical days", () => {
    setup({}, { weather: { phase: "ready", cells: [cell()], forecast: mixed() } });
    expect(hero().querySelector(".hero-forecast-head")?.textContent).toBe(
      "ForecastLisbon · 2 of 4 days",
    );
    cleanup();
    setup(
      {},
      {
        weather: {
          phase: "ready",
          cells: [cell()],
          forecast: mixed({ typical: null, totalDays: 2 }),
        },
      },
    );
    expect(hero().querySelector(".hero-forecast-head")?.textContent).toBe("ForecastLisbon");
  });

  it("puts the Typical row after the day list, as plain readable text with its reason", () => {
    setup({}, { weather: { phase: "ready", cells: [cell()], forecast: mixed() } });
    const section = hero().querySelector(".hero-forecast") as HTMLElement;
    const row = section.querySelector(".hero-typical") as HTMLElement;
    const list = section.querySelector(".hero-days") as HTMLElement;
    expect(list.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(section.lastElementChild).toBe(row);
    expect(row.querySelector(".weather-source.typical")?.textContent).toBe("Typical");
    expect(row.textContent).toBe(
      "TypicalOther 2 days · Oct 22–23: High 18° · Low 11° · Rarely rains" +
        "Beyond the 16-day forecast, so these days use the average of the last 5 years.",
    );
    // read aloud: nothing in the row is hidden, and no card stands for a typical day
    expect(row.querySelector("[aria-hidden]")).toBeNull();
    expect(within(section).getAllByRole("listitem")).toHaveLength(2);
    expect(row.querySelector("a, button")).toBeNull();
  });

  it("puts the Typical row after the +N more link", () => {
    setup(
      {},
      {
        weather: {
          phase: "ready",
          cells: [cell()],
          forecast: mixed({ more: 3, forecastTotal: 5, totalDays: 7 }),
        },
      },
    );
    const section = hero().querySelector(".hero-forecast") as HTMLElement;
    const more = section.querySelector(".hero-days-more") as HTMLElement;
    const row = section.querySelector(".hero-typical") as HTMLElement;
    expect(more.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("has no Typical row for an all-forecast stay", () => {
    setup({}, { weather: { phase: "ready", cells: [cell()], forecast: mixed({ typical: null }) } });
    expect(hero().querySelector(".hero-typical")).toBeNull();
    expect(hero().textContent).not.toContain("Typical");
  });

  it("links to the other stays' forecast only when another stay has forecast days", () => {
    setup(
      {},
      {
        weather: {
          phase: "ready",
          cells: [cell(), cell({ stopIndex: 1, city: "Porto" })],
          forecast: mixed({ typical: null, otherForecastStays: true }),
        },
      },
    );
    const link = screen.getByRole("link", {
      name: "Daily forecast for the other stays on the trip page",
    });
    expect(link.textContent).toBe("Daily forecast for the other stays");
    expect(link.getAttribute("href")).toMatch(/^\/trips\/.+/);
    const section = hero().querySelector(".hero-forecast") as HTMLElement;
    expect(section.lastElementChild).toBe(link.parentElement);
    cleanup();
    setup({}, { weather: { phase: "ready", cells: [cell()], forecast: mixed() } });
    expect(screen.queryByRole("link", { name: /other stays/ })).toBeNull();
  });

  it("keeps +N more before the other-stays link", () => {
    setup(
      {},
      {
        weather: {
          phase: "ready",
          cells: [cell()],
          forecast: mixed({ typical: null, more: 2, otherForecastStays: true }),
        },
      },
    );
    const links = within(hero().querySelector(".hero-forecast") as HTMLElement)
      .getAllByRole("link")
      .map((link) => link.textContent);
    expect(links).toEqual(["+2 more days", "Daily forecast for the other stays"]);
  });

  it("shows the footnote for a typical-only stay, once, and no card block", () => {
    setup({}, { weather: { phase: "ready", cells: [cell({ source: "Typical" })] } });
    expect(hero().querySelector(".hero-forecast")).toBeNull();
    expect(screen.getAllByText(FOOT)).toHaveLength(1);
    const foot = hero().querySelector(".hero-weather-foot") as HTMLElement;
    expect(foot.previousElementSibling?.className).toBe("weather-strip");
  });

  it("shows the footnote once when only a later stay is typical-only (block has no Typical row)", () => {
    setup(
      {},
      {
        weather: {
          phase: "ready",
          cells: [cell(), cell({ stopIndex: 1, city: "Porto", source: "Typical" })],
          forecast: mixed({ typical: null }),
        },
      },
    );
    expect(screen.getAllByText(FOOT)).toHaveLength(1);
    expect(hero().querySelector(".hero-weather-foot")?.previousElementSibling?.className).toBe(
      "hero-forecast",
    );
  });

  it("has no footnote when every stay is a forecast, or when the block's own Typical row explains it", () => {
    setup({}, { weather: { phase: "ready", cells: [cell()], forecast: mixed({ typical: null }) } });
    expect(screen.queryByText(FOOT)).toBeNull();
    cleanup();
    setup(
      {},
      {
        weather: {
          phase: "ready",
          cells: [cell(), cell({ stopIndex: 1, source: "Typical" })],
          forecast: mixed(),
        },
      },
    );
    expect(screen.queryByText(FOOT)).toBeNull();
  });
});
