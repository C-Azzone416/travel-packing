// @vitest-environment jsdom
import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderInApp } from "@/test/providers";
import { sampleLifecycleState, SAMPLE_LOCATIONS } from "@/features/trips/fixtures";
import {
  buildTrip,
  emptyLifecycleState,
  type LifecycleState,
  type LifecycleTrip,
} from "@/domain/trip-lifecycle";
import type { TripConfig } from "@/domain/trip";
import type { SampleLocation } from "@/domain/trip-stops";
import { createMemoryTripsSource } from "@/features/trips/trips-source";
import { TripsSourceProvider } from "@/features/trips/TripsSourceProvider";
import { StampsScreen } from "./StampsScreen";

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

describe("Stamps screen", () => {
  it("loads the sticker suitcase, completed totals, dashed upcoming sticker and past trip", async () => {
    setup();
    expect(screen.getByRole("region", { name: "Loading stamps" })).toBeTruthy();
    expect(await screen.findByRole("heading", { name: "Past trips", level: 2 })).toBeTruthy();
    expect(screen.getByText("1 inked")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Lisbon, Sep 2026, 1 trip" })).toBeTruthy();
    const upcoming = screen.getByRole("button", {
      name: "San Diego, Oct 2026, 1 trip",
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
        name: "San Diego, Oct 2026, 1 trip",
      }),
    );
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
    expect(screen.getByRole("button", { name: /San Diego, Oct 2026, 1 trip/ })).toBeTruthy();
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
    const sticker = screen.getByRole("button", { name: "Lisbon, Sep 2026, 2 trips" });
    expect(sticker.textContent).toContain("×2");
    expect(
      screen.getByRole("button", { name: "San Diego, Oct 2026, 1 trip" }).textContent,
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
    const selected = screen.getByRole("article", { name: "Selected trip: Stopless" });
    expect(selected.querySelector("[data-colour]")).toBeNull();
    const stoplessRow = screen.getByRole("button", { name: /Stopless.*packed/ });
    expect(stoplessRow.textContent).toContain("—");
    expect(stoplessRow.querySelector("[data-colour]")).toBeNull();
    const dashSticker = screen.getByRole("button", { name: "Mystery, Sep 2026, 1 trip" });
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

  it("ignores a failed load that finishes after the screen has gone", async () => {
    let fail!: () => void;
    const gate = new Promise<void>((done) => (fail = done));
    const base = memory();
    const { unmount } = setup({
      ...base,
      load: async () => (await gate, Promise.reject(new Error("down"))),
    });
    unmount();
    await act(async () => fail());
    expect(screen.queryByText("Couldn’t load your stamps.")).toBeNull();
  });

  it("ignores a successful load that finishes after the screen has gone", async () => {
    let resolve!: () => void;
    const gate = new Promise<void>((done) => (resolve = done));
    const base = memory();
    const { unmount } = setup({ ...base, load: async () => (await gate, base.load()) });
    unmount();
    await act(async () => resolve());
    expect(screen.queryByRole("heading", { name: "Past trips", level: 2 })).toBeNull();
  });
});
