import type { DayWeather, WeatherSource } from "@/domain/weather/types";
import { round2 } from "@/server/locations/open-meteo";
import { MemoryLruCache } from "./cache";
import { formatDay, isForecastable, sameCalendarDay, stopDays } from "./dates";
import type { WeatherProvider, WeatherStopInput } from "./provider";
import { unavailableStop } from "./provider";
import { logWeatherEvent } from "./safe-log";

export const OPEN_METEO_FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
export const OPEN_METEO_ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive";
export const WEATHER_TIMEOUT_MS = 3000;
export const FORECAST_TTL_MS = 3 * 60 * 60 * 1000;
export const TYPICAL_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const CACHE_CAPACITY = 128;

const FORECAST_DAILY = [
  "temperature_2m_max",
  "temperature_2m_min",
  "precipitation_probability_max",
  "precipitation_sum",
  "snowfall_sum",
  "uv_index_max",
  "sunshine_duration",
] as const;
const ARCHIVE_DAILY = [
  "temperature_2m_max",
  "temperature_2m_min",
  "precipitation_sum",
  "snowfall_sum",
  "sunshine_duration",
] as const;

interface DailyRecord {
  date: string;
  highC: number;
  lowC: number;
  precipProbability: number | null;
  /** null: the provider had no value for this day. */
  precipMm: number | null;
  snowCm: number;
  uvIndexMax: number | null;
  sunshineHours: number | null;
}

export interface OpenMeteoWeatherOptions {
  fetch: typeof fetch;
  now?: () => Date;
  timeoutMs?: number;
  forecastUrl?: string;
  archiveUrl?: string;
  cache?: MemoryLruCache<DailyRecord[]>;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;
const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

function numberAt(value: unknown, index: number, nullable: true): number | null | undefined;
function numberAt(value: unknown, index: number, nullable?: false): number | undefined;
function numberAt(value: unknown, index: number, nullable = false): number | null | undefined {
  if (!Array.isArray(value) || index >= value.length) return undefined;
  const item = value[index];
  if (nullable && item === null) return null;
  return finite(item) ? item : undefined;
}

function parseDaily(body: unknown, source: WeatherSource): DailyRecord[] | null {
  if (!isObject(body) || !isObject(body.daily) || !Array.isArray(body.daily.time)) return null;
  const daily = body.daily;
  const times = daily.time as unknown[];
  const records: DailyRecord[] = [];
  for (const [index, date] of times.entries()) {
    if (typeof date !== "string") return null;
    const highC = numberAt(daily.temperature_2m_max, index, true);
    const lowC = numberAt(daily.temperature_2m_min, index, true);
    const precipMm = numberAt(daily.precipitation_sum, index, true);
    const snowCm = numberAt(daily.snowfall_sum, index, true);
    const sunshineSeconds = numberAt(daily.sunshine_duration, index, true);
    const uvIndexMax = source === "forecast" ? numberAt(daily.uv_index_max, index, true) : null;
    const probability =
      source === "forecast" ? numberAt(daily.precipitation_probability_max, index, true) : null;
    // A wrong type is a malformed response; a null is the provider saying "no value for this day".
    if (
      highC === undefined ||
      lowC === undefined ||
      precipMm === undefined ||
      snowCm === undefined ||
      sunshineSeconds === undefined ||
      uvIndexMax === undefined ||
      probability === undefined ||
      (precipMm !== null && precipMm < 0) ||
      (snowCm !== null && snowCm < 0) ||
      (sunshineSeconds !== null && sunshineSeconds < 0) ||
      (probability !== null && (probability < 0 || probability > 100))
    )
      return null;
    // Without temperatures the day is useless; the stop becomes unavailable only if it needed that day.
    if (highC === null || lowC === null) continue;
    records.push({
      date,
      highC,
      lowC,
      precipProbability: probability === null ? null : probability / 100,
      precipMm,
      snowCm: snowCm ?? 0,
      uvIndexMax,
      sunshineHours: sunshineSeconds === null ? null : sunshineSeconds / 3600,
    });
  }
  return records;
}

function requestUrl(
  base: string,
  latitude: number,
  longitude: number,
  start: string,
  end: string,
  source: WeatherSource,
): URL {
  const url = new URL(base);
  url.searchParams.set("latitude", String(round2(latitude)));
  url.searchParams.set("longitude", String(round2(longitude)));
  url.searchParams.set("start_date", start);
  url.searchParams.set("end_date", end);
  url.searchParams.set("daily", (source === "forecast" ? FORECAST_DAILY : ARCHIVE_DAILY).join(","));
  url.searchParams.set("timezone", "GMT");
  return url;
}

const average = (values: number[]): number =>
  values.reduce((sum, value) => sum + value, 0) / values.length;

function typicalDay(
  target: string,
  records: Map<string, DailyRecord>,
  sampleDates: string[],
  stopIndex: number,
): DayWeather | null {
  const samples = sampleDates.map((date) => records.get(date)).filter((row) => row !== undefined);
  if (samples.length === 0) return null;
  const sunshine = samples
    .map((row) => row.sunshineHours)
    .filter((value): value is number => value !== null);
  const wet = samples.map((row) => row.precipMm).filter((mm): mm is number => mm !== null);
  return {
    date: target,
    stopIndex,
    source: "typical",
    highC: average(samples.map((row) => row.highC)),
    lowC: average(samples.map((row) => row.lowC)),
    // Years with no precipitation value are left out of both numbers rather than counted as dry.
    precipProbability: wet.length ? wet.filter((mm) => mm >= 1).length / wet.length : 0,
    precipMm: wet.length ? average(wet) : 0,
    snowCm: average(samples.map((row) => row.snowCm)),
    uvIndexMax: null,
    sunshineHours: sunshine.length > 0 ? average(sunshine) : null,
  };
}

export function createOpenMeteoWeatherProvider({
  fetch: doFetch,
  now = () => new Date(),
  timeoutMs = WEATHER_TIMEOUT_MS,
  forecastUrl = OPEN_METEO_FORECAST_URL,
  archiveUrl = OPEN_METEO_ARCHIVE_URL,
  cache = new MemoryLruCache<DailyRecord[]>(CACHE_CAPACITY),
}: OpenMeteoWeatherOptions): WeatherProvider {
  async function getRecords(
    source: WeatherSource,
    latitude: number,
    longitude: number,
    start: string,
    end: string,
    signal?: AbortSignal,
  ): Promise<DailyRecord[]> {
    const roundedLatitude = round2(latitude);
    const roundedLongitude = round2(longitude);
    const key = `${source}:${roundedLatitude}:${roundedLongitude}:${start}:${end}`;
    const cached = cache.get(key);
    if (cached) {
      logWeatherEvent("cache-hit");
      return cached;
    }
    const url = requestUrl(
      source === "forecast" ? forecastUrl : archiveUrl,
      roundedLatitude,
      roundedLongitude,
      start,
      end,
      source,
    );
    const timeout = AbortSignal.timeout(timeoutMs);
    const response = await doFetch(url, {
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      headers: { accept: "application/json" },
      cache: "no-store",
    });
    if (!response.ok) throw new Error("weather provider unavailable");
    const records = parseDaily(await response.json(), source);
    if (!records) throw new Error("weather provider unavailable");
    cache.set(key, records, source === "forecast" ? FORECAST_TTL_MS : TYPICAL_TTL_MS);
    return records;
  }

  return {
    async getStopWeather(stop: WeatherStopInput, { signal, today: clientToday } = {}) {
      if (!finite(stop.latitude) || !finite(stop.longitude)) return unavailableStop(stop.stopIndex);
      const dates = stopDays(stop.arrive, stop.leave, stop.includeLeave);
      if (!dates) return unavailableStop(stop.stopIndex);
      const utcToday = formatDay(now());
      const today = clientToday ?? utcToday;
      const isForecast = (date: string) => isForecastable(date, today, utcToday);
      const forecastDates = dates.filter(isForecast);
      const typicalDates = dates.filter((date) => !isForecast(date));

      try {
        const forecastPromise =
          forecastDates.length === 0
            ? Promise.resolve<DailyRecord[]>([])
            : getRecords(
                "forecast",
                stop.latitude,
                stop.longitude,
                forecastDates[0],
                forecastDates[forecastDates.length - 1],
                signal,
              );

        const currentYear = now().getUTCFullYear();
        const samplesByTarget = new Map<string, string[]>();
        for (const target of typicalDates) {
          const samples = Array.from({ length: 5 }, (_, offset) =>
            sameCalendarDay(currentYear - 5 + offset, target),
          ).filter((date): date is string => date !== null);
          samplesByTarget.set(target, samples);
        }
        const allSamples = [...new Set([...samplesByTarget.values()].flat())].sort();
        const archivePromise =
          allSamples.length === 0
            ? Promise.resolve<DailyRecord[]>([])
            : getRecords(
                "typical",
                stop.latitude,
                stop.longitude,
                allSamples[0],
                allSamples[allSamples.length - 1],
                signal,
              );

        const [forecastRecords, archiveRecords] = await Promise.all([
          forecastPromise,
          archivePromise,
        ]);
        const forecastByDate = new Map(forecastRecords.map((record) => [record.date, record]));
        const archiveByDate = new Map(archiveRecords.map((record) => [record.date, record]));
        const days: DayWeather[] = [];
        for (const date of dates) {
          if (isForecast(date)) {
            const record = forecastByDate.get(date);
            if (!record) throw new Error("missing weather");
            // No probability from the model: a wet day (>= 1 mm, the same bar as typical data) is certain
            // enough to plan for; no precipitation value at all is no signal.
            const precipProbability =
              record.precipProbability ?? ((record.precipMm ?? 0) >= 1 ? 1 : 0);
            days.push({
              ...record,
              precipMm: record.precipMm ?? 0,
              date,
              stopIndex: stop.stopIndex,
              source: "forecast",
              precipProbability,
            });
          } else {
            const day = typicalDay(
              date,
              archiveByDate,
              samplesByTarget.get(date) ?? [],
              stop.stopIndex,
            );
            if (!day) throw new Error("missing weather");
            days.push(day);
          }
        }
        logWeatherEvent("request");
        return { stopIndex: stop.stopIndex, status: "ok", days };
      } catch {
        logWeatherEvent("provider-error");
        return unavailableStop(stop.stopIndex);
      }
    },
  };
}
