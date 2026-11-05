import { describe, expect, it } from "vitest";
import { FORECAST_WINDOW_DAYS } from "./calc";
import { forecastOpensOn, tripPhase } from "./trip-lifecycle";

const trip = (start: string, end: string) => ({ start, end });
const TODAY = "2026-11-05";

describe("tripPhase", () => {
  it("uses the 16-day forecast window the weather code uses", () => {
    expect(FORECAST_WINDOW_DAYS).toBe(16);
  });

  it("is far from the 16th day out (the first day the forecast cannot reach)", () => {
    expect(tripPhase(trip("2026-11-21", "2026-11-25"), TODAY)).toBe("far"); // 16 days
    expect(tripPhase(trip("2027-03-14", "2027-03-24"), TODAY)).toBe("far"); // months
  });

  it("is soon at 15 days out, the last day inside the window", () => {
    expect(tripPhase(trip("2026-11-20", "2026-11-25"), TODAY)).toBe("soon");
  });

  it("is soon one day out", () => {
    expect(tripPhase(trip("2026-11-06", "2026-11-09"), TODAY)).toBe("soon");
  });

  it("is leaving on the start day, even for a day trip", () => {
    expect(tripPhase(trip("2026-11-05", "2026-11-09"), TODAY)).toBe("leaving");
    expect(tripPhase(trip("2026-11-05", "2026-11-05"), TODAY)).toBe("leaving");
  });

  it("is during after the start day, through the end day", () => {
    expect(tripPhase(trip("2026-11-04", "2026-11-09"), TODAY)).toBe("during");
    expect(tripPhase(trip("2026-11-01", "2026-11-05"), TODAY)).toBe("during"); // end day
  });

  it("is past the day after the end date", () => {
    expect(tripPhase(trip("2026-11-01", "2026-11-04"), TODAY)).toBe("past");
  });

  it("never calls a day trip during: leaving, then past the next day", () => {
    const day = trip("2026-11-05", "2026-11-05");
    expect(tripPhase(day, "2026-11-04")).toBe("soon");
    expect(tripPhase(day, "2026-11-05")).toBe("leaving");
    expect(tripPhase(day, "2026-11-06")).toBe("past");
  });

  it("walks a one-night trip through every phase", () => {
    const night = trip("2026-12-01", "2026-12-02");
    expect(tripPhase(night, "2026-11-15")).toBe("far");
    expect(tripPhase(night, "2026-11-16")).toBe("soon");
    expect(tripPhase(night, "2026-11-30")).toBe("soon");
    expect(tripPhase(night, "2026-12-01")).toBe("leaving");
    expect(tripPhase(night, "2026-12-02")).toBe("during");
    expect(tripPhase(night, "2026-12-03")).toBe("past");
  });

  it("holds across a month and year boundary", () => {
    expect(tripPhase(trip("2026-12-30", "2027-01-02"), "2027-01-02")).toBe("during");
    expect(tripPhase(trip("2026-12-30", "2027-01-02"), "2027-01-03")).toBe("past");
    expect(tripPhase(trip("2027-01-10", "2027-01-12"), "2026-12-25")).toBe("far"); // 16 days
    expect(tripPhase(trip("2027-01-09", "2027-01-12"), "2026-12-25")).toBe("soon"); // 15 days
  });

  it("is soon when the start or today is not a date", () => {
    expect(tripPhase(trip("", "2026-11-09"), TODAY)).toBe("soon");
    expect(tripPhase(trip("2026-02-30", "2026-03-01"), TODAY)).toBe("soon");
    expect(tripPhase(trip("2026-11-06", "2026-11-09"), "not a date")).toBe("soon");
  });

  it("treats a missing, invalid or earlier end as the start day", () => {
    expect(tripPhase(trip("2026-11-04", ""), TODAY)).toBe("past");
    expect(tripPhase(trip("2026-11-04", "2026-11-03"), TODAY)).toBe("past");
    expect(tripPhase(trip("2026-11-05", "2026-11-04"), TODAY)).toBe("leaving");
    expect(tripPhase(trip("2026-11-04", "2026-11-04"), "2026-11-04")).toBe("leaving");
  });
});

describe("forecastOpensOn", () => {
  it("is start minus 15 days", () => {
    expect(forecastOpensOn("2027-03-14")).toBe("2027-02-27");
    expect(forecastOpensOn("2027-01-05")).toBe("2026-12-21");
  });

  it("is the day the trip stops being far", () => {
    const start = "2027-03-14";
    const opens = forecastOpensOn(start) as string;
    expect(tripPhase(trip(start, start), opens)).toBe("soon");
    expect(tripPhase(trip(start, start), "2027-02-26")).toBe("far");
  });

  it("is null for an unusable date", () => {
    expect(forecastOpensOn("soon")).toBeNull();
  });
});
