// @vitest-environment jsdom
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderInApp } from "@/test/providers";
import type { LifecycleState } from "@/domain/trip-lifecycle";
import { sampleLifecycleState } from "./fixtures";
import { TripsDashboard } from "./TripsDashboard";
import { createMemoryTripsSource, type TripsSource } from "./trips-source";

const push = vi.fn();
vi.mock("next/navigation", () => ({ usePathname: () => "/", useRouter: () => ({ push }) }));

const TODAY = () => "2026-10-16";

afterEach(() => window.history.replaceState(null, "", "/"));

function setup(
  initial: LifecycleState = sampleLifecycleState(),
  wrap?: (source: ReturnType<typeof memory>) => TripsSource,
) {
  const memorySource = memory(initial);
  const source = wrap ? wrap(memorySource) : memorySource;
  const user = userEvent.setup();
  const view = renderInApp(<TripsDashboard source={source} getToday={TODAY} />);
  return { user, source: memorySource, view };
}

function memory(initial: LifecycleState) {
  return createMemoryTripsSource(initial, { now: () => 5_000 });
}

/** A card in the Past & archive list. */
const card = (name: string) => screen.getByRole("article", { name });
/** The phone Home's luggage tag for the next trip. */
const tag = (name: string) => screen.getByRole("region", { name });
/** The tag's menu leads to the archive list (Recently deleted and Restore live there). */
async function openArchive(user: ReturnType<typeof userEvent.setup>) {
  await choose(user, "San Diego", "Past trips & archive");
}
/** San Diego already in the archive, so the Home has no next trip and its Past & archive tab is on screen. */
function archivedState(): LifecycleState {
  const state = sampleLifecycleState();
  state.trips = state.trips.map((trip) =>
    trip.id === "san-diego" ? { ...trip, archived: true } : trip,
  );
  return state;
}
/** Open a trip's ⋯ menu and choose one item (the Field Ledger dashboard keeps these actions behind it, #155). */
async function choose(user: ReturnType<typeof userEvent.setup>, trip: string, item: string) {
  await user.click(screen.getByRole("button", { name: `More actions for ${trip}` }));
  await user.click(screen.getByRole("menuitem", { name: item }));
}
const tab = (name: RegExp) => screen.getByRole("button", { name });

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function ready() {
  await screen.findByRole("heading", { name: "San Diego" });
}

describe("loading and errors", () => {
  it("shows two skeleton cards (no spinner) with the title and Plan a trip visible, then the trips", async () => {
    const gate = deferred<LifecycleState>();
    const base = memory(sampleLifecycleState());
    const source: TripsSource = { ...base, load: () => gate.promise };
    const view = renderInApp(<TripsDashboard source={source} getToday={TODAY} />);
    const region = screen.getByRole("region", { name: "Loading trips" });
    expect(region.getAttribute("aria-busy")).toBe("true");
    expect(view.container.querySelectorAll(".skeleton-card")).toHaveLength(2);
    expect(screen.getByRole("heading", { name: "Trips", level: 1 })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Plan a trip" }).getAttribute("href")).toBe(
      "/trips/new",
    );
    await act(async () => gate.resolve(await base.load()));
    await ready();
    expect(screen.queryByRole("region", { name: "Loading trips" })).toBeNull();
  });

  it("a slow initial load keeps the chip quiet and announces nothing about saving", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const gate = deferred<LifecycleState>();
      const base = memory(sampleLifecycleState());
      renderInApp(
        <TripsDashboard source={{ ...base, load: () => gate.promise }} getToday={TODAY} />,
      );
      act(() => vi.advanceTimersByTime(5000));
      expect(screen.queryByRole("link", { name: "Saved" })).toBeNull();
      expect(screen.getByRole("status", { name: "Save status" }).textContent).toBe("");
      expect(screen.queryByText("Saving…")).toBeNull();
      // findBy* polls on setTimeout, which is faked here, so flush with act and query synchronously.
      await act(async () => gate.resolve(await base.load()));
      await act(async () => {});
      expect(screen.getByRole("heading", { name: "San Diego" })).toBeTruthy();
      expect(screen.queryByRole("link", { name: "Saved" })).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("after a failed load, Retry with a slow load never says Saving and returns to quiet idle", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const gate = deferred<LifecycleState>();
      const base = memory(sampleLifecycleState());
      const load = vi
        .fn()
        .mockRejectedValueOnce(new Error("down"))
        .mockImplementation(() => gate.promise);
      renderInApp(<TripsDashboard source={{ ...base, load }} getToday={TODAY} />);
      await act(async () => {});
      expect(screen.getByText("Couldn’t load your trips.")).toBeTruthy();
      const chip = screen.getByRole("button", { name: "Not saved, retry" });
      act(() => chip.click());
      act(() =>
        within(screen.getByRole("dialog", { name: "Couldn’t save" }))
          .getByRole("button", { name: "Retry" })
          .click(),
      );
      expect(load).toHaveBeenCalledTimes(2);
      const everSaid: string[] = [];
      for (let waited = 0; waited < 2000; waited += 100) {
        act(() => vi.advanceTimersByTime(100));
        everSaid.push(
          document.querySelector(".sync-chip")?.textContent ?? "",
          screen.getByRole("status", { name: "Save status" }).textContent ?? "",
        );
      }
      expect(everSaid.join("|")).not.toMatch(/Saving/);
      await act(async () => gate.resolve(await base.load()));
      await act(async () => {});
      expect(screen.getByRole("heading", { name: "San Diego" })).toBeTruthy();
      expect(screen.queryByRole("link", { name: "Saved" })).toBeNull();
      expect(screen.getByRole("status", { name: "Save status" }).textContent).toBe("");
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows 'Couldn't load your trips.' with Try again, the Error chip, and recovers", async () => {
    const base = memory(sampleLifecycleState());
    const load = vi
      .fn()
      .mockRejectedValueOnce(new Error("down"))
      .mockImplementation(() => base.load());
    const { user } = setup(undefined, () => ({ ...base, load }));
    expect(await screen.findByText("Couldn’t load your trips.")).toBeTruthy();
    expect(screen.getByText("Nothing was changed.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Not saved, retry" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    await ready();
    expect(load).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("link", { name: "Saved" })).toBeNull();
  });

  it("the chip's Retry also reloads after a failed load", async () => {
    const base = memory(sampleLifecycleState());
    const load = vi
      .fn()
      .mockRejectedValueOnce(new Error("down"))
      .mockImplementation(() => base.load());
    const { user } = setup(undefined, () => ({ ...base, load }));
    await screen.findByText("Couldn’t load your trips.");
    await user.click(screen.getByRole("button", { name: "Not saved, retry" }));
    await user.click(
      within(screen.getByRole("dialog", { name: "Couldn’t save" })).getByRole("button", {
        name: "Retry",
      }),
    );
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
  });

  it("ignores a load that finishes after unmount", async () => {
    const gate = deferred<LifecycleState>();
    const base = memory(sampleLifecycleState());
    const view = renderInApp(
      <TripsDashboard source={{ ...base, load: () => gate.promise }} getToday={TODAY} />,
    );
    view.unmount();
    await act(async () => gate.resolve(await base.load()));
    const failing = deferred<LifecycleState>();
    const second = renderInApp(
      <TripsDashboard source={{ ...base, load: () => failing.promise }} getToday={TODAY} />,
    );
    second.unmount();
    await act(async () => failing.reject(new Error("late")));
  });

  it("works with the default clock (today comes from the device date)", async () => {
    const user = userEvent.setup();
    renderInApp(<TripsDashboard source={memory(sampleLifecycleState())} />);
    expect(user).toBeTruthy();
    // The sample trips are past on the real date, so there is no next trip and the returning Home shows.
    expect(await screen.findByRole("heading", { name: "Trips", level: 1 })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Where to next?" })).toBeTruthy();
  });
});

describe("upcoming view", () => {
  it("renders the luggage tag and the Pack panel with truthful details and no sample copy", async () => {
    const { user } = setup();
    await ready();
    const sanDiego = tag("San Diego");
    expect(within(sanDiego).getByText(/NEXT TRIP · 23–27 Oct · 4 nights/)).toBeTruthy();
    expect(within(sanDiego).getByText("7 days to go")).toBeTruthy();
    // The pills carry quantity counts, and the first panel is open.
    expect(
      within(screen.getByRole("tablist", { name: "Trip sections" }))
        .getAllByRole("tab")
        .map((pill) => pill.textContent),
    ).toEqual(["Pack 6/32", "Weather N/A", "Future 0 trips", "Stamps 1"]);
    expect(screen.getByRole("tab", { name: /^Pack/ }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("heading", { name: /in the bag/ }).textContent).toBe(
      "6 / 32 in the bag",
    );
    expect(
      screen.getByRole("link", { name: "Continue packing: San Diego" }).getAttribute("href"),
    ).toMatch(/^\/trips\/san-diego(\?cube=\w+)?$/);

    // Edit trip, Copy trip, Archive, the archive list and Remove live in the tag's menu.
    await user.click(screen.getByRole("button", { name: "More actions for San Diego" }));
    const menu = screen.getByRole("menu", { name: "Actions for San Diego" });
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((item) => item.textContent),
    ).toEqual(["Edit trip", "Copy trip", "Archive", "Past trips & archive", "Remove"]);
    expect(within(menu).getByRole("menuitem", { name: "Copy trip" }).getAttribute("href")).toBe(
      "/trips/new?copy=san-diego",
    );
    await user.keyboard("{Escape}");
    expect(screen.getByRole("button", { name: "More actions for San Diego" })).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/sample|Sample/);
    expect(screen.queryByText(/Illustrative/)).toBeNull();
  });

  it("does not show Recently deleted on the Upcoming tab (it belongs to Past & archive only)", async () => {
    const { user } = setup();
    await ready();
    expect(screen.queryByRole("heading", { name: "Recently deleted" })).toBeNull();
    expect(screen.queryByText("Nothing recently deleted.")).toBeNull();
    await openArchive(user);
    expect(screen.getByRole("heading", { name: "Recently deleted" })).toBeTruthy();
    await user.click(tab(/Upcoming/));
    expect(screen.queryByRole("heading", { name: "Recently deleted" })).toBeNull();
  });

  it("has no ledger heading: the Future pill counts the trips after the next one and links to Plan a trip", async () => {
    const { user } = setup();
    await ready();
    expect(screen.getByRole("heading", { name: "Trips", level: 1 })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Your travel ledger" })).toBeNull();
    await user.click(screen.getByRole("tab", { name: /^Future/ }));
    expect(screen.getByRole("link", { name: "Plan a trip" }).getAttribute("href")).toBe(
      "/trips/new",
    );
    expect(screen.queryByText("Lisbon")).toBeNull();
  });

  it("omits place and forecast for a destination without a confirmed location", async () => {
    const state = sampleLifecycleState();
    state.trips = [
      state.trips[0],
      {
        ...state.trips[0],
        id: "typed",
        destination: "Somewhere typed",
        name: "Somewhere typed",
        location: null,
        start: "2026-11-01",
        end: "2026-11-04",
      },
    ];
    const { user } = setup(state);
    await ready();
    await user.click(screen.getByRole("tab", { name: /^Future/ }));
    const typed = screen.getByRole("link", { name: /Somewhere typed/ });
    expect(within(typed).queryByText(/Simulated/)).toBeNull();
    expect(within(typed).queryByText(/United States/)).toBeNull();
    expect(within(typed).getByText("01 NOV")).toBeTruthy();
  });
});

describe("past & archive view", () => {
  it("shows past trips by date, no Archive or Restore for them, and an empty Recently deleted", async () => {
    const { user } = setup();
    await ready();
    await openArchive(user);
    expect(screen.getByRole("heading", { name: "Past trips & archive", level: 1 })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Your travel ledger" })).toBeNull();
    const lisbon = card("Lisbon");
    expect(within(lisbon).getByText("Past trip")).toBeTruthy();
    expect(within(lisbon).getByText("Marked Ready")).toBeTruthy();
    expect(within(lisbon).queryByText("Ready to go")).toBeNull();
    expect(within(lisbon).queryByText(/Simulated/)).toBeNull();
    expect(within(lisbon).getByRole("link", { name: "Review bag: Lisbon" })).toBeTruthy();
    expect(within(lisbon).queryByRole("button", { name: /Archive|Restore/ })).toBeNull();
    expect(screen.getByText("Nothing recently deleted.")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/\d+ days? (?:ago|retention)|30 days/i);
  });

  it("shows empty states for no upcoming and no past trips", async () => {
    const empty = sampleLifecycleState();
    empty.trips = [];
    const first = setup(empty);
    expect(await screen.findByRole("heading", { name: /^Where to (first|next)\?$/ })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Where to first?" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "+ Plan a trip" }).getAttribute("href")).toBe(
      "/trips/new",
    );
    // With nothing archived or removed there is no history to open from here.
    expect(screen.queryByRole("button", { name: "Past & archive" })).toBeNull();
    empty.deletedTrips = [{ trip: sampleLifecycleState().trips[0], deletedAt: 1 }];
    first.view.unmount();
    const again = setup(empty);
    await again.user.click(await screen.findByRole("button", { name: "Past & archive" }));
    expect(screen.getByText("No past or archived trips yet.")).toBeTruthy();
    expect(screen.getByText(/Archived trips and trips whose return date has passed/)).toBeTruthy();
  });
});

describe("archive and restore", () => {
  it("archive moves the trip to Past & archive, restore brings it back to Upcoming", async () => {
    const { user, source } = setup();
    await ready();
    await choose(user, "San Diego", "Archive");
    await waitFor(() => expect(screen.queryByRole("heading", { name: "San Diego" })).toBeNull());
    expect(screen.getByRole("heading", { name: /^Where to (first|next)\?$/ })).toBeTruthy();
    expect(source.snapshot().trips.find((t) => t.id === "san-diego")?.archived).toBe(true);

    await user.click(tab(/Past & archive/));
    expect(tab(/Upcoming/).textContent).toContain("0");
    expect(tab(/Past & archive/).textContent).toContain("2");
    const archived = card("San Diego");
    expect(within(archived).getByText("Archived trip")).toBeTruthy();
    expect(within(archived).queryByRole("button", { name: /Archive:/ })).toBeNull();
    await user.click(within(archived).getByRole("button", { name: "Restore: San Diego" }));
    await waitFor(() => expect(screen.queryByRole("heading", { name: "San Diego" })).toBeNull());

    await user.click(tab(/Upcoming/));
    expect(tag("San Diego")).toBeTruthy();
    expect(source.snapshot().trips.find((t) => t.id === "san-diego")?.archived).toBe(false);
  });

  it("moves focus to the list heading after an action so focus is not lost", async () => {
    const { user } = setup();
    await ready();
    await choose(user, "San Diego", "Archive");
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Trips", level: 1 })),
    );
  });

  it("disables that card's actions while saving and changes nothing until the source confirms", async () => {
    const gate = deferred<LifecycleState>();
    const { user, source } = setup(undefined, (base) => ({ ...base, archive: () => gate.promise }));
    await ready();
    await choose(user, "San Diego", "Archive");
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(
      (screen.getByRole("button", { name: "More actions for San Diego" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(source.snapshot().trips.find((t) => t.id === "san-diego")?.archived).toBe(false);
    await act(async () => gate.resolve(await source.archive("san-diego")));
    await waitFor(() => expect(screen.queryByRole("heading", { name: "San Diego" })).toBeNull());
  });

  it("keeps the card, re-enables its buttons and shows the Error chip when saving fails; Retry then succeeds", async () => {
    const { user } = setup(undefined, (base) => ({
      ...base,
      archive: vi
        .fn()
        .mockRejectedValueOnce(new Error("nope"))
        .mockImplementation((id: string) => base.archive(id)),
    }));
    await ready();
    await choose(user, "San Diego", "Archive");
    await screen.findByRole("button", { name: "Not saved, retry" });
    expect(tag("San Diego")).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "More actions for San Diego" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
    await user.click(screen.getByRole("button", { name: "Not saved, retry" }));
    await user.click(
      within(screen.getByRole("dialog", { name: "Couldn’t save" })).getByRole("button", {
        name: "Retry",
      }),
    );
    await waitFor(() => expect(screen.queryByRole("heading", { name: "San Diego" })).toBeNull());
    expect(screen.getByRole("link", { name: "Saved" })).toBeTruthy();
  });
});

describe("remove, confirm and undo", () => {
  it("asks first with the safe button focused, and Cancel changes nothing", async () => {
    const { user, source } = setup();
    await ready();
    const before = source.snapshot();
    await choose(user, "San Diego", "Remove");
    const dialog = screen.getByRole("dialog", { name: "Remove San Diego?" });
    expect(within(dialog).getByText(/moves to Recently deleted/)).toBeTruthy();
    expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "Cancel" }));
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(source.snapshot()).toBe(before);
  });

  it("Escape closes the dialog without removing anything", async () => {
    const { user, source } = setup();
    await ready();
    const before = source.snapshot();
    await choose(user, "San Diego", "Remove");
    expect(screen.getByRole("dialog")).toBeTruthy();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(source.snapshot()).toBe(before);
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "More actions for San Diego" }),
    );
  });

  it("remove -> confirm -> undo restores the identical trip", async () => {
    const { user, source } = setup();
    await ready();
    const original = structuredClone(source.snapshot().trips.find((t) => t.id === "san-diego"));
    await choose(user, "San Diego", "Remove");
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Remove trip" }),
    );
    await waitFor(() => expect(screen.queryByRole("heading", { name: "San Diego" })).toBeNull());
    expect(screen.queryByRole("dialog")).toBeNull();
    const toast = document.querySelector(".toast-region") as HTMLElement;
    expect(within(toast).getByText("San Diego removed")).toBeTruthy();
    await user.click(within(toast).getByRole("button", { name: "Undo" }));
    expect(await screen.findByRole("heading", { name: "San Diego" })).toBeTruthy();
    expect(within(toast).getByText("San Diego restored")).toBeTruthy();
    expect(source.snapshot().trips.find((t) => t.id === "san-diego")).toEqual(original);
    expect(source.snapshot().deletedTrips).toEqual([]);
  });

  it("lists the removed trip under Recently deleted, where Undo remove brings it back", async () => {
    const { user, source } = setup();
    await ready();
    await choose(user, "San Diego", "Remove");
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Remove trip" }),
    );
    await waitFor(() => expect(screen.queryByRole("heading", { name: "San Diego" })).toBeNull());
    await user.click(tab(/Past & archive/));
    const row = screen
      .getByRole("button", { name: "Undo remove: San Diego" })
      .closest(".archive-row") as HTMLElement;
    expect(within(row).getByText("Oct 23 – Oct 27")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Undo remove: San Diego" }));
    await waitFor(() => expect(screen.getByText("Nothing recently deleted.")).toBeTruthy());
    expect(source.snapshot().trips.map((t) => t.id)).toContain("san-diego");
    await user.click(tab(/Upcoming/));
    expect(tag("San Diego")).toBeTruthy();
  });

  it("keeps the trip and shows no Undo toast when removing fails", async () => {
    const { user } = setup(undefined, (base) => ({
      ...base,
      remove: () => Promise.reject(new Error("nope")),
    }));
    await ready();
    await choose(user, "San Diego", "Remove");
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Remove trip" }),
    );
    await screen.findByRole("button", { name: "Not saved, retry" });
    expect(tag("San Diego")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
  });

  it("does not announce a restore when the undo itself fails", async () => {
    const { user } = setup(undefined, (base) => ({
      ...base,
      undoRemove: () => Promise.reject(new Error("nope")),
    }));
    await ready();
    await choose(user, "San Diego", "Remove");
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Remove trip" }),
    );
    await user.click(await screen.findByRole("button", { name: "Undo" }));
    await screen.findByRole("button", { name: "Not saved, retry" });
    expect(screen.queryByText("San Diego restored")).toBeNull();
  });
});

describe("quick view (on the Past & archive cards)", () => {
  async function openQuick(user: ReturnType<typeof userEvent.setup>, trip = "San Diego") {
    await user.click(tab(/Past & archive/));
    await user.click(within(card(trip)).getByRole("button", { name: /Quick view/ }));
    return document.getElementById(
      `quick-view-${trip === "San Diego" ? "san-diego" : "lisbon"}`,
    ) as HTMLElement;
  }

  it("is collapsed by default and the ⋯ menu toggles it, with the menu item saying what it will do", async () => {
    const { user } = setup(archivedState());
    await screen.findByRole("heading", { name: /^Where to (first|next)\?$/ });
    await user.click(tab(/Past & archive/));
    expect(document.getElementById("quick-view-san-diego")).toBeNull();
    await user.click(within(card("San Diego")).getByRole("button", { name: /Quick view/ }));
    expect(document.getElementById("quick-view-san-diego")).not.toBeNull();
    await user.click(within(card("San Diego")).getByRole("button", { name: /Quick view/ }));
    expect(document.getElementById("quick-view-san-diego")).toBeNull();
  });

  it("filters Still to pack / All and never mutates or writes anything", async () => {
    const base = memory(archivedState());
    const writes = {
      archive: vi.spyOn(base, "archive"),
      restore: vi.spyOn(base, "restore"),
      remove: vi.spyOn(base, "remove"),
      undoRemove: vi.spyOn(base, "undoRemove"),
    };
    const user = userEvent.setup();
    renderInApp(<TripsDashboard source={base} getToday={TODAY} />);
    await screen.findByRole("heading", { name: /^Where to (first|next)\?$/ });
    const before = base.snapshot();
    const beforeJson = JSON.stringify(before);

    const quick = await openQuick(user);
    expect(within(quick).getByText("Read-only preview")).toBeTruthy();
    // Its list scrolls, so it must be reachable and named for keyboard and screen-reader users.
    const list = within(quick).getByRole("region", { name: "Quick view items" });
    expect(list.getAttribute("tabindex")).toBe("0");
    expect(
      within(quick).getByRole("button", { name: "Still to pack" }).getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      within(quick).getByRole("group", { name: "Quick view filter for San Diego" }),
    ).toBeTruthy();
    expect(within(quick).queryByText("Sleepwear")).toBeNull();
    expect(within(quick).getAllByText("Underwear")[0].parentElement?.textContent).toContain(
      "3 left",
    );

    await user.click(within(quick).getByRole("button", { name: "All" }));
    expect(within(quick).getByRole("button", { name: "All" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(within(quick).getByText("Sleepwear").parentElement?.textContent).toContain("Packed");
    await user.click(within(quick).getByRole("button", { name: "Still to pack" }));

    expect(base.snapshot()).toBe(before);
    expect(JSON.stringify(base.snapshot())).toBe(beforeJson);
    for (const spy of Object.values(writes)) expect(spy).not.toHaveBeenCalled();
    expect(screen.queryByRole("link", { name: "Saved" })).toBeNull();
  });

  it("announces the result count politely, with singular wording", async () => {
    const state = archivedState();
    state.trips = state.trips.map((trip) =>
      trip.id === "san-diego"
        ? { ...trip, items: trip.items.filter((item) => item.id === "underwear") }
        : trip,
    );
    const { user } = setup(state);
    await screen.findByRole("heading", { name: /^Where to (first|next)\?$/ });
    await openQuick(user);
    expect(screen.getByRole("status", { name: "Quick view result count" }).textContent).toBe(
      "1 item shown",
    );
    await user.click(screen.getByRole("button", { name: "All" }));
    expect(screen.getByRole("status", { name: "Quick view result count" }).textContent).toBe(
      "1 item shown",
    );
  });

  it("says so when nothing is left in the view, and shows the bag gate and a link to the full list", async () => {
    const { user } = setup();
    await ready();
    await openArchive(user);
    await user.click(within(card("Lisbon")).getByRole("button", { name: /Quick view/ }));
    const quick = document.getElementById("quick-view-lisbon") as HTMLElement;
    expect(within(quick).getByText("No items left in this view.")).toBeTruthy();
    expect(within(quick).getByText("In suitcase")).toBeTruthy();
    expect(within(quick).getByText("Toiletry bag placement")).toBeTruthy();
    expect(within(quick).getByRole("link", { name: "View full list" }).getAttribute("href")).toBe(
      "/trips/lisbon",
    );
    await user.click(within(quick).getByRole("button", { name: "All" }));
    expect(within(quick).getAllByText("Packed").length).toBeGreaterThan(5);
    expect(within(quick).queryByText("No items left in this view.")).toBeNull();
  });

  it("flags Pack last rows in the quick view", async () => {
    const { user } = setup(archivedState());
    await screen.findByRole("heading", { name: /^Where to (first|next)\?$/ });
    const quick = await openQuick(user);
    const laptop = within(quick).getByText("Laptop").closest(".quick-view-row") as HTMLElement;
    expect(within(laptop).getByText("Pack last")).toBeTruthy();
  });
});

describe("the Home with no trip coming up (#409)", () => {
  const SEATTLE = {
    location: {
      id: "us-wa-seattle",
      city: "Seattle",
      region: "Washington",
      country: "United States",
      countryCode: "US",
      label: "Seattle, Washington, United States",
    },
  };
  const NUDGE = /Set your home city so trips know/;
  const emptyState = () => ({ ...sampleLifecycleState(), trips: [] });
  const sourceWith = (state: LifecycleState, homeCity: typeof SEATTLE | null) =>
    createMemoryTripsSource(state, { now: () => 5_000, homeCity });

  it("is the first-run welcome with the nudge while the account has no home city", async () => {
    renderInApp(<TripsDashboard source={sourceWith(emptyState(), null)} getToday={TODAY} />);
    expect(await screen.findByRole("heading", { name: "Where to first?" })).toBeTruthy();
    expect(await screen.findByRole("link", { name: NUDGE })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Your travel ledger" })).toBeNull();
  });

  it("leaves the nudge out once a home city is set", async () => {
    renderInApp(<TripsDashboard source={sourceWith(emptyState(), SEATTLE)} getToday={TODAY} />);
    await screen.findByRole("heading", { name: "Where to first?" });
    await act(async () => undefined);
    expect(screen.queryByRole("link", { name: NUDGE })).toBeNull();
  });

  it("shows no nudge when the home city cannot be read, or the source has none", async () => {
    const failing = {
      ...sourceWith(emptyState(), null),
      homeCity: () => Promise.reject(new Error("x")),
    };
    const first = renderInApp(<TripsDashboard source={failing} getToday={TODAY} />);
    await screen.findByRole("heading", { name: "Where to first?" });
    await act(async () => undefined);
    expect(screen.queryByRole("link", { name: NUDGE })).toBeNull();
    first.unmount();
    const { homeCity: _omitted, ...without } = sourceWith(emptyState(), null);
    void _omitted;
    renderInApp(<TripsDashboard source={without} getToday={TODAY} />);
    await screen.findByRole("heading", { name: "Where to first?" });
    expect(screen.queryByRole("link", { name: NUDGE })).toBeNull();
  });

  it("never holds the trip list behind the home-city read", async () => {
    const gate = deferred<typeof SEATTLE | null>();
    const reads = vi.fn(() => gate.promise);
    const source = { ...sourceWith(sampleLifecycleState(), null), homeCity: reads };
    renderInApp(<TripsDashboard source={source} getToday={TODAY} />);
    // The trips render while the read is still pending; with a trip to show it is not even asked.
    expect(await screen.findByRole("heading", { name: "San Diego" })).toBeTruthy();
    expect(reads).not.toHaveBeenCalled();
    gate.resolve(null);
  });

  it("asks for the home city only after the trips loaded, and shows the list-first Home meanwhile", async () => {
    const trips = deferred<LifecycleState>();
    const gate = deferred<typeof SEATTLE | null>();
    const base = sourceWith(emptyState(), null);
    const reads = vi.fn(() => gate.promise);
    const source = { ...base, load: () => trips.promise, homeCity: reads };
    renderInApp(<TripsDashboard source={source} getToday={TODAY} />);
    await act(async () => undefined);
    expect(reads).not.toHaveBeenCalled();
    trips.resolve(emptyState());
    expect(await screen.findByRole("heading", { name: "Where to first?" })).toBeTruthy();
    expect(reads).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("link", { name: NUDGE })).toBeNull();
    gate.resolve(null);
    expect(await screen.findByRole("link", { name: NUDGE })).toBeTruthy();
  });

  it("is the returning welcome once every trip is behind it, with the archive one tap away", async () => {
    const state = sampleLifecycleState();
    state.trips = state.trips.filter((trip) => trip.id === "lisbon");
    state.deletedTrips = [{ trip: sampleLifecycleState().trips[0], deletedAt: 1 }];
    const { user } = setup(state);
    expect(await screen.findByRole("heading", { name: "Where to next?" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Recent trips" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Past & archive" }));
    expect(screen.getByRole("heading", { name: "Recently deleted" })).toBeTruthy();
  });
});
