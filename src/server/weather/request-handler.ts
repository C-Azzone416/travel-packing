import type { StopWeather } from "@/domain/weather/types";
import type { RateLimiter } from "@/server/locations/rate-limit";
import type { WeatherProvider, WeatherStopInput } from "./provider";
import { unavailableStop } from "./provider";
import { logWeatherEvent } from "./safe-log";

export interface WeatherTripInput {
  optedIn: boolean;
  stops: readonly WeatherStopInput[];
}

/** Implemented by #109's owner-scoped data layer. A different owner's trip must return null. */
export interface StopsSource {
  loadWeatherTrip(ownerId: string, tripId: string): Promise<WeatherTripInput | null>;
}

export type WeatherResponse =
  | { status: 200; body: { weather: StopWeather[] } }
  | { status: 400; body: { error: "invalid-trip" } }
  | { status: 404; body: { error: "not-found" } }
  | { status: 429; body: { error: "rate-limited" }; retryAfterSeconds: number };

const TRIP_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const validTripId = (value: string | null): value is string =>
  value !== null && TRIP_ID.test(value);

export async function handleWeatherRequest(
  rawTripId: string | null,
  ownerId: string,
  {
    source,
    provider,
    limiter,
  }: { source: StopsSource; provider: WeatherProvider; limiter: RateLimiter },
  signal?: AbortSignal,
): Promise<WeatherResponse> {
  if (!validTripId(rawTripId)) {
    logWeatherEvent("invalid-trip");
    return { status: 400, body: { error: "invalid-trip" } };
  }
  const decision = limiter.consume(ownerId);
  if (!decision.ok) {
    logWeatherEvent("rate-limited");
    return {
      status: 429,
      body: { error: "rate-limited" },
      retryAfterSeconds: Math.max(1, Math.ceil(decision.retryAfterMs / 1000)),
    };
  }
  const trip = await source.loadWeatherTrip(ownerId, rawTripId);
  if (!trip) {
    logWeatherEvent("not-found");
    return { status: 404, body: { error: "not-found" } };
  }
  if (!trip.optedIn) {
    logWeatherEvent("opted-out");
    return { status: 200, body: { weather: [] } };
  }
  const weather = await Promise.all(
    trip.stops.map(async (stop) => {
      if (stop.latitude === undefined || stop.longitude === undefined)
        return unavailableStop(stop.stopIndex);
      try {
        return await provider.getStopWeather(stop, { signal });
      } catch {
        logWeatherEvent("provider-error");
        return unavailableStop(stop.stopIndex);
      }
    }),
  );
  logWeatherEvent("request");
  return { status: 200, body: { weather } };
}
