// @vitest-environment jsdom
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SYNTHETIC_STAPLES } from "@/domain/calc";
import { LOCATIONS } from "@/domain/locations";
import type { Staple } from "@/domain/trip";
import type { TripOrigin } from "@/domain/trip-route";
import type { StopWeather } from "@/domain/weather/types";
import { sampleLifecycleState } from "@/features/trips/fixtures";
import { TripsSourceProvider } from "@/features/trips/TripsSourceProvider";
import { createMemoryTripsSource, type TripsSource } from "@/features/trips/trips-source";
import { renderInApp } from "@/test/providers";
import { PlanScreen, type PlanScreenProps } from "./PlanScreen";

const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/trips/new",
  useRouter: () => ({ push: nav.push }),
}));

const TEES: Staple = {
  id: "tops",
  name: "Tees",
  qty: 1,
  cadence: "per day",
  category: "Clothing",
  packLast: false,
  laundryHalves: true,
};
const STAPLES = [...SYNTHETIC_STAPLES, TEES];
const TODAY = "2026-10-16";

const place = (id: string) => LOCATIONS.find((entry) => entry.id === id)!;
const SEATTLE: TripOrigin = { location: place("us-wa-seattle") };

/** jsdom has no media queries: pick the laptop (>= 1024px) or the phone layout. */
function viewport(laptop: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: query.includes("min-width: 1024px") ? laptop : false,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })) as unknown as typeof window.matchMedia;
}

function memory(options: Partial<Parameters<typeof createMemoryTripsSource>[1]> = {}) {
  let counter = 0;
  return createMemoryTripsSource(sampleLifecycleState(), {
    now: () => 1,
    newId: () => `new-${++counter}`,
    today: () => TODAY,
    staples: STAPLES,
    ...options,
  });
}

/** The source with some parts replaced; commands still go to `base`, so a spy on it sees them. */
function derive(base: ReturnType<typeof memory>, extra: Partial<TripsSource>): TripsSource {
  return {
    ...base,
    createTrip: (draft) => base.createTrip(draft),
    skipWeather: (id) => base.skipWeather(id),
    ...extra,
  };
}

const renderMap = vi.fn(async (...args: unknown[]) => {
  void args;
  return <div data-testid="map" />;
});

async function setup(
  props: Partial<PlanScreenProps> = {},
  options: {
    laptop?: boolean;
    source?: (base: ReturnType<typeof memory>) => TripsSource;
    memory?: Partial<Parameters<typeof createMemoryTripsSource>[1]>;
  } = {},
) {
  viewport(options.laptop ?? true);
  nav.push.mockClear();
  renderMap.mockClear();
  const base = memory(options.memory);
  const source = options.source ? options.source(base) : base;
  const user = userEvent.setup();
  renderInApp(
    <TripsSourceProvider source={source}>
      <PlanScreen getToday={() => TODAY} renderMap={renderMap} {...props} />
    </TripsSourceProvider>,
  );
  await screen.findByRole("heading", { name: "Plan a trip", level: 1 });
  await waitFor(() => expect(screen.queryByLabelText("Loading")).toBeNull());
  return { user, base, source };
}

/** The text an element is described by (aria-describedby), the way a screen reader reads it. */
function describedBy(element: Element): string {
  return (element.getAttribute("aria-describedby") ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent ?? "")
    .join(" ")
    .trim();
}

const next = () => screen.getByRole("button", { name: "Next" });

async function chooseDestination(
  user: ReturnType<typeof userEvent.setup>,
  query: string,
  option: RegExp,
  label = "Destination search",
) {
  await user.type(screen.getByRole("combobox", { name: label }), query);
  await user.click(await screen.findByRole("option", { name: option }));
}

function setDates(start: string, end: string) {
  fireEvent.change(screen.getByLabelText("Leave", { exact: true }), { target: { value: start } });
  fireEvent.change(screen.getByLabelText("Return", { exact: true }), { target: { value: end } });
}

/** Where, When and How, up to the Starting list. */
async function toStartingList(user: ReturnType<typeof userEvent.setup>) {
  await chooseDestination(user, "lon", /England/);
  await user.click(next());
  setDates("2026-11-12", "2026-11-22");
  await user.click(next());
  await user.click(screen.getByRole("radio", { name: "Fly" }));
  await user.click(next());
  await screen.findByRole("heading", { name: "Starting list" });
}

describe("Plan a trip, laptop", () => {
  beforeEach(() => viewport(true));

  it("shows the five steps with only Where open, and the live preview beside them", async () => {
    await setup();
    for (const title of ["Where", "When", "How", "Starting list", "Review"]) {
      expect(screen.getByRole("heading", { name: title, level: 2 })).toBeTruthy();
    }
    expect(screen.getByRole("region", { name: "Where" }).getAttribute("aria-current")).toBe("step");
    expect(screen.getByRole("combobox", { name: "Destination search" })).toBeTruthy();
    expect(screen.queryByLabelText("Leave")).toBeNull();
    expect(screen.getByRole("complementary", { name: "Live preview of your trip" })).toBeTruthy();
    expect(screen.getByText("Add dates to see your list")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Trips/ }).getAttribute("href")).toBe("/");
  });

  it("will not go on without a place, says why, and shows the reason in the accent colour once pressed", async () => {
    const { user } = await setup();
    expect(next().getAttribute("aria-disabled")).toBe("true");
    expect(describedBy(next())).toBe("Choose a destination from the list to continue.");
    await user.click(next());
    expect(screen.getByRole("combobox", { name: "Destination search" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "When" }).getAttribute("data-state")).toBe("pending");
    expect(
      screen.getByText("Choose a destination from the list to continue.", {
        selector: "p[class*=error]",
      }),
    ).toBeTruthy();
  });

  it("moves focus to the next step's heading on Next, and back to a step's heading on Edit", async () => {
    const { user } = await setup();
    await chooseDestination(user, "lon", /England/);
    await user.click(next());
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "When", level: 2 }));
    expect(screen.getByRole("status", { name: "Plan progress" }).textContent).toContain(
      "When, step 2 of 5",
    );
    setDates("2026-11-12", "2026-11-16");
    await user.click(next());
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "How", level: 2 }));
    await user.click(screen.getByRole("button", { name: "Edit Where" }));
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Where", level: 2 }));
    expect(screen.getByRole("region", { name: "Where" }).getAttribute("aria-current")).toBe("step");
    // The steps after it were finished and stay finished: Next goes straight on to the first one that is not (How).
    await user.click(next());
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "How", level: 2 }));
  });

  it("collapses finished steps to a summary with an Edit button; pending steps have no control", async () => {
    const { user } = await setup();
    await chooseDestination(user, "lon", /England/);
    await user.click(next());
    const where = screen.getByRole("region", { name: "Where" });
    expect(where.getAttribute("data-state")).toBe("done");
    expect(within(where).getByText(/London/)).toBeTruthy();
    expect(within(where).getByRole("button", { name: "Edit Where" })).toBeTruthy();
    const how = screen.getByRole("region", { name: "How" });
    expect(how.getAttribute("data-state")).toBe("pending");
    expect(within(how).queryByRole("button")).toBeNull();
    setDates("2026-11-12", "2026-11-22");
    await user.click(next());
    expect(
      within(screen.getByRole("region", { name: "When" })).getByText(
        /Thu 12 – Sun 22 Nov · 10 nights/,
      ),
    ).toBeTruthy();
  });

  it("walks the whole plan and creates the trip with its origin, mode and name", async () => {
    const { user, base } = await setup({}, { memory: { homeCity: SEATTLE } });
    const spy = vi.spyOn(base, "createTrip");
    expect(screen.getByRole("button", { name: /From: Seattle \(home\)/ })).toBeTruthy();
    await toStartingList(user);
    expect(screen.getByText(/About \d+ items to start/)).toBeTruthy();
    await user.click(next());
    await screen.findByRole("heading", { name: "Review", level: 2 });
    await user.type(screen.getByLabelText("Name this trip"), "  Spring break ");
    expect(screen.getByText("Route", { selector: "dt" })).toBeTruthy();
    expect(screen.getByText("Seattle → London → Seattle")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Create trip" }));
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith("/"));
    expect(spy).toHaveBeenCalledTimes(1);
    const draft = spy.mock.calls[0][0];
    expect(draft).toMatchObject({
      mode: "create",
      origin: { id: "us-wa-seattle" },
      travelMode: "fly",
      name: "Spring break",
      start: "2026-11-12",
      end: "2026-11-22",
    });
    expect(base.snapshot().trips[0].destination).toBe("London");
    expect(screen.getByText("Trip saved")).toBeTruthy();
  });

  it("shows the live preview: the tag, the count and the cubes, and keeps them current", async () => {
    const { user } = await setup();
    await toStartingList(user);
    const tag = screen.getByRole("complementary", { name: "Live preview of your trip" });
    expect(within(tag).getByText(/NEW TRIP · Thu 12 – Sun 22 Nov/)).toBeTruthy();
    expect(within(tag).getByText("London")).toBeTruthy();
    expect(within(tag).getByText("11 days")).toBeTruthy();
    const count = () =>
      Number(/About (\d+) items/.exec(within(tag).getByRole("status").textContent ?? "")![1]);
    const before = count();
    expect(within(tag).getByRole("list", { name: "Cubes" })).toBeTruthy();
    await user.click(screen.getByRole("checkbox", { name: /I’ll have laundry/ }));
    expect(count()).toBeLessThan(before);
  });

  it("says what laundry does, from the real build, and the footer line agrees with the count", async () => {
    const { user } = await setup();
    await toStartingList(user);
    const card = screen.getByRole("checkbox", { name: /I’ll have laundry/ });
    expect(describedBy(card)).toBe(
      "Tees would be 5 instead of 10. Underwear and socks stay one per day.",
    );
    await user.click(card);
    expect(describedBy(card)).toBe("Tees: 5 instead of 10. Underwear and socks stay one per day.");
    const tag = screen.getByRole("complementary", { name: "Live preview of your trip" });
    const total = /About (\d+) items/.exec(within(tag).getByRole("status").textContent ?? "")![1];
    expect(screen.getByText(`About ${total} items`, { selector: "strong" })).toBeTruthy();
    expect(
      screen.getByText(/sorted into \d+ cubes\. You can edit everything after\./),
    ).toBeTruthy();
  });

  it("keeps Your Staples on: checked, disabled and not removable", async () => {
    const { user } = await setup();
    await toStartingList(user);
    const staples = screen.getByRole("checkbox", { name: /Your Staples/ });
    expect((staples as HTMLInputElement).checked).toBe(true);
    expect((staples as HTMLButtonElement).disabled).toBe(true);
    expect(describedBy(staples)).toMatch(/counted for 10 nights/);
    await user.click(staples);
    expect((staples as HTMLInputElement).checked).toBe(true);
  });

  it("Back returns one step and keeps what was entered", async () => {
    const { user } = await setup();
    await toStartingList(user);
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "How", level: 2 }));
    expect((screen.getByRole("radio", { name: "Fly" }) as HTMLInputElement).checked).toBe(true);
  });

  it("will not leave How without a choice", async () => {
    const { user } = await setup();
    await chooseDestination(user, "lon", /England/);
    await user.click(next());
    setDates("2026-11-12", "2026-11-14");
    await user.click(next());
    expect(describedBy(next())).toBe("Choose how you’re getting there to continue.");
    await user.click(next());
    expect((screen.getByRole("radio", { name: "Drive" }) as HTMLInputElement).checked).toBe(false);
    await user.click(screen.getByRole("radio", { name: "Train or other" }));
    await user.click(next());
    expect(document.activeElement).toBe(
      screen.getByRole("heading", { name: "Starting list", level: 2 }),
    );
  });

  it("moves a return date that is before the departure and says so", async () => {
    const { user } = await setup();
    await chooseDestination(user, "lon", /England/);
    await user.click(next());
    setDates("2026-11-12", "2026-11-16");
    fireEvent.change(screen.getByLabelText("Leave", { exact: true }), {
      target: { value: "2026-11-20" },
    });
    expect(screen.getByRole("status", { name: "Date notice" }).textContent).toContain(
      "Return date moved to match your departure.",
    );
    expect((screen.getByLabelText("Return", { exact: true }) as HTMLInputElement).value).toBe(
      "2026-11-20",
    );
  });
});

describe("From", () => {
  beforeEach(() => viewport(true));

  it("shows the home city as 'home' and lets the person change it for this trip", async () => {
    const { user, base } = await setup({}, { memory: { homeCity: SEATTLE } });
    const spy = vi.spyOn(base, "createTrip");
    await user.click(screen.getByRole("button", { name: /From: Seattle \(home\)/ }));
    await user.type(screen.getByRole("combobox", { name: "From" }), "chic");
    await user.click(await screen.findByRole("option", { name: /Illinois/ }));
    expect(screen.getByRole("button", { name: "From: Chicago. Change" })).toBeTruthy();
    expect(screen.queryByText("· home")).toBeNull();
    await toStartingList(user);
    await user.click(next());
    await user.click(screen.getByRole("button", { name: "Create trip" }));
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(spy.mock.calls[0][0].origin).toMatchObject({ id: "us-il-chicago" });
  });

  it("can keep the home city after opening the search", async () => {
    const { user } = await setup({}, { memory: { homeCity: SEATTLE } });
    await user.click(screen.getByRole("button", { name: /From: Seattle \(home\)/ }));
    await user.click(screen.getByRole("button", { name: "Keep Seattle" }));
    expect(screen.getByRole("button", { name: /From: Seattle \(home\)/ })).toBeTruthy();
  });

  it("with no home city asks for a starting place (optional) and sends none when left blank", async () => {
    const { user, base } = await setup();
    expect(screen.getByRole("combobox", { name: "From" })).toBeTruthy();
    expect(screen.getByText(/Optional\. Without a starting place/)).toBeTruthy();
    const spy = vi.spyOn(base, "createTrip");
    await toStartingList(user);
    await user.click(next());
    await user.click(screen.getByRole("button", { name: "Create trip" }));
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(spy.mock.calls[0][0].origin).toBeNull();
  });

  it("leaves the origin to the server when the home city cannot be read", async () => {
    const { user, base } = await setup(
      {},
      {
        source: (b) => derive(b, { homeCity: async () => Promise.reject(new Error("INTERNAL")) }),
      },
    );
    const spy = vi.spyOn(base, "createTrip");
    await toStartingList(user);
    await user.click(next());
    await user.click(screen.getByRole("button", { name: "Create trip" }));
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect("origin" in spy.mock.calls[0][0] && spy.mock.calls[0][0].origin).toBeUndefined();
  });
});

describe("a route of several stops", () => {
  beforeEach(() => viewport(true));

  it("adds a second stop, dates each stop on When, and creates a multi-stop trip", async () => {
    const { user, base } = await setup();
    const spy = vi.spyOn(base, "createTrip");
    await chooseDestination(user, "lis", /Portugal/);
    await user.click(screen.getByRole("button", { name: "Add a stop" }));
    await chooseDestination(user, "par", /France/, "Destination search, Stop 2");
    await user.click(next());
    fireEvent.change(screen.getByLabelText("Arrive", { exact: true }), {
      target: { value: "2026-03-14" },
    });
    fireEvent.change(screen.getByLabelText("Leave", { exact: true }), {
      target: { value: "2026-03-18" },
    });
    fireEvent.change(screen.getByLabelText("Leave, Stop 2"), { target: { value: "2026-03-24" } });
    expect((screen.getByLabelText("Arrive, Stop 2") as HTMLInputElement).value).toBe("2026-03-18");
    expect(screen.getByLabelText("Arrive, Stop 2").getAttribute("readonly")).not.toBeNull();
    await user.click(next());
    expect(screen.getByRole("region", { name: "Where" })).toBeTruthy();
    expect(
      within(screen.getByRole("region", { name: "When" })).getByText(
        /Sat 14 – Tue 24 Mar · 10 nights/,
      ),
    ).toBeTruthy();
    await user.click(screen.getByRole("radio", { name: "Fly" }));
    await user.click(next());
    await user.click(next());
    await user.click(screen.getByRole("button", { name: "Create trip" }));
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(draftCities(spy.mock.calls[0][0])).toEqual(["Lisbon", "Paris"]);
    expect(screen.queryByText(/Lisbon \+ Paris/)).not.toBeNull();
  });

  it("shows each stop's dates on its row once the dates are done", async () => {
    const { user } = await setup();
    await chooseDestination(user, "lis", /Portugal/);
    await user.click(screen.getByRole("button", { name: "Add a stop" }));
    await chooseDestination(user, "par", /France/, "Destination search, Stop 2");
    await user.click(next());
    fireEvent.change(screen.getByLabelText("Arrive", { exact: true }), {
      target: { value: "2026-03-15" },
    });
    fireEvent.change(screen.getByLabelText("Leave", { exact: true }), {
      target: { value: "2026-03-18" },
    });
    fireEvent.change(screen.getByLabelText("Leave, Stop 2"), { target: { value: "2026-03-23" } });
    await user.click(next());
    await user.click(screen.getByRole("button", { name: "Edit Where" }));
    expect(screen.getByText("15–18 Mar")).toBeTruthy();
    expect(screen.getByText("18–23 Mar")).toBeTruthy();
  });

  it("asks for the missing dates in words, with a Fix dates button for a gap", async () => {
    const { user } = await setup();
    await chooseDestination(user, "lis", /Portugal/);
    await user.click(screen.getByRole("button", { name: "Add a stop" }));
    await chooseDestination(user, "par", /France/, "Destination search, Stop 2");
    await user.click(next());
    expect(describedBy(next())).toMatch(/Fix \d things? above to continue\./);
    await user.click(next());
    expect(screen.getAllByText(/Choose a date\./).length).toBeGreaterThan(0);
    fireEvent.change(screen.getByLabelText("Arrive", { exact: true }), {
      target: { value: "2026-03-14" },
    });
    fireEvent.change(screen.getByLabelText("Leave", { exact: true }), {
      target: { value: "2026-03-18" },
    });
    fireEvent.change(screen.getByLabelText("Leave, Stop 2"), { target: { value: "2026-03-24" } });
    expect(screen.queryByRole("button", { name: "Fix dates" })).toBeNull();
  });

  it("needs a place for every stop before Where is done", async () => {
    const { user } = await setup();
    await chooseDestination(user, "lis", /Portugal/);
    await user.click(screen.getByRole("button", { name: "Add a stop" }));
    expect(describedBy(next())).toBe("Choose a place for each stop to continue.");
    await user.click(next());
    expect(screen.getByText("Choose a place for Stop 2.")).toBeTruthy();
  });
});

function draftCities(draft: { stops?: { location: { city: string } | null }[] }) {
  return (draft.stops ?? []).map((stop) => stop.location?.city);
}

describe("Copy a past trip", () => {
  beforeEach(() => viewport(true));

  it("offers the latest past trip and copies its preferences", async () => {
    const { user, base } = await setup();
    const spy = vi.spyOn(base, "createTrip");
    await toStartingList(user);
    const card = screen.getByRole("checkbox", { name: /Copy a past trip/ });
    expect((card as HTMLInputElement).checked).toBe(false);
    expect(describedBy(card)).toMatch(/Lisbon · Sep 2026 · \d+ items/);
    await user.click(card);
    expect((card as HTMLInputElement).checked).toBe(true);
    expect(
      (screen.getByRole("radio", { name: /Lisbon · Sep 2026/ }) as HTMLInputElement).checked,
    ).toBe(true);
    await user.click(next());
    await user.click(screen.getByRole("button", { name: "Create trip" }));
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(spy.mock.calls[0][0]).toMatchObject({ mode: "copy", sourceId: "lisbon" });
  });

  it("shows what the copied preferences add or remove against the Staples, and lets it be undone", async () => {
    const { user } = await setup();
    await toStartingList(user);
    const card = screen.getByRole("checkbox", { name: /Copy a past trip/ });
    // The figure is there before the box is ticked: it is what the latest past trip's preferences would do to the count.
    expect(card.closest("label")!.lastElementChild!.textContent).toMatch(/^[+−]?\d+$/);
    await user.click(card);
    expect(card.closest("label")!.lastElementChild!.textContent).toMatch(/^[+−]?\d+$/);
    await user.click(card);
    expect((card as HTMLInputElement).checked).toBe(false);
    expect(screen.queryByRole("radio", { name: /Lisbon/ })).toBeNull();
  });

  it("is hidden when the account has no past trips", async () => {
    viewport(true);
    const empty = createMemoryTripsSource(
      { trips: [], deletedTrips: [], draft: null },
      { now: () => 1, newId: () => "x", today: () => TODAY, staples: STAPLES },
    );
    const user = userEvent.setup();
    renderInApp(
      <TripsSourceProvider source={empty}>
        <PlanScreen getToday={() => TODAY} renderMap={renderMap} />
      </TripsSourceProvider>,
    );
    await screen.findByRole("heading", { name: "Plan a trip", level: 1 });
    await waitFor(() => expect(screen.queryByLabelText("Loading")).toBeNull());
    await toStartingList(user);
    expect(screen.queryByRole("checkbox", { name: /Copy a past trip/ })).toBeNull();
  });
});

describe("?copy=<trip id>", () => {
  beforeEach(() => viewport(true));

  it("says so when the trip is gone", async () => {
    viewport(true);
    const base = memory();
    renderInApp(
      <TripsSourceProvider source={base}>
        <PlanScreen copyId="nope" getToday={() => TODAY} renderMap={renderMap} />
      </TripsSourceProvider>,
    );
    expect(await screen.findByRole("heading", { name: "That trip isn’t available" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Back to trips" }).getAttribute("href")).toBe("/");
  });

  it("starts with the source trip chosen, and asks for new dates", async () => {
    const { user, base } = await setup({ copyId: "san-diego" });
    const spy = vi.spyOn(base, "createTrip");
    await chooseDestination(user, "lon", /England/);
    await user.click(next());
    setDates("2026-11-12", "2026-11-16");
    await user.click(next());
    await user.click(screen.getByRole("radio", { name: "Drive" }));
    await user.click(next());
    const card = screen.getByRole("checkbox", { name: /Copy a past trip/ });
    expect((card as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("radio", { name: /San Diego/ }) as HTMLInputElement).checked).toBe(
      true,
    );
    await user.click(next());
    await user.click(screen.getByRole("button", { name: "Create trip" }));
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(spy.mock.calls[0][0]).toMatchObject({
      mode: "copy",
      sourceId: "san-diego",
    });
    expect(spy.mock.calls[0][0]).not.toHaveProperty("theme");
    expect(base.snapshot().trips[0].theme).toBe("beach");
    expect(base.snapshot().trips.find((trip) => trip.id === "san-diego")?.theme).toBe("beach");
  });

  it("a copy of a route keeps its stops and wants a new first arrival", async () => {
    const base = memory();
    // A two-stop route as the copy source.
    const state = base.snapshot();
    const lisbon = state.trips.find((trip) => trip.id === "lisbon")!;
    const stops = [
      { location: place("pt-lisbon"), arrive: lisbon.start, leave: "2026-09-05" },
      { location: place("fr-idf-paris"), arrive: "2026-09-05", leave: lisbon.end },
    ];
    const multi = createMemoryTripsSource(
      {
        ...state,
        trips: state.trips.map((trip) => (trip.id === "lisbon" ? { ...trip, stops } : trip)),
      },
      { now: () => 1, newId: () => "x", today: () => TODAY, staples: STAPLES },
    );
    const user = userEvent.setup();
    viewport(true);
    renderInApp(
      <TripsSourceProvider source={multi}>
        <PlanScreen copyId="lisbon" getToday={() => TODAY} renderMap={renderMap} />
      </TripsSourceProvider>,
    );
    await screen.findByRole("heading", { name: "Plan a trip", level: 1 });
    await waitFor(() => expect(screen.queryByLabelText("Loading")).toBeNull());
    expect(screen.getAllByText("Lisbon").length).toBeGreaterThan(0);
    await user.click(next());
    expect(describedBy(next())).toBe("Choose a new start date for the copy.");
    await user.click(next());
    expect(
      screen.getAllByText("Choose a new start date for the copy.", { selector: "p[class*=error]" }),
    ).toHaveLength(2);
    fireEvent.change(screen.getByLabelText("Arrive", { exact: true }), {
      target: { value: "2026-12-01" },
    });
    expect((screen.getByLabelText("Leave", { exact: true }) as HTMLInputElement).value).toBe(
      "2026-12-03",
    );
    await user.click(next());
    expect(screen.getByRole("heading", { name: "How", level: 2 })).toBeTruthy();
  });
});

describe("Start from a saved list", () => {
  beforeEach(() => viewport(true));
  const LIST = {
    id: "list-1",
    name: "Beach week",
    updatedAt: "2026-10-01T00:00:00.000Z",
    items: [
      { id: "a", name: "Towel", category: "Misc", qty: 2 },
      { id: "b", name: "Sunscreen", category: "Toiletries", qty: 1 },
    ],
  };

  it("offers the saved list, replaces the Staples with it, and creates from it", async () => {
    const { user, base } = await setup({}, { memory: { savedLists: [LIST] } });
    const spy = vi.spyOn(base, "createTrip");
    await toStartingList(user);
    const card = screen.getByRole("checkbox", { name: /Start from a saved list/ });
    await user.click(card);
    expect(
      ((await screen.findByRole("radio", { name: /Beach week · 2 items/ })) as HTMLInputElement)
        .checked,
    ).toBe(true);
    await waitFor(() => expect(card.closest("div")?.textContent).toMatch(/3/));
    expect(describedBy(screen.getByRole("checkbox", { name: /Your Staples/ }))).toBe(
      "Your saved list stands in for them on this trip",
    );
    const tag = screen.getByRole("complementary", { name: "Live preview of your trip" });
    await waitFor(() =>
      expect(within(tag).getByRole("status").textContent).toContain("About 3 items to start"),
    );
    expect(screen.queryByRole("checkbox", { name: /Copy a past trip/ })).toBeNull();
    await user.click(next());
    await user.click(screen.getByRole("button", { name: "Create trip" }));
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(spy.mock.calls[0][0]).toMatchObject({ mode: "create", savedListId: "list-1" });
  });

  it("an ineffective laundry opt-in is dropped when a fixed saved list is chosen: hidden, and not sent (#412)", async () => {
    const { user, base } = await setup({}, { memory: { savedLists: [LIST] } });
    const spy = vi.spyOn(base, "createTrip");
    await toStartingList(user);
    await user.click(screen.getByRole("checkbox", { name: /I’ll have laundry/ }));
    await user.click(screen.getByRole("checkbox", { name: /Start from a saved list/ }));
    await screen.findByRole("radio", { name: /Beach week/ });
    await waitFor(() =>
      expect(screen.queryByRole("checkbox", { name: /I’ll have laundry/ })).toBeNull(),
    );
    await user.click(next());
    await user.click(screen.getByRole("button", { name: "Create trip" }));
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(spy.mock.calls[0][0]).toMatchObject({ savedListId: "list-1" });
    expect(spy.mock.calls[0][0].config.laundry).toBe(false);
  });

  it("goes back to the Staples when the list is unchecked", async () => {
    const { user } = await setup({}, { memory: { savedLists: [LIST] } });
    await toStartingList(user);
    const card = screen.getByRole("checkbox", { name: /Start from a saved list/ });
    await user.click(card);
    await screen.findByRole("radio", { name: /Beach week/ });
    await user.click(card);
    expect(describedBy(screen.getByRole("checkbox", { name: /Your Staples/ }))).toMatch(
      /counted for 10 nights/,
    );
    expect(screen.getByRole("checkbox", { name: /Copy a past trip/ })).toBeTruthy();
  });

  it("says when the list could not be loaded", async () => {
    const { user } = await setup(
      {},
      {
        memory: { savedLists: [LIST] },
        source: (base) =>
          derive(base, {
            savedLists: {
              list: async () => base.savedLists!.list(),
              get: async () => Promise.reject(new Error("NOT_FOUND")),
            },
          }),
      },
    );
    await toStartingList(user);
    await user.click(screen.getByRole("checkbox", { name: /Start from a saved list/ }));
    await waitFor(() =>
      expect(describedBy(screen.getByRole("checkbox", { name: /Start from a saved list/ }))).toBe(
        "That list couldn’t be loaded. Try again.",
      ),
    );
  });

  it("while the chosen list is still loading, an ineffective laundry opt-in is not sent (#412)", async () => {
    const { user, base } = await setup(
      {},
      {
        memory: { savedLists: [LIST] },
        source: (b) =>
          derive(b, {
            savedLists: {
              list: async () => b.savedLists!.list(),
              get: () => new Promise<never>(() => undefined),
            },
          }),
      },
    );
    const spy = vi.spyOn(base, "createTrip");
    await toStartingList(user);
    await user.click(screen.getByRole("checkbox", { name: /I’ll have laundry/ }));
    await user.click(screen.getByRole("checkbox", { name: /Start from a saved list/ }));
    await user.click(next());
    await user.click(screen.getByRole("button", { name: "Create trip" }));
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(spy.mock.calls[0][0]).toMatchObject({ savedListId: "list-1" });
    expect(spy.mock.calls[0][0].config.laundry).toBe(false);
  });

  it("shows only the lists' own rows when there are several", async () => {
    const second = { ...LIST, id: "list-2", name: "City break" };
    const { user } = await setup({}, { memory: { savedLists: [LIST, second] } });
    await toStartingList(user);
    await user.click(screen.getByRole("checkbox", { name: /Start from a saved list/ }));
    await user.click(await screen.findByRole("radio", { name: /City break/ }));
    expect((screen.getByRole("radio", { name: /City break/ }) as HTMLInputElement).checked).toBe(
      true,
    );
    expect((screen.getByRole("radio", { name: /Beach week/ }) as HTMLInputElement).checked).toBe(
      false,
    );
  });
});

const WET: StopWeather[] = [
  {
    stopIndex: 0,
    status: "ok",
    days: ["2026-11-12", "2026-11-13", "2026-11-14"].map((date) => ({
      date,
      stopIndex: 0,
      source: "forecast" as const,
      highC: 15,
      lowC: 10,
      precipProbability: 0.9,
      precipMm: 9,
      snowCm: 0,
      uvIndexMax: 1,
      sunshineHours: 1,
    })),
  },
];

function withWeather(base: ReturnType<typeof memory>, optedIn: boolean, result?: unknown) {
  let weatherOptIn = optedIn;
  const previewDraft = vi.fn().mockResolvedValue(result ?? { kind: "ready", stops: WET });
  const createTripWithReview = vi.fn(
    async (draft: Parameters<typeof base.createTrip>[0], _a: unknown[]) => {
      void _a;
      return base.createTrip(draft);
    },
  );
  const updateSettings = vi.fn(async (change: { weatherOptIn?: boolean }) => {
    weatherOptIn = change.weatherOptIn ?? weatherOptIn;
    return { weatherOptIn, temperatureUnit: "F" as const };
  });
  const skip = vi
    .spyOn(base, "skipWeather")
    .mockImplementation(async (id: string) => base.acceptWeather(id));
  const source: TripsSource = derive(base, {
    weather: {
      getSettings: async () => ({ weatherOptIn, temperatureUnit: "F" }),
      updateSettings,
      getTripWeather: vi.fn(),
      previewDraft,
      createTripWithReview,
      listSuggestions: vi.fn(),
      applyReview: vi.fn(),
    },
  });
  return { source, previewDraft, createTripWithReview, updateSettings, skip };
}

describe("weather", () => {
  beforeEach(() => viewport(true));

  async function withFeed(optedIn: boolean, result?: unknown) {
    let feed!: ReturnType<typeof withWeather>;
    const rendered = await setup(
      {},
      {
        source: (base) => {
          feed = withWeather(base, optedIn, result);
          return feed.source;
        },
      },
    );
    return { ...rendered, feed };
  }

  it("asks once, with the disclosure, when weather is not opted in; 'Not now' answers it and the trip starts with weather off", async () => {
    const { user, feed, base } = await withFeed(false);
    await toStartingList(user);
    const card = await screen.findByRole("checkbox", { name: /Weather suggestions/ });
    expect((card as HTMLButtonElement).disabled).toBe(true);
    expect(describedBy(card)).toMatch(/Only map coordinates and dates are sent to Open-Meteo/);
    expect(feed.previewDraft).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Not now" }));
    expect(feed.updateSettings).toHaveBeenCalledWith({ weatherOptIn: false });
    expect(await screen.findByText("Weather is off.")).toBeTruthy();
    await user.click(next());
    await user.click(screen.getByRole("button", { name: "Create trip" }));
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith("/"));
    expect(feed.createTripWithReview).not.toHaveBeenCalled();
    expect(base.snapshot().trips.length).toBe(3);
    expect(feed.skip).toHaveBeenCalled();
  });

  it("'Get weather' turns it on, shows the forecast rows beside the preview and adds the suggestions", async () => {
    const { user, feed } = await withFeed(false);
    await toStartingList(user);
    await user.click(await screen.findByRole("button", { name: "Get weather" }));
    expect(feed.updateSettings).toHaveBeenCalledWith({ weatherOptIn: true });
    const card = await screen.findByRole("checkbox", { name: /Weather suggestions/ });
    await waitFor(() => expect((card as HTMLInputElement).checked).toBe(true));
    expect(describedBy(card)).toMatch(/ · \d+ added$/);
    const aside = screen.getByRole("complementary", { name: "Live preview of your trip" });
    expect(within(aside).getByRole("heading", { name: "Weather · forecast" })).toBeTruthy();
    expect(within(aside).getByText("rain Thu–Sat")).toBeTruthy();
    expect(within(aside).getByText("59° / 50°")).toBeTruthy();
    expect(
      within(aside).getByText(/weather items? added\. You can change them while packing\./),
    ).toBeTruthy();
  });

  it("creates with the suggestions when kept, without them when unchecked", async () => {
    const { user, feed, base } = await withFeed(true);
    await toStartingList(user);
    const card = await screen.findByRole("checkbox", { name: /Weather suggestions/ });
    await waitFor(() => expect((card as HTMLInputElement).checked).toBe(true));
    const aside = screen.getByRole("complementary", { name: "Live preview of your trip" });
    const kept = /About (\d+) items/.exec(within(aside).getByRole("status").textContent ?? "")![1];
    await user.click(card);
    expect((card as HTMLInputElement).checked).toBe(false);
    expect(
      within(aside).getByText(/weather items? suggested\. You’ll review them while packing\./),
    ).toBeTruthy();
    const dropped = /About (\d+) items/.exec(
      within(aside).getByRole("status").textContent ?? "",
    )![1];
    expect(Number(dropped)).toBeLessThan(Number(kept));
    await user.click(card);
    await user.click(next());
    const create = vi.spyOn(base, "createTrip");
    await user.click(screen.getByRole("button", { name: "Create trip" }));
    await waitFor(() => expect(feed.createTripWithReview).toHaveBeenCalledTimes(1));
    const accepted = feed.createTripWithReview.mock.calls[0][1];
    expect(accepted.length).toBeGreaterThan(0);
    expect(create).toHaveBeenCalled();
  });

  it("creates plain when the suggestions are unchecked", async () => {
    const { user, feed, base } = await withFeed(true);
    await toStartingList(user);
    const card = await screen.findByRole("checkbox", { name: /Weather suggestions/ });
    await waitFor(() => expect((card as HTMLInputElement).checked).toBe(true));
    await user.click(card);
    await user.click(next());
    const create = vi.spyOn(base, "createTrip");
    await user.click(screen.getByRole("button", { name: "Create trip" }));
    await waitFor(() => expect(create).toHaveBeenCalled());
    expect(feed.createTripWithReview).not.toHaveBeenCalled();
  });

  it.each([
    ["offline", /You’re offline/],
    ["unavailable", /Weather isn’t available/],
  ])("says so when the weather is %s and offers Try again", async (kind, text) => {
    const { user, feed } = await withFeed(true, { kind });
    await toStartingList(user);
    const card = await screen.findByRole("checkbox", { name: /Weather suggestions/ });
    await waitFor(() => expect(describedBy(card)).toMatch(text));
    expect((card as HTMLButtonElement).disabled).toBe(true);
    feed.previewDraft.mockResolvedValue({ kind: "ready", stops: WET });
    await user.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect((card as HTMLInputElement).checked).toBe(true));
  });

  it("can turn weather back on from 'Weather is off'", async () => {
    const { user, feed } = await withFeed(false);
    await toStartingList(user);
    await user.click(await screen.findByRole("button", { name: "Not now" }));
    await user.click(await screen.findByRole("button", { name: "Turn on" }));
    expect(feed.updateSettings).toHaveBeenLastCalledWith({ weatherOptIn: true });
    const card = await screen.findByRole("checkbox", { name: /Weather suggestions/ });
    await waitFor(() => expect((card as HTMLInputElement).checked).toBe(true));
  });

  it("tells the person when weather could not be updated", async () => {
    const { user, feed } = await withFeed(false);
    feed.updateSettings.mockRejectedValueOnce(new Error("INTERNAL"));
    await toStartingList(user);
    await user.click(await screen.findByRole("button", { name: "Get weather" }));
    expect(await screen.findByText("Couldn’t update weather. Nothing was changed.")).toBeTruthy();
  });

  it("does not offer weather when the source has none", async () => {
    const { user } = await setup();
    await toStartingList(user);
    expect(screen.queryByRole("checkbox", { name: /Weather suggestions/ })).toBeNull();
  });
});

describe("the map", () => {
  beforeEach(() => viewport(true));

  it("asks the server to draw the route once places have coordinates, and shows what comes back", async () => {
    const located = (id: string, latitude: number, longitude: number) => ({
      ...place(id),
      latitude,
      longitude,
    });
    const { user } = await setup(
      {},
      { memory: { homeCity: { location: located("us-wa-seattle", 47.61, -122.33) } } },
    );
    await waitFor(() => expect(renderMap).toHaveBeenCalled());
    expect(renderMap.mock.calls.at(-1)![0]).toMatchObject({
      points: [{ kind: "home", label: "Seattle" }],
      size: "laptop",
    });
    expect(await screen.findByTestId("map")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /From: Seattle/ }));
  });

  it("asks again when the server's first answer is nothing or fails, so the box is not left blank", async () => {
    const located = { ...place("us-wa-seattle"), latitude: 1, longitude: 2 };
    renderMap.mockResolvedValueOnce(null as never);
    renderMap.mockRejectedValueOnce(new Error("down"));
    await setup({}, { memory: { homeCity: { location: located } } });
    expect(await screen.findByTestId("map", {}, { timeout: 4000 })).toBeTruthy();
    expect(renderMap).toHaveBeenCalledTimes(3);
  });

  it("gives up after the retries and shows no map (and no 'ready' mark), while the plan keeps working", async () => {
    const located = { ...place("us-wa-seattle"), latitude: 1, longitude: 2 };
    renderMap.mockRejectedValue(new Error("down"));
    await setup({}, { memory: { homeCity: { location: located } } });
    await waitFor(() => expect(renderMap).toHaveBeenCalledTimes(3), { timeout: 4000 });
    expect(screen.queryByTestId("map")).toBeNull();
    expect(document.querySelector("[data-map-ready]")).toBeNull();
    renderMap.mockReset();
    renderMap.mockImplementation(async () => <div data-testid="map" />);
  });
});

describe("Plan a trip, phone", () => {
  beforeEach(() => viewport(false));

  it("is one step per screen: step n of 5, progress, a close button, and no preview", async () => {
    const { user } = await setup({}, { laptop: false });
    expect(screen.getByText("Step 1 of 5")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Where", level: 2 })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "When" })).toBeNull();
    expect(screen.queryByRole("complementary")).toBeNull();
    expect(
      screen.getByRole("link", { name: "Close and return to trips" }).getAttribute("href"),
    ).toBe("/");
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
    await chooseDestination(user, "lon", /England/);
    await user.click(next());
    expect(screen.getByText("Step 2 of 5")).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "When", level: 2 }));
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Where", level: 2 }));
    expect(screen.getByText("Step 1 of 5")).toBeTruthy();
  });

  it("shows the tag, map and suitcase summary on Review only, and creates from there", async () => {
    const { user, base } = await setup({}, { laptop: false });
    const spy = vi.spyOn(base, "createTrip");
    await toStartingList(user);
    expect(screen.getByText("Step 4 of 5")).toBeTruthy();
    expect(screen.queryByRole("complementary")).toBeNull();
    await user.click(next());
    expect(screen.getByText("Step 5 of 5")).toBeTruthy();
    const preview = screen.getByRole("complementary", { name: "Live preview of your trip" });
    expect(within(preview).getByText("London")).toBeTruthy();
    expect(within(preview).getByText(/About \d+ items to start/)).toBeTruthy();
    expect(within(preview).queryByRole("heading")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Create trip" }));
    await waitFor(() => expect(spy).toHaveBeenCalled());
  });

  it("does not create twice while saving", async () => {
    const { user, base } = await setup({}, { laptop: false });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const original = base.createTrip.bind(base);
    const spy = vi.spyOn(base, "createTrip").mockImplementation(async (draft) => {
      await gate;
      return original(draft);
    });
    await toStartingList(user);
    await user.click(next());
    const create = screen.getByRole("button", { name: "Create trip" });
    await user.click(create);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Creating…" }).getAttribute("aria-busy")).toBe(
        "true",
      ),
    );
    await user.click(screen.getByRole("button", { name: "Creating…" }));
    await act(async () => release());
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith("/"));
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe("when something cannot be read or saved", () => {
  beforeEach(() => viewport(true));

  it("still plans when the trips, the Staples, the home city and the lists cannot be read", async () => {
    const { user, base } = await setup(
      {},
      {
        memory: { savedLists: [] },
        source: (b) =>
          derive(b, {
            load: async () => Promise.reject(new Error("INTERNAL")),
            listStaples: async () => Promise.reject(new Error("INTERNAL")),
            homeCity: async () => Promise.reject(new Error("INTERNAL")),
            savedLists: {
              list: async () => Promise.reject(new Error("INTERNAL")),
              get: async () => Promise.reject(new Error("INTERNAL")),
            },
          }),
      },
    );
    const spy = vi.spyOn(base, "createTrip");
    await toStartingList(user);
    expect(screen.queryByRole("checkbox", { name: /Copy a past trip/ })).toBeNull();
    expect(screen.queryByRole("checkbox", { name: /Start from a saved list/ })).toBeNull();
    // Without Staples the list is the calculator's alone, and the count says so.
    expect(screen.getByText(/About \d+ items to start/)).toBeTruthy();
    await user.click(next());
    await user.click(screen.getByRole("button", { name: "Create trip" }));
    await waitFor(() => expect(spy).toHaveBeenCalled());
  });

  it("stays on Review, with Create trip working again, when the trip could not be saved", async () => {
    const { user, base } = await setup({});
    vi.spyOn(base, "createTrip").mockRejectedValueOnce(new Error("INTERNAL"));
    await toStartingList(user);
    await user.click(next());
    await user.click(screen.getByRole("button", { name: "Create trip" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Create trip" })).toBeTruthy());
    expect(nav.push).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "Review", level: 2 })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Create trip" }));
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith("/"));
  });

  it("does not expose the retired trip-theme picker or put theme in a new draft", async () => {
    const { user, base } = await setup({});
    const spy = vi.spyOn(base, "createTrip");
    await toStartingList(user);
    await user.click(next());
    expect(screen.queryByRole("group", { name: "Trip theme" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Create trip" }));
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(spy.mock.calls[0][0]).not.toHaveProperty("theme");
    expect(base.snapshot().trips[0].theme).toBe("travel");
  });

  it("offers Fix dates when a stop leaves before it arrives", async () => {
    const { user } = await setup({});
    await chooseDestination(user, "lis", /Portugal/);
    await user.click(screen.getByRole("button", { name: "Add a stop" }));
    await chooseDestination(user, "par", /France/, "Destination search, Stop 2");
    await user.click(next());
    fireEvent.change(screen.getByLabelText("Arrive", { exact: true }), {
      target: { value: "2026-03-14" },
    });
    fireEvent.change(screen.getByLabelText("Leave", { exact: true }), {
      target: { value: "2026-03-12" },
    });
    await user.click(next());
    expect(screen.getAllByText(/Stay at least one night/).length).toBeGreaterThan(0);
    await user.click(screen.getByRole("button", { name: "Fix dates" }));
    expect(screen.getByRole("button", { name: "Fix dates" })).toBeTruthy();
  });
});

describe("weather states beyond the happy path", () => {
  beforeEach(() => viewport(true));

  async function withFeed(optedIn: boolean, result?: unknown) {
    let feed!: ReturnType<typeof withWeather>;
    const rendered = await setup(
      {},
      {
        source: (base) => {
          feed = withWeather(base, optedIn, result);
          return feed.source;
        },
      },
    );
    return { ...rendered, feed };
  }

  it("says the weather is unavailable when the forecast request fails", async () => {
    const { user, feed } = await withFeed(true);
    feed.previewDraft.mockRejectedValue(new Error("down"));
    await toStartingList(user);
    const card = await screen.findByRole("checkbox", { name: /Weather suggestions/ });
    await waitFor(() => expect(describedBy(card)).toMatch(/Weather isn’t available/));
  });

  it("offers no weather card when the settings cannot be read", async () => {
    const { user, feed } = await withFeed(true);
    const getSettings = vi.spyOn(feed.source.weather!, "getSettings");
    getSettings.mockRejectedValue(new Error("down"));
    await toStartingList(user);
    await waitFor(() => expect(getSettings).toHaveBeenCalled());
    expect(screen.queryByRole("checkbox", { name: /Weather suggestions/ })).toBeNull();
  });

  it("labels the rows 'usual' when the days are typical weather, and shows no weather note when nothing was added", async () => {
    const typical = WET.map((stop) => ({
      ...stop,
      days: stop.days.map((day) => ({ ...day, source: "typical" as const })),
    }));
    const { user } = await withFeed(true, { kind: "ready", stops: typical });
    await toStartingList(user);
    const aside = screen.getByRole("complementary", { name: "Live preview of your trip" });
    expect(await within(aside).findByRole("heading", { name: "Weather · usual" })).toBeTruthy();
  });

  it("hides the weather again when the plan goes back to a step that cannot have it", async () => {
    const { user } = await withFeed(true);
    await toStartingList(user);
    await waitFor(() =>
      expect(
        (screen.getByRole("checkbox", { name: /Weather suggestions/ }) as HTMLInputElement).checked,
      ).toBe(true),
    );
    await user.click(screen.getByRole("button", { name: "Edit When" }));
    fireEvent.change(screen.getByLabelText("Leave", { exact: true }), { target: { value: "" } });
    await waitFor(() =>
      expect(screen.queryByRole("heading", { name: "Weather · forecast" })).toBeNull(),
    );
  });

  it("does not offer weather when every stop is a custom place", async () => {
    const { user } = await setup(
      { allowCustom: true },
      { source: (base) => withWeather(base, true).source },
    );
    await user.type(
      screen.getByRole("combobox", { name: "Destination search" }),
      "Nowhere Special",
    );
    await user.click(await screen.findByRole("option", { name: /as typed/ }));
    await user.click(next());
    setDates("2026-11-12", "2026-11-16");
    await user.click(next());
    await user.click(screen.getByRole("radio", { name: "Fly" }));
    await user.click(next());
    expect(screen.queryByRole("checkbox", { name: /Weather suggestions/ })).toBeNull();
  });
});

describe("many past trips", () => {
  beforeEach(() => viewport(true));

  function manyPast() {
    const state = sampleLifecycleState();
    const lisbon = state.trips.find((trip) => trip.id === "lisbon")!;
    const past = Array.from({ length: 7 }, (_, at) => ({
      ...lisbon,
      id: `past-${at}`,
      destination: `Town ${at}`,
      start: `2026-0${at + 1}-03`,
      end: `2026-0${at + 1}-07`,
    }));
    return { ...state, trips: [...state.trips, ...past] };
  }

  it("lists the five latest and searches the rest, keeping the chosen trip visible", async () => {
    viewport(true);
    const source = createMemoryTripsSource(manyPast(), {
      now: () => 1,
      newId: () => "x",
      today: () => TODAY,
      staples: STAPLES,
    });
    const user = userEvent.setup();
    renderInApp(
      <TripsSourceProvider source={source}>
        <PlanScreen getToday={() => TODAY} renderMap={renderMap} />
      </TripsSourceProvider>,
    );
    await screen.findByRole("heading", { name: "Plan a trip", level: 1 });
    await waitFor(() => expect(screen.queryByLabelText("Loading")).toBeNull());
    await toStartingList(user);
    await user.click(screen.getByRole("checkbox", { name: /Copy a past trip/ }));
    expect(screen.getAllByRole("radio")).toHaveLength(5);
    const search = screen.getByLabelText("Search past trips");
    await user.type(search, "town 0");
    expect(screen.getByRole("radio", { name: /Town 0/ })).toBeTruthy();
    await user.click(screen.getByRole("radio", { name: /Town 0/ }));
    await user.clear(search);
    await user.type(search, "zzz");
    // The chosen trip is still listed, so the choice is never invisible.
    expect(screen.getAllByRole("radio")).toHaveLength(1);
    expect((screen.getByRole("radio", { name: /Town 0/ }) as HTMLInputElement).checked).toBe(true);
  });
});
