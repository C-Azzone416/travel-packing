import type { StopWeather } from "@/domain/weather/types";

/** The provider sees no trip, owner or place identity: only the minimum weather inputs. */
export interface WeatherStopInput {
  stopIndex: number;
  arrive: string;
  leave: string;
  /** The trip's final day belongs to its final stop. */
  includeLeave: boolean;
  latitude?: number;
  longitude?: number;
}

export interface WeatherProvider {
  getStopWeather(stop: WeatherStopInput, options?: { signal?: AbortSignal }): Promise<StopWeather>;
}

export const unavailableStop = (stopIndex: number): StopWeather => ({
  stopIndex,
  status: "unavailable",
  days: [],
});
