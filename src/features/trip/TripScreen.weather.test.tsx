// @vitest-environment jsdom
// Weather on the phone trip screen: the paths around the forecast card and its review rows (loading failures, turning weather
// on and off, what Add and Dismiss send). The main happy paths are in TripScreen.test.tsx.
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DayWeather, StopWeather } from "@/domain/weather/types";
import { sampleLifecycleState } from "@/features/trips/fixtures";
import { createMemoryTripsSource, type TripsSource } from "@/features/trips/trips-source";
import { TripsSourceProvider } from "@/features/trips/TripsSourceProvider";
import { renderInApp } from "@/test/providers";
import { TripScreen } from "./TripScreen";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  usePathname: () => "/trips/lisbon",
  useRouter: () => ({ push }),
}));

const hot: DayWeather = {
  date: "2026-09-04",
  stopIndex: 0,
  source: "forecast",
  highC: 31,
  lowC: 21,
  precipProbability: 0,
  precipMm: 0,
  snowCm: 0,
  uvIndexMax: 9,
  sunshineHours: 11,
};
const dry: StopWeather[] = [
  { stopIndex: 0, status: "ok", days: [hot, { ...hot, date: "2026-09-05" }] },
];
const rainy: StopWeather[] = [
  {
    stopIndex: 0,
    status: "ok",
    days: [
      { ...hot, precipProbability: 0.8, precipMm: 12, highC: 15, lowC: 8 },
      { ...hot, date: "2026-09-05", precipProbability: 0.8, precipMm: 12, highC: 15, lowC: 8 },
    ],
  },
];

interface Options {
  optedIn?: boolean;
  weather?: unknown;
  settingsFail?: boolean;
  updateFail?: boolean;
  applyFail?: boolean;
  /** The saved list already has a rain jacket from an earlier forecast. */
  rainJacket?: boolean;
  /** Lisbon 3-5 Sep, then Porto 5-7 Sep (a changeover on the 5th). */
  twoStops?: boolean;
}
function setup(options: Options = {}) {
  const memory = createMemoryTripsSource(sampleLifecycleState(), {
    now: () => 1,
    newId: () => "new",
    today: () => "2026-10-16",
  });
  let optedIn = options.optedIn ?? true;
  const getTripWeather = vi.fn(async () => options.weather ?? { kind: "ready", stops: rainy });
  const updateSettings = vi.fn(async (change: { weatherOptIn?: boolean }) => {
    if (options.updateFail) throw new Error("no");
    optedIn = change.weatherOptIn ?? optedIn;
    return { weatherOptIn: optedIn, temperatureUnit: "F" as const };
  });
  const applyReview = vi.fn(async (id: string) => {
    if (options.applyFail) throw new Error("no");
    return memory.acceptWeather(id);
  });
  const source = {
    ...memory,
    getTrip: async (id: string) => {
      const trip = await memory.getTrip(id);
      return {
        ...trip,
        items: options.rainJacket
          ? [
              ...trip.items,
              {
                id: "weather-rain-jacket",
                name: "Rain jacket",
                category: "Clothing" as const,
                qty: 1,
                packed: 0,
                section: "main" as const,
              },
            ]
          : trip.items,
        stops: (options.twoStops
          ? [
              { ...trip.stops[0], arrive: "2026-09-03", leave: "2026-09-05" },
              {
                ...trip.stops[0],
                arrive: "2026-09-05",
                leave: "2026-09-07",
                location: { ...trip.stops[0].location, city: "Porto", id: "porto" },
              },
            ]
          : trip.stops
        ).map((stop) => ({
          ...stop,
          location: { ...stop.location, latitude: 38.72, longitude: -9.14 },
        })),
      };
    },
    weather: {
      getSettings: async () => {
        if (options.settingsFail) throw new Error("no");
        return { weatherOptIn: optedIn, temperatureUnit: "F" as const };
      },
      updateSettings,
      getTripWeather,
      previewDraft: vi.fn(),
      createTripWithReview: vi.fn(),
      listSuggestions: vi.fn().mockResolvedValue([]),
      applyReview,
    },
  } as unknown as TripsSource;
  const user = userEvent.setup();
  renderInApp(
    <TripsSourceProvider source={source}>
      <TripScreen tripId="lisbon" />
    </TripsSourceProvider>,
  );
  return { user, memory, getTripWeather, updateSettings, applyReview };
}

const ready = () => screen.findByRole("heading", { name: "Pack mode", level: 1 });

describe("loading weather", () => {
  it("shows no panel when the settings cannot be read, and the packing list still works", async () => {
    setup({ settingsFail: true });
    await ready();
    await waitFor(() => expect(document.querySelector(".weather-panel")).toBeNull());
    expect(document.querySelector("section[data-cube] h2")?.textContent).toBe("Clothing");
  });

  it("says so when the person is offline", async () => {
    setup({ weather: { kind: "offline" } });
    await ready();
    expect(await screen.findByText(/You’re offline\. Weather will load/)).toBeTruthy();
  });

  it("treats an unavailable answer as every stop unavailable, with no changes to review", async () => {
    setup({ weather: { kind: "unavailable" } });
    await ready();
    expect(
      await screen.findByText("We couldn’t reach the weather service. Your list is unchanged."),
    ).toBeTruthy();
    expect(screen.queryByText(/weather changes? to review/)).toBeNull();
  });

  it("Try again asks again", async () => {
    const { user, getTripWeather } = setup({ weather: { kind: "unavailable" } });
    await ready();
    await user.click(await screen.findByRole("button", { name: "Try again" }));
    await waitFor(() => expect(getTripWeather).toHaveBeenCalledTimes(2));
  });
});

describe("turning weather on and off", () => {
  it("Turn on from the off state opts in and loads the weather", async () => {
    const { user, updateSettings, getTripWeather, memory } = setup({ optedIn: false });
    await ready();
    await memory.skipWeather("lisbon");
    await user.click(await screen.findByRole("button", { name: "Not now" }));
    await waitFor(() => expect(updateSettings).toHaveBeenCalledWith({ weatherOptIn: false }));
    await user.click(await screen.findByRole("button", { name: "Turn on" }));
    await waitFor(() => expect(updateSettings).toHaveBeenCalledWith({ weatherOptIn: true }));
    await waitFor(() => expect(getTripWeather).toHaveBeenCalledWith("lisbon"));
  });

  it("a failed opt-in changes nothing and says so", async () => {
    const { user, getTripWeather } = setup({ optedIn: false, updateFail: true });
    await ready();
    await user.click(await screen.findByRole("button", { name: "Get weather" }));
    expect(await screen.findByText("Couldn’t update weather. Nothing was changed.")).toBeTruthy();
    expect(getTripWeather).not.toHaveBeenCalled();
  });
});

describe("the review rows", () => {
  const open = (user: ReturnType<typeof userEvent.setup>) =>
    screen.findByRole("button", { name: /to review/ }).then((button) => user.click(button));

  it("sends an added change as accepted and a dismissed one as skipped", async () => {
    const { user, applyReview } = setup({ weather: { kind: "ready", stops: rainy } });
    await ready();
    await open(user);
    const rows = screen.getAllByRole("button", { name: /^Dismiss / });
    expect(rows.length).toBeGreaterThan(1);
    await user.click(rows[rows.length - 1]);
    await waitFor(() => expect(applyReview).toHaveBeenCalledTimes(1));
    await user.click(screen.getAllByRole("button", { name: /^Add / })[0]);
    await waitFor(() => expect(applyReview).toHaveBeenCalledTimes(2));
    const calls = applyReview.mock.calls as unknown as [string, { kind: string }[], unknown[]][];
    expect(calls[0][1]).toEqual([]);
    expect(calls[0][2]).toHaveLength(1);
    expect(calls[1][1].length).toBe(1);
    expect(calls[1][2]).toEqual([]);
  });

  it("offers the removal of a weather item the dry forecast no longer calls for", async () => {
    const { user, applyReview } = setup({
      weather: { kind: "ready", stops: dry },
      rainJacket: true,
    });
    await ready();
    await open(user);
    await user.click(screen.getByRole("button", { name: "Remove Rain jacket" }));
    await waitFor(() => expect(applyReview).toHaveBeenCalledTimes(1));
    const accepted = (applyReview.mock.calls as unknown as [string, { kind: string }[]][])[0][1];
    expect(accepted.map((change) => change.kind)).toEqual(["remove"]);
  });

  it("leaves the row in place and shows the Error chip when applying fails", async () => {
    const { user } = setup({ applyFail: true });
    await ready();
    await open(user);
    await user.click(screen.getAllByRole("button", { name: /^Add / })[0]);
    expect(await screen.findByRole("button", { name: "Not saved, retry" })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /^Add / }).length).toBeGreaterThan(0);
  });
});

describe("during the trip (#410)", () => {
  afterEach(() => vi.useRealTimers());

  // Lisbon is 3-7 Sep 2026. The 4th was wet, the 5th (today) and on are dry.
  const wetThenDry: StopWeather[] = [
    {
      stopIndex: 0,
      status: "ok",
      days: [
        { ...hot, precipProbability: 0.8, precipMm: 12, highC: 15, lowC: 8 },
        { ...hot, date: "2026-09-05" },
      ],
    },
  ];

  it("reviews only the days still ahead, as the Home counts them: a rain jacket for a wet day that is over is offered for removal", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-09-05T12:00:00") });
    const { user, applyReview } = setup({
      weather: { kind: "ready", stops: wetThenDry },
      rainJacket: true,
    });
    await ready();
    await screen.findByRole("button", { name: /to review/ }).then((button) => user.click(button));
    await user.click(screen.getByRole("button", { name: "Remove Rain jacket" }));
    await waitFor(() => expect(applyReview).toHaveBeenCalledTimes(1));
  });

  it("keeps the whole forecast in view before the trip: the wet day still calls for the jacket", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-09-01T12:00:00") });
    const { user } = setup({ weather: { kind: "ready", stops: wetThenDry }, rainJacket: true });
    await ready();
    // The review disclosure is opened first, so an absent action means absent, not hidden.
    const disclosure = await screen.findByRole("button", { name: /to review/ });
    await user.click(disclosure);
    expect(screen.getAllByRole("button", { name: /^(Add|Dismiss) / }).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Remove Rain jacket" })).toBeNull();
  });

  it("shows a change that names no stay under the stay the person is in, not the one already left", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-09-06T12:00:00") });
    const day = (date: string, stopIndex: number) => ({ ...hot, date, stopIndex });
    const { user } = setup({
      twoStops: true,
      rainJacket: true,
      weather: {
        kind: "ready",
        stops: [
          { stopIndex: 0, status: "ok", days: [day("2026-09-03", 0), day("2026-09-04", 0)] },
          { stopIndex: 1, status: "ok", days: [day("2026-09-06", 1), day("2026-09-07", 1)] },
        ],
      },
    });
    await ready();
    await screen.findByRole("button", { name: /to review/ }).then((button) => user.click(button));
    const forecast = screen.getByRole("button", { name: "Remove Rain jacket" }).closest("section")!;
    expect(forecast.textContent).toContain("Porto, has changes to review");
    expect(forecast.textContent).not.toContain("Lisbon, has changes to review");
  });
});
