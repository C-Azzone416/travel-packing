import { describe, expect, it } from "vitest";
import {
  addDays,
  isForecastDay,
  MAX_STOP_SPAN_DAYS,
  monthDay,
  parseDay,
  sameCalendarDay,
  stopDays,
} from "./dates";

describe("weather date helpers", () => {
  it("parses only real ISO calendar days", () => {
    expect(parseDay("2026-02-28")?.toISOString()).toContain("2026-02-28");
    expect(parseDay("2026-02-29")).toBeNull();
    expect(parseDay("not-a-date")).toBeNull();
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
    expect(addDays("bad", 1)).toBeNull();
  });

  it("assigns every night plus only the final trip day when requested", () => {
    expect(stopDays("2026-06-01", "2026-06-03", false)).toEqual(["2026-06-01", "2026-06-02"]);
    expect(stopDays("2026-06-01", "2026-06-03", true)).toEqual([
      "2026-06-01",
      "2026-06-02",
      "2026-06-03",
    ]);
    expect(stopDays("2026-06-03", "2026-06-01", true)).toBeNull();
    expect(stopDays("bad", "2026-06-01", true)).toBeNull();
  });

  it("refuses a span longer than the cap and builds one at the cap, so a request cannot ask for years of days", () => {
    const arrive = "2026-01-01";
    const atCap = addDays(arrive, MAX_STOP_SPAN_DAYS) as string;
    const over = addDays(arrive, MAX_STOP_SPAN_DAYS + 1) as string;
    expect(stopDays(arrive, atCap, false)).toHaveLength(MAX_STOP_SPAN_DAYS);
    expect(stopDays(arrive, atCap, true)).toHaveLength(MAX_STOP_SPAN_DAYS + 1);
    expect(stopDays(arrive, over, false)).toBeNull();
    expect(stopDays(arrive, "9999-12-31", true)).toBeNull();
  });

  it("uses today through day 15 as the 16-day forecast range", () => {
    expect(isForecastDay("2026-06-01", "2026-06-01")).toBe(true);
    expect(isForecastDay("2026-06-16", "2026-06-01")).toBe(true);
    expect(isForecastDay("2026-06-17", "2026-06-01")).toBe(false);
    expect(isForecastDay("2026-05-31", "2026-06-01")).toBe(false);
    expect(isForecastDay("bad", "2026-06-01")).toBe(false);
  });

  it("builds historical dates safely, including leap day", () => {
    expect(monthDay("2030-12-09")).toBe("12-09");
    expect(sameCalendarDay(2024, "2030-02-29")).toBe("2024-02-29");
    expect(sameCalendarDay(2023, "2030-02-29")).toBeNull();
  });
});
