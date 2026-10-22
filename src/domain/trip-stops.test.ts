import { describe, expect, it } from "vitest";
import {
  addDays,
  daysBetween,
  MAX_STOPS,
  routeLabel,
  shiftStops,
  stopIndexForDay,
  tripDatesFromStops,
  validateStops,
  type SampleLocation,
  type TripStop,
} from "./trip-stops";

const place = (city: string): SampleLocation => ({
  id: `sample-${city.toLowerCase()}`,
  city,
  region: "Sample Region",
  country: "Sampleland",
  countryCode: "SL",
  label: `${city}, Sample Region, Sampleland`,
});
const stop = (city: string, arrive: string, leave: string): TripStop => ({
  location: place(city),
  arrive,
  leave,
});
const THREE = [
  stop("Alpha", "2030-05-01", "2030-05-04"),
  stop("Beta", "2030-05-04", "2030-05-06"),
  stop("Gamma", "2030-05-06", "2030-05-09"),
];

describe("validateStops", () => {
  it("accepts contiguous stops of at least one night", () => {
    expect(validateStops(THREE)).toEqual({ ok: true });
  });

  it("accepts a single stop, including a day trip (leave = arrive)", () => {
    expect(validateStops([stop("Alpha", "2030-05-01", "2030-05-04")])).toEqual({ ok: true });
    expect(validateStops([stop("Alpha", "2030-05-01", "2030-05-01")])).toEqual({ ok: true });
  });

  it("rejects an empty list", () => {
    expect(validateStops([])).toEqual({ ok: false, problem: "NO_STOPS", stopIndex: null });
  });

  it("rejects more than six stops, and accepts exactly six", () => {
    const many = (count: number) =>
      Array.from({ length: count }, (_, index) =>
        stop(`City${index}`, addDays("2030-05-01", index), addDays("2030-05-01", index + 1)),
      );
    expect(MAX_STOPS).toBe(6);
    expect(validateStops(many(6))).toEqual({ ok: true });
    expect(validateStops(many(7))).toEqual({
      ok: false,
      problem: "TOO_MANY_STOPS",
      stopIndex: null,
    });
  });

  it("rejects a malformed or impossible date and names the stop", () => {
    expect(
      validateStops([stop("A", "2030-05-01", "2030-05-02"), stop("B", "2030-05-02", "x")]),
    ).toEqual({
      ok: false,
      problem: "INVALID_DATE",
      stopIndex: 1,
    });
    expect(validateStops([stop("A", "2030-02-30", "2030-03-02")])).toMatchObject({
      problem: "INVALID_DATE",
      stopIndex: 0,
    });
  });

  it("rejects a leave date before the arrive date", () => {
    expect(validateStops([stop("A", "2030-05-03", "2030-05-01")])).toEqual({
      ok: false,
      problem: "LEAVE_BEFORE_ARRIVE",
      stopIndex: 0,
    });
  });

  it("rejects a zero-night stop when there are several stops", () => {
    expect(
      validateStops([stop("A", "2030-05-01", "2030-05-03"), stop("B", "2030-05-03", "2030-05-03")]),
    ).toEqual({ ok: false, problem: "NO_NIGHT", stopIndex: 1 });
  });

  it("rejects a gap between stops", () => {
    expect(
      validateStops([stop("A", "2030-05-01", "2030-05-03"), stop("B", "2030-05-04", "2030-05-06")]),
    ).toEqual({ ok: false, problem: "GAP", stopIndex: 1 });
  });

  it("rejects overlapping stops", () => {
    expect(
      validateStops([stop("A", "2030-05-01", "2030-05-05"), stop("B", "2030-05-04", "2030-05-06")]),
    ).toEqual({ ok: false, problem: "OVERLAP", stopIndex: 1 });
  });
});

describe("tripDatesFromStops", () => {
  it("is the first arrive and the last leave", () => {
    expect(tripDatesFromStops(THREE)).toEqual({ start: "2030-05-01", end: "2030-05-09" });
  });
});

describe("stopIndexForDay", () => {
  it("maps each day to the stop where arrive <= day < leave", () => {
    expect(stopIndexForDay(THREE, "2030-05-01")).toBe(0);
    expect(stopIndexForDay(THREE, "2030-05-03")).toBe(0);
    expect(stopIndexForDay(THREE, "2030-05-05")).toBe(1);
    expect(stopIndexForDay(THREE, "2030-05-08")).toBe(2);
  });

  it("counts a travel day toward the stop you arrive at", () => {
    expect(stopIndexForDay(THREE, "2030-05-04")).toBe(1);
    expect(stopIndexForDay(THREE, "2030-05-06")).toBe(2);
  });

  it("gives the last day to the last stop", () => {
    expect(stopIndexForDay(THREE, "2030-05-09")).toBe(2);
    expect(stopIndexForDay([stop("A", "2030-05-01", "2030-05-01")], "2030-05-01")).toBe(0);
  });

  it("is null outside the trip, for a malformed day, and for no stops", () => {
    expect(stopIndexForDay(THREE, "2030-04-30")).toBeNull();
    expect(stopIndexForDay(THREE, "2030-05-10")).toBeNull();
    expect(stopIndexForDay(THREE, "soon")).toBeNull();
    expect(stopIndexForDay([], "2030-05-01")).toBeNull();
  });

  it("is null for a day that falls in no stop (stops that were not validated)", () => {
    const gap = [stop("A", "2030-05-01", "2030-05-02"), stop("B", "2030-05-04", "2030-05-06")];
    expect(stopIndexForDay(gap, "2030-05-03")).toBeNull();
  });

  it("is null when the stops' own dates are malformed", () => {
    const bad = [stop("A", "2030-05-01", "nope"), stop("B", "2030-05-02", "2030-05-04")];
    expect(stopIndexForDay(bad, "2030-05-01")).toBeNull();
    expect(stopIndexForDay([stop("A", "bad", "2030-05-02")], "2030-05-01")).toBeNull();
  });
});

describe("routeLabel", () => {
  it("joins city names with arrows", () => {
    expect(routeLabel(THREE)).toBe("Alpha → Beta → Gamma");
    expect(routeLabel(THREE.slice(0, 1))).toBe("Alpha");
  });
});

describe("date arithmetic", () => {
  it("adds days across month ends and leaves malformed input alone", () => {
    expect(addDays("2030-05-30", 3)).toBe("2030-06-02");
    expect(addDays("2030-03-01", -1)).toBe("2030-02-28");
    expect(addDays("nope", 3)).toBe("nope");
  });

  it("counts days between dates, 0 when either is malformed", () => {
    expect(daysBetween("2030-05-01", "2030-05-09")).toBe(8);
    expect(daysBetween("2030-05-09", "2030-05-01")).toBe(-8);
    expect(daysBetween("x", "2030-05-01")).toBe(0);
    expect(daysBetween("2030-05-01", "x")).toBe(0);
  });
});

describe("shiftStops", () => {
  it("moves every stop by the same offset without touching the input", () => {
    const shifted = shiftStops(THREE, 10);
    expect(shifted.map((entry) => [entry.arrive, entry.leave])).toEqual([
      ["2030-05-11", "2030-05-14"],
      ["2030-05-14", "2030-05-16"],
      ["2030-05-16", "2030-05-19"],
    ]);
    expect(validateStops(shifted)).toEqual({ ok: true });
    expect(THREE[0].arrive).toBe("2030-05-01");
    expect(shifted[0].location).not.toBe(THREE[0].location);
  });
});
