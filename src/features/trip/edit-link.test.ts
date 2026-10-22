import { describe, expect, it } from "vitest";
import { editItemHref, itemIdFromQuery } from "./edit-link";

describe("editItemHref", () => {
  it("is the trip's URL with the item id in ?edit=, encoded", () => {
    expect(editItemHref("trip-1", "sunglasses")).toBe("/trips/trip-1?edit=sunglasses");
    expect(editItemHref("t", "saved:list-1:i/1 x")).toBe(
      "/trips/t?edit=saved%3Alist-1%3Ai%2F1%20x",
    );
  });

  it("round-trips through the query parser", () => {
    const id = "saved:list-1:a&b=c#d";
    const url = new URL(editItemHref("t", id), "http://localhost");
    expect(itemIdFromQuery(url.searchParams.get("edit") ?? undefined)).toBe(id);
  });
});

describe("itemIdFromQuery", () => {
  it("takes one non-empty, short value", () => {
    expect(itemIdFromQuery("sunglasses")).toBe("sunglasses");
    expect(itemIdFromQuery("x".repeat(200))).toBe("x".repeat(200));
  });

  it("ignores a missing, empty, repeated or oversized value", () => {
    expect(itemIdFromQuery(undefined)).toBeUndefined();
    expect(itemIdFromQuery("")).toBeUndefined();
    expect(itemIdFromQuery(["a", "b"])).toBeUndefined();
    expect(itemIdFromQuery("x".repeat(201))).toBeUndefined();
  });
});
