import { createFakeWeatherProvider } from "./fake";
import { createOpenMeteoWeatherProvider } from "./open-meteo";
import type { WeatherProvider } from "./provider";

type Env = Record<string, string | undefined>;

/** Local e2e may redirect provider traffic; deployed builds can never honor these overrides. */
export function weatherBaseUrls(env: Env): { forecastUrl?: string; archiveUrl?: string } {
  if (env.NEXT_PUBLIC_E2E_BUILD !== "1" || env.VERCEL) return {};
  return {
    forecastUrl: env.OPEN_METEO_FORECAST_URL,
    archiveUrl: env.OPEN_METEO_ARCHIVE_URL,
  };
}

export const openMeteoWeatherEnabled = (env: Env = process.env): boolean =>
  env.WEATHER_PROVIDER === "open-meteo";

/** Fails private and deterministic: only an explicit value enables external weather requests. */
export function selectWeatherProvider(
  env: Env = process.env,
  doFetch: typeof fetch = (...args) => fetch(...args),
  now: () => Date = () => new Date(),
): WeatherProvider {
  if (!openMeteoWeatherEnabled(env)) return createFakeWeatherProvider(now);
  return createOpenMeteoWeatherProvider({ fetch: doFetch, now, ...weatherBaseUrls(env) });
}
