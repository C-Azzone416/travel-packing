import type { StopWeather } from "@/domain/weather/types";
import { localToday } from "@/lib/today";

export type WeatherFetchResult =
  { kind: "ready"; stops: StopWeather[] } | { kind: "offline" } | { kind: "unavailable" };

function validStopWeather(value: unknown): value is StopWeather {
  if (!value || typeof value !== "object") return false;
  const stop = value as Partial<StopWeather>;
  return (
    Number.isInteger(stop.stopIndex) &&
    (stop.status === "ok" || stop.status === "unavailable") &&
    Array.isArray(stop.days)
  );
}

/** Owner-only weather endpoint client. HTTP/provider failures are UI states, never thrown trip-load failures. */
export async function fetchTripWeather(
  tripId: string,
  doFetch: typeof fetch = fetch,
  today: string = localToday(),
): Promise<WeatherFetchResult> {
  try {
    // The device's local date decides which days are forecast; the server checks it before believing it.
    const query = `tripId=${encodeURIComponent(tripId)}&today=${encodeURIComponent(today)}`;
    const response = await doFetch(`/api/weather?${query}`, {
      cache: "no-store",
      credentials: "same-origin",
    });
    if (!response.ok) return { kind: "unavailable" };
    const body = (await response.json()) as { weather?: unknown };
    if (!Array.isArray(body.weather) || !body.weather.every(validStopWeather)) {
      return { kind: "unavailable" };
    }
    return { kind: "ready", stops: body.weather };
  } catch {
    return typeof navigator !== "undefined" && navigator.onLine === false
      ? { kind: "offline" }
      : { kind: "unavailable" };
  }
}
