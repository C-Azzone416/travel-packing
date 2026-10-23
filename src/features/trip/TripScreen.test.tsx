// @vitest-environment jsdom
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderInApp } from "@/test/providers";
import { sampleLifecycleState } from "@/features/trips/fixtures";
import {
  createMemoryTripsSource,
  TripsSourceError,
  type TripsSource,
} from "@/features/trips/trips-source";
import { TripsSourceProvider } from "@/features/trips/TripsSourceProvider";
import type { StopWeather } from "@/domain/weather/types";
import { TripScreen } from "./TripScreen";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  usePathname: () => "/trips/san-diego",
  useRouter: () => ({ push }),
}));

const TOILETRIES = [
  "nice-makeup",
  "last-toothbrush",
  "last-toothpaste",
  "last-deodorant",
  "last-contacts",
];

function memory() {
  let counter = 0;
  return createMemoryTripsSource(sampleLifecycleState(), {
    now: () => 1,
    newId: () => `new-${++counter}`,
    today: () => "2026-10-16",
  });
}

function setup(
  tripId = "san-diego",
  wrap?: (base: ReturnType<typeof memory>) => TripsSource,
  openItemId?: string,
) {
  const base = memory();
  const source = wrap ? wrap(base) : base;
  const user = userEvent.setup();
  const view = renderInApp(
    <TripsSourceProvider source={source}>
      <TripScreen tripId={tripId} openItemId={openItemId} />
    </TripsSourceProvider>,
  );
  return { user, source: base, view };
}

const row = (id: string) => document.querySelector(`[data-item-id="${id}"]`) as HTMLElement;
const ready = (name = "San Diego") => screen.findByRole("heading", { name, level: 1 });
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
  it("shows a loading state, then the trip with its header, progress and Packing badge", async () => {
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
    expect(screen.getByText("California, United States · Oct 23 – Oct 27 · 5 days")).toBeTruthy();
    expect(screen.queryByText("Ready", { selector: ".status-pill" })).toBeNull();
    expect(screen.getByRole("link", { name: "All trips" }).getAttribute("href")).toBe("/");
    const bar = screen.getByRole("progressbar", { name: "Packing progress" });
    expect(bar.getAttribute("aria-valuenow")).toBe("19"); // 6 of 32 (#205: San Diego has one more everyday top and bottom)
    expect(bar.getAttribute("aria-valuetext")).toBe("19% packed");
    expect(screen.queryByText(/sample/i)).toBeNull();
  });

  it("shows the ledger hero (departure eyebrow, route stamp), the packed line and the sections panel", async () => {
    setup("san-diego");
    await ready();
    expect(
      screen.getByText(/^(Leaves in \d+ days|Leaves tomorrow|Leaves today|Under way)$/),
    ).toBeTruthy();
    expect(screen.getByRole("img", { name: /departure stamp$|route stamps$/ })).toBeTruthy();
    // The trip picture is off on the packing hero, so its stamp is transparent (no backing disc).
    expect(document.querySelector("[data-stamp]")?.hasAttribute("data-on-picture")).toBe(false);
    expect(
      screen.getByText(/^\d+ of \d+ packed( \/ \d+ left)?$/, { selector: ".progress-line" }),
    ).toBeTruthy();
    const panel = screen.getByRole("navigation", { name: "Packing sections" });
    const main = within(panel).getByRole("link", { name: /Everyday & occasion/ });
    expect(main.getAttribute("href")).toBe("#block-main");
    expect(document.getElementById("block-main")).toBeTruthy();
    expect(
      screen.getAllByText(/\d+ of \d+ complete/, { selector: ".list-section-count" }).length,
    ).toBeGreaterThan(0);
  });

  it("shows Ready for a Ready trip, with the Ready card and review links", async () => {
    setup("lisbon");
    await ready("Lisbon");
    expect(screen.getByText("Ready", { selector: ".status-pill" })).toBeTruthy();
    expect(screen.getByText("You’re ready to go.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Review bag again" }).getAttribute("href")).toBe(
      "/trips/lisbon/review",
    );
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
    expect(screen.getByRole("link", { name: "Saved" })).toBeTruthy();
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

  it("organizes items into everyday, Toiletries, return outfit and a Pack last timing view, each item once", async () => {
    setup();
    await ready();
    expect(screen.getByRole("heading", { name: "Everyday & occasion items" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Toiletries" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Return travel outfit" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Pack last" })).toBeTruthy();
    expect(document.querySelectorAll('[data-item-id="last-toothbrush"]')).toHaveLength(1);
    expect(within(row("last-toothbrush")).getByText("Pack last")).toBeTruthy();
  });
});

describe("filters", () => {
  it("Still to pack hides finished rows and empty sections say so; All brings them back", async () => {
    const { user } = setup();
    await ready();
    expect(row("sleepwear")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Still to pack" }));
    expect(screen.getByRole("button", { name: "Still to pack" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(row("sleepwear")).toBeNull();
    expect(row("underwear")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "All items" }));
    expect(row("sleepwear")).toBeTruthy();
  });

  it("an emptied section shows 'Nothing left in this section.'", async () => {
    const { user } = setup("lisbon");
    await ready("Lisbon");
    await user.click(screen.getByRole("button", { name: "Still to pack" }));
    expect(screen.getAllByText("Nothing left in this section.").length).toBeGreaterThan(0);
    expect(screen.queryByRole("heading", { name: "Toiletries" })).toBeNull();
  });
});

describe("packing", () => {
  it("checks and unchecks an item, saving each change", async () => {
    const { user, source } = setup();
    await ready();
    await user.click(within(row("tops")).getByRole("button", { name: "Pack all Everyday tops" }));
    await waitFor(() => expect(itemOf(source, "tops").packed).toBe(itemOf(source, "tops").qty));
    expect(
      within(row("tops"))
        .getByRole("button", { name: "Packed, mark Everyday tops unpacked" })
        .hasAttribute("aria-pressed"),
    ).toBe(false);
    expect(live().textContent).toBe("Everyday tops 3 of 3 packed");
    await user.click(
      within(row("tops")).getByRole("button", { name: "Packed, mark Everyday tops unpacked" }),
    );
    await waitFor(() => expect(itemOf(source, "tops").packed).toBe(0));
  });

  it("steps partial quantities, announcing 'Name n of m packed', and ignores a press at either limit", async () => {
    const { user, source } = setup();
    await ready();
    const underwear = row("underwear");
    const up = () => within(underwear).getByRole("button", { name: "Increase packed Underwear" });
    const down = () => within(underwear).getByRole("button", { name: "Decrease packed Underwear" });
    await user.click(up());
    // The tapped count shows at once, before anything is sent.
    expect(live().textContent).toBe("Underwear 3 of 4 packed");
    expect(within(underwear).getByText("3 of 4 packed")).toBeTruthy();
    await user.click(up());
    expect(up().getAttribute("aria-disabled")).toBe("true");
    await user.click(up());
    await waitFor(() => expect(itemOf(source, "underwear").packed).toBe(4));
    for (let n = 0; n < 4; n++) await user.click(down());
    expect(down().getAttribute("aria-disabled")).toBe("true");
    await user.click(down());
    await waitFor(() => expect(itemOf(source, "underwear").packed).toBe(0));
    expect(within(underwear).getByText("0 of 4 packed")).toBeTruthy();
  });

  it("sends ONE write per item with the final count after the taps settle", async () => {
    const setPacked = vi.fn();
    const { user, source } = setup("san-diego", (base) => ({
      ...base,
      setPacked: (id, itemId, packed) => (
        setPacked(itemId, packed),
        base.setPacked(id, itemId, packed)
      ),
    }));
    await ready();
    const socks = row("socks");
    for (let n = 0; n < 3; n++)
      await user.click(within(socks).getByRole("button", { name: "Increase packed Socks" }));
    expect(setPacked).not.toHaveBeenCalled();
    expect(within(socks).getByText("4 of 4 packed")).toBeTruthy();
    await waitFor(() => expect(itemOf(source, "socks").packed).toBe(4));
    expect(setPacked).toHaveBeenCalledTimes(1);
    expect(setPacked).toHaveBeenCalledWith("socks", 4);
  });

  it("keeps the tapped count on screen while a write is in flight, and sends the next one only after it finishes", async () => {
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
    const socks = row("socks");
    const up = () => within(socks).getByRole("button", { name: "Increase packed Socks" });
    await user.click(up());
    await waitFor(() => expect(calls).toEqual([2]));
    // A tap during the first write: shown at once, not sent in parallel.
    await user.click(up());
    expect(within(socks).getByText("3 of 4 packed")).toBeTruthy();
    await new Promise((resolve) => setTimeout(resolve, 450));
    expect(calls).toEqual([2]);
    await act(async () => gate.resolve());
    await waitFor(() => expect(calls).toEqual([2, 3]));
    await waitFor(() => expect(itemOf(source, "socks").packed).toBe(3));
    expect(within(socks).getByText("3 of 4 packed")).toBeTruthy();
  });

  it("a check or uncheck is sent at once, not after a pause", async () => {
    const { user, source } = setup();
    await ready();
    await user.click(within(row("tops")).getByRole("button", { name: "Pack all Everyday tops" }));
    await waitFor(() => expect(itemOf(source, "tops").packed).toBe(itemOf(source, "tops").qty));
    await user.click(
      within(row("tops")).getByRole("button", { name: "Packed, mark Everyday tops unpacked" }),
    );
    await waitFor(() => expect(itemOf(source, "tops").packed).toBe(0));
  });

  it("sends taps that are still waiting when the screen is left", async () => {
    const { user, source, view } = setup();
    await ready();
    await user.click(within(row("socks")).getByRole("button", { name: "Increase packed Socks" }));
    view.unmount();
    await waitFor(() => expect(itemOf(source, "socks").packed).toBe(2));
  });

  it("a failed change shows 'Not saved · Retry' beside that row and the Error chip, and Retry clears both when it works", async () => {
    let fail = true;
    const { user, source } = setup("san-diego", (base) => ({
      ...base,
      setPacked: (id, itemId, packed) =>
        fail ? Promise.reject(new Error("nope")) : base.setPacked(id, itemId, packed),
    }));
    await ready();
    await user.click(within(row("tops")).getByRole("button", { name: "Pack all Everyday tops" }));
    expect(
      await within(row("tops")).findByRole("button", { name: "Not saved · Retry" }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Not saved, retry" })).toBeTruthy();
    // The row keeps showing what the user did, and nothing was stored.
    expect(itemOf(source, "tops").packed).toBe(1);
    expect(within(row("tops")).getByText("3 of 3 packed")).toBeTruthy();
    fail = false;
    await user.click(within(row("tops")).getByRole("button", { name: "Not saved · Retry" }));
    await waitFor(() => expect(itemOf(source, "tops").packed).toBe(3));
    expect(within(row("tops")).queryByRole("button", { name: "Not saved · Retry" })).toBeNull();
    expect(screen.getByRole("link", { name: "Saved" })).toBeTruthy();
  });

  it("Retry sends only the latest count, even after more taps on the failed row", async () => {
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
    const socks = row("socks");
    await user.click(within(socks).getByRole("button", { name: "Increase packed Socks" }));
    await within(socks).findByRole("button", { name: "Not saved · Retry" });
    await user.click(within(socks).getByRole("button", { name: "Decrease packed Socks" }));
    await user.click(within(socks).getByRole("button", { name: "Decrease packed Socks" }));
    await waitFor(() => expect(sent).toEqual([2, 0]));
    fail = false;
    await user.click(within(socks).getByRole("button", { name: "Not saved · Retry" }));
    await waitFor(() => expect(itemOf(source, "socks").packed).toBe(0));
    expect(sent).toEqual([2, 0, 0]);
  });

  it("the chip's Retry re-sends the failed row change too, and the row error clears", async () => {
    let fail = true;
    const { user, source } = setup("san-diego", (base) => ({
      ...base,
      setPacked: (id, itemId, packed) =>
        fail ? Promise.reject(new Error("nope")) : base.setPacked(id, itemId, packed),
    }));
    await ready();
    await user.click(within(row("socks")).getByRole("button", { name: "Increase packed Socks" }));
    expect(
      await within(row("socks")).findByRole("button", { name: "Not saved · Retry" }),
    ).toBeTruthy();
    fail = false;
    await user.click(screen.getByRole("button", { name: "Not saved, retry" }));
    await user.click(
      within(screen.getByRole("dialog", { name: "Couldn’t save" })).getByRole("button", {
        name: "Retry",
      }),
    );
    await waitFor(() => expect(itemOf(source, "socks").packed).toBe(2));
    expect(within(row("socks")).queryByRole("button", { name: "Not saved · Retry" })).toBeNull();
  });

  it("completing the last item only reveals Review your bag; it never marks the trip Ready", async () => {
    const { user, source } = setup();
    await ready();
    const items = tripOf(source).items.map((item) => item.id);
    for (const id of [...items.filter((entry) => !TOILETRIES.includes(entry)), ...TOILETRIES]) {
      const pack = within(row(id)).queryByRole("button", { name: /^Pack all / });
      if (pack) await user.click(pack);
    }
    await user.click(await screen.findByRole("button", { name: "Confirm" }));
    const review = await screen.findByRole("link", { name: "Review your bag" });
    expect(review.getAttribute("href")).toBe("/trips/san-diego/review");
    expect(tripOf(source).ready).toBe(false);
    expect(screen.queryByText("Ready", { selector: ".status-pill" })).toBeNull();
    expect(screen.queryByText("You’re ready to go.")).toBeNull();
  });
});

describe("toiletry bag gate", () => {
  async function checkBathroom(user: ReturnType<typeof userEvent.setup>) {
    for (const id of TOILETRIES)
      await user.click(within(row(id)).getByRole("button", { name: /^Pack all / }));
  }

  it("starts waiting, with counts", async () => {
    setup();
    await ready();
    expect(screen.getByText("Toiletry bag not ready to place")).toBeTruthy();
    expect(screen.getByText("0 of 5 contents checked")).toBeTruthy();
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
    await user.click(
      within(row("last-contacts")).getByRole("button", { name: "Packed, mark Contacts unpacked" }),
    );
    await user.click(
      within(row("last-contacts")).getByRole("button", { name: "Pack all Contacts" }),
    );
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
    await user.click(
      within(row("last-contacts")).getByRole("button", { name: "Packed, mark Contacts unpacked" }),
    );
    expect(await screen.findByText("Toiletry bag not ready to place")).toBeTruthy();
  });

  it("hides the whole section under Still to pack once everything in it is done and the bag is placed", async () => {
    const { user } = setup("lisbon");
    await ready("Lisbon");
    expect(screen.getByRole("heading", { name: "Toiletries" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Still to pack" }));
    expect(screen.queryByRole("heading", { name: "Toiletries" })).toBeNull();
  });

  it("adds a Bathroom item: validated, one normal checkbox, resetting an already placed bag", async () => {
    const { user, source } = setup("lisbon");
    await ready("Lisbon");
    await user.click(screen.getByRole("button", { name: "＋ Add a Bathroom item" }));
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
    await user.click(screen.getByRole("button", { name: "＋ Add a Bathroom item" }));
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
    await user.click(within(row("sunglasses")).getByRole("button", { name: /^Sunglasses / }));
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
      within(row("sunglasses")).getByRole("button", { name: /^Beach sunglasses / }),
    );
  });

  it("a remembered edit saves to the staples; the per-day preview reads from the domain and updates as the quantity changes", async () => {
    const { user, source } = setup();
    await ready();
    await user.click(within(row("underwear")).getByRole("button", { name: /^Underwear / }));
    const dialog = screen.getByRole("dialog", { name: "Edit item" });
    const hint = within(dialog).getByRole("status", { name: "Saved quantity" });
    expect(hint.textContent).toBe("");
    await user.click(within(dialog).getByRole("radio", { name: /Remember for future trips/ }));
    expect(hint.textContent).toBe("Saved as 1 per day for future trips.");
    await user.clear(within(dialog).getByLabelText("Quantity"));
    await user.type(within(dialog).getByLabelText("Quantity"), "9");
    expect(hint.textContent).toBe("Saved as 3 per day for future trips.");
    await user.click(within(dialog).getByRole("radio", { name: /This trip only/ }));
    expect(hint.textContent).toBe("");
    await user.click(within(dialog).getByRole("radio", { name: /Remember for future trips/ }));
    await user.click(within(dialog).getByRole("button", { name: "Save item" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(source.staplesSnapshot().find((staple) => staple.id === "underwear")?.qty).toBe(3);
    expect(itemOf(source, "underwear").qty).toBe(9);
  });

  it("says the saved quantity stays the same when the trip has no packing days", async () => {
    const state = sampleLifecycleState();
    state.trips[0] = { ...state.trips[0], dailyDays: 0 };
    const base = createMemoryTripsSource(state, { now: () => 1 });
    const user = userEvent.setup();
    renderInApp(
      <TripsSourceProvider source={base}>
        <TripScreen tripId="san-diego" />
      </TripsSourceProvider>,
    );
    await ready();
    await user.click(within(row("underwear")).getByRole("button", { name: /^Underwear / }));
    await user.click(screen.getByRole("radio", { name: /Remember for future trips/ }));
    expect(screen.getByRole("status", { name: "Saved quantity" }).textContent).toBe(
      "This trip has no packing days, so the saved quantity stays the same.",
    );
  });

  it("has no preview for a per-trip staple", async () => {
    const { user } = setup();
    await ready();
    await user.click(within(row("sunglasses")).getByRole("button", { name: /^Sunglasses / }));
    await user.click(screen.getByRole("radio", { name: /Remember for future trips/ }));
    expect(screen.getByRole("status", { name: "Saved quantity" }).textContent).toBe("");
  });

  it("refuses an empty name inline, and clears the error as the person types", async () => {
    const { user, source } = setup();
    await ready();
    await user.click(within(row("tops")).getByRole("button", { name: /^Everyday tops / }));
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
    await user.click(within(row("tops")).getByRole("button", { name: /^Everyday tops / }));
    const dialog = screen.getByRole("dialog", { name: "Edit item" });
    expect(within(dialog).queryByRole("button", { name: "Remove item" })).toBeNull();
    await user.click(within(dialog).getByRole("switch", { name: "Pack last" }));
    await user.click(within(dialog).getByRole("button", { name: "Save item" }));
    await waitFor(() => expect(itemOf(source, "tops").section).toBe("packlast"));
    expect(within(row("tops")).getByText("Pack last")).toBeTruthy();
  });

  it("a return item shows its callout and has no Pack last switch", async () => {
    const { user } = setup();
    await ready();
    await user.click(within(row("return-top")).getByRole("button", { name: /^Fresh top / }));
    const dialog = screen.getByRole("dialog", { name: "Edit item" });
    expect(within(dialog).getByText(/stays in the dedicated return set/)).toBeTruthy();
    expect(within(dialog).queryByRole("switch", { name: "Pack last" })).toBeNull();
    await user.click(within(dialog).getByRole("button", { name: "Save item" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("shows the optional and Bathroom callouts", async () => {
    const { user } = setup();
    await ready();
    await user.click(within(row("nice-shoes")).getByRole("button", { name: /^Dress shoes / }));
    expect(screen.getByText(/Optional suggestion\./)).toBeTruthy();
    await user.keyboard("{Escape}");
    await user.click(within(row("last-toothbrush")).getByRole("button", { name: /^Toothbrush / }));
    expect(screen.getByText(/Bathroom item\./)).toBeTruthy();
  });

  it("removes an optional item only after a confirmation that focuses the safe button; Keep item returns to the editor", async () => {
    const { user, source } = setup();
    await ready();
    await user.click(within(row("nice-shoes")).getByRole("button", { name: /^Dress shoes / }));
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
    await user.click(within(row("last-toothbrush")).getByRole("button", { name: /^Toothbrush / }));
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
    await ready("Lisbon");
    expect(await screen.findByText("Get weather for your stops?")).toBeTruthy();
    expect(screen.getByText(/Only map coordinates and dates are sent to Open-Meteo/)).toBeTruthy();
    expect(wired.getTripWeather).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Get weather" }));
    await waitFor(() => expect(wired.getTripWeather).toHaveBeenCalledWith("lisbon"));
    expect(await screen.findByText("Forecast")).toBeTruthy();
    expect(screen.getByText(/Weather data by Open-Meteo.com/)).toBeTruthy();
  });

  it("reviews real recommendation diffs, applies selected changes and revokes Ready", async () => {
    let wired!: ReturnType<typeof withWeather>;
    const { user, source } = setup("lisbon", (base) => {
      wired = withWeather(base, true);
      return wired.source;
    });
    await ready("Lisbon");
    await user.click(await screen.findByRole("button", { name: "Review changes" }));
    const dialog = screen.getByRole("dialog", { name: "Weather changes" });
    expect(within(dialog).getByText(/takes this trip out of Ready/)).toBeTruthy();
    expect(within(dialog).getByText("Add Compact umbrella")).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: /Add selected/ }));
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
    await ready("Lisbon");
    expect(
      await screen.findByText("We couldn’t reach the weather service. Your list is unchanged."),
    ).toBeTruthy();
    expect(screen.queryByText(/weather changes? to review/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Review changes" })).toBeNull();
  });

  it("asks the weather service again when the route is edited", async () => {
    let wired!: ReturnType<typeof withWeather>;
    const { user } = setup("lisbon", (base) => {
      wired = withWeather(base, true);
      return wired.source;
    });
    await ready("Lisbon");
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
    await ready("Lisbon");
    await user.click(await screen.findByRole("button", { name: "Review changes" }));
    const dialog = screen.getByRole("dialog", { name: "Weather changes" });
    await user.click(within(dialog).getByRole("button", { name: "Skip" }));
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
    await ready("Lisbon");
    await second.user.click(screen.getByRole("button", { name: "Not now" }));
    await waitFor(() => expect(off.updateSettings).toHaveBeenCalledWith({ weatherOptIn: false }));
    expect(off.getTripWeather).not.toHaveBeenCalled();
  });
});

describe("preferences and Ready", () => {
  it("editing preferences recalculates the list and revokes Ready", async () => {
    const { user, source } = setup("lisbon");
    await ready("Lisbon");
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
    await ready("Lisbon");
    const before = structuredClone(tripOf(source, "lisbon").items);
    await user.click(screen.getByRole("button", { name: "Mark as not ready" }));
    await waitFor(() => expect(tripOf(source, "lisbon").ready).toBe(false));
    expect(tripOf(source, "lisbon").items).toEqual(before);
    expect(
      within(document.querySelector(".toast-region") as HTMLElement).getByText("Progress kept."),
    ).toBeTruthy();
    expect(screen.queryByText("You’re ready to go.")).toBeNull();
  });

  it("shows the trip math", async () => {
    setup();
    await ready();
    expect(
      screen.getByText("5 days away − 1 worn − 1 for home = 3 days of everyday clothes."),
    ).toBeTruthy();
  });

  it("a trip with no confirmed location has no place line, and its header art is still its theme", async () => {
    const state = sampleLifecycleState();
    state.trips[0] = { ...state.trips[0], location: null };
    const base = createMemoryTripsSource(state, { now: () => 1 });
    renderInApp(
      <TripsSourceProvider source={base}>
        <TripScreen tripId="san-diego" />
      </TripsSourceProvider>,
    );
    await ready();
    expect(screen.getByText("Oct 23 – Oct 27 · 5 days")).toBeTruthy();
    expect(document.querySelector("[data-art-key]")?.getAttribute("data-art-key")).toBe("beach");
  });

  it("a one-day trip says '1 day'", async () => {
    const state = sampleLifecycleState();
    state.trips[0] = {
      ...state.trips[0],
      start: "2026-10-23",
      end: "2026-10-23",
      days: 1,
      dailyDays: 0,
    };
    const base = createMemoryTripsSource(state, { now: () => 1 });
    renderInApp(
      <TripsSourceProvider source={base}>
        <TripScreen tripId="san-diego" />
      </TripsSourceProvider>,
    );
    await ready();
    expect(screen.getByText(/Oct 23 – Oct 23 · 1 day$/)).toBeTruthy();
  });
});

describe("how long things take", () => {
  afterEach(() => vi.useRealTimers());

  const flush = () => act(async () => {});
  // findBy* polls on timers, which are faked here, so wait for the load by flushing instead.
  const loaded = async () => {
    await flush();
    await flush();
    return screen.getByRole("heading", { name: "San Diego", level: 1 });
  };

  it("opening a trip is a read: even a slow load never shows 'Saving…'", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const gate = deferred<void>();
    setup("san-diego", (base) => ({
      ...base,
      getTrip: async (id) => (await gate.promise, base.getTrip(id)),
    }));
    act(() => vi.advanceTimersByTime(5000));
    expect(screen.queryByText("Saving…")).toBeNull();
    await act(async () => gate.resolve());
    expect(await loaded()).toBeTruthy();
    expect(screen.queryByText("Saving…")).toBeNull();
  });

  it("a check is sent at once, with no pause", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const setPacked = vi.fn();
    setup("san-diego", (base) => ({
      ...base,
      setPacked: (id, itemId, packed) => (
        setPacked(itemId, packed),
        base.setPacked(id, itemId, packed)
      ),
    }));
    await loaded();
    fireEvent.click(within(row("tops")).getByRole("button", { name: "Pack all Everyday tops" }));
    await flush();
    expect(setPacked).toHaveBeenCalledTimes(1);
    expect(setPacked).toHaveBeenCalledWith("tops", 3);
    fireEvent.click(
      within(row("tops")).getByRole("button", { name: "Packed, mark Everyday tops unpacked" }),
    );
    await flush();
    expect(setPacked).toHaveBeenLastCalledWith("tops", 0);
  });

  it("a tap waits 300 ms of quiet, and every further tap restarts the wait", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const setPacked = vi.fn();
    setup("san-diego", (base) => ({
      ...base,
      setPacked: (id, itemId, packed) => (
        setPacked(itemId, packed),
        base.setPacked(id, itemId, packed)
      ),
    }));
    await loaded();
    const up = () => within(row("socks")).getByRole("button", { name: "Increase packed Socks" });
    fireEvent.click(up());
    act(() => vi.advanceTimersByTime(299));
    expect(setPacked).not.toHaveBeenCalled();
    fireEvent.click(up());
    // 400 ms after the first tap but only 200 after the second: still waiting.
    act(() => vi.advanceTimersByTime(200));
    await flush();
    expect(setPacked).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(100));
    await flush();
    expect(setPacked).toHaveBeenCalledTimes(1);
    expect(setPacked).toHaveBeenCalledWith("socks", 3);
  });

  it("leaving the screen sends waiting taps straight away, once", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const setPacked = vi.fn();
    const { view } = setup("san-diego", (base) => ({
      ...base,
      setPacked: (id, itemId, packed) => (
        setPacked(itemId, packed),
        base.setPacked(id, itemId, packed)
      ),
    }));
    await loaded();
    fireEvent.click(within(row("socks")).getByRole("button", { name: "Increase packed Socks" }));
    expect(setPacked).not.toHaveBeenCalled();
    view.unmount();
    await flush();
    expect(setPacked).toHaveBeenCalledTimes(1);
    expect(setPacked).toHaveBeenCalledWith("socks", 2);
    act(() => vi.advanceTimersByTime(2000));
    await flush();
    expect(setPacked).toHaveBeenCalledTimes(1);
  });

  it("Retry sends the latest count even when more taps are still waiting to be sent", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let fail = true;
    const sent: number[] = [];
    const { source } = setup("san-diego", (base) => ({
      ...base,
      setPacked: (id, itemId, packed) => {
        sent.push(packed);
        return fail ? Promise.reject(new Error("nope")) : base.setPacked(id, itemId, packed);
      },
    }));
    await loaded();
    const up = () => within(row("socks")).getByRole("button", { name: "Increase packed Socks" });
    fireEvent.click(up());
    act(() => vi.advanceTimersByTime(300));
    await flush();
    expect(sent).toEqual([2]);
    const retry = within(row("socks")).getByRole("button", { name: "Not saved · Retry" });
    fireEvent.click(up());
    fireEvent.click(up());
    fail = false;
    // The debounce for those two taps has not fired yet when Retry is pressed.
    fireEvent.click(retry);
    await flush();
    expect(sent).toEqual([2, 4]);
    expect(itemOf(source, "socks").packed).toBe(4);
    act(() => vi.advanceTimersByTime(1000));
    await flush();
    expect(sent).toEqual([2, 4]);
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
    for (const id of TOILETRIES)
      await user.click(within(row(id)).getByRole("button", { name: /^Pack all / }));
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
    await user.click(screen.getByRole("button", { name: "＋ Add a Bathroom item" }));
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
    await user.click(within(row("sunglasses")).getByRole("button", { name: /^Sunglasses / }));
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

describe("changing the theme", () => {
  const artKey = () =>
    document.querySelector(".trip-hero [data-art-key]")?.getAttribute("data-art-key");
  const changeButton = () => screen.getByRole("button", { name: "Change theme" });

  it("opens a sheet with the current theme selected, Save and Cancel, and no other controls changed", async () => {
    const { user } = setup();
    await ready();
    expect(artKey()).toBe("beach");
    await user.click(changeButton());
    const sheet = screen.getByRole("dialog", { name: "Change theme" });
    expect((within(sheet).getByRole("radio", { name: "Beach" }) as HTMLInputElement).checked).toBe(
      true,
    );
    expect(within(sheet).getAllByRole("radio")).toHaveLength(6);
    expect(within(sheet).getByRole("button", { name: "Cancel" })).toBeTruthy();
    expect(within(sheet).getByRole("button", { name: "Save theme" })).toBeTruthy();
    // It starts on the selected option, so the arrow keys move from there.
    expect(document.activeElement).toBe(within(sheet).getByRole("radio", { name: "Beach" }));
  });

  it("saving stores the theme, then the header art changes and the change is announced", async () => {
    const { user, source } = setup();
    await ready();
    await user.click(changeButton());
    await user.click(screen.getByRole("radio", { name: "Mountain / outdoors" }));
    // Choosing alone changes nothing yet.
    expect(artKey()).toBe("beach");
    expect(tripOf(source).theme).toBe("beach");
    await user.click(screen.getByRole("button", { name: "Save theme" }));
    await waitFor(() => expect(artKey()).toBe("outdoors"));
    expect(tripOf(source).theme).toBe("outdoors");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(live().textContent).toBe("Theme changed to Mountain / outdoors.");
    expect(document.activeElement).toBe(changeButton());
  });

  it("the header art changes only after the source confirms", async () => {
    const gate = deferred<void>();
    const { user, source } = setup("san-diego", (base) => ({
      ...base,
      setTheme: async (id, theme) => {
        await gate.promise;
        return base.setTheme(id, theme);
      },
    }));
    await ready();
    await user.click(changeButton());
    await user.click(screen.getByRole("radio", { name: "City" }));
    await user.click(screen.getByRole("button", { name: "Save theme" }));
    // Still waiting: the old picture stays, and the sheet cannot be submitted twice.
    expect(artKey()).toBe("beach");
    expect(screen.getByRole("button", { name: "Save theme" }).hasAttribute("disabled")).toBe(true);
    await act(async () => gate.resolve());
    await waitFor(() => expect(artKey()).toBe("city"));
    expect(tripOf(source).theme).toBe("city");
  });

  it("a double click on Save sends one write", async () => {
    const gate = deferred<void>();
    const calls = vi.fn();
    const { user } = setup("san-diego", (base) => ({
      ...base,
      setTheme: async (id, theme) => {
        calls(theme);
        await gate.promise;
        return base.setTheme(id, theme);
      },
    }));
    await ready();
    await user.click(changeButton());
    await user.click(screen.getByRole("radio", { name: "Home / family" }));
    await user.dblClick(screen.getByRole("button", { name: "Save theme" }));
    expect(calls).toHaveBeenCalledTimes(1);
    await act(async () => gate.resolve());
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("Cancel and Escape discard the choice and return focus to the button", async () => {
    const { user, source } = setup();
    await ready();
    const before = source.snapshot();
    await user.click(changeButton());
    await user.click(screen.getByRole("radio", { name: "Theme park" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(artKey()).toBe("beach");
    expect(document.activeElement).toBe(changeButton());
    await user.click(changeButton());
    // Reopened, it shows the saved theme again, not the discarded choice.
    expect((screen.getByRole("radio", { name: "Beach" }) as HTMLInputElement).checked).toBe(true);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(source.snapshot()).toBe(before);
  });

  it("saving without changing the theme just closes, with no write", async () => {
    const setTheme = vi.fn();
    const { user } = setup("san-diego", (base) => ({
      ...base,
      setTheme: (id, theme) => (setTheme(theme), base.setTheme(id, theme)),
    }));
    await ready();
    await user.click(changeButton());
    await user.click(screen.getByRole("button", { name: "Save theme" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(setTheme).not.toHaveBeenCalled();
  });

  it("a failed save keeps the sheet open and the old picture, says so in the sheet, and Save tries again", async () => {
    let fail = true;
    const { user, source } = setup("san-diego", (base) => ({
      ...base,
      setTheme: (id, theme) =>
        fail ? Promise.reject(new Error("nope")) : base.setTheme(id, theme),
    }));
    await ready();
    await user.click(changeButton());
    await user.click(screen.getByRole("radio", { name: "City" }));
    await user.click(screen.getByRole("button", { name: "Save theme" }));
    expect(await screen.findByRole("button", { name: "Not saved, retry" })).toBeTruthy();
    const sheet = screen.getByRole("dialog", { name: "Change theme" });
    // The chip is behind the sheet, so the sheet says so itself.
    expect(within(sheet).getByRole("alert").textContent).toMatch(/Couldn’t save the theme/);
    expect(artKey()).toBe("beach");
    expect(tripOf(source).theme).toBe("beach");
    fail = false;
    await user.click(within(sheet).getByRole("button", { name: "Save theme" }));
    await waitFor(() => expect(artKey()).toBe("city"));
    expect(tripOf(source).theme).toBe("city");
    expect(screen.queryByRole("dialog")).toBeNull();
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
    await user.click(within(row("sunglasses")).getByRole("button", { name: /^Sunglasses / }));
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
    await user.click(screen.getByRole("button", { name: "＋ Add a Bathroom item" }));
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

describe("the theme sheet's failure message", () => {
  it("is cleared as soon as Save is pressed again, while the retry is still pending", async () => {
    const gate = deferred<void>();
    let attempts = 0;
    const { user } = setup("san-diego", (base) => ({
      ...base,
      setTheme: async (id, theme) => {
        attempts += 1;
        if (attempts === 1) throw new Error("nope");
        await gate.promise;
        return base.setTheme(id, theme);
      },
    }));
    await ready();
    await user.click(screen.getByRole("button", { name: "Change theme" }));
    await user.click(screen.getByRole("radio", { name: "City" }));
    await user.click(screen.getByRole("button", { name: "Save theme" }));
    const sheet = screen.getByRole("dialog", { name: "Change theme" });
    expect((await within(sheet).findByRole("alert")).textContent).toMatch(
      /Couldn’t save the theme/,
    );
    await user.click(within(sheet).getByRole("button", { name: "Save theme" }));
    // The retry is in flight: the old message is gone and Save is waiting.
    expect(within(sheet).queryByRole("alert")).toBeNull();
    expect(within(sheet).getByRole("button", { name: "Save theme" }).hasAttribute("disabled")).toBe(
      true,
    );
    await act(async () => gate.resolve());
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("is also cleared when the sheet is closed, so reopening starts clean", async () => {
    const { user } = setup("san-diego", (base) => ({
      ...base,
      setTheme: () => Promise.reject(new Error("nope")),
    }));
    await ready();
    await user.click(screen.getByRole("button", { name: "Change theme" }));
    await user.click(screen.getByRole("radio", { name: "City" }));
    await user.click(screen.getByRole("button", { name: "Save theme" }));
    await within(screen.getByRole("dialog")).findByRole("alert");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(screen.getByRole("button", { name: "Change theme" }));
    expect(within(screen.getByRole("dialog")).queryByRole("alert")).toBeNull();
  });
});

describe("editing the stamp (#151)", () => {
  const stampName = () =>
    document.querySelector(".hero-stamps [role='img']")?.getAttribute("aria-label");
  const editButton = () => screen.getByRole("button", { name: "Edit stamp" });
  const toasts = () => document.querySelector(".toast-region") as HTMLElement;

  it("shows an Edit stamp link under the stamp that opens the Stamp label sheet and gives focus back on close", async () => {
    const { user } = setup();
    await ready();
    expect(document.querySelector(".hero-stamps")?.contains(editButton())).toBe(true);
    await user.click(editButton());
    const sheet = screen.getByRole("dialog", { name: "Stamp label" });
    expect(within(sheet).getByRole("group", { name: "Stamp 1, automatic" })).toBeTruthy();
    await user.click(within(sheet).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(editButton());
  });

  it("a custom label changes the stamp on the screen and is stored; the toast says Stamp updated", async () => {
    const { user, source } = setup();
    await ready();
    const automatic = stampName();
    await user.click(editButton());
    await user.click(screen.getByRole("radio", { name: "Custom" }));
    const field = screen.getByLabelText("Label");
    await user.clear(field);
    await user.type(field, "abc");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(stampName()).toContain("ABC");
    expect(stampName()).not.toBe(automatic);
    expect(tripOf(source).stampLabels).toEqual(["ABC", null]);
    expect(within(toasts()).getByText("Stamp updated.")).toBeTruthy();
    expect(document.activeElement).toBe(editButton());
  });

  it("Reset to automatic brings the derived label back, and the toast says so", async () => {
    const { user, source } = setup();
    await ready();
    const automatic = stampName();
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
    expect(stampName()).toBe(automatic);
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

describe("accessible names of a packing row", () => {
  it("the edit button is named by what it shows, including the Pack last badge", async () => {
    setup();
    await ready();
    const tops = within(row("tops")).getByRole("button", { name: /^Everyday tops / });
    expect(tops.textContent).toContain("Everyday tops");
    expect(tops.textContent).toContain("tap to edit");
    // Name from content: nothing in the name is missing from what is on screen.
    expect(tops.getAttribute("aria-label")).toBeNull();
    const toothbrush = within(row("last-toothbrush")).getByRole("button", { name: /^Toothbrush / });
    expect(toothbrush.textContent).toContain("Pack last");
    expect(toothbrush.getAttribute("aria-label")).toBeNull();
  });

  it("the packed count is readable, not hidden: '1 of 3 packed'", async () => {
    setup();
    await ready();
    expect(within(row("tops")).getByRole("img", { name: "1 of 3 packed" }).textContent).toBe(
      "1 of 3 packed",
    );
  });
});

describe("closing dialogs without saving", () => {
  const closeButton = () => screen.queryByRole("button", { name: "Close dialog" });

  it("the item editor, preferences and add-Bathroom-item sheets have a visible close that leaves everything unchanged", async () => {
    const { user, source } = setup();
    await ready();
    const before = source.snapshot();

    await user.click(within(row("tops")).getByRole("button", { name: /^Everyday tops / }));
    await user.click(closeButton() as HTMLElement);
    expect(screen.queryByRole("dialog")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Edit preferences" }));
    await user.click(closeButton() as HTMLElement);
    expect(screen.queryByRole("dialog")).toBeNull();

    await user.click(screen.getByRole("button", { name: "＋ Add a Bathroom item" }));
    await user.click(closeButton() as HTMLElement);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(source.snapshot()).toBe(before);
  });

  it("a remove confirmation with its own safe choice has no close button", async () => {
    const { user } = setup();
    await ready();
    await user.click(within(row("nice-shoes")).getByRole("button", { name: /^Dress shoes / }));
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
    await user.click(screen.getByRole("button", { name: "＋ Add a Bathroom item" }));
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
    await user.click(within(row("nice-shoes")).getByRole("button", { name: /^Dress shoes / }));
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
    await user.click(within(row("nice-shoes")).getByRole("button", { name: /^Dress shoes / }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Remove item" }),
    );
    await screen.findByRole("dialog", { name: "Remove Dress shoes?" });
    await user.click(screen.getByTestId("modal-backdrop"));
    expect(screen.getByRole("dialog", { name: "Remove Dress shoes?" })).toBeTruthy();
  });

  it("under Still to pack, the Toiletries section stays while the bag needs placing and says its contents are checked", async () => {
    const { user } = setup();
    await ready();
    for (const id of TOILETRIES)
      await user.click(within(row(id)).getByRole("button", { name: /^Pack all / }));
    await user.click(await screen.findByRole("button", { name: "Not yet" }));
    await user.click(screen.getByRole("button", { name: "Still to pack" }));
    expect(screen.getByRole("heading", { name: "Toiletries" })).toBeTruthy();
    expect(screen.getByText("All toiletry contents are checked.")).toBeTruthy();
  });

  it("omits the return outfit and Pack last sections when a trip has neither", async () => {
    const state = sampleLifecycleState();
    state.trips[0] = {
      ...state.trips[0],
      items: state.trips[0].items.filter((item) => item.section === "main"),
    };
    const base = createMemoryTripsSource(state, { now: () => 1 });
    renderInApp(
      <TripsSourceProvider source={base}>
        <TripScreen tripId="san-diego" />
      </TripsSourceProvider>,
    );
    await ready();
    expect(screen.queryByRole("heading", { name: "Return travel outfit" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Pack last" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Everyday & occasion items" })).toBeTruthy();
  });
});

describe("Ready is never revoked silently", () => {
  it("says why when unchecking an item takes a Ready trip back to packing", async () => {
    const { user, source } = setup("lisbon");
    await ready("Lisbon");
    expect(screen.getByText("Ready", { selector: ".status-pill" })).toBeTruthy();
    await user.click(
      within(row("tops")).getByRole("button", { name: "Packed, mark Everyday tops unpacked" }),
    );
    expect(await screen.findByText("No longer ready: an item was unchecked")).toBeTruthy();
    expect(tripOf(source, "lisbon").ready).toBe(false);
    expect(screen.queryByText("Ready", { selector: ".status-pill" })).toBeNull();
  });

  it("says nothing when a change leaves the trip as it was", async () => {
    const { user } = setup("san-diego");
    await ready();
    await user.click(within(row("tops")).getByRole("button", { name: "Pack all Everyday tops" }));
    await waitFor(() => expect(screen.getByText("Everyday tops 3 of 3 packed")).toBeTruthy());
    expect(screen.queryByText(/No longer ready/)).toBeNull();
  });
});

describe("the 'No longer ready' toast is for the change that revoked Ready, not later ones", () => {
  it("shows once, then stays quiet for the next change", async () => {
    const { user, source } = setup("lisbon");
    await ready("Lisbon");
    await user.click(
      within(row("tops")).getByRole("button", { name: "Packed, mark Everyday tops unpacked" }),
    );
    expect(await screen.findByText("No longer ready: an item was unchecked")).toBeTruthy();
    expect(tripOf(source, "lisbon").ready).toBe(false);
    // Let that toast expire, then change the (no longer Ready) trip twice more.
    await waitFor(() => expect(screen.queryByText(/No longer ready/)).toBeNull(), {
      timeout: 6000,
    });
    await user.click(within(row("tops")).getByRole("button", { name: "Pack all Everyday tops" }));
    await within(row("tops")).findByRole("button", { name: "Packed, mark Everyday tops unpacked" });
    await user.click(
      within(row("tops")).getByRole("button", { name: "Packed, mark Everyday tops unpacked" }),
    );
    await within(row("tops")).findByRole("button", { name: "Pack all Everyday tops" });
    expect(screen.queryByText(/No longer ready/)).toBeNull();
  }, 20_000);
});

describe("inline ＋ Add item (#147)", () => {
  const openForm = async (user: ReturnType<typeof userEvent.setup>) => {
    await ready();
    await user.click(screen.getByRole("button", { name: "＋ Add item" }));
  };

  it("adds an unpacked item of the chosen category and quantity, announces it, and folds the form away", async () => {
    const { user, source } = setup();
    await openForm(user);
    await user.type(screen.getByRole("textbox", { name: "Item name" }), "Camera");
    await user.selectOptions(screen.getByRole("combobox", { name: "Category" }), "Tech");
    await user.clear(screen.getByRole("spinbutton", { name: "Needed" }));
    await user.type(screen.getByRole("spinbutton", { name: "Needed" }), "2");
    await user.click(screen.getByRole("button", { name: "Add to list" }));
    await waitFor(() => expect(screen.queryByRole("textbox", { name: "Item name" })).toBeNull());
    const added = tripOf(source).items.find((entry) => entry.name === "Camera")!;
    expect(added).toMatchObject({ category: "Tech", qty: 2, packed: 0, section: "main" });
    expect(row(added.id)).toBeTruthy();
    expect(live().textContent).toBe("Camera added to Tech.");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "＋ Add item" }));
  });

  it("revokes Ready like every other item edit", async () => {
    const { user, source } = setup("lisbon");
    await ready("Lisbon");
    expect(tripOf(source, "lisbon").ready).toBe(true);
    await user.click(screen.getByRole("button", { name: "＋ Add item" }));
    await user.type(screen.getByRole("textbox", { name: "Item name" }), "Camera");
    await user.click(screen.getByRole("button", { name: "Add to list" }));
    await waitFor(() => expect(tripOf(source, "lisbon").ready).toBe(false));
  });

  it("never doubles an item already on the list: says so, and Edit quantity opens that item's editor", async () => {
    const { user, source } = setup();
    await openForm(user);
    const before = tripOf(source).items.length;
    const sunglasses = tripOf(source).items.find((entry) => entry.id === "sunglasses")!;
    await user.type(screen.getByRole("textbox", { name: "Item name" }), "  sunglasses ");
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Category" }),
      sunglasses.category,
    );
    await user.click(screen.getByRole("button", { name: "Add to list" }));
    expect(await screen.findByText(/Sunglasses is already on your list/)).toBeTruthy();
    expect(tripOf(source).items).toHaveLength(before);
    await user.click(screen.getByRole("button", { name: "Edit quantity" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit item" });
    expect((within(dialog).getByLabelText("Item name") as HTMLInputElement).value).toBe(
      "Sunglasses",
    );
  });

  it("hands Bathroom to the Bathroom form with the name and quantity filled in", async () => {
    const { user, source } = setup();
    await openForm(user);
    await user.type(screen.getByRole("textbox", { name: "Item name" }), "Floss");
    await user.selectOptions(screen.getByRole("combobox", { name: "Category" }), "Bathroom");
    await user.clear(screen.getByRole("spinbutton", { name: "Needed" }));
    await user.type(screen.getByRole("spinbutton", { name: "Needed" }), "2");
    await user.click(screen.getByRole("button", { name: "Continue to Bathroom item" }));
    const dialog = await screen.findByRole("dialog", { name: "Add a Bathroom item" });
    expect((within(dialog).getByLabelText("Item name") as HTMLInputElement).value).toBe("Floss");
    expect((within(dialog).getByLabelText("Quantity") as HTMLInputElement).value).toBe("2");
    expect(tripOf(source).items.some((entry) => entry.name === "Floss")).toBe(false);
    await user.click(within(dialog).getByRole("button", { name: "Add toiletry item" }));
    await waitFor(() =>
      expect(tripOf(source).items.some((entry) => entry.name === "Floss")).toBe(true),
    );
  });

  it("keeps the typed values and says nothing changed when the save fails", async () => {
    const { user, source } = setup("san-diego", (base) => ({
      ...base,
      addItem: () => Promise.reject(new Error("down")),
    }));
    await openForm(user);
    await user.type(screen.getByRole("textbox", { name: "Item name" }), "Camera");
    await user.click(screen.getByRole("button", { name: "Add to list" }));
    expect(await screen.findByText("Couldn’t add that item. Nothing was changed.")).toBeTruthy();
    expect((screen.getByRole("textbox", { name: "Item name" }) as HTMLInputElement).value).toBe(
      "Camera",
    );
    expect(tripOf(source).items.some((entry) => entry.name === "Camera")).toBe(false);
  });
});

describe("Save as a list (#169)", () => {
  const open = async (user: ReturnType<typeof userEvent.setup>) => {
    await ready();
    await user.click(screen.getByRole("button", { name: "Save as a list" }));
    return screen.getByRole("dialog", { name: "Save as a list" });
  };

  it("is a secondary action in the hero, next to Edit trip and Change theme", async () => {
    setup();
    await ready();
    const actions = screen.getByRole("button", { name: "Save as a list" }).closest(".head-actions");
    expect(within(actions as HTMLElement).getByRole("button", { name: "Edit trip" })).toBeTruthy();
    expect(
      within(actions as HTMLElement).getByRole("button", { name: "Change theme" }),
    ).toBeTruthy();
  });

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
    await user.click(screen.getByRole("button", { name: "Still to pack" }));
    await user.click(screen.getByRole("button", { name: "All items" }));
    expect(screen.queryByRole("dialog", { name: "Edit item" })).toBeNull();
  });

  it("puts focus on that item's Edit target button when the editor closes (it has no opener to return to)", async () => {
    const { user } = setup("san-diego", undefined, "sunglasses");
    await screen.findByRole("dialog", { name: "Edit item" });
    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(document.activeElement).toBe(
        within(row("sunglasses")).getByRole("button", { name: /^Edit target for Sunglasses/ }),
      ),
    );
  });

  it("also lands focus on the row after a save", async () => {
    const { user } = setup("san-diego", undefined, "sunglasses");
    const dialog = await screen.findByRole("dialog", { name: "Edit item" });
    await user.click(within(dialog).getByRole("button", { name: /^Save/ }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Edit item" })).toBeNull());
    await waitFor(() =>
      expect(document.activeElement).toBe(
        within(row("sunglasses")).getByRole("button", { name: /^Edit target for Sunglasses/ }),
      ),
    );
  });

  it("after a SAVE that finishes later, focus still lands on the item's Edit target once the updated row is mounted", async () => {
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
      expect(document.activeElement).toBe(
        within(row("sunglasses")).getByRole("button", { name: /^Edit target for Sunglasses/ }),
      ),
    );
  });

  it("falls back to the list heading when the item is gone after the editor closes (a Remove)", async () => {
    const { user } = setup("san-diego", undefined, "nice-shoes");
    const dialog = await screen.findByRole("dialog", { name: "Edit item" });
    await user.click(within(dialog).getByRole("button", { name: "Remove item" }));
    const confirm = await screen.findByRole("dialog", { name: "Remove Dress shoes?" });
    await user.click(within(confirm).getByRole("button", { name: "Remove item" }));
    await waitFor(() => expect(row("nice-shoes")).toBeNull());
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("heading", { name: "Packing list", level: 2 }),
      ),
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
