import { describe, expect, it } from "vitest";
import { TOILETRY_GROUP_ID } from "@/domain/toiletry-bag";
import { sampleLifecycleState } from "@/features/trips/fixtures";
import type { LifecycleTrip } from "@/domain/trip-lifecycle";
import { readyBlocker, revocationReason } from "./review-view";

const base = () => sampleLifecycleState().trips.find((trip) => trip.id === "san-diego")!;
const packed = (trip: LifecycleTrip): LifecycleTrip => ({
  ...trip,
  items: trip.items.map((item) => ({ ...item, packed: item.qty })),
});
const withBag = (trip: LifecycleTrip, placed: boolean): LifecycleTrip => ({
  ...trip,
  toiletryBagPacked: placed,
});
const noToiletries = (trip: LifecycleTrip): LifecycleTrip => ({
  ...trip,
  items: trip.items.filter((item) => item.groupId !== TOILETRY_GROUP_ID),
});

describe("readyBlocker", () => {
  it("counts the items still to check, with the right plural", () => {
    const trip = packed(base());
    const one = {
      ...trip,
      items: trip.items.map((item, i) => (i === 0 ? { ...item, packed: 0 } : item)),
    };
    expect(readyBlocker(one)).toBe("Check off 1 more item");
    const two = {
      ...trip,
      items: trip.items.map((item, i) => (i < 2 ? { ...item, packed: 0 } : item)),
    };
    expect(readyBlocker(two)).toBe("Check off 2 more items");
  });

  it("asks for the bag once everything is checked and toiletries exist", () => {
    expect(readyBlocker(withBag(packed(base()), false))).toBe(
      "Confirm your toiletry bag is in the suitcase.",
    );
  });

  it("is null when everything is packed and the bag is placed, or there are no toiletries", () => {
    expect(readyBlocker(withBag(packed(base()), true))).toBeNull();
    expect(readyBlocker(withBag(noToiletries(packed(base())), false))).toBeNull();
  });
});

describe("revocationReason", () => {
  const ready = { ...withBag(packed(base()), true), ready: true };

  it("is null unless a Ready trip stopped being Ready", () => {
    expect(revocationReason(ready, ready)).toBeNull();
    expect(revocationReason(base(), base())).toBeNull();
    expect(revocationReason(base(), ready)).toBeNull();
  });

  it("names an unchecked item", () => {
    const after = {
      ...ready,
      ready: false,
      items: ready.items.map((item, i) => (i === 0 ? { ...item, packed: 0 } : item)),
    };
    expect(revocationReason(ready, after)).toBe("an item was unchecked");
  });

  it("names the bag when it was taken out of the suitcase", () => {
    expect(revocationReason(ready, { ...ready, ready: false, toiletryBagPacked: false })).toBe(
      "the toiletry bag is no longer in the suitcase",
    );
  });

  it("does not blame the bag on a trip that has no toiletries", () => {
    const bare = noToiletries(ready);
    expect(revocationReason(bare, { ...bare, ready: false, toiletryBagPacked: false })).toBe(
      "your list changed",
    );
  });

  it("falls back to a general reason for any other revoking change", () => {
    expect(revocationReason(ready, { ...ready, ready: false })).toBe("your list changed");
  });
});
