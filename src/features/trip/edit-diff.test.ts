import { describe, expect, it } from "vitest";
import { calculateSuggestions } from "@/domain/calc";
import { recalculateSuggestions } from "@/domain/item-ops";
import { locationById } from "@/domain/locations";
import { setPacked } from "@/domain/readiness";
import type { LifecycleTrip } from "@/domain/trip-lifecycle";
import { addDays, type TripStop } from "@/domain/trip-stops";
import { sampleLifecycleState } from "@/features/trips/fixtures";
import {
  changeCount,
  dayMonth,
  editChanges,
  routeNights,
  saveLabel,
  type EditDraft,
} from "./edit-diff";

const TODAY = "2026-10-16";
const base = (): LifecycleTrip => sampleLifecycleState().trips[0]; // San Diego, 2026-10-23 to 2026-10-27
const stop = (id: string, arrive: string, leave: string): TripStop => ({
  location: locationById(id)!,
  arrive,
  leave,
});
const same = (trip: LifecycleTrip): EditDraft => ({
  stops: [...trip.stops],
  config: trip.config,
  travelMode: trip.travelMode ?? null,
});
const changes = (trip: LifecycleTrip, patch: Partial<EditDraft>, today = TODAY) =>
  editChanges(trip, { ...same(trip), ...patch }, calculateSuggestions, today);
const row = (result: ReturnType<typeof changes>, id: string) =>
  result.rows.find((entry) => entry.id === id);

describe("editChanges: nothing edited", () => {
  it("has no rows, no dots and nothing to acknowledge", () => {
    const trip = base();
    const result = changes(trip, {});
    expect(result.rows).toEqual([]);
    expect(result.dirty).toEqual({ route: false, preferences: false });
    expect(result.valid).toBe(true);
    expect(result.needsAcknowledgement).toBe(false);
    expect(result.next).toBe(trip);
  });
});

describe("editChanges: preferences", () => {
  it("rows each changed preference (on → off), then the item whose quantity changes: old → new", () => {
    const trip = base();
    const result = changes(trip, { config: { ...trip.config, laundry: true } });
    expect(result.dirty).toEqual({ route: false, preferences: true });
    expect(result.rows[0]).toMatchObject({ kind: "pref", label: "Laundry", from: "off", to: "on" });
    const next = recalculateSuggestions(
      trip,
      { ...trip.config, laundry: true },
      calculateSuggestions,
    );
    const tops = row(result, "item-tops")!;
    const was = trip.items.find((item) => item.id === "tops")!;
    const now = next.items.find((item) => item.id === "tops")!;
    expect(tops).toMatchObject({ kind: "item", from: `× ${was.qty}`, to: `× ${now.qty}` });
    // The panel's end state is the very list the recalculation makes.
    expect(result.next?.items).toEqual(next.items);
  });

  it("names every kind of preference, numbers as numbers", () => {
    const trip = base();
    const result = changes(trip, {
      config: {
        ...trip.config,
        spare: !trip.config.spare,
        returnOutfit: !trip.config.returnOutfit,
        niceAttire: true,
        occasionCount: trip.config.occasionCount + 1,
        reuseNice: !trip.config.reuseNice,
      },
    });
    const labels = result.rows.filter((entry) => entry.kind === "pref").map((entry) => entry.label);
    expect(labels).toEqual(
      [
        "Spare underwear + socks",
        "Return travel outfit",
        "Nice occasions",
        "Reuse one nice look",
      ].filter((label) => labels.includes(label)),
    );
    const occasions = row(result, "pref-occasionCount")!;
    expect(occasions).toMatchObject({
      from: String(trip.config.occasionCount),
      to: String(trip.config.occasionCount + 1),
    });
    expect(row(result, "pref-spare")).toMatchObject({ from: "on", to: "off" });
  });

  it("says 'Already packed · add N more' when a packed line grows, and nothing under an unpacked one", () => {
    const trip = setPacked(base(), "tops", base().items.find((i) => i.id === "tops")!.qty).trip;
    const grown = changes(trip, { config: { ...trip.config, returnOutfit: false } }); // one more everyday day
    const line = row(grown, "item-tops")!;
    const delta = Number(line.to.replace("× ", "")) - Number(line.from!.replace("× ", ""));
    expect(delta).toBeGreaterThan(0);
    expect(line.sub).toBe(`Already packed · add ${delta} more`);
    // The same change on an unpacked list has no sub-line.
    const plain = changes(base(), { config: { ...base().config, returnOutfit: false } });
    expect(row(plain, "item-tops")!.sub).toBeUndefined();
  });

  it("says which packed count drops, and asks for an acknowledgement", () => {
    const trip = setPacked(base(), "tops", 3).trip;
    const result = changes(trip, { config: { ...trip.config, laundry: true } });
    expect(row(result, "item-tops")!.sub).toBe("Packed 3 → 2");
    expect(result.needsAcknowledgement).toBe(true);
  });

  it("a removed suggestion is a row, remembered when it was packed, and needs the acknowledgement", () => {
    const trip = setPacked(base(), "nice-shoes", 1).trip;
    const result = changes(trip, { config: { ...trip.config, niceAttire: false } });
    expect(row(result, "item-nice-shoes")).toMatchObject({ to: "removed" });
    expect(row(result, "item-nice-shoes")!.sub).toMatch(/Remembered/);
    expect(result.needsAcknowledgement).toBe(true);
  });

  it("an unpacked, unedited removal is a row with no sub-line and no acknowledgement", () => {
    const result = changes(base(), { config: { ...base().config, niceAttire: false } });
    expect(row(result, "item-nice-shoes")).toMatchObject({ to: "removed", sub: undefined });
    expect(result.needsAcknowledgement).toBe(false);
  });

  it("a suggestion the preference adds is a 'new' row (optional ones say so)", () => {
    const off: LifecycleTrip = recalculateSuggestions(
      base(),
      { ...base().config, niceAttire: false },
      calculateSuggestions,
    ) as LifecycleTrip;
    const result = changes(off, { config: { ...off.config, niceAttire: true } });
    const added = result.rows.filter(
      (entry) => entry.kind === "item" && entry.to.startsWith("new"),
    );
    expect(added.length).toBeGreaterThan(0);
    expect(added[0].to).toMatch(/^new · × \d+$/);
  });

  it("Ready turns off and the bag note shows only when the Bathroom changes", () => {
    const ready: LifecycleTrip = { ...base(), ready: true, toiletryBagPacked: true };
    const result = changes(ready, { config: { ...ready.config, niceAttire: false } });
    expect(result.notes).toContain("Ready turns off. Check the list, then mark it Ready again.");
    expect(result.notes.some((note) => /Toiletry bag/.test(note))).toBe(false);
    expect(changes(base(), { config: { ...base().config, laundry: true } }).notes).toEqual([]);
  });
});

describe("editChanges: the earlier counting rule (#295)", () => {
  // Saved before the arrival-day rule: 3 everyday days stored where today's rule gives 4, and the quantities follow it.
  const stale = (): LifecycleTrip => ({
    ...base(),
    dailyDays: 3,
    items: base().items.map((item) => (item.id === "tops" ? { ...item, qty: 3 } : item)),
  });

  it("brings an out-of-date trip up to date on save, with unchanged preferences", () => {
    const result = changes(stale(), {});
    expect(result.applyPreferences).toBe(true);
    expect(row(result, "item-tops")).toMatchObject({ from: "× 3", to: "× 4" });
    expect(result.dirty).toEqual({ route: false, preferences: false });
  });

  it("a route change already applies the rule itself, so preferences are not applied twice", () => {
    const trip = stale();
    const result = changes(trip, {
      stops: [stop("us-ca-san-diego", trip.start, addDays(trip.end, 2))],
    });
    expect(result.applyPreferences).toBe(false);
    expect(result.routeChanged).toBe(true);
  });
});

describe("editChanges: route and dates", () => {
  const longer = (trip: LifecycleTrip, days: number) => ({
    stops: [{ ...trip.stops[0], leave: addDays(trip.stops[0].leave, days) }],
  });

  it("Dates: old struck, new, and the nights; then the items that grow", () => {
    const trip = base();
    const result = changes(trip, longer(trip, 2));
    expect(result.dirty.route).toBe(true);
    expect(row(result, "dates")).toMatchObject({
      kind: "dates",
      label: "Dates",
      from: `${dayMonth(trip.start)} – ${dayMonth(trip.end)}`,
      to: `${dayMonth(trip.start)} – ${dayMonth(addDays(trip.end, 2))}`,
      sub: "4 → 6 nights",
    });
    const moved = recalculateSuggestions(
      { ...trip, stops: longer(trip, 2).stops as TripStop[], end: addDays(trip.end, 2) },
      trip.config,
      calculateSuggestions,
    );
    expect(result.next?.items).toEqual(moved.items);
    expect(result.rows.filter((entry) => entry.kind === "item").length).toBeGreaterThan(0);
  });

  it("the rows come in the spec's order: preferences, stops, dates, getting there, items", () => {
    const trip = base();
    const added = {
      location: locationById("pt-lisbon")!,
      arrive: trip.end,
      leave: addDays(trip.end, 3),
    };
    const result = changes(trip, {
      config: { ...trip.config, laundry: true },
      stops: [trip.stops[0], added],
      travelMode: "drive",
    });
    const order = ["pref", "stops", "dates", "travel", "item"];
    const kinds = result.rows.map((entry) => entry.kind);
    expect(kinds).toEqual([...kinds].sort((a, b) => order.indexOf(a) - order.indexOf(b)));
    expect(new Set(kinds)).toEqual(new Set(order));
  });

  it("a shorter trip shows what drops; a packed count that drops asks for the acknowledgement", () => {
    const packed = setPacked(base(), "tops", base().items.find((i) => i.id === "tops")!.qty).trip;
    const result = changes(packed, longer(packed, -2));
    expect(row(result, "dates")!.sub).toBe("4 → 2 nights");
    expect(row(result, "item-tops")!.sub).toMatch(/^Packed \d+ → \d+$/);
    expect(result.needsAcknowledgement).toBe(true);
  });

  it("a new stop is 'new stop'; its forecast line appears only beyond the 16-day window", () => {
    const trip = base();
    const added = {
      location: locationById("pt-lisbon")!,
      arrive: trip.end,
      leave: addDays(trip.end, 3),
    };
    const far = changes(trip, { stops: [trip.stops[0], added] }, "2026-10-01");
    expect(row(far, "stop-add-1")).toMatchObject({
      label: "Lisbon",
      to: "new stop",
      sub: "Its forecast appears 16 days out",
    });
    const near = changes(trip, { stops: [trip.stops[0], added] }, trip.end);
    expect(row(near, "stop-add-1")!.sub).toBeUndefined();
    // An unreadable today adds no forecast line (and never throws).
    expect(
      row(changes(trip, { stops: [trip.stops[0], added] }, ""), "stop-add-1")!.sub,
    ).toBeUndefined();
  });

  it("a removed stop is 'removed', and says packed items stay ticked", () => {
    const state = sampleLifecycleState();
    const [sanDiego, lisbon] = state.trips;
    const tour: LifecycleTrip = {
      ...sanDiego,
      stops: [
        stop("us-ca-san-diego", "2026-10-23", "2026-10-26"),
        stop("pt-lisbon", "2026-10-26", "2026-10-29"),
      ],
      end: "2026-10-29",
    };
    void lisbon;
    const result = changes(tour, { stops: [tour.stops[0]] });
    expect(row(result, "stop-remove-0")).toMatchObject({
      label: "Lisbon",
      to: "removed",
      sub: "Items you packed for it stay ticked",
    });
  });

  it("the same places in another order is one 'reordered' row", () => {
    const tour: LifecycleTrip = {
      ...base(),
      stops: [
        stop("us-ca-san-diego", "2026-10-23", "2026-10-26"),
        stop("pt-lisbon", "2026-10-26", "2026-10-29"),
      ],
      end: "2026-10-29",
    };
    const swapped = [
      { ...tour.stops[1], arrive: "2026-10-23", leave: "2026-10-26" },
      { ...tour.stops[0], arrive: "2026-10-26", leave: "2026-10-29" },
    ];
    const result = changes(tour, { stops: swapped });
    expect(result.rows[0]).toMatchObject({ id: "stop-order", label: "Stops", to: "reordered" });
  });

  it("a stop still to be chosen gives no row and no recalculation, and the draft is not valid", () => {
    const trip = base();
    const result = changes(trip, {
      stops: [trip.stops[0], { location: null, arrive: trip.end, leave: addDays(trip.end, 1) }],
    });
    expect(result.valid).toBe(false);
    expect(result.next).toBeNull();
    expect(result.rows).toEqual([]);
  });

  it("unchanged dates add no Dates row (only the order of stops moved)", () => {
    const trip = base();
    const result = changes(trip, { stops: [{ ...trip.stops[0] }] });
    expect(result.routeChanged).toBe(false);
  });
});

describe("editChanges: getting there", () => {
  it("shows the old and the new mode, and none → mode when it was never chosen", () => {
    const trip: LifecycleTrip = { ...base(), travelMode: "fly" };
    expect(row(changes(trip, { travelMode: "drive" }), "travel")).toMatchObject({
      from: "Fly",
      to: "Drive",
    });
    const never = changes({ ...base(), travelMode: null }, { travelMode: "other" });
    expect(row(never, "travel")!.from).toBeUndefined();
    expect(row(never, "travel")!.to).toBe("Train or other");
    expect(never.dirty.route).toBe(true);
    expect(never.travelChanged).toBe(true);
  });

  it("clearing back to the saved mode removes the row (the dot goes too)", () => {
    const trip: LifecycleTrip = { ...base(), travelMode: "fly" };
    const result = changes(trip, { travelMode: "fly" });
    expect(result.rows).toEqual([]);
    expect(result.dirty.route).toBe(false);
  });
});

describe("labels and small helpers", () => {
  it("counts changes and labels the Save button", () => {
    expect(changeCount(1)).toBe("1 change");
    expect(changeCount(5)).toBe("5 changes");
    expect(saveLabel(0)).toBe("Save changes");
    expect(saveLabel(1)).toBe("Save 1 change");
    expect(saveLabel(5)).toBe("Save 5 changes");
  });

  it("the N in 'Save N changes' is the number of rows", () => {
    const trip = base();
    const result = changes(trip, {
      config: { ...trip.config, laundry: true },
      travelMode: "drive",
    });
    expect(saveLabel(result.rows.length)).toBe(`Save ${result.rows.length} changes`);
    expect(result.rows.length).toBeGreaterThan(2);
  });

  it("formats a day and month, blank for a bad date", () => {
    expect(dayMonth("2026-03-14")).toBe("14 Mar");
    expect(dayMonth("nope")).toBe("");
  });

  it("nights of a route, null while the dates are blank or there is no route", () => {
    expect(routeNights([])).toBeNull();
    expect(routeNights([{ location: null, arrive: "2026-03-14", leave: "2026-03-26" }])).toBe(12);
    expect(routeNights([{ location: null, arrive: "", leave: "" }])).toBeNull();
  });
});
