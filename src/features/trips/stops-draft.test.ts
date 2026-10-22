import { describe, expect, it } from "vitest";
import type { DraftStop } from "@/domain/trip-lifecycle";
import {
  addStop,
  canAddStop,
  fixSummary,
  formatNights,
  moveStop,
  nightsAt,
  removeStop,
  routeSummary,
  setFirstArrive,
  setLeave,
  snapContiguous,
  stopProblems,
} from "./stops-draft";

const place = (city: string) => ({
  id: city.toLowerCase(),
  city,
  region: "Sample Region",
  country: "Sampleland",
  countryCode: "SL",
  label: `${city}, Sample Region, Sampleland`,
});
const stop = (city: string | null, arrive: string, leave: string): DraftStop => ({
  location: city ? place(city) : null,
  arrive,
  leave,
});
// Alpha 3 nights, Beta 2 nights, Gamma 3 nights.
const ROUTE = [
  stop("Alpha", "2030-05-01", "2030-05-04"),
  stop("Beta", "2030-05-04", "2030-05-06"),
  stop("Gamma", "2030-05-06", "2030-05-09"),
];
const dates = (stops: DraftStop[]) => stops.map((entry) => [entry.arrive, entry.leave]);
const cities = (stops: DraftStop[]) => stops.map((entry) => entry.location?.city);

describe("nights", () => {
  it("counts nights, null while a date is blank or malformed", () => {
    expect(nightsAt(ROUTE[0])).toBe(3);
    expect(nightsAt({ arrive: "", leave: "2030-05-04" })).toBeNull();
    expect(nightsAt({ arrive: "2030-05-01", leave: "x" })).toBeNull();
  });

  it("formats singular and plural", () => {
    expect(formatNights(1)).toBe("1 night");
    expect(formatNights(3)).toBe("3 nights");
  });
});

describe("addStop", () => {
  it("appends a stop that arrives the day the last one leaves and stays one night", () => {
    const next = addStop(ROUTE);
    expect(next).toHaveLength(4);
    expect(next[3]).toEqual({ location: null, arrive: "2030-05-09", leave: "2030-05-10" });
    expect(ROUTE).toHaveLength(3);
  });

  it("adds a stop with blank dates while the last leave date is blank", () => {
    expect(addStop([stop("Alpha", "", "")])[1]).toEqual({ location: null, arrive: "", leave: "" });
  });

  it("stops at six", () => {
    let stops = ROUTE;
    while (canAddStop(stops)) stops = addStop(stops);
    expect(stops).toHaveLength(6);
    expect(canAddStop(stops)).toBe(false);
    expect(addStop(stops)).toHaveLength(6);
  });
});

describe("removeStop", () => {
  it("closes the gap: later stops move up by the removed stop's nights", () => {
    const next = removeStop(ROUTE, 1);
    expect(cities(next)).toEqual(["Alpha", "Gamma"]);
    expect(dates(next)).toEqual([
      ["2030-05-01", "2030-05-04"],
      ["2030-05-04", "2030-05-07"],
    ]);
  });

  it("removing the first stop keeps the trip's start date", () => {
    const next = removeStop(ROUTE, 0);
    expect(cities(next)).toEqual(["Beta", "Gamma"]);
    expect(dates(next)[0]).toEqual(["2030-05-01", "2030-05-03"]);
  });

  it("removing the last stop just shortens the trip", () => {
    expect(dates(removeStop(ROUTE, 2))).toEqual([
      ["2030-05-01", "2030-05-04"],
      ["2030-05-04", "2030-05-06"],
    ]);
  });

  it("ignores an unknown index and never removes the only stop", () => {
    expect(removeStop(ROUTE, 5)).toEqual(ROUTE);
    expect(removeStop(ROUTE, -1)).toEqual(ROUTE);
    expect(removeStop([ROUTE[0]], 0)).toEqual([ROUTE[0]]);
  });

  it("keeps blank dates blank", () => {
    const blank = [stop("A", "", ""), stop("B", "", "")];
    expect(dates(removeStop(blank, 0))).toEqual([["", ""]]);
  });
});

describe("moveStop", () => {
  it("swaps with the neighbour, keeps each stop's nights and re-derives the dates from the first arrival", () => {
    const next = moveStop(ROUTE, 2, -1);
    expect(cities(next)).toEqual(["Alpha", "Gamma", "Beta"]);
    expect(dates(next)).toEqual([
      ["2030-05-01", "2030-05-04"],
      ["2030-05-04", "2030-05-07"],
      ["2030-05-07", "2030-05-09"],
    ]);
  });

  it("moving the first stop down keeps the trip start", () => {
    const next = moveStop(ROUTE, 0, 1);
    expect(cities(next)).toEqual(["Beta", "Alpha", "Gamma"]);
    expect(next[0].arrive).toBe("2030-05-01");
    expect(next[2].leave).toBe("2030-05-09");
  });

  it("does nothing past either end", () => {
    expect(moveStop(ROUTE, 0, -1)).toEqual(ROUTE);
    expect(moveStop(ROUTE, 2, 1)).toEqual(ROUTE);
    expect(moveStop(ROUTE, 9, 1)).toEqual(ROUTE);
  });
});

describe("setLeave", () => {
  it("shifts every later stop by the same number of days", () => {
    const next = setLeave(ROUTE, 0, "2030-05-06");
    expect(dates(next)).toEqual([
      ["2030-05-01", "2030-05-06"],
      ["2030-05-06", "2030-05-08"],
      ["2030-05-08", "2030-05-11"],
    ]);
  });

  it("shifts earlier when the stay is shortened", () => {
    expect(dates(setLeave(ROUTE, 1, "2030-05-05"))[2]).toEqual(["2030-05-05", "2030-05-08"]);
  });

  it("an invalid leave (not after arrive) changes only that stop", () => {
    const next = setLeave(ROUTE, 1, "2030-05-04");
    expect(dates(next)).toEqual([
      ["2030-05-01", "2030-05-04"],
      ["2030-05-04", "2030-05-04"],
      ["2030-05-06", "2030-05-09"],
    ]);
    expect(setLeave(ROUTE, 1, "")[1].leave).toBe("");
  });

  it("a blank previous leave does not shift anything", () => {
    const blank = [stop("A", "2030-05-01", ""), stop("B", "", "")];
    expect(dates(setLeave(blank, 0, "2030-05-03"))).toEqual([
      ["2030-05-01", "2030-05-03"],
      ["", ""],
    ]);
  });

  it("ignores an unknown stop", () => {
    expect(setLeave(ROUTE, 7, "2030-05-06")).toEqual(ROUTE);
  });
});

describe("setFirstArrive", () => {
  it("moves the whole trip with the first arrival", () => {
    expect(dates(setFirstArrive(ROUTE, "2030-06-10"))).toEqual([
      ["2030-06-10", "2030-06-13"],
      ["2030-06-13", "2030-06-15"],
      ["2030-06-15", "2030-06-18"],
    ]);
  });

  it("a blank or malformed date changes only the first arrival", () => {
    const cleared = setFirstArrive(ROUTE, "");
    expect(cleared[0].arrive).toBe("");
    expect(cleared[1]).toEqual(ROUTE[1]);
    const fresh = setFirstArrive([stop("A", "", ""), stop("B", "", "")], "2030-05-01");
    expect(dates(fresh)).toEqual([
      ["2030-05-01", ""],
      ["", ""],
    ]);
  });

  it("is empty for no stops", () => {
    expect(setFirstArrive([], "2030-05-01")).toEqual([]);
  });
});

describe("snapContiguous", () => {
  it("sets each later arrive to the previous leave", () => {
    const broken = [ROUTE[0], { ...ROUTE[1], arrive: "2030-05-05" }, ROUTE[2]];
    expect(snapContiguous(broken)[1].arrive).toBe("2030-05-04");
    expect(snapContiguous(broken)[0]).toBe(ROUTE[0]);
  });
});

describe("stopProblems", () => {
  it("is empty for a good route", () => {
    expect(stopProblems(ROUTE)).toEqual([]);
  });

  it("asks for a place on each stop that has none", () => {
    const problems = stopProblems([ROUTE[0], { ...ROUTE[1], location: null }]);
    expect(problems).toEqual([
      {
        stopIndex: 1,
        field: "place",
        message: "Pick a place for Stop 2, or choose Custom.",
      },
    ]);
  });

  it("asks for a date when one is blank, on Arrive only for the first stop", () => {
    const problems = stopProblems([stop("A", "", "2030-05-02"), stop("B", "2030-05-02", "")]);
    expect(problems.map((entry) => [entry.stopIndex, entry.field, entry.message])).toEqual([
      [0, "arrive", "Choose a date."],
      [1, "leave", "Choose a date."],
    ]);
    expect(stopProblems([stop("A", "2030-05-01", "")])[0].field).toBe("leave");
  });

  it("asks for at least one night on a multi-stop route, but allows a day trip alone", () => {
    const problems = stopProblems([
      stop("A", "2030-05-01", "2030-05-03"),
      stop("B", "2030-05-03", "2030-05-03"),
    ]);
    expect(problems).toEqual([
      {
        stopIndex: 1,
        field: "leave",
        message: "Stay at least one night. Leave must be after you arrive.",
      },
    ]);
    expect(stopProblems([stop("A", "2030-05-01", "2030-05-01")])).toEqual([]);
    expect(stopProblems([stop("A", "2030-05-02", "2030-05-01")])[0].field).toBe("leave");
  });

  it("explains a gap or overlap on the later stop's Arrive with the day to start", () => {
    const gap = stopProblems([ROUTE[0], { ...ROUTE[1], arrive: "2030-05-05" }]);
    expect(gap).toEqual([
      {
        stopIndex: 1,
        field: "arrive",
        message: "Stop 2 must start the day you leave Stop 1 (May 4).",
      },
    ]);
    expect(stopProblems([ROUTE[0], { ...ROUTE[1], arrive: "2030-05-03" }])[0].field).toBe("arrive");
  });
});

describe("summaries", () => {
  it("pluralizes the fix count", () => {
    expect(fixSummary(1)).toBe("Fix 1 thing above to continue.");
    expect(fixSummary(2)).toBe("Fix 2 things above to continue.");
  });

  it("shows the route, range and nights once every place is picked", () => {
    expect(routeSummary(ROUTE)).toBe("Alpha → Beta → Gamma · May 1 – May 9 · 8 nights");
  });

  it("asks for the missing places first", () => {
    expect(routeSummary([ROUTE[0], { ...ROUTE[1], location: null }])).toBe(
      "Pick a place for each stop to see your route.",
    );
  });

  it("shows just the route while dates are blank", () => {
    expect(routeSummary([stop("A", "", ""), stop("B", "", "")])).toBe("A → B");
  });
});
