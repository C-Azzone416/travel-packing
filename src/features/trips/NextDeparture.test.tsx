// @vitest-environment jsdom
import { cleanup, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderInApp } from "@/test/providers";
import { sampleLifecycleState } from "./fixtures";
import { NextDeparture, type NextDepartureProps } from "./NextDeparture";
import { departureView, tripCardView } from "./view";

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
  const forecast = (days: number, more = 0) => ({
    stopIndex: 0,
    city: "Lisbon",
    days: Array.from({ length: days }, (_, n) => day(n, (["sun", "rain", "snow"] as const)[n % 3])),
    more,
  });
  const ready = (forecastValue?: ReturnType<typeof forecast> | null) => ({
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
