import { describe, expect, it, vi } from "vitest";
import { curatedSearch, selectSearch } from "./provider-config";

const signal = new AbortController().signal;

describe("selectSearch", () => {
  it("answers from the curated list, with no network, unless Open-Meteo is explicitly enabled", async () => {
    const doFetch = vi.fn<typeof fetch>();
    for (const env of [
      {},
      { LOCATION_PROVIDER: "" },
      { LOCATION_PROVIDER: "curated" },
      { LOCATION_PROVIDER: "OPEN-METEO" },
      { LOCATION_PROVIDER: "something-else" },
    ]) {
      const search = selectSearch(env, doFetch);
      expect(search).toBe(curatedSearch);
      expect((await search("london", { signal })).map((entry) => entry.id)).toEqual([
        "gb-eng-london",
        "ca-on-london",
      ]);
    }
    expect(doFetch).not.toHaveBeenCalled();
  });

  it("uses Open-Meteo, through the injected fetch, when LOCATION_PROVIDER=open-meteo", async () => {
    const doFetch = vi.fn<typeof fetch>(async () =>
      Response.json({
        results: [
          {
            id: 7,
            name: "Paris",
            latitude: 48.85341,
            longitude: 2.3488,
            country: "France",
            country_code: "FR",
            admin1: "Île-de-France",
          },
        ],
      }),
    );
    const [paris] = await selectSearch({ LOCATION_PROVIDER: "open-meteo" }, doFetch)("paris", {
      signal,
    });
    expect(doFetch).toHaveBeenCalledOnce();
    expect(paris).toMatchObject({
      id: "open-meteo-7",
      city: "Paris",
      latitude: 48.85,
      longitude: 2.35,
    });
  });

  it("falls back to the global fetch and process.env by default", async () => {
    vi.stubEnv("LOCATION_PROVIDER", "open-meteo");
    const original = globalThis.fetch;
    const spy = vi.fn(async () => Response.json({}));
    globalThis.fetch = spy as unknown as typeof fetch;
    try {
      expect(await selectSearch()("paris", { signal })).toEqual([]);
      expect(spy).toHaveBeenCalledOnce();
    } finally {
      globalThis.fetch = original;
      vi.unstubAllEnvs();
    }
  });
});
