import type { TripStop } from "@/domain/trip-stops";
import type { DataContext } from "@/server/data/context";
import { getDataContext } from "@/server/data/runtime";
import { getTrip, getWeatherSettings } from "@/server/data/service";
import type { Result } from "@/server/data/result";
import type { WeatherSettings } from "@/server/data/weather-store";
import type { StopsSource, WeatherTripInput } from "./request-handler";

interface WeatherTripRecord {
  stops: TripStop[];
}

export interface WeatherDataApi {
  getTrip(context: DataContext, input: { tripId: string }): Promise<Result<WeatherTripRecord>>;
  getWeatherSettings(context: DataContext): Promise<Result<WeatherSettings>>;
}

const defaultApi: WeatherDataApi = { getTrip, getWeatherSettings };

/** Adapts #109's independently owner-authorized data service to the minimal weather-source contract. */
export function createDataStopsSource(
  getContext: () => Promise<DataContext | null> = getDataContext,
  api: WeatherDataApi = defaultApi,
): StopsSource {
  return {
    async loadWeatherTrip(_ownerId, tripId): Promise<WeatherTripInput | null> {
      const context = await getContext();
      if (!context) throw new Error("weather data unavailable");
      const [trip, settings] = await Promise.all([
        api.getTrip(context, { tripId }),
        api.getWeatherSettings(context),
      ]);
      if (!trip.ok) {
        if (trip.error.code === "NOT_FOUND" || trip.error.code === "INVALID_INPUT") return null;
        throw new Error("weather data unavailable");
      }
      if (!settings.ok) throw new Error("weather data unavailable");
      return {
        optedIn: settings.data.weatherOptIn,
        stops: trip.data.stops.map((stop, stopIndex, all) => ({
          stopIndex,
          arrive: stop.arrive,
          leave: stop.leave,
          includeLeave: stopIndex === all.length - 1,
          ...(stop.location.latitude === undefined ? {} : { latitude: stop.location.latitude }),
          ...(stop.location.longitude === undefined ? {} : { longitude: stop.location.longitude }),
        })),
      };
    },
  };
}
