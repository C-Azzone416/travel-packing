// Guards for #278: the e2e sample trips must never fall behind the clock. They are relative to a "today", San Diego upcoming and
// Lisbon past on ANY day, and the e2e helpers must seed from the date the browser has rather than a fixed one.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { classifyTrip, type LifecycleTrip } from "../../domain/trip-lifecycle";
import { SAMPLE_TODAY, addDays, sampleTrips } from "./sample-data";
import { isoDate, utcDate } from "./run-date";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("the date helpers", () => {
  it("formats a calendar date with zero padding", () => {
    expect(isoDate(2026, 1, 5)).toBe("2026-01-05");
    expect(isoDate(2026, 10, 28)).toBe("2026-10-28");
    expect(isoDate(5, 2, 3)).toBe("0005-02-03");
  });

  it("gives the UTC date of an instant, not the local one", () => {
    expect(utcDate(Date.parse("2026-10-28T00:00:00Z"))).toBe("2026-10-28");
    expect(utcDate(Date.parse("2026-10-27T23:59:59Z"))).toBe("2026-10-27");
    expect(utcDate(Date.parse("2026-12-31T23:59:59.999Z"))).toBe("2026-12-31");
  });

  it("defaults to the real date", () => {
    expect(utcDate()).toBe(new Date().toISOString().slice(0, 10));
  });
});

describe("the sample trips never fall behind the clock", () => {
  const classify = (today: string, index: 0 | 1) =>
    classifyTrip(sampleTrips("owner", today)[index] as unknown as LifecycleTrip, today);

  it("seeded for today, San Diego is upcoming and Lisbon is past (this fails the day a fixed date goes stale)", () => {
    const today = utcDate();
    expect(classify(today, 0)).toBe("upcoming");
    expect(classify(today, 1)).toBe("past");
  });

  it("holds on every day for the next two years and the last one, including month, year and leap-day edges", () => {
    for (let offset = -366; offset <= 731; offset += 1) {
      const today = addDays(utcDate(), offset);
      expect(classify(today, 0), today).toBe("upcoming");
      expect(classify(today, 1), today).toBe("past");
    }
  });

  it("the fixed prototype date is NOT a safe seed date: it is already a past trip once the clock moves on", () => {
    const [sanDiego] = sampleTrips("owner", SAMPLE_TODAY);
    const later = addDays(sanDiego.end, 1);
    expect(classifyTrip(sanDiego as unknown as LifecycleTrip, later)).toBe("past");
  });
});

describe("the e2e harness seeds from the clock the page has", () => {
  it("never resets with the fixed prototype date: it takes the date the browser has", () => {
    const database = read("tests/e2e/helpers/database.ts");
    expect(database).not.toContain("SAMPLE_TODAY");
    expect(database).toMatch(/resetOwnerData\(ownerId: string, today: string = utcDate\(\)\)/);
    expect(database).toMatch(/seedSyntheticData\(db, ownerId, today\)/);
  });

  it("signInAsOwner reads the page's own date before it seeds", () => {
    const auth = read("tests/e2e/helpers/auth.ts");
    expect(auth).toMatch(/resetOwnerData\(ownerId, await browserToday\(page\)\)/);
    expect(auth).toMatch(/new Date\(\);[\s\S]*getFullYear\(\)/);
  });

  it("the database a run starts with is seeded for the real date", () => {
    expect(read("scripts/e2e-db-server.ts")).toMatch(/today: utcDate\(\)/);
  });

  it("every spec that pins the browser clock pins it to the prototype's date (the world its literal dates assume)", () => {
    const dir = join(root, "tests", "e2e");
    const pins: { file: string; date: string }[] = [];
    for (const file of readdirSync(dir).filter((name) => name.endsWith(".spec.ts"))) {
      const text = read(`tests/e2e/${file}`);
      for (const match of text.matchAll(
        /(?:const NOW = |setFixedTime\()new Date\("(\d{4}-\d{2}-\d{2})T/g,
      ))
        pins.push({ file, date: match[1] });
    }
    expect(pins.length).toBeGreaterThan(10);
    for (const pin of pins) expect(pin.date, pin.file).toBe(SAMPLE_TODAY);
  });
});
