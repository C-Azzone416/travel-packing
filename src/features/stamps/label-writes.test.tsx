// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { StampLabels } from "@/domain/stamps";
import type { TripConfig } from "@/domain/trip";
import { buildTrip, type LifecycleTrip } from "@/domain/trip-lifecycle";
import type { Signals } from "@/domain/readiness";
import type { TripChange, TripsSource } from "@/features/trips/trips-source";
import { type LabelEdit, useStampLabelWrites } from "./label-writes";

const TODAY = "2026-10-16";
const CONFIG: TripConfig = {
  laundry: false,
  spare: true,
  niceAttire: false,
  occasionCount: 1,
  reuseNice: false,
  returnOutfit: true,
};
const SIGNALS: Signals = { promptBagPlacement: false, reviewPrompt: false };

function makeTrip(stampLabels: StampLabels): LifecycleTrip {
  const trip = buildTrip("Lisbon", null, "2026-11-20", "2026-11-25", CONFIG, [], {
    newId: () => "trip-1",
    today: TODAY,
  });
  return { ...trip, stampLabels };
}

interface Deferred {
  resolve: (change: TripChange) => void;
  reject: (error: Error) => void;
  promise: Promise<TripChange>;
}

function deferred(): Deferred {
  let resolve!: (change: TripChange) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<TripChange>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { resolve, reject, promise };
}

/** A fake source whose setStampLabels calls are recorded and resolved by the test, one at a time. */
function fakeSource() {
  const calls: {
    tripId: string;
    slot1: string | null;
    slot2: string | null;
    deferred: Deferred;
  }[] = [];
  const setStampLabels = vi.fn((tripId: string, slot1: string | null, slot2: string | null) => {
    const call = { tripId, slot1, slot2, deferred: deferred() };
    calls.push(call);
    return call.deferred.promise;
  });
  const source = { setStampLabels } as unknown as TripsSource;
  return { source, calls, setStampLabels };
}

function confirm(trip: LifecycleTrip): TripChange {
  return { trip, signals: SIGNALS };
}

describe("useStampLabelWrites: the per-trip chain and the baseline after a failure", () => {
  it("issues a second write for a trip only after the first settles, and carries its confirmed slot 1", async () => {
    const screen: StampLabels = [null, null];
    const { result } = renderHook(() => useStampLabelWrites());
    const { source, calls, setStampLabels } = fakeSource();

    let writeA!: Promise<unknown>;
    let writeB!: Promise<unknown>;
    act(() => {
      writeA = result.current.write(
        source,
        "trip-1",
        {
          slot1: "Sunset",
          slot2: null,
          changed: [true, false],
        } satisfies LabelEdit,
        screen,
      );
      writeB = result.current.write(
        source,
        "trip-1",
        {
          slot1: null,
          slot2: "Harbour",
          changed: [false, true],
        } satisfies LabelEdit,
        screen,
      );
    });

    // While A is pending, B must not reach the source (give queued microtasks a turn to run).
    await waitFor(() => expect(setStampLabels).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(setStampLabels).toHaveBeenCalledTimes(1);
    expect(calls[0]).toMatchObject({ tripId: "trip-1", slot1: "Sunset", slot2: null });
    expect(result.current.pending.has("trip-1")).toBe(true);

    // A settles with slot 1 confirmed.
    const confirmedA = makeTrip(["Sunset", null]);
    await act(async () => {
      calls[0].deferred.resolve(confirm(confirmedA));
      await writeA;
    });

    // Only now does B run, over A's confirmed slot 1.
    await waitFor(() => expect(setStampLabels).toHaveBeenCalledTimes(2));
    expect(calls[1]).toMatchObject({ tripId: "trip-1", slot1: "Sunset", slot2: "Harbour" });

    const confirmedB = makeTrip(["Sunset", "Harbour"]);
    await act(async () => {
      calls[1].deferred.resolve(confirm(confirmedB));
      await writeB;
    });
    expect(result.current.pending.size).toBe(0);
  });

  it("after a failed write, the next write keeps the trip's confirmed slot 2 and clears pending", async () => {
    // The trip already holds a confirmed slot 2; the failing write A would have touched slot 1.
    const screen: StampLabels = [null, "Harbour"];
    const { result } = renderHook(() => useStampLabelWrites());
    const { source, calls, setStampLabels } = fakeSource();

    let writeA!: Promise<unknown>;
    let writeB!: Promise<unknown>;
    act(() => {
      writeA = result.current.write(
        source,
        "trip-1",
        {
          slot1: "Sunset",
          slot2: null,
          changed: [true, false],
        } satisfies LabelEdit,
        screen,
      );
      writeB = result.current.write(
        source,
        "trip-1",
        {
          slot1: "Market",
          slot2: null,
          changed: [true, false],
        } satisfies LabelEdit,
        screen,
      );
    });
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({ slot1: "Sunset", slot2: "Harbour" });

    // A rejects; B is then issued and must send the confirmed slot 2, not null.
    await act(async () => {
      calls[0].deferred.reject(new Error("boom"));
      await expect(writeA).rejects.toThrow("boom");
    });

    await waitFor(() => expect(setStampLabels).toHaveBeenCalledTimes(2));
    expect(calls[1]).toMatchObject({ tripId: "trip-1", slot1: "Market", slot2: "Harbour" });

    await act(async () => {
      calls[1].deferred.resolve(confirm(makeTrip(["Market", "Harbour"])));
      await writeB;
    });
    expect(result.current.pending.size).toBe(0);
  });
});

describe("useStampLabelWrites: the overlay picks the newer copy of a trip", () => {
  const SAVED_AT = "2026-10-16T10:00:00.000Z";

  /** Confirm `saved` from here, then lay the overlay over a copy a screen loaded. */
  function overlayAfterRecord(
    saved: LifecycleTrip,
    loaded: LifecycleTrip,
  ): readonly LifecycleTrip[] {
    const { result } = renderHook(() => useStampLabelWrites());
    act(() => result.current.record(saved));
    return result.current.overlay([loaded]);
  }

  it("a copy loaded after the confirmed write (newer updatedAt) wins", () => {
    const saved = { ...makeTrip(["Sunset", null]), updatedAt: SAVED_AT };
    const loaded = { ...makeTrip([null, "Harbour"]), updatedAt: "2026-10-16T11:00:00.000Z" };
    expect(overlayAfterRecord(saved, loaded)[0]).toBe(loaded);
  });

  it.each([
    ["an equal", SAVED_AT],
    ["an older", "2026-10-16T09:00:00.000Z"],
  ])("a copy with %s updatedAt is replaced by the confirmed trip", (_name, updatedAt) => {
    const saved = { ...makeTrip(["Sunset", null]), updatedAt: SAVED_AT };
    const loaded = { ...makeTrip([null, "Harbour"]), updatedAt };
    expect(overlayAfterRecord(saved, loaded)[0]).toEqual(saved);
  });

  it("a confirmed copy without updatedAt lays only its labels over the loaded trip", () => {
    const saved = makeTrip(["Sunset", null]);
    const loaded = { ...makeTrip([null, "Harbour"]), name: "Loaded copy", updatedAt: SAVED_AT };
    expect(overlayAfterRecord(saved, loaded)[0]).toEqual({
      ...loaded,
      stampLabels: ["Sunset", null],
    });
  });
});

describe("useStampLabelWrites: with no predecessor, the base is the confirmed trip", () => {
  it("builds the write on the provider's labels when the screen's labels are stale", async () => {
    const { result } = renderHook(() => useStampLabelWrites());
    act(() => result.current.record(makeTrip(["Sunset", null])));
    const { source, calls, setStampLabels } = fakeSource();

    let write!: Promise<unknown>;
    act(() => {
      write = result.current.write(
        source,
        "trip-1",
        {
          slot1: null,
          slot2: "Harbour",
          changed: [false, true],
        } satisfies LabelEdit,
        [null, null],
      );
    });
    await waitFor(() => expect(setStampLabels).toHaveBeenCalledTimes(1));
    expect(calls[0]).toMatchObject({ tripId: "trip-1", slot1: "Sunset", slot2: "Harbour" });

    await act(async () => {
      calls[0].deferred.resolve(confirm(makeTrip(["Sunset", "Harbour"])));
      await write;
    });
    expect(result.current.pending.size).toBe(0);
  });
});
