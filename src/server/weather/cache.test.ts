import { describe, expect, it } from "vitest";
import { MemoryLruCache } from "./cache";

describe("MemoryLruCache", () => {
  it("expires entries without retaining them", () => {
    let now = 100;
    const cache = new MemoryLruCache<string>(2, () => now);
    cache.set("private-key", "value", 10);
    expect(cache.get("private-key")).toBe("value");
    now = 110;
    expect(cache.get("private-key")).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it("refreshes recency and evicts the least recently used entry", () => {
    const cache = new MemoryLruCache<number>(2, () => 0);
    cache.set("a", 1, 100);
    cache.set("b", 2, 100);
    expect(cache.get("a")).toBe(1);
    cache.set("c", 3, 100);
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("a")).toBe(1);
    expect(cache.get("c")).toBe(3);
    cache.clear();
    expect(cache.size).toBe(0);
  });

  it("does not store entries when disabled or given a non-positive TTL", () => {
    const disabled = new MemoryLruCache<number>(0);
    disabled.set("a", 1, 100);
    expect(disabled.size).toBe(0);
    const cache = new MemoryLruCache<number>(1);
    cache.set("a", 1, 0);
    expect(cache.size).toBe(0);
  });
});
