import { describe, expect, it, vi } from "vitest";
import { curatedResolver, selectResolver } from "./resolver";

const signal = new AbortController().signal;
const london = {
  id: 2643743,
  name: "London",
  latitude: 51.50853,
  longitude: -0.12574,
  country: "United Kingdom",
  country_code: "GB",
  admin1: "England",
  timezone: "Europe/London",
};

describe("curatedResolver", () => {
  it("resolves curated ids, and nothing else (no network, provider ids never resolve)", async () => {
    expect((await curatedResolver("us-ca-san-diego"))?.city).toBe("San Diego");
    expect(await curatedResolver("open-meteo-2643743")).toBeNull();
    expect(await curatedResolver("custom")).toBeNull();
    expect(await curatedResolver("")).toBeNull();
  });
});

describe("selectResolver", () => {
  it("is the curated resolver unless LOCATION_PROVIDER is exactly open-meteo, and makes no request", async () => {
    const doFetch = vi.fn<typeof fetch>();
    for (const env of [
      {},
      { LOCATION_PROVIDER: "" },
      { LOCATION_PROVIDER: "curated" },
      { LOCATION_PROVIDER: "OPEN-METEO" },
      { LOCATION_PROVIDER: "open-meteo " },
    ]) {
      const resolve = selectResolver(env, doFetch);
      expect(resolve).toBe(curatedResolver);
      expect(await resolve("open-meteo-2643743", { signal })).toBeNull();
    }
    expect(doFetch).not.toHaveBeenCalled();
  });

  it("in open-meteo mode, asks the provider for provider ids (through the injected fetch)", async () => {
    const doFetch = vi.fn<typeof fetch>(async () => Response.json(london));
    const place = await selectResolver({ LOCATION_PROVIDER: "open-meteo" }, doFetch)(
      "open-meteo-2643743",
      { signal },
    );
    expect(place).toMatchObject({ city: "London", latitude: 51.51 });
    expect(doFetch).toHaveBeenCalledOnce();
  });

  it("in open-meteo mode, curated ids still resolve locally with no request, and unknown ids are null", async () => {
    const doFetch = vi.fn<typeof fetch>();
    const resolve = selectResolver({ LOCATION_PROVIDER: "open-meteo" }, doFetch);
    expect((await resolve("pt-lisbon"))?.city).toBe("Lisbon");
    expect(await resolve("nowhere")).toBeNull();
    expect(doFetch).not.toHaveBeenCalled();
  });

  it("in open-meteo mode an unknown provider id is null, and an outage rejects", async () => {
    const missing = vi.fn<typeof fetch>(async () =>
      Response.json({ error: true }, { status: 404 }),
    );
    expect(
      await selectResolver({ LOCATION_PROVIDER: "open-meteo" }, missing)("open-meteo-1", {
        signal,
      }),
    ).toBeNull();
    const down = vi.fn<typeof fetch>(async () => Response.json({}, { status: 500 }));
    await expect(
      selectResolver({ LOCATION_PROVIDER: "open-meteo" }, down)("open-meteo-1", { signal }),
    ).rejects.toThrow();
  });

  it("follows the e2e-only get-URL override, and ignores it otherwise", async () => {
    const urls: string[] = [];
    const doFetch = vi.fn<typeof fetch>(
      async (url) => (urls.push(String(url)), Response.json(london)),
    );
    const base = {
      LOCATION_PROVIDER: "open-meteo",
      OPEN_METEO_GEOCODING_URL: "http://127.0.0.1:3302/v1/search",
    };
    await selectResolver({ ...base, NEXT_PUBLIC_E2E_BUILD: "1" }, doFetch)("open-meteo-2643743");
    await selectResolver(base, doFetch)("open-meteo-2643743");
    expect(urls[0]).toMatch(/^http:\/\/127\.0\.0\.1:3302\/v1\/get\?/);
    expect(urls[1]).toMatch(/^https:\/\/geocoding-api\.open-meteo\.com\/v1\/get\?/);
  });

  it("uses the global fetch and process.env by default", async () => {
    vi.stubEnv("LOCATION_PROVIDER", "open-meteo");
    const original = globalThis.fetch;
    const spy = vi.fn(async () => Response.json(london));
    globalThis.fetch = spy as unknown as typeof fetch;
    try {
      expect((await selectResolver()("open-meteo-2643743"))?.city).toBe("London");
      expect(spy).toHaveBeenCalledOnce();
    } finally {
      globalThis.fetch = original;
      vi.unstubAllEnvs();
    }
  });
});
