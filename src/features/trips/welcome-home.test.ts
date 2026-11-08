import { describe, expect, it } from "vitest";
import type { LifecycleTrip } from "@/domain/trip-lifecycle";
import type { SampleLocation, TripStop } from "@/domain/trip-stops";
import { sampleLifecycleState } from "./fixtures";
import {
  WELCOME_HOME_DAYS,
  WELCOME_SEEN_KEY,
  markWelcomeSeen,
  readWelcomeSeen,
  welcomeHomeCandidate,
  welcomeHomeModel,
} from "./welcome-home";

// The Welcome home card's model (#410, spec #393 section 2.3). `today` is always passed in: no clock.
const place = (city: string, countryCode = "PT"): SampleLocation => ({
  id: city.toLowerCase(),
  city,
  region: "",
  country: "",
  countryCode,
  label: city,
});
const stay = (city: string, arrive: string, leave: string): TripStop => ({
  location: place(city),
  arrive,
  leave,
});
const [, lisbonSample] = sampleLifecycleState().trips;
const done = (id: string, start: string, end: string, stops: TripStop[], extra = {}) =>
  ({
    ...lisbonSample,
    id,
    start,
    end,
    stops,
    name: null,
    archived: false,
    ...extra,
  }) as LifecycleTrip;
const LISBON_TRIP = done("a", "2026-09-03", "2026-09-07", [
  stay("Lisbon", "2026-09-03", "2026-09-07"),
]);

describe("welcomeHomeCandidate", () => {
  it("starts the day after the end date and lasts 14 days", () => {
    expect(welcomeHomeCandidate([LISBON_TRIP], "2026-09-07")).toBeNull();
    expect(welcomeHomeCandidate([LISBON_TRIP], "2026-09-08")?.id).toBe("a");
    expect(welcomeHomeCandidate([LISBON_TRIP], "2026-09-21")?.id).toBe("a");
    expect(WELCOME_HOME_DAYS).toBe(14);
    expect(welcomeHomeCandidate([LISBON_TRIP], "2026-09-22")).toBeNull();
  });

  it("shows only the most recent trip, and never an archived one", () => {
    const newer = done("b", "2026-09-10", "2026-09-12", [
      stay("Porto", "2026-09-10", "2026-09-12"),
    ]);
    expect(welcomeHomeCandidate([LISBON_TRIP, newer], "2026-09-13")?.id).toBe("b");
    expect(welcomeHomeCandidate([newer, LISBON_TRIP], "2026-09-13")?.id).toBe("b");
    const archived = { ...newer, archived: true };
    expect(welcomeHomeCandidate([LISBON_TRIP, archived], "2026-09-13")?.id).toBe("a");
  });
});

describe("welcomeHomeModel", () => {
  it("names the trip, the new sticker, the nights and the packed count", () => {
    const model = welcomeHomeModel([LISBON_TRIP], "2026-09-08");
    expect(model?.tripId).toBe("a");
    expect(model?.title).toBe("Lisbon is inked.");
    expect(model?.sticker.place).toBe("Lisbon");
    expect(model?.sticker.upcoming).toBe(false);
    const code = model!.sticker.code;
    expect(code).toMatch(/^[A-Z]{3}$/);
    expect(model?.line).toMatch(
      new RegExp(`^${code} is in your Stamps\\. 4 nights, \\d+ of \\d+ packed\\.$`),
    );
    expect(model?.announcement).toBe("Lisbon sticker added to Stamps.");
  });

  it("lists two new stickers, and leaves out the packed part when nothing was on the list", () => {
    const two = done(
      "c",
      "2026-09-03",
      "2026-09-07",
      [stay("Lisbon", "2026-09-03", "2026-09-05"), stay("Porto", "2026-09-05", "2026-09-07")],
      { items: [] },
    );
    const model = welcomeHomeModel([two], "2026-09-08");
    expect(model?.line).toMatch(/^[A-Z]{3} and [A-Z]{3} are in your Stamps\. 4 nights\.$/);
    expect(model?.announcement).toBe("Lisbon and Porto stickers added to Stamps.");
    // The card carries the first stop's sticker.
    expect(model?.sticker.place).toBe("Lisbon");
  });

  it("says a day trip, and counts a second and third visit to a place", () => {
    const first = done("a", "2026-08-01", "2026-08-03", [
      stay("Lisbon", "2026-08-01", "2026-08-03"),
    ]);
    const second = done("b", "2026-09-03", "2026-09-07", [
      stay("Lisbon", "2026-09-03", "2026-09-07"),
    ]);
    const two = welcomeHomeModel([first, second], "2026-09-08");
    expect(two?.line).toMatch(/^Your second Lisbon: [A-Z]{3} now has ×2\. 4 nights, /);
    expect(two?.sticker.completedCount).toBe(2);
    expect(two?.announcement).toBe("Stamps updated.");
    const third = done("c", "2026-09-20", "2026-09-20", [
      stay("Lisbon", "2026-09-20", "2026-09-20"),
    ]);
    const three = welcomeHomeModel([first, second, third], "2026-09-21");
    expect(three?.line).toMatch(/^Your third Lisbon: [A-Z]{3} now has ×3\. Day trip, /);
    const fourth = done("d", "2026-09-22", "2026-09-22", [
      stay("Lisbon", "2026-09-22", "2026-09-22"),
    ]);
    expect(welcomeHomeModel([first, second, third, fourth], "2026-09-23")?.line).toMatch(
      /^Your 4th Lisbon:/,
    );
  });

  it("says the new ones and the repeat ones in one line", () => {
    const earlier = done("a", "2026-08-01", "2026-08-03", [
      stay("Lisbon", "2026-08-01", "2026-08-03"),
    ]);
    const mixed = done(
      "b",
      "2026-09-03",
      "2026-09-07",
      [stay("Lisbon", "2026-09-03", "2026-09-05"), stay("Porto", "2026-09-05", "2026-09-07")],
      { items: [] },
    );
    const line = welcomeHomeModel([earlier, mixed], "2026-09-08")?.line;
    expect(line).toMatch(
      /^[A-Z]{3} is in your Stamps\. Your second Lisbon: [A-Z]{3} now has ×2\. 4 nights\.$/,
    );
  });

  it("has no card without a recent trip or without stops", () => {
    expect(welcomeHomeModel([], "2026-09-08")).toBeNull();
    expect(welcomeHomeModel([LISBON_TRIP], "2026-12-25")).toBeNull();
    expect(welcomeHomeModel([{ ...LISBON_TRIP, stops: [] }], "2026-09-08")).toBeNull();
  });
});

describe("seen on this device", () => {
  const memory = (initial?: string) => {
    const data = new Map<string, string>(initial ? [[WELCOME_SEEN_KEY, initial]] : []);
    return {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => void data.set(key, value),
    };
  };

  it("remembers a dismissed trip once, and keeps the earlier ones", () => {
    const storage = memory();
    expect(readWelcomeSeen(storage)).toEqual([]);
    markWelcomeSeen("a", storage);
    markWelcomeSeen("a", storage);
    markWelcomeSeen("b", storage);
    expect(readWelcomeSeen(storage)).toEqual(["a", "b"]);
  });

  it("reads nothing from garbage, and ignores storage that is missing or throws", () => {
    expect(readWelcomeSeen(memory("not json"))).toEqual([]);
    expect(readWelcomeSeen(memory('{"a":1}'))).toEqual([]);
    expect(readWelcomeSeen(memory('["a", 3]'))).toEqual(["a"]);
    expect(readWelcomeSeen(null)).toEqual([]);
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readWelcomeSeen(broken)).toEqual([]);
    expect(() => markWelcomeSeen("a", broken)).not.toThrow();
    expect(() => markWelcomeSeen("a", null)).not.toThrow();
  });
});
