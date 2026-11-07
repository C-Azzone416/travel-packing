// @vitest-environment jsdom
// The phone forecast card on its own (#386): the pure helpers, the empty state, and where focus goes after a row is resolved.
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import type { TripStop } from "@/domain/trip-stops";
import type { WeatherChange } from "@/domain/weather/diff";
import type { DayWeather, StopWeather } from "@/domain/weather/types";
import { dayView } from "../weather-view";
import { ForecastPhone, phoneReviewHeading, rainSpan } from "./ForecastPhone";
import type { Suggestion } from "./packing-model";

const day = (date: string, rain: number): DayWeather => ({
  date,
  stopIndex: 0,
  source: "forecast",
  highC: 15,
  lowC: 8,
  precipProbability: rain,
  precipMm: 0,
  snowCm: 0,
  uvIndexMax: 2,
  sunshineHours: 3,
});
// 2026-09-03 is a Thursday.
const days = [
  dayView(day("2026-09-03", 0.8), "F", "2026-09-01"),
  dayView(day("2026-09-04", 0.9), "F", "2026-09-01"),
  dayView(day("2026-09-05", 0.7), "F", "2026-09-01"),
  dayView(day("2026-09-06", 0.3), "F", "2026-09-01"),
];

const addChange = (tag: string, id: string): WeatherChange =>
  ({
    kind: "add",
    semanticId: id,
    ruleSignature: `sig-${id}`,
    title: id,
    reason: "Rain likely in Lisbon",
    item: { semanticId: id, name: id, category: "Accessories", qty: 1, optional: false, tag },
  }) as unknown as WeatherChange;
const suggestion = (id: string, tag = "Rain"): Suggestion => ({
  change: addChange(tag, id),
  name: id,
  destination: "Rain gear",
  stopIndex: 0,
  verb: "Add",
});

describe("rainSpan and phoneReviewHeading", () => {
  it("names the first and last rainy day, one day alone, and nothing when it is dry", () => {
    expect(rainSpan(days)).toBe("Thu–Sat");
    expect(rainSpan([days[1]])).toBe("Fri");
    expect(rainSpan([days[3]])).toBeNull();
    expect(rainSpan([])).toBeNull();
  });

  it("is 'New: rain Thu–Sat' for a rain-only change, and just the tags otherwise", () => {
    expect(phoneReviewHeading([suggestion("a"), suggestion("b")], days)).toBe("New: rain Thu–Sat");
    expect(phoneReviewHeading([suggestion("a")], [days[3]])).toBe("New: rain");
    expect(phoneReviewHeading([suggestion("a", "Cold")], days)).toBe("New: cold");
    expect(phoneReviewHeading([suggestion("a"), suggestion("b", "Heat")], days)).toBe(
      "New: rain, heat",
    );
    const remove = { ...suggestion("c"), change: { kind: "remove" } as unknown as WeatherChange };
    expect(phoneReviewHeading([remove], days)).toBe("New: weather changes");
  });
});

const stop = (city: string): TripStop =>
  ({
    location: { id: city, city, latitude: 1, longitude: 2, country: "X", region: "" },
    arrive: "2026-09-03",
    leave: "2026-09-07",
  }) as unknown as TripStop;
const weather: StopWeather[] = [
  {
    stopIndex: 0,
    status: "ok",
    days: days.map((entry) => day(entry.date, entry.rainPercent / 100)),
  },
];

function Harness({ initial }: { initial: Suggestion[] }) {
  const [rows, setRows] = useState(initial);
  return (
    <ForecastPhone
      stops={[stop("Lisbon")]}
      state={{ kind: "ready", stops: weather }}
      unit="F"
      today="2026-09-01"
      suggestions={rows}
      busy={false}
      onResolve={(entry) => setRows((all) => all.filter((one) => one !== entry))}
      onRefresh={vi.fn()}
      placeholder={<p>placeholder</p>}
    />
  );
}

describe("ForecastPhone", () => {
  it("draws nothing without stops, and the placeholder while the weather is not usable", () => {
    const { container, rerender } = render(
      <ForecastPhone
        stops={[]}
        state={{ kind: "off" }}
        unit="F"
        today="2026-09-01"
        suggestions={[]}
        busy={false}
        onResolve={vi.fn()}
        onRefresh={vi.fn()}
        placeholder={<p>placeholder</p>}
      />,
    );
    expect(container.textContent).toBe("");
    rerender(
      <ForecastPhone
        stops={[stop("Lisbon")]}
        state={{ kind: "off" }}
        unit="F"
        today="2026-09-01"
        suggestions={[]}
        busy={false}
        onResolve={vi.fn()}
        onRefresh={vi.fn()}
        placeholder={<p>placeholder</p>}
      />,
    );
    expect(screen.getByText("placeholder")).toBeTruthy();
  });

  it("with nothing pending the card is not outlined and has no review button", () => {
    render(<Harness initial={[]} />);
    const card = screen.getByRole("region", { name: "Forecast" });
    expect(card.getAttribute("data-forecast-state")).toBe("normal");
    expect(within(card).queryByRole("button", { name: /to review/ })).toBeNull();
    expect(within(card).getByRole("list", { name: "Daily forecast for Lisbon" })).toBeTruthy();
  });

  it("says 'New: rain Thu–Sat' over the rows, and moves focus Add to Add, then to the city", async () => {
    const user = userEvent.setup();
    render(<Harness initial={[suggestion("Rain shell"), suggestion("Compact umbrella")]} />);
    await user.click(screen.getByRole("button", { name: "2 to review" }));
    expect(screen.getByText("New: rain Thu–Sat")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Add Rain shell to Rain gear" }));
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Add Compact umbrella to Rain gear" }),
    );
    await user.click(screen.getByRole("button", { name: "Dismiss Compact umbrella" }));
    expect(document.activeElement?.textContent).toBe("Lisbon");
    expect(screen.queryByRole("button", { name: /to review/ })).toBeNull();
  });

  it("with several cities the last resolved row puts focus on that city's tab", async () => {
    const user = userEvent.setup();
    function Two() {
      const [rows, setRows] = useState([suggestion("Rain shell")]);
      return (
        <ForecastPhone
          stops={[stop("Lisbon"), stop("Porto")]}
          state={{ kind: "ready", stops: weather }}
          unit="F"
          today="2026-09-01"
          suggestions={rows}
          busy={false}
          onResolve={() => setRows([])}
          onRefresh={vi.fn()}
          placeholder={null}
        />
      );
    }
    render(<Two />);
    await user.click(screen.getByRole("button", { name: "1 to review" }));
    await user.click(screen.getByRole("button", { name: "Add Rain shell to Rain gear" }));
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Lisbon" }));
  });

  it("says a stop's weather is unavailable, and Try again asks again", async () => {
    const user = userEvent.setup();
    const onRefresh = vi.fn();
    render(
      <ForecastPhone
        stops={[stop("Lisbon"), stop("Porto")]}
        state={{
          kind: "ready",
          stops: [weather[0], { stopIndex: 1, status: "unavailable", days: [] }],
        }}
        unit="F"
        today="2026-09-01"
        suggestions={[]}
        busy={false}
        onResolve={vi.fn()}
        onRefresh={onRefresh}
        placeholder={null}
      />,
    );
    await user.click(screen.getByRole("tab", { name: "Porto" }));
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });
});
