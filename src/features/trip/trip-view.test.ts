import { describe, expect, it } from "vitest";
import type { TripItem } from "@/domain/trip";
import type { LifecycleTrip } from "@/domain/trip-lifecycle";
import { sampleLifecycleState } from "@/features/trips/fixtures";
import {
  bagGate,
  isComplete,
  packedAnnouncement,
  showReviewPrompt,
  tripSections,
} from "./trip-view";

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

describe("tripSections", () => {
  it("splits items into everyday, Bathroom, return and Pack last, each item once", () => {
    const trip = sanDiego();
    const sections = tripSections(trip);
    expect(sections.toiletries.map((item) => item.name)).toEqual([
      "Toothbrush",
      "Toothpaste",
      "Deodorant",
      "Contacts",
    ]);
    expect(sections.returns.map((item) => item.name)).toEqual([
      "Fresh top",
      "Bottoms",
      "Underwear",
      "Socks",
    ]);
    expect(sections.main.map((item) => item.id)).toContain("tops");
    expect(sections.packLast.map((item) => item.name)).toEqual([
      "Laptop",
      "Chargers",
      "Everyday glasses",
    ]);
    const all = [
      ...sections.main,
      ...sections.toiletries,
      ...sections.returns,
      ...sections.packLast,
    ];
    expect(new Set(all.map((item) => item.id)).size).toBe(all.length);
    expect(all).toHaveLength(trip.items.length);
  });

  it("keeps Bathroom items flagged Pack last in Toiletries, not in the Pack last view", () => {
    const sections = tripSections(sanDiego());
    expect(sections.toiletries.some((item) => item.section === "packlast")).toBe(true);
    expect(sections.packLast.some((item) => item.groupId === "toiletry-bag")).toBe(false);
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

describe("showReviewPrompt", () => {
  it("shows only when everything is packed and the trip is not yet Ready", () => {
    expect(showReviewPrompt(sanDiego())).toBe(false);
    expect(showReviewPrompt(lisbon())).toBe(false);
    expect(showReviewPrompt({ ...lisbon(), ready: false })).toBe(true);
  });
});

describe("packedAnnouncement", () => {
  it("announces a count as 'Name n of m packed'", () => {
    expect(packedAnnouncement({ name: "Socks", packed: 2, qty: 5 })).toBe("Socks 2 of 5 packed");
  });
});
