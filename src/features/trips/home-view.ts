// Pure view-models for the laptop Home (#387, epic #375; spec on #376 part 3 section 1.1). No React, no clock: `today`
// is passed in. Counts are QUANTITY everywhere (PM decision on #376): a cube's n/m, "41 of 60" and the progress all
// add up item quantities, and a weather suggestion that was never added is not an item, so it is never counted.

import { parseDate } from "@/domain/calc";
import { canonicalItemId } from "@/domain/item-identity";
import {
  CUBE_LABELS,
  itemCube,
  morningOfCubesFor,
  weatherCubeLabel,
  type Cube,
} from "@/domain/cubes";
import type { LifecycleTrip, TripPhase } from "@/domain/trip-lifecycle";
import { packingButtonLabel } from "@/lib/trip-phase-copy";
import type { UsualWeatherRow } from "@/components/ui/UsualWeather";
import { routeTextShort, stopsOrDestination, tripDisplayName } from "@/domain/trip-route";
import { daysBetween, type TripStop } from "@/domain/trip-stops";
import type { StopWeather } from "@/domain/weather/types";
import { WEATHER_RULES } from "@/domain/weather/recommend";
import { defaultFormatRange } from "@/domain/weather/recommend";
import { displayTemperature, weatherRowView } from "@/features/trip/weather-view";
import type { TemperatureUnit } from "@/server/data/weather-store";

// ---------------------------------------------------------------- cubes

/** The Home suitcase order (spec): the weather cube sits third and only exists when the trip has one. */
const HOME_CUBE_ORDER: readonly Cube[] = [
  "clothing",
  "toiletries",
  "weather",
  "tech",
  "documents",
  "misc",
];

export interface CubeSummary {
  cube: Cube;
  /** "Clothing", or the condition label for the weather cube ("Rain gear"). */
  name: string;
  packed: number;
  total: number;
  /** One line under the bar, or null. */
  note: string | null;
  morningOf: boolean;
  /** The weather cube while it holds an added weather item that is not yet packed (outlined). */
  alert: boolean;
  complete: boolean;
}

/** Where the weather cube's items came from: the cities with a rainy (or snowy) day, and the word for the condition. */
export interface WeatherNoteInput {
  cities: readonly string[];
}

const upper = (code: string | undefined) => (code ?? "").trim().toUpperCase();

/**
 * True when the trip leaves the home country, false when it stays, null when that cannot be told (no origin, or a place
 * without a country code): the passport note is then left out rather than guessed.
 */
export function isInternational(
  trip: Pick<LifecycleTrip, "origin" | "stops" | "location" | "start" | "end">,
): boolean | null {
  const home = upper(trip.origin?.location.countryCode);
  if (home === "") return null;
  const codes = stopsOrDestination(trip)
    .map((stop) => upper(stop.location.countryCode))
    .filter((code) => code !== "");
  if (codes.length === 0) return null;
  return codes.some((code) => code !== home);
}

const WEATHER_CONDITION: ReadonlyArray<readonly [label: string, word: string]> = [
  ["Rain gear", "rain"],
  ["Snow gear", "snow"],
  ["Sun gear", "sun"],
];

function conditionWord(label: string): string | null {
  return WEATHER_CONDITION.find(([name]) => name === label)?.[1] ?? null;
}

function joinNames(names: readonly string[]): string {
  return names.length <= 1
    ? (names[0] ?? "")
    : `${names.slice(0, -1).join(", ")} & ${names[names.length - 1]}`;
}

/** "added for Porto rain", "added for Lisbon & Porto rain", "added for 3 cities" (spec section 5). */
export function weatherNote(label: string, cities: readonly string[]): string {
  const word = conditionWord(label);
  const where = cities.length > 2 ? "3 cities" : joinNames(cities);
  const tail = cities.length > 2 ? "" : word ? ` ${word}` : "";
  if (cities.length === 0) return word ? `added for ${word}` : "added for the weather";
  return `added for ${where}${tail}`.replace("3 cities", `${cities.length} cities`);
}

/** The cubes the Home suitcase shows, in order, with counts, notes and the outline rule. Empty cubes are left out. */
export function cubeSummaries(
  trip: LifecycleTrip,
  weather: WeatherNoteInput = { cities: [] },
): CubeSummary[] {
  const byCube = new Map<Cube, LifecycleTrip["items"]>();
  for (const item of trip.items) {
    const cube = itemCube(item);
    byCube.set(cube, [...(byCube.get(cube) ?? []), item]);
  }
  const morning = new Set(morningOfCubesFor(trip.items, trip.morningOfCubes));
  const international = isInternational(trip);
  const flying = trip.travelMode === "fly";

  return HOME_CUBE_ORDER.flatMap((cube): CubeSummary[] => {
    const items = byCube.get(cube) ?? [];
    const total = items.reduce((sum, item) => sum + item.qty, 0);
    if (total === 0) return [];
    const packed = items.reduce((sum, item) => sum + Math.min(item.packed, item.qty), 0);
    const name =
      cube === "weather" ? weatherCubeLabel(items.map((item) => item.id)) : CUBE_LABELS[cube];

    // Notes in priority order: weather, passport, 3.4 oz; the first two are shown (spec section 5).
    const notes: string[] = [];
    if (cube === "weather") notes.push(weatherNote(name, weather.cities));
    if (cube === "documents" && international === true) {
      const passport = items.find((item) => canonicalItemId(item.id) === "passport");
      notes.push(
        passport ? (passport.packed >= passport.qty ? "passport ✓" : "passport") : "add passport",
      );
    }
    if (cube === "toiletries" && flying) notes.push("under 3.4 oz");

    return [
      {
        cube,
        name,
        packed,
        total,
        note: notes.length > 0 ? notes.slice(0, 2).join(" · ") : null,
        morningOf: morning.has(cube),
        alert: cube === "weather" && items.some((item) => item.packed < item.qty),
        complete: packed >= total,
      },
    ];
  });
}

export interface BagTotals {
  packed: number;
  total: number;
}

/** "41 of 60": the sum over the cubes shown. */
export function bagTotals(cubes: readonly CubeSummary[]): BagTotals {
  return cubes.reduce(
    (sum, cube) => ({ packed: sum.packed + cube.packed, total: sum.total + cube.total }),
    { packed: 0, total: 0 },
  );
}

/** The first cube with something left to pack, or null when every cube is complete (or there are none). */
export function firstOpenCube(cubes: readonly CubeSummary[]): Cube | null {
  return cubes.find((cube) => !cube.complete)?.cube ?? null;
}

/**
 * The suitcase button: Start / Continue packing / Open list (src/lib/trip-phase-copy). A Ready trip keeps "Review bag"
 * (Caroline's ruling on #338); the all-packed state is #411.
 */
export function suitcaseButtonLabel(totals: BagTotals, ready: boolean, phase: TripPhase): string {
  if (ready) return "Review bag";
  return packingButtonLabel(totals.packed, phase);
}

/** Packing for a trip, optionally with one cube open (the Packing screen reads `?cube=`, #385). */
export function packingHref(tripId: string, cube?: Cube | null): string {
  return cube ? `/trips/${tripId}?cube=${cube}` : `/trips/${tripId}`;
}

// ---------------------------------------------------------------- tag text

const WEEKDAY = new Intl.DateTimeFormat("en", { weekday: "short", timeZone: "UTC" });
const MONTH = new Intl.DateTimeFormat("en", { month: "short", timeZone: "UTC" });

function dateParts(
  value: string,
): { weekday: string; day: number; month: string; year: number } | null {
  const date = parseDate(value);
  if (!date) return null;
  return {
    weekday: WEEKDAY.format(date),
    day: date.getUTCDate(),
    month: MONTH.format(date),
    year: date.getUTCFullYear(),
  };
}

/**
 * "Sat 14 – Tue 24 Mar" (the month is said once when both days share it), with the year after it when the trip is not
 * in this year ("... Mar 2027", spec #393 section 1.1). A one-day trip is "Sat 14 Mar".
 */
export function tagDates(trip: Pick<LifecycleTrip, "start" | "end">, today: string): string {
  const from = dateParts(trip.start);
  const to = dateParts(trip.end);
  if (!from || !to) return "Choose dates";
  const year = to.year === (dateParts(today)?.year ?? to.year) ? "" : ` ${to.year}`;
  if (trip.start === trip.end) return `${from.weekday} ${from.day} ${from.month}${year}`;
  const left =
    from.month === to.month
      ? `${from.weekday} ${from.day}`
      : `${from.weekday} ${from.day} ${from.month}`;
  return `${left} – ${to.weekday} ${to.day} ${to.month}${year}`;
}

/** The hero's two lines: the name, and "& Porto" under it when an unnamed trip has several cities. */
export function heroName(trip: LifecycleTrip): {
  title: string;
  subtitle: string | null;
  size: "xl" | "l" | "m";
} {
  const full = tripDisplayName(trip);
  const named = (trip.name ?? "").trim() !== "";
  const cities = stopsOrDestination(trip)
    .map((stop) => stop.location.city.trim())
    .filter(
      (city, at, all) =>
        city !== "" && all.findIndex((c) => c.toLowerCase() === city.toLowerCase()) === at,
    );
  const split = !named && cities.length > 1;
  const title = split ? cities[0] : full;
  // Long names step down so a 72px heading never runs off the tag.
  const size = title.length <= 9 ? "xl" : title.length <= 16 ? "l" : "m";
  return { title, subtitle: split ? `& ${cities.slice(1).join(", ")}` : null, size };
}

export interface Countdown {
  /** Whole days to the first day; the badge is shown only for a trip that has not started. */
  days: number;
  /** "12 days to go", "1 day to go", "Leaves today": what a screen reader hears. */
  spoken: string;
}

/**
 * The countdown, or null once the trip has started (the during-trip badge is #410).
 * TODO(#408/#410): tripPhase decides this; until then a started trip shows the tag without a badge.
 */
export function countdownFor(trip: Pick<LifecycleTrip, "start">, today: string): Countdown | null {
  const days = daysBetween(today, trip.start);
  if (days < 0) return null;
  return {
    days,
    spoken: days === 0 ? "Leaves today" : days === 1 ? "1 day to go" : `${days} days to go`,
  };
}

export interface UpcomingRow {
  id: string;
  /** "02 APR" (always a day, spec), with the year when it is not this year: "02 APR 2027". */
  date: string;
  name: string;
  /** "SEA → DEN". */
  route: string;
}

export function upcomingRow(trip: LifecycleTrip, today: string): UpcomingRow {
  const from = dateParts(trip.start);
  const year = from && from.year !== (dateParts(today)?.year ?? from.year) ? ` ${from.year}` : "";
  return {
    id: trip.id,
    date: from ? `${String(from.day).padStart(2, "0")} ${from.month}${year}`.toUpperCase() : "",
    name: tripDisplayName(trip),
    route: routeTextShort(trip.origin, stopsOrDestination(trip)),
  };
}

// ---------------------------------------------------------------- weather by city

export interface DayTile {
  date: string;
  /** "Thu" */
  day: string;
  /** "19" */
  dayOfMonth: string;
  high: number;
  low: number;
  /** 0..1 */
  precipProbability: number;
  rain: boolean;
}

export interface CityWeather {
  stopIndex: number;
  city: string;
  /** "70°/54°" in the person's unit. */
  range: string;
  /** "mostly dry", "rain Thu–Sat", "snow likely", or "typical, mostly dry" (an average, not a forecast). */
  summary: string;
  source: "forecast" | "typical";
  /** A forecast day with rain (or snow): the row opens by default and is outlined. */
  alert: boolean;
  /** The word for what the alert is: "rain" or "snow". */
  condition: "rain" | "snow" | null;
  tiles: DayTile[];
  /** Forecast days beyond the seven shown. */
  more: number;
}

const MAX_TILES = 7;
const RAIN_PERCENT = WEATHER_RULES.rainProbability * 100;

/** One entry per stop that has weather; a stop without any is left out. */
export function cityWeather(
  stops: readonly TripStop[],
  weather: readonly StopWeather[],
  unit: TemperatureUnit,
  today: string,
): CityWeather[] {
  const rows: CityWeather[] = [];
  stops.forEach((stop, index) => {
    const found = weather.find((entry) => entry.stopIndex === index);
    const row = found ? weatherRowView(stop, found, unit, today) : null;
    if (!row) return;
    const forecast = row.forecastDays;
    const part = row.forecast ?? {
      high: row.high,
      low: row.low,
      rainDays: row.rainDays,
      totalDays: row.totalDays,
    };
    const rainy = forecast.filter((day) => day.rainPercent >= RAIN_PERCENT);
    const snowy = forecast.some((day) => day.glyph === "snow");
    const condition = snowy ? "snow" : rainy.length > 0 ? "rain" : null;
    const range = `${displayTemperature(part.high, unit)}°/${displayTemperature(part.low, unit)}°`;
    let summary: string;
    if (forecast.length === 0) {
      summary = `typical, ${part.rainDays > 0 ? `rain on ${part.rainDays} of ${part.totalDays} days` : "mostly dry"}`;
    } else if (snowy) {
      summary = "snow likely";
    } else if (rainy.length > 0) {
      const first = rainy[0].parts.weekday;
      const last = rainy[rainy.length - 1].parts.weekday;
      summary = first === last ? `rain ${first}` : `rain ${first}–${last}`;
    } else {
      summary = "mostly dry";
    }
    rows.push({
      stopIndex: index,
      city: row.city,
      range,
      summary,
      source: forecast.length > 0 ? "forecast" : "typical",
      alert: condition !== null,
      condition,
      tiles: forecast.slice(0, MAX_TILES).map((day) => ({
        date: day.date,
        day: day.parts.weekday,
        dayOfMonth: String(day.parts.day),
        high: day.high,
        low: day.low,
        precipProbability: day.rainPercent / 100,
        rain: day.rainPercent >= RAIN_PERCENT,
      })),
      more: Math.max(0, forecast.length - MAX_TILES),
    });
  });
  return rows;
}

/** The cities whose forecast has an alert, for the weather cube's "added for ..." note. */
export function alertCities(rows: readonly CityWeather[]): string[] {
  return rows.filter((row) => row.alert).map((row) => row.city);
}

/** The condition for the alert header ("Rain"), from the weather cube's label; "Weather" when it has no single word. */
export function alertHeading(label: string | null, condition: "rain" | "snow" | null): string {
  const word = (label && conditionWord(label)) ?? condition;
  return word ? word.charAt(0).toUpperCase() + word.slice(1) : "Weather";
}

/** Usual-weather rows for a trip whose forecast has not opened: every stop's averages, never day tiles. */
export function usualRows(
  stops: readonly TripStop[],
  weather: readonly StopWeather[] | null,
  unit: TemperatureUnit,
  today: string,
): UsualWeatherRow[] {
  return stops.map((stop, index) => {
    const base = {
      id: String(index),
      city: stop.location.city,
      dates: defaultFormatRange(stop.arrive, stop.leave),
    };
    const found = weather?.find((entry) => entry.stopIndex === index);
    const row = found ? weatherRowView(stop, found, unit, today) : null;
    if (!row) return { ...base, unavailable: weather !== null };
    return {
      ...base,
      line:
        row.rainDays > 0
          ? `about ${row.rainDays} rainy ${row.rainDays === 1 ? "day" : "days"}`
          : "rarely rains",
      range: `${displayTemperature(row.high, unit)}° / ${displayTemperature(row.low, unit)}°`,
    };
  });
}
