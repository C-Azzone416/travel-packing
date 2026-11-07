import { describe, expect, it } from "vitest";
import { itemIdFromQuery } from "./edit-link";

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
