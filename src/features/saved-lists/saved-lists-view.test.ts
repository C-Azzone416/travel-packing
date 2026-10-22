import { describe, expect, it } from "vitest";
import {
  categoryOptions,
  categorySummary,
  groupByCategory,
  itemsLabel,
  LIST_CATEGORIES,
  updatedText,
} from "./saved-lists-view";

describe("saved lists view helpers", () => {
  it("formats the update date as day and short month, and nothing for a bad timestamp", () => {
    expect(updatedText("2026-10-12T15:00:00Z")).toBe("Oct 12");
    expect(updatedText("not a date")).toBe("");
  });

  it("says how many items, singular and plural", () => {
    expect(itemsLabel(1)).toBe("1 item");
    expect(itemsLabel(0)).toBe("0 items");
    expect(itemsLabel(24)).toBe("24 items");
  });

  it("summarises the biggest three categories and how many others there are", () => {
    const cats = [
      { category: "Clothing", count: 12 },
      { category: "Bathroom", count: 7 },
      { category: "Tech", count: 5 },
      { category: "Accessories", count: 2 },
      { category: "Other essentials", count: 1 },
    ];
    expect(categorySummary(cats)).toBe("Clothing 12 · Bathroom 7 · Tech 5 · +2 more");
    expect(categorySummary(cats.slice(0, 2))).toBe("Clothing 12 · Bathroom 7");
    expect(categorySummary([])).toBe("");
  });

  it("offers the standard categories, plus the item's own when it is something else", () => {
    expect(categoryOptions(null)).toEqual([...LIST_CATEGORIES]);
    expect(categoryOptions("Tech")).toEqual([...LIST_CATEGORIES]);
    expect(categoryOptions("Pack last")).toEqual([...LIST_CATEGORIES, "Pack last"]);
  });

  it("groups rows by category in the standard order, then others alphabetically, keeping row order", () => {
    const rows = [
      { id: "1", category: "Tech" },
      { id: "2", category: "Zebra" },
      { id: "3", category: "Clothing" },
      { id: "4", category: "Tech" },
      { id: "5", category: "Apple" },
    ];
    const groups = groupByCategory(rows);
    expect(groups.map((group) => group.category)).toEqual(["Clothing", "Tech", "Apple", "Zebra"]);
    expect(groups[1].rows.map((row) => row.id)).toEqual(["1", "4"]);
  });
});
