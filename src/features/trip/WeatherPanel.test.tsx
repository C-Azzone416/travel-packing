// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { TripStop } from "@/domain/trip-stops";
import type { DayWeather, StopWeather } from "@/domain/weather/types";
import { WeatherPanel, type WeatherPanelProps } from "./WeatherPanel";

const stops: TripStop[] = [
  {
    location: {
      id: "warm",
      city: "Warm City",
      region: "Test",
      country: "Example",
      countryCode: "EX",
      label: "Warm City",
      latitude: 11.11,
      longitude: 22.22,
    },
    arrive: "2031-04-03",
    leave: "2031-04-05",
  },
  {
    location: {
      id: "cool",
      city: "Cool City",
      region: "Test",
      country: "Example",
      countryCode: "EX",
      label: "Cool City",
      latitude: 33.33,
      longitude: 44.44,
    },
    arrive: "2031-04-05",
    leave: "2031-04-08",
  },
];

const day = (over: Partial<DayWeather>): DayWeather => ({
  date: "2031-04-03",
  stopIndex: 0,
  source: "forecast",
  highC: 30,
  lowC: 20,
  precipProbability: 0,
  precipMm: 0,
  snowCm: 0,
  uvIndexMax: 5,
  sunshineHours: 8,
  ...over,
});

const weather: StopWeather[] = [
  { stopIndex: 0, status: "ok", days: [day({}), day({ date: "2031-04-04" })] },
  {
    stopIndex: 1,
    status: "ok",
    days: [
      day({
        date: "2031-04-05",
        stopIndex: 1,
        source: "typical",
        highC: 12,
        lowC: 4,
        precipProbability: 0.6,
      }),
      day({
        date: "2031-04-06",
        stopIndex: 1,
        source: "typical",
        highC: 14,
        lowC: 3,
        precipProbability: 0.7,
      }),
      day({
        date: "2031-04-07",
        stopIndex: 1,
        highC: 13,
        lowC: 2,
        precipProbability: 0.5,
      }),
    ],
  },
];

function props(over: Partial<WeatherPanelProps> = {}): WeatherPanelProps {
  return {
    stops,
    state: { kind: "ready", stops: weather },
    unit: "F",
    onOptIn: vi.fn(),
    onDecline: vi.fn(),
    onTurnOn: vi.fn(),
    onRefresh: vi.fn(),
    onReview: vi.fn(),
    ...over,
  };
}

describe("WeatherPanel", () => {
  it("asks for opt-in inline with exact privacy copy and actions", async () => {
    const input = props({ state: { kind: "prompt" } });
    render(<WeatherPanel {...input} />);
    expect(screen.getByRole("heading", { name: "Get weather for your stops?" })).toBeTruthy();
    expect(screen.getByText(/Only map coordinates and dates are sent/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Weather data by Open-Meteo.com" })).toHaveProperty(
      "rel",
      "noopener noreferrer",
    );
    await userEvent.click(screen.getByRole("button", { name: "Get weather" }));
    await userEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(input.onOptIn).toHaveBeenCalledTimes(1);
    expect(input.onDecline).toHaveBeenCalledTimes(1);
  });

  it("does not prompt a custom-only trip", () => {
    const custom = [
      {
        ...stops[0],
        location: { ...stops[0].location, latitude: undefined, longitude: undefined },
      },
    ];
    render(<WeatherPanel {...props({ stops: custom, state: { kind: "prompt" } })} />);
    expect(
      screen.getByText("Weather needs a place from the map. Custom places are skipped."),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Get weather" })).toBeNull();
  });

  it("renders one accessible row per stop, units, source copy, rain and review count", async () => {
    const input = props({ changesCount: 2 });
    render(<WeatherPanel {...input} />);
    expect(screen.getByRole("list", { name: "Weather by stop" }).children).toHaveLength(2);
    expect(screen.getByText("High 86° · Low 68°")).toBeTruthy();
    expect(screen.getByText("Typical for these dates")).toBeTruthy();
    expect(screen.getByText("Rain on 3 of 3 days")).toBeTruthy();
    expect(screen.getByText("Later days are typical for these dates.")).toBeTruthy();
    expect(screen.getByText("2 weather changes to review")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Review" }));
    await userEvent.click(screen.getByRole("button", { name: "Refresh weather" }));
    expect(input.onReview).toHaveBeenCalledTimes(1);
    expect(input.onRefresh).toHaveBeenCalledTimes(1);
  });

  it("renders loading, offline, off, all-unavailable and partial states", async () => {
    const { rerender } = render(<WeatherPanel {...props({ state: { kind: "loading" } })} />);
    expect(screen.getByText("Loading weather for your stops")).toBeTruthy();

    rerender(<WeatherPanel {...props({ state: { kind: "offline" } })} />);
    expect(screen.getByText("You’re offline. Weather will load when you’re back.")).toBeTruthy();

    const off = props({ state: { kind: "off" } });
    rerender(<WeatherPanel {...off} />);
    await userEvent.click(screen.getByRole("button", { name: "Turn on" }));
    expect(off.onTurnOn).toHaveBeenCalledTimes(1);

    const unavailable: StopWeather[] = stops.map((_, stopIndex) => ({
      stopIndex,
      status: "unavailable",
      days: [],
    }));
    const failed = props({ state: { kind: "ready", stops: unavailable } });
    rerender(<WeatherPanel {...failed} />);
    expect(
      screen.getByText("We couldn’t reach the weather service. Your list is unchanged."),
    ).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(failed.onRefresh).toHaveBeenCalledTimes(1);

    const customStop = {
      ...stops[1],
      location: { ...stops[1].location, latitude: undefined, longitude: undefined },
    };
    rerender(
      <WeatherPanel
        {...props({
          stops: [stops[0], customStop],
          state: { kind: "ready", stops: [weather[0], unavailable[1]] },
        })}
      />,
    );
    expect(
      screen.getByText("No weather for custom places. Choose a map place to see it."),
    ).toBeTruthy();
  });
});
