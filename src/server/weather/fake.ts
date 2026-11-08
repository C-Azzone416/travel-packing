import type { DayWeather } from "@/domain/weather/types";
import { formatDay, isForecastable, parseDay, stopDays } from "./dates";
import type { WeatherProvider } from "./provider";
import { unavailableStop } from "./provider";

/** Deterministic local/e2e weather. It contains no real place fixtures and performs no I/O. */
export function createFakeWeatherProvider(now: () => Date = () => new Date()): WeatherProvider {
  return {
    async getStopWeather(stop, { today: clientToday } = {}) {
      if (stop.latitude === undefined || stop.longitude === undefined)
        return unavailableStop(stop.stopIndex);
      const dates = stopDays(stop.arrive, stop.leave, stop.includeLeave);
      const utcToday = formatDay(now());
      const today = clientToday ?? utcToday;
      if (!dates || !parseDay(today)) return unavailableStop(stop.stopIndex);
      const days: DayWeather[] = dates.map((date) => {
        const ordinal = Math.floor((parseDay(date) as Date).getTime() / 86_400_000);
        const rainy = (ordinal + stop.stopIndex) % 3 === 0;
        const source = isForecastable(date, today, utcToday) ? "forecast" : "typical";
        return {
          date,
          stopIndex: stop.stopIndex,
          source,
          highC: 21 + ((ordinal + stop.stopIndex) % 7),
          lowC: 12 + ((ordinal + stop.stopIndex) % 5),
          precipProbability: rainy ? 0.55 : 0.15,
          precipMm: rainy ? 4 : 0,
          snowCm: 0,
          uvIndexMax: source === "forecast" ? 4 : null,
          sunshineHours: rainy ? 3 : 8,
        };
      });
      return { stopIndex: stop.stopIndex, status: "ok", days };
    },
  };
}
