// Pure view-models for the trips dashboard. No React, no clock: `today` is passed in.

import { parseDate } from "@/domain/calc";
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
  ready: boolean;
  packed: number;
  total: number;
  remaining: number;
  percent: number;
  range: string;
  days: number;
  /** Simulated forecast label; null without a confirmed location (e.g. custom) and for trips already past. */
  forecast: string | null;
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
    ready: trip.ready,
    packed: totals.packed,
    total: totals.total,
    remaining: totals.total - totals.packed,
    percent: totals.total ? Math.round((totals.packed / totals.total) * 100) : 0,
    range: formatRange(trip),
    days: trip.days,
    // A forecast for a trip that has already happened says nothing, so it is hidden once the trip is past.
    forecast: trip.location && !past ? trip.weather.label : null,
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
