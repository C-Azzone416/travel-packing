import { createFakeWeatherProvider } from "./fake";
import { createOpenMeteoWeatherProvider } from "./open-meteo";
import { unavailableStop, type WeatherProvider } from "./provider";

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

/** The deterministic fake exists for e2e builds only; a deployed build can never serve made-up weather. */
export const fakeWeatherEnabled = (env: Env = process.env): boolean =>
  env.WEATHER_PROVIDER === "fake" && env.NEXT_PUBLIC_E2E_BUILD === "1" && !env.VERCEL;

/** Every stop is unavailable and nothing leaves the server. */
const unavailableProvider: WeatherProvider = {
  getStopWeather: async (stop) => unavailableStop(stop.stopIndex),
};

/** Fails private and honest: only an explicit value enables external requests, and anything else shows no weather. */
export function selectWeatherProvider(
  env: Env = process.env,
  doFetch: typeof fetch = (...args) => fetch(...args),
  now: () => Date = () => new Date(),
): WeatherProvider {
  if (openMeteoWeatherEnabled(env))
    return createOpenMeteoWeatherProvider({ fetch: doFetch, now, ...weatherBaseUrls(env) });
  if (fakeWeatherEnabled(env)) return createFakeWeatherProvider(now);
  return unavailableProvider;
}
