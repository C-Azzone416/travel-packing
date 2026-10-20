import { describe, expect, it } from "vitest";
import type { LifecycleTrip } from "../trip-lifecycle";
import type { WeatherChange } from "./diff";
import { applyWeatherChanges } from "./apply";

const trip = (): LifecycleTrip => ({
  id: "trip",
  destination: "Test route",
  location: null,
  copiedFrom: null,
  start: "2031-04-03",
  end: "2031-04-08",
  stops: [],
  config: {
    laundry: false,
    spare: false,
    niceAttire: false,
    occasionCount: 1,
    reuseNice: false,
    returnOutfit: true,
  },
  days: 6,
  dailyDays: 4,
  items: [
    { id: "tops", name: "Everyday tops", category: "Clothing", qty: 4, packed: 2, section: "main" },
    {
      id: "bottoms",
      name: "Everyday bottoms",
      category: "Clothing",
      qty: 2,
      packed: 0,
      section: "main",
    },
    { id: "socks", name: "Socks", category: "Clothing", qty: 4, packed: 4, section: "main" },
    {
      id: "weather-swimsuit",
      name: "Swimsuit",
      category: "Clothing",
      qty: 1,
      packed: 0,
      section: "main",
    },
  ],
  suggestionMemory: {},
  suppressedSuggestions: {},
  toiletryBagPacked: true,
  ready: true,
  weather: { status: "pending", label: "Forecast", suggestion: "Compact umbrella" },
  archived: false,
  theme: "travel",
});

const add = (id: string, groupId?: string): WeatherChange => ({
  kind: "add",
  semanticId: id,
  title: id,
  reason: "Weather reason",
  ruleSignature: "rule",
  userEdited: false,
  item: {
    semanticId: id,
    name: id,
    category: groupId ? "Bathroom" : "Clothing",
    qty: 1,
    optional: false,
    reason: "Weather reason",
    ruleSignature: "rule",
    ...(groupId ? { groupId } : {}),
  },
});

describe("applyWeatherChanges", () => {
  it("returns the same trip when no changes were selected", () => {
    const before = trip();
    expect(applyWeatherChanges(before, [])).toBe(before);
  });

  it("adds and removes weather items, without duplicating an existing id", () => {
    const before = trip();
    const remove: WeatherChange = {
      kind: "remove",
      semanticId: "weather-swimsuit",
      title: "Swimsuit",
      reason: "No longer needed",
      ruleSignature: "removed",
      userEdited: false,
    };
    const after = applyWeatherChanges(before, [add("weather-umbrella"), add("socks"), remove]);
    expect(after.items.map((item) => item.id)).toEqual([
      "tops",
      "bottoms",
      "socks",
      "weather-umbrella",
    ]);
    expect(after.ready).toBe(false);
    expect(after.weather.status).toBe("accepted");
    expect(before.items.some((item) => item.id === "weather-swimsuit")).toBe(true);
  });

  it("replaces legacy and current clothing lines as one all-or-nothing split", () => {
    const split: WeatherChange = {
      kind: "split",
      semanticId: "clothing-split",
      title: "Split clothing by weather",
      reason: "counts",
      ruleSignature: "split",
      userEdited: false,
      clothing: [
        {
          id: "tops-short",
          semanticId: "tops-short",
          name: "Short-sleeve tops",
          category: "Clothing",
          qty: 3,
        },
        {
          id: "bottoms-pants",
          semanticId: "bottoms-pants",
          name: "Pants",
          category: "Clothing",
          qty: 2,
        },
      ],
    };
    const after = applyWeatherChanges(trip(), [split]);
    expect(after.items.map((item) => [item.id, item.packed])).toContainEqual(["tops-short", 0]);
    expect(after.items.map((item) => [item.id, item.packed])).toContainEqual(["bottoms-pants", 0]);
    expect(after.items.some((item) => item.id === "tops" || item.id === "bottoms")).toBe(false);
    expect(after.items.find((item) => item.id === "socks")?.packed).toBe(4);
  });

  it("keeps a split line's toiletry group and optional flag, and falls back to its id", () => {
    const after = applyWeatherChanges(trip(), [
      {
        kind: "split",
        semanticId: "clothing-split",
        clothing: [
          { id: "tops-long", name: "Long-sleeve tops", category: "Clothing", qty: 2 },
          {
            id: "bottoms-shorts",
            semanticId: "bottoms-shorts",
            name: "Shorts",
            category: "Clothing",
            qty: 1,
            optional: true,
            groupId: "toiletry-bag",
          },
        ],
      },
    ]);
    expect(after.items.find((item) => item.id === "tops-long")).toMatchObject({
      optional: false,
      packed: 0,
    });
    expect(after.items.find((item) => item.id === "bottoms-shorts")).toMatchObject({
      optional: true,
      groupId: "toiletry-bag",
    });
  });

  it("revokes toiletries placement when a weather toiletry is added", () => {
    const after = applyWeatherChanges(trip(), [add("weather-sunscreen", "toiletry-bag")]);
    expect(after.toiletryBagPacked).toBe(false);
    expect(after.items.find((item) => item.id === "weather-sunscreen")?.groupId).toBe(
      "toiletry-bag",
    );
  });
});
