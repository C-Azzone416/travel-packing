"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isCustomLocation } from "@/domain/locations";
import type { TripStop } from "@/domain/trip-stops";
import type { StopWeather } from "@/domain/weather/types";
import type { TripsSource } from "@/features/trips/trips-source";
import type { WeatherSettings } from "@/server/data/weather-store";

/** Where the weather for the draft's stops stands (the same states the old create flow had). */
export type PlanWeather =
  | { kind: "hidden" }
  | { kind: "prompt"; settings: WeatherSettings }
  | { kind: "off"; settings: WeatherSettings }
  | { kind: "loading"; settings: WeatherSettings }
  | { kind: "offline"; settings: WeatherSettings }
  | { kind: "unavailable"; settings: WeatherSettings }
  | { kind: "ready"; settings: WeatherSettings; stops: StopWeather[]; routeKey: string };

/** A quiet period after the last change, so choosing dates does not ask the provider for each one. */
export const WEATHER_DEBOUNCE_MS = 400;

/** What the weather depends on: each stop's coordinates and dates. */
function keyOf(route: readonly TripStop[]): string {
  return JSON.stringify(
    route.map((stop) => [stop.location.latitude, stop.location.longitude, stop.arrive, stop.leave]),
  );
}

export interface UsePlanWeather {
  weather: PlanWeather;
  /** Answer the opt-in question (or turn weather back on). Resolves false when the setting could not be saved. */
  setOptIn: (weatherOptIn: boolean) => Promise<boolean>;
  refresh: () => void;
}

/**
 * Loads the weather for a draft's stops while `active` (Where and When are finished and no saved list is chosen). Only
 * coordinates and dates leave the browser, and only when the person has opted in; a person who has not is asked once.
 */
export function usePlanWeather(
  source: TripsSource,
  route: readonly TripStop[],
  active: boolean,
): UsePlanWeather {
  const [weather, setWeather] = useState<PlanWeather>({ kind: "hidden" });
  const latest = useRef(0);
  const routeKey = keyOf(route);
  const routeRef = useRef(route);
  useEffect(() => {
    routeRef.current = route;
  });

  const load = useCallback(
    async (known?: WeatherSettings) => {
      const ticket = ++latest.current;
      const fresh = () => ticket === latest.current;
      const stops = routeRef.current;
      const feed = source.weather;
      if (!feed || stops.length === 0 || stops.every((stop) => isCustomLocation(stop.location))) {
        setWeather({ kind: "hidden" });
        return;
      }
      try {
        const settings = known ?? (await feed.getSettings());
        if (!fresh()) return;
        if (!settings.weatherOptIn) {
          setWeather({ kind: "prompt", settings });
          return;
        }
        setWeather({ kind: "loading", settings });
        const result = await feed.previewDraft([...stops]);
        if (!fresh()) return;
        if (result.kind === "offline") setWeather({ kind: "offline", settings });
        else if (result.kind === "unavailable") setWeather({ kind: "unavailable", settings });
        else setWeather({ kind: "ready", settings, stops: result.stops, routeKey: keyOf(stops) });
      } catch {
        if (!fresh()) return;
        setWeather((current) =>
          "settings" in current ? { kind: "unavailable", settings: current.settings } : current,
        );
      }
    },
    [source],
  );

  useEffect(() => {
    if (!active) {
      // Whatever is still on its way is no longer wanted.
      latest.current += 1;
      return;
    }
    const timer = setTimeout(() => void load(), WEATHER_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [active, routeKey, load]);

  const setOptIn = useCallback(
    async (weatherOptIn: boolean) => {
      const feed = source.weather;
      if (!feed) return false;
      try {
        const settings = await feed.updateSettings({ weatherOptIn });
        if (!weatherOptIn) {
          latest.current += 1;
          setWeather({ kind: "off", settings });
        } else await load(settings);
        return true;
      } catch {
        return false;
      }
    },
    [source, load],
  );

  // Weather loaded for other stops or dates is not this trip's weather: until the new one arrives it is loading.
  const shown = useMemo<PlanWeather>(
    () =>
      !active
        ? { kind: "hidden" }
        : weather.kind === "ready" && weather.routeKey !== routeKey
          ? { kind: "loading", settings: weather.settings }
          : weather,
    [active, weather, routeKey],
  );
  const refresh = useCallback(() => {
    void load("settings" in shown ? shown.settings : undefined);
  }, [load, shown]);

  return { weather: shown, setOptIn, refresh };
}
