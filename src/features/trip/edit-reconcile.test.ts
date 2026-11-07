import { describe, expect, it } from "vitest";
import { locationById } from "@/domain/locations";
import type { TripConfig } from "@/domain/trip";
import type { DraftStop } from "@/domain/trip-lifecycle";
import type { TripStop } from "@/domain/trip-stops";
import { reconcile, reconcileStops, settleTouched } from "./edit-reconcile";

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
const NONE = { leave: false, home: false };
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
    expect(reconcileStops(base, base, one("2026-10-21", "2026-10-30"), NONE)).toEqual(
      one("2026-10-21", "2026-10-30"),
    );
  });

  it("an edited Come home is kept on top of the fresh route (the Leave change is taken)", () => {
    const base = one("2026-10-23", "2026-10-27");
    const draft = one("2026-10-23", "2026-10-28");
    expect(
      reconcileStops(base, draft, one("2026-10-21", "2026-10-27"), {
        leave: false,
        home: true,
      }),
    ).toEqual(one("2026-10-21", "2026-10-28"));
  });

  it("an edited Leave is kept and the fresh route's later Come home is taken too (Come home was not edited)", () => {
    const base = two("2026-10-23", "2026-10-26", "2026-10-29");
    const draft = two("2026-10-22", "2026-10-25", "2026-10-28");
    expect(
      reconcileStops(base, draft, two("2026-10-23", "2026-10-26", "2026-10-31"), {
        leave: true,
        home: false,
      }),
    ).toEqual([
      { ...two("2026-10-22", "2026-10-25", "2026-10-31")[0] },
      { ...two("2026-10-22", "2026-10-25", "2026-10-31")[1] },
    ]);
  });

  it("if the places were touched at all, the whole list is the person's", () => {
    const base = one("2026-10-23", "2026-10-27");
    const draft: DraftStop[] = [...two("2026-10-23", "2026-10-26", "2026-10-29")];
    const fresh = one("2026-10-23", "2026-10-30");
    expect(reconcileStops(base, draft, fresh, { leave: false, home: true })).toEqual(draft);
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
    const out = reconcileStops(base, swapped, fresh, NONE);
    expect(out.map((entry) => entry.location?.id)).toEqual(["pt-lisbon", "us-ca-san-diego"]);
    expect([out[0].arrive, out[0].leave, out[1].arrive, out[1].leave]).toEqual([
      "2026-10-22",
      "2026-10-25",
      "2026-10-25",
      "2026-10-28",
    ]);
  });

  it("incompatible-date fallback: a lengthened route the server's end cannot fit keeps the list's own end", () => {
    const base = two("2026-10-23", "2026-10-26", "2026-10-29");
    // The person makes the first stop longer by two nights (Come home untouched).
    const longer: DraftStop[] = [
      { ...base[0], leave: "2026-10-28" },
      { ...base[1], arrive: "2026-10-28", leave: "2026-10-31" },
    ];
    // The server's trip now ends on 24 Oct (2 nights total): two stops cannot fit.
    const fresh = two("2026-10-22", "2026-10-23", "2026-10-24");
    const out = reconcileStops(base, longer, fresh, { leave: false, home: false });
    expect(out.map((entry) => entry.location?.id)).toEqual(["us-ca-san-diego", "pt-lisbon"]);
    expect(out[1].leave).toBe("2026-10-30"); // shifted to the server's Leave; the nights are theirs
  });

  it("an explicitly edited Come home survives a stop edit and a different server date", () => {
    const base = two("2026-10-23", "2026-10-26", "2026-10-29");
    const longer: DraftStop[] = [
      { ...base[0], leave: "2026-10-28" },
      { ...base[1], arrive: "2026-10-28", leave: "2026-11-01" },
    ];
    const fresh = two("2026-10-23", "2026-10-26", "2026-11-05");
    const out = reconcileStops(base, longer, fresh, { leave: false, home: true });
    expect(out[1].leave).toBe("2026-11-01");
  });

  it("adding a stop is not a Come home edit: the concurrent Come home is kept", () => {
    const base = one("2026-10-23", "2026-10-27");
    const added: DraftStop[] = [
      base[0],
      { location: locationById("pt-lisbon")!, arrive: "2026-10-27", leave: "2026-10-28" },
    ];
    const fresh = one("2026-10-23", "2026-10-31");
    const none = { leave: false, home: false };
    expect(reconcileStops(base, added, fresh, none)[1].leave).toBe("2026-10-31");
    // ...but an edited Come home on top of the added stop stays the person's.
    const edited: DraftStop[] = [added[0], { ...added[1], leave: "2026-10-29" }];
    expect(reconcileStops(base, edited, fresh, { leave: false, home: true })[1].leave).toBe(
      "2026-10-29",
    );
  });

  it("reversing a 2-night and a 4-night stop is not a Come home edit", () => {
    const base = two("2026-10-23", "2026-10-25", "2026-10-29");
    const reversed: DraftStop[] = [
      { ...base[1], arrive: "2026-10-23", leave: "2026-10-27" },
      { ...base[0], arrive: "2026-10-27", leave: "2026-10-29" },
    ];
    const fresh = two("2026-10-23", "2026-10-25", "2026-10-31");
    const none = { leave: false, home: false };
    expect(reconcileStops(base, reversed, fresh, none)[1].leave).toBe("2026-10-31");
    const withHome = [reversed[0], { ...reversed[1], leave: "2026-10-30" }];
    expect(reconcileStops(base, withHome, fresh, { leave: false, home: true })[1].leave).toBe(
      "2026-10-30",
    );
  });

  it("with the person's Leave edited and Come home untouched, the server's end is taken when it fits", () => {
    const base = two("2026-10-23", "2026-10-26", "2026-10-29");
    const reorderedEarlier: DraftStop[] = [
      { ...base[1], arrive: "2026-10-21", leave: "2026-10-24" },
      { ...base[0], arrive: "2026-10-24", leave: "2026-10-27" },
    ];
    const fresh = two("2026-10-23", "2026-10-26", "2026-10-31");
    const out = reconcileStops(base, reorderedEarlier, fresh, { leave: true, home: false });
    expect(out[0].arrive).toBe("2026-10-21"); // their Leave
    expect(out[1].leave).toBe("2026-10-31"); // the server's Come home
  });

  it("removing a stop is not a Come home edit: the server's later Come home is kept when it fits", () => {
    const base = two("2026-10-23", "2026-10-26", "2026-10-29");
    // The person removes Lisbon; San Diego keeps its three nights (Come home untouched).
    const removed: DraftStop[] = [base[0]];
    // Another editor changed Come home to 31 Oct.
    const fresh = one("2026-10-23", "2026-10-31");
    const out = reconcileStops(base, removed, fresh, { leave: false, home: false });
    expect(out.map((entry) => entry.location?.id)).toEqual(["us-ca-san-diego"]);
    expect(out[0].arrive).toBe("2026-10-23");
    expect(out[0].leave).toBe("2026-10-31"); // the fresh Come home, not the stale 26 Oct
  });

  it("removing the first stop keeps the fresh Come home too, and an edited Come home on top of a removal stays the person's", () => {
    const base = two("2026-10-23", "2026-10-26", "2026-10-29");
    const removedFirst: DraftStop[] = [{ ...base[1], arrive: "2026-10-23", leave: "2026-10-26" }];
    const fresh = two("2026-10-23", "2026-10-26", "2026-10-31");
    expect(reconcileStops(base, removedFirst, fresh, { leave: false, home: false })[0].leave).toBe(
      "2026-10-31",
    );
    const editedHome: DraftStop[] = [{ ...base[0], leave: "2026-10-28" }];
    expect(reconcileStops(base, editedHome, fresh, { leave: false, home: true })[0].leave).toBe(
      "2026-10-28",
    );
  });

  it("a departure-only edit keeps the concurrent Come home (no stop edit), and a Come home put back to baseline is not an edit", () => {
    const base = one("2026-10-23", "2026-10-27");
    const draft = one("2026-10-22", "2026-10-26"); // Leave moved: the whole trip shifted, nights kept
    const fresh = one("2026-10-23", "2026-10-31");
    expect(reconcileStops(base, draft, fresh, { leave: true, home: false })).toEqual(
      one("2026-10-22", "2026-10-31"),
    );
    // Come home restored to the baseline date by hand: its flag is settled, so the server's date still wins.
    const restored = one("2026-10-22", "2026-10-27");
    expect(
      reconcileStops(
        base,
        restored,
        fresh,
        settleTouched({ leave: true, home: true }, restored, base),
      ),
    ).toEqual(one("2026-10-22", "2026-10-31"));
  });

  it("settleTouched keeps an endpoint only while it differs from the baseline", () => {
    const base = two("2026-10-23", "2026-10-26", "2026-10-29");
    const both = { leave: true, home: true };
    const cases: [string, DraftStop[], { leave: boolean; home: boolean }][] = [
      ["both back at baseline", base, { leave: false, home: false }],
      [
        "Leave moved only",
        two("2026-10-22", "2026-10-26", "2026-10-29"),
        { leave: true, home: false },
      ],
      [
        "Come home moved only",
        two("2026-10-23", "2026-10-26", "2026-10-30"),
        { leave: false, home: true },
      ],
      ["both moved", two("2026-10-22", "2026-10-26", "2026-10-30"), both],
    ];
    for (const [name, draft, expected] of cases)
      expect(settleTouched(both, draft, base), name).toEqual(expected);
    expect(
      settleTouched(
        { leave: false, home: false },
        two("2026-10-22", "2026-10-26", "2026-10-30"),
        base,
      ),
    ).toEqual({
      leave: false,
      home: false,
    });
  });

  it("a stop still to be chosen counts as touched, and an empty draft route is handled", () => {
    const base = one("2026-10-23", "2026-10-27");
    const blank: DraftStop[] = [
      base[0],
      { location: null, arrive: "2026-10-27", leave: "2026-10-28" },
    ];
    expect(reconcileStops(base, blank, base, NONE)).toEqual(blank);
    expect(reconcileStops([], [], base, NONE)).toEqual(base);
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
      NONE,
    );
    expect(out.config).toEqual({ ...config, spare: false, laundry: true });
  });

  it("an edited preference beats the server's different value for the same key", () => {
    const out = reconcile(
      { stops, config, travelMode: null },
      { stops, config: { ...config, spare: false }, travelMode: null },
      fresh({ spare: true, occasionCount: 3 }),
      NONE,
    );
    expect(out.config).toMatchObject({ spare: false, occasionCount: 3 });
  });

  it("getting there: the person's choice if they changed it, else the server's", () => {
    const base = { stops, config, travelMode: null };
    expect(
      reconcile(base, { ...base, travelMode: "drive" }, fresh({}, "fly"), NONE).travelMode,
    ).toBe("drive");
    expect(reconcile(base, base, fresh({}, "fly"), NONE).travelMode).toBe("fly");
  });
});
