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

export function formatRange(trip: Pick<LifecycleTrip, "start" | "end">): string {
  return `${formatDate(trip.start)} – ${formatDate(trip.end)}`;
}

export function formatDays(days: number): string {
  return days === 1 ? "1 day" : `${days} days`;
}

export interface TripCardView {
  id: string;
  destination: string;
  /** "Region, Country", or null for a destination with no confirmed location. */
  place: string | null;
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
    place: trip.location ? `${trip.location.region}, ${trip.location.country}` : null,
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
