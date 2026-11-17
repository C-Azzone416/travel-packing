// @vitest-environment jsdom
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderInApp } from "@/test/providers";
import { SaveStatusProvider, ConnectedSaveChip } from "@/components/shell/SaveStatus";
import { ToastProvider } from "@/components/ui/Toast";
import { sampleLifecycleState, SAMPLE_LOCATIONS } from "@/features/trips/fixtures";
import {
  buildTrip,
  emptyLifecycleState,
  type LifecycleState,
  type LifecycleTrip,
} from "@/domain/trip-lifecycle";
import type { TripConfig } from "@/domain/trip";
import type { SampleLocation } from "@/domain/trip-stops";
import { createMemoryTripsSource, type TripsSource } from "@/features/trips/trips-source";
import { TripsSourceProvider } from "@/features/trips/TripsSourceProvider";
import { StampsScreen, StampsContent, StickerTeaser } from "./StampsScreen";
import { stampsView } from "./stamps-view";

vi.mock("next/navigation", () => ({ usePathname: () => "/stamps" }));

const BASE_CONFIG: TripConfig = {
  laundry: false,
  spare: true,
  niceAttire: false,
  occasionCount: 1,
  reuseNice: false,
  returnOutfit: true,
};

function memory() {
  return createMemoryTripsSource(sampleLifecycleState(), {
    now: () => 1,
    today: () => "2026-10-16",
  });
}

function setup(source = memory()) {
  const user = userEvent.setup();
  const view = renderInApp(
    <TripsSourceProvider source={source}>
      <StampsScreen getToday={() => "2026-10-16"} />
    </TripsSourceProvider>,
  );
  return { user, source, unmount: view.unmount };
}

/** A synthetic completed or upcoming trip, built the way the app builds one. */
function syntheticTrip(
  id: string,
  city: string,
  start: string,
  end: string,
  location: SampleLocation = SAMPLE_LOCATIONS["pt-lisbon"],
) {
  return buildTrip(city, location, start, end, BASE_CONFIG, [], {
    newId: () => id,
    today: "2026-10-16",
  });
}
const withTrips = (...trips: LifecycleTrip[]): LifecycleState => ({
  ...emptyLifecycleState(),
  trips,
});

const PORTO = "Porto, Oct 2026, inked, 1 trip";

/** A state with one completed Porto trip, the newer result in the superseded-load tests. */
function porto(): LifecycleState {
  const trip = syntheticTrip("porto-now", "Porto", "2026-10-01", "2026-10-03", {
    id: "pt-porto",
    city: "Porto",
    region: "Porto District",
    country: "Portugal",
    countryCode: "PT",
    label: "Porto, Porto District, Portugal",
  });
  return withTrips(trip);
}

/** The same providers renderInApp wraps around a screen, so a rerender keeps them. */
function appTree(source: TripsSource, today: () => string) {
  return (
    <ToastProvider>
      <SaveStatusProvider>
        <ConnectedSaveChip />
        <TripsSourceProvider source={source}>
          <StampsScreen getToday={today} />
        </TripsSourceProvider>
      </SaveStatusProvider>
    </ToastProvider>
  );
}

describe("Stamps screen", () => {
  it("loads the sticker suitcase, completed totals, dashed upcoming sticker and past trip", async () => {
    setup();
    expect(screen.getByRole("region", { name: "Loading stamps" })).toBeTruthy();
    expect(await screen.findByRole("heading", { name: "Past trips", level: 2 })).toBeTruthy();
    expect(screen.getByText("1 inked")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Lisbon, Sep 2026, inked, 1 trip" })).toBeTruthy();
    const upcoming = screen.getByRole("button", {
      name: "San Diego, Oct 2026, upcoming, not inked yet",
    });
    expect(upcoming.getAttribute("data-upcoming")).toBe("true");
    const totals = screen.getByLabelText("Travel totals");
    expect(within(totals).getAllByText("1", { selector: "dd" })).toHaveLength(3);
    expect(within(totals).getByText("4", { selector: "dd" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Lisbon.*packed/ })).toBeTruthy();
    const selected = screen.getByRole("article", { name: "Selected trip: Lisbon" });
    expect(selected.querySelector("[data-colour]")?.getAttribute("data-colour")).toBe("good");
    const lisbonRow = screen.getByRole("button", { name: /Lisbon.*packed/ });
    expect(lisbonRow.querySelector("[data-colour]")?.getAttribute("data-colour")).toBe("good");
  });

  it("selects a row or sticker and updates the reuse and open-trip actions", async () => {
    const { user, source } = setup();
    await screen.findByRole("heading", { name: "Past trips", level: 2 });
    expect(screen.getByRole("link", { name: "Reuse this list" }).getAttribute("href")).toBe(
      "/trips/new?copy=lisbon",
    );
    await user.click(
      screen.getByRole("button", {
        name: "San Diego, Oct 2026, upcoming, not inked yet",
      }),
    );
    // A sticker tap selects the trip and opens its details, whose actions point at the same trip.
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("link", { name: "Open trip" }).getAttribute("href")).toBe(
      "/trips/san-diego",
    );
    await user.keyboard("{Escape}");
    expect(screen.getByRole("link", { name: "Open trip" }).getAttribute("href")).toBe(
      "/trips/san-diego",
    );
    expect(screen.getByRole("link", { name: "Reuse this list" }).getAttribute("href")).toBe(
      "/trips/new?copy=san-diego",
    );
    expect(source.snapshot().trips).toHaveLength(2);
  });

  it("changes filters without mutating trip data", async () => {
    const { user, source } = setup();
    await screen.findByRole("heading", { name: "Past trips", level: 2 });
    const before = structuredClone(source.snapshot());
    await user.click(screen.getByRole("button", { name: "2026" }));
    expect(screen.getByText("Stickers · 2026")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "All time" }));
    expect(screen.getByText("Stickers · All time")).toBeTruthy();
    expect(source.snapshot()).toEqual(before);
  });

  it("shows an honest no-past-trips state while keeping an upcoming sticker", async () => {
    const source = memory();
    const state = source.snapshot();
    setup(
      createMemoryTripsSource(
        { ...state, trips: state.trips.filter((trip) => trip.id === "san-diego") },
        { now: () => 1, today: () => "2026-10-16" },
      ),
    );
    expect(await screen.findByText("No past trips yet.")).toBeTruthy();
    expect(screen.getByText("0 inked")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /San Diego, Oct 2026, upcoming, not inked yet/ }),
    ).toBeTruthy();
  });

  it("retries a failed read and never shows Saving", async () => {
    const base = memory();
    let fail = true;
    const source = {
      ...base,
      load: vi.fn(async () => {
        if (fail) throw new Error("down");
        return base.load();
      }),
    };
    const { user } = setup(source);
    expect(await screen.findByText("Couldn’t load your stamps.")).toBeTruthy();
    expect(screen.queryByText("Saving…")).toBeNull();
    fail = false;
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { name: "Past trips", level: 2 })).toBeTruthy();
    expect(source.load).toHaveBeenCalledTimes(2);
  });

  it("keeps a pending load read-only", async () => {
    let resolve!: () => void;
    const gate = new Promise<void>((done) => (resolve = done));
    const base = memory();
    setup({ ...base, load: async () => (await gate, base.load()) });
    expect(screen.getByRole("region", { name: "Loading stamps" })).toBeTruthy();
    expect(screen.queryByText("Saving…")).toBeNull();
    await act(async () => resolve());
    expect(await screen.findByRole("heading", { name: "Past trips", level: 2 })).toBeTruthy();
  });

  it("selects a past trip from its row and points the actions at it", async () => {
    const older = syntheticTrip("spring-hop", "Lisbon", "2026-04-02", "2026-04-04");
    older.name = "Spring hop";
    const { user } = setup(
      createMemoryTripsSource(
        { ...sampleLifecycleState(), trips: [...sampleLifecycleState().trips, older] },
        { now: () => 1, today: () => "2026-10-16" },
      ),
    );
    await screen.findByRole("heading", { name: "Past trips", level: 2 });
    const row = screen.getByRole("button", { name: /Spring hop.*packed/ });
    expect(row.getAttribute("aria-pressed")).toBe("false");
    await user.click(row);
    expect(row.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("article", { name: "Selected trip: Spring hop" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Reuse this list" }).getAttribute("href")).toBe(
      "/trips/new?copy=spring-hop",
    );
    expect(screen.getByRole("link", { name: "Open trip" }).getAttribute("href")).toBe(
      "/trips/spring-hop",
    );
  });

  it("shows the repeat badge and a combined name for a place visited more than once", async () => {
    const earlier = syntheticTrip("lisbon-2025", "Lisbon", "2025-11-01", "2025-11-03");
    setup(
      createMemoryTripsSource(
        { ...sampleLifecycleState(), trips: [...sampleLifecycleState().trips, earlier] },
        { now: () => 1, today: () => "2026-10-16" },
      ),
    );
    await screen.findByRole("heading", { name: "Past trips", level: 2 });
    const sticker = screen.getByRole("button", { name: "Lisbon, Sep 2026, inked, 2 trips" });
    expect(sticker.textContent).toContain("×2");
    expect(
      screen.getByRole("button", { name: "San Diego, Oct 2026, upcoming, not inked yet" })
        .textContent,
    ).not.toContain("×");
  });

  it("falls back to the default selection when a new filter hides the selected trip", async () => {
    const boston = syntheticTrip("boston-2024", "Boston", "2024-03-01", "2024-03-04", {
      id: "us-ma-boston",
      city: "Boston",
      region: "Massachusetts",
      country: "United States",
      countryCode: "US",
      label: "Boston, Massachusetts, United States",
    });
    const { user } = setup(
      createMemoryTripsSource(
        { ...sampleLifecycleState(), trips: [...sampleLifecycleState().trips, boston] },
        { now: () => 1, today: () => "2026-10-16" },
      ),
    );
    await screen.findByRole("heading", { name: "Past trips", level: 2 });
    await user.click(screen.getByRole("button", { name: "All time" }));
    await user.click(screen.getByRole("button", { name: /Boston.*packed/ }));
    expect(screen.getByRole("article", { name: "Selected trip: Boston" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "2026" }));
    expect(screen.queryByRole("button", { name: /Boston.*packed/ })).toBeNull();
    expect(screen.getByRole("article", { name: "Selected trip: Lisbon" })).toBeTruthy();
  });

  it("shows the empty states when there are no trips at all", async () => {
    setup(createMemoryTripsSource(withTrips(), { now: () => 1, today: () => "2026-10-16" }));
    expect(
      await screen.findByText("Your first trip will start your sticker suitcase."),
    ).toBeTruthy();
    expect(screen.getByText("No past trips yet.")).toBeTruthy();
    expect(screen.getByText("0 inked")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Reuse this list" })).toBeNull();
  });

  it("marks a place with no country code with a dash, and a trip with no stops has no colour", async () => {
    const blank = syntheticTrip("blank", "Mystery", "2026-09-10", "2026-09-12", {
      id: "mystery",
      city: "Mystery",
      region: "",
      country: "",
      countryCode: "",
      label: "Mystery",
    });
    const stopless = syntheticTrip("stopless", "Nowhere", "2026-10-08", "2026-10-10");
    stopless.stops = [];
    stopless.name = "Stopless";
    setup(
      createMemoryTripsSource(withTrips(blank, stopless), {
        now: () => 1,
        today: () => "2026-10-16",
      }),
    );
    await screen.findByRole("heading", { name: "Past trips", level: 2 });
    // The earned sticker's trip is selected first; the trip with no stops has no sticker to default to.
    expect(screen.getByRole("article", { name: "Selected trip: Mystery" })).toBeTruthy();
    const stoplessRow = screen.getByRole("button", { name: /Stopless.*packed/ });
    await userEvent.click(stoplessRow);
    const selected = screen.getByRole("article", { name: "Selected trip: Stopless" });
    expect(selected.querySelector("[data-colour]")).toBeNull();
    expect(stoplessRow.textContent).toContain("—");
    expect(stoplessRow.querySelector("[data-colour]")).toBeNull();
    const dashSticker = screen.getByRole("button", { name: "Mystery, Sep 2026, inked, 1 trip" });
    expect(dashSticker.querySelector("[data-text='—']")).toBeTruthy();
  });

  it("keeps the error state when the retry fails as well", async () => {
    const base = memory();
    const source = { ...base, load: vi.fn(async () => Promise.reject(new Error("down"))) };
    const { user } = setup(source);
    expect(await screen.findByText("Couldn’t load your stamps.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Couldn’t load your stamps.")).toBeTruthy();
    expect(source.load).toHaveBeenCalledTimes(2);
  });

  it("a failed load that settles after a newer load has started cannot replace the newer state", async () => {
    let release!: () => void;
    const gate = new Promise<void>((done) => (release = done));
    let calls = 0;
    const source = {
      ...memory(),
      load: async () => {
        calls += 1;
        if (calls === 1) {
          await gate;
          throw new Error("down");
        }
        return porto();
      },
    };
    const { rerender } = render(appTree(source, () => "2026-10-16"));
    rerender(appTree(source, () => "2026-10-16"));
    expect(await screen.findByRole("button", { name: PORTO })).toBeTruthy();
    await act(async () => {
      release();
      await new Promise((done) => setTimeout(done, 0));
    });
    expect(calls).toBe(2);
    expect(screen.queryByText("Couldn’t load your stamps.")).toBeNull();
    expect(screen.getByRole("button", { name: PORTO })).toBeTruthy();
  });

  it("a successful load that settles after a newer load has started cannot replace the newer state", async () => {
    let release!: () => void;
    const gate = new Promise<void>((done) => (release = done));
    let calls = 0;
    const source = {
      ...memory(),
      load: async () => {
        calls += 1;
        if (calls === 1) {
          await gate;
          return sampleLifecycleState();
        }
        return porto();
      },
    };
    const { rerender } = render(appTree(source, () => "2026-10-16"));
    rerender(appTree(source, () => "2026-10-16"));
    expect(await screen.findByRole("button", { name: PORTO })).toBeTruthy();
    await act(async () => {
      release();
      await new Promise((done) => setTimeout(done, 0));
    });
    expect(calls).toBe(2);
    expect(screen.queryByRole("button", { name: /Lisbon, Sep 2026/ })).toBeNull();
    expect(screen.getByRole("button", { name: PORTO })).toBeTruthy();
  });
});

describe("Stamps selected from the address and the Home teaser (#409)", () => {
  it("opens with the trip named in ?trip= selected, whatever the filter would have chosen", async () => {
    window.history.replaceState(null, "", "/stamps?trip=san-diego");
    try {
      setup();
      expect(await screen.findByRole("article", { name: "Selected trip: San Diego" })).toBeTruthy();
    } finally {
      window.history.replaceState(null, "", "/");
    }
  });

  it("selects the given trip first in StampsContent, and falls back to the latest past trip", () => {
    const { unmount } = render(
      <StampsContent state={sampleLifecycleState()} today="2026-10-16" initialTripId="lisbon" />,
    );
    expect(screen.getByRole("article", { name: "Selected trip: Lisbon" })).toBeTruthy();
    unmount();
    render(
      <StampsContent state={sampleLifecycleState()} today="2026-10-16" initialTripId="missing" />,
    );
    expect(screen.getByRole("article", { name: "Selected trip: Lisbon" })).toBeTruthy();
  });

  it("the teaser says '1 night away' for one night and 'nights away' otherwise (#412)", () => {
    const view = stampsView(sampleLifecycleState().trips, "2026-10-16", "rolling");
    const { unmount } = render(
      <StickerTeaser
        stickers={[]}
        inked={0}
        filterLabel={view.filterLabel}
        totals={{ trips: 1, nights: 1 }}
      />,
    );
    expect(screen.getByText("night away")).toBeTruthy();
    unmount();
    render(
      <StickerTeaser
        stickers={[]}
        inked={0}
        filterLabel={view.filterLabel}
        totals={{ trips: 1, nights: 0 }}
      />,
    );
    expect(screen.getByText("nights away")).toBeTruthy();
  });

  it("the full totals say 'trip', 'place' and 'country' at one (#412)", () => {
    const one = stampsView(sampleLifecycleState().trips, "2026-10-16", "rolling");
    expect(one.totals.trips).toBe(1);
    render(<StampsContent state={sampleLifecycleState()} today="2026-10-16" />);
    const totals = within(screen.getByLabelText("Travel totals")).getAllByRole("term");
    const words = totals.map((term) => term.textContent);
    expect(words).toEqual([
      one.totals.trips === 1 ? "trip" : "trips",
      one.totals.places === 1 ? "place" : "places",
      one.totals.countries === 1 ? "country" : "countries",
      one.totals.nights === 1 ? "night away" : "nights away",
    ]);
  });

  it("the teaser draws decorative stickers, two totals and the one link", () => {
    const view = stampsView(sampleLifecycleState().trips, "2026-10-16", "rolling");
    render(
      <StickerTeaser
        stickers={view.stickers.filter((sticker) => !sticker.upcoming)}
        inked={view.inked}
        filterLabel={view.filterLabel}
        totals={{ trips: view.totals.trips, nights: view.totals.nights }}
      />,
    );
    expect(screen.getByRole("heading", { name: "Stickers · Last 12 months" })).toBeTruthy();
    expect(screen.getByText("1 inked")).toBeTruthy();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(document.querySelectorAll('[data-decorative="true"]')).toHaveLength(1);
    expect(within(screen.getByLabelText("Travel totals")).getAllByRole("term")).toHaveLength(2);
    expect(screen.getByRole("link", { name: "All stamps ›" }).getAttribute("href")).toBe("/stamps");
  });
});
