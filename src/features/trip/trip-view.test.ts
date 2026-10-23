import { describe, expect, it } from "vitest";
import type { TripItem } from "@/domain/trip";
import type { LifecycleTrip } from "@/domain/trip-lifecycle";
import { sampleLifecycleState } from "@/features/trips/fixtures";
import {
  bagGate,
  checkLabel,
  completeCount,
  isComplete,
  leavesEyebrow,
  packedAnnouncement,
  progress,
  sectionLinks,
  showReviewPrompt,
  showToiletries,
  tripSections,
  visibleItems,
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
      "Makeup",
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

describe("visibleItems", () => {
  const items = sanDiego().items;
  it("'all' keeps everything and 'still' keeps only unfinished items", () => {
    expect(visibleItems(items, "all")).toBe(items);
    const still = visibleItems(items, "still");
    expect(still.every((item) => item.packed < item.qty)).toBe(true);
    expect(still.length).toBeLessThan(items.length);
    expect(visibleItems([], "still")).toEqual([]);
  });
});

describe("bagGate", () => {
  it("is waiting while Bathroom contents are unchecked, with counts", () => {
    expect(bagGate(sanDiego())).toEqual({ state: "waiting", checked: 0, total: 5 });
  });

  it("is pending once contents are all checked but the bag is outside the suitcase", () => {
    const trip = withItems(sanDiego(), (item) =>
      item.groupId === "toiletry-bag" ? { packed: item.qty } : {},
    );
    expect(bagGate(trip)).toEqual({ state: "pending", checked: 5, total: 5 });
  });

  it("is complete when the bag is in the suitcase", () => {
    expect(bagGate(lisbon())).toEqual({ state: "complete", checked: 5, total: 5 });
  });

  it("has no gate without Bathroom items", () => {
    const trip = {
      ...sanDiego(),
      items: sanDiego().items.filter((item) => item.groupId !== "toiletry-bag"),
    };
    expect(bagGate(trip)).toEqual({ state: "none", checked: 0, total: 0 });
  });
});

describe("showToiletries", () => {
  it("shows the section normally, and hides it only under 'still' once it is entirely done and placed", () => {
    expect(showToiletries(sanDiego(), "all")).toBe(true);
    expect(showToiletries(sanDiego(), "still")).toBe(true);
    expect(showToiletries(lisbon(), "all")).toBe(true);
    expect(showToiletries(lisbon(), "still")).toBe(false);
  });

  it("keeps it under 'still' when the bag still needs placing, and never shows it with no Bathroom items", () => {
    const pending = withItems(sanDiego(), (item) =>
      item.groupId === "toiletry-bag" ? { packed: item.qty } : {},
    );
    expect(showToiletries(pending, "still")).toBe(true);
    const none = {
      ...sanDiego(),
      items: sanDiego().items.filter((item) => item.groupId !== "toiletry-bag"),
    };
    expect(showToiletries(none, "all")).toBe(false);
  });
});

describe("progress", () => {
  it("counts packed units, with the bag gate as one extra, and rounds the percentage", () => {
    expect(progress(sanDiego())).toMatchObject({ packed: 6, total: 32, percent: 19 });
    expect(progress(lisbon())).toMatchObject({ percent: 100 });
    const third = {
      ...sanDiego(),
      items: [{ ...sanDiego().items[0], qty: 3, packed: 2 }],
      toiletryBagPacked: false,
    };
    expect(progress(third)).toEqual({ packed: 2, total: 3, percent: 67 });
  });

  it("is 0% for a trip with no items", () => {
    expect(progress({ ...sanDiego(), items: [] })).toEqual({ packed: 0, total: 0, percent: 0 });
  });
});

describe("showReviewPrompt", () => {
  it("shows only when everything is packed and the trip is not yet Ready", () => {
    expect(showReviewPrompt(sanDiego())).toBe(false);
    expect(showReviewPrompt(lisbon())).toBe(false);
    expect(showReviewPrompt({ ...lisbon(), ready: false })).toBe(true);
  });
});

describe("labels", () => {
  const socks = { name: "Socks", packed: 2, qty: 5 };
  it("names the check action by what it will do", () => {
    expect(checkLabel({ ...sanDiego().items[0], name: "Socks", packed: 0, qty: 2 })).toBe(
      "Pack all Socks",
    );
    expect(checkLabel({ ...sanDiego().items[0], name: "Socks", packed: 2, qty: 2 })).toBe(
      "Packed, mark Socks unpacked",
    );
  });

  it("announces a count as 'Name n of m packed'", () => {
    expect(packedAnnouncement(socks)).toBe("Socks 2 of 5 packed");
  });
});

describe("leavesEyebrow", () => {
  it("counts down, then reads Under way once the trip has started", () => {
    expect(leavesEyebrow(12)).toBe("Leaves in 12 days");
    expect(leavesEyebrow(2)).toBe("Leaves in 2 days");
    expect(leavesEyebrow(1)).toBe("Leaves tomorrow");
    expect(leavesEyebrow(0)).toBe("Leaves today");
    expect(leavesEyebrow(-3)).toBe("Under way");
  });
});

describe("completeCount", () => {
  it("counts items packed to their quantity", () => {
    expect(
      completeCount([
        { packed: 2, qty: 2 },
        { packed: 1, qty: 2 },
        { packed: 0, qty: 1 },
        { packed: 3, qty: 3 },
      ]),
    ).toBe(2);
    expect(completeCount([])).toBe(0);
  });
});

describe("sectionLinks", () => {
  it("lists the main section always, and the others only when they have a place on the page", () => {
    const sections = { main: [{}, {}], toiletries: [{}], returns: [], packLast: [{}] } as never;
    expect(sectionLinks(sections, false)).toEqual([
      { target: "block-main", label: "Everyday & occasion", count: 2 },
      { target: "block-packlast", label: "Pack last", count: 1 },
    ]);
    expect(sectionLinks(sections, true).map((link) => link.target)).toEqual([
      "block-main",
      "block-toiletries",
      "block-packlast",
    ]);
    const withReturn = { main: [], toiletries: [], returns: [{}], packLast: [] } as never;
    expect(sectionLinks(withReturn, false).map((link) => link.target)).toEqual([
      "block-main",
      "block-return",
    ]);
  });
});
