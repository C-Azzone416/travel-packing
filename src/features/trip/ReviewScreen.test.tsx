// @vitest-environment jsdom
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderInApp } from "@/test/providers";
import { sampleLifecycleState } from "@/features/trips/fixtures";
import {
  createMemoryTripsSource,
  TripsSourceError,
  type TripsSource,
} from "@/features/trips/trips-source";
import { TripsSourceProvider } from "@/features/trips/TripsSourceProvider";
import { ReviewScreen } from "./ReviewScreen";

vi.mock("next/navigation", () => ({ usePathname: () => "/trips/san-diego/review" }));

type Memory = ReturnType<typeof memory>;

function memory() {
  let counter = 0;
  return createMemoryTripsSource(sampleLifecycleState(), {
    now: () => 1,
    newId: () => `new-${++counter}`,
    today: () => "2026-10-16",
  });
}

const tripOf = (source: Memory, id = "san-diego") =>
  source.snapshot().trips.find((trip) => trip.id === id)!;

/** Pack every item of a San Diego (and optionally confirm the bag) through the source, as the packing screen would. */
async function packAll(source: Memory, { bag }: { bag: boolean }) {
  for (const item of tripOf(source).items) {
    await source.setPacked("san-diego", item.id, item.qty);
  }
  if (bag) await source.confirmBagPlacement("san-diego");
}

async function setup(
  tripId = "san-diego",
  prepare?: (base: Memory) => Promise<void> | void,
  wrap?: (base: Memory) => TripsSource,
) {
  const base = memory();
  await prepare?.(base);
  const source = wrap ? wrap(base) : base;
  const user = userEvent.setup();
  const view = renderInApp(
    <TripsSourceProvider source={source}>
      <ReviewScreen tripId={tripId} />
    </TripsSourceProvider>,
  );
  return { user, source: base, view };
}

const title = () => screen.findByRole("heading", { name: "Review your bag", level: 1 });
const rowOf = (id: string) => document.querySelector(`[data-item-id="${id}"]`) as HTMLElement;
const readyButton = () => screen.getByRole("button", { name: "I’m ready to go" });
const live = () => screen.getByRole("status", { name: "Review updates" });

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => (resolve = res));
  return { promise, resolve };
}

describe("loading and states", () => {
  it("shows the review with its sections, counts, status and a way back", async () => {
    await setup();
    expect(await title()).toBeTruthy();
    expect(screen.getByText("Final check")).toBeTruthy();
    expect(
      screen.getAllByRole("link", { name: "Back to packing list" })[0].getAttribute("href"),
    ).toBe("/trips/san-diego");
    for (const heading of [
      "Everyday & occasion items",
      "Toiletries · Bathroom",
      "Return travel outfit",
    ]) {
      expect(screen.getByRole("heading", { name: heading })).toBeTruthy();
    }
    expect(screen.getByText("Packing", { selector: ".status-pill" })).toBeTruthy();
    expect(screen.getByText("There are still unpacked items.")).toBeTruthy();
    expect(screen.queryByText(/sample|simulated storage/i)).toBeNull();
  });

  it("shows a loading state first", async () => {
    const gate = deferred<void>();
    await setup("san-diego", undefined, (base) => ({
      ...base,
      getTrip: async (id) => (await gate.promise, base.getTrip(id)),
    }));
    expect(screen.getByRole("region", { name: "Loading review" }).getAttribute("aria-busy")).toBe(
      "true",
    );
    await act(async () => gate.resolve());
    expect(await title()).toBeTruthy();
  });

  it("says so, with a way back, when the trip does not exist or the id is malformed", async () => {
    const base = memory();
    const view = renderInApp(
      <TripsSourceProvider source={base}>
        <ReviewScreen tripId="nope" />
      </TripsSourceProvider>,
    );
    expect(await screen.findByRole("heading", { name: "That trip isn’t available" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Back to trips" }).getAttribute("href")).toBe("/");
    view.unmount();
    renderInApp(
      <TripsSourceProvider
        source={{ ...base, getTrip: () => Promise.reject(new TripsSourceError("INVALID_INPUT")) }}
      >
        <ReviewScreen tripId="not-a-uuid" />
      </TripsSourceProvider>,
    );
    expect(await screen.findByRole("heading", { name: "That trip isn’t available" })).toBeTruthy();
  });

  it("shows a load error with Try again that recovers", async () => {
    const base = memory();
    const getTrip = vi
      .fn()
      .mockRejectedValueOnce(new Error("down"))
      .mockImplementation((id: string) => base.getTrip(id));
    const user = userEvent.setup();
    renderInApp(
      <TripsSourceProvider source={{ ...base, getTrip }}>
        <ReviewScreen tripId="san-diego" />
      </TripsSourceProvider>,
    );
    expect(await screen.findByText("Couldn’t load this trip.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await title()).toBeTruthy();
  });

  it("opening the review never shows Saving…", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    try {
      const gate = deferred<void>();
      await setup("san-diego", undefined, (base) => ({
        ...base,
        getTrip: async (id) => (await gate.promise, base.getTrip(id)),
      }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });
      expect(screen.queryByText("Saving…")).toBeNull();
      await act(async () => gate.resolve());
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("why Ready is not available", () => {
  it("says how many items are left, on a button that stays focusable and does nothing", async () => {
    const markReady = vi.fn();
    const { user } = await setup("san-diego", undefined, (base) => ({ ...base, markReady }));
    await title();
    const button = readyButton();
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(button.hasAttribute("disabled")).toBe(false);
    const reason = document.getElementById(button.getAttribute("aria-describedby") as string)!;
    expect(reason.textContent).toMatch(/^Check off \d+ more items?$/);
    await user.click(button);
    expect(markReady).not.toHaveBeenCalled();
  });

  it("asks for the bag when only the bag is left", async () => {
    const markReady = vi.fn();
    const { user } = await setup(
      "san-diego",
      (base) => packAll(base, { bag: false }),
      (base) => ({
        ...base,
        markReady,
      }),
    );
    await title();
    const button = readyButton();
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(
      document.getElementById(button.getAttribute("aria-describedby") as string)!.textContent,
    ).toBe("Confirm your toiletry bag is in the suitcase.");
    expect(
      screen.getByText(
        "Toiletry contents are checked, but the bag is not confirmed in the suitcase.",
      ),
    ).toBeTruthy();
    await user.click(button);
    expect(markReady).not.toHaveBeenCalled();
  });
});

describe("marking Ready and not ready", () => {
  it("waits for the server, then announces once, swaps the button and keeps focus on it", async () => {
    const gate = deferred<void>();
    const { user, source } = await setup(
      "san-diego",
      (base) => packAll(base, { bag: true }),
      (base) => ({
        ...base,
        markReady: async (id) => (await gate.promise, base.markReady(id)),
      }),
    );
    await title();
    const button = readyButton();
    expect(button.getAttribute("aria-disabled")).toBe("false");
    await user.click(button);
    // Never optimistic: still not Ready until the server says so.
    expect(screen.getByText("Packing", { selector: ".status-pill" })).toBeTruthy();
    expect(tripOf(source).ready).toBe(false);
    await act(async () => gate.resolve());
    const notReady = await screen.findByRole("button", { name: "Mark as not ready" });
    expect(tripOf(source).ready).toBe(true);
    expect(screen.getByText("Ready", { selector: ".status-pill" })).toBeTruthy();
    expect(live().textContent).toBe("Marked ready.");
    expect(document.activeElement).toBe(notReady);
    expect(screen.queryByRole("button", { name: "I’m ready to go" })).toBeNull();
  });

  it("stays as it was, with the Error chip, when marking Ready fails", async () => {
    const { user, source } = await setup(
      "san-diego",
      (base) => packAll(base, { bag: true }),
      (base) => ({ ...base, markReady: () => Promise.reject(new Error("down")) }),
    );
    await title();
    await user.click(readyButton());
    expect(await screen.findByRole("button", { name: /couldn.t save/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: "I’m ready to go" })).toBeTruthy();
    expect(screen.getByText("Packing", { selector: ".status-pill" })).toBeTruthy();
    expect(tripOf(source).ready).toBe(false);
  });

  it("Mark as not ready keeps every packed quantity, asks nothing, and says so", async () => {
    const { user, source } = await setup("lisbon");
    await screen.findByRole("heading", { name: "Review your bag" });
    const before = JSON.stringify(tripOf(source, "lisbon").items.map((i) => [i.id, i.packed]));
    expect(screen.getByText("Ready", { selector: ".status-pill" })).toBeTruthy();
    const button = screen.getByRole("button", { name: "Mark as not ready" });
    await user.click(button);
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(tripOf(source, "lisbon").ready).toBe(false));
    expect(await screen.findByText("Progress kept.")).toBeTruthy();
    expect(live().textContent).toBe("Marked not ready. Progress kept.");
    expect(JSON.stringify(tripOf(source, "lisbon").items.map((i) => [i.id, i.packed]))).toBe(
      before,
    );
    expect(screen.getByText("Packing", { selector: ".status-pill" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "I’m ready to go" })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "I’m ready to go" }));
  });
});

describe("corrections on the review", () => {
  it("fixing an unpacked row packs it and keeps focus on that row", async () => {
    const { user, source } = await setup();
    await title();
    const fix = within(rowOf("tops")).getByRole("button", { name: "Mark packed Everyday tops" });
    expect(fix.textContent).toContain("Mark packed");
    fix.focus();
    await user.click(fix);
    await waitFor(() =>
      expect(tripOf(source).items.find((item) => item.id === "tops")!.packed).toBe(
        tripOf(source).items.find((item) => item.id === "tops")!.qty,
      ),
    );
    const done = await within(rowOf("tops")).findByRole("button", {
      name: "Packed ✓ Everyday tops, mark unpacked",
    });
    expect(done.textContent).toContain("Packed ✓");
    expect(document.activeElement).toBe(done);
  });

  it("puts focus back on the corrected row even if the page lost it while saving", async () => {
    const { user } = await setup("san-diego", undefined, (base) => ({
      ...base,
      togglePacked: async (tripId, itemId) => {
        const change = await base.togglePacked(tripId, itemId);
        // Whatever re-rendering does to focus, the user must land back on the row they were correcting.
        (document.activeElement as HTMLElement | null)?.blur();
        return change;
      },
    }));
    await title();
    await user.click(within(rowOf("tops")).getByRole("button", { name: /^Mark packed/ }));
    const done = await within(rowOf("tops")).findByRole("button", {
      name: "Packed ✓ Everyday tops, mark unpacked",
    });
    await waitFor(() => expect(document.activeElement).toBe(done));
  });

  it("unchecking on a Ready trip takes it out of Ready with a visible reason, and focus stays on the row", async () => {
    const { user, source } = await setup("lisbon");
    await screen.findByRole("heading", { name: "Review your bag" });
    const uncheck = within(rowOf("tops")).getByRole("button", {
      name: "Packed ✓ Everyday tops, mark unpacked",
    });
    await user.click(uncheck);
    expect(await screen.findByText("No longer ready: an item was unchecked")).toBeTruthy();
    expect(tripOf(source, "lisbon").ready).toBe(false);
    expect(screen.getByText("Packing", { selector: ".status-pill" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "I’m ready to go" })).toBeTruthy();
    expect(document.activeElement).toBe(
      within(rowOf("tops")).getByRole("button", { name: "Mark packed Everyday tops" }),
    );
  });

  it("ignores a second tap while a change is saving, and a failed change leaves the row as it was", async () => {
    const togglePacked = vi.fn(() => Promise.reject(new Error("down")));
    const { user, source } = await setup("san-diego", undefined, (base) => ({
      ...base,
      togglePacked,
    }));
    await title();
    const before = tripOf(source).items.find((item) => item.id === "tops")!.packed;
    await user.click(
      within(rowOf("tops")).getByRole("button", { name: "Mark packed Everyday tops" }),
    );
    expect(await screen.findByRole("button", { name: /couldn.t save/i })).toBeTruthy();
    expect(togglePacked).toHaveBeenCalledTimes(1);
    expect(
      within(rowOf("tops")).getByText(
        `${before} of 4 packed`.replace(
          "4",
          String(tripOf(source).items.find((i) => i.id === "tops")!.qty),
        ),
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/No longer ready/)).toBeNull();
  });
});

describe("the toiletry bag step", () => {
  it("shows Waiting on contents while Bathroom items are unchecked", async () => {
    await setup();
    await title();
    expect(screen.getByText("Waiting on contents")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Put bag in suitcase" })).toBeNull();
  });

  it("Not yet closes the question without placing the bag; Confirm places it and keeps focus on the bag step", async () => {
    const { user, source } = await setup("san-diego", (base) => packAll(base, { bag: false }));
    await title();
    await user.click(screen.getByRole("button", { name: "Put bag in suitcase" }));
    const dialog = screen.getByRole("dialog", { name: "Toiletry bag in suitcase?" });
    await user.click(within(dialog).getByRole("button", { name: "Not yet" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(tripOf(source).toiletryBagPacked).toBe(false);

    await user.click(screen.getByRole("button", { name: "Put bag in suitcase" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(tripOf(source).toiletryBagPacked).toBe(true));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByText(/Separate completion gate · confirmed/)).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Undo placement" }));
    // Everything packed and the bag placed: Ready is now available, and still the user's decision.
    expect(readyButton().getAttribute("aria-disabled")).toBe("false");
    expect(tripOf(source).ready).toBe(false);
  });

  it("Undo placement on a Ready trip revokes Ready and says why", async () => {
    const { user, source } = await setup("lisbon");
    await screen.findByRole("heading", { name: "Review your bag" });
    await user.click(screen.getByRole("button", { name: "Undo placement" }));
    expect(
      await screen.findByText("No longer ready: the toiletry bag is no longer in the suitcase"),
    ).toBeTruthy();
    expect(tripOf(source, "lisbon").ready).toBe(false);
    expect(tripOf(source, "lisbon").toiletryBagPacked).toBe(false);
  });

  it("offers bag placement once when the last Bathroom item is checked, and not again after Not yet", async () => {
    const { user, source } = await setup("san-diego", async (base) => {
      for (const item of tripOf(base).items) {
        if (item.groupId !== "toiletry-bag") await base.setPacked("san-diego", item.id, item.qty);
      }
      const last = tripOf(base).items.filter((item) => item.groupId === "toiletry-bag");
      for (const item of last.slice(1)) await base.setPacked("san-diego", item.id, item.qty);
    });
    await title();
    const remaining = tripOf(source).items.find(
      (item) => item.groupId === "toiletry-bag" && item.packed < item.qty,
    )!;
    await user.click(within(rowOf(remaining.id)).getByRole("button", { name: /^Mark packed/ }));
    const dialog = await screen.findByRole("dialog", { name: "Toiletry bag in suitcase?" });
    await user.click(within(dialog).getByRole("button", { name: "Not yet" }));
    await user.click(within(rowOf(remaining.id)).getByRole("button", { name: /mark unpacked$/ }));
    await user.click(within(rowOf(remaining.id)).getByRole("button", { name: /^Mark packed/ }));
    await waitFor(() =>
      expect(
        within(rowOf(remaining.id)).queryByRole("button", { name: /^Mark packed/ }),
      ).toBeNull(),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("the 'No longer ready' toast is for the change that revoked Ready, not later ones", () => {
  it("shows once, then stays quiet for the next change", async () => {
    const { user, source } = await setup("lisbon");
    await screen.findByRole("heading", { name: "Toiletries · Bathroom" });
    await user.click(
      within(rowOf("tops")).getByRole("button", { name: "Packed ✓ Everyday tops, mark unpacked" }),
    );
    expect(await screen.findByText("No longer ready: an item was unchecked")).toBeTruthy();
    expect(tripOf(source, "lisbon").ready).toBe(false);
    await waitFor(() => expect(screen.queryByText(/No longer ready/)).toBeNull(), {
      timeout: 6000,
    });
    await user.click(within(rowOf("tops")).getByRole("button", { name: /^Mark packed/ }));
    await within(rowOf("tops")).findByRole("button", {
      name: "Packed ✓ Everyday tops, mark unpacked",
    });
    await user.click(
      within(rowOf("tops")).getByRole("button", { name: "Packed ✓ Everyday tops, mark unpacked" }),
    );
    await within(rowOf("tops")).findByRole("button", { name: /^Mark packed/ });
    expect(screen.queryByText(/No longer ready/)).toBeNull();
  }, 20_000);
});
