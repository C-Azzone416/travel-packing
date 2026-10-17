import { describe, expect, it } from "vitest";
import { curatedLocationProvider } from "./location-provider";

describe("curatedLocationProvider", () => {
  const signal = new AbortController().signal;

  it("answers from the curated list, asynchronously", async () => {
    const pending = curatedLocationProvider.search("london", { signal });
    expect(pending).toBeInstanceOf(Promise);
    expect((await pending).map((entry) => entry.id)).toEqual(["gb-eng-london", "ca-on-london"]);
  });

  it("resolves to nothing for text with no match", async () => {
    expect(await curatedLocationProvider.search("zzzz", { signal })).toEqual([]);
  });

  it("needs no quiet period and accepts a single character", () => {
    expect(curatedLocationProvider.debounceMs).toBe(0);
    expect(curatedLocationProvider.minQueryLength).toBe(1);
  });
});
