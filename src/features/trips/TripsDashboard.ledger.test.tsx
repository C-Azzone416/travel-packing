// @vitest-environment jsdom
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderInApp } from "@/test/providers";
import type { LifecycleState } from "@/domain/trip-lifecycle";
import { sampleLifecycleState } from "./fixtures";
import { TripsDashboard } from "./TripsDashboard";
import { createMemoryTripsSource, type TripsSource } from "./trips-source";

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));

const TODAY = () => "2026-10-16";

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

describe("the hero and Later journeys", () => {
  it("makes the earliest departure the hero even when a later trip was added last or first", async () => {
    const state = withLater();
    state.trips = [state.trips[1], state.trips[0]];
    setup(state);
    const hero = await screen.findByRole("article", { name: "San Diego" });
    expect(within(hero).getByText("Next departure · Oct 23")).toBeTruthy();
    const later = screen.getByRole("complementary", { name: "Later journeys" });
    expect(within(later).getByRole("article", { name: "Denver" })).toBeTruthy();
  });

  it("puts the next departure in the hero and the rest in the Later journeys sidebar", async () => {
    setup(withLater());
    const hero = await screen.findByRole("article", { name: "San Diego" });
    expect(within(hero).getByText("Next departure · Oct 23")).toBeTruthy();
    expect(within(hero).getByText("7")).toBeTruthy();
    expect(within(hero).getByText("days to go")).toBeTruthy();
    const later = screen.getByRole("complementary", { name: "Later journeys" });
    const denver = within(later).getByRole("article", { name: "Denver" });
    expect(within(denver).getByText("25")).toBeTruthy();
    expect(within(denver).getByText(/Nov 10 – Nov 12 · 2 nights/)).toBeTruthy();
    expect(
      within(denver).getByRole("link", { name: "Keep packing: Denver" }).getAttribute("href"),
    ).toBe("/trips/later");
    expect(within(denver).getByText("California, United States")).toBeTruthy();
    expect(screen.getByText("2 journeys ahead")).toBeTruthy();
  });

  it("says so when nothing else is planned, and keeps the per-journey actions", async () => {
    const { user, base } = setup(withLater());
    await screen.findByRole("article", { name: "San Diego" });
    const later = screen.getByRole("complementary", { name: "Later journeys" });
    await choose(user, "Denver", "Quick view");
    expect(within(later).getByText("Packing quick view")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "More actions for Denver" }));
    expect(screen.getByRole("menuitem", { name: "Copy trip" }).getAttribute("href")).toBe(
      "/trips/new?copy=later",
    );
    await user.click(screen.getByRole("menuitem", { name: "Archive" }));
    await waitFor(() => expect(within(later).getByText("Nothing else planned yet.")).toBeTruthy());
    expect(base.snapshot().trips.find((trip) => trip.id === "later")?.archived).toBe(true);
  });

  it("marks a ready trip Review bag, with the days-to-go numeral and the route stamp in the hero slot", async () => {
    const state = sampleLifecycleState();
    state.trips = state.trips.map((trip) => ({ ...trip, ready: true }));
    const { container } =
      (renderInApp(<TripsDashboard source={memory(state)} getToday={TODAY} />),
      { container: document.body });
    const hero = await screen.findByRole("article", { name: "San Diego" });
    expect(within(hero).getByRole("link", { name: "Review bag: San Diego" })).toBeTruthy();
    const slot = container.querySelector("[data-stamp-slot]") as HTMLElement;
    expect(within(slot).getByRole("img", { name: "SAN DIEGO departure stamp" })).toBeTruthy();
  });

  it("shows the same stamps as the packing screen: two countries give two route stamps", async () => {
    const state = sampleLifecycleState();
    const [first] = state.trips;
    const lisbon = sampleLifecycleState().trips.find((trip) => trip.id === "lisbon")!;
    state.trips = [
      {
        ...first,
        stops: [
          { ...first.stops[0], leave: first.end },
          { ...lisbon.stops[0], arrive: first.end, leave: first.end },
        ],
      },
    ];
    setup(state);
    const hero = await screen.findByRole("article", { name: "San Diego" });
    expect(within(hero).getByRole("img", { name: "USA, PRT route stamps" })).toBeTruthy();
  });
});

describe("Remove on Later journeys and Past & archive cards", () => {
  it("removes a Later journey after confirming, and offers Undo", async () => {
    const { user, base } = setup(withLater());
    const later = await screen.findByRole("complementary", { name: "Later journeys" });
    await choose(user, "Denver", "Remove");
    await user.click(
      within(screen.getByRole("dialog", { name: "Remove Denver?" })).getByRole("button", {
        name: "Remove trip",
      }),
    );
    await waitFor(() => expect(within(later).getByText("Nothing else planned yet.")).toBeTruthy());
    expect(base.snapshot().trips.map((trip) => trip.id)).toEqual(["san-diego"]);
    expect(base.snapshot().deletedTrips.map(({ trip }) => trip.id)).toEqual(["later"]);
  });

  it("removes a trip from the Past & archive view after confirming", async () => {
    const { user, base } = setup();
    await screen.findByRole("article", { name: "San Diego" });
    await user.click(screen.getByRole("button", { name: /Past & archive/ }));
    await user.click(screen.getByRole("button", { name: "Remove: Lisbon" }));
    await user.click(
      within(screen.getByRole("dialog", { name: "Remove Lisbon?" })).getByRole("button", {
        name: "Remove trip",
      }),
    );
    await waitFor(() => expect(screen.queryByRole("article", { name: "Lisbon" })).toBeNull());
    expect(base.snapshot().deletedTrips.map(({ trip }) => trip.id)).toEqual(["lisbon"]);
  });

  it("archives from the hero through the one shared handler", async () => {
    const { user, base } = setup();
    const hero = await screen.findByRole("article", { name: "San Diego" });
    await choose(user, "San Diego", "Archive");
    await waitFor(() => expect(base.snapshot().trips[0].archived).toBe(true));
  });
});

describe("the hero's weather strip", () => {
  it("shows one compact cell per stay in the person's unit, labelled Forecast or Typical", async () => {
    setup(undefined, (base) => weatherSource(base));
    const strip = await screen.findByRole("list", { name: "Weather for each stay" });
    const cell = within(strip).getByRole("listitem");
    expect(within(cell).getByText("San Diego")).toBeTruthy();
    expect(cell.textContent).toContain("68° / 50°");
    expect(cell.textContent).toContain("Forecast");
    expect(within(cell).getByText("Rain on 1 of 1 days")).toBeTruthy();
  });

  it("uses Celsius when that is the person's unit", async () => {
    setup(undefined, (base) => weatherSource(base, { weatherOptIn: true, temperatureUnit: "C" }));
    const strip = await screen.findByRole("list", { name: "Weather for each stay" });
    expect(strip.textContent).toContain("20° / 10°");
  });

  it("shows no strip, and asks the service nothing, when weather is off", async () => {
    let source!: TripsSource;
    setup(
      undefined,
      (base) => (source = weatherSource(base, { weatherOptIn: false, temperatureUnit: "F" })),
    );
    await screen.findByRole("article", { name: "San Diego" });
    expect(screen.queryByRole("list", { name: "Weather for each stay" })).toBeNull();
    expect(source.weather!.getTripWeather).not.toHaveBeenCalled();
  });

  it("says weather is unavailable, and the hero still works, when the service fails", async () => {
    setup(undefined, (base) => weatherSource(base, undefined, { kind: "unavailable" }));
    expect(await screen.findByText("Weather is unavailable right now.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Continue packing: San Diego" })).toBeTruthy();
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
    expect(await screen.findByText("Weather is unavailable right now.")).toBeTruthy();
  });
});

describe("+ Add item (interim until #147)", () => {
  it("is a secondary link to the trip screen with the add form requested", async () => {
    setup();
    const hero = await screen.findByRole("article", { name: "San Diego" });
    const add = within(hero).getByRole("link", { name: "Add item: San Diego" });
    expect(add.getAttribute("href")).toBe("/trips/san-diego?add=item");
    expect(add.className).toContain("secondary");
    expect(within(hero).queryByRole("textbox")).toBeNull();
  });
});

describe("Edit trip", () => {
  it("opens the route sheet and cancels without changing anything", async () => {
    const { user, base } = setup();
    const hero = await screen.findByRole("article", { name: "San Diego" });
    await user.click(within(hero).getByRole("button", { name: "Edit trip: San Diego" }));
    const sheet = await screen.findByRole("dialog", { name: "Edit route" });
    await user.click(within(sheet).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog", { name: "Edit route" })).toBeNull();
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
    const hero = await screen.findByRole("article", { name: "San Diego" });
    await user.click(within(hero).getByRole("button", { name: "Edit trip: San Diego" }));
    const sheet = await screen.findByRole("dialog", { name: "Edit route" });
    await user.click(within(sheet).getByRole("button", { name: /Save/ }));
    await waitFor(() => expect(setStops).toHaveBeenCalledOnce());
    expect(setStops.mock.calls[0][0]).toBe("san-diego");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Edit route" })).toBeNull());
  });

  it("keeps the sheet open and offers Save again when the save fails", async () => {
    const { user } = setup(undefined, (base) => ({
      ...base,
      setStops: () => Promise.reject(new Error("down")),
    }));
    const hero = await screen.findByRole("article", { name: "San Diego" });
    await user.click(within(hero).getByRole("button", { name: "Edit trip: San Diego" }));
    const sheet = await screen.findByRole("dialog", { name: "Edit route" });
    await user.click(within(sheet).getByRole("button", { name: /Save/ }));
    await act(async () => {});
    expect(screen.getByRole("dialog", { name: "Edit route" })).toBeTruthy();
  });
});
