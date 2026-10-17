import { describe, expect, it, vi } from "vitest";
import { curatedSearch, geocodingBaseUrl, geocodingGetUrl, selectSearch } from "./provider-config";

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

describe("geocodingBaseUrl (e2e-only override)", () => {
  const fake = "http://127.0.0.1:3102/v1/search";

  it("is honored only in an e2e build, off Vercel", () => {
    expect(geocodingBaseUrl({ OPEN_METEO_GEOCODING_URL: fake, NEXT_PUBLIC_E2E_BUILD: "1" })).toBe(
      fake,
    );
  });

  it.each([
    ["no override set", { NEXT_PUBLIC_E2E_BUILD: "1" }],
    ["an empty override", { OPEN_METEO_GEOCODING_URL: "", NEXT_PUBLIC_E2E_BUILD: "1" }],
    ["a normal (non-e2e) build", { OPEN_METEO_GEOCODING_URL: fake }],
    [
      "a build flag that is not exactly 1",
      { OPEN_METEO_GEOCODING_URL: fake, NEXT_PUBLIC_E2E_BUILD: "true" },
    ],
    [
      "a Vercel deployment, even with the e2e flag",
      { OPEN_METEO_GEOCODING_URL: fake, NEXT_PUBLIC_E2E_BUILD: "1", VERCEL: "1" },
    ],
  ])("is ignored for %s", (_label, env) => {
    expect(geocodingBaseUrl(env)).toBeUndefined();
  });

  it("sends the Open-Meteo request to the override only when it is honored", async () => {
    const calls: string[] = [];
    const doFetch = vi.fn<typeof fetch>(
      async (url) => (calls.push(String(url)), Response.json({})),
    );
    await selectSearch(
      {
        LOCATION_PROVIDER: "open-meteo",
        OPEN_METEO_GEOCODING_URL: fake,
        NEXT_PUBLIC_E2E_BUILD: "1",
      },
      doFetch,
    )("paris", { signal });
    await selectSearch(
      { LOCATION_PROVIDER: "open-meteo", OPEN_METEO_GEOCODING_URL: fake },
      doFetch,
    )("paris", { signal });
    expect(calls[0]).toMatch(/^http:\/\/127\.0\.0\.1:3102\/v1\/search\?/);
    expect(calls[1]).toMatch(/^https:\/\/geocoding-api\.open-meteo\.com\/v1\/search\?/);
  });
});

describe("geocodingGetUrl", () => {
  it("is the e2e override's /get sibling, honored under exactly the same rules", () => {
    const env = {
      OPEN_METEO_GEOCODING_URL: "http://127.0.0.1:3302/v1/search",
      NEXT_PUBLIC_E2E_BUILD: "1",
    };
    expect(geocodingGetUrl(env)).toBe("http://127.0.0.1:3302/v1/get");
    expect(geocodingGetUrl({ ...env, VERCEL: "1" })).toBeUndefined();
    expect(
      geocodingGetUrl({ OPEN_METEO_GEOCODING_URL: env.OPEN_METEO_GEOCODING_URL }),
    ).toBeUndefined();
    expect(geocodingGetUrl({})).toBeUndefined();
  });
});
