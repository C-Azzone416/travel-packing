import { createRateLimiter, type RateLimiter } from "@/server/locations/rate-limit";

export const DEFAULT_WEATHER_REQUESTS_PER_MINUTE = 30;

export function weatherRequestsPerMinute(
  env: Record<string, string | undefined> = process.env,
): number {
  const raw = env.WEATHER_REQUESTS_PER_MINUTE?.trim() ?? "";
  if (!/^\d{1,4}$/.test(raw)) return DEFAULT_WEATHER_REQUESTS_PER_MINUTE;
  const value = Number(raw);
  return value >= 1 && value <= 1000 ? value : DEFAULT_WEATHER_REQUESTS_PER_MINUTE;
}

export function createWeatherRateLimiter(
  env: Record<string, string | undefined> = process.env,
  now: () => number = Date.now,
): RateLimiter {
  return createRateLimiter({ limit: weatherRequestsPerMinute(env), windowMs: 60_000, now });
}
