// Pure view-models for the trips dashboard. No React, no clock: `today` is passed in.

import { parseDate } from "@/domain/calc";
import { daysBetween, type TripStop } from "@/domain/trip-stops";
import type { StopWeather } from "@/domain/weather/types";
import {
  dayCount,
  displayTemperature,
  typicalLine,
  weatherRowView,
  type DayView,
  type WeatherRowView,
} from "@/features/trip/weather-view";
import type { TemperatureUnit } from "@/server/data/weather-store";
import { packedTotals } from "@/domain/readiness";
import { isPastTrip, classifyTrip, type LifecycleTrip } from "@/domain/trip-lifecycle";
import { toiletryBagState, toiletryItems, TOILETRY_GROUP_ID } from "@/domain/toiletry-bag";
import type { TripItem } from "@/domain/trip";

export type TripListView = "upcoming" | "archive";
export type QuickFilter = "still" | "all";

const RANGE = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: "UTC" });

function formatDate(value: string): string {
  const date = parseDate(value);
  return date ? RANGE.format(date) : "Choose dates";
}

/** "Oct 5", or the "Choose dates" prompt for a blank or malformed date. */
export const formatShortDate = formatDate;

export function formatRange(trip: Pick<LifecycleTrip, "start" | "end">): string {
  return `${formatDate(trip.start)} – ${formatDate(trip.end)}`;
}

export function formatDays(days: number): string {
  // A non-breaking space keeps the number with its unit, so a narrow header never strands "days" alone.
  return days === 1 ? "1\u00a0day" : `${days}\u00a0days`;
}

export interface TripCardView {
  id: string;
  destination: string;
  /** "Region, Country", or null for a destination with no confirmed location. */
  place: string | null;
  /** City names of a multi-stop route, in order; empty for a single destination. */
  route: string[];
  /** The trip's title is the route itself, so the card must not print it twice. */
  routeIsTitle: boolean;
  /** "Past trip" / "Archived trip"; upcoming trips carry no eyebrow. */
  eyebrow: string | null;
  /** The end date is before today (by the existing date policy): the card uses historical wording. */
  past: boolean;
  ready: boolean;
  packed: number;
  total: number;
  remaining: number;
  percent: number;
  range: string;
  days: number;
  canArchive: boolean;
  canRestore: boolean;
}

export function tripCardView(trip: LifecycleTrip, today: string, view: TripListView): TripCardView {
  const totals = packedTotals(trip);
  const kind = classifyTrip(trip, today);
  const past = isPastTrip(trip, today);
  return {
    id: trip.id,
    destination: trip.destination,
    place: trip.location
      ? [trip.location.region, trip.location.country].filter(Boolean).join(", ") || null
      : null,
    route: routeCities(trip),
    routeIsTitle: routeIsTitle(trip),
    eyebrow: trip.archived ? "Archived trip" : past ? "Past trip" : null,
    past,
    ready: trip.ready,
    packed: totals.packed,
    total: totals.total,
    remaining: totals.total - totals.packed,
    percent: totals.total ? Math.round((totals.packed / totals.total) * 100) : 0,
    range: formatRange(trip),
    days: trip.days,
    canArchive: view === "upcoming",
    // Restoring only makes sense for a future trip; a past one returns to past by date.
    canRestore: view === "archive" && kind === "archived" && !past,
  };
}

export interface QuickRow {
  id: string;
  name: string;
  detail: string;
  packLast: boolean;
}

export interface QuickCategory {
  title: string;
  rows: QuickRow[];
}

export type BagStatus = "complete" | "pending" | "waiting";

export interface QuickViewModel {
  categories: QuickCategory[];
  bag: { status: BagStatus; label: string };
}

const notToiletry = (item: TripItem) => item.groupId !== TOILETRY_GROUP_ID;

function category(title: string, items: TripItem[], filter: QuickFilter): QuickCategory | null {
  const visible = filter === "still" ? items.filter((item) => item.packed < item.qty) : items;
  if (visible.length === 0) return null;
  return {
    title,
    rows: visible.map((item) => {
      const left = Math.max(0, item.qty - item.packed);
      return {
        id: item.id,
        name: item.name,
        detail: left ? `${left} left` : "Packed",
        packLast: item.section === "packlast",
      };
    }),
  };
}

const BAG_LABELS: Record<
  ReturnType<typeof toiletryBagState>,
  { status: BagStatus; label: string }
> = {
  BAG_IN_SUITCASE: { status: "complete", label: "In suitcase" },
  ALL_CHECKED_BAG_OUTSIDE: { status: "pending", label: "Still outside suitcase" },
  CONTENTS_INCOMPLETE: { status: "waiting", label: "Waiting on contents" },
};

// Read-only: derives everything from the trip, never touches progress.
export function quickViewModel(trip: LifecycleTrip, filter: QuickFilter): QuickViewModel {
  const { items } = trip;
  const categories = [
    category(
      "Clothing & essentials",
      items.filter((i) => i.section === "main" && notToiletry(i)),
      filter,
    ),
    category("Toiletries", toiletryItems(trip), filter),
    category(
      "Return outfit",
      items.filter((i) => i.section === "return"),
      filter,
    ),
    category(
      "Pack last",
      items.filter((i) => i.section === "packlast" && notToiletry(i)),
      filter,
    ),
  ].filter((entry): entry is QuickCategory => entry !== null);
  return { categories, bag: BAG_LABELS[toiletryBagState(trip)] };
}

// ---------------------------------------------------------------- route (epic #107, design #108 §2)

/** City names of a multi-stop trip, in order; empty for a single-destination trip (it shows its city as today). */
export function routeCities(trip: Pick<LifecycleTrip, "stops">): string[] {
  return trip.stops.length > 1 ? trip.stops.map((stop) => stop.location.city) : [];
}

/** True when a multi-stop trip's title is just its route (the default), so showing the route as well would repeat it. */
export function routeIsTitle(trip: Pick<LifecycleTrip, "stops" | "destination">): boolean {
  const cities = routeCities(trip);
  return cities.length > 0 && cities.join(" → ") === trip.destination;
}

export interface RouteDisplay {
  /** What shows: the whole route, or "First → … → Last" when it would not fit. */
  cities: string[];
  /** True when the middle was dropped (the "· N stops" badge shows). */
  shortened: boolean;
  count: number;
  /** "Route: Lisbon, then Porto, then Madrid." */
  spoken: string;
}

/** Characters before a route is shortened: about what a phone card line holds. Whole city names only. */
export const ROUTE_BUDGET = 28;

export function routeDisplay(
  cities: readonly string[],
  budget: number = ROUTE_BUDGET,
): RouteDisplay {
  const whole = cities.join(" → ");
  const shortened = cities.length > 2 && whole.length > budget;
  return {
    cities: shortened ? [cities[0], "…", cities[cities.length - 1]] : [...cities],
    shortened,
    count: cities.length,
    spoken: `Route: ${cities.join(", then ")}.`,
  };
}

// ---------------------------------------------------------------- Field Ledger dashboard (#143, spec §4)

export interface DepartureView {
  /** Whole days from today to the first day; 0 once the trip has started. */
  daysToGo: number;
  /** "days to go", "day to go", or "under way" once the trip has started. */
  daysLabel: string;
  /** "Oct 5" */
  startShort: string;
  /** "Oct 5 – Oct 9" */
  range: string;
  nights: number;
  /** "4 nights" */
  nightsLabel: string;
}

export function departureView(
  trip: Pick<LifecycleTrip, "start" | "end">,
  today: string,
): DepartureView {
  const ahead = daysBetween(today, trip.start);
  const daysToGo = Math.max(0, ahead);
  const nights = Math.max(0, daysBetween(trip.start, trip.end));
  return {
    daysToGo,
    daysLabel: ahead < 0 ? "under way" : daysToGo === 1 ? "day to go" : "days to go",
    startShort: formatDate(trip.start),
    range: formatRange(trip),
    nights,
    nightsLabel: nights === 1 ? "1 night" : `${nights} nights`,
  };
}

/** "N journeys ahead" for the page eyebrow; "No journeys ahead" when there are none. */
export function journeysAheadLabel(count: number): string {
  return count === 0
    ? "No journeys ahead"
    : count === 1
      ? "1 journey ahead"
      : `${count} journeys ahead`;
}

export interface WeatherCell {
  stopIndex: number;
  city: string;
  dates: string;
  glyph: WeatherRowView["glyph"];
  /** "18° / 11°" in the person's unit. */
  range: string;
  /** One line: "Rain on 2 of 5 days", "Snow likely", "Mostly dry". */
  note: string;
  /** "Forecast" or "Typical" so a normal-for-the-season figure is never read as a forecast. */
  source: string;
}

/** The day glyph for a set of days, by the same snow-then-rain rule as a stay. */
function glyphOf(days: readonly DayView[]): WeatherRowView["glyph"] {
  return days.some((day) => day.glyph === "snow")
    ? "snow"
    : days.some((day) => day.glyph === "rain")
      ? "rain"
      : "sun";
}

/**
 * One compact cell per stay that has weather; a stay without it is simply left out (never a daily forecast). A stay with
 * any forecast day is summed up over those days only, so the cell, the daily cards and the trip page's Forecast line
 * count the same days (#357); a stay with none shows its typical figures, tagged Typical.
 */
export function weatherCells(
  stops: readonly TripStop[],
  weather: readonly StopWeather[],
  unit: TemperatureUnit,
  today?: string,
): WeatherCell[] {
  const cells: WeatherCell[] = [];
  stops.forEach((stop, index) => {
    const found = weather.find((entry) => entry.stopIndex === index);
    const row = found ? weatherRowView(stop, found, unit, today) : null;
    if (!row) return;
    const part = row.forecast ?? {
      high: row.high,
      low: row.low,
      rainDays: row.rainDays,
      totalDays: row.totalDays,
    };
    const glyph = row.forecast ? glyphOf(row.forecastDays) : row.glyph;
    // "of 2 forecast days" only when the stay also has typical days; an all-forecast stay keeps "of 4 days"
    const days =
      row.forecast && row.typical
        ? `${part.totalDays} forecast ${part.totalDays === 1 ? "day" : "days"}`
        : dayCount(part.totalDays);
    cells.push({
      stopIndex: index,
      city: row.city,
      dates: row.dates,
      glyph,
      range: `${displayTemperature(part.high, unit)}° / ${displayTemperature(part.low, unit)}°`,
      note:
        glyph === "snow"
          ? "Snow likely"
          : part.rainDays > 0
            ? `Rain on ${part.rainDays} of ${days}`
            : "Mostly dry",
      source: row.forecast ? "Forecast" : "Typical",
    });
  });
  return cells;
}

/** The most forecast days the dashboard hero shows (#303); the rest are one "+N more days" link to the trip page. */
export const HERO_FORECAST_CAP = 7;

/** The hero's daily forecast block: the first stay that has any forecast day, its first 7 days, and how many more. */
export interface HeroForecast {
  city: string;
  days: DayView[];
  /** Forecast days past the cap. */
  more: number;
  /** All the stay's forecast days, before the cap: `days.length + more`. */
  forecastTotal: number;
  /** All the stay's days: `forecastTotal` plus the typical days. */
  totalDays: number;
  /** The stay's typical days, if it has any (#357): shown as one text row, never as cards. */
  typical: {
    line: string;
    range: string | null;
    days: number;
    /** Why these days are not a forecast. */
    note: string;
  } | null;
  /** Another stay on the trip also has forecast days: a link to the trip page covers them. */
  otherForecastStays: boolean;
}

const TYPICAL_NOTE = {
  after: "Beyond the 16-day forecast, so these days use the average of the last 5 years.",
  before: "Before today, so these days use the average of the last 5 years.",
  split: "These days use the average of the last 5 years, not a forecast.",
} as const;

/** The first stay (trip order) with at least one forecast day, or null: typical-only trips get no block. */
export function heroForecast(
  stops: readonly TripStop[],
  weather: readonly StopWeather[],
  unit: TemperatureUnit,
  today?: string,
): HeroForecast | null {
  const rows = stops.map((stop, index) => {
    const found = weather.find((entry) => entry.stopIndex === index);
    return found ? weatherRowView(stop, found, unit, today) : null;
  });
  const at = rows.findIndex((row) => row !== null && row.forecastDays.length > 0);
  const row = at === -1 ? null : rows[at];
  if (!row) return null;
  const forecastTotal = row.forecastDays.length;
  const typical = row.typical;
  return {
    city: row.city,
    days: row.forecastDays.slice(0, HERO_FORECAST_CAP),
    more: forecastTotal - Math.min(forecastTotal, HERO_FORECAST_CAP),
    forecastTotal,
    totalDays: row.totalDays,
    typical:
      typical && row.typicalPlacement
        ? {
            line: typicalLine(typical, unit, row.typicalRange),
            range: row.typicalRange,
            days: typical.totalDays,
            note: TYPICAL_NOTE[row.typicalPlacement],
          }
        : null,
    otherForecastStays: rows.some(
      (other, index) => index !== at && other !== null && other.forecastDays.length > 0,
    ),
  };
}
