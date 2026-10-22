import { daysBetween, type TripStop } from "@/domain/trip-stops";
import { defaultFormatRange, WEATHER_RULES } from "@/domain/weather/recommend";
import type { DayWeather, StopWeather, WeatherSource } from "@/domain/weather/types";
import type { TemperatureUnit } from "@/server/data/weather-store";

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
  glyph: "sun" | "rain" | "snow";
}

export function displayTemperature(celsius: number, unit: TemperatureUnit): number {
  return Math.round(unit === "C" ? celsius : (celsius * 9) / 5 + 32);
}

function dominantSource(days: readonly DayWeather[]): WeatherSource {
  const forecast = days.filter((day) => day.source === "forecast").length;
  return forecast >= days.length / 2 ? "forecast" : "typical";
}

function weatherGlyph(days: readonly DayWeather[]): WeatherRowView["glyph"] {
  if (days.some((day) => day.snowCm >= 1)) return "snow";
  if (days.some((day) => day.precipProbability >= WEATHER_RULES.rainProbability)) return "rain";
  return "sun";
}

export function weatherRowView(stop: TripStop, weather: StopWeather): WeatherRowView | null {
  if (weather.status !== "ok" || weather.days.length === 0) return null;
  const days = weather.days;
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
  };
}

export function hasCoordinates(stop: TripStop): boolean {
  return Number.isFinite(stop.location.latitude) && Number.isFinite(stop.location.longitude);
}
