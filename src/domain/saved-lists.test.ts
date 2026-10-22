import { describe, expect, it } from "vitest";
import type { TripItem } from "./calc";
import {
  applySavedLists,
  isBathroomCategory,
  listCollisions,
  normaliseName,
  tripItemsFromList,
  type SavedList,
} from "./saved-lists";
import { TOILETRY_GROUP_ID } from "./toiletry-bag";

const list = (id: string, items: [string, string, string, number][]): SavedList => ({
  id,
  name: id,
  items: items.map(([itemId, name, category, qty]) => ({ id: itemId, name, category, qty })),
});
const draftItem = (name: string, category: string): TripItem => ({
  id: `d-${name}`,
  name,
  category,
  qty: 2,
  packed: 1,
  section: "main",
});

describe("normaliseName", () => {
  it("ignores case, accents and extra whitespace", () => {
    expect(normaliseName("  Café   Mug ")).toBe("cafe mug");
  });
});

describe("applySavedLists", () => {
  it("plans every list item unpacked, in order, with no duplicates", () => {
    const result = applySavedLists(
      [],
      [
        list("a", [["1", "Poncho", "Other essentials", 2]]),
        list("b", [["1", "Swimsuit", "Clothing", 1]]),
      ],
    );
    expect(result.planned.map((item) => [item.name, item.qty, item.packed, item.section])).toEqual([
      ["Poncho", 2, 0, "main"],
      ["Swimsuit", 1, 0, "main"],
    ]);
    expect(result.planned.map((item) => item.listId)).toEqual(["a", "b"]);
    expect(new Set(result.planned.map((item) => item.id)).size).toBe(2);
    expect(result.duplicates).toEqual([]);
  });

  it("reports the same name and category across lists without resolving it", () => {
    const result = applySavedLists(
      [],
      [
        list("a", [["1", "Sunscreen", "Toiletries", 1]]),
        list("b", [["9", " sunscreen ", "Toiletries", 3]]),
      ],
    );
    expect(result.planned).toHaveLength(2);
    expect(result.duplicates).toHaveLength(1);
    expect(result.duplicates[0].items.map((item) => [item.listId, item.qty])).toEqual([
      ["a", 1],
      ["b", 3],
    ]);
  });

  it("reports a match with a draft item, with the draft first, but doesn't plan the draft", () => {
    const result = applySavedLists(
      [draftItem("Socks", "Clothing")],
      [list("a", [["1", "SOCKS", "Clothing", 4]])],
    );
    expect(result.planned).toHaveLength(1);
    expect(result.duplicates).toHaveLength(1);
    expect(result.duplicates[0].items.map((item) => item.listId)).toEqual(["", "a"]);
  });

  it("does not treat the same name in a different category as a duplicate", () => {
    const result = applySavedLists(
      [draftItem("Charger", "Tech")],
      [list("a", [["1", "Charger", "Accessories", 1]])],
    );
    expect(result.duplicates).toEqual([]);
  });

  it("ignores draft items that match nothing, and never mutates its inputs", () => {
    const draft = [draftItem("Hat", "Accessories")];
    const lists = [list("a", [["1", "Poncho", "Other essentials", 1]])];
    const before = JSON.stringify([draft, lists]);
    expect(applySavedLists(draft, lists).duplicates).toEqual([]);
    expect(JSON.stringify([draft, lists])).toBe(before);
  });

  it("is a snapshot: later edits to the list don't change a plan already made", () => {
    const source = list("a", [["1", "Poncho", "Other essentials", 1]]);
    const { planned } = applySavedLists([], [source]);
    source.items[0].qty = 9;
    source.items[0].name = "Changed";
    expect(planned[0]).toMatchObject({ name: "Poncho", qty: 1 });
  });

  it("returns nothing for no lists", () => {
    expect(applySavedLists([], [])).toEqual({ planned: [], duplicates: [] });
  });
});

describe("managing lists (#167)", () => {
  const items = [
    { id: "a", name: "Toothbrush", category: "Bathroom", qty: 1 },
    { id: "b", name: "Charger", category: "Tech", qty: 1 },
  ];

  it("finds a list name that is taken, ignoring case, accents and spaces, except the list's own", async () => {
    const { listNameTaken } = await import("./saved-lists");
    const lists = [
      { id: "1", name: "Beach week" },
      { id: "2", name: "Ski" },
    ];
    expect(listNameTaken(lists, " BEACH  week ")).toBe(true);
    expect(listNameTaken(lists, "Béach week")).toBe(true);
    expect(listNameTaken(lists, "Beach week", "1")).toBe(false);
    expect(listNameTaken(lists, "Lake")).toBe(false);
  });

  it("finds the other item with the same normalised name and category", async () => {
    const { findListItemDuplicate } = await import("./saved-lists");
    expect(findListItemDuplicate(items, " toothbrush ", "Bathroom")?.id).toBe("a");
    expect(findListItemDuplicate(items, "Toothbrush", "Tech")).toBeNull();
    expect(findListItemDuplicate(items, "Toothbrush", "Bathroom", "a")).toBeNull();
  });

  it("counts the categories, biggest first and ties by name", async () => {
    const { categoryCounts } = await import("./saved-lists");
    expect(
      categoryCounts([
        ...items,
        { id: "c", name: "Cable", category: "Tech", qty: 1 },
        { id: "d", name: "Shirt", category: "Clothing", qty: 1 },
      ]),
    ).toEqual([
      { category: "Tech", count: 2 },
      { category: "Bathroom", count: 1 },
      { category: "Clothing", count: 1 },
    ]);
    expect(categoryCounts([])).toEqual([]);
  });
});

describe("tripItemsFromList (#170)", () => {
  const beach = list("beach", [
    ["a", "Towel", "Other essentials", 2],
    ["b", "Sunscreen", "Bathroom", 1],
    ["c", "Towel", "Other essentials", 1],
  ]);

  it("copies every row, in order, unpacked, with fresh ids, never merging or summing the repeats", () => {
    const items = tripItemsFromList(beach);
    expect(items.map((item) => [item.id, item.name, item.qty, item.packed, item.section])).toEqual([
      ["saved:beach:a", "Towel", 2, 0, "main"],
      ["saved:beach:b", "Sunscreen", 1, 0, "main"],
      ["saved:beach:c", "Towel", 1, 0, "main"],
    ]);
  });

  it("puts Bathroom rows in the toiletries group and no other row", () => {
    const items = tripItemsFromList(beach);
    expect(
      items.filter((item) => item.groupId === TOILETRY_GROUP_ID).map((item) => item.name),
    ).toEqual(["Sunscreen"]);
    expect(isBathroomCategory("Bathroom")).toBe(true);
    expect(isBathroomCategory("Clothing")).toBe(false);
  });

  it("is a copy: changing the list afterwards cannot reach the items already made", () => {
    const source = list("l", [["a", "Hat", "Accessories", 1]]);
    const items = tripItemsFromList(source);
    source.items[0].qty = 9;
    expect(items[0].qty).toBe(1);
    expect(tripItemsFromList({ id: "l", name: "l", items: [] })).toEqual([]);
  });
});

describe("listCollisions (#170, the apply-time safety check)", () => {
  const beach = list("beach", [
    ["a", "Towel", "Other essentials", 2],
    ["b", "Sunscreen", "Bathroom", 1],
    ["c", "Towel", "Other essentials", 1],
  ]);

  it("reports nothing when the trip has no items yet, even if the list repeats a row inside itself", () => {
    expect(listCollisions([], beach)).toEqual([]);
  });

  it("reports a group for each list row that matches an item the trip already has (name and category, normalised)", () => {
    const existing = [draftItem("  sunscreen ", "Bathroom"), draftItem("Hat", "Accessories")];
    const groups = listCollisions(existing, beach);
    expect(groups).toHaveLength(1);
    expect(groups[0].items.map((item) => item.listId)).toEqual(["", "beach"]);
    expect(groups[0].items.map((item) => item.name.trim())).toEqual(["sunscreen", "Sunscreen"]);
  });

  it("lists every row of the list that matches in the same group, once per key, and ignores a different category", () => {
    const groups = listCollisions(
      [draftItem("Towel", "Other essentials"), draftItem("Towel", "Tech")],
      beach,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].items.filter((item) => item.listId === "beach")).toHaveLength(2);
    expect(groups[0].items.filter((item) => item.listId === "")).toHaveLength(1);
  });
});
