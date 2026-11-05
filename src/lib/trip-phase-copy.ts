// Copy for the trip phases (Suitcase P3, #408): when the forecast opens, the year suffix, and the packing button.
// Pure; `today` is always passed in (device-local, `localToday`).

import { parseDate } from "@/domain/calc";
import { forecastOpensOn, type TripPhase } from "@/domain/trip-lifecycle";
import { daysBetween } from "@/domain/trip-stops";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

/** Within this many days the open date reads "in 3 days" instead of a weekday and date. */
export const OPENS_RELATIVE_DAYS = 7;

/**
 * "Thu 27 Feb" (or "27 Feb" without the weekday). The year is added ("Thu 27 Feb 2027") only when the date is not in
 * the same calendar year as `today`, so a trip next spring says so. Null when `value` is not a date.
 */
export function shortDate(
  value: string,
  today: string,
  options: { weekday?: boolean } = {},
): string | null {
  const date = parseDate(value);
  if (!date) return null;
  const now = parseDate(today);
  const weekday = options.weekday === false ? "" : `${WEEKDAYS[date.getUTCDay()]} `;
  const year =
    now && now.getUTCFullYear() !== date.getUTCFullYear() ? ` ${date.getUTCFullYear()}` : "";
  return `${weekday}${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}${year}`;
}

export interface ForecastOpens {
  /** "Thu 27 Feb" (with the year when it is another year). */
  date: string;
  /** "Thu 27 Feb", or "in 3 days" when the date is within the next 7 days. */
  text: string;
}

/** When the live forecast reaches a trip that starts on `start`: 15 days before. Null for an unusable date. */
export function forecastOpens(start: string, today: string): ForecastOpens | null {
  const opensOn = forecastOpensOn(start);
  const date = opensOn ? shortDate(opensOn, today) : null;
  if (!opensOn || !date) return null;
  const away = daysBetween(today, opensOn);
  const relative = away >= 1 && away <= OPENS_RELATIVE_DAYS;
  return { date, text: relative ? `in ${away} ${away === 1 ? "day" : "days"}` : date };
}

/** The packing button: "Start packing" while nothing is packed, "Continue packing" after, "Open list" during the trip. */
export function packingButtonLabel(packed: number, phase: TripPhase): string {
  if (phase === "during") return "Open list";
  return packed > 0 ? "Continue packing" : "Start packing";
}
