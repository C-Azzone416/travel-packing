import { describe, expect, it } from "vitest";
import { weatherGuidance } from "./guidance";
import type { WeatherRecommendation } from "./recommend";

const recommendation: WeatherRecommendation = {
  clothing: [
    {
      id: "tops-short",
      name: "Short-sleeve tops",
      category: "Clothing",
      qty: 3,
      semanticId: "tops-short",
      reason: "Mostly warm days",
      tag: "Warm",
    },
    {
      id: "legacy",
      name: "No tag",
      category: "Clothing",
      qty: 1,
      semanticId: "legacy",
      reason: "x",
    },
  ],
  extras: [
    {
      semanticId: "weather-umbrella",
      name: "Compact umbrella",
      category: "Accessories",
      qty: 1,
      optional: false,
      reason: "Rain likely in Lisbon, Oct 3–5",
      tag: "Rain",
      ruleSignature: "rain",
    },
    {
      semanticId: "weather-sun-hat",
      name: "Sun hat",
      category: "Accessories",
      qty: 1,
      optional: true,
      reason: "Beach trip",
      tag: "Sun",
      ruleSignature: "beach",
    },
  ],
};

describe("weatherGuidance", () => {
  it("maps present items to their tag and reason, from clothing and extras", () => {
    const map = weatherGuidance(["tops-short", "weather-umbrella", "socks"], recommendation);
    expect([...map.keys()]).toEqual(["tops-short", "weather-umbrella"]);
    expect(map.get("weather-umbrella")).toEqual({
      tag: "Rain",
      reason: "Rain likely in Lisbon, Oct 3–5",
    });
    expect(map.get("tops-short")).toEqual({ tag: "Warm", reason: "Mostly warm days" });
  });

  it("gives nothing for items the forecast does not call for, or lines without a tag", () => {
    expect(weatherGuidance(["legacy", "socks"], recommendation).size).toBe(0);
    expect(weatherGuidance([], recommendation).size).toBe(0);
  });
});
