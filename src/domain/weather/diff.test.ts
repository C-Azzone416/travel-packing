import { describe, expect, it } from "vitest";
import type { Suggestion } from "../calc/suggestions";
import { CLOTHING_SPLIT_ID, diffRecommendations, WEATHER_EXTRA_IDS } from "./diff";
import type { WeatherRecommendation, WeatherSuggestion } from "./recommend";

const extra = (semanticId: string, ruleSignature = "rain"): WeatherSuggestion => ({
  semanticId,
  name: semanticId,
  category: "Accessories",
  qty: 1,
  optional: false,
  reason: `why ${semanticId}`,
  ruleSignature,
});

const split = [
  {
    id: "tops-short",
    semanticId: "tops-short",
    name: "Short-sleeve tops",
    category: "Clothing",
    qty: 3,
  },
  {
    id: "tops-long",
    semanticId: "tops-long",
    name: "Long-sleeve tops",
    category: "Clothing",
    qty: 3,
  },
];
const rec = (
  extras: WeatherSuggestion[] = [],
  clothing: Suggestion[] = split,
): WeatherRecommendation => ({
  clothing,
  extras,
});
const savedSplit = [
  { id: "tops-short", qty: 3 },
  { id: "tops-long", qty: 3 },
];

describe("diffRecommendations", () => {
  it("is empty when the saved list already matches", () => {
    const saved = [...savedSplit, { id: "weather-umbrella", qty: 1 }];
    expect(diffRecommendations(saved, rec([extra("weather-umbrella")]))).toEqual([]);
  });

  it("offers a missing item as an add with its reason", () => {
    const [change] = diffRecommendations(savedSplit, rec([extra("weather-umbrella")]));
    expect(change).toMatchObject({
      kind: "add",
      semanticId: "weather-umbrella",
      reason: "why weather-umbrella",
      ruleSignature: "rain",
      userEdited: false,
    });
  });

  it("offers removal of a weather item the forecast no longer wants", () => {
    const saved = [...savedSplit, { id: "weather-umbrella", qty: 1 }];
    const [change] = diffRecommendations(saved, rec());
    expect(change).toMatchObject({
      kind: "remove",
      semanticId: "weather-umbrella",
      userEdited: false,
    });
  });

  it("never offers removal of ordinary items", () => {
    expect(diffRecommendations([...savedSplit, { id: "sunglasses", qty: 1 }], rec())).toEqual([]);
  });

  it("flags a user-edited item that would be removed so it is offered, not overwritten", () => {
    const saved = [...savedSplit, { id: "weather-umbrella", qty: 2, userEdited: true }];
    expect(diffRecommendations(saved, rec())[0]).toMatchObject({
      kind: "remove",
      userEdited: true,
    });
  });

  it("offers the legacy switch as one change", () => {
    const changes = diffRecommendations(
      [
        { id: "tops", qty: 6 },
        { id: "bottoms", qty: 3 },
      ],
      rec(),
    );
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      kind: "split",
      semanticId: CLOTHING_SPLIT_ID,
      title: "Split clothing by weather",
      reason: "3 × Short-sleeve tops, 3 × Long-sleeve tops",
      ruleSignature: "tops-long:3|tops-short:3",
      userEdited: false,
    });
  });

  it("offers an update when the split quantities change", () => {
    const saved = [
      { id: "tops-short", qty: 4 },
      { id: "tops-long", qty: 2 },
    ];
    expect(diffRecommendations(saved, rec())[0]).toMatchObject({
      kind: "split",
      title: "Update clothing split",
    });
  });

  it("marks the split userEdited when the person changed a clothing line", () => {
    const saved = [
      { id: "tops-short", qty: 5, userEdited: true },
      { id: "tops-long", qty: 3 },
    ];
    expect(diffRecommendations(saved, rec())[0]).toMatchObject({ kind: "split", userEdited: true });
  });

  it("ignores a legacy recommendation (no usable weather)", () => {
    const legacy = rec([], [{ id: "tops", name: "Everyday tops", category: "Clothing", qty: 6 }]);
    expect(diffRecommendations(savedSplit, legacy)).toEqual([]);
  });

  it("keeps a skipped change hidden until its signature changes", () => {
    const saved = savedSplit;
    const suppressed = { "weather-umbrella": "rain" };
    expect(
      diffRecommendations(saved, rec([extra("weather-umbrella", "rain")]), suppressed),
    ).toEqual([]);
    const resurfaced = diffRecommendations(
      saved,
      rec([extra("weather-umbrella", "rain+heavy")]),
      suppressed,
    );
    expect(resurfaced).toHaveLength(1);
  });

  it("suppression is per item and covers splits and removals", () => {
    const legacy = [{ id: "tops", qty: 6 }];
    expect(
      diffRecommendations(legacy, rec(), { [CLOTHING_SPLIT_ID]: "tops-long:3|tops-short:3" }),
    ).toEqual([]);
    expect(diffRecommendations(legacy, rec(), { [CLOTHING_SPLIT_ID]: "other" })).toHaveLength(1);
    const saved = [...savedSplit, { id: "weather-umbrella", qty: 1 }];
    expect(diffRecommendations(saved, rec(), { "weather-umbrella": "removed" })).toEqual([]);
    expect(diffRecommendations(saved, rec(), { "layer-light": "removed" })).toHaveLength(1);
  });

  it("knows a name for every weather id", () => {
    const saved = WEATHER_EXTRA_IDS.map((id) => ({ id, qty: 1 }));
    const titles = diffRecommendations([...saved, ...savedSplit], rec()).map((c) => c.title);
    expect(titles).toHaveLength(WEATHER_EXTRA_IDS.length);
    expect(titles).toContain("Compact umbrella");
    expect(titles.every((t) => !t.includes("-"))).toBe(true);
  });
});
