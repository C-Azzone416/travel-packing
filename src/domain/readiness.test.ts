import { describe, expect, it } from "vitest";
import {
  addItem,
  allPacked,
  clampPacked,
  confirmBagPlacement,
  decrementPacked,
  editItemQty,
  incrementPacked,
  markNotReady,
  markReady,
  packedTotals,
  removeItem,
  revokeReadyForChange,
  setPacked,
  togglePacked,
  undoBagPlacement,
  type ChecklistChange,
  type CommandResult,
} from "./readiness";
import {
  TOILETRY_GROUP_ID,
  toiletryBagState,
  toiletryContentsComplete,
  type PackableItem,
  type ReadinessTrip,
} from "./toiletry-bag";

const shirt = (packed = 0, qty = 3): PackableItem => ({ id: "shirt", qty, packed });
const socks = (packed = 0, qty = 2): PackableItem => ({ id: "socks", qty, packed });
const brush = (packed = 0, qty = 1): PackableItem => ({
  id: "brush",
  qty,
  packed,
  groupId: TOILETRY_GROUP_ID,
});
const paste = (packed = 0, qty = 1): PackableItem => ({
  id: "paste",
  qty,
  packed,
  groupId: TOILETRY_GROUP_ID,
});

function trip(items: PackableItem[], extra: Partial<ReadinessTrip> = {}): ReadinessTrip {
  return { items, toiletryBagPacked: false, ready: false, ...extra };
}

/** Fully packed, no toiletries. */
const packedPlain = (extra: Partial<ReadinessTrip> = {}) => trip([shirt(3), socks(2)], extra);
/** Fully packed with toiletries; bag placed by default. */
const packedWithBag = (extra: Partial<ReadinessTrip> = {}) =>
  trip([shirt(3), brush(1), paste(1)], { toiletryBagPacked: true, ...extra });

function ok<T>(result: CommandResult<T>) {
  if (!result.ok) throw new Error(`expected ok, got ${result.reason}`);
  return result;
}

function packedOf(t: ReadinessTrip, id: string): number {
  return t.items.find((item) => item.id === id)!.packed;
}

describe("clampPacked", () => {
  it.each([
    [-3, 3, 0],
    [0, 3, 0],
    [2, 3, 2],
    [9, 3, 3],
    [1.9, 3, 1],
    [Number.NaN, 3, 0],
    [Number.POSITIVE_INFINITY, 3, 0],
  ])("clamp(%s, qty %s) = %s", (packed, qty, expected) => {
    expect(clampPacked(packed, qty)).toBe(expected);
  });
});

describe("allPacked", () => {
  it.each([
    ["no items", trip([]), false],
    ["all packed, no toiletries", packedPlain(), true],
    ["all packed, toiletries, bag outside", packedWithBag({ toiletryBagPacked: false }), false],
    ["all packed, toiletries, bag in suitcase", packedWithBag(), true],
    [
      "one item short, bag in suitcase",
      trip([shirt(2), brush(1)], { toiletryBagPacked: true }),
      false,
    ],
    ["packed above qty counts as packed", trip([shirt(5)]), true],
  ])("%s", (_name, t, expected) => {
    expect(allPacked(t)).toBe(expected);
  });
});

describe("packedTotals", () => {
  it.each([
    ["no toiletries", trip([shirt(2), socks(5)]), { packed: 4, total: 5 }],
    ["toiletries, bag outside", trip([shirt(3), brush(1)]), { packed: 4, total: 5 }],
    [
      "toiletries, bag in suitcase",
      trip([shirt(3), brush(1)], { toiletryBagPacked: true }),
      { packed: 5, total: 5 },
    ],
    ["empty", trip([]), { packed: 0, total: 0 }],
  ])("%s", (_name, t, expected) => {
    expect(packedTotals(t)).toEqual(expected);
  });
});

describe("toiletry selectors", () => {
  it.each([
    ["none", trip([shirt(3)]), false, "CONTENTS_INCOMPLETE"],
    ["some", trip([brush(1), paste(0)]), false, "CONTENTS_INCOMPLETE"],
    ["all, bag outside", trip([brush(1), paste(1)]), true, "ALL_CHECKED_BAG_OUTSIDE"],
    [
      "all, bag in suitcase",
      trip([brush(1), paste(1)], { toiletryBagPacked: true }),
      true,
      "BAG_IN_SUITCASE",
    ],
  ])("%s", (_name, t, complete, state) => {
    expect(toiletryContentsComplete(t)).toBe(complete);
    expect(toiletryBagState(t)).toBe(state);
  });
});

describe("packed changes", () => {
  it.each([
    [
      "toggle empty item fills it",
      (t: ReadinessTrip) => togglePacked(t, "shirt"),
      trip([shirt(0)]),
      3,
    ],
    [
      "toggle full item empties it",
      (t: ReadinessTrip) => togglePacked(t, "shirt"),
      trip([shirt(3)]),
      0,
    ],
    [
      "toggle partial item fills it",
      (t: ReadinessTrip) => togglePacked(t, "shirt"),
      trip([shirt(1)]),
      3,
    ],
    ["increment", (t: ReadinessTrip) => incrementPacked(t, "shirt"), trip([shirt(1)]), 2],
    ["decrement", (t: ReadinessTrip) => decrementPacked(t, "shirt"), trip([shirt(2)]), 1],
    ["set below zero clamps", (t: ReadinessTrip) => setPacked(t, "shirt", -3), trip([shirt(2)]), 0],
    ["set above qty clamps", (t: ReadinessTrip) => setPacked(t, "shirt", 9), trip([shirt(2)]), 3],
  ])("%s", (_name, command, start, expected) => {
    expect(packedOf(ok(command(start)).trip, "shirt")).toBe(expected);
  });

  it.each([
    ["increment at qty", (t: ReadinessTrip) => incrementPacked(t, "shirt"), trip([shirt(3)])],
    ["decrement at zero", (t: ReadinessTrip) => decrementPacked(t, "shirt"), trip([shirt(0)])],
    ["set to current value", (t: ReadinessTrip) => setPacked(t, "shirt", 3), trip([shirt(3)])],
  ])("no-op: %s returns the same trip and keeps Ready", (_name, command, start) => {
    const ready = { ...start, ready: true };
    const result = ok(command(ready));
    expect(result.trip).toBe(ready);
    expect(result.trip.ready).toBe(true);
  });

  it.each([
    ["toggle", (t: ReadinessTrip) => togglePacked(t, "nope")],
    ["increment", (t: ReadinessTrip) => incrementPacked(t, "nope")],
    ["decrement", (t: ReadinessTrip) => decrementPacked(t, "nope")],
    ["set", (t: ReadinessTrip) => setPacked(t, "nope", 1)],
    ["editItemQty", (t: ReadinessTrip) => editItemQty(t, "nope", 2)],
    ["removeItem", (t: ReadinessTrip) => removeItem(t, "nope")],
  ])("%s on an unknown item is rejected without change", (_name, command) => {
    const start = packedPlain();
    expect(command(start)).toEqual({ ok: false, reason: "ITEM_NOT_FOUND", trip: start });
  });

  it("revokes Ready when any item is unchecked and keeps other packed counts", () => {
    const start = packedPlain({ ready: true });
    const result = ok(togglePacked(start, "shirt")).trip;
    expect(result.ready).toBe(false);
    expect(packedOf(result, "shirt")).toBe(0);
    expect(packedOf(result, "socks")).toBe(2);
  });

  it("revokes Ready on a partial decrement", () => {
    expect(ok(decrementPacked(packedPlain({ ready: true }), "socks")).trip.ready).toBe(false);
  });

  it("never sets Ready when the last item is completed, but signals a review prompt", () => {
    const result = ok(togglePacked(trip([shirt(3), socks(1)]), "socks"));
    expect(result.trip.ready).toBe(false);
    expect(allPacked(result.trip)).toBe(true);
    expect(result.signals.reviewPrompt).toBe(true);
  });

  it("does not signal a review prompt while items remain or when already Ready", () => {
    expect(ok(togglePacked(trip([shirt(0), socks(0)]), "shirt")).signals.reviewPrompt).toBe(false);
    expect(ok(decrementPacked(packedPlain({ ready: true }), "shirt")).signals.reviewPrompt).toBe(
      false,
    );
  });

  it("leaves bag placement alone for non-toiletry changes", () => {
    const result = ok(decrementPacked(packedWithBag(), "shirt")).trip;
    expect(result.toiletryBagPacked).toBe(true);
    expect(result.ready).toBe(false);
  });

  it("does not mutate its input", () => {
    const start = packedWithBag({ ready: true });
    const snapshot = structuredClone(start);
    const result = ok(togglePacked(start, "brush")).trip;
    expect(start).toEqual(snapshot);
    expect(result).not.toBe(start);
    expect(result.items).not.toBe(start.items);
  });

  it("preserves extra fields on the trip and its items", () => {
    const start = {
      ...trip([{ ...shirt(0), name: "Shirt" } as PackableItem]),
      destination: "Sample City",
    };
    const result = ok(togglePacked(start, "shirt")).trip;
    expect(result.destination).toBe("Sample City");
    expect((result.items[0] as PackableItem & { name: string }).name).toBe("Shirt");
  });
});

describe("toiletry bag", () => {
  it("prompts for placement when the last Bathroom item is checked, without confirming it", () => {
    const result = ok(togglePacked(trip([brush(1), paste(0)]), "paste"));
    expect(result.signals.promptBagPlacement).toBe(true);
    expect(result.trip.toiletryBagPacked).toBe(false);
    expect(toiletryBagState(result.trip)).toBe("ALL_CHECKED_BAG_OUTSIDE");
  });

  it("does not prompt when Bathroom contents are still incomplete", () => {
    expect(ok(togglePacked(trip([brush(0), paste(0)]), "paste")).signals.promptBagPlacement).toBe(
      false,
    );
  });

  it("does not prompt for a non-Bathroom item or when the bag is already placed", () => {
    expect(ok(togglePacked(trip([shirt(2), brush(1)]), "shirt")).signals.promptBagPlacement).toBe(
      false,
    );
    const placed = trip([brush(0), paste(1)], { toiletryBagPacked: true });
    expect(ok(setPacked(placed, "brush", 1)).signals.promptBagPlacement).toBe(false);
  });

  it("rejects confirming placement with incomplete or missing contents", () => {
    const incomplete = trip([brush(1), paste(0)]);
    expect(confirmBagPlacement(incomplete)).toEqual({
      ok: false,
      reason: "CONTENTS_INCOMPLETE",
      trip: incomplete,
    });
    const none = trip([shirt(3)]);
    expect(confirmBagPlacement(none)).toEqual({
      ok: false,
      reason: "CONTENTS_INCOMPLETE",
      trip: none,
    });
  });

  it("confirms placement once contents are complete and leaves Ready unchanged", () => {
    const result = ok(confirmBagPlacement(trip([brush(1), paste(1)])));
    expect(result.trip.toiletryBagPacked).toBe(true);
    expect(result.trip.ready).toBe(false);
  });

  it("confirming twice is a no-op", () => {
    const placed = packedWithBag();
    expect(ok(confirmBagPlacement(placed)).trip).toBe(placed);
  });

  it("undo placement keeps content checks and revokes Ready", () => {
    const result = ok(undoBagPlacement(packedWithBag({ ready: true }))).trip;
    expect(result.toiletryBagPacked).toBe(false);
    expect(result.ready).toBe(false);
    expect(packedOf(result, "brush")).toBe(1);
    expect(packedOf(result, "paste")).toBe(1);
    expect(toiletryBagState(result)).toBe("ALL_CHECKED_BAG_OUTSIDE");
  });

  it("undo placement without a placed bag is a no-op", () => {
    const start = trip([brush(1), paste(1)], { ready: false });
    expect(ok(undoBagPlacement(start)).trip).toBe(start);
  });

  it("unchecking any Bathroom content invalidates placement and Ready", () => {
    for (const command of [
      (t: ReadinessTrip) => togglePacked(t, "paste"),
      (t: ReadinessTrip) => decrementPacked(t, "paste"),
    ]) {
      const result = ok(command(packedWithBag({ ready: true }))).trip;
      expect(result.toiletryBagPacked).toBe(false);
      expect(result.ready).toBe(false);
    }
  });
});

describe("editItemQty", () => {
  it("revokes Ready, keeps packed up to the new qty, and leaves the bag for non-Bathroom items", () => {
    const result = ok(editItemQty(packedWithBag({ ready: true }), "shirt", 2)).trip;
    expect(result.ready).toBe(false);
    expect(packedOf(result, "shirt")).toBe(2);
    expect(result.toiletryBagPacked).toBe(true);
  });

  it("revokes Ready even when the quantity is unchanged", () => {
    expect(ok(editItemQty(packedPlain({ ready: true }), "shirt", 3)).trip.ready).toBe(false);
  });

  it("invalidates bag placement when a Bathroom quantity changes", () => {
    const up = ok(editItemQty(packedWithBag({ ready: true }), "brush", 2)).trip;
    expect(up.toiletryBagPacked).toBe(false);
    expect(up.ready).toBe(false);
    const down = ok(
      editItemQty(trip([brush(2, 2), paste(1)], { toiletryBagPacked: true }), "brush", 1),
    ).trip;
    expect(down.toiletryBagPacked).toBe(false);
    expect(packedOf(down, "brush")).toBe(1);
  });

  it("keeps bag placement when a Bathroom quantity is edited to the same value", () => {
    const result = ok(editItemQty(packedWithBag(), "brush", 1)).trip;
    expect(result.toiletryBagPacked).toBe(true);
    expect(result.ready).toBe(false);
  });

  it.each([
    [0, 1],
    [-4, 1],
    [2.8, 2],
    [Number.NaN, 1],
  ])("normalizes qty %s to %s", (qty, expected) => {
    expect(ok(editItemQty(trip([shirt(0)]), "shirt", qty)).trip.items[0].qty).toBe(expected);
  });
});

describe("addItem / removeItem", () => {
  it("adding an item revokes Ready and clamps its packed count", () => {
    const result = ok(addItem(packedPlain({ ready: true }), { id: "hat", qty: 1, packed: 4 })).trip;
    expect(result.ready).toBe(false);
    expect(result.items.at(-1)).toEqual({ id: "hat", qty: 1, packed: 1 });
  });

  it("adding a non-Bathroom item keeps bag placement", () => {
    expect(
      ok(addItem(packedWithBag(), { id: "hat", qty: 1, packed: 0 })).trip.toiletryBagPacked,
    ).toBe(true);
  });

  it("adding a Bathroom item invalidates bag placement", () => {
    const result = ok(addItem(packedWithBag({ ready: true }), { ...paste(0), id: "floss" })).trip;
    expect(result.toiletryBagPacked).toBe(false);
    expect(result.ready).toBe(false);
  });

  it("rejects a duplicate id", () => {
    const start = packedPlain();
    expect(addItem(start, shirt())).toEqual({ ok: false, reason: "DUPLICATE_ITEM", trip: start });
  });

  it("removing an item revokes Ready", () => {
    const result = ok(removeItem(packedWithBag({ ready: true }), "shirt")).trip;
    expect(result.ready).toBe(false);
    expect(result.items.map((item) => item.id)).toEqual(["brush", "paste"]);
    expect(result.toiletryBagPacked).toBe(true);
  });

  it("removing a Bathroom item invalidates bag placement", () => {
    const result = ok(removeItem(packedWithBag(), "paste")).trip;
    expect(result.toiletryBagPacked).toBe(false);
  });

  it("removing the last Bathroom item leaves a trip that needs no bag step", () => {
    const result = ok(
      removeItem(trip([shirt(3), brush(1)], { toiletryBagPacked: true }), "brush"),
    ).trip;
    expect(result.toiletryBagPacked).toBe(false);
    expect(allPacked(result)).toBe(true);
    expect(ok(markReady(result)).trip.ready).toBe(true);
  });
});

describe("revokeReadyForChange", () => {
  it.each<ChecklistChange>(["recalculate", "suggestion-change", "weather-accepted"])(
    "%s revokes Ready and preserves packing progress",
    (change) => {
      const start = packedWithBag({ ready: true });
      const result = ok(revokeReadyForChange(start, change)).trip;
      expect(result.ready).toBe(false);
      expect(result.items).toEqual(start.items);
      expect(result.toiletryBagPacked).toBe(true);
    },
  );

  it("is a no-op when the trip is not Ready", () => {
    const start = packedPlain();
    expect(ok(revokeReadyForChange(start, "recalculate")).trip).toBe(start);
  });
});

describe("markReady / markNotReady", () => {
  it("marks Ready when everything is packed and no toiletries exist", () => {
    expect(ok(markReady(packedPlain())).trip.ready).toBe(true);
  });

  it("marks Ready when everything is packed including the bag", () => {
    expect(ok(markReady(packedWithBag())).trip.ready).toBe(true);
  });

  it.each([
    ["items unpacked", trip([shirt(1)])],
    ["contents done but bag outside", packedWithBag({ toiletryBagPacked: false })],
    ["no items", trip([])],
  ])("rejects when %s", (_name, start) => {
    expect(markReady(start)).toEqual({ ok: false, reason: "NOT_ALL_PACKED", trip: start });
  });

  it("markReady is idempotent", () => {
    const start = packedPlain({ ready: true });
    expect(ok(markReady(start)).trip).toBe(start);
  });

  it("markNotReady preserves every packed quantity and the bag", () => {
    const start = packedWithBag({ ready: true });
    const result = ok(markNotReady(start)).trip;
    expect(result.ready).toBe(false);
    expect(result.items).toEqual(start.items);
    expect(result.toiletryBagPacked).toBe(true);
  });

  it("markNotReady on a trip that is not Ready is a no-op", () => {
    const start = packedPlain();
    expect(ok(markNotReady(start)).trip).toBe(start);
  });
});
