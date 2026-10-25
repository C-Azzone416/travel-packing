import { describe, expect, it } from "vitest";
import { SYNTHETIC_STAPLES } from "./calc";
import type { TripConfig } from "./trip";
import {
  beginDraft,
  draftStops,
  emptyLifecycleState,
  saveDraft,
  selectDraftLocation,
  setDraftDates,
  setDraftStopLocation,
  setDraftStops,
  startCopyDraft,
  startDraft,
  type DraftStop,
  type LifecycleTrip,
} from "./trip-lifecycle";
import type { SampleLocation } from "./trip-stops";

const CONFIG: TripConfig = {
  laundry: false,
  spare: false,
  niceAttire: false,
  occasionCount: 1,
  reuseNice: false,
  returnOutfit: true,
};
const place = (city: string): SampleLocation => ({
  id: `sample-${city.toLowerCase()}`,
  city,
  region: "Sample Region",
  country: "Sampleland",
  countryCode: "SL",
  label: `${city}, Sample Region, Sampleland`,
});
const stopOf = (city: string, arrive: string, leave: string): DraftStop => ({
  location: place(city),
  arrive,
  leave,
});
const deps = { newId: () => "trip-1", today: "2030-04-01" };
const ROUTE: DraftStop[] = [
  stopOf("Alpha", "2030-05-01", "2030-05-04"),
  stopOf("Beta", "2030-05-04", "2030-05-08"),
];

function save(draft: ReturnType<typeof startDraft>) {
  return saveDraft(beginDraft(emptyLifecycleState(), draft), [...SYNTHETIC_STAPLES], deps);
}

describe("single-stop drafts behave as before", () => {
  it("has no stops field, and reads its one stop from location and dates", () => {
    const draft = selectDraftLocation(
      startDraft(CONFIG, "2030-05-01", "2030-05-04"),
      place("Alpha"),
    );
    expect(draft).not.toHaveProperty("stops");
    expect(draftStops(draft)).toEqual([stopOf("Alpha", "2030-05-01", "2030-05-04")]);
  });

  it("saves one stop named after the place, with the trip dates", () => {
    const draft = selectDraftLocation(
      startDraft(CONFIG, "2030-05-01", "2030-05-04"),
      place("Alpha"),
    );
    const saved = save(draft);
    if (!saved.ok) throw new Error(saved.reason);
    expect(saved.trip.stops).toEqual([stopOf("Alpha", "2030-05-01", "2030-05-04")]);
    expect(saved.trip).toMatchObject({
      destination: "Alpha",
      start: "2030-05-01",
      end: "2030-05-04",
    });
  });

  it("allows a day trip", () => {
    const draft = selectDraftLocation(
      startDraft(CONFIG, "2030-05-01", "2030-05-01"),
      place("Alpha"),
    );
    expect(save(draft).ok).toBe(true);
  });

  it("a trip saved with no location carries no stops (buildTrip fallback)", () => {
    expect(save(startDraft(CONFIG, "2030-05-01", "2030-05-04"))).toMatchObject({
      ok: false,
      reason: "LOCATION_NOT_CONFIRMED",
    });
  });
});

describe("multi-stop drafts", () => {
  const base = () => startDraft(CONFIG, "2030-05-01", "2030-05-04");

  it("setDraftStops mirrors the route into location, start and end", () => {
    const draft = setDraftStops(base(), ROUTE);
    expect(draft.stops).toEqual(ROUTE);
    expect(draft).toMatchObject({ start: "2030-05-01", end: "2030-05-08" });
    expect(draft.location?.city).toBe("Alpha");
    expect(draftStops(draft)).toEqual(ROUTE);
  });

  it("setDraftStops with one stop goes back to the single-destination form; none changes nothing", () => {
    const draft = setDraftStops(base(), ROUTE);
    const single = setDraftStops(draft, [ROUTE[1]]);
    expect(single).not.toHaveProperty("stops");
    expect(single).toMatchObject({ start: "2030-05-04", end: "2030-05-08" });
    expect(setDraftStops(draft, [])).toBe(draft);
  });

  it("setDraftStops copies the places it is given", () => {
    const draft = setDraftStops(base(), ROUTE);
    expect(draft.stops?.[0].location).not.toBe(ROUTE[0].location);
  });

  it("setDraftStopLocation changes one stop, ignores an index out of range", () => {
    const draft = setDraftStops(base(), ROUTE);
    const changed = setDraftStopLocation(draft, 1, place("Gamma"));
    expect(changed.stops?.map((entry) => entry.location?.city)).toEqual(["Alpha", "Gamma"]);
    expect(setDraftStopLocation(draft, 2, place("Gamma"))).toBe(draft);
    expect(setDraftStopLocation(draft, -1, place("Gamma"))).toBe(draft);
  });

  it("selectDraftLocation sets the first stop", () => {
    const draft = selectDraftLocation(setDraftStops(base(), ROUTE), place("Delta"));
    expect(draft.stops?.map((entry) => entry.location?.city)).toEqual(["Delta", "Beta"]);
  });

  it("setDraftDates moves only the outer dates of a multi-stop draft", () => {
    const draft = setDraftDates(setDraftStops(base(), ROUTE), "2030-05-02", "2030-05-09");
    expect(draft.stops?.map((entry) => [entry.arrive, entry.leave])).toEqual([
      ["2030-05-02", "2030-05-04"],
      ["2030-05-04", "2030-05-09"],
    ]);
    expect(draft).toMatchObject({ start: "2030-05-02", end: "2030-05-09" });
  });

  it("setDraftDates on a single stop keeps the old rule (return before departure becomes departure)", () => {
    const draft = setDraftDates(base(), "2030-05-05", "2030-05-02");
    expect(draft).toMatchObject({ start: "2030-05-05", end: "2030-05-05" });
  });

  it("saves every stop, titles the trip with the route, and derives start and end", () => {
    const saved = save(setDraftStops(base(), ROUTE));
    if (!saved.ok) throw new Error(saved.reason);
    expect(saved.trip.stops).toEqual(ROUTE);
    expect(saved.trip).toMatchObject({
      destination: "Alpha → Beta",
      start: "2030-05-01",
      end: "2030-05-08",
      days: 8,
    });
    expect(saved.trip.location?.city).toBe("Alpha");
  });

  it("refuses a stop without a confirmed place", () => {
    const draft = setDraftStops(base(), [ROUTE[0], { ...ROUTE[1], location: null }]);
    expect(save(draft)).toMatchObject({ ok: false, reason: "LOCATION_NOT_CONFIRMED" });
  });

  it("refuses a gap, an overlap and a zero-night stop", () => {
    const gap = setDraftStops(base(), [ROUTE[0], { ...ROUTE[1], arrive: "2030-05-05" }]);
    const overlap = setDraftStops(base(), [ROUTE[0], { ...ROUTE[1], arrive: "2030-05-03" }]);
    const noNight = setDraftStops(base(), [ROUTE[0], { ...ROUTE[1], leave: "2030-05-04" }]);
    for (const draft of [gap, overlap, noNight]) {
      expect(save(draft)).toMatchObject({ ok: false, reason: "INVALID_DATES" });
    }
  });
});

describe("copying a trip", () => {
  const saved = (draft: ReturnType<typeof startDraft>): LifecycleTrip => {
    const result = save(draft);
    if (!result.ok) throw new Error(result.reason);
    return result.trip;
  };

  it("shifts every stop of a multi-stop source by the same offset", () => {
    const source = saved(setDraftStops(startDraft(CONFIG, "2030-05-01", "2030-05-04"), ROUTE));
    const draft = startCopyDraft(source, "2030-06-10", "2030-06-12");
    expect(draft.mode).toBe("copy");
    expect(draft.stops?.map((entry) => [entry.arrive, entry.leave])).toEqual([
      ["2030-06-10", "2030-06-13"],
      ["2030-06-13", "2030-06-17"],
    ]);
    expect(draft.stops?.map((entry) => entry.location?.city)).toEqual(["Alpha", "Beta"]);
    expect(draft).toMatchObject({ start: "2030-06-10", end: "2030-06-17" });
  });

  it("asks a single-stop source for a place and dates anew, as before", () => {
    const source = saved(
      selectDraftLocation(startDraft(CONFIG, "2030-05-01", "2030-05-04"), place("Alpha")),
    );
    const draft = startCopyDraft(source, "2030-06-10", "2030-06-12");
    expect(draft).not.toHaveProperty("stops");
    expect(draft).toMatchObject({ location: null, start: "2030-06-10", end: "2030-06-12" });
  });

  it("falls back to the plain copy when the new start is not a date", () => {
    const source = saved(setDraftStops(startDraft(CONFIG, "2030-05-01", "2030-05-04"), ROUTE));
    expect(startCopyDraft(source, "", "")).not.toHaveProperty("stops");
  });
});
