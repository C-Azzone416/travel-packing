import { describe, expect, it } from "vitest";
import type { LifecycleTrip } from "@/domain/trip-lifecycle";
import { sampleLifecycleState } from "./fixtures";
import { formatDays, formatRange, quickViewModel, tripCardView } from "./view";

const TODAY = "2026-10-16";
const trips = () => sampleLifecycleState().trips;
const sanDiego = () => trips().find((trip) => trip.id === "san-diego")!;
const lisbon = () => trips().find((trip) => trip.id === "lisbon")!;
const withPatch = (trip: LifecycleTrip, patch: Partial<LifecycleTrip>): LifecycleTrip => ({
  ...trip,
  ...patch,
});

describe("formatDays", () => {
  it("pluralizes", () => {
    expect(formatDays(1)).toBe("1\u00a0day");
    expect(formatDays(0)).toBe("0\u00a0days");
    expect(formatDays(5)).toBe("5\u00a0days");
  });
});

describe("formatRange", () => {
  it("formats an inclusive range as short month and day, timezone-safe", () => {
    expect(formatRange({ start: "2026-10-23", end: "2026-10-27" })).toBe("Oct 23 – Oct 27");
    expect(formatRange({ start: "2026-12-30", end: "2027-01-02" })).toBe("Dec 30 – Jan 2");
  });

  it("falls back for missing or malformed dates", () => {
    expect(formatRange({ start: "", end: "2026-10-27" })).toBe("Choose dates – Oct 27");
    expect(formatRange({ start: "2026-10-23", end: "nope" })).toBe("Oct 23 – Choose dates");
  });
});

describe("tripCardView", () => {
  it("describes an upcoming, partly packed trip with no eyebrow and a forecast", () => {
    const view = tripCardView(sanDiego(), TODAY, "upcoming");
    expect(view).toMatchObject({
      id: "san-diego",
      destination: "San Diego",
      place: "California, United States",
      eyebrow: null,
      ready: false,
      packed: 6,
      total: 30,
      remaining: 24,
      percent: 20,
      range: "Oct 23 – Oct 27",
      days: 5,
      forecast: "Close forecast",
      canArchive: true,
      canRestore: false,
    });
  });

  it("describes a past, packed and Ready trip", () => {
    const view = tripCardView(lisbon(), TODAY, "archive");
    expect(view).toMatchObject({
      eyebrow: "Past trip",
      ready: true,
      remaining: 0,
      percent: 100,
      canArchive: false,
      canRestore: false,
    });
    expect(view.packed).toBe(view.total);
  });

  it("offers Restore only for an archived trip that is still in the future", () => {
    const future = withPatch(sanDiego(), { archived: true });
    expect(tripCardView(future, TODAY, "archive")).toMatchObject({
      eyebrow: "Archived trip",
      canRestore: true,
      canArchive: false,
    });
    const pastArchived = withPatch(lisbon(), { archived: true });
    expect(tripCardView(pastArchived, TODAY, "archive")).toMatchObject({
      eyebrow: "Archived trip",
      canRestore: false,
    });
  });

  it("keeps a trip upcoming through its end date and past the day after", () => {
    const endsToday = withPatch(sanDiego(), { end: TODAY });
    expect(tripCardView(endsToday, TODAY, "upcoming").eyebrow).toBeNull();
    expect(tripCardView(endsToday, "2026-10-17", "archive").eyebrow).toBe("Past trip");
  });

  it("hides the forecast for a trip that is already past, but keeps it for an archived future trip", () => {
    expect(tripCardView(lisbon(), TODAY, "archive").forecast).toBeNull();
    expect(tripCardView(withPatch(sanDiego(), { archived: true }), TODAY, "archive").forecast).toBe(
      "Close forecast",
    );
    expect(tripCardView(sanDiego(), "2026-10-28", "archive").forecast).toBeNull();
  });

  it("has no place and no forecast without a confirmed location", () => {
    const view = tripCardView(withPatch(sanDiego(), { location: null }), TODAY, "upcoming");
    expect(view.place).toBeNull();
    expect(view.forecast).toBeNull();
  });

  it("shows only the parts of the place that exist (no dangling comma for an empty country or region)", () => {
    const location = sanDiego().location!;
    const place = (patch: object) =>
      tripCardView(
        withPatch(sanDiego(), { location: { ...location, ...patch } }),
        TODAY,
        "upcoming",
      ).place;
    expect(place({ country: "" })).toBe("California");
    expect(place({ region: "" })).toBe("United States");
    expect(place({ region: "", country: "" })).toBeNull();
  });

  it("rounds the percentage to the nearest whole number (2 of 3 is 67%, 1 of 3 is 33%)", () => {
    const base = sanDiego();
    const item = { ...base.items[0], qty: 3 };
    const twoOfThree = withPatch(base, {
      items: [{ ...item, packed: 2 }],
      toiletryBagPacked: false,
    });
    expect(tripCardView(twoOfThree, TODAY, "upcoming")).toMatchObject({
      packed: 2,
      total: 3,
      percent: 67,
    });
    const oneOfThree = withPatch(base, {
      items: [{ ...item, packed: 1 }],
      toiletryBagPacked: false,
    });
    expect(tripCardView(oneOfThree, TODAY, "upcoming")).toMatchObject({
      packed: 1,
      total: 3,
      percent: 33,
    });
    const sixOfNine = withPatch(base, {
      items: [{ ...item, qty: 8, packed: 5 }],
      toiletryBagPacked: false,
    });
    expect(tripCardView(sixOfNine, TODAY, "upcoming").percent).toBe(63);
  });

  it("reports 0% for a trip with no items instead of dividing by zero", () => {
    const empty = withPatch(sanDiego(), { items: [], toiletryBagPacked: false });
    expect(tripCardView(empty, TODAY, "upcoming")).toMatchObject({
      total: 0,
      packed: 0,
      percent: 0,
      remaining: 0,
    });
  });
});

describe("quickViewModel", () => {
  it("'still to pack' lists only unfinished rows, grouped, with remaining counts", () => {
    const model = quickViewModel(sanDiego(), "still");
    expect(model.categories.map((entry) => entry.title)).toEqual([
      "Clothing & essentials",
      "Toiletries",
      "Return outfit",
      "Pack last",
    ]);
    const clothing = model.categories[0].rows;
    expect(clothing.find((row) => row.name === "Underwear")?.detail).toBe("2 left");
    expect(clothing.find((row) => row.name === "Everyday tops")?.detail).toBe("1 left");
    expect(clothing.some((row) => row.name === "Sleepwear")).toBe(false);
  });

  it("'all' also lists packed rows as Packed", () => {
    const model = quickViewModel(sanDiego(), "all");
    const clothing = model.categories[0].rows;
    expect(clothing.find((row) => row.name === "Sleepwear")?.detail).toBe("Packed");
    expect(model.categories.flatMap((entry) => entry.rows).length).toBeGreaterThan(
      quickViewModel(sanDiego(), "still").categories.flatMap((entry) => entry.rows).length,
    );
  });

  it("marks Pack last items and keeps toiletries in their own group", () => {
    const model = quickViewModel(sanDiego(), "all");
    const packLast = model.categories.find((entry) => entry.title === "Pack last")!;
    expect(packLast.rows.every((row) => row.packLast)).toBe(true);
    expect(packLast.rows.map((row) => row.name)).not.toContain("Toothbrush");
    const toiletries = model.categories.find((entry) => entry.title === "Toiletries")!;
    expect(toiletries.rows.map((row) => row.name)).toEqual([
      "Makeup",
      "Toothbrush",
      "Toothpaste",
      "Deodorant",
      "Contacts",
    ]);
  });

  it("is empty for a fully packed trip under 'still to pack'", () => {
    expect(quickViewModel(lisbon(), "still").categories).toEqual([]);
  });

  it("shows the toiletry bag gate in all three states", () => {
    const waiting = sanDiego();
    expect(quickViewModel(waiting, "still").bag).toEqual({
      status: "waiting",
      label: "Waiting on contents",
    });
    const contentsDone = withPatch(waiting, {
      items: waiting.items.map((item) =>
        item.groupId === "toiletry-bag" ? { ...item, packed: item.qty } : item,
      ),
    });
    expect(quickViewModel(contentsDone, "still").bag).toEqual({
      status: "pending",
      label: "Still outside suitcase",
    });
    expect(
      quickViewModel(withPatch(contentsDone, { toiletryBagPacked: true }), "still").bag,
    ).toEqual({ status: "complete", label: "In suitcase" });
  });

  it("does not modify the trip it reads", () => {
    const trip = sanDiego();
    const before = structuredClone(trip);
    quickViewModel(trip, "still");
    quickViewModel(trip, "all");
    expect(trip).toEqual(before);
  });
});
