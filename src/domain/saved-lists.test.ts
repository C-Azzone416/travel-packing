import { describe, expect, it } from "vitest";
import type { TripItem } from "./calc";
import { applySavedLists, normaliseName, type SavedList } from "./saved-lists";

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
