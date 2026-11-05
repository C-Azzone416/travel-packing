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
  /** `today` is the device's local date, already validated by `resolveClientToday`; it defaults to the server's GMT date. */
  getStopWeather(
    stop: WeatherStopInput,
    options?: { signal?: AbortSignal; today?: string },
  ): Promise<StopWeather>;
}

export const unavailableStop = (stopIndex: number): StopWeather => ({
  stopIndex,
  status: "unavailable",
  days: [],
});
