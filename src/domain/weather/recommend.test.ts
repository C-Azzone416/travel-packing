import { describe, expect, it } from "vitest";
import { calculateSuggestions, type CalcConfig } from "../calc/suggestions";
import {
  WEATHER_RULES,
  allocateLargestRemainder,
  classifyDay,
  defaultFormatRange,
  hasUsableWeather,
  lookFor,
  recommendPacking,
} from "./recommend";
import type { DayWeather } from "./types";

const base: CalcConfig = {
  start: "2026-10-01",
  end: "2026-10-08",
  laundry: false,
  spare: false,
  niceAttire: false,
  occasionCount: 1,
  reuseNice: false,
  returnOutfit: true,
};

function day(date: string, over: Partial<DayWeather> = {}): DayWeather {
  return {
    date,
    stopIndex: 0,
    source: "forecast",
    highC: 20,
    lowC: 16,
    precipProbability: 0,
    precipMm: 0,
    snowCm: 0,
    uvIndexMax: 1,
    sunshineHours: 2,
    ...over,
  };
}

const dates = (n: number, from = 1) =>
  Array.from({ length: n }, (_, i) => `2026-10-${String(from + i).padStart(2, "0")}`);

function recommend(
  days: DayWeather[],
  config: Partial<CalcConfig> = {},
  theme?: Parameters<typeof recommendPacking>[0]["theme"],
) {
  return recommendPacking({
    days,
    dayStopNames: ["Lisbon", "Edinburgh"],
    config: { ...base, ...config },
    theme,
  });
}

const qty = (r: ReturnType<typeof recommend>) =>
  Object.fromEntries(r.clothing.map((l) => [l.id, l.qty]));
const extraIds = (r: ReturnType<typeof recommend>) => r.extras.map((e) => e.semanticId);
const withHigh = (high: number) => dates(8).map((d) => day(d, { highC: high }));

describe("classifyDay and lookFor band boundaries", () => {
  it.each([
    [26.9, "warm"],
    [27, "hot"],
    [21, "warm"],
    [20.9, "cool"],
    [13, "cool"],
    [12.9, "cold"],
    [-5, "cold"],
  ] as const)("high %f is %s", (high, band) => {
    expect(classifyDay(high)).toBe(band);
  });

  it.each([
    [27, "short-shorts"],
    [26.9, "short-shorts"],
    [24, "short-shorts"],
    [23.9, "short-pants"],
    [21, "short-pants"],
    [20.9, "long-pants"],
    [10, "long-pants"],
    [null, "long-pants"],
  ] as const)("high %s wears %s", (high, look) => {
    expect(lookFor(high)).toBe(look);
  });

  it("keeps thresholds in one object", () => {
    expect(WEATHER_RULES.hotFromC).toBe(27);
    expect(WEATHER_RULES.shortsFromC).toBe(24);
  });
});

describe("allocateLargestRemainder", () => {
  it("sums to the total and gives leftovers to the largest remainders", () => {
    expect(allocateLargestRemainder(5, [1, 1, 1])).toEqual([2, 2, 1]);
    expect(allocateLargestRemainder(4, [3, 1, 0])).toEqual([3, 1, 0]);
    expect(allocateLargestRemainder(5, [5, 2, 2])).toEqual([3, 1, 1]);
    expect(allocateLargestRemainder(2, [1, 5, 1])).toEqual([0, 2, 0]);
  });
  it("is zero with nothing to allocate", () => {
    expect(allocateLargestRemainder(0, [1, 2])).toEqual([0, 0]);
    expect(allocateLargestRemainder(5, [0, 0])).toEqual([0, 0]);
  });
});

describe("clothing breakdown", () => {
  it("hot trip is all short-sleeve and shorts", () => {
    const r = recommend(withHigh(30));
    expect(qty(r)).toEqual({ "tops-short": 6, "bottoms-shorts": 3 });
  });
  it("warm below 24 is short-sleeve with pants; at 24 shorts", () => {
    expect(qty(recommend(withHigh(23.9)))).toEqual({ "tops-short": 6, "bottoms-pants": 3 });
    expect(qty(recommend(withHigh(24)))).toEqual({ "tops-short": 6, "bottoms-shorts": 3 });
  });
  it("cool and cold are long-sleeve with pants", () => {
    expect(qty(recommend(withHigh(15)))).toEqual({ "tops-long": 6, "bottoms-pants": 3 });
    expect(qty(recommend(withHigh(5)))).toEqual({ "tops-long": 6, "bottoms-pants": 3 });
  });
  it("laundry halves tops and quarters bottoms per type", () => {
    const r = recommend(withHigh(30), { laundry: true });
    expect(qty(r)).toEqual({ "tops-short": 3, "bottoms-shorts": 2 });
  });
  it("totals equal the legacy everydayLooks across niceAttire, return outfit and spare", () => {
    const mixed = dates(8).map((d, i) => day(d, { highC: [30, 30, 22, 22, 10, 10, 10, 10][i] }));
    const cases: Partial<CalcConfig>[] = [
      {},
      { niceAttire: true, occasionCount: 2 },
      { returnOutfit: false },
      { spare: true },
    ];
    for (const extra of cases) {
      const config = { ...base, ...extra };
      const legacy = calculateSuggestions(config).items.find((i) => i.id === "tops")?.qty ?? 0;
      const r = recommend(mixed, extra);
      const tops = r.clothing.filter((l) => l.id.startsWith("tops")).reduce((a, l) => a + l.qty, 0);
      expect(tops).toBe(legacy);
    }
  });
  it("return outfit off still excludes the return day under the current policy", () => {
    // Day 8 is cold; excluded under exclude-return-day, so the cold tops never appear.
    const days = dates(8).map((d) => day(d, { highC: d === "2026-10-08" ? 0 : 30 }));
    expect(qty(recommend(days, { returnOutfit: false }))).toEqual({
      "tops-short": 6,
      "bottoms-shorts": 3,
    });
  });
  it("add-return-day-back counts the return day when the outfit is off", () => {
    const days = dates(8).map((d) => day(d, { highC: d === "2026-10-08" ? 0 : 30 }));
    const r = recommendPacking({
      days,
      dayStopNames: [],
      config: { ...base, returnOutfit: false },
      returnPolicy: "add-return-day-back",
    });
    expect(qty(r)).toEqual({
      "tops-short": 6,
      "tops-long": 1,
      "bottoms-shorts": 3,
      "bottoms-pants": 1,
    });
  });
  it("departure day never counts", () => {
    const days = dates(8).map((d) => day(d, { highC: d === "2026-10-01" ? 0 : 30 }));
    expect(qty(recommend(days))).toEqual({ "tops-short": 6, "bottoms-shorts": 3 });
  });
  it("days missing weather count as cool", () => {
    const partial = dates(8)
      .slice(0, 4)
      .map((d) => day(d, { highC: 30 }));
    // daily days Oct 2..7: Oct 2,3,4 hot, Oct 5,6,7 unknown -> cool
    expect(qty(recommend(partial))).toEqual({
      "tops-short": 3,
      "tops-long": 3,
      "bottoms-shorts": 2,
      "bottoms-pants": 2,
    });
  });
  it("no everyday looks yields no clothing lines", () => {
    const r = recommend([day("2026-10-01")], { end: "2026-10-02" });
    expect(r.clothing).toEqual([]);
  });
  it("lines carry semanticId and a reason with stop and dates", () => {
    const r = recommend(withHigh(30));
    expect(r.clothing[0]).toMatchObject({
      semanticId: "tops-short",
      name: "Short-sleeve tops",
      category: "Clothing",
    });
    expect(r.clothing[0].reason).toBe("Mostly hot days; 6 hot days in Lisbon");
  });
});

describe("fallback with no usable weather", () => {
  it("recommendPacking returns today's Everyday lines and no extras", () => {
    const r = recommend([]);
    expect(r.clothing).toEqual([
      { id: "tops", name: "Everyday tops", category: "Clothing", qty: 6 },
      { id: "bottoms", name: "Everyday bottoms", category: "Clothing", qty: 3 },
    ]);
    expect(r.extras).toEqual([]);
  });
  it("legacy fallback honours laundry", () => {
    const r = recommend([], { laundry: true });
    expect(r.clothing.map((l) => l.qty)).toEqual([3, 2]);
  });
  it("weather outside the trip is unusable", () => {
    expect(hasUsableWeather([day("2027-01-01")], base)).toBe(false);
    expect(hasUsableWeather([day("2026-10-03")], base)).toBe(true);
    expect(hasUsableWeather([day("2026-10-03")], { ...base, end: "bad" })).toBe(false);
  });
  it("calculateSuggestions is deep-equal to today's output without weather", () => {
    const plain = calculateSuggestions(base);
    expect(calculateSuggestions(base, undefined)).toEqual(plain);
    expect(calculateSuggestions(base, { days: [] })).toEqual(plain);
    expect(calculateSuggestions(base, { days: [day("2027-01-01")], theme: "beach" })).toEqual(
      plain,
    );
  });
});

describe("conditional items", () => {
  const rainy = (n: number, over: Partial<DayWeather> = {}) =>
    dates(8).map((d, i) => day(d, i < n ? { precipProbability: 0.4, ...over } : {}));

  it("umbrella at 0.4 but not 0.39", () => {
    expect(extraIds(recommend(rainy(1)))).toContain("weather-umbrella");
    const r = recommend(dates(8).map((d) => day(d, { precipProbability: 0.39 })));
    expect(extraIds(r)).not.toContain("weather-umbrella");
  });
  it("rain jacket needs two wet days or 10 mm", () => {
    expect(extraIds(recommend(rainy(1)))).not.toContain("weather-rain-jacket");
    expect(extraIds(recommend(rainy(2)))).toContain("weather-rain-jacket");
    const one = (mm: number) => [day("2026-10-03", { precipMm: mm })];
    expect(extraIds(recommend(one(9.9)))).not.toContain("weather-rain-jacket");
    const heavy = recommend(one(10));
    expect(extraIds(heavy)).toContain("weather-rain-jacket");
    expect(heavy.extras.find((e) => e.semanticId === "weather-rain-jacket")?.reason).toBe(
      "Rain on 1 day in Lisbon, Oct 3",
    );
    expect(extraIds(recommend(rainy(2, { precipMm: 12 })))).toContain("weather-rain-jacket");
  });
  it("rain jacket signature records which branch fired", () => {
    const sig = (r: ReturnType<typeof recommend>) =>
      r.extras.find((e) => e.semanticId === "weather-rain-jacket")?.ruleSignature;
    expect(sig(recommend(rainy(2)))).toBe("days");
    expect(sig(recommend([day("2026-10-03", { precipMm: 10 })]))).toBe("heavy");
    expect(sig(recommend(rainy(2, { precipMm: 12 })))).toBe("days+heavy");
  });
  it("swimsuit: optional when only hot, required for beach, at 27 not 26.9", () => {
    expect(extraIds(recommend(withHigh(26.9)))).not.toContain("weather-swimsuit");
    const hot = recommend(withHigh(27)).extras.find((e) => e.semanticId === "weather-swimsuit");
    expect(hot).toMatchObject({ optional: true, ruleSignature: "hot" });
    const beach = recommend(withHigh(20), {}, "beach").extras.find(
      (e) => e.semanticId === "weather-swimsuit",
    );
    expect(beach).toMatchObject({ optional: false, reason: "Beach trip", ruleSignature: "beach" });
    const both = recommend(withHigh(30), {}, "beach").extras.find(
      (e) => e.semanticId === "weather-swimsuit",
    );
    expect(both).toMatchObject({ optional: false, ruleSignature: "beach+hot" });
  });
  it("sunscreen by UV 3 (not 2.9), in the toiletry group", () => {
    const at = (uv: number) => recommend(dates(8).map((d) => day(d, { uvIndexMax: uv })));
    expect(extraIds(at(2.9))).not.toContain("weather-sunscreen");
    const r = at(3).extras.find((e) => e.semanticId === "weather-sunscreen");
    expect(r).toMatchObject({ groupId: "toiletry-bag", category: "Bathroom", ruleSignature: "uv" });
  });
  it("sunscreen without UV needs high >= 21 and sunshine >= 6", () => {
    const at = (high: number, sun: number | null) =>
      recommend(dates(8).map((d) => day(d, { uvIndexMax: null, highC: high, sunshineHours: sun })));
    expect(extraIds(at(21, 6))).toContain("weather-sunscreen");
    expect(at(21, 6).extras.find((e) => e.semanticId === "weather-sunscreen")?.ruleSignature).toBe(
      "sun",
    );
    expect(extraIds(at(20.9, 6))).not.toContain("weather-sunscreen");
    expect(extraIds(at(21, 5.9))).not.toContain("weather-sunscreen");
    expect(extraIds(at(30, null))).not.toContain("weather-sunscreen");
  });
  it("sunscreen is always there for beach, outdoors and theme parks, never for city", () => {
    for (const theme of ["beach", "outdoors", "theme_park"] as const) {
      const e = recommend(withHigh(15), {}, theme).extras.find(
        (x) => x.semanticId === "weather-sunscreen",
      );
      expect(e).toMatchObject({ reason: "Outdoor trip", ruleSignature: "theme" });
    }
    expect(extraIds(recommend(withHigh(15), {}, "city"))).not.toContain("weather-sunscreen");
  });
  it("sun hat at UV 8 (not 7.9), or beach; always optional", () => {
    const at = (uv: number) => recommend(dates(8).map((d) => day(d, { uvIndexMax: uv })));
    expect(extraIds(at(7.9))).not.toContain("weather-sun-hat");
    expect(at(8).extras.find((e) => e.semanticId === "weather-sun-hat")).toMatchObject({
      optional: true,
      ruleSignature: "uv",
    });
    expect(extraIds(recommend(withHigh(15), {}, "beach"))).toContain("weather-sun-hat");
    expect(
      recommend(withHigh(15), {}, "beach").extras.find((e) => e.semanticId === "weather-sun-hat")
        ?.ruleSignature,
    ).toBe("beach");
  });
  it("snow boots when any snow", () => {
    const snow = (cm: number) =>
      extraIds(recommend(dates(8).map((d, i) => day(d, { snowCm: i === 3 ? cm : 0 }))));
    expect(snow(0)).not.toContain("weather-snow-boots");
    expect(snow(0.9)).not.toContain("weather-snow-boots");
    expect(snow(1)).toContain("weather-snow-boots");
    expect(extraIds(recommend(withHigh(15)))).not.toContain("weather-snow-boots");
  });
  it("layers: light below 15 low (not 15), warm coat below 5 low or 10 high, accessories below 0", () => {
    const low = (n: number) => extraIds(recommend(dates(8).map((d) => day(d, { lowC: n }))));
    expect(low(15)).not.toContain("layer-light");
    expect(low(14.9)).toContain("layer-light");
    expect(low(5)).not.toContain("layer-warm");
    expect(low(4.9)).toContain("layer-warm");
    expect(low(0)).not.toContain("cold-accessories");
    expect(low(-0.1)).toContain("cold-accessories");
    const high = (n: number) =>
      extraIds(recommend(dates(8).map((d) => day(d, { highC: n, lowC: 12 }))));
    expect(high(10)).not.toContain("layer-warm");
    expect(high(9.9)).toContain("layer-warm");
  });
  it("accessories are optional, coat and light jacket are not", () => {
    const r = recommend(dates(8).map((d) => day(d, { lowC: -3 })));
    const opt = Object.fromEntries(r.extras.map((e) => [e.semanticId, e.optional]));
    expect(opt).toMatchObject({
      "cold-accessories": true,
      "layer-warm": false,
      "layer-light": false,
    });
  });
});

describe("mixed trip example", () => {
  const days = [
    ...dates(4).map((d) => day(d, { highC: 28, lowC: 18, uvIndexMax: 7 })),
    ...dates(4, 5).map((d) =>
      day(d, { stopIndex: 1, highC: 12, lowC: 6, precipProbability: 0.7, precipMm: 3 }),
    ),
  ];
  const r = recommend(days);

  it("splits clothing between warm and cool stops", () => {
    expect(qty(r)).toEqual({
      "tops-short": 3,
      "tops-long": 3,
      "bottoms-shorts": 2,
      "bottoms-pants": 2,
    });
  });
  it("adds layers, rain and sun items with reasons", () => {
    expect(extraIds(r)).toEqual([
      "layer-light",
      "weather-umbrella",
      "weather-rain-jacket",
      "weather-swimsuit",
      "weather-sunscreen",
    ]);
    const reason = (id: string) => r.extras.find((e) => e.semanticId === id)?.reason;
    expect(reason("weather-umbrella")).toBe("Rain likely in Edinburgh, Oct 5–8");
    expect(reason("layer-light")).toBe("Cold nights in Edinburgh");
    expect(reason("weather-sunscreen")).toBe("Sunny days in Lisbon");
  });
  it("names several stops in one reason", () => {
    const wet = recommend(
      dates(8).map((d, i) => day(d, { stopIndex: i % 2, precipProbability: 1 })),
    );
    expect(wet.extras.find((e) => e.semanticId === "weather-umbrella")?.reason).toBe(
      "Rain likely in Lisbon, Oct 1–7 and Edinburgh, Oct 2–8",
    );
  });
  it("flows through calculateSuggestions and buildTripItems, sunscreen in the toiletry group", () => {
    const suggestions = calculateSuggestions(base, {
      days,
      stopNames: ["Lisbon", "Edinburgh"],
    });
    const ids = suggestions.items.map((i) => i.id);
    expect(ids.slice(0, 4)).toEqual(["tops-short", "tops-long", "bottoms-shorts", "bottoms-pants"]);
    expect(ids).not.toContain("tops");
    expect(ids).toContain("weather-umbrella");
    expect(suggestions.items.find((i) => i.id === "weather-umbrella")).toMatchObject({
      fromWeather: true,
      reason: "Rain likely in Edinburgh, Oct 5–8",
    });
  });
  it("puts sunscreen in the toiletry group", () => {
    const s = calculateSuggestions(base, { days }).items.find((i) => i.id === "weather-sunscreen");
    expect(s?.groupId).toBe("toiletry-bag");
  });
});

describe("defaultFormatRange and injection", () => {
  it("formats single, same-month and cross-month ranges", () => {
    expect(defaultFormatRange("2026-10-03", "2026-10-03")).toBe("Oct 3");
    expect(defaultFormatRange("2026-10-03", "2026-10-05")).toBe("Oct 3–5");
    expect(defaultFormatRange("2026-10-30", "2026-11-02")).toBe("Oct 30–Nov 2");
  });
  it("uses an injected formatter", () => {
    const r = recommendPacking({
      days: [day("2026-10-03", { precipProbability: 1 })],
      dayStopNames: ["Lisbon"],
      config: base,
      formatRange: (a, b) => `${a}..${b}`,
    });
    expect(r.extras.find((e) => e.semanticId === "weather-umbrella")?.reason).toBe(
      "Rain likely in Lisbon, 2026-10-03..2026-10-03",
    );
  });
  it("shows only the dates when stops have no names", () => {
    const r = recommendPacking({
      days: [day("2026-10-03", { precipProbability: 1 })],
      dayStopNames: [],
      config: base,
    });
    expect(r.extras.find((e) => e.semanticId === "weather-umbrella")?.reason).toBe(
      "Rain likely, Oct 3",
    );
    expect(r.extras.find((e) => e.semanticId === "weather-rain-jacket")).toBeUndefined();
  });
});

describe("reason copy (#108 §7.4)", () => {
  const reasonOf = (r: ReturnType<typeof recommend>, id: string) =>
    r.extras.find((e) => e.semanticId === id)?.reason;
  const trip = (over: (i: number) => Partial<DayWeather>) =>
    dates(8).map((d, i) => day(d, over(i)));

  it("rain: forecast, two places, and the cap", () => {
    const two = recommend(
      trip((i) => ({
        stopIndex: i < 4 ? 0 : 1,
        precipProbability: i === 0 || i === 1 || i === 6 ? 1 : 0,
      })),
    );
    expect(reasonOf(two, "weather-umbrella")).toBe(
      "Rain likely in Lisbon, Oct 1–2 and Edinburgh, Oct 7",
    );
    const three = recommendPacking({
      days: trip((i) => ({ stopIndex: i % 3, precipProbability: 1 })),
      dayStopNames: ["A", "B", "C"],
      config: base,
    });
    expect(reasonOf(three, "weather-umbrella")).toBe(
      "Rain likely in A, Oct 1–7 and B, Oct 2–8 and more",
    );
  });
  it("rain jacket counts days, with two-place wording kept", () => {
    const r = recommend(trip((i) => ({ precipProbability: i < 3 ? 0.5 : 0 })));
    expect(reasonOf(r, "weather-rain-jacket")).toBe("Rain on 3 days in Lisbon, Oct 1–3");
  });
  it("typical data softens the verb and never says forecast", () => {
    const typical = (extra: Partial<DayWeather>) => trip(() => ({ source: "typical", ...extra }));
    const wet = recommend(typical({ precipProbability: 0.5 }));
    expect(reasonOf(wet, "weather-umbrella")).toBe("Often rainy in Lisbon, Oct 1–8");
    expect(reasonOf(wet, "weather-rain-jacket")).toBe("Rain on about 8 days in Lisbon, Oct 1–8");
    expect(reasonOf(recommend(typical({ highC: 30 })), "weather-swimsuit")).toBe(
      "Often hot in Lisbon, Oct 1–8",
    );
    expect(reasonOf(recommend(typical({ lowC: 2 })), "layer-light")).toBe(
      "Often cold at night in Lisbon",
    );
    expect(reasonOf(recommend(typical({ snowCm: 2 })), "weather-snow-boots")).toBe(
      "Snow is common in Lisbon at this time",
    );
    const text = JSON.stringify([wet, recommend(typical({ snowCm: 2, highC: 30, lowC: 2 }))]);
    expect(text.toLowerCase()).not.toContain("forecast");
  });
  it("forecast wording for heat, cold, snow and sun", () => {
    expect(reasonOf(recommend(trip(() => ({ highC: 30 }))), "weather-swimsuit")).toBe(
      "Hot days in Lisbon, Oct 1–8",
    );
    expect(reasonOf(recommend(trip(() => ({ lowC: -2 }))), "cold-accessories")).toBe(
      "Cold nights in Lisbon",
    );
    expect(reasonOf(recommend(trip(() => ({ snowCm: 3 }))), "weather-snow-boots")).toBe(
      "Snow expected in Lisbon, Oct 1–8",
    );
    expect(reasonOf(recommend(trip(() => ({ uvIndexMax: 9 }))), "weather-sun-hat")).toBe(
      "Strong sun in Lisbon, Oct 1–8",
    );
    expect(reasonOf(recommend(trip(() => ({ uvIndexMax: 9 }))), "weather-sunscreen")).toBe(
      "Strong sun in Lisbon, Oct 1–8",
    );
    expect(reasonOf(recommend(trip(() => ({ uvIndexMax: 4 }))), "weather-sunscreen")).toBe(
      "Sunny days in Lisbon",
    );
  });
  it("sunny days without a city name", () => {
    const r = recommendPacking({
      days: trip(() => ({ uvIndexMax: 4 })),
      dayStopNames: [],
      config: base,
    });
    expect(reasonOf(r, "weather-sunscreen")).toBe("Sunny days");
  });
  it("clothing: mostly band, with the city that has most of them", () => {
    const r = recommend(trip((i) => ({ stopIndex: i < 4 ? 0 : 1, highC: i < 4 ? 30 : 22 })));
    const reason = (id: string) => r.clothing.find((l) => l.id === id)?.reason;
    expect(reason("tops-short")).toBe("Mostly hot days; 3 hot days in Lisbon");
    expect(reason("bottoms-shorts")).toBe("Mostly hot days; 3 hot days in Lisbon");
    expect(reason("bottoms-pants")).toBe("Mostly warm days; 3 warm days in Edinburgh");
    const cold = recommend(trip(() => ({ highC: 5 })));
    expect(cold.clothing.find((l) => l.id === "tops-long")?.reason).toBe(
      "Mostly cold days; 6 cold days in Lisbon",
    );
  });
  it("clothing: days with no weather are described as cool", () => {
    const r = recommend([day("2026-10-01", { highC: 30 })]);
    expect(r.clothing.find((l) => l.id === "tops-long")?.reason).toBe("Mostly cool days");
  });
});
