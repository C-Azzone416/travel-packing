import { describe, expect, it } from "vitest";
import { sampleLifecycleState } from "@/features/trips/fixtures";
import { packedState, reviewHref } from "./packed-state";

const trips = () => sampleLifecycleState().trips;
const sanDiego = () => trips().find((trip) => trip.id === "san-diego")!;
const lisbon = () => trips().find((trip) => trip.id === "lisbon")!;
const packedAll = (trip: ReturnType<typeof sanDiego>) => ({
  ...trip,
  items: trip.items.map((item) => ({ ...item, packed: item.qty })),
});

describe("packedState", () => {
  it("is open while any item is short of its quantity", () => {
    expect(packedState(sanDiego())).toBe("open");
    const almost = packedAll(sanDiego());
    almost.items[0] = { ...almost.items[0], packed: almost.items[0].qty - 1 };
    expect(packedState(almost)).toBe("open");
  });

  it("is packed when every item is full, even with the toiletry bag still outside (the bag is the Ready step)", () => {
    const trip = { ...packedAll(sanDiego()), ready: false, toiletryBagPacked: false };
    expect(packedState(trip)).toBe("packed");
  });

  it("is ready for a Ready trip, whatever the counts say", () => {
    expect(packedState(lisbon())).toBe("ready");
  });

  it("is open for a trip with no items", () => {
    expect(packedState({ items: [], ready: false })).toBe("open");
  });
});

describe("reviewHref", () => {
  it("is the Packing page with the sheet open", () => {
    expect(reviewHref("san-diego")).toBe("/trips/san-diego?review=1");
  });
});
