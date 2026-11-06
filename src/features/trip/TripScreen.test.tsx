// @vitest-environment jsdom
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { itemCube } from "@/domain/cubes";
import { renderInApp } from "@/test/providers";
import { sampleLifecycleState } from "@/features/trips/fixtures";
import {
  createMemoryTripsSource,
  TripsSourceError,
  type TripsSource,
} from "@/features/trips/trips-source";
import { TripsSourceProvider } from "@/features/trips/TripsSourceProvider";
import type { StopWeather } from "@/domain/weather/types";
import { buildCubeViews, headline } from "./packing/packing-model";
import { TripScreen } from "./TripScreen";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  usePathname: () => "/trips/san-diego",
  useRouter: () => ({ push }),
}));

const TOILETRIES = ["last-toothbrush", "last-toothpaste", "last-deodorant", "last-contacts"];

function memory() {
  let counter = 0;
  return createMemoryTripsSource(sampleLifecycleState(), {
    now: () => 1,
    newId: () => `new-${++counter}`,
    today: () => "2026-10-16",
  });
}

// The screen under test is the phone layout (below 1024px: no matchMedia in jsdom). These are the flows that belong to the
// screen, not to one layout: saves, retries, dialogs, the toiletry bag, weather, Ready. The phone layout itself is in
// TripScreen.phone.test.tsx and the laptop one in TripScreen.laptop.test.tsx.
let active: { source: ReturnType<typeof memory>; tripId: string };

function setup(
  tripId = "san-diego",
  wrap?: (base: ReturnType<typeof memory>) => TripsSource,
  openItemId?: string,
) {
  const base = memory();
  const source = wrap ? wrap(base) : base;
  const user = userEvent.setup();
  active = { source: base, tripId };
  const view = renderInApp(
    <TripsSourceProvider source={source}>
      <TripScreen tripId={tripId} openItemId={openItemId} />
    </TripsSourceProvider>,
  );
  return { user, source: base, view };
}

const row = (id: string) => document.querySelector(`[data-item-id="${id}"]`) as HTMLElement;
const ready = () => screen.findByRole("heading", { name: "Pack mode", level: 1 });
const rail = () => within(screen.getByRole("navigation", { name: "Cubes" }));

/** Opens the cube an item lives in (its chip in the bar), and returns the item's row. */
async function showItem(user: ReturnType<typeof userEvent.setup>, id: string) {
  if (!row(id)) {
    const trip = tripOf(active.source, active.tripId);
    const cube = itemCube(trip.items.find((entry) => entry.id === id)!);
    const label = buildCubeViews(trip).find((view) => view.cube === cube)!.label;
    await user.click(rail().getByRole("button", { name: new RegExp(`^${label}`) }));
  }
  return row(id);
}
const toggle = async (user: ReturnType<typeof userEvent.setup>, id: string) =>
  user.click(within(await showItem(user, id)).getByRole("checkbox"));
async function openEditor(user: ReturnType<typeof userEvent.setup>, id: string) {
  await showItem(user, id);
  if (!screen.queryByRole("button", { name: "Done" }))
    await user.click(screen.getByRole("button", { name: "Edit list" }));
  await user.click(within(row(id)).getByRole("button", { name: /^Edit / }));
}
async function showCube(user: ReturnType<typeof userEvent.setup>, label: string) {
  await user.click(rail().getByRole("button", { name: new RegExp(`^${label}`) }));
}
async function openBathroomForm(user: ReturnType<typeof userEvent.setup>) {
  await showCube(user, "Toiletries");
  await user.click(screen.getByRole("button", { name: "＋ Add a Bathroom item" }));
}
async function checkBathroom(user: ReturnType<typeof userEvent.setup>) {
  for (const id of TOILETRIES) await toggle(user, id);
}
const live = () => screen.getByRole("status", { name: "Packing updates" });
const tripOf = (source: ReturnType<typeof memory>, id = "san-diego") =>
  source.snapshot().trips.find((trip) => trip.id === id)!;
const itemOf = (source: ReturnType<typeof memory>, itemId: string, id = "san-diego") =>
  tripOf(source, id).items.find((item) => item.id === itemId)!;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => (resolve = res));
  return { promise, resolve };
}

function withWeather(base: ReturnType<typeof memory>, optedIn = false) {
  let weatherOptIn = optedIn;
  const weather: StopWeather[] = [
    {
      stopIndex: 0,
      status: "ok",
      days: [
        {
          date: "2026-09-04",
          stopIndex: 0,
          source: "forecast",
          highC: 20,
          lowC: 16,
          precipProbability: 0.8,
          precipMm: 4,
          snowCm: 0,
          uvIndexMax: 1,
          sunshineHours: 1,
        },
      ],
    },
  ];
  const getTripWeather = vi.fn().mockResolvedValue({ kind: "ready", stops: weather });
  const listSuggestions = vi.fn().mockResolvedValue([]);
  const updateSettings = vi.fn(async (change: { weatherOptIn?: boolean }) => {
    weatherOptIn = change.weatherOptIn ?? weatherOptIn;
    return { weatherOptIn, temperatureUnit: "F" as const };
  });
  const applyReview = vi.fn(async (id: string, _accepted: unknown[], _skipped: unknown[]) => {
    void [_accepted, _skipped];
    const change = await base.acceptWeather(id);
    return {
      ...change,
      trip: {
        ...change.trip,
        stops: change.trip.stops.map((stop) => ({
          ...stop,
          location: { ...stop.location, latitude: 38.72, longitude: -9.14 },
        })),
      },
    };
  });
  const source: TripsSource = {
    ...base,
    getTrip: async (id) => {
      const trip = await base.getTrip(id);
      return {
        ...trip,
        stops: trip.stops.map((stop) => ({
          ...stop,
          location: { ...stop.location, latitude: 38.72, longitude: -9.14 },
        })),
      };
    },
    weather: {
      getSettings: async () => ({ weatherOptIn, temperatureUnit: "F" }),
      updateSettings,
      getTripWeather,
      previewDraft: vi.fn().mockResolvedValue({ kind: "ready", stops: weather }),
      createTripWithReview: vi.fn((draft) => base.createTrip(draft)),
      listSuggestions,
      applyReview,
    },
  };
  return { source, getTripWeather, updateSettings, applyReview, listSuggestions };
}

describe("loading and states", () => {
  it("shows a loading state, then the phone Pack mode with its count", async () => {
    const gate = deferred<void>();
    setup("san-diego", (base) => ({
      ...base,
      getTrip: async (id) => (await gate.promise, base.getTrip(id)),
    }));
    expect(screen.getByRole("region", { name: "Loading trip" }).getAttribute("aria-busy")).toBe(
      "true",
    );
    await act(async () => gate.resolve());
    expect(await ready()).toBeTruthy();
    expect(document.querySelector('[data-packing-layout="phone"]')).toBeTruthy();
    const totals = headline(tripOf(active.source));
    expect(totals.total).toBeGreaterThan(30); // #295: the arrival day adds one top, underwear and socks
    expect(screen.getByText(`${totals.packed} of ${totals.total} in the bag`)).toBeTruthy();
    expect(screen.queryByText("You’re ready to go.")).toBeNull();
    expect(screen.queryByText(/sample/i)).toBeNull();
  });

  it("says so, with a way back, when the trip does not exist", async () => {
    setup("nope");
    expect(await screen.findByRole("heading", { name: "That trip isn’t available" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Back to trips" }).getAttribute("href")).toBe("/");
  });

  it("treats a malformed trip id like a missing one, and any other failure as a load error", async () => {
    const base = memory();
    const make = (code: string) => ({
      ...base,
      getTrip: () => Promise.reject(new TripsSourceError(code)),
    });
    renderInApp(
      <TripsSourceProvider source={make("INVALID_INPUT")}>
        <TripScreen tripId="nope" />
      </TripsSourceProvider>,
    );
    expect(await screen.findByRole("heading", { name: "That trip isn’t available" })).toBeTruthy();
  });

  it("shows a load error with Try again, and the Error chip; both recover", async () => {
    const base = memory();
    const getTrip = vi
      .fn()
      .mockRejectedValueOnce(new Error("down"))
      .mockImplementation((id: string) => base.getTrip(id));
    const user = userEvent.setup();
    renderInApp(
      <TripsSourceProvider source={{ ...base, getTrip }}>
        <TripScreen tripId="san-diego" />
      </TripsSourceProvider>,
    );
    expect(await screen.findByText("Couldn’t load this trip.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Not saved, retry" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await ready()).toBeTruthy();
    expect(getTrip).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("link", { name: "Saved" })).toBeNull();
  });

  it("the chip's Retry also reloads after a failed load, and the trip renders", async () => {
    const base = memory();
    const getTrip = vi
      .fn()
      .mockRejectedValueOnce(new Error("down"))
      .mockImplementation((id: string) => base.getTrip(id));
    const user = userEvent.setup();
    renderInApp(
      <TripsSourceProvider source={{ ...base, getTrip }}>
        <TripScreen tripId="san-diego" />
      </TripsSourceProvider>,
    );
    await screen.findByText("Couldn’t load this trip.");
    await user.click(screen.getByRole("button", { name: "Not saved, retry" }));
    await user.click(
      within(screen.getByRole("dialog", { name: "Couldn’t save" })).getByRole("button", {
        name: "Retry",
      }),
    );
    expect(await ready()).toBeTruthy();
  });

  it("ignores a load that finishes after unmount", async () => {
    const gate = deferred<void>();
    const base = memory();
    const view = renderInApp(
      <TripsSourceProvider
        source={{ ...base, getTrip: async (id) => (await gate.promise, base.getTrip(id)) }}
      >
        <TripScreen tripId="san-diego" />
      </TripsSourceProvider>,
    );
    view.unmount();
    await act(async () => gate.resolve());
    const failing = deferred<void>();
    const second = renderInApp(
      <TripsSourceProvider
        source={{
          ...base,
          getTrip: async () => (await failing.promise, Promise.reject(new Error("late"))),
        }}
      >
        <TripScreen tripId="san-diego" />
      </TripsSourceProvider>,
    );
    second.unmount();
    await act(async () => failing.resolve());
  });
});

describe("packing", () => {
  it("checks and unchecks an item, saving each change", async () => {
    const { user, source } = setup();
    await ready();
    await toggle(user, "tops");
    await waitFor(() => expect(itemOf(source, "tops").packed).toBe(itemOf(source, "tops").qty));
    expect((within(row("tops")).getByRole("checkbox") as HTMLInputElement).checked).toBe(true);
    expect(live().textContent).toBe("Everyday tops 4 of 4 packed");
    await toggle(user, "tops");
    await waitFor(() => expect(itemOf(source, "tops").packed).toBe(0));
    expect(live().textContent).toBe("Everyday tops 0 of 4 packed");
  });

  it("a tick is sent at once, as one write of the whole quantity, and an untick as 0", async () => {
    const setPacked = vi.fn();
    const { user } = setup("san-diego", (base) => ({
      ...base,
      setPacked: (id, itemId, packed) => (
        setPacked(itemId, packed),
        base.setPacked(id, itemId, packed)
      ),
    }));
    await ready();
    await toggle(user, "tops");
    await waitFor(() => expect(setPacked).toHaveBeenCalledTimes(1));
    expect(setPacked).toHaveBeenCalledWith("tops", 4);
    await toggle(user, "tops");
    await waitFor(() => expect(setPacked).toHaveBeenCalledTimes(2));
    expect(setPacked).toHaveBeenLastCalledWith("tops", 0);
  });

  it("keeps the tick on screen while a write is in flight, and sends the next one only after it finishes", async () => {
    const gate = deferred<void>();
    const calls: number[] = [];
    const { user, source } = setup("san-diego", (base) => ({
      ...base,
      setPacked: async (id, itemId, packed) => {
        calls.push(packed);
        if (calls.length === 1) await gate.promise;
        return base.setPacked(id, itemId, packed);
      },
    }));
    await ready();
    await toggle(user, "tops");
    await waitFor(() => expect(calls).toEqual([4]));
    const box = within(row("tops")).getByRole("checkbox") as HTMLInputElement;
    expect(box.checked).toBe(true);
    // An untick during the first write: shown at once, not sent in parallel.
    await user.click(box);
    expect(box.checked).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(calls).toEqual([4]);
    await act(async () => gate.resolve());
    await waitFor(() => expect(calls).toEqual([4, 0]));
    await waitFor(() => expect(itemOf(source, "tops").packed).toBe(0));
    expect(box.checked).toBe(false);
  });

  it("a failed change shows 'Not saved · Retry' beside that row and the Error chip, and Retry clears both when it works", async () => {
    let fail = true;
    const { user, source } = setup("san-diego", (base) => ({
      ...base,
      setPacked: (id, itemId, packed) =>
        fail ? Promise.reject(new Error("nope")) : base.setPacked(id, itemId, packed),
    }));
    await ready();
    await toggle(user, "tops");
    expect(
      await within(row("tops")).findByRole("button", { name: "Not saved · Retry" }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Not saved, retry" })).toBeTruthy();
    // The row keeps showing what the user did, and nothing was stored.
    expect(itemOf(source, "tops").packed).toBe(1);
    expect((within(row("tops")).getByRole("checkbox") as HTMLInputElement).checked).toBe(true);
    fail = false;
    await user.click(within(row("tops")).getByRole("button", { name: "Not saved · Retry" }));
    await waitFor(() => expect(itemOf(source, "tops").packed).toBe(4));
    expect(within(row("tops")).queryByRole("button", { name: "Not saved · Retry" })).toBeNull();
    expect(screen.getByRole("link", { name: "Saved" })).toBeTruthy();
  });

  it("Retry sends the latest tick, even after the row was ticked again", async () => {
    let fail = true;
    const sent: number[] = [];
    const { user, source } = setup("san-diego", (base) => ({
      ...base,
      setPacked: (id, itemId, packed) => {
        sent.push(packed);
        return fail ? Promise.reject(new Error("nope")) : base.setPacked(id, itemId, packed);
      },
    }));
    await ready();
    await toggle(user, "tops");
    await within(row("tops")).findByRole("button", { name: "Not saved · Retry" });
    await toggle(user, "tops");
    await waitFor(() => expect(sent).toEqual([4, 0]));
    fail = false;
    await user.click(within(row("tops")).getByRole("button", { name: "Not saved · Retry" }));
    await waitFor(() => expect(itemOf(source, "tops").packed).toBe(0));
    expect(sent).toEqual([4, 0, 0]);
  });

  it("the chip's Retry re-sends the failed row change too, and the row error clears", async () => {
    let fail = true;
    const { user, source } = setup("san-diego", (base) => ({
      ...base,
      setPacked: (id, itemId, packed) =>
        fail ? Promise.reject(new Error("nope")) : base.setPacked(id, itemId, packed),
    }));
    await ready();
    await toggle(user, "tops");
    expect(
      await within(row("tops")).findByRole("button", { name: "Not saved · Retry" }),
    ).toBeTruthy();
    fail = false;
    await user.click(screen.getByRole("button", { name: "Not saved, retry" }));
    await user.click(
      within(screen.getByRole("dialog", { name: "Couldn’t save" })).getByRole("button", {
        name: "Retry",
      }),
    );
    await waitFor(() => expect(itemOf(source, "tops").packed).toBe(4));
    expect(within(row("tops")).queryByRole("button", { name: "Not saved · Retry" })).toBeNull();
  });

  it("completing the last item only reveals Review your bag; it never marks the trip Ready", async () => {
    const { user, source } = setup();
    await ready();
    const items = tripOf(source).items.map((item) => item.id);
    for (const id of [...items.filter((entry) => !TOILETRIES.includes(entry)), ...TOILETRIES]) {
      const box = within(await showItem(user, id)).getByRole("checkbox") as HTMLInputElement;
      if (!box.checked) await user.click(box);
    }
    await user.click(await screen.findByRole("button", { name: "Confirm" }));
    const review = await screen.findByRole("link", { name: "Review your bag" });
    expect(review.getAttribute("href")).toBe("/trips/san-diego/review");
    expect(tripOf(source).ready).toBe(false);
    expect(screen.queryByText("You’re ready to go.")).toBeNull();
  });
});

describe("toiletry bag gate", () => {
  it("starts waiting, with counts", async () => {
    const { user } = setup();
    await ready();
    await showCube(user, "Toiletries");
    expect(screen.getByText("Toiletry bag not ready to place")).toBeTruthy();
    expect(screen.getByText(/\(0 of 4 checked\)/)).toBeTruthy();
  });

  it("opens the placement prompt once when contents complete, never confirms by itself, and 'Not yet' dismisses it for the session", async () => {
    const { user, source } = setup();
    await ready();
    await checkBathroom(user);
    const prompt = await screen.findByRole("dialog", { name: "Toiletry bag in suitcase?" });
    expect(document.activeElement).toBe(within(prompt).getByRole("button", { name: "Not yet" }));
    expect(tripOf(source).toiletryBagPacked).toBe(false);
    await user.click(within(prompt).getByRole("button", { name: "Not yet" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText("Toiletry bag ready to place")).toBeTruthy();
    // Uncheck and recheck: the prompt stays dismissed, the persistent button remains.
    await toggle(user, "last-contacts");
    await toggle(user, "last-contacts");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Put bag in suitcase" })).toBeTruthy(),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("Escape on the prompt is the same as Not yet", async () => {
    const { user } = setup();
    await ready();
    await checkBathroom(user);
    await screen.findByRole("dialog", { name: "Toiletry bag in suitcase?" });
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(tripOf(memory()).toiletryBagPacked).toBe(false);
  });

  it("walks ready to place, confirm, in the suitcase, undo, and unchecking content invalidates placement", async () => {
    const { user, source } = setup();
    await ready();
    await checkBathroom(user);
    await user.click(await screen.findByRole("button", { name: "Not yet" }));
    await user.click(screen.getByRole("button", { name: "Put bag in suitcase" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Confirm" }));
    expect(await screen.findByText("Toiletry bag is in the suitcase")).toBeTruthy();
    expect(tripOf(source).toiletryBagPacked).toBe(true);
    await user.click(screen.getByRole("button", { name: "Undo placement" }));
    expect(await screen.findByText("Toiletry bag ready to place")).toBeTruthy();
    expect(tripOf(source).toiletryBagPacked).toBe(false);
    await user.click(screen.getByRole("button", { name: "Put bag in suitcase" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Confirm" }));
    await screen.findByText("Toiletry bag is in the suitcase");
    await toggle(user, "last-contacts");
    expect(await screen.findByText("Toiletry bag not ready to place")).toBeTruthy();
  });

  it("adds a Bathroom item: validated, one normal checkbox, resetting an already placed bag", async () => {
    const { user, source } = setup("lisbon");
    await ready();
    await openBathroomForm(user);
    const dialog = screen.getByRole("dialog", { name: "Add a Bathroom item" });
    await user.click(within(dialog).getByRole("button", { name: "Add toiletry item" }));
    expect(within(dialog).getByRole("alert").textContent).toBe("Enter a name.");
    expect(within(dialog).getByLabelText("Item name").getAttribute("aria-invalid")).toBe("true");
    await user.type(within(dialog).getByLabelText("Item name"), "Face wash");
    expect(within(dialog).queryByRole("alert")).toBeNull();
    await user.click(within(dialog).getByRole("radio", { name: /Remember for future trips/ }));
    await user.click(within(dialog).getByRole("switch", { name: "Pack last" }));
    await user.click(within(dialog).getByRole("button", { name: "Add toiletry item" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(tripOf(source, "lisbon").items.find((item) => item.name === "Face wash")).toMatchObject({
      groupId: "toiletry-bag",
      packed: 0,
    });
    expect(tripOf(source, "lisbon").toiletryBagPacked).toBe(false);
    expect(screen.getByText("Toiletry bag not ready to place")).toBeTruthy();
    expect(source.staplesSnapshot().find((staple) => staple.name === "Face wash")).toMatchObject({
      packLast: true,
    });
  });

  it("closing the add dialog changes nothing", async () => {
    const { user, source } = setup();
    await ready();
    const before = source.snapshot();
    await openBathroomForm(user);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(source.snapshot()).toBe(before);
  });
});

describe("item editor", () => {
  it("a trip-only edit changes this trip and leaves the staples alone", async () => {
    const { user, source } = setup();
    await ready();
    const staples = source.staplesSnapshot();
    await openEditor(user, "sunglasses");
    const dialog = screen.getByRole("dialog", { name: "Edit item" });
    expect(
      within(dialog)
        .getByRole("radio", { name: /This trip only/ })
        .hasAttribute("checked") ||
        (within(dialog).getByRole("radio", { name: /This trip only/ }) as HTMLInputElement).checked,
    ).toBe(true);
    await user.clear(within(dialog).getByLabelText("Item name"));
    await user.type(within(dialog).getByLabelText("Item name"), "Beach sunglasses");
    await user.click(within(dialog).getByRole("button", { name: "Save item" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(itemOf(source, "sunglasses").name).toBe("Beach sunglasses");
    expect(source.staplesSnapshot()).toEqual(staples);
    expect(document.activeElement).toBe(
      within(row("sunglasses")).getByRole("button", { name: /^Edit Beach sunglasses/ }),
    );
  });

  it("a remembered edit saves to the staples; the per-day preview reads from the domain and updates as the quantity changes", async () => {
    const { user, source } = setup();
    await ready();
    await openEditor(user, "underwear");
    const dialog = screen.getByRole("dialog", { name: "Edit item" });
    const hint = within(dialog).getByRole("status", { name: "Saved quantity" });
    expect(hint.textContent).toBe("");
    await user.click(within(dialog).getByRole("radio", { name: /Remember for future trips/ }));
    expect(hint.textContent).toBe("Saved as 1 per day for future trips.");
    await user.clear(within(dialog).getByLabelText("Quantity"));
    await user.type(within(dialog).getByLabelText("Quantity"), "9");
    expect(hint.textContent).toBe("Saved as 2 per day for future trips.");
    await user.click(within(dialog).getByRole("radio", { name: /This trip only/ }));
    expect(hint.textContent).toBe("");
    await user.click(within(dialog).getByRole("radio", { name: /Remember for future trips/ }));
    await user.click(within(dialog).getByRole("button", { name: "Save item" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(source.staplesSnapshot().find((staple) => staple.id === "underwear")?.qty).toBe(2);
    expect(itemOf(source, "underwear").qty).toBe(9);
  });

  it("says the saved quantity stays the same when the trip has no calendar days", async () => {
    const state = sampleLifecycleState();
    state.trips[0] = { ...state.trips[0], days: 0 };
    const base = createMemoryTripsSource(state, { now: () => 1 });
    const user = userEvent.setup();
    renderInApp(
      <TripsSourceProvider source={base}>
        <TripScreen tripId="san-diego" />
      </TripsSourceProvider>,
    );
    await ready();
    await openEditor(user, "underwear");
    await user.click(screen.getByRole("radio", { name: /Remember for future trips/ }));
    expect(screen.getByRole("status", { name: "Saved quantity" }).textContent).toBe(
      "This trip has no calendar days, so the saved quantity stays the same.",
    );
  });

  it("has no preview for a per-trip staple", async () => {
    const { user } = setup();
    await ready();
    await openEditor(user, "sunglasses");
    await user.click(screen.getByRole("radio", { name: /Remember for future trips/ }));
    expect(screen.getByRole("status", { name: "Saved quantity" }).textContent).toBe("");
  });

  it("refuses an empty name inline, and clears the error as the person types", async () => {
    const { user, source } = setup();
    await ready();
    await openEditor(user, "tops");
    const dialog = screen.getByRole("dialog", { name: "Edit item" });
    await user.clear(within(dialog).getByLabelText("Item name"));
    await user.click(within(dialog).getByRole("button", { name: "Save item" }));
    expect(within(dialog).getByRole("alert").textContent).toBe("Enter a name.");
    await user.type(within(dialog).getByLabelText("Item name"), "T");
    expect(within(dialog).queryByRole("alert")).toBeNull();
    expect(itemOf(source, "tops").name).toBe("Everyday tops");
  });

  it("a required item has no Remove button; Pack last is a timing switch that moves the item", async () => {
    const { user, source } = setup();
    await ready();
    await openEditor(user, "tops");
    const dialog = screen.getByRole("dialog", { name: "Edit item" });
    expect(within(dialog).queryByRole("button", { name: "Remove item" })).toBeNull();
    await user.click(within(dialog).getByRole("switch", { name: "Pack last" }));
    await user.click(within(dialog).getByRole("button", { name: "Save item" }));
    await waitFor(() => expect(itemOf(source, "tops").section).toBe("packlast"));
  });

  it("a return item shows its callout and has no Pack last switch", async () => {
    const { user } = setup();
    await ready();
    await openEditor(user, "return-top");
    const dialog = screen.getByRole("dialog", { name: "Edit item" });
    expect(within(dialog).getByText(/stays in the dedicated return set/)).toBeTruthy();
    expect(within(dialog).queryByRole("switch", { name: "Pack last" })).toBeNull();
    await user.click(within(dialog).getByRole("button", { name: "Save item" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("shows the optional and Bathroom callouts", async () => {
    const { user } = setup();
    await ready();
    await openEditor(user, "nice-shoes");
    expect(screen.getByText(/Optional suggestion\./)).toBeTruthy();
    await user.keyboard("{Escape}");
    await openEditor(user, "last-toothbrush");
    expect(screen.getByText(/Bathroom item\./)).toBeTruthy();
  });

  it("removes an optional item only after a confirmation that focuses the safe button; Keep item returns to the editor", async () => {
    const { user, source } = setup();
    await ready();
    await openEditor(user, "nice-shoes");
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Remove item" }),
    );
    const confirm = screen.getByRole("dialog", { name: "Remove Dress shoes?" });
    expect(within(confirm).getByText(/removed from this trip only/)).toBeTruthy();
    await waitFor(() =>
      expect(document.activeElement).toBe(
        within(confirm).getByRole("button", { name: "Keep item" }),
      ),
    );
    await user.click(within(confirm).getByRole("button", { name: "Keep item" }));
    expect(screen.getByRole("dialog", { name: "Edit item" })).toBeTruthy();
    expect(itemOf(source, "nice-shoes")).toBeTruthy();
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Remove item" }),
    );
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Remove item" }),
    );
    await waitFor(() => expect(row("nice-shoes")).toBeNull());
    expect(tripOf(source).items.some((item) => item.id === "nice-shoes")).toBe(false);
  });

  it("removing with 'Remember' also removes the staple, and the confirmation says so", async () => {
    const { user, source } = setup();
    await ready();
    await openEditor(user, "last-toothbrush");
    await user.click(screen.getByRole("radio", { name: /Remember for future trips/ }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Remove item" }),
    );
    expect(screen.getByText(/removed from this trip and from your staples/)).toBeTruthy();
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Remove item" }),
    );
    await waitFor(() => expect(row("last-toothbrush")).toBeNull());
    expect(source.staplesSnapshot().some((staple) => staple.id === "last-toothbrush")).toBe(false);
  });
});

describe("weather", () => {
  it("asks with the privacy copy and makes no provider call until the person opts in", async () => {
    let wired!: ReturnType<typeof withWeather>;
    const { user } = setup("lisbon", (base) => {
      wired = withWeather(base);
      return wired.source;
    });
    await ready();
    expect(await screen.findByText("Get weather for your stops?")).toBeTruthy();
    expect(screen.getByText(/Only map coordinates and dates are sent to Open-Meteo/)).toBeTruthy();
    expect(wired.getTripWeather).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Get weather" }));
    await waitFor(() => expect(wired.getTripWeather).toHaveBeenCalledWith("lisbon"));
    expect(await screen.findByRole("region", { name: "Forecast" })).toBeTruthy();
    expect(screen.getByText(/Weather data by Open-Meteo.com/)).toBeTruthy();
  });

  it("reviews real recommendation diffs inline, adds one change and revokes Ready", async () => {
    let wired!: ReturnType<typeof withWeather>;
    const { user, source } = setup("lisbon", (base) => {
      wired = withWeather(base, true);
      return wired.source;
    });
    await ready();
    await user.click(await screen.findByRole("button", { name: /to review/ }));
    await user.click(screen.getByRole("button", { name: "Add Compact umbrella to Rain gear" }));
    await waitFor(() => expect(wired.applyReview).toHaveBeenCalledTimes(1));
    expect(wired.applyReview.mock.calls[0][0]).toBe("lisbon");
    expect(wired.applyReview.mock.calls[0][1]).toEqual(
      expect.arrayContaining([expect.objectContaining({ semanticId: "weather-umbrella" })]),
    );
    expect(tripOf(source, "lisbon").ready).toBe(false);
    expect(screen.queryByText("You’re ready to go.")).toBeNull();
  });

  it("offers no changes when no stop has usable weather: the list stays as it is", async () => {
    let wired!: ReturnType<typeof withWeather>;
    setup("lisbon", (base) => {
      wired = withWeather(base, true);
      wired.getTripWeather.mockResolvedValue({
        kind: "ready",
        stops: [{ stopIndex: 0, status: "unavailable", days: [] }],
      });
      return wired.source;
    });
    await ready();
    expect(
      await screen.findByText("We couldn’t reach the weather service. Your list is unchanged."),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: /to review/ })).toBeNull();
  });

  it("asks the weather service again when the route is edited", async () => {
    let wired!: ReturnType<typeof withWeather>;
    const { user } = setup("lisbon", (base) => {
      wired = withWeather(base, true);
      return wired.source;
    });
    await ready();
    await waitFor(() => expect(wired.getTripWeather).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole("button", { name: "Edit trip" }));
    const sheet = screen.getByRole("dialog", { name: "Edit trip" });
    fireEvent.change(within(sheet).getByLabelText("Leave"), { target: { value: "2026-09-09" } });
    await user.click(within(sheet).getByRole("button", { name: "Save route" }));
    await waitFor(() => expect(wired.getTripWeather).toHaveBeenCalledTimes(2));
  });

  it("persists skipped signatures and can turn weather off without a provider call", async () => {
    let wired!: ReturnType<typeof withWeather>;
    const { user, view } = setup("lisbon", (base) => {
      wired = withWeather(base, true);
      return wired.source;
    });
    await ready();
    await user.click(await screen.findByRole("button", { name: /to review/ }));
    await user.click(screen.getByRole("button", { name: "Dismiss Compact umbrella" }));
    await waitFor(() => expect(wired.applyReview).toHaveBeenCalledTimes(1));
    expect(wired.applyReview.mock.calls[0][1]).toEqual([]);
    expect(wired.applyReview.mock.calls[0][2]).toEqual(
      expect.arrayContaining([expect.objectContaining({ semanticId: "weather-umbrella" })]),
    );

    view.unmount();
    // Turning off is exercised from the first-run Not now choice, which also dismisses this trip's prompt.
    let off!: ReturnType<typeof withWeather>;
    const second = setup("lisbon", (base) => {
      off = withWeather(base);
      return off.source;
    });
    await ready();
    await second.user.click(screen.getByRole("button", { name: "Not now" }));
    await waitFor(() => expect(off.updateSettings).toHaveBeenCalledWith({ weatherOptIn: false }));
    expect(off.getTripWeather).not.toHaveBeenCalled();
  });
});

describe("preferences and Ready", () => {
  it("editing preferences recalculates the list and revokes Ready", async () => {
    const { user, source } = setup("lisbon");
    await ready();
    await user.click(screen.getByRole("button", { name: "Edit preferences" }));
    const dialog = screen.getByRole("dialog", { name: "Edit trip" });
    await user.click(within(dialog).getByRole("switch", { name: "Laundry access" }));
    await user.click(within(dialog).getByRole("button", { name: "Review changes" }));
    // Nothing is applied yet: the review says what will happen, including that Ready turns off.
    expect(tripOf(source, "lisbon").config.laundry).toBe(true);
    expect(within(dialog).getByText("Ready turns off.")).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "Apply changes" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(tripOf(source, "lisbon").config.laundry).toBe(false);
    expect(tripOf(source, "lisbon").ready).toBe(false);
    expect(
      within(document.querySelector(".toast-region") as HTMLElement).getByText(
        "Preferences updated. Ready turned off.",
      ),
    ).toBeTruthy();
    expect(screen.queryByText("You’re ready to go.")).toBeNull();
  });

  it("occasions and reuse follow Nice outfits, occasions stay within 1 to 8, and the return outfit help matches the calculator", async () => {
    const { user } = setup();
    await ready();
    await user.click(screen.getByRole("button", { name: "Edit preferences" }));
    const dialog = screen.getByRole("dialog", { name: "Edit trip" });
    const occasions = within(dialog).getByLabelText("Occasions") as HTMLInputElement;
    expect(occasions.disabled).toBe(false);
    await user.clear(occasions);
    await user.type(occasions, "12");
    expect(occasions.value).toBe("8");
    expect(within(dialog).queryByText("Turn on Nice outfits to set occasions.")).toBeNull();
    await user.click(within(dialog).getByRole("switch", { name: "Nice outfits" }));
    expect(occasions.disabled).toBe(true);
    const reuse = within(dialog).getByRole("switch", {
      name: "Reuse one nice look",
    }) as HTMLInputElement;
    expect(reuse.disabled).toBe(true);
    // With Nice outfits off, the helper line says why, and both disabled controls point at it.
    const hint = within(dialog).getByText("Turn on Nice outfits to set occasions.");
    expect(occasions.getAttribute("aria-describedby")).toBe(hint.id);
    expect(reuse.getAttribute("aria-describedby")?.split(" ")).toContain(hint.id);
    expect(
      within(dialog).getByText(
        "A fresh top, bottoms, underwear and socks for the trip home. It replaces one everyday outfit, for your return day.",
      ),
    ).toBeTruthy();
    await user.click(
      within(dialog).getByRole("switch", { name: "Dedicated return travel outfit" }),
    );
    expect(within(dialog).getByText("Your return day is packed like any other day.")).toBeTruthy();
  });

  it("Mark as not ready keeps every packed count and says so", async () => {
    const { user, source } = setup("lisbon");
    await ready();
    const before = structuredClone(tripOf(source, "lisbon").items);
    await user.click(screen.getByRole("button", { name: "Mark as not ready" }));
    await waitFor(() => expect(tripOf(source, "lisbon").ready).toBe(false));
    expect(tripOf(source, "lisbon").items).toEqual(before);
    expect(
      within(document.querySelector(".toast-region") as HTMLElement).getByText("Progress kept."),
    ).toBeTruthy();
    expect(screen.queryByText("You’re ready to go.")).toBeNull();
  });
});

describe("toiletry gate buttons appear only in their own state", () => {
  const put = () => screen.queryByRole("button", { name: "Put bag in suitcase" });
  const undo = () => screen.queryByRole("button", { name: "Undo placement" });

  it("waiting: neither; ready to place: only Put bag; in the suitcase: only Undo", async () => {
    const { user } = setup();
    await ready();
    expect(put()).toBeNull();
    expect(undo()).toBeNull();
    await checkBathroom(user);
    await user.click(await screen.findByRole("button", { name: "Not yet" }));
    expect(put()).toBeTruthy();
    expect(undo()).toBeNull();
    await user.click(put() as HTMLElement);
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Confirm" }));
    await screen.findByText("Toiletry bag is in the suitcase");
    expect(put()).toBeNull();
    expect(undo()).toBeTruthy();
  });
});

describe("dialog submits wait for the source", () => {
  it("a double click on 'Add toiletry item' adds one item", async () => {
    const gate = deferred<void>();
    const add = vi.fn();
    const { user } = setup("san-diego", (base) => ({
      ...base,
      addToiletryItem: async (id, input) => {
        add(input.name);
        await gate.promise;
        return base.addToiletryItem(id, input);
      },
    }));
    await ready();
    await openBathroomForm(user);
    const dialog = screen.getByRole("dialog", { name: "Add a Bathroom item" });
    await user.type(within(dialog).getByLabelText("Item name"), "Face wash");
    const submit = within(dialog).getByRole("button", { name: "Add toiletry item" });
    await user.dblClick(submit);
    expect(add).toHaveBeenCalledTimes(1);
    expect(submit.hasAttribute("disabled")).toBe(true);
    await act(async () => gate.resolve());
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(add).toHaveBeenCalledTimes(1);
  });

  it("a double click on 'Save item' saves once", async () => {
    const gate = deferred<void>();
    const edit = vi.fn();
    const { user } = setup("san-diego", (base) => ({
      ...base,
      editItem: async (id, itemId, change) => {
        edit(itemId);
        await gate.promise;
        return base.editItem(id, itemId, change);
      },
    }));
    await ready();
    await openEditor(user, "sunglasses");
    const dialog = screen.getByRole("dialog", { name: "Edit item" });
    const save = within(dialog).getByRole("button", { name: "Save item" });
    await user.dblClick(save);
    expect(edit).toHaveBeenCalledTimes(1);
    expect(save.hasAttribute("disabled")).toBe(true);
    await act(async () => gate.resolve());
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(edit).toHaveBeenCalledTimes(1);
  });
});

describe("a form submitted twice while saving saves once", () => {
  // Enter in a field submits the form even though the button is disabled, so the forms ignore a submit while saving.
  const submitTwice = () => {
    const form = screen.getByRole("dialog").querySelector("form") as HTMLFormElement;
    fireEvent.submit(form);
    fireEvent.submit(form);
  };

  it("item editor", async () => {
    const gate = deferred<void>();
    const calls = vi.fn();
    const { user } = setup("san-diego", (base) => ({
      ...base,
      editItem: async (id, itemId, edit) => {
        calls(itemId);
        await gate.promise;
        return base.editItem(id, itemId, edit);
      },
    }));
    await ready();
    await openEditor(user, "sunglasses");
    submitTwice();
    await waitFor(() => expect(calls).toHaveBeenCalledTimes(1));
    submitTwice();
    expect(calls).toHaveBeenCalledTimes(1);
    await act(async () => gate.resolve());
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(calls).toHaveBeenCalledTimes(1);
  });

  it("add Bathroom item", async () => {
    const gate = deferred<void>();
    const calls = vi.fn();
    const { user } = setup("san-diego", (base) => ({
      ...base,
      addToiletryItem: async (id, input) => {
        calls(input.name);
        await gate.promise;
        return base.addToiletryItem(id, input);
      },
    }));
    await ready();
    await openBathroomForm(user);
    await user.type(screen.getByLabelText("Item name"), "Face wash");
    submitTwice();
    await waitFor(() => expect(calls).toHaveBeenCalledTimes(1));
    submitTwice();
    expect(calls).toHaveBeenCalledTimes(1);
    await act(async () => gate.resolve());
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(calls).toHaveBeenCalledTimes(1);
  });

  it("preferences", async () => {
    const gate = deferred<void>();
    const calls = vi.fn();
    const { user } = setup("san-diego", (base) => ({
      ...base,
      updatePreferences: async (id, config) => {
        calls(config);
        await gate.promise;
        return base.updatePreferences(id, config);
      },
    }));
    await ready();
    await user.click(screen.getByRole("button", { name: "Edit preferences" }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("switch", { name: "Laundry access" }),
    );
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Review changes" }),
    );
    // The review of a trip with packed progress may ask for an acknowledgement first.
    const acknowledge = screen.queryByRole("checkbox", { name: /I understand/ });
    if (acknowledge) await user.click(acknowledge);
    const apply = within(screen.getByRole("dialog")).getByRole("button", { name: "Apply changes" });
    fireEvent.click(apply);
    fireEvent.click(apply);
    await waitFor(() => expect(calls).toHaveBeenCalledTimes(1));
    fireEvent.click(apply);
    expect(calls).toHaveBeenCalledTimes(1);
    await act(async () => gate.resolve());
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(calls).toHaveBeenCalledTimes(1);
  });
});

describe("editing the stamp (#151)", () => {
  const editButton = () => screen.getByRole("button", { name: "Edit stamp" });
  const toasts = () => document.querySelector(".toast-region") as HTMLElement;

  it("offers Edit stamp, which opens the Stamp label sheet and gives focus back on close", async () => {
    const { user } = setup();
    await ready();
    await user.click(editButton());
    const sheet = screen.getByRole("dialog", { name: "Stamp label" });
    expect(within(sheet).getByRole("group", { name: "Stamp 1, automatic" })).toBeTruthy();
    await user.click(within(sheet).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(editButton());
  });

  it("a custom label is stored; the toast says Stamp updated", async () => {
    const { user, source } = setup();
    await ready();
    await user.click(editButton());
    await user.click(screen.getByRole("radio", { name: "Custom" }));
    const field = screen.getByLabelText("Label");
    await user.clear(field);
    await user.type(field, "abc");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(tripOf(source).stampLabels).toEqual(["ABC", null]);
    expect(within(toasts()).getByText("Stamp updated.")).toBeTruthy();
    expect(document.activeElement).toBe(editButton());
  });

  it("Reset to automatic brings the derived label back, and the toast says so", async () => {
    const { user, source } = setup();
    await ready();
    await user.click(editButton());
    await user.click(screen.getByRole("radio", { name: "Custom" }));
    await user.clear(screen.getByLabelText("Label"));
    await user.type(screen.getByLabelText("Label"), "abc");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await user.click(editButton());
    await user.click(screen.getByRole("button", { name: "Reset to automatic" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(tripOf(source).stampLabels).toEqual([null, null]);
    expect(within(toasts()).getByText("Stamp reset to automatic.")).toBeTruthy();
  });

  it("a failed save keeps the sheet open with the message, and Save tries again", async () => {
    let fail = true;
    const { user, source } = setup("san-diego", (base) => ({
      ...base,
      setStampLabels: (id, one, two) =>
        fail ? Promise.reject(new Error("nope")) : base.setStampLabels(id, one, two),
    }));
    await ready();
    await user.click(editButton());
    await user.click(screen.getByRole("radio", { name: "Custom" }));
    await user.clear(screen.getByLabelText("Label"));
    await user.type(screen.getByLabelText("Label"), "abc");
    await user.click(screen.getByRole("button", { name: "Save" }));
    const sheet = screen.getByRole("dialog", { name: "Stamp label" });
    await waitFor(() =>
      expect(within(sheet).getByText(/Couldn’t save the stamp\. Nothing changed/)).toBeTruthy(),
    );
    expect(tripOf(source).stampLabels ?? [null, null]).toEqual([null, null]);
    fail = false;
    await user.click(within(sheet).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(tripOf(source).stampLabels).toEqual(["ABC", null]);
  });

  it("is cleared when the sheet is closed, so reopening starts clean", async () => {
    const { user } = setup("san-diego", (base) => ({
      ...base,
      setStampLabels: () => Promise.reject(new Error("nope")),
    }));
    await ready();
    await user.click(editButton());
    await user.click(screen.getByRole("radio", { name: "Custom" }));
    await user.clear(screen.getByLabelText("Label"));
    await user.type(screen.getByLabelText("Label"), "abc");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText(/Couldn’t save the stamp/);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(editButton());
    expect(screen.queryByText(/Couldn’t save the stamp/)).toBeNull();
  });
});

describe("closing dialogs without saving", () => {
  const closeButton = () => screen.queryByRole("button", { name: "Close dialog" });

  it("the item editor, preferences and add-Bathroom-item sheets have a visible close that leaves everything unchanged", async () => {
    const { user, source } = setup();
    await ready();
    const before = source.snapshot();

    await openEditor(user, "tops");
    await user.click(closeButton() as HTMLElement);
    expect(screen.queryByRole("dialog")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Edit preferences" }));
    await user.click(closeButton() as HTMLElement);
    expect(screen.queryByRole("dialog")).toBeNull();

    await openBathroomForm(user);
    await user.click(closeButton() as HTMLElement);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(source.snapshot()).toBe(before);
  });

  it("a remove confirmation with its own safe choice has no close button", async () => {
    const { user } = setup();
    await ready();
    await openEditor(user, "nice-shoes");
    await user.click(screen.getByRole("button", { name: "Remove item" }));
    expect(screen.getByRole("dialog", { name: "Remove Dress shoes?" })).toBeTruthy();
    expect(closeButton()).toBeNull();
    await user.click(screen.getByRole("button", { name: "Keep item" }));
    await user.keyboard("{Escape}");
  });
});

describe("edges", () => {
  it("a failed change that is not tied to a row (a dialog submit) keeps the dialog open and shows the Error chip", async () => {
    const { user, source } = setup("san-diego", (base) => ({
      ...base,
      updatePreferences: () => Promise.reject(new Error("nope")),
    }));
    await ready();
    await user.click(screen.getByRole("button", { name: "Edit preferences" }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("switch", { name: "Laundry access" }),
    );
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Review changes" }),
    );
    const acknowledge = screen.queryByRole("checkbox", { name: /I understand/ });
    if (acknowledge) await user.click(acknowledge);
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Apply changes" }),
    );
    expect(await screen.findByRole("button", { name: "Not saved, retry" })).toBeTruthy();
    expect(screen.getByRole("dialog", { name: "Edit trip" })).toBeTruthy();
    expect(within(screen.getByRole("dialog")).getByText(/Couldn’t apply the changes/)).toBeTruthy();
    expect(tripOf(source).config.laundry).toBe(false);
    expect(
      (
        within(screen.getByRole("dialog")).getByRole("button", {
          name: "Apply changes",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
  });

  it("toggles every preference switch in the preferences dialog", async () => {
    const { user, source } = setup();
    await ready();
    await user.click(screen.getByRole("button", { name: "Edit preferences" }));
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("switch", { name: "One spare underwear + socks" }));
    await user.click(within(dialog).getByRole("switch", { name: "Reuse one nice look" }));
    await user.click(within(dialog).getByRole("button", { name: "Review changes" }));
    await user.click(within(dialog).getByRole("button", { name: "Apply changes" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(tripOf(source).config).toMatchObject({ spare: false, reuseNice: false });
  });

  it("typing a quantity for a new Bathroom item is saved", async () => {
    const { user, source } = setup();
    await ready();
    await openBathroomForm(user);
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByLabelText("Item name"), "Sunscreen");
    await user.clear(within(dialog).getByLabelText("Quantity"));
    await user.type(within(dialog).getByLabelText("Quantity"), "3");
    await user.click(within(dialog).getByRole("button", { name: "Add toiletry item" }));
    await waitFor(() =>
      expect(tripOf(source).items.find((item) => item.name === "Sunscreen")?.qty).toBe(3),
    );
  });

  it("Escape on the remove confirmation goes back to the editor without removing anything", async () => {
    const { user, source } = setup();
    await ready();
    await openEditor(user, "nice-shoes");
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Remove item" }),
    );
    await screen.findByRole("dialog", { name: "Remove Dress shoes?" });
    await user.keyboard("{Escape}");
    expect(await screen.findByRole("dialog", { name: "Edit item" })).toBeTruthy();
    expect(itemOf(source, "nice-shoes")).toBeTruthy();
  });

  it("a backdrop press does not dismiss the remove confirmation", async () => {
    const { user } = setup();
    await ready();
    await openEditor(user, "nice-shoes");
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Remove item" }),
    );
    await screen.findByRole("dialog", { name: "Remove Dress shoes?" });
    await user.click(screen.getByTestId("modal-backdrop"));
    expect(screen.getByRole("dialog", { name: "Remove Dress shoes?" })).toBeTruthy();
  });
});

describe("Ready is never revoked silently", () => {
  it("says why when unchecking an item takes a Ready trip back to packing", async () => {
    const { user, source } = setup("lisbon");
    await ready();
    expect(screen.getByText("You’re ready to go.")).toBeTruthy();
    await toggle(user, "tops");
    expect(await screen.findByText("No longer ready: an item was unchecked")).toBeTruthy();
    expect(tripOf(source, "lisbon").ready).toBe(false);
    expect(screen.queryByText("You’re ready to go.")).toBeNull();
  });

  it("says nothing when a change leaves the trip as it was", async () => {
    const { user } = setup("san-diego");
    await ready();
    await toggle(user, "tops");
    await waitFor(() => expect(screen.getByText("Everyday tops 4 of 4 packed")).toBeTruthy());
    expect(screen.queryByText(/No longer ready/)).toBeNull();
  });
});

describe("the 'No longer ready' toast is for the change that revoked Ready, not later ones", () => {
  it("shows once, then stays quiet for the next change", async () => {
    const { user, source } = setup("lisbon");
    await ready();
    await toggle(user, "tops");
    expect(await screen.findByText("No longer ready: an item was unchecked")).toBeTruthy();
    expect(tripOf(source, "lisbon").ready).toBe(false);
    // Let that toast expire, then change the (no longer Ready) trip twice more.
    await waitFor(() => expect(screen.queryByText(/No longer ready/)).toBeNull(), {
      timeout: 6000,
    });
    await toggle(user, "tops");
    await waitFor(() =>
      expect((within(row("tops")).getByRole("checkbox") as HTMLInputElement).checked).toBe(true),
    );
    await toggle(user, "tops");
    await waitFor(() =>
      expect((within(row("tops")).getByRole("checkbox") as HTMLInputElement).checked).toBe(false),
    );
    expect(screen.queryByText(/No longer ready/)).toBeNull();
  }, 20_000);
});

describe("Save as a list (#169)", () => {
  const open = async (user: ReturnType<typeof userEvent.setup>) => {
    await ready();
    await user.click(screen.getByRole("button", { name: "Save as a list" }));
    return screen.getByRole("dialog", { name: "Save as a list" });
  };

  it("saves the trip's items as a list, says so with a link to the lists, and leaves the trip as it was", async () => {
    push.mockClear();
    const { user, source } = setup();
    const before = JSON.stringify(tripOf(source));
    const sheet = await open(user);
    expect((within(sheet).getByLabelText("List name") as HTMLInputElement).value).toBe("San Diego");
    const total = tripOf(source).items.length;
    expect(within(sheet).getByText(`${total} of ${total} items`)).toBeTruthy();
    await user.click(within(sheet).getByRole("button", { name: "Save list" }));
    expect(await screen.findByText(`“San Diego” saved (${total} items).`)).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: "Save as a list" })).toBeNull();
    expect(JSON.stringify(tripOf(source))).toBe(before);
    await user.click(screen.getByRole("button", { name: "View lists" }));
    expect(push).toHaveBeenCalledExactlyOnceWith("/staples/lists");
  });

  it("leaves unticked items out", async () => {
    const { user } = setup();
    const sheet = await open(user);
    const total = within(sheet).getAllByRole("checkbox").length;
    await user.click(within(sheet).getAllByRole("checkbox")[0]);
    await user.click(within(sheet).getByRole("button", { name: "Save list" }));
    expect(await screen.findByText(`“San Diego” saved (${total - 1} items).`)).toBeTruthy();
  });

  it("says when the name is taken, keeping the dialog open", async () => {
    const { user } = setup();
    let sheet = await open(user);
    await user.click(within(sheet).getByRole("button", { name: "Save list" }));
    await screen.findByText(/saved \(/);
    sheet = await open(user);
    await user.click(within(sheet).getByRole("button", { name: "Save list" }));
    expect(
      await within(screen.getByRole("dialog")).findByText(
        /You already have a list called “San Diego”/,
      ),
    ).toBeTruthy();
  });

  it("says nothing changed, and keeps the dialog, when the save fails", async () => {
    const { user } = setup("san-diego", (base) => ({
      ...base,
      saveAsList: () => Promise.reject(new Error("down")),
    }));
    const sheet = await open(user);
    await user.click(within(sheet).getByRole("button", { name: "Save list" }));
    expect(await within(sheet).findByText("Couldn’t save. Nothing was changed.")).toBeTruthy();
  });
});

describe("opening an item's editor from the dashboard (?edit=, #166)", () => {
  it("opens that item's editor once the trip has loaded, and puts the URL back to the plain trip", async () => {
    const replaceState = vi.spyOn(window.history, "replaceState");
    try {
      setup("san-diego", undefined, "sunglasses");
      const dialog = await screen.findByRole("dialog", { name: "Edit item" });
      expect((within(dialog).getByLabelText("Item name") as HTMLInputElement).value).toBe(
        "Sunglasses",
      );
      // The clean-up runs in an effect: wait for it rather than assuming it has run (#220).
      await waitFor(() =>
        expect(replaceState).toHaveBeenCalledExactlyOnceWith(null, "", "/trips/san-diego"),
      );
    } finally {
      replaceState.mockRestore();
    }
  });

  it("opens it only once: closing the editor does not bring it back", async () => {
    const { user } = setup("san-diego", undefined, "sunglasses");
    await screen.findByRole("dialog", { name: "Edit item" });
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Edit item" })).toBeNull());
    await user.click(screen.getByRole("button", { name: /^To pack/ }));
    await user.click(screen.getByRole("button", { name: /^All \d/ }));
    expect(screen.queryByRole("dialog", { name: "Edit item" })).toBeNull();
  });

  it("puts focus on that item's row when the editor closes (it has no opener to return to)", async () => {
    const { user } = setup("san-diego", undefined, "sunglasses");
    await screen.findByRole("dialog", { name: "Edit item" });
    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(document.activeElement).toBe(within(row("sunglasses")).getByRole("checkbox")),
    );
  });

  it("also lands focus on the row after a save", async () => {
    const { user } = setup("san-diego", undefined, "sunglasses");
    const dialog = await screen.findByRole("dialog", { name: "Edit item" });
    await user.click(within(dialog).getByRole("button", { name: /^Save/ }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Edit item" })).toBeNull());
    await waitFor(() =>
      expect(document.activeElement).toBe(within(row("sunglasses")).getByRole("checkbox")),
    );
  });

  it("after a SAVE that finishes later, focus still lands on the item's row once the updated row is mounted", async () => {
    const gate = deferred<void>();
    const { user } = setup(
      "san-diego",
      (base) => ({
        ...base,
        editItem: async (id, itemId, edit) => {
          await gate.promise;
          return base.editItem(id, itemId, edit);
        },
      }),
      "sunglasses",
    );
    const dialog = await screen.findByRole("dialog", { name: "Edit item" });
    await user.click(within(dialog).getByRole("button", { name: /^Save/ }));
    // Still saving: the sheet stays open, nothing is focused on the row yet.
    expect(screen.getByRole("dialog", { name: "Edit item" })).toBeTruthy();
    await act(async () => gate.resolve());
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Edit item" })).toBeNull());
    await waitFor(() =>
      expect(document.activeElement).toBe(within(row("sunglasses")).getByRole("checkbox")),
    );
  });

  it("falls back to the open cube's title when the item is gone after the editor closes (a Remove)", async () => {
    const { user } = setup("san-diego", undefined, "nice-shoes");
    const dialog = await screen.findByRole("dialog", { name: "Edit item" });
    await user.click(within(dialog).getByRole("button", { name: "Remove item" }));
    const confirm = await screen.findByRole("dialog", { name: "Remove Dress shoes?" });
    await user.click(within(confirm).getByRole("button", { name: "Remove item" }));
    await waitFor(() => expect(row("nice-shoes")).toBeNull());
    await waitFor(() =>
      expect(document.activeElement).toBe(document.querySelector("section[data-cube] h2")),
    );
  });

  it("opens nothing for an item that is not on the trip, but still cleans the URL", async () => {
    const replaceState = vi.spyOn(window.history, "replaceState");
    try {
      setup("san-diego", undefined, "no-such-item");
      await ready();
      // The heading shows when the trip has loaded; the URL clean-up is an effect that runs after that render (#220).
      await waitFor(() =>
        expect(replaceState).toHaveBeenCalledExactlyOnceWith(null, "", "/trips/san-diego"),
      );
      expect(screen.queryByRole("dialog", { name: "Edit item" })).toBeNull();
    } finally {
      replaceState.mockRestore();
    }
  });

  it("leaves the URL and focus alone when no item was asked for", async () => {
    const replaceState = vi.spyOn(window.history, "replaceState");
    try {
      setup();
      await ready();
      // Let any pending effect run first, so "not called" cannot pass just because the clean-up has not run yet (#220).
      await act(async () => {});
      expect(screen.queryByRole("dialog", { name: "Edit item" })).toBeNull();
      expect(replaceState).not.toHaveBeenCalled();
    } finally {
      replaceState.mockRestore();
    }
  });
});
