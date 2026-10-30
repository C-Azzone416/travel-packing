import { daysBetween, type TripStop } from "@/domain/trip-stops";
import { defaultFormatRange, WEATHER_RULES } from "@/domain/weather/recommend";
import type { DayWeather, StopWeather, WeatherSource } from "@/domain/weather/types";
import type { TemperatureUnit } from "@/server/data/weather-store";

export type Glyph = "sun" | "rain" | "snow";

/** One forecast day, ready to draw. Temperatures are already in the person's unit. */
export interface DayView {
  date: string;
  /** "Fri Nov 6", or "Today Oct 28" (month first, like the stay dates). */
  label: string;
  /** The label's parts, so the dashboard chip can show "Fri 6" and the phone row "Fri Nov 6" (#303). */
  parts: { weekday: string; month: string; day: number };
  /** The full sentence for screen readers: "Friday 6 November: sunny, high 18, low 11, 10% chance of rain". */
  spoken: string;
  glyph: Glyph;
  high: number;
  low: number;
  rainPercent: number;
}

/** High, low and wet days over one kind of day, in Celsius (the panel converts for display). */
export interface PartSummary {
  high: number;
  low: number;
  rainDays: number;
  totalDays: number;
}

export interface WeatherRowView {
  stopIndex: number;
  city: string;
  dates: string;
  nights: number;
  source: WeatherSource;
  mixed: boolean;
  high: number;
  low: number;
  rainDays: number;
  totalDays: number;
  glyph: Glyph;
  /** Forecast days only, chronological (#303). Empty for a typical-only stay. */
  forecastDays: DayView[];
  /** Summary over the forecast days only, or null when the stay has none. */
  forecast: PartSummary | null;
  /** Summary over the typical days only (before or after the forecast window), or null when it has none. */
  typical: PartSummary | null;
}

export function displayTemperature(celsius: number, unit: TemperatureUnit): number {
  return Math.round(unit === "C" ? celsius : (celsius * 9) / 5 + 32);
}

function dominantSource(days: readonly DayWeather[]): WeatherSource {
  const forecast = days.filter((day) => day.source === "forecast").length;
  return forecast >= days.length / 2 ? "forecast" : "typical";
}

function weatherGlyph(days: readonly DayWeather[]): Glyph {
  if (days.some((day) => day.snowCm >= 1)) return "snow";
  if (days.some((day) => day.precipProbability >= WEATHER_RULES.rainProbability)) return "rain";
  return "sun";
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/**
 * Today as a calendar date in UTC, the same clock the server uses to choose forecast days. Late in the evening in the
 * Americas this is already tomorrow's date. #26 (Caroline's timezone decision) may change this; a test pins it for now.
 */
export const todayUtc = (): string => new Date().toISOString().slice(0, 10);

const GLYPH_WORD: Record<Glyph, string> = {
  sun: "sunny",
  rain: "rain likely",
  snow: "snow likely",
};

/** One day through the same rules as the stay glyph. The date is read as UTC so no timezone can shift it. */
export function dayView(day: DayWeather, unit: TemperatureUnit, today: string): DayView {
  const at = new Date(`${day.date}T00:00:00.000Z`);
  const weekday = WEEKDAYS[at.getUTCDay()];
  const month = MONTHS[at.getUTCMonth()];
  const date = at.getUTCDate();
  const glyph = weatherGlyph([day]);
  const high = displayTemperature(day.highC, unit);
  const low = displayTemperature(day.lowC, unit);
  const rainPercent = Math.round(day.precipProbability * 100);
  const shortWeekday = day.date === today ? "Today" : weekday.slice(0, 3);
  return {
    date: day.date,
    label: `${shortWeekday} ${month.slice(0, 3)} ${date}`,
    parts: { weekday: shortWeekday, month: month.slice(0, 3), day: date },
    spoken:
      `${weekday} ${date} ${month}: ${GLYPH_WORD[glyph]}, high ${high}, low ${low}, ` +
      `${rainPercent}% chance of rain`,
    glyph,
    high,
    low,
    rainPercent,
  };
}

function summarize(days: readonly DayWeather[]): PartSummary | null {
  if (days.length === 0) return null;
  return {
    high: Math.max(...days.map((day) => day.highC)),
    low: Math.min(...days.map((day) => day.lowC)),
    rainDays: days.filter((day) => day.precipProbability >= WEATHER_RULES.rainProbability).length,
    totalDays: days.length,
  };
}

export function weatherRowView(
  stop: TripStop,
  weather: StopWeather,
  unit: TemperatureUnit = "C",
  today: string = todayUtc(),
): WeatherRowView | null {
  if (weather.status !== "ok" || weather.days.length === 0) return null;
  const days = weather.days;
  const forecastDays = days.filter((day) => day.source === "forecast");
  const sources = new Set(days.map((day) => day.source));
  return {
    stopIndex: weather.stopIndex,
    city: stop.location.city,
    dates: defaultFormatRange(stop.arrive, stop.leave),
    nights: daysBetween(stop.arrive, stop.leave),
    source: dominantSource(days),
    mixed: sources.size > 1,
    high: Math.max(...days.map((day) => day.highC)),
    low: Math.min(...days.map((day) => day.lowC)),
    rainDays: days.filter((day) => day.precipProbability >= WEATHER_RULES.rainProbability).length,
    totalDays: days.length,
    glyph: weatherGlyph(days),
    forecastDays: [...forecastDays]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((day) => dayView(day, unit, today)),
    forecast: summarize(forecastDays),
    typical: summarize(days.filter((day) => day.source === "typical")),
  };
}

export function hasCoordinates(stop: TripStop): boolean {
  return Number.isFinite(stop.location.latitude) && Number.isFinite(stop.location.longitude);
}
