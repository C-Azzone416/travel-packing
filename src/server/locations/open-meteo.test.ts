import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LocationSearchError,
  OPEN_METEO_GEOCODING_URL,
  RESULT_COUNT,
  round2,
  searchOpenMeteo,
  TIMEOUT_MS,
} from "./open-meteo";

const london = {
  id: 2643743,
  name: "London",
  latitude: 51.50853,
  longitude: -0.12574,
  country_code: "gb",
  country: "United Kingdom",
  admin1: "England",
  admin2: "Greater London",
  timezone: "Europe/London",
  population: 8961989,
};

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), { status: 200, ...init });
const fakeFetch = (body: unknown, init?: ResponseInit) =>
  vi.fn<typeof fetch>(async () => json(body, init));

afterEach(() => vi.restoreAllMocks());

describe("searchOpenMeteo request", () => {
  it("sends only the typed query, with a fixed count, language and format, and never caches", async () => {
    const doFetch = fakeFetch({ results: [] });
    await searchOpenMeteo("London", { fetch: doFetch });
    const [url, init] = doFetch.mock.calls[0];
    const parsed = new URL(String(url));
    expect(`${parsed.origin}${parsed.pathname}`).toBe(OPEN_METEO_GEOCODING_URL);
    expect([...parsed.searchParams.keys()].sort()).toEqual(["count", "format", "language", "name"]);
    expect(parsed.searchParams.get("name")).toBe("London");
    expect(parsed.searchParams.get("count")).toBe("5");
    expect(parsed.searchParams.get("language")).toBe("en");
    expect(init?.cache).toBe("no-store");
    expect(Object.keys(init?.headers as object)).toEqual(["accept"]);
  });

  it("encodes the query safely", async () => {
    const doFetch = fakeFetch({});
    await searchOpenMeteo("São Paulo & co=1#x", { fetch: doFetch });
    const parsed = new URL(String(doFetch.mock.calls[0][0]));
    expect(parsed.searchParams.get("name")).toBe("São Paulo & co=1#x");
    expect([...parsed.searchParams.keys()]).toHaveLength(4);
  });

  it("has a 3 second timeout and asks for 5 results", () => {
    expect(TIMEOUT_MS).toBe(3000);
    expect(RESULT_COUNT).toBe(5);
  });

  it("uses a custom base URL when given one", async () => {
    const doFetch = fakeFetch({});
    await searchOpenMeteo("x", { fetch: doFetch, baseUrl: "https://fake.test/geo" });
    expect(String(doFetch.mock.calls[0][0])).toMatch(/^https:\/\/fake\.test\/geo\?/);
  });
});

describe("searchOpenMeteo results", () => {
  it("maps a place, rounding coordinates to 2 decimals and keeping the provider id and timezone", async () => {
    const [place] = await searchOpenMeteo("london", { fetch: fakeFetch({ results: [london] }) });
    expect(place).toEqual({
      id: "open-meteo-2643743",
      city: "London",
      region: "England",
      country: "United Kingdom",
      countryCode: "GB",
      label: "London, England, United Kingdom",
      provider: "open-meteo",
      providerPlaceId: "2643743",
      latitude: 51.51,
      longitude: -0.13,
      timezone: "Europe/London",
    });
  });

  it("never returns more precision than 2 decimals", async () => {
    const [place] = await searchOpenMeteo("x", {
      fetch: fakeFetch({ results: [{ ...london, latitude: 12.34567, longitude: -98.76543 }] }),
    });
    expect([place.latitude, place.longitude]).toEqual([12.35, -98.77]);
    expect(round2(0.005)).toBe(0.01);
    expect(round2(-0.004)).toBe(-0);
  });

  it("returns an empty list when the API omits results (no match)", async () => {
    expect(await searchOpenMeteo("zzzz", { fetch: fakeFetch({ generationtime_ms: 0.4 }) })).toEqual(
      [],
    );
    expect(await searchOpenMeteo("zzzz", { fetch: fakeFetch({ results: [] }) })).toEqual([]);
  });

  it("copes with missing region, country and timezone", async () => {
    const [place] = await searchOpenMeteo("x", {
      fetch: fakeFetch({ results: [{ id: 1, name: "Nowhere", latitude: 1, longitude: 2 }] }),
    });
    expect(place).toMatchObject({ region: "", country: "", countryCode: "", label: "Nowhere" });
    expect("timezone" in place).toBe(false);
    const [partial] = await searchOpenMeteo("x", {
      fetch: fakeFetch({
        results: [
          {
            id: 2,
            name: "Place",
            latitude: 1,
            longitude: 2,
            country: "Land",
            admin1: "  ",
            timezone: " ",
          },
        ],
      }),
    });
    expect(partial).toMatchObject({ region: "", label: "Place, Land" });
    expect("timezone" in partial).toBe(false);
  });

  it("skips malformed entries and keeps at most five", async () => {
    const bad = [
      null,
      "x",
      7,
      {},
      { id: "1", name: "A", latitude: 1, longitude: 1 },
      { id: 1, name: "", latitude: 1, longitude: 1 },
      { id: 1, name: "A", latitude: Number.NaN, longitude: 1 },
      { id: 1, name: "A", latitude: 1 },
    ];
    const good = Array.from({ length: 7 }, (_, index) => ({
      ...london,
      id: 100 + index,
      name: `City ${index}`,
    }));
    const places = await searchOpenMeteo("x", { fetch: fakeFetch({ results: [...bad, ...good] }) });
    expect(places.map((place) => place.city)).toEqual([
      "City 0",
      "City 1",
      "City 2",
      "City 3",
      "City 4",
    ]);
  });

  it("adds the finer detail only to results that would otherwise read the same", async () => {
    const springfield = {
      id: 1,
      name: "Springfield",
      latitude: 39.8,
      longitude: -89.65,
      country: "United States",
      admin1: "Illinois",
      admin2: "Sangamon County",
    };
    const places = await searchOpenMeteo("springfield", {
      fetch: fakeFetch({
        results: [
          springfield,
          { ...springfield, id: 2, admin2: "Cook County" },
          { ...london, id: 3 },
        ],
      }),
    });
    expect(places.map((place) => place.detail)).toEqual([
      "Sangamon County",
      "Cook County",
      undefined,
    ]);
    const lone = await searchOpenMeteo("london", { fetch: fakeFetch({ results: [london] }) });
    expect(lone[0].detail).toBeUndefined();
  });

  it("leaves duplicate results without any finer detail as they are", async () => {
    const twin = {
      id: 1,
      name: "Twin",
      latitude: 1,
      longitude: 1,
      country: "Land",
      admin1: "Region",
    };
    const places = await searchOpenMeteo("twin", {
      fetch: fakeFetch({ results: [twin, { ...twin, id: 2 }] }),
    });
    expect(places.map((place) => place.detail)).toEqual([undefined, undefined]);
  });
});

describe("searchOpenMeteo failures", () => {
  it.each([
    ["a non-OK status", () => fakeFetch({ error: true }, { status: 500 })],
    ["a rate-limit status", () => fakeFetch({}, { status: 429 })],
    [
      "a network failure",
      () => vi.fn<typeof fetch>(async () => Promise.reject(new TypeError("offline"))),
    ],
    [
      "a body that is not JSON",
      () => vi.fn<typeof fetch>(async () => new Response("<html>", { status: 200 })),
    ],
    ["results that are not a list", () => fakeFetch({ results: "nope" })],
    ["results that are an object", () => fakeFetch({ results: { 0: london } })],
  ])("fails closed with a generic error for %s", async (_label, make) => {
    const error = await searchOpenMeteo("london", { fetch: make() }).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(LocationSearchError);
    expect((error as Error).message).toBe("Location search is unavailable");
    expect((error as Error).name).toBe("LocationSearchError");
    expect(String((error as Error).stack)).not.toContain("london");
  });

  it("treats a non-object body as no results rather than crashing", async () => {
    expect(await searchOpenMeteo("x", { fetch: fakeFetch(null) })).toEqual([]);
    expect(await searchOpenMeteo("x", { fetch: fakeFetch("text") })).toEqual([]);
  });

  it("gives up after the timeout", async () => {
    const hang = vi.fn<typeof fetch>(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) =>
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))),
        ),
    );
    await expect(searchOpenMeteo("london", { fetch: hang, timeoutMs: 15 })).rejects.toBeInstanceOf(
      LocationSearchError,
    );
  });

  it("gives up when the caller's signal aborts, and passes a signal even without one", async () => {
    const hang = vi.fn<typeof fetch>(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) =>
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))),
        ),
    );
    const controller = new AbortController();
    const pending = searchOpenMeteo("london", { fetch: hang, signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toBeInstanceOf(LocationSearchError);
    const plain = fakeFetch({});
    await searchOpenMeteo("london", { fetch: plain });
    expect(plain.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("never logs, on success or failure", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => {}),
    );
    await searchOpenMeteo("SecretCity", { fetch: fakeFetch({ results: [london] }) });
    await searchOpenMeteo("SecretCity", { fetch: fakeFetch({}, { status: 500 }) }).catch(() => {});
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });
});
