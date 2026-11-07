import { describe, expect, it } from "vitest";
import { locationById } from "@/domain/locations";
import type { TripConfig } from "@/domain/trip";
import type { DraftStop } from "@/domain/trip-lifecycle";
import type { TripStop } from "@/domain/trip-stops";
import { reconcile, reconcileStops } from "./edit-reconcile";

const stop = (id: string, arrive: string, leave: string): TripStop => ({
  location: locationById(id)!,
  arrive,
  leave,
});
const one = (arrive: string, leave: string) => [stop("us-ca-san-diego", arrive, leave)];
const two = (a: string, b: string, c: string) => [
  stop("us-ca-san-diego", a, b),
  stop("pt-lisbon", b, c),
];
const config: TripConfig = {
  laundry: false,
  spare: true,
  niceAttire: true,
  occasionCount: 1,
  reuseNice: true,
  returnOutfit: true,
};

describe("reconcileStops", () => {
  it("an untouched draft takes the fresh route", () => {
    const base = one("2026-10-23", "2026-10-27");
    expect(reconcileStops(base, base, one("2026-10-21", "2026-10-30"))).toEqual(
      one("2026-10-21", "2026-10-30"),
    );
  });

  it("an edited Come home is kept on top of the fresh route (the Leave change is taken)", () => {
    const base = one("2026-10-23", "2026-10-27");
    const draft = one("2026-10-23", "2026-10-28");
    expect(reconcileStops(base, draft, one("2026-10-21", "2026-10-27"))).toEqual(
      one("2026-10-21", "2026-10-28"),
    );
  });

  it("an edited Leave is kept and moves the fresh route, which keeps its own later Come home nights", () => {
    const base = two("2026-10-23", "2026-10-26", "2026-10-29");
    const draft = two("2026-10-22", "2026-10-25", "2026-10-28");
    expect(reconcileStops(base, draft, two("2026-10-23", "2026-10-26", "2026-10-31"))).toEqual(
      two("2026-10-22", "2026-10-25", "2026-10-30"),
    );
  });

  it("if the places were touched at all, the whole list is the person's", () => {
    const base = one("2026-10-23", "2026-10-27");
    const draft: DraftStop[] = [...two("2026-10-23", "2026-10-26", "2026-10-29")];
    const fresh = one("2026-10-23", "2026-10-30");
    expect(reconcileStops(base, draft, fresh)).toEqual(draft);
  });

  it("the stop group is the person's as a unit, but untouched Leave and Come home take the server's dates", () => {
    const base = two("2026-10-23", "2026-10-26", "2026-10-29");
    // The person swaps the two equal-length stops; the dates stay as they were.
    const swapped: DraftStop[] = [
      { ...base[1], arrive: "2026-10-23", leave: "2026-10-26" },
      { ...base[0], arrive: "2026-10-26", leave: "2026-10-29" },
    ];
    // Another editor moves the whole trip a day earlier.
    const fresh = two("2026-10-22", "2026-10-25", "2026-10-28");
    const out = reconcileStops(base, swapped, fresh);
    expect(out.map((entry) => entry.location?.id)).toEqual(["pt-lisbon", "us-ca-san-diego"]);
    expect([out[0].arrive, out[0].leave, out[1].arrive, out[1].leave]).toEqual([
      "2026-10-22",
      "2026-10-25",
      "2026-10-25",
      "2026-10-28",
    ]);
  });

  it("a stop edit that changes the total nights keeps the person's end when the server's end cannot fit", () => {
    const base = two("2026-10-23", "2026-10-26", "2026-10-29");
    // The person makes the first stop longer by two nights: they come home on 31 Oct (their Come home changed too).
    const longer: DraftStop[] = [
      { ...base[0], leave: "2026-10-28" },
      { ...base[1], arrive: "2026-10-28", leave: "2026-10-31" },
    ];
    // The server's trip now ends on 24 Oct (2 nights total): two stops cannot fit.
    const fresh = two("2026-10-22", "2026-10-23", "2026-10-24");
    const out = reconcileStops(base, longer, fresh);
    expect(out.map((entry) => entry.location?.id)).toEqual(["us-ca-san-diego", "pt-lisbon"]);
    expect(out[1].leave).toBe("2026-10-31"); // the conflicting endpoint stays theirs
  });

  it("with the person's Leave edited and Come home untouched, the server's end is taken when it fits", () => {
    const base = two("2026-10-23", "2026-10-26", "2026-10-29");
    const reorderedEarlier: DraftStop[] = [
      { ...base[1], arrive: "2026-10-21", leave: "2026-10-24" },
      { ...base[0], arrive: "2026-10-24", leave: "2026-10-27" },
    ];
    const fresh = two("2026-10-23", "2026-10-26", "2026-10-31");
    const out = reconcileStops(base, reorderedEarlier, fresh);
    expect(out[0].arrive).toBe("2026-10-21"); // their Leave
    expect(out[1].leave).toBe("2026-10-31"); // the server's Come home
  });

  it("a stop still to be chosen counts as touched, and an empty draft route is handled", () => {
    const base = one("2026-10-23", "2026-10-27");
    const blank: DraftStop[] = [
      base[0],
      { location: null, arrive: "2026-10-27", leave: "2026-10-28" },
    ];
    expect(reconcileStops(base, blank, base)).toEqual(blank);
    expect(reconcileStops([], [], base)).toEqual(base);
  });
});

describe("reconcile", () => {
  const stops = one("2026-10-23", "2026-10-27");
  const fresh = (patch: Partial<TripConfig>, travelMode: "fly" | "drive" | null = null) => ({
    stops,
    config: { ...config, ...patch },
    travelMode,
  });

  it("each preference key on its own: an untouched Spare takes the server value, an edited Laundry is kept", () => {
    const out = reconcile(
      { stops, config, travelMode: null },
      { stops, config: { ...config, laundry: true }, travelMode: null },
      fresh({ spare: false }),
    );
    expect(out.config).toEqual({ ...config, spare: false, laundry: true });
  });

  it("an edited preference beats the server's different value for the same key", () => {
    const out = reconcile(
      { stops, config, travelMode: null },
      { stops, config: { ...config, spare: false }, travelMode: null },
      fresh({ spare: true, occasionCount: 3 }),
    );
    expect(out.config).toMatchObject({ spare: false, occasionCount: 3 });
  });

  it("getting there: the person's choice if they changed it, else the server's", () => {
    const base = { stops, config, travelMode: null };
    expect(reconcile(base, { ...base, travelMode: "drive" }, fresh({}, "fly")).travelMode).toBe(
      "drive",
    );
    expect(reconcile(base, base, fresh({}, "fly")).travelMode).toBe("fly");
  });
});
