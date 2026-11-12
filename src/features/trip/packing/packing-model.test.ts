import { describe, expect, it } from "vitest";
import type { Cube } from "@/domain/cubes";
import type { TripItem } from "@/domain/trip";
import type { LifecycleTrip } from "@/domain/trip-lifecycle";
import type { WeatherChange } from "@/domain/weather/diff";
import {
  HINT,
  HINT_DAY_TRIP,
  buildCubeViews,
  categoryForCube,
  checkboxName,
  cubeFromQuery,
  cubeNote,
  filterCounts,
  filterItems,
  headline,
  itemsLabel,
  moveTargets,
  panelFooter,
  quantityCount,
  stopIndexFor,
  toSuggestions,
} from "./packing-model";

function item(id: string, qty: number, packed: number, extra: Partial<TripItem> = {}): TripItem {
  return { id, name: id, category: "Clothing", qty, packed, section: "main", ...extra };
}
const trip = (items: TripItem[], morningOfCubes?: Cube[]) =>
  ({ items, ...(morningOfCubes ? { morningOfCubes } : {}) }) as unknown as LifecycleTrip;

describe("quantity counting", () => {
  it("adds quantities, not rows, and never counts more packed than wanted", () => {
    expect(quantityCount([item("socks", 11, 11), item("tees", 6, 2), item("belt", 1, 5)])).toEqual({
      packed: 14,
      total: 18,
    });
    expect(quantityCount([item("a", 3, -2)])).toEqual({ packed: 0, total: 3 });
    expect(quantityCount([])).toEqual({ packed: 0, total: 0 });
  });

  it("the headline is the quantity over every cube, with what is left and the percent", () => {
    const all = trip([
      item("socks", 10, 4),
      item("passport", 1, 1, { category: "Other essentials" }),
    ]);
    expect(headline(all)).toEqual({ packed: 5, total: 11, toGo: 6, percent: 45 });
    expect(headline(trip([]))).toEqual({ packed: 0, total: 0, toGo: 0, percent: 0 });
  });

  it("counts rows for the filter pills and lists them the same way", () => {
    const rows = [item("socks", 11, 11), item("tees", 6, 2), item("belt", 1, 0)];
    expect(filterCounts(rows)).toEqual({ all: 3, toPack: 2, packed: 1 });
    expect(filterItems(rows, "all")).toHaveLength(3);
    expect(filterItems(rows, "to-pack").map((entry) => entry.id)).toEqual(["tees", "belt"]);
    expect(filterItems(rows, "packed").map((entry) => entry.id)).toEqual(["socks"]);
  });

  it("names a checkbox with its count only when there is more than one", () => {
    expect(checkboxName({ name: "Socks", qty: 11 })).toBe("Socks, 11");
    expect(checkboxName({ name: "Belt", qty: 1 })).toBe("Belt");
    expect(itemsLabel(1)).toBe("1 item");
    expect(itemsLabel(0)).toBe("0 items");
    expect(itemsLabel(12)).toBe("12 items");
  });
});

describe("the cubes to draw", () => {
  const items = [
    item("tops", 4, 2),
    item("toothbrush", 1, 0, { category: "Bathroom", groupId: "toiletry-bag" }),
    item("weather-umbrella", 1, 0, { category: "Weather suggestion" }),
    item("passport", 1, 1, { category: "Other essentials" }),
  ];

  it("orders them clothing, toiletries, weather, tech, documents, misc and leaves out the empty ones", () => {
    const views = buildCubeViews(trip(items));
    expect(views.map((view) => view.cube)).toEqual([
      "clothing",
      "toiletries",
      "weather",
      "documents",
      "misc",
    ]);
    // Misc is always drawn, even with nothing in it; Tech is not.
    expect(views.find((view) => view.cube === "misc")?.items).toEqual([]);
    expect(views.some((view) => view.cube === "tech")).toBe(false);
  });

  it("gives each cube its quantity, the weather cube its condition name and an alert while unpacked", () => {
    const views = buildCubeViews(trip(items));
    const clothing = views.find((view) => view.cube === "clothing")!;
    expect([clothing.packed, clothing.total, clothing.alert]).toEqual([2, 4, false]);
    const rain = views.find((view) => view.cube === "weather")!;
    expect(rain.label).toBe("Rain gear");
    expect(rain.alert).toBe(true);
    const packedRain = buildCubeViews(trip([item("weather-umbrella", 1, 1)])).find(
      (view) => view.cube === "weather",
    )!;
    expect(packedRain.alert).toBe(false);
  });

  it("flags Toiletries Morning of by default, follows the saved flags, and honours a Pack last item", () => {
    const flagged = (views: ReturnType<typeof buildCubeViews>) =>
      views.filter((view) => view.morningOf).map((view) => view.cube);
    expect(flagged(buildCubeViews(trip(items)))).toEqual(["toiletries"]);
    expect(flagged(buildCubeViews(trip(items, ["tech"])))).toEqual([]);
    expect(
      flagged(
        buildCubeViews(trip([...items, item("rope", 1, 0, { section: "packlast", cube: "misc" })])),
      ),
    ).toEqual(["toiletries", "misc"]);
  });

  it("a day trip has no Morning of: nothing is flagged, even by a Pack last item, and the switch is not offered (#412)", () => {
    const day = (start: string, end: string) =>
      ({
        ...trip([...items, item("rope", 1, 0, { section: "packlast", cube: "misc" })]),
        start,
        end,
      }) as LifecycleTrip;
    const dayViews = buildCubeViews(day("2030-03-14", "2030-03-14"));
    expect(dayViews.some((view) => view.morningOf)).toBe(false);
    expect(dayViews.every((view) => !view.morningOfAvailable)).toBe(true);
    const night = buildCubeViews(day("2030-03-14", "2030-03-15"));
    expect(night.filter((view) => view.morningOf).map((view) => view.cube)).toEqual([
      "toiletries",
      "misc",
    ]);
    expect(night.every((view) => view.morningOfAvailable)).toBe(true);
  });

  it("a cube with no items is not drawn on a day trip (Toiletries), and is drawn once it holds an item (#412)", () => {
    const clothes = [item("tops", 1, 0)];
    const day = { ...trip(clothes), start: "2030-03-14", end: "2030-03-14" } as LifecycleTrip;
    expect(buildCubeViews(day).some((view) => view.cube === "toiletries")).toBe(false);
    const bag = item("toothbrush", 1, 0, { category: "Bathroom", groupId: "toiletry-bag" });
    const withBag = { ...day, items: [...clothes, bag] } as LifecycleTrip;
    expect(buildCubeViews(withBag).some((view) => view.cube === "toiletries")).toBe(true);
  });

  it("a cube the person moved an item to holds it", () => {
    const views = buildCubeViews(trip([item("tops", 1, 0, { cube: "tech" })]));
    expect(views.find((view) => view.cube === "tech")?.items).toHaveLength(1);
    expect(views.find((view) => view.cube === "clothing")?.items).toEqual([]);
  });

  it("notes the passport: plain while unpacked, checked once packed, nothing without one", () => {
    const passport = (packed: number) =>
      item("passport", 1, packed, { category: "Other essentials" });
    expect(cubeNote("documents", [passport(0)])).toBe("passport");
    expect(cubeNote("documents", [passport(1)])).toBe("passport ✓");
    expect(cubeNote("documents", [item("ticket", 1, 0)])).toBeNull();
    expect(cubeNote("clothing", [passport(1)])).toBeNull();
  });
});

describe("the open cube's footer and the move targets", () => {
  it("says what an empty cube, an empty filter and a finished cube mean, else the hint", () => {
    expect(panelFooter({ items: [], morningOfAvailable: true }, 0)).toBe("Nothing here yet.");
    expect(panelFooter({ items: [item("a", 1, 0)], morningOfAvailable: true }, 0)).toBe(
      "Nothing here.",
    );
    expect(panelFooter({ items: [item("a", 1, 1)], morningOfAvailable: true }, 1)).toBe(
      "Everything in this cube is packed.",
    );
    expect(panelFooter({ items: [item("a", 1, 0)], morningOfAvailable: true }, 1)).toBe(HINT);
    // A day trip's hint does not mention the morning you leave (#412).
    const dayHint = panelFooter({ items: [item("a", 1, 0)], morningOfAvailable: false }, 1);
    expect(dayHint).toBe(HINT_DAY_TRIP);
    expect(dayHint).not.toMatch(/morning/);
  });

  it("offers every drawn cube except the item's own", () => {
    const views = buildCubeViews(trip([item("tops", 1, 0)]));
    expect(moveTargets(views, "clothing").map((view) => view.cube)).toEqual(["misc"]);
  });

  it("picks a category for a cube and reads ?cube=", () => {
    expect(
      (["clothing", "tech", "documents", "misc", "weather", "toiletries"] as const).map(
        categoryForCube,
      ),
    ).toEqual([
      "Clothing",
      "Tech",
      "Other essentials",
      "Accessories",
      "Accessories",
      "Accessories",
    ]);
    expect(cubeFromQuery("tech")).toBe("tech");
    expect(cubeFromQuery(["documents", "tech"])).toBe("documents");
    expect(cubeFromQuery("bogus")).toBeUndefined();
    expect(cubeFromQuery(undefined)).toBeUndefined();
  });
});

describe("weather suggestions", () => {
  const add = (semanticId: string, name: string, reason: string, tag = "Rain"): WeatherChange => ({
    kind: "add",
    semanticId,
    title: name,
    reason,
    ruleSignature: "r",
    userEdited: false,
    item: {
      semanticId,
      name,
      category: "Weather suggestion",
      qty: 1,
      optional: false,
      reason,
      tag,
      ruleSignature: "r",
    },
  });
  const remove: WeatherChange = {
    kind: "remove",
    semanticId: "weather-umbrella",
    title: "Compact umbrella",
    reason: "The weather no longer calls for this",
    ruleSignature: "removed",
    userEdited: false,
  };
  const split: WeatherChange = {
    kind: "split",
    semanticId: "clothing-split",
    title: "Split clothing by weather",
    reason: "",
    ruleSignature: "s",
    userEdited: false,
    clothing: [],
  };

  it("finds the stop a reason names, or none", () => {
    expect(stopIndexFor("Rain likely in Porto, Oct 3–5", ["Lisbon", "Porto"])).toBe(1);
    expect(stopIndexFor("Mostly warm days", ["Lisbon", "Porto"])).toBeNull();
    expect(stopIndexFor("anything", [""])).toBeNull();
  });

  it("turns each kind of change into one row with a destination, on the stop it names or the fallback", () => {
    const rows = toSuggestions(
      [add("weather-umbrella", "Compact umbrella", "Rain likely in Porto, Oct 3–5"), remove, split],
      ["Lisbon", "Porto"],
      0,
      ["weather-rain-jacket"],
    );
    expect(rows.map((row) => [row.name, row.destination, row.stopIndex, row.verb])).toEqual([
      ["Compact umbrella", "Rain gear", 1, "Add"],
      ["Compact umbrella", "Rain gear", 0, "Remove"],
      ["Split clothing by weather", "Clothing", 0, "Add"],
    ]);
  });
});
