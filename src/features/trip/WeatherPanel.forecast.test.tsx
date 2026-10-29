// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { TripStop } from "@/domain/trip-stops";
import type { DayWeather, StopWeather } from "@/domain/weather/types";
import { FORECAST_DAY_CAP, WeatherPanel, type WeatherPanelProps } from "./WeatherPanel";

// #303: stays with forecast days read day by day; a stay with none reads exactly as it always did.
const TODAY = "2031-04-01";

const stopFor = (arrive: string, leave: string, city = "Harbor City", id = city): TripStop => ({
  location: {
    id,
    city,
    region: "Test",
    country: "Example",
    countryCode: "EX",
    label: city,
    latitude: 11.11,
    longitude: 22.22,
  },
  arrive,
  leave,
});

const addDay = (date: string, count: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + count * 86_400_000).toISOString().slice(0, 10);

/** `count` consecutive days from `start`, forecast or typical. */
function run(
  start: string,
  count: number,
  source: DayWeather["source"],
  over: Partial<DayWeather> = {},
): DayWeather[] {
  return Array.from({ length: count }, (_, at) => ({
    date: addDay(start, at),
    stopIndex: 0,
    source,
    highC: 20,
    lowC: 11,
    precipProbability: 0.1,
    precipMm: 0,
    snowCm: 0,
    uvIndexMax: source === "forecast" ? 4 : null,
    sunshineHours: 8,
    ...over,
  }));
}

function renderStays(
  stays: { stop: TripStop; days: DayWeather[] }[],
  over: Partial<WeatherPanelProps> = {},
) {
  const input: WeatherPanelProps = {
    stops: stays.map((stay) => stay.stop),
    state: {
      kind: "ready",
      stops: stays.map((stay, stopIndex): StopWeather => ({
        stopIndex,
        status: "ok",
        days: stay.days.map((entry) => ({ ...entry, stopIndex })),
      })),
    },
    unit: "C",
    today: TODAY,
    onOptIn: vi.fn(),
    onDecline: vi.fn(),
    onTurnOn: vi.fn(),
    onRefresh: vi.fn(),
    onReview: vi.fn(),
    ...over,
  };
  return render(<WeatherPanel {...input} />);
}

const rows = () => screen.getAllByRole("listitem").filter((el) => el.matches(".weather-row"));

describe("WeatherPanel daily forecast", () => {
  it("renders a typical-only stay exactly as before, with no daily list and no new tags", () => {
    renderStays([
      {
        stop: stopFor("2031-06-03", "2031-06-06"),
        days: run("2031-06-03", 3, "typical", { precipProbability: 0.5 }),
      },
    ]);
    const [row] = rows();
    expect(row.outerHTML).toBe(
      '<li class="weather-row">' +
        '<div class="weather-place"><h3>Harbor City</h3><p class="tiny muted">Jun 3–6 · 3 nights</p></div>' +
        '<div class="weather-range"><span aria-hidden="true">☂</span><strong>High 20° · Low 11°</strong></div>' +
        '<span class="weather-rain tag">Rain on 3 of 3 days</span>' +
        '<span class="weather-source typical">Typical for these dates</span>' +
        "</li>",
    );
    expect(screen.queryByRole("list", { name: /Daily forecast/ })).toBeNull();
    expect(
      screen.getByText("Typical weather is an average of the last 5 years, not a forecast."),
    ).toBeTruthy();
  });

  it("shows an all-forecast stay as a Forecast section and a daily list, with no old range or note", () => {
    renderStays([
      { stop: stopFor("2031-04-02", "2031-04-05"), days: run("2031-04-02", 3, "forecast") },
    ]);
    const [row] = rows();
    expect(within(row).getByText("Forecast").className).toBe("weather-source forecast");
    expect(within(row).getByText("High 20° · Low 11° · No rain expected")).toBeTruthy();
    expect(within(row).queryByText("Typical")).toBeNull();
    expect(row.querySelector(".weather-range")).toBeNull();
    expect(row.querySelector(".weather-mixed")).toBeNull();
    expect(screen.queryByText(/Later days are typical/)).toBeNull();
    // all forecast: the footnote about averages has no job
    expect(screen.queryByText(/Typical weather is an average/)).toBeNull();
    const list = screen.getByRole("list", { name: "Daily forecast for Harbor City" });
    expect(list.tagName).toBe("OL");
    expect(within(list).getAllByRole("listitem")).toHaveLength(3);
    expect(screen.queryByRole("button", { name: /Show/ })).toBeNull();
  });

  it("reads each day as one phrase for screen readers and hides the compact visual", () => {
    renderStays(
      [
        {
          stop: stopFor("2031-04-02", "2031-04-03"),
          days: run("2031-04-02", 1, "forecast", { precipProbability: 0.1 }),
        },
      ],
      { today: "2031-04-01" },
    );
    const item = screen.getByRole("list", { name: /Daily forecast/ }).children[0] as HTMLElement;
    expect(item.getAttribute("aria-label")).toBeNull();
    expect(item.querySelector(".sr-only")?.textContent).toBe(
      "Wednesday 2 April: sunny, high 20, low 11, 10% chance of rain",
    );
    expect(item.querySelector(".weather-day-label")?.textContent).toBe("Wed Apr 2");
    expect(item.querySelector(".weather-day-temps")?.textContent).toBe("20° / 11°");
    expect(item.querySelector(".weather-day-rain")?.textContent).toBe("10% rain");
    for (const visual of item.querySelectorAll(":scope > :not(.sr-only)")) {
      expect(visual.getAttribute("aria-hidden")).toBe("true");
    }
  });

  it("labels the first day Today and marks rain and snow by glyph, not colour", () => {
    renderStays([
      {
        stop: stopFor("2031-04-01", "2031-04-04"),
        days: [
          ...run("2031-04-01", 1, "forecast"),
          ...run("2031-04-02", 1, "forecast", { precipProbability: 0.4 }),
          ...run("2031-04-03", 1, "forecast", { snowCm: 2, precipProbability: 0.9 }),
        ],
      },
    ]);
    const items = Array.from(
      screen.getByRole("list", { name: /Daily forecast/ }).children,
    ) as HTMLElement[];
    expect(items.map((li) => li.querySelector(".weather-day-label")?.textContent)).toEqual([
      "Today Apr 1",
      "Wed Apr 2",
      "Thu Apr 3",
    ]);
    expect(items.map((li) => li.querySelector(".weather-day-glyph")?.textContent)).toEqual([
      "☀",
      "☂",
      "❄",
    ]);
    expect(items[1].querySelector(".sr-only")?.textContent).toContain("rain likely");
    expect(items[2].querySelector(".sr-only")?.textContent).toContain("snow likely");
  });

  it("caps at 7 days and toggles Show all N days / Show first 7 with aria-expanded", async () => {
    renderStays([
      { stop: stopFor("2031-04-01", "2031-04-17"), days: run("2031-04-01", 16, "forecast") },
    ]);
    const list = screen.getByRole("list", { name: /Daily forecast/ });
    expect(FORECAST_DAY_CAP).toBe(7);
    expect(within(list).getAllByRole("listitem")).toHaveLength(7);
    const button = screen.getByRole("button", { name: "Show all 16 days" });
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(button.getAttribute("aria-controls")).toBe(list.id);
    // the summary line is about all the forecast days, not only the seven shown
    expect(screen.getByText("High 20° · Low 11° · No rain expected")).toBeTruthy();

    await userEvent.click(button);
    expect(within(list).getAllByRole("listitem")).toHaveLength(16);
    const back = screen.getByRole("button", { name: "Show first 7" });
    expect(back.getAttribute("aria-expanded")).toBe("true");
    await userEvent.click(back);
    expect(within(list).getAllByRole("listitem")).toHaveLength(7);
  });

  it("shows exactly 7 days without a toggle, and 8 with one", () => {
    const { unmount } = renderStays([
      { stop: stopFor("2031-04-01", "2031-04-08"), days: run("2031-04-01", 7, "forecast") },
    ]);
    expect(screen.queryByRole("button", { name: /Show/ })).toBeNull();
    unmount();
    renderStays([
      { stop: stopFor("2031-04-01", "2031-04-09"), days: run("2031-04-01", 8, "forecast") },
    ]);
    expect(screen.getByRole("button", { name: "Show all 8 days" })).toBeTruthy();
  });

  it("keeps each stay's toggle to itself", async () => {
    renderStays([
      { stop: stopFor("2031-04-01", "2031-04-10", "Aaa"), days: run("2031-04-01", 9, "forecast") },
      { stop: stopFor("2031-04-10", "2031-04-19", "Bbb"), days: run("2031-04-10", 9, "forecast") },
    ]);
    await userEvent.click(screen.getAllByRole("button", { name: "Show all 9 days" })[0]);
    expect(
      within(screen.getByRole("list", { name: "Daily forecast for Aaa" })).getAllByRole("listitem"),
    ).toHaveLength(9);
    expect(
      within(screen.getByRole("list", { name: "Daily forecast for Bbb" })).getAllByRole("listitem"),
    ).toHaveLength(7);
  });

  it("splits a stay that straddles the window: forecast days daily, the rest in a separate Typical summary", () => {
    renderStays([
      {
        stop: stopFor("2031-04-12", "2031-04-26"),
        days: [
          ...run("2031-04-12", 5, "forecast"),
          ...run("2031-04-17", 9, "typical", { highC: 15, lowC: 8, precipProbability: 0.5 }),
        ],
      },
    ]);
    const [row] = rows();
    const forecastTag = within(row).getByText("Forecast");
    const typicalTag = within(row).getByText("Typical");
    expect(typicalTag.className).toBe("weather-source typical");
    // the two kinds of number never sit under one tag
    expect(forecastTag.parentElement).not.toBe(typicalTag.parentElement);
    expect(forecastTag.parentElement?.textContent).toBe(
      "ForecastHigh 20° · Low 11° · No rain expected",
    );
    expect(typicalTag.parentElement?.textContent).toBe(
      "TypicalOther 9 days: High 15° · Low 8° · Rain on 9 of 9 days",
    );
    expect(screen.queryByText(/Later days are typical/)).toBeNull();
    expect(
      within(screen.getByRole("list", { name: /Daily forecast/ })).getAllByRole("listitem"),
    ).toHaveLength(5);
    // the typical summary is never a list
    expect(typicalTag.parentElement?.closest("ol")).toBeNull();
    expect(screen.getByText(/Typical weather is an average/)).toBeTruthy();
  });

  it("handles a stay already under way: past typical days, the forecast, then later typical days", () => {
    renderStays([
      {
        stop: stopFor("2031-03-28", "2031-04-22"),
        days: [
          ...run("2031-03-28", 4, "typical", { lowC: 2 }),
          ...run("2031-04-01", 16, "forecast"),
          ...run("2031-04-17", 5, "typical", { highC: 25 }),
        ],
      },
    ]);
    const [row] = rows();
    expect(within(row).getByText(/Other 9 days: High 25° · Low 2° · Rarely rains/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Show all 16 days" })).toBeTruthy();
    const dates = Array.from(row.querySelectorAll(".weather-day-label")).map(
      (el) => el.textContent,
    );
    expect(dates[0]).toBe("Today Apr 1");
    expect(dates).toHaveLength(7);
  });

  it("words a single forecast day in the singular", () => {
    const { unmount } = renderStays([
      { stop: stopFor("2031-04-02", "2031-04-02"), days: run("2031-04-02", 1, "forecast") },
    ]);
    expect(screen.getByText("High 20° · Low 11° · No rain expected")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Show/ })).toBeNull();
    unmount();
    renderStays([
      {
        stop: stopFor("2031-04-02", "2031-04-03"),
        days: [
          ...run("2031-04-02", 1, "forecast", { precipProbability: 0.8 }),
          ...run("2031-04-03", 1, "typical"),
        ],
      },
    ]);
    expect(screen.getByText("High 20° · Low 11° · Rain on 1 of 1 day")).toBeTruthy();
    expect(screen.getByText(/Other 1 day: High 20° · Low 11° · Rarely rains/)).toBeTruthy();
  });

  it("shows Fahrenheit with three-digit temperatures in the rows and the summaries", () => {
    renderStays(
      [
        {
          stop: stopFor("2031-04-02", "2031-04-04"),
          days: [...run("2031-04-02", 2, "forecast", { highC: 40, lowC: 31 })],
        },
      ],
      { unit: "F" },
    );
    expect(screen.getByText("High 104° · Low 88° · No rain expected")).toBeTruthy();
    expect(document.querySelector(".weather-day-temps")?.textContent).toBe("104° / 88°");
  });

  it("keeps the other stays on their own rows: typical-only beside a forecast stay", () => {
    renderStays([
      { stop: stopFor("2031-04-02", "2031-04-04", "Near"), days: run("2031-04-02", 2, "forecast") },
      { stop: stopFor("2031-09-02", "2031-09-04", "Far"), days: run("2031-09-02", 2, "typical") },
    ]);
    const [near, far] = rows();
    expect(near.classList.contains("weather-row-forecast")).toBe(true);
    expect(far.className).toBe("weather-row");
    expect(within(far).getByText("Typical for these dates")).toBeTruthy();
    expect(within(far).queryByText("Forecast")).toBeNull();
  });

  it("uses the clock for Today when no date is passed", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2031-04-02T10:00:00Z"));
    try {
      renderStays(
        [{ stop: stopFor("2031-04-02", "2031-04-04"), days: run("2031-04-02", 2, "forecast") }],
        { today: undefined },
      );
      expect(document.querySelector(".weather-day-label")?.textContent).toBe("Today Apr 2");
    } finally {
      vi.useRealTimers();
    }
  });
});
