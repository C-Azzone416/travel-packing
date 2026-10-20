import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FORECAST_TTL_MS,
  OPEN_METEO_ARCHIVE_URL,
  OPEN_METEO_FORECAST_URL,
  WEATHER_TIMEOUT_MS,
  createOpenMeteoWeatherProvider,
} from "./open-meteo";
import { setWeatherLogSink } from "./safe-log";

const TODAY = new Date("2026-06-01T12:00:00.000Z");
const stop = {
  stopIndex: 2,
  arrive: "2026-06-02",
  leave: "2026-06-04",
  includeLeave: false,
  latitude: 51.50853,
  longitude: -0.12574,
};

function dailyBody(
  dates: string[],
  values: (date: string, index: number) => Partial<Record<string, number | null>> = () => ({}),
) {
  const rows = dates.map(values);
  const series = (key: string, fallback: number | null) =>
    rows.map((row) => (key in row ? row[key] : fallback));
  return {
    daily: {
      time: dates,
      temperature_2m_max: series("high", 24),
      temperature_2m_min: series("low", 13),
      precipitation_probability_max: series("probability", 40),
      precipitation_sum: series("precip", 2),
      snowfall_sum: series("snow", 0),
      uv_index_max: series("uv", 5),
      sunshine_duration: series("sunshine", 21_600),
    },
  };
}

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), { status: 200, ...init });

function datesFrom(url: URL): string[] {
  const start = new Date(`${url.searchParams.get("start_date")}T00:00:00Z`);
  const end = new Date(`${url.searchParams.get("end_date")}T00:00:00Z`);
  const result: string[] = [];
  for (let at = start.getTime(); at <= end.getTime(); at += 86_400_000)
    result.push(new Date(at).toISOString().slice(0, 10));
  return result;
}

let logs: string[] = [];
beforeEach(() => {
  logs = [];
  setWeatherLogSink((line) => logs.push(line));
});
afterEach(() => {
  setWeatherLogSink();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("Open-Meteo forecast", () => {
  it("fetches forecast-only stops with rounded coordinates, minimum params and no persistent cache", async () => {
    const doFetch = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input));
      return json(dailyBody(datesFrom(url)));
    });
    const provider = createOpenMeteoWeatherProvider({ fetch: doFetch, now: () => TODAY });
    const result = await provider.getStopWeather(stop);

    expect(result).toEqual({
      stopIndex: 2,
      status: "ok",
      days: [
        {
          date: "2026-06-02",
          stopIndex: 2,
          source: "forecast",
          highC: 24,
          lowC: 13,
          precipProbability: 0.4,
          precipMm: 2,
          snowCm: 0,
          uvIndexMax: 5,
          sunshineHours: 6,
        },
        expect.objectContaining({ date: "2026-06-03", source: "forecast" }),
      ],
    });
    expect(doFetch).toHaveBeenCalledTimes(1);
    const [input, init] = doFetch.mock.calls[0];
    const url = new URL(String(input));
    expect(`${url.origin}${url.pathname}`).toBe(OPEN_METEO_FORECAST_URL);
    expect([...url.searchParams.keys()].sort()).toEqual([
      "daily",
      "end_date",
      "latitude",
      "longitude",
      "start_date",
      "timezone",
    ]);
    expect(url.searchParams.get("latitude")).toBe("51.51");
    expect(url.searchParams.get("longitude")).toBe("-0.13");
    expect(url.searchParams.get("start_date")).toBe("2026-06-02");
    expect(url.searchParams.get("end_date")).toBe("2026-06-03");
    expect(url.searchParams.get("daily")?.split(",")).toEqual([
      "temperature_2m_max",
      "temperature_2m_min",
      "precipitation_probability_max",
      "precipitation_sum",
      "snowfall_sum",
      "uv_index_max",
      "sunshine_duration",
    ]);
    expect(url.searchParams.get("timezone")).toBe("GMT");
    expect(init?.cache).toBe("no-store");
    expect(Object.keys(init?.headers as object)).toEqual(["accept"]);
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(WEATHER_TIMEOUT_MS).toBe(3000);
  });

  it("includes the final trip day only for the final stop", async () => {
    const doFetch = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input));
      return json(dailyBody(datesFrom(url)));
    });
    const provider = createOpenMeteoWeatherProvider({ fetch: doFetch, now: () => TODAY });
    const result = await provider.getStopWeather({ ...stop, includeLeave: true });
    expect(result.days.map((day) => day.date)).toEqual(["2026-06-02", "2026-06-03", "2026-06-04"]);
  });
});

describe("Open-Meteo span cap", () => {
  it("answers a stop longer than the cap as unavailable without asking the provider or building its days", async () => {
    const doFetch = vi.fn<typeof fetch>();
    const provider = createOpenMeteoWeatherProvider({ fetch: doFetch, now: () => TODAY });
    const result = await provider.getStopWeather({
      ...stop,
      arrive: "2026-06-02",
      leave: "9999-12-31",
      includeLeave: true,
    });
    expect(result).toEqual({ stopIndex: 2, status: "unavailable", days: [] });
    expect(doFetch).not.toHaveBeenCalled();
  });
});

describe("Open-Meteo typical weather", () => {
  it("averages the same calendar dates over the previous five years", async () => {
    const sampleDates = Array.from({ length: 5 }, (_, offset) => `${2021 + offset}-07-01`);
    const doFetch = vi.fn<typeof fetch>(async () =>
      json(
        dailyBody(sampleDates, (_date, index) => ({
          high: 20 + index,
          low: 10 + index,
          precip: [0, 2, 0, 3, 0][index],
          snow: index,
          sunshine: [null, 3600, 7200, 10_800, 14_400][index],
        })),
      ),
    );
    const provider = createOpenMeteoWeatherProvider({ fetch: doFetch, now: () => TODAY });
    const result = await provider.getStopWeather({
      ...stop,
      arrive: "2027-07-01",
      leave: "2027-07-01",
      includeLeave: true,
    });
    expect(result.days).toEqual([
      {
        date: "2027-07-01",
        stopIndex: 2,
        source: "typical",
        highC: 22,
        lowC: 12,
        precipProbability: 0.4,
        precipMm: 1,
        snowCm: 2,
        uvIndexMax: null,
        sunshineHours: 2.5,
      },
    ]);
    const url = new URL(String(doFetch.mock.calls[0][0]));
    expect(`${url.origin}${url.pathname}`).toBe(OPEN_METEO_ARCHIVE_URL);
    expect(url.searchParams.get("start_date")).toBe("2021-07-01");
    expect(url.searchParams.get("end_date")).toBe("2025-07-01");
    expect(url.searchParams.get("daily")?.split(",")).toEqual([
      "temperature_2m_max",
      "temperature_2m_min",
      "precipitation_sum",
      "snowfall_sum",
      "sunshine_duration",
    ]);
  });

  it("makes at most two calls for a stop that straddles the forecast boundary", async () => {
    const doFetch = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input));
      if (url.pathname.includes("archive")) {
        const samples = Array.from({ length: 5 }, (_, offset) => `${2021 + offset}-06-17`);
        return json(dailyBody(samples));
      }
      return json(dailyBody(["2026-06-16"]));
    });
    const provider = createOpenMeteoWeatherProvider({ fetch: doFetch, now: () => TODAY });
    const result = await provider.getStopWeather({
      ...stop,
      arrive: "2026-06-16",
      leave: "2026-06-18",
    });
    expect(doFetch).toHaveBeenCalledTimes(2);
    expect(result.days.map((day) => [day.date, day.source])).toEqual([
      ["2026-06-16", "forecast"],
      ["2026-06-17", "typical"],
    ]);
  });
});

describe("Open-Meteo privacy cache and failures", () => {
  it("uses only process memory, hits the cache, then refreshes after expiry", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(0));
    const doFetch = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input));
      return json(dailyBody(datesFrom(url)));
    });
    const provider = createOpenMeteoWeatherProvider({
      fetch: doFetch,
      now: () => TODAY,
    });
    await provider.getStopWeather(stop);
    await provider.getStopWeather(stop);
    expect(doFetch).toHaveBeenCalledTimes(1);
    expect(logs.some((line) => line.includes("cache-hit"))).toBe(true);
    vi.advanceTimersByTime(FORECAST_TTL_MS);
    await provider.getStopWeather(stop);
    expect(doFetch).toHaveBeenCalledTimes(2);
  });

  it("returns unavailable without a call for custom coordinates or malformed dates", async () => {
    const doFetch = vi.fn<typeof fetch>();
    const provider = createOpenMeteoWeatherProvider({ fetch: doFetch, now: () => TODAY });
    expect(await provider.getStopWeather({ ...stop, latitude: undefined })).toEqual({
      stopIndex: 2,
      status: "unavailable",
      days: [],
    });
    expect(await provider.getStopWeather({ ...stop, arrive: "not-a-day" })).toEqual({
      stopIndex: 2,
      status: "unavailable",
      days: [],
    });
    expect(doFetch).not.toHaveBeenCalled();
  });

  it("times out gracefully", async () => {
    const doFetch = vi.fn<typeof fetch>(
      async (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), {
            once: true,
          });
        }),
    );
    const provider = createOpenMeteoWeatherProvider({
      fetch: doFetch,
      now: () => TODAY,
      timeoutMs: 5,
    });
    expect(await provider.getStopWeather(stop)).toEqual({
      stopIndex: 2,
      status: "unavailable",
      days: [],
    });
  });

  describe("a null metric on one day", () => {
    const forecast = async (values: Parameters<typeof dailyBody>[1]) => {
      const provider = createOpenMeteoWeatherProvider({
        fetch: vi.fn<typeof fetch>(async () =>
          json(dailyBody(["2026-06-02", "2026-06-03"], values)),
        ),
        now: () => TODAY,
      });
      return provider.getStopWeather(stop);
    };

    it("derives a missing probability from precipitation: 1 mm or more is wet, less is dry", async () => {
      const result = await forecast((_date, i) => ({ probability: null, precip: [1, 0.9][i] }));
      expect(result.status).toBe("ok");
      expect(result.days.map((d) => d.precipProbability)).toEqual([1, 0]);
    });

    it("treats a missing probability and a missing precipitation sum as no rain signal", async () => {
      const result = await forecast(() => ({ probability: null, precip: null }));
      expect(result.status).toBe("ok");
      expect(result.days.map((d) => [d.precipProbability, d.precipMm])).toEqual([
        [0, 0],
        [0, 0],
      ]);
    });

    it("keeps the other days and metrics when one precipitation sum or snowfall is null", async () => {
      const result = await forecast((_date, i) => ({
        precip: i === 0 ? null : 5,
        snow: i === 0 ? null : 2,
      }));
      expect(result.status).toBe("ok");
      expect(result.days.map((d) => [d.precipMm, d.snowCm, d.precipProbability])).toEqual([
        [0, 0, 0.4],
        [5, 2, 0.4],
      ]);
    });

    it("keeps null UV and sunshine as unknown", async () => {
      const result = await forecast(() => ({ uv: null, sunshine: null }));
      expect(result.days.map((d) => [d.uvIndexMax, d.sunshineHours])).toEqual([
        [null, null],
        [null, null],
      ]);
    });

    it("is unavailable only when the temperatures of a needed day are missing", async () => {
      expect((await forecast((_d, i) => ({ high: i === 0 ? null : 20 }))).status).toBe(
        "unavailable",
      );
      expect((await forecast((_d, i) => ({ low: i === 1 ? null : 10 }))).status).toBe(
        "unavailable",
      );
    });

    it("still rejects a wrong type, a negative amount and an out-of-range probability", async () => {
      expect((await forecast(() => ({ precip: -1 }))).status).toBe("unavailable");
      expect((await forecast(() => ({ snow: -1 }))).status).toBe("unavailable");
      expect((await forecast(() => ({ probability: 101 }))).status).toBe("unavailable");
      expect((await forecast(() => ({ probability: "40" as unknown as number }))).status).toBe(
        "unavailable",
      );
    });

    it("typical data skips a null year instead of dropping the stop", async () => {
      const sampleDates = Array.from({ length: 5 }, (_, offset) => `${2021 + offset}-07-01`);
      const run = async (precip: (number | null)[], high: (number | null)[]) => {
        const provider = createOpenMeteoWeatherProvider({
          fetch: vi.fn<typeof fetch>(async () =>
            json(dailyBody(sampleDates, (_d, i) => ({ precip: precip[i], high: high[i] }))),
          ),
          now: () => TODAY,
        });
        return provider.getStopWeather({
          ...stop,
          arrive: "2027-07-01",
          leave: "2027-07-01",
          includeLeave: true,
        });
      };
      const dry = await run([null, 2, 0, 3, null], [20, 20, 20, 20, 20]);
      expect(dry.days[0]).toMatchObject({ precipProbability: 2 / 3, precipMm: 5 / 3 });
      const unknown = await run([null, null, null, null, null], [20, 20, 20, 20, 20]);
      expect(unknown.days[0]).toMatchObject({ precipProbability: 0, precipMm: 0 });
      const missingYears = await run([0, 0, 0, 0, 0], [null, null, null, 18, 22]);
      expect(missingYears.days[0]).toMatchObject({ highC: 20 });
      expect((await run([0, 0, 0, 0, 0], [null, null, null, null, null])).status).toBe(
        "unavailable",
      );
    });
  });

  it.each([
    ["an HTTP error", vi.fn<typeof fetch>(async () => json({}, { status: 503 }))],
    ["malformed JSON", vi.fn<typeof fetch>(async () => new Response("not json"))],
    ["a malformed daily object", vi.fn<typeof fetch>(async () => json({ daily: { time: "no" } }))],
    [
      "an invalid metric",
      vi.fn<typeof fetch>(async () => json(dailyBody(["2026-06-02"], () => ({ high: null })))),
    ],
  ])("returns unavailable for %s", async (_label, doFetch) => {
    const provider = createOpenMeteoWeatherProvider({ fetch: doFetch, now: () => TODAY });
    expect((await provider.getStopWeather(stop)).status).toBe("unavailable");
  });

  it("never logs coordinates, dates, names or provider error details", async () => {
    const secretCoordinate = 44.44;
    const provider = createOpenMeteoWeatherProvider({
      fetch: vi.fn<typeof fetch>(async () =>
        Promise.reject(new Error("Secret Place provider detail")),
      ),
      now: () => TODAY,
    });
    await provider.getStopWeather({ ...stop, latitude: secretCoordinate });
    const output = logs.join("\n");
    expect(output).not.toContain(String(secretCoordinate));
    expect(output).not.toContain("2026-06-02");
    expect(output).not.toContain("Secret Place");
    expect(JSON.parse(logs.at(-1) ?? "{}")).toEqual({
      scope: "weather",
      event: "provider-error",
    });
  });
});
