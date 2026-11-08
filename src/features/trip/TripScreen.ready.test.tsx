// @vitest-environment jsdom
// All packed, "Review your bag" and Ready on the Packing screen (#411), on both layouts: the ribbon and banner, the sheet, the
// toiletry-bag gate, "I'm ready to go", the Ready chip and "Mark as not ready", and the ?review=1 deep link.
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sampleLifecycleState } from "@/features/trips/fixtures";
import { createMemoryTripsSource, type TripsSource } from "@/features/trips/trips-source";
import { TripsSourceProvider } from "@/features/trips/TripsSourceProvider";
import { renderInApp } from "@/test/providers";
import { TripScreen } from "./TripScreen";

vi.mock("next/navigation", () => ({
  usePathname: () => "/trips/san-diego",
  useRouter: () => ({ push: vi.fn() }),
}));

const realMatchMedia = window.matchMedia;
const layout = { laptop: true };
beforeEach(() => {
  window.matchMedia = ((query: string) => ({
    matches: layout.laptop,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
});
afterEach(() => {
  window.matchMedia = realMatchMedia;
  window.history.replaceState(null, "", "/");
});

/** San Diego with everything packed but the toiletry bag still outside the suitcase, and not Ready. */
function memory(
  options: {
    ready?: boolean;
    bag?: boolean;
    short?: number;
    /** Item ids to leave unpacked. */
    unpack?: string[];
    empty?: boolean;
  } = {},
) {
  const state = sampleLifecycleState();
  state.trips = state.trips.map((trip) =>
    trip.id !== "san-diego"
      ? trip
      : {
          ...trip,
          ready: options.ready ?? false,
          toiletryBagPacked: options.bag ?? false,
          items: options.empty
            ? []
            : trip.items.map((item, index) => ({
                ...item,
                packed:
                  index < (options.short ?? 0) || options.unpack?.includes(item.id) ? 0 : item.qty,
              })),
        },
  );
  return createMemoryTripsSource(state, {
    now: () => 1,
    newId: () => "x",
    today: () => "2026-10-16",
  });
}

function setup(
  options: Parameters<typeof memory>[0] & {
    openReview?: boolean;
    wrap?: (base: ReturnType<typeof memory>) => Partial<TripsSource>;
  } = {},
) {
  const base = memory(options);
  const source = (options.wrap ? { ...base, ...options.wrap(base) } : base) as TripsSource;
  const user = userEvent.setup();
  const view = renderInApp(
    <TripsSourceProvider source={source}>
      <TripScreen tripId="san-diego" openReview={options.openReview} />
    </TripsSourceProvider>,
  );
  const trip = () => base.snapshot().trips.find((entry) => entry.id === "san-diego")!;
  return { user, source: base, trip, view };
}

const title = () => screen.findByRole("heading", { level: 1 });
const sheet = () => screen.findByRole("dialog", { name: "Review your bag" });
const ribbon = (tone: "gold" | "good") => document.querySelector(`[data-packed-ribbon="${tone}"]`);

describe.each([
  ["laptop", true],
  ["phone", false],
])("all packed and Ready on the %s layout", (_name, laptop) => {
  beforeEach(() => {
    layout.laptop = laptop;
  });

  it("all packed: gold ribbon and one banner whose button opens the Review sheet; nothing is Ready by itself", async () => {
    const { user, trip } = setup();
    await title();
    expect(ribbon("gold")?.textContent).toContain("All packed");
    expect(ribbon("good")).toBeNull();
    const banner = document.querySelector("[data-packed-banner]") as HTMLElement;
    expect(banner.getAttribute("role")).toBe("status");
    expect(banner.textContent).toContain(
      "Everything is in. Review your bag to mark the trip Ready.",
    );
    await user.click(within(banner).getByRole("button", { name: "Review your bag" }));
    expect(await sheet()).toBeTruthy();
    expect(trip().ready).toBe(false);
  });

  it("the banner is dismissible, and comes back only after an untick and a new completion", async () => {
    const { user } = setup();
    await title();
    const banner = () => document.querySelector("[data-packed-banner]");
    await user.click(within(banner() as HTMLElement).getByRole("button", { name: "Dismiss" }));
    expect(banner()).toBeNull();
    // Still all packed: stays dismissed.
    expect(ribbon("gold")).toBeTruthy();
    // Untick one item: the ribbon and banner go; tick it again: the banner returns.
    const box = screen
      .getAllByRole("checkbox")
      .find((entry) => (entry as HTMLInputElement).checked)!;
    await user.click(box);
    await waitFor(() => expect(ribbon("gold")).toBeNull());
    expect(banner()).toBeNull();
    await user.click(box);
    await waitFor(() => expect(banner()).toBeTruthy());
  });

  it("the sheet groups the list by cube with a checkbox per item, and the bag gate offers 'Put bag in suitcase'", async () => {
    const { user, trip } = setup({ openReview: true });
    const dialog = await sheet();
    expect(within(dialog).getByText("FINAL CHECK")).toBeTruthy();
    expect(within(dialog).getByText("San Diego")).toBeTruthy();
    expect(within(dialog).getByRole("heading", { name: "Clothing", level: 3 })).toBeTruthy();
    expect(within(dialog).getByRole("heading", { name: "Toiletries", level: 3 })).toBeTruthy();
    expect(within(dialog).getAllByRole("checkbox").length).toBe(trip().items.length);
    expect(within(dialog).getByText(/Nothing becomes Ready automatically/)).toBeTruthy();
    // Blocked: the button says why, and pressing it does nothing.
    const ready = within(dialog).getByRole("button", { name: "I’m ready to go" });
    expect(ready.getAttribute("aria-disabled")).toBe("true");
    expect(document.getElementById(ready.getAttribute("aria-describedby")!)?.textContent).toBe(
      "Confirm your toiletry bag is in the suitcase.",
    );
    await user.click(ready);
    expect(trip().ready).toBe(false);
    await user.click(within(dialog).getByRole("button", { name: "Put bag in suitcase" }));
    await waitFor(() => expect(trip().toiletryBagPacked).toBe(true));
    // The review owns the bag step: no second "Toiletry bag in suitcase?" prompt opens on top of it.
    expect(screen.queryByRole("dialog", { name: "Toiletry bag in suitcase?" })).toBeNull();
    expect(await within(dialog).findByRole("button", { name: "Undo placement" })).toBeTruthy();
  });

  it("the full path: Review, bag, I'm ready to go, Ready ribbon, Mark as not ready", async () => {
    const { user, trip } = setup({ bag: true });
    await title();
    await user.click(
      within(document.querySelector("[data-packed-banner]") as HTMLElement).getByRole("button", {
        name: "Review your bag",
      }),
    );
    const dialog = await sheet();
    await user.click(within(dialog).getByRole("button", { name: "I’m ready to go" }));
    await waitFor(() => expect(trip().ready).toBe(true));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(ribbon("good")?.textContent).toContain("Ready");
    expect(ribbon("gold")).toBeNull();
    expect(document.querySelector("[data-packed-banner]")).toBeNull();
    expect(screen.getByText("Ready to go")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Mark as not ready" }));
    await waitFor(() => expect(trip().ready).toBe(false));
    expect(ribbon("gold")).toBeTruthy();
    expect(trip().items.every((item) => item.packed >= item.qty)).toBe(true);
  });

  it("'Review bag' on a Ready trip opens the sheet with 'Mark as not ready'; unticking there revokes Ready", async () => {
    const { user, trip } = setup({ ready: true, bag: true });
    await title();
    await user.click(screen.getAllByRole("button", { name: "Review bag" })[0]);
    const dialog = await sheet();
    expect(within(dialog).queryByRole("button", { name: "I’m ready to go" })).toBeNull();
    await user.click(within(dialog).getAllByRole("checkbox")[0]);
    await waitFor(() => expect(trip().ready).toBe(false));
    expect(await screen.findByText(/No longer ready: an item was unchecked/)).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "I’m ready to go" })).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "Back to packing list" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("'Mark as not ready' inside the sheet keeps the packed counts", async () => {
    const { user, trip } = setup({ ready: true, bag: true, openReview: true });
    const dialog = await sheet();
    await user.click(within(dialog).getByRole("button", { name: "Mark as not ready" }));
    await waitFor(() => expect(trip().ready).toBe(false));
    expect(await screen.findByText("Progress kept.")).toBeTruthy();
    expect(trip().items.every((item) => item.packed >= item.qty)).toBe(true);
  });

  it("?review=1 opens the sheet on load, and closing it puts the plain trip address back", async () => {
    window.history.replaceState(null, "", "/trips/san-diego?review=1");
    setup({ openReview: true });
    const dialog = await sheet();
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(window.location.pathname + window.location.search).toBe("/trips/san-diego");
  });

  it("without ?review the sheet is closed", async () => {
    setup();
    await title();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("an unfinished bag shows no ribbon and no banner", async () => {
    setup({ short: 3 });
    await title();
    expect(ribbon("gold")).toBeNull();
    expect(ribbon("good")).toBeNull();
    expect(document.querySelector("[data-packed-banner]")).toBeNull();
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe.each([
  ["laptop", true],
  ["phone", false],
])("the Review sheet's writes on the %s layout (QA round 2)", (_name, laptop) => {
  beforeEach(() => {
    layout.laptop = laptop;
  });

  it("a rejected Ready write shows an alert INSIDE the sheet with a Retry that sends it again", async () => {
    let calls = 0;
    const { user, trip } = setup({
      bag: true,
      openReview: true,
      wrap: (base) => ({
        markReady: (id: string) =>
          ++calls === 1 ? Promise.reject(new Error("offline")) : base.markReady(id),
      }),
    });
    const dialog = await sheet();
    await user.click(within(dialog).getByRole("button", { name: "I’m ready to go" }));
    const alert = await within(dialog).findByText(/Marking the trip Ready didn’t save/);
    expect(trip().ready).toBe(false);
    expect(screen.getByRole("dialog", { name: "Review your bag" })).toBeTruthy();
    await user.click(
      within(alert.closest('[role="alert"]') as HTMLElement).getByRole("button", { name: "Retry" }),
    );
    await waitFor(() => expect(trip().ready).toBe(true));
    expect(calls).toBe(2);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("a failed tick says Not saved with a Retry in the sheet, and Retry saves it", async () => {
    let calls = 0;
    const { user, trip } = setup({
      short: 1,
      openReview: true,
      wrap: (base) => ({
        setPacked: (id: string, itemId: string, packed: number) =>
          ++calls === 1 ? Promise.reject(new Error("offline")) : base.setPacked(id, itemId, packed),
      }),
    });
    const dialog = await sheet();
    const first = trip().items[0];
    await user.click(within(dialog).getAllByRole("checkbox")[0]);
    await within(dialog).findByText(/Not saved/);
    expect(trip().items[0].packed).toBe(0);
    await user.click(
      within(dialog).getByRole("button", { name: new RegExp(`^Retry ${first.name}`) }),
    );
    await waitFor(() => expect(trip().items[0].packed).toBe(first.qty));
    expect(within(dialog).queryByText(/Not saved/)).toBeNull();
  });

  it("a tick in flight shows Saving… until the source confirms it", async () => {
    const gate = deferred<void>();
    const { user, trip } = setup({
      short: 1,
      openReview: true,
      wrap: (base) => ({
        setPacked: async (id: string, itemId: string, packed: number) => {
          await gate.promise;
          return base.setPacked(id, itemId, packed);
        },
      }),
    });
    const dialog = await sheet();
    await user.click(within(dialog).getAllByRole("checkbox")[0]);
    expect(within(dialog).getByText("Saving…")).toBeTruthy();
    gate.resolve();
    await waitFor(() => expect(within(dialog).queryByText("Saving…")).toBeNull());
    expect(trip().items[0].packed).toBe(trip().items[0].qty);
  });

  it("a tick that resolves does not re-enable the bag button while the bag write is still pending", async () => {
    const tick = deferred<void>();
    const bag = deferred<void>();
    const { user } = setup({
      short: 1,
      openReview: true,
      wrap: (base) => ({
        setPacked: async (id: string, itemId: string, packed: number) => {
          await tick.promise;
          return base.setPacked(id, itemId, packed);
        },
        confirmBagPlacement: async (id: string) => {
          await bag.promise;
          return base.confirmBagPlacement(id);
        },
      }),
    });
    const dialog = await sheet();
    await user.click(within(dialog).getAllByRole("checkbox")[0]);
    const put = within(dialog).getByRole("button", { name: "Put bag in suitcase" });
    await user.click(put);
    expect(put.getAttribute("aria-disabled")).toBe("true");
    tick.resolve();
    await waitFor(() => expect(within(dialog).queryByText("Saving…")).toBeNull());
    expect(put.getAttribute("aria-disabled")).toBe("true");
    bag.resolve();
    await within(dialog).findByRole("button", { name: "Undo placement" });
  });

  it("ticking the last Bathroom item inside the sheet does not open the bag prompt on top of it", async () => {
    const { user, trip } = setup({ unpack: ["last-contacts"], openReview: true });
    const dialog = await sheet();
    await user.click(within(dialog).getByRole("checkbox", { name: /^Contacts/ }));
    await waitFor(() =>
      expect(trip().items.find((item) => item.id === "last-contacts")!.packed).toBeGreaterThan(0),
    );
    expect(await within(dialog).findByRole("button", { name: "Put bag in suitcase" })).toBeTruthy();
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
  });

  it("a correction keeps focus on the checkbox that was changed", async () => {
    const { user } = setup({ short: 1, openReview: true });
    const dialog = await sheet();
    const box = within(dialog).getAllByRole("checkbox")[0];
    await user.click(box);
    await waitFor(() => expect((box as HTMLInputElement).checked).toBe(true));
    await waitFor(() => expect(within(dialog).queryByText("Saving…")).toBeNull());
    expect(document.activeElement).toBe(box);
  });

  it("a direct review link to an EMPTY list says why Ready is not available", async () => {
    const { user, trip } = setup({ empty: true, openReview: true });
    const dialog = await sheet();
    const ready = within(dialog).getByRole("button", { name: "I’m ready to go" });
    expect(ready.getAttribute("aria-disabled")).toBe("true");
    expect(document.getElementById(ready.getAttribute("aria-describedby")!)?.textContent).toBe(
      "Add something to your list before marking it Ready.",
    );
    await user.click(ready);
    expect(trip().ready).toBe(false);
  });
});

describe("round 3: retry and URL clean-up are scoped", () => {
  beforeEach(() => {
    layout.laptop = true;
  });

  it("a double press on a row's Retry sends ONE write, shows Saving…, and hides the button until it settles", async () => {
    const retry = deferred<void>();
    let calls = 0;
    const { user, trip } = setup({
      short: 1,
      openReview: true,
      wrap: (base) => ({
        setPacked: async (id: string, itemId: string, packed: number) => {
          if (++calls === 1) throw new Error("offline");
          await retry.promise;
          return base.setPacked(id, itemId, packed);
        },
      }),
    });
    const dialog = await sheet();
    const first = trip().items[0];
    await user.click(within(dialog).getAllByRole("checkbox")[0]);
    const button = await within(dialog).findByRole("button", {
      name: new RegExp(`^Retry ${first.name}`),
    });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(await within(dialog).findByText("Saving…")).toBeTruthy();
    expect(
      within(dialog).queryByRole("button", { name: new RegExp(`^Retry ${first.name}`) }),
    ).toBeNull();
    expect(calls).toBe(2);
    retry.resolve();
    await waitFor(() => expect(trip().items[0].packed).toBe(first.qty));
    expect(calls).toBe(2);
    expect(within(dialog).queryByText(/Not saved/)).toBeNull();
  });

  it("a Ready write that settles after the screen is gone does not rewrite another trip's ?review URL", async () => {
    const gate = deferred<void>();
    window.history.replaceState(null, "", "/trips/san-diego?review=1");
    const { user, view } = setup({
      bag: true,
      openReview: true,
      wrap: (base) => ({
        markReady: async (id: string) => {
          await gate.promise;
          return base.markReady(id);
        },
      }),
    });
    const dialog = await sheet();
    await user.click(within(dialog).getByRole("button", { name: "I’m ready to go" }));
    view.unmount();
    window.history.replaceState(null, "", "/trips/lisbon?review=1");
    gate.resolve();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(window.location.pathname + window.location.search).toBe("/trips/lisbon?review=1");
  });

  it("while still mounted, a settled Ready write strips ?review only from its own trip's address", async () => {
    window.history.replaceState(null, "", "/trips/san-diego?review=1");
    const { user, trip } = setup({ bag: true, openReview: true });
    const dialog = await sheet();
    await user.click(within(dialog).getByRole("button", { name: "I’m ready to go" }));
    await waitFor(() => expect(trip().ready).toBe(true));
    await waitFor(() => expect(window.location.search).toBe(""));
    expect(window.location.pathname).toBe("/trips/san-diego");
  });

  it("two Retry presses in the same tick, before the row re-renders, send ONE write (the retryingRef guard)", async () => {
    const retry = deferred<void>();
    let calls = 0;
    const { user, trip } = setup({
      short: 1,
      openReview: true,
      wrap: (base) => ({
        setPacked: async (id: string, itemId: string, packed: number) => {
          if (++calls === 1) throw new Error("offline");
          await retry.promise;
          return base.setPacked(id, itemId, packed);
        },
      }),
    });
    const dialog = await sheet();
    const first = trip().items[0];
    await user.click(within(dialog).getAllByRole("checkbox")[0]);
    const button = await within(dialog).findByRole("button", {
      name: new RegExp(`^Retry ${first.name}`),
    });
    // Both presses land inside one act scope: no re-render (which would detach the button) happens between them.
    act(() => {
      button.click();
      expect(button.isConnected).toBe(true);
      button.click();
    });
    retry.resolve();
    await waitFor(() => expect(trip().items[0].packed).toBe(first.qty));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(calls).toBe(2);
  });

  it("closeReviewSheet's mounted guard: a Ready write that settles after unmount leaves its own ?review address alone", async () => {
    const gate = deferred<void>();
    window.history.replaceState(null, "", "/trips/san-diego?review=1");
    const { user, view } = setup({
      bag: true,
      openReview: true,
      wrap: (base) => ({
        markReady: async (id: string) => {
          await gate.promise;
          return base.markReady(id);
        },
      }),
    });
    const dialog = await sheet();
    await user.click(within(dialog).getByRole("button", { name: "I’m ready to go" }));
    view.unmount();
    // The address still belongs to this trip, so only the mounted guard can stop the rewrite.
    gate.resolve();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(window.location.pathname + window.location.search).toBe("/trips/san-diego?review=1");
  });

  it("closeReviewSheet's own-path guard: a Ready write that settles while still mounted leaves another trip's ?review address alone", async () => {
    const gate = deferred<void>();
    window.history.replaceState(null, "", "/trips/san-diego?review=1");
    const { user } = setup({
      bag: true,
      openReview: true,
      wrap: (base) => ({
        markReady: async (id: string) => {
          await gate.promise;
          return base.markReady(id);
        },
      }),
    });
    const dialog = await sheet();
    await user.click(within(dialog).getByRole("button", { name: "I’m ready to go" }));
    // Still mounted, but the address is another trip's: only the own-path check can stop the rewrite.
    window.history.replaceState(null, "", "/trips/lisbon?review=1");
    gate.resolve();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(window.location.pathname + window.location.search).toBe("/trips/lisbon?review=1");
  });
});
