// @vitest-environment jsdom
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderInApp } from "@/test/providers";
import type { LifecycleState } from "@/domain/trip-lifecycle";
import { sampleLifecycleState } from "./fixtures";
import { TripsDashboard } from "./TripsDashboard";
import { createMemoryTripsSource, type TripsSource } from "./trips-source";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const TODAY = () => "2026-10-16";

afterEach(() => window.history.replaceState(null, "", "/"));

/** Open a trip's ⋯ menu and choose one item. */
async function choose(user: ReturnType<typeof userEvent.setup>, trip: string, item: string) {
  await user.click(screen.getByRole("button", { name: `More actions for ${trip}` }));
  await user.click(screen.getByRole("menuitem", { name: item }));
}
const memory = (initial: LifecycleState) => createMemoryTripsSource(initial, { now: () => 5_000 });

function withLater(): LifecycleState {
  const state = sampleLifecycleState();
  state.trips = [
    state.trips[0],
    {
      ...state.trips[0],
      id: "later",
      destination: "Denver",
      name: "Denver",
      start: "2026-11-10",
      end: "2026-11-12",
    },
  ];
  return state;
}

function setup(
  initial = sampleLifecycleState(),
  wrap?: (base: ReturnType<typeof memory>) => TripsSource,
) {
  const base = memory(initial);
  const source = wrap ? wrap(base) : base;
  const user = userEvent.setup();
  renderInApp(<TripsDashboard source={source} getToday={TODAY} />);
  return { user, base, source };
}

const weatherSource = (
  base: ReturnType<typeof memory>,
  settings = { weatherOptIn: true, temperatureUnit: "F" as "F" | "C" },
  result: Awaited<ReturnType<NonNullable<TripsSource["weather"]>["getTripWeather"]>> = {
    kind: "ready",
    stops: [
      {
        stopIndex: 0,
        status: "ok",
        days: [
          {
            date: "2026-10-23",
            stopIndex: 0,
            source: "forecast",
            highC: 20,
            lowC: 10,
            precipProbability: 0.9,
            precipMm: 4,
            snowCm: 0,
            uvIndexMax: null,
            sunshineHours: null,
          },
        ],
      },
    ],
  },
): TripsSource => ({
  ...base,
  weather: {
    getSettings: async () => settings,
    getTripWeather: vi.fn(async () => result),
  } as unknown as TripsSource["weather"],
});

const tabs = () => screen.getByRole("tablist", { name: "Trip sections" });
const tabsReady = () => screen.findByRole("tablist", { name: "Trip sections" });

describe("the phone Home and the Future pill", () => {
  it("makes the earliest departure the tag even when a later trip was added first", async () => {
    const state = withLater();
    state.trips = [state.trips[1], state.trips[0]];
    setup(state);
    const tag = await screen.findByRole("region", { name: "San Diego" });
    expect(within(tag).getByText(/NEXT TRIP · 23–27 Oct · 4 nights/)).toBeTruthy();
    expect(within(tag).getByText("7 days to go")).toBeTruthy();
    expect(within(tabs()).getByRole("tab", { name: "Future 1 trip" })).toBeTruthy();
  });

  it("lists the trips after the next one under Future, and links to Stamps for the past", async () => {
    const { user } = setup(withLater());
    await screen.findByRole("region", { name: "San Diego" });
    await user.click(within(tabs()).getByRole("tab", { name: /^Future/ }));
    const panel = screen.getByRole("tabpanel");
    const list = within(panel).getByRole("list", { name: "Future trips" });
    expect(
      within(list)
        .getByRole("link", { name: /Denver/ })
        .getAttribute("href"),
    ).toBe("/trips/later");
    expect(
      within(panel)
        .getByRole("link", { name: "Past trips are with your stamps ›" })
        .getAttribute("href"),
    ).toBe("/?tab=stamps");
    expect(within(panel).getByRole("link", { name: "Plan a trip" }).getAttribute("href")).toBe(
      "/trips/new",
    );
  });

  it("says so when nothing else is planned", async () => {
    const { user } = setup();
    await screen.findByRole("region", { name: "San Diego" });
    await user.click(within(tabs()).getByRole("tab", { name: /^Future/ }));
    expect(screen.getByText("No other trips planned yet.")).toBeTruthy();
  });

  it("marks a ready trip Review bag", async () => {
    const state = sampleLifecycleState();
    state.trips = state.trips.map((trip) => ({ ...trip, ready: true }));
    renderInApp(<TripsDashboard source={memory(state)} getToday={TODAY} />);
    await screen.findByRole("region", { name: "San Diego" });
    expect(screen.getByRole("link", { name: "Review bag: San Diego" })).toBeTruthy();
  });

  it("says nothing is planned, with a way to plan one, when there is no upcoming trip", async () => {
    const state = sampleLifecycleState();
    state.trips = state.trips.map((trip) => ({ ...trip, archived: true }));
    setup(state);
    expect(await screen.findByText("No upcoming trips.")).toBeTruthy();
    expect(screen.queryByRole("tablist", { name: "Trip sections" })).toBeNull();
  });
});

describe("Archive, Remove and the Past & archive list from the tag's menu", () => {
  it("archives the next trip through the one shared handler", async () => {
    const { user, base } = setup();
    await screen.findByRole("region", { name: "San Diego" });
    await choose(user, "San Diego", "Archive");
    await waitFor(() => expect(base.snapshot().trips[0].archived).toBe(true));
  });

  it("removes the next trip after confirming, and offers Undo", async () => {
    const { user, base } = setup(withLater());
    await screen.findByRole("region", { name: "San Diego" });
    await choose(user, "San Diego", "Remove");
    await user.click(
      within(screen.getByRole("dialog", { name: "Remove San Diego?" })).getByRole("button", {
        name: "Remove trip",
      }),
    );
    await waitFor(() =>
      expect(base.snapshot().deletedTrips.map(({ trip }) => trip.id)).toEqual(["san-diego"]),
    );
    expect(await screen.findByRole("region", { name: "Denver" })).toBeTruthy();
  });

  it("removes a trip from the Past & archive list after confirming", async () => {
    const { user, base } = setup();
    await screen.findByRole("region", { name: "San Diego" });
    await choose(user, "San Diego", "Past trips & archive");
    await user.click(screen.getByRole("button", { name: "Remove: Lisbon" }));
    await user.click(
      within(screen.getByRole("dialog", { name: "Remove Lisbon?" })).getByRole("button", {
        name: "Remove trip",
      }),
    );
    await waitFor(() => expect(screen.queryByRole("article", { name: "Lisbon" })).toBeNull());
    expect(base.snapshot().deletedTrips.map(({ trip }) => trip.id)).toEqual(["lisbon"]);
  });

  it("no longer opens the archive from ?view=archive (Stamps holds the past now)", async () => {
    window.history.replaceState(null, "", "/?view=archive");
    setup();
    expect(await screen.findByRole("region", { name: "San Diego" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Past trips & archive" })).toBeNull();
    window.history.replaceState(null, "", "/");
  });
});

describe("the Weather pill and its panel", () => {
  it("shows the forecast for the stay in the person's unit, and ALERT for a rainy day", async () => {
    const { user } = setup(undefined, (base) => weatherSource(base));
    await screen.findByRole("region", { name: "San Diego" });
    const tab = await within(await tabsReady()).findByRole("tab", { name: "Weather ALERT" });
    expect(screen.getByText("Weather alert: suggestions to review for San Diego.")).toBeTruthy();
    await user.click(tab);
    expect(screen.getByRole("tabpanel").textContent).toContain("68°");
  });

  it("uses Celsius when that is the person's unit", async () => {
    const { user } = setup(undefined, (base) =>
      weatherSource(base, { weatherOptIn: true, temperatureUnit: "C" }),
    );
    await user.click(await within(await tabsReady()).findByRole("tab", { name: "Weather ALERT" }));
    expect(screen.getByRole("tabpanel").textContent).toContain("20°");
  });

  it("says weather is off, and asks the service nothing, when it is off", async () => {
    let source!: TripsSource;
    const { user } = setup(
      undefined,
      (base) => (source = weatherSource(base, { weatherOptIn: false, temperatureUnit: "F" })),
    );
    const tab = await within(await tabsReady()).findByRole("tab", { name: "Weather Off" });
    await user.click(tab);
    expect(screen.getByTestId("weather-off")).toBeTruthy();
    expect(source.weather!.getTripWeather).not.toHaveBeenCalled();
  });

  it("says weather is unavailable, and the Home still works, when the service fails", async () => {
    const { user } = setup(undefined, (base) =>
      weatherSource(base, undefined, { kind: "unavailable" }),
    );
    await user.click(await within(await tabsReady()).findByRole("tab", { name: "Weather N/A" }));
    expect(screen.getByText("Weather is unavailable right now.")).toBeTruthy();
    await user.click(within(tabs()).getByRole("tab", { name: /^Pack/ }));
    expect(screen.getByRole("link", { name: "Continue packing: San Diego" })).toBeTruthy();
  });

  it("says weather is unavailable, not Clear, when the answer is 200 but every stop is unavailable", async () => {
    const { user } = setup(undefined, (base) =>
      weatherSource(base, undefined, {
        kind: "ready",
        stops: [{ stopIndex: 0, status: "unavailable", days: [] }],
      } as never),
    );
    const pill = await within(await tabsReady()).findByRole("tab", { name: "Weather N/A" });
    expect(within(tabs()).queryByRole("tab", { name: "Weather Clear" })).toBeNull();
    await user.click(pill);
    expect(screen.getByText("Weather is unavailable right now.")).toBeTruthy();
  });

  it("does not say Usual over nothing: a far trip, weather turned off mid-load (200, no stops), is N/A", async () => {
    const base = memory(sampleLifecycleState());
    renderInApp(
      <TripsDashboard
        source={weatherSource(base, undefined, { kind: "ready", stops: [] } as never)}
        getToday={() => "2026-08-01"}
      />,
    );
    expect(await within(await tabsReady()).findByRole("tab", { name: "Weather N/A" })).toBeTruthy();
    expect(within(tabs()).queryByRole("tab", { name: "Weather Usual" })).toBeNull();
  });

  it("treats a thrown weather read as unavailable", async () => {
    setup(undefined, (base) => ({
      ...base,
      weather: {
        getSettings: async () => {
          throw new Error("down");
        },
      } as unknown as TripsSource["weather"],
    }));
    expect(await within(await tabsReady()).findByRole("tab", { name: "Weather N/A" })).toBeTruthy();
  });
});

describe("a later trip's menu on the Future pill", () => {
  it("archives or removes the later trip and leaves the next trip alone", async () => {
    const { user, base } = setup(withLater());
    await screen.findByRole("region", { name: "San Diego" });
    await user.click(within(tabs()).getByRole("tab", { name: /^Future/ }));
    await user.click(screen.getByRole("button", { name: "More actions for Denver" }));
    expect(screen.getByRole("menuitem", { name: "Copy trip" }).getAttribute("href")).toBe(
      "/trips/new?copy=later",
    );
    await user.click(screen.getByRole("menuitem", { name: "Archive" }));
    await waitFor(() =>
      expect(base.snapshot().trips.find((trip) => trip.id === "later")?.archived).toBe(true),
    );
    expect(base.snapshot().trips.find((trip) => trip.id === "san-diego")?.archived).toBe(false);
    expect(screen.getByRole("region", { name: "San Diego" })).toBeTruthy();
    expect(await screen.findByText("No other trips planned yet.")).toBeTruthy();
  });

  it("removes the later trip after confirming, with the next trip untouched", async () => {
    const { user, base } = setup(withLater());
    await screen.findByRole("region", { name: "San Diego" });
    await user.click(within(tabs()).getByRole("tab", { name: /^Future/ }));
    await user.click(screen.getByRole("button", { name: "More actions for Denver" }));
    await user.click(screen.getByRole("menuitem", { name: "Remove" }));
    await user.click(
      within(screen.getByRole("dialog", { name: "Remove Denver?" })).getByRole("button", {
        name: "Remove trip",
      }),
    );
    await waitFor(() =>
      expect(base.snapshot().deletedTrips.map(({ trip }) => trip.id)).toEqual(["later"]),
    );
    expect(base.snapshot().trips.map((trip) => trip.id)).toEqual(["san-diego"]);
  });

  it("opens the Edit trip sheet for the later trip", async () => {
    const { user } = setup(withLater());
    await screen.findByRole("region", { name: "San Diego" });
    await user.click(within(tabs()).getByRole("tab", { name: /^Future/ }));
    await user.click(screen.getByRole("button", { name: "More actions for Denver" }));
    await user.click(screen.getByRole("menuitem", { name: "Edit trip" }));
    expect(await screen.findByRole("dialog", { name: "Edit trip" })).toBeTruthy();
  });
});

describe("Edit trip", () => {
  it("opens the Edit trip sheet on Route & dates and cancels without changing anything", async () => {
    const { user, base } = setup();
    await screen.findByRole("region", { name: "San Diego" });
    await choose(user, "San Diego", "Edit trip");
    const sheet = await screen.findByRole("dialog", { name: "Edit trip" });
    await user.click(within(sheet).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog", { name: "Edit trip" })).toBeNull();
    expect(base.snapshot().trips[0].stops).toHaveLength(1);
  });

  it("saves a changed route through setStops and closes the sheet", async () => {
    const setStops = vi.fn();
    const { user } = setup(undefined, (base) => ({
      ...base,
      setStops: async (id, stops) => {
        setStops(id, stops);
        return base.setStops(id, stops);
      },
    }));
    await screen.findByRole("region", { name: "San Diego" });
    await choose(user, "San Diego", "Edit trip");
    const sheet = await screen.findByRole("dialog", { name: "Edit trip" });
    await user.click(within(sheet).getByRole("button", { name: "Save route" }));
    await waitFor(() => expect(setStops).toHaveBeenCalledOnce());
    expect(setStops.mock.calls[0][0]).toBe("san-diego");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Edit trip" })).toBeNull());
  });

  it("keeps the sheet open and offers Save again when the save fails", async () => {
    const { user } = setup(undefined, (base) => ({
      ...base,
      setStops: () => Promise.reject(new Error("down")),
    }));
    await screen.findByRole("region", { name: "San Diego" });
    await choose(user, "San Diego", "Edit trip");
    const sheet = await screen.findByRole("dialog", { name: "Edit trip" });
    await user.click(within(sheet).getByRole("button", { name: "Save route" }));
    await act(async () => {});
    expect(screen.getByRole("dialog", { name: "Edit trip" })).toBeTruthy();
    expect(within(sheet).getByText(/Couldn’t save the route/)).toBeTruthy();
  });
});
