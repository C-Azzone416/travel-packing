import { parseDate } from "@/domain/calc";
import { packedTotals } from "@/domain/readiness";
import { automaticStamps, selectStamps } from "@/domain/stamps";
import { isPastTrip, type LifecycleTrip } from "@/domain/trip-lifecycle";
import { TRAVEL_MODE_CAPTION, routeTextShort, tripDisplayName } from "@/domain/trip-route";
import { daysBetween, type TripStop } from "@/domain/trip-stops";

export type StampFilter = "rolling" | "year" | "all";
export type StickerShape = "circle" | "rounded" | "squared";
export type StickerColour = "accent" | "dark2" | "good" | "info" | "goldDeep";

export interface StickerView {
  key: string;
  code: string;
  place: string;
  region: string;
  month: string;
  monthYear: string;
  completedCount: number;
  upcoming: boolean;
  shape: StickerShape;
  colour: StickerColour;
  tilt: number;
  tripId: string;
  /** Which stop of `tripId` the sticker draws; its code follows the trip's stamp label for that slot. */
  stopIndex: number;
  accessibleName: string;
}

export interface PastTripView {
  id: string;
  code: string;
  stickerColour: StickerColour | null;
  name: string;
  monthYear: string;
  /** Not home yet: the trip has not ended, so it inks when you get home. */
  upcoming: boolean;
  eyebrow: string;
  facts: string;
  packed: number;
  total: number;
}

export interface StampsTotals {
  trips: number;
  places: number;
  countries: number;
  nights: number;
}

export interface StampsView {
  filterLabel: string;
  stickers: StickerView[];
  pastTrips: PastTripView[];
  totals: StampsTotals;
  inked: number;
}

const SHAPES: readonly StickerShape[] = ["circle", "rounded", "squared"];
const COLOURS: readonly StickerColour[] = ["accent", "dark2", "good", "info", "goldDeep"];
const MONTH = new Intl.DateTimeFormat("en", { month: "short", timeZone: "UTC" });
const MONTH_YEAR = new Intl.DateTimeFormat("en", {
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

/** FNV-1a over UTF-8, as fixed by the design build spec (#376 section 7). */
export function placeHash(key: string): number {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(key)) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

export function stickerLook(countryCode: string, city: string) {
  const key = `${countryCode}|${city}`.toLowerCase();
  const hash = placeHash(key);
  return {
    key,
    hash,
    shape: SHAPES[hash % SHAPES.length],
    colour: COLOURS[Math.floor(hash / SHAPES.length) % COLOURS.length],
    tilt: ((hash >>> 8) % 9) - 4,
  } as const;
}

function dateOf(value: string): Date | null {
  return parseDate(value);
}

function month(value: string): string {
  const date = dateOf(value);
  return date ? MONTH.format(date).toUpperCase() : "";
}

function monthYear(value: string): string {
  const date = dateOf(value);
  return date ? MONTH_YEAR.format(date) : "Date not set";
}

function compactMonthYear(value: string): string {
  const date = dateOf(value);
  if (!date) return "DATE NOT SET";
  return `${MONTH.format(date).toUpperCase()} ${String(date.getUTCFullYear()).slice(-2)}`;
}

function rollingStart(today: string): string | null {
  const date = dateOf(today);
  if (!date) return null;
  date.setUTCFullYear(date.getUTCFullYear() - 1);
  return date.toISOString().slice(0, 10);
}

export function filterLabel(filter: StampFilter, today: string): string {
  if (filter === "rolling") return "Last 12 months";
  if (filter === "all") return "All time";
  return String(dateOf(today)?.getUTCFullYear() ?? new Date().getUTCFullYear());
}

/** Completed trips obey the filter. Upcoming trips remain visible when they are in range or later than today. */
export function tripMatchesFilter(
  trip: Pick<LifecycleTrip, "start" | "end">,
  filter: StampFilter,
  today: string,
): boolean {
  if (filter === "all") return true;
  const upcoming = !isPastTrip(trip, today);
  if (upcoming && trip.start >= today) return true;
  if (filter === "year") {
    const year = dateOf(today)?.getUTCFullYear();
    return year !== undefined && dateOf(trip.start)?.getUTCFullYear() === year;
  }
  const start = rollingStart(today);
  return start !== null && trip.start >= start && trip.start <= today;
}

function stickerCode(trip: LifecycleTrip, stop: TripStop, index: number): string {
  const override = trip.stampLabels?.[index] ?? null;
  return selectStamps([stop], [override, null])[0]?.label ?? "";
}

function placeKey(stop: TripStop): string {
  return `${stop.location.countryCode}|${stop.location.city}`.toLowerCase();
}

function regionLabel(stop: TripStop): string {
  return (stop.location.region || stop.location.country).trim().toUpperCase();
}

export const UPCOMING_EYEBROW = "Upcoming · inks when you get home";

/**
 * Whether the stamp editor changes what this sticker says. The sticker draws one stop and takes its code from the trip's
 * label for that slot, and the editor only has slots for the first two route stamps (the second only when the route has a
 * second country). A sticker for a later stop shows an automatic code the editor cannot change.
 */
export function stickerEditable(trip: LifecycleTrip, stopIndex: number): boolean {
  const slots = automaticStamps(trip.stops).length;
  return stopIndex < slots && stopIndex < 2;
}

export function stampTripView(trip: LifecycleTrip, today?: string): PastTripView {
  const first = trip.stops[0];
  const code = first ? stickerCode(trip, first, 0) : "";
  const stickerColour = first
    ? stickerLook(first.location.countryCode, first.location.city).colour
    : null;
  const totals = packedTotals(trip);
  const nights = Math.max(0, daysBetween(trip.start, trip.end));
  const facts = [
    monthYear(trip.start),
    trip.travelMode ? TRAVEL_MODE_CAPTION[trip.travelMode] : "",
    routeTextShort(trip.origin, trip.stops),
    nights === 0 ? "day trip" : nights === 1 ? "1 night" : `${nights} nights`,
  ]
    .filter(Boolean)
    .join(" · ");
  return {
    id: trip.id,
    code,
    stickerColour,
    name: tripDisplayName(trip),
    monthYear: monthYear(trip.start),
    upcoming: today !== undefined && !isPastTrip(trip, today),
    eyebrow:
      today !== undefined && !isPastTrip(trip, today)
        ? UPCOMING_EYEBROW
        : [code, compactMonthYear(trip.start)].filter(Boolean).join(" · "),
    facts,
    packed: totals.packed,
    total: totals.total,
  };
}

interface PlaceGroup {
  key: string;
  stop: TripStop;
  completed: Array<{ trip: LifecycleTrip; stopIndex: number }>;
  upcoming: Array<{ trip: LifecycleTrip; stopIndex: number }>;
}

/** One sticker per distinct place, plus xN for completed repeat visits. */
export function stampsView(
  trips: readonly LifecycleTrip[],
  today: string,
  filter: StampFilter,
): StampsView {
  const matching = trips.filter((trip) => tripMatchesFilter(trip, filter, today));
  const past = matching
    .filter((trip) => isPastTrip(trip, today))
    .sort((a, b) => b.end.localeCompare(a.end));
  const groups = new Map<string, PlaceGroup>();

  for (const trip of matching) {
    const complete = isPastTrip(trip, today);
    const seen = new Set<string>();
    trip.stops.forEach((stop, stopIndex) => {
      const key = placeKey(stop);
      if (seen.has(key)) return;
      seen.add(key);
      const group = groups.get(key) ?? { key, stop, completed: [], upcoming: [] };
      (complete ? group.completed : group.upcoming).push({ trip, stopIndex });
      groups.set(key, group);
    });
  }

  const stickers = [...groups.values()]
    .map((group): { sticker: StickerView; order: string } => {
      const complete = [...group.completed].sort((a, b) => b.trip.end.localeCompare(a.trip.end));
      const upcoming = [...group.upcoming].sort((a, b) => a.trip.start.localeCompare(b.trip.start));
      const chosen = complete[0] ?? upcoming[0];
      const chosenStop = chosen.trip.stops[chosen.stopIndex] ?? group.stop;
      const date = chosen.trip.start;
      const look = stickerLook(chosenStop.location.countryCode, chosenStop.location.city);
      const count = complete.length;
      return {
        order: date,
        sticker: {
          key: group.key,
          code: stickerCode(chosen.trip, chosenStop, chosen.stopIndex),
          place: chosenStop.location.city,
          region: regionLabel(chosenStop),
          month: month(date),
          monthYear: monthYear(date),
          completedCount: count,
          upcoming: count === 0,
          shape: look.shape,
          colour: look.colour,
          tilt: look.tilt,
          tripId: chosen.trip.id,
          stopIndex: chosen.stopIndex,
          accessibleName:
            count === 0
              ? `${chosenStop.location.city}, ${monthYear(date)}, upcoming, not inked yet`
              : `${chosenStop.location.city}, ${monthYear(date)}, inked, ${count} ${count === 1 ? "trip" : "trips"}`,
        },
      };
    })
    .sort((a, b) => {
      if (a.sticker.upcoming !== b.sticker.upcoming) return a.sticker.upcoming ? 1 : -1;
      return b.order.localeCompare(a.order);
    })
    .map(({ sticker }) => sticker);

  const completedPlaces = new Set<string>();
  const countries = new Set<string>();
  for (const trip of past) {
    for (const stop of trip.stops) {
      completedPlaces.add(placeKey(stop));
      if (stop.location.countryCode.trim()) countries.add(stop.location.countryCode.toUpperCase());
    }
  }

  return {
    filterLabel: filterLabel(filter, today),
    stickers,
    pastTrips: past.map((trip) => stampTripView(trip)),
    totals: {
      trips: past.length,
      places: completedPlaces.size,
      countries: countries.size,
      nights: past.reduce((sum, trip) => sum + Math.max(0, daysBetween(trip.start, trip.end)), 0),
    },
    inked: stickers.filter((sticker) => !sticker.upcoming).length,
  };
}
