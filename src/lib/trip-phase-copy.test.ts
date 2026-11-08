import { describe, expect, it } from "vitest";
import { forecastOpens, packingButtonLabel, shortDate } from "./trip-phase-copy";

describe("shortDate", () => {
  it("writes weekday, day and month", () => {
    expect(shortDate("2027-02-27", "2027-01-01")).toBe("Sat 27 Feb");
    expect(shortDate("2026-11-05", "2026-11-05")).toBe("Thu 5 Nov");
  });

  it("can leave the weekday out", () => {
    expect(shortDate("2027-02-27", "2027-01-01", { weekday: false })).toBe("27 Feb");
    expect(shortDate("2027-02-27", "2027-01-01", { weekday: true })).toBe("Sat 27 Feb");
  });

  it("adds the year only when it is not this year", () => {
    expect(shortDate("2027-04-02", "2026-11-05")).toBe("Fri 2 Apr 2027");
    expect(shortDate("2026-12-31", "2026-11-05")).toBe("Thu 31 Dec");
    expect(shortDate("2026-01-02", "2027-01-02")).toBe("Fri 2 Jan 2026");
  });

  it("adds no year when today is unusable, and null for a bad date", () => {
    expect(shortDate("2027-04-02", "nope")).toBe("Fri 2 Apr");
    expect(shortDate("nope", "2026-11-05")).toBeNull();
  });
});

describe("forecastOpens", () => {
  it("is the date 15 days before the start", () => {
    // 14 Mar 2027 - 15 days = 27 Feb 2027, a Saturday
    expect(forecastOpens("2027-03-14", "2027-01-01")).toEqual({
      date: "Sat 27 Feb",
      text: "Sat 27 Feb",
    });
  });

  it("carries the year when the open date is in another year", () => {
    expect(forecastOpens("2027-01-10", "2026-11-05")?.date).toBe("Sat 26 Dec");
    expect(forecastOpens("2027-01-10", "2025-12-30")?.date).toBe("Sat 26 Dec 2026");
  });

  it("says how many days when it is within the next 7", () => {
    expect(forecastOpens("2026-11-23", "2026-11-05")?.text).toBe("in 3 days"); // opens 8 Nov
    expect(forecastOpens("2026-11-21", "2026-11-05")?.text).toBe("in 1 day"); // opens 6 Nov
    expect(forecastOpens("2026-11-27", "2026-11-05")?.text).toBe("in 7 days"); // opens 12 Nov
  });

  it("uses the date from 8 days out", () => {
    expect(forecastOpens("2026-11-28", "2026-11-05")).toEqual({
      date: "Fri 13 Nov",
      text: "Fri 13 Nov",
    });
  });

  it("is null for an unusable start", () => {
    expect(forecastOpens("later", "2026-11-05")).toBeNull();
  });
});

describe("packingButtonLabel", () => {
  it("starts at 0 packed and continues after", () => {
    expect(packingButtonLabel(0, "far")).toBe("Start packing");
    expect(packingButtonLabel(0, "soon")).toBe("Start packing");
    expect(packingButtonLabel(1, "far")).toBe("Continue packing");
    expect(packingButtonLabel(60, "leaving")).toBe("Continue packing");
  });

  it("opens the list during the trip, whatever is packed", () => {
    expect(packingButtonLabel(0, "during")).toBe("Open list");
    expect(packingButtonLabel(40, "during")).toBe("Open list");
  });
});

describe("forecastOpens on the day itself", () => {
  it("names the date, never 'in 0 days'", () => {
    expect(forecastOpens("2026-11-20", "2026-11-05")).toEqual({
      date: "Thu 5 Nov",
      text: "Thu 5 Nov",
    });
  });
});
