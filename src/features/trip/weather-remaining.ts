// The weather still ahead while a trip is on (#410): one calculation for every screen that counts or resolves weather
// changes (the Home's ALERT and "N to review", and the Packing page's review), so they cannot disagree.

import { tripPhase, type LifecycleTrip } from "@/domain/trip-lifecycle";
import type { TripStop } from "@/domain/trip-stops";
import type { StopWeather } from "@/domain/weather/types";

/**
 * The stay the person is in on `today` (arrive <= today < leave; the last stay also on its leave day), or null. A stay's
 * leave day is the next one's arrival, so the later stay wins on a changeover day.
 */
export function hereStopIndex(stops: readonly TripStop[], today: string): number | null {
  const inside = (stop: TripStop) => stop.arrive <= today && today < stop.leave;
  const at = stops.findIndex(inside);
  if (at >= 0) return at;
  const last = stops.length - 1;
  return last >= 0 && stops[last].arrive <= today && today === stops[last].leave ? last : null;
}

/**
 * The weather still ahead (#410): days before `today` are dropped (never shown as typical), and so is a stay that is over
 * (it ended before today, or today is its leave day and the next stay has begun). Stop indexes are kept.
 */
export function remainingWeather(
  stops: readonly TripStop[],
  weather: readonly StopWeather[],
  today: string,
): StopWeather[] {
  const here = hereStopIndex(stops, today);
  return weather
    .filter((entry) => {
      const stop = stops[entry.stopIndex];
      return !stop || stop.leave > today || entry.stopIndex === here;
    })
    .map((entry) => ({ ...entry, days: entry.days.filter((day) => day.date >= today) }));
}

/**
 * The weather a review is made from: only the days still ahead while the trip is on (`during`), else all of it. Days that
 * are over cannot be packed for, so no change is asked about them on the Home or on Packing.
 */
export function weatherForReview(
  trip: Pick<LifecycleTrip, "start" | "end">,
  stops: readonly TripStop[],
  weather: readonly StopWeather[],
  today: string,
): StopWeather[] {
  return tripPhase(trip, today) === "during"
    ? remainingWeather(stops, weather, today)
    : [...weather];
}
