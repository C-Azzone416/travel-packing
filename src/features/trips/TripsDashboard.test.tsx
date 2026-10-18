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

const card = (name: string) => screen.getByRole("article", { name });
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
  it("shows two skeleton cards (no spinner) with the title and New trip visible, then the trips", async () => {
    const gate = deferred<LifecycleState>();
    const base = memory(sampleLifecycleState());
    const source: TripsSource = { ...base, load: () => gate.promise };
    const view = renderInApp(<TripsDashboard source={source} getToday={TODAY} />);
    const region = screen.getByRole("region", { name: "Loading trips" });
    expect(region.getAttribute("aria-busy")).toBe("true");
    expect(view.container.querySelectorAll(".skeleton-card")).toHaveLength(2);
    expect(screen.getByRole("heading", { name: "Trips", level: 1 })).toBeTruthy();
    expect(screen.getByRole("link", { name: "New trip" }).getAttribute("href")).toBe("/trips/new");
    await act(async () => gate.resolve(await base.load()));
    await ready();
    expect(screen.queryByRole("region", { name: "Loading trips" })).toBeNull();
  });

  it("a slow initial load leaves the chip on Saved and announces nothing about saving", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const gate = deferred<LifecycleState>();
      const base = memory(sampleLifecycleState());
      renderInApp(
        <TripsDashboard source={{ ...base, load: () => gate.promise }} getToday={TODAY} />,
      );
      act(() => vi.advanceTimersByTime(5000));
      expect(screen.getByRole("link", { name: "Saved" })).toBeTruthy();
      expect(screen.getByRole("status", { name: "Save status" }).textContent).toBe("Saved");
      expect(screen.queryByText("Saving…")).toBeNull();
      // findBy* polls on setTimeout, which is faked here, so flush with act and query synchronously.
      await act(async () => gate.resolve(await base.load()));
      await act(async () => {});
      expect(screen.getByRole("heading", { name: "San Diego" })).toBeTruthy();
      expect(screen.getByRole("link", { name: "Saved" })).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("after a failed load, the chip's Retry with a slow load never says or announces Saving, ends on Saved, and the trips render", async () => {
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
      const chip = screen.getByRole("button", { name: "Couldn't save, retry" });
      act(() => chip.click());
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
      expect(screen.getByRole("link", { name: "Saved" })).toBeTruthy();
      expect(screen.getByRole("status", { name: "Save status" }).textContent).toBe("Saved");
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
    expect(screen.getByRole("button", { name: "Couldn't save, retry" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    await ready();
    expect(load).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("link", { name: "Saved" })).toBeTruthy();
  });

  it("the chip's Retry also reloads after a failed load", async () => {
    const base = memory(sampleLifecycleState());
    const load = vi
      .fn()
      .mockRejectedValueOnce(new Error("down"))
      .mockImplementation(() => base.load());
    const { user } = setup(undefined, () => ({ ...base, load }));
    await screen.findByText("Couldn’t load your trips.");
    await user.click(screen.getByRole("button", { name: "Couldn't save, retry" }));
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
    expect(await screen.findByRole("heading", { name: "Where are we going?" })).toBeTruthy();
  });
});

describe("upcoming view", () => {
  it("renders the upcoming trip card with truthful details and no sample copy", async () => {
    setup();
    await ready();
    const sanDiego = card("San Diego");
    expect(within(sanDiego).getByText("California, United States")).toBeTruthy();
    expect(within(sanDiego).getByText(/Oct 23 – Oct 27/)).toBeTruthy();
    expect(within(sanDiego).getByText("5 days")).toBeTruthy();
    expect(within(sanDiego).getByText("Close forecast · Simulated")).toBeTruthy();
    expect(within(sanDiego).getByText("24 left to pack")).toBeTruthy();
    expect(within(sanDiego).getByText("6 of 30 packed")).toBeTruthy();
    const bar = within(sanDiego).getByRole("progressbar", { name: "San Diego packing progress" });
    expect(bar.getAttribute("aria-valuenow")).toBe("20");
    expect(bar.getAttribute("aria-valuetext")).toBe("20% packed");
    expect(
      within(sanDiego).getByRole("link", { name: "Keep packing: San Diego" }).getAttribute("href"),
    ).toBe("/trips/san-diego");
    expect(
      within(sanDiego).getByRole("link", { name: "Copy trip: San Diego" }).getAttribute("href"),
    ).toBe("/trips/new?copy=san-diego");
    expect(within(sanDiego).getByRole("button", { name: "Archive: San Diego" })).toBeTruthy();
    expect(within(sanDiego).getByRole("button", { name: "Remove: San Diego" })).toBeTruthy();
    expect(within(sanDiego).queryByText(/Upcoming trip|Past trip|Archived trip/)).toBeNull();
    expect(document.body.textContent).not.toMatch(/sample|Sample/);
    expect(screen.queryByText(/Illustrative/)).toBeNull();
  });

  it("does not show Recently deleted on the Upcoming tab (it belongs to Past & archive only)", async () => {
    const { user } = setup();
    await ready();
    expect(screen.queryByRole("heading", { name: "Recently deleted" })).toBeNull();
    expect(screen.queryByText("Nothing recently deleted.")).toBeNull();
    await user.click(tab(/Past & archive/));
    expect(screen.getByRole("heading", { name: "Recently deleted" })).toBeTruthy();
    await user.click(tab(/Upcoming/));
    expect(screen.queryByRole("heading", { name: "Recently deleted" })).toBeNull();
  });

  it("shows the hero with a New trip link and the tab counts", async () => {
    setup();
    await ready();
    expect(
      screen.getByRole("heading", { name: "Pack for the trip, not the anxiety." }),
    ).toBeTruthy();
    expect(screen.getByRole("link", { name: /New trip/ }).getAttribute("href")).toBe("/trips/new");
    expect(tab(/Upcoming/).textContent).toContain("1");
    expect(tab(/Past & archive/).textContent).toContain("1");
    expect(tab(/Upcoming/).getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByText("Lisbon")).toBeNull();
  });

  it("omits place and forecast for a destination without a confirmed location, and loads only the first card's art eagerly", async () => {
    const state = sampleLifecycleState();
    state.trips = [
      state.trips[0],
      {
        ...state.trips[0],
        id: "typed",
        destination: "Somewhere typed",
        location: null,
        start: "2026-11-01",
        end: "2026-11-04",
      },
    ];
    const { view } = setup(state);
    await ready();
    const typed = card("Somewhere typed");
    expect(within(typed).queryByText(/Simulated/)).toBeNull();
    expect(within(typed).queryByText(/United States/)).toBeNull();
    // The picture is the trip's theme (inherited here from the San Diego row it was copied from), never its place.
    expect(typed.querySelector("[data-art-key]")?.getAttribute("data-art-key")).toBe("beach");
    const [first, second] = [...view.container.querySelectorAll("article img")];
    expect(first.getAttribute("loading")).toBe("eager");
    expect(second.getAttribute("loading")).toBe("lazy");
  });
});

describe("trip themes on cards", () => {
  it("each card shows its trip's theme art, and a trip's theme is the only thing that picks it", async () => {
    const state = sampleLifecycleState();
    state.trips = state.trips.map((trip) =>
      trip.id === "san-diego" ? { ...trip, theme: "theme_park" as const } : trip,
    );
    setup(state);
    await ready();
    const sanDiego = card("San Diego");
    expect(sanDiego.querySelector("[data-art-key]")?.getAttribute("data-art-key")).toBe(
      "theme_park",
    );
    expect(sanDiego.querySelector("img")?.getAttribute("src")).toBe("/themes/theme_park.svg");
  });
});

describe("past & archive view", () => {
  it("shows past trips by date, no Archive or Restore for them, and an empty Recently deleted", async () => {
    const { user } = setup();
    await ready();
    await user.click(tab(/Past & archive/));
    expect(screen.getByRole("heading", { name: "Past trips & archive", level: 1 })).toBeTruthy();
    expect(
      screen.queryByRole("heading", { name: "Pack for the trip, not the anxiety." }),
    ).toBeNull();
    const lisbon = card("Lisbon");
    expect(within(lisbon).getByText("Past trip")).toBeTruthy();
    expect(within(lisbon).getByText("Ready to go")).toBeTruthy();
    expect(within(lisbon).queryByText(/Simulated/)).toBeNull();
    expect(within(lisbon).getByRole("link", { name: "Review bag: Lisbon" })).toBeTruthy();
    expect(within(lisbon).queryByRole("button", { name: /Archive|Restore/ })).toBeNull();
    expect(screen.getByText("Nothing recently deleted.")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/\d+ days? (?:ago|retention)|30 days/i);
  });

  it("shows empty states for no upcoming and no past trips", async () => {
    const empty = sampleLifecycleState();
    empty.trips = [];
    const { user } = setup(empty);
    expect(await screen.findByText("No upcoming trips.")).toBeTruthy();
    expect(screen.getByText(/Create a trip or restore one from Past & archive/)).toBeTruthy();
    await user.click(tab(/Past & archive/));
    expect(screen.getByText("No past or archived trips yet.")).toBeTruthy();
    expect(screen.getByText(/Archived trips and trips whose return date has passed/)).toBeTruthy();
  });
});

describe("archive and restore", () => {
  it("archive moves the trip to Past & archive, restore brings it back to Upcoming", async () => {
    const { user, source } = setup();
    await ready();
    await user.click(screen.getByRole("button", { name: "Archive: San Diego" }));
    await waitFor(() => expect(screen.queryByRole("heading", { name: "San Diego" })).toBeNull());
    expect(screen.getByText("No upcoming trips.")).toBeTruthy();
    expect(tab(/Upcoming/).textContent).toContain("0");
    expect(tab(/Past & archive/).textContent).toContain("2");
    expect(source.snapshot().trips.find((t) => t.id === "san-diego")?.archived).toBe(true);

    await user.click(tab(/Past & archive/));
    const archived = card("San Diego");
    expect(within(archived).getByText("Archived trip")).toBeTruthy();
    expect(within(archived).queryByRole("button", { name: /Archive:/ })).toBeNull();
    await user.click(within(archived).getByRole("button", { name: "Restore: San Diego" }));
    await waitFor(() => expect(screen.queryByRole("heading", { name: "San Diego" })).toBeNull());

    await user.click(tab(/Upcoming/));
    expect(card("San Diego")).toBeTruthy();
    expect(source.snapshot().trips.find((t) => t.id === "san-diego")?.archived).toBe(false);
  });

  it("moves focus to the list heading after an action so focus is not lost", async () => {
    const { user } = setup();
    await ready();
    await user.click(screen.getByRole("button", { name: "Archive: San Diego" }));
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("heading", { name: "Where are we going?" }),
      ),
    );
  });

  it("disables that card's actions while saving and changes nothing until the source confirms", async () => {
    const gate = deferred<LifecycleState>();
    const { user, source } = setup(undefined, (base) => ({ ...base, archive: () => gate.promise }));
    await ready();
    await user.click(screen.getByRole("button", { name: "Archive: San Diego" }));
    const sanDiego = card("San Diego");
    expect(sanDiego.getAttribute("aria-busy")).toBe("true");
    for (const name of ["Archive: San Diego", "Remove: San Diego"]) {
      expect((within(sanDiego).getByRole("button", { name }) as HTMLButtonElement).disabled).toBe(
        true,
      );
    }
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
    await user.click(screen.getByRole("button", { name: "Archive: San Diego" }));
    await screen.findByRole("button", { name: "Couldn't save, retry" });
    expect(card("San Diego")).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Archive: San Diego" }) as HTMLButtonElement).disabled,
    ).toBe(false);
    await user.click(screen.getByRole("button", { name: "Couldn't save, retry" }));
    await waitFor(() => expect(screen.queryByRole("heading", { name: "San Diego" })).toBeNull());
    expect(screen.getByRole("link", { name: "Saved" })).toBeTruthy();
  });
});

describe("remove, confirm and undo", () => {
  it("asks first with the safe button focused, and Cancel changes nothing", async () => {
    const { user, source } = setup();
    await ready();
    const before = source.snapshot();
    await user.click(screen.getByRole("button", { name: "Remove: San Diego" }));
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
    await user.click(screen.getByRole("button", { name: "Remove: San Diego" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(source.snapshot()).toBe(before);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Remove: San Diego" }));
  });

  it("remove -> confirm -> undo restores the identical trip", async () => {
    const { user, source } = setup();
    await ready();
    const original = structuredClone(source.snapshot().trips.find((t) => t.id === "san-diego"));
    await user.click(screen.getByRole("button", { name: "Remove: San Diego" }));
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
    await user.click(screen.getByRole("button", { name: "Remove: San Diego" }));
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
    expect(card("San Diego")).toBeTruthy();
  });

  it("keeps the trip and shows no Undo toast when removing fails", async () => {
    const { user } = setup(undefined, (base) => ({
      ...base,
      remove: () => Promise.reject(new Error("nope")),
    }));
    await ready();
    await user.click(screen.getByRole("button", { name: "Remove: San Diego" }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Remove trip" }),
    );
    await screen.findByRole("button", { name: "Couldn't save, retry" });
    expect(card("San Diego")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
  });

  it("does not announce a restore when the undo itself fails", async () => {
    const { user } = setup(undefined, (base) => ({
      ...base,
      undoRemove: () => Promise.reject(new Error("nope")),
    }));
    await ready();
    await user.click(screen.getByRole("button", { name: "Remove: San Diego" }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Remove trip" }),
    );
    await user.click(await screen.findByRole("button", { name: "Undo" }));
    await screen.findByRole("button", { name: "Couldn't save, retry" });
    expect(screen.queryByText("San Diego restored")).toBeNull();
  });
});

describe("quick view", () => {
  it("is collapsed by default and toggles with aria-expanded and aria-controls", async () => {
    const { user } = setup();
    await ready();
    const toggle = within(card("San Diego")).getByRole("button", { name: /Quick view/ });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(document.getElementById("quick-view-san-diego")).toBeNull();
    await user.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(toggle.getAttribute("aria-controls")).toBe("quick-view-san-diego");
    expect(document.getElementById("quick-view-san-diego")).not.toBeNull();
    await user.click(toggle);
    expect(document.getElementById("quick-view-san-diego")).toBeNull();
  });

  it("filters Still to pack / All and never mutates or writes anything", async () => {
    const base = memory(sampleLifecycleState());
    const writes = {
      archive: vi.spyOn(base, "archive"),
      restore: vi.spyOn(base, "restore"),
      remove: vi.spyOn(base, "remove"),
      undoRemove: vi.spyOn(base, "undoRemove"),
    };
    const user = userEvent.setup();
    renderInApp(<TripsDashboard source={base} getToday={TODAY} />);
    await ready();
    const before = base.snapshot();
    const beforeJson = JSON.stringify(before);
    const progress = within(card("San Diego")).getByText("6 of 30 packed");

    await user.click(within(card("San Diego")).getByRole("button", { name: /Quick view/ }));
    const quick = document.getElementById("quick-view-san-diego") as HTMLElement;
    expect(within(quick).getByText("Read-only preview")).toBeTruthy();
    expect(
      within(quick).getByRole("button", { name: "Still to pack" }).getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      within(quick).getByRole("group", { name: "Quick view filter for San Diego" }),
    ).toBeTruthy();
    expect(within(quick).queryByText("Sleepwear")).toBeNull();
    expect(within(quick).getAllByText("Underwear")[0].parentElement?.textContent).toContain(
      "2 left",
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
    expect(progress.textContent).toBe("6 of 30 packed");
    expect(screen.getByRole("link", { name: "Saved" })).toBeTruthy();
  });

  it("announces the result count politely, with singular wording", async () => {
    const state = sampleLifecycleState();
    state.trips[0] = {
      ...state.trips[0],
      items: state.trips[0].items.filter((item) => item.id === "underwear"),
    };
    const { user } = setup(state);
    await ready();
    await user.click(within(card("San Diego")).getByRole("button", { name: /Quick view/ }));
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
    await user.click(tab(/Past & archive/));
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
    const { user } = setup();
    await ready();
    await user.click(within(card("San Diego")).getByRole("button", { name: /Quick view/ }));
    const quick = document.getElementById("quick-view-san-diego") as HTMLElement;
    const laptop = within(quick).getByText("Laptop").closest(".quick-view-row") as HTMLElement;
    expect(within(laptop).getByText("Pack last")).toBeTruthy();
  });
});
