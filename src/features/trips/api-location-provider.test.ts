import { describe, expect, it, vi } from "vitest";
import {
  createApiLocationProvider,
  SEARCH_ATTRIBUTION,
  SEARCH_PATH,
} from "./api-location-provider";

const place = {
  id: "open-meteo-1",
  city: "London",
  region: "England",
  country: "United Kingdom",
  countryCode: "GB",
  label: "London, England, United Kingdom",
  provider: "open-meteo",
  providerPlaceId: "1",
  latitude: 51.51,
  longitude: -0.13,
  timezone: "Europe/London",
};
const ok = (body: unknown) =>
  vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body), { status: 200 }));
const signal = new AbortController().signal;

describe("createApiLocationProvider", () => {
  it("asks for 2+ characters, waits 300 ms, and credits Open-Meteo", () => {
    const provider = createApiLocationProvider({ fetch: ok({ places: [] }), credited: true });
    expect(provider.minQueryLength).toBe(2);
    expect(provider.debounceMs).toBe(300);
    expect(provider.attribution).toBe(SEARCH_ATTRIBUTION);
    expect(SEARCH_ATTRIBUTION).toEqual([
      "Place search by ",
      { text: "Open-Meteo.com", href: "https://open-meteo.com/" },
      ", location data from ",
      { text: "GeoNames", href: "https://www.geonames.org/" },
      ".",
    ]);
  });

  it("carries no credit unless the server says the real provider is on", () => {
    expect(createApiLocationProvider({ fetch: ok({ places: [] }) }).attribution).toBeUndefined();
    expect(
      createApiLocationProvider({ fetch: ok({ places: [] }), credited: false }).attribution,
    ).toBeUndefined();
  });

  it("calls only this app's own endpoint, with only the typed text, same-origin", async () => {
    const doFetch = ok({ places: [place] });
    const places = await createApiLocationProvider({ fetch: doFetch }).search("Lon don&x", {
      signal,
    });
    expect(places).toEqual([place]);
    const [url, init] = doFetch.mock.calls[0];
    expect(String(url)).toBe(`${SEARCH_PATH}?q=Lon%20don%26x`);
    expect(String(url).startsWith("/api/")).toBe(true);
    expect(init?.credentials).toBe("same-origin");
    expect(init?.signal).toBe(signal);
    expect(init?.method).toBeUndefined();
  });

  it("returns an empty list for no places", async () => {
    expect(
      await createApiLocationProvider({ fetch: ok({ places: [] }) }).search("zz", { signal }),
    ).toEqual([]);
  });

  it.each([
    ["an error status", () => vi.fn<typeof fetch>(async () => new Response("{}", { status: 502 }))],
    ["a rate limit", () => vi.fn<typeof fetch>(async () => new Response("{}", { status: 429 }))],
    [
      "a network failure",
      () => vi.fn<typeof fetch>(async () => Promise.reject(new TypeError("offline"))),
    ],
    [
      "a body that is not JSON",
      () => vi.fn<typeof fetch>(async () => new Response("nope", { status: 200 })),
    ],
    ["no places key", () => ok({})],
    ["a null body", () => ok(null)],
    ["places that are not a list", () => ok({ places: "x" })],
    ["a place missing a field", () => ok({ places: [{ ...place, city: undefined }] })],
    ["a place with an empty id", () => ok({ places: [{ ...place, id: "" }] })],
    ["a place that is not an object", () => ok({ places: [null] })],
    ["a place with a non-text field", () => ok({ places: [{ ...place, country: 5 }] })],
  ])("rejects for %s, so the picker shows its unavailable state", async (_label, make) => {
    await expect(
      createApiLocationProvider({ fetch: make() }).search("london", { signal }),
    ).rejects.toThrow();
  });

  it("uses the global fetch by default", async () => {
    const original = globalThis.fetch;
    const spy = vi.fn(async () => new Response(JSON.stringify({ places: [] }), { status: 200 }));
    globalThis.fetch = spy as unknown as typeof fetch;
    try {
      await createApiLocationProvider().search("london", { signal });
      expect(spy).toHaveBeenCalledOnce();
    } finally {
      globalThis.fetch = original;
    }
  });
});
