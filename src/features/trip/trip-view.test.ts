import { describe, expect, it } from "vitest";
import type { TripItem } from "@/domain/trip";
import type { LifecycleTrip } from "@/domain/trip-lifecycle";
import { sampleLifecycleState } from "@/features/trips/fixtures";
import { bagGate, isComplete, packedAnnouncement } from "./trip-view";

const trips = () => sampleLifecycleState().trips;
const sanDiego = () => trips().find((trip) => trip.id === "san-diego")!;
const lisbon = () => trips().find((trip) => trip.id === "lisbon")!;
const withItems = (
  trip: LifecycleTrip,
  patch: (item: TripItem) => Partial<TripItem>,
): LifecycleTrip => ({ ...trip, items: trip.items.map((item) => ({ ...item, ...patch(item) })) });

describe("isComplete", () => {
  it("is true at or above the quantity", () => {
    expect(isComplete({ packed: 2, qty: 2 })).toBe(true);
    expect(isComplete({ packed: 3, qty: 2 })).toBe(true);
    expect(isComplete({ packed: 1, qty: 2 })).toBe(false);
  });
});

describe("bagGate", () => {
  it("is waiting while Bathroom contents are unchecked, with counts", () => {
    expect(bagGate(sanDiego())).toEqual({ state: "waiting", checked: 0, total: 4 });
  });

  it("is pending once contents are all checked but the bag is outside the suitcase", () => {
    const trip = withItems(sanDiego(), (item) =>
      item.groupId === "toiletry-bag" ? { packed: item.qty } : {},
    );
    expect(bagGate(trip)).toEqual({ state: "pending", checked: 4, total: 4 });
  });

  it("is complete when the bag is in the suitcase", () => {
    expect(bagGate(lisbon())).toEqual({ state: "complete", checked: 4, total: 4 });
  });

  it("has no gate without Bathroom items", () => {
    const trip = {
      ...sanDiego(),
      items: sanDiego().items.filter((item) => item.groupId !== "toiletry-bag"),
    };
    expect(bagGate(trip)).toEqual({ state: "none", checked: 0, total: 0 });
  });
});

describe("packedAnnouncement", () => {
  it("announces a count as 'Name n of m packed'", () => {
    expect(packedAnnouncement({ name: "Socks", packed: 2, qty: 5 })).toBe("Socks 2 of 5 packed");
  });
});
