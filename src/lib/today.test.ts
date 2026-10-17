import { describe, expect, it } from "vitest";
import { localToday } from "./today";

describe("localToday", () => {
  it("formats the device-local calendar date as YYYY-MM-DD", () => {
    expect(localToday(new Date(2026, 9, 16, 23, 59, 59))).toBe("2026-10-16");
    expect(localToday(new Date(2026, 9, 17, 0, 0, 0))).toBe("2026-10-17");
  });

  it("zero-pads month and day and handles year boundaries", () => {
    expect(localToday(new Date(2027, 0, 5))).toBe("2027-01-05");
    expect(localToday(new Date(2026, 11, 31, 12))).toBe("2026-12-31");
  });

  it("defaults to the current time", () => {
    expect(localToday()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
