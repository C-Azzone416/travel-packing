import { parseDate } from "@/domain/calc";
import { packedTotals } from "@/domain/readiness";
import { selectStamps } from "@/domain/stamps";
import { isPastTrip, type LifecycleTrip } from "@/domain/trip-lifecycle";
import { tripDisplayName } from "@/domain/trip-route";
import { daysBetween, type TripStop } from "@/domain/trip-stops";

export type HomeTab = "pack" | "weather" | "future" | "stamps";
export type HomeStampFilter = "rolling" | "year" | "all";
export type StickerShape = "circle" | "rounded" | "squared";
export type StickerColour = "accent" | "dark2" | "good" | "info" | "goldDeep";

const HOME_TABS: readonly HomeTab[] = ["pack", "weather", "future", "stamps"];
const MONTH = new Intl.DateTimeFormat("en", { month: "short", timeZone: "UTC" });
const MONTH_YEAR = new Intl.DateTimeFormat("en", {
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});
const SHAPES: readonly StickerShape[] = ["circle", "rounded", "squared"];
const COLOURS: readonly StickerColour[] = ["accent", "dark2", "good", "info", "goldDeep"];

export function homeTab(value: string | null | undefined): HomeTab {
  return HOME_TABS.includes(value as HomeTab) ? (value as HomeTab) : "pack";
}

function date(value: string): Date | null {
  return parseDate(value);
}

export function phoneTagDates(trip: Pick<LifecycleTrip, "start" | "end">): string {
  const from = date(trip.start);
  const to = date(trip.end);
  if (!from || !to) return "CHOOSE DATES";
  const left = String(from.getUTCDate()).padStart(2, "0");
  const right = String(to.getUTCDate()).padStart(2, "0");
  const fromMonth = MONTH.format(from).toUpperCase();
  const toMonth = MONTH.format(to).toUpperCase();
  if (trip.start === trip.end) return `${left} ${fromMonth}`;
  return fromMonth === toMonth
    ? `${left}–${right} ${toMonth}`
    : `${left} ${fromMonth}–${right} ${toMonth}`;
}

export function homeStampFilterLabel(filter: HomeStampFilter, today: string): string {
  if (filter === "rolling") return "Last 12 months";
  if (filter === "all") return "All time";
  return String(date(today)?.getUTCFullYear() ?? "Year");
}

/** FNV-1a over UTF-8, fixed by #376 so a place keeps the same sticker everywhere. */
export function homePlaceHash(key: string): number {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(key)) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

export function homeStickerLook(countryCode: string, city: string) {
  const key = `${countryCode}|${city}`.toLowerCase();
  const hash = homePlaceHash(key);
  return {
    key,
    shape: SHAPES[hash % SHAPES.length],
    colour: COLOURS[Math.floor(hash / SHAPES.length) % COLOURS.length],
    tilt: ((hash >>> 8) % 9) - 4,
  } as const;
}

function rollingStart(today: string): string | null {
  const current = date(today);
  if (!current) return null;
  current.setUTCFullYear(current.getUTCFullYear() - 1);
  return current.toISOString().slice(0, 10);
}

function inFilter(trip: LifecycleTrip, today: string, filter: HomeStampFilter): boolean {
  if (filter === "all") return true;
  if (!isPastTrip(trip, today) && trip.start >= today) return true;
  if (filter === "year") {
    return date(trip.start)?.getUTCFullYear() === date(today)?.getUTCFullYear();
  }
  const start = rollingStart(today);
  return start !== null && trip.start >= start && trip.start <= today;
}

function placeKey(stop: TripStop): string {
  return `${stop.location.countryCode}|${stop.location.city}`.toLowerCase();
}

function stampCode(trip: LifecycleTrip, stop: TripStop, stopIndex: number): string {
  const override = trip.stampLabels?.[stopIndex] ?? null;
  return selectStamps([stop], [override, null])[0]?.label ?? "";
}

export interface HomeStickerView {
  key: string;
  tripId: string;
  place: string;
  region: string;
  code: string;
  month: string;
  monthYear: string;
  completedCount: number;
  upcoming: boolean;
  shape: StickerShape;
  colour: StickerColour;
  tilt: number;
  accessibleName: string;
}

export interface HomePastTripView {
  id: string;
  name: string;
  facts: string;
  packed: number;
  total: number;
}

export interface HomeStampsView {
  stickers: HomeStickerView[];
  past: HomePastTripView[];
  totals: { trips: number; places: number; countries: number; nights: number };
  inked: number;
}

interface PlaceGroup {
  stop: TripStop;
  completed: Array<{ trip: LifecycleTrip; stopIndex: number }>;
  upcoming: Array<{ trip: LifecycleTrip; stopIndex: number }>;
}

export function homeStampsView(
  trips: readonly LifecycleTrip[],
  today: string,
  filter: HomeStampFilter,
): HomeStampsView {
  const matching = trips.filter((trip) => inFilter(trip, today, filter));
  const past = matching
    .filter((trip) => isPastTrip(trip, today))
    .sort((a, b) => b.end.localeCompare(a.end));
  const groups = new Map<string, PlaceGroup>();
  for (const trip of matching) {
    const completed = isPastTrip(trip, today);
    const seen = new Set<string>();
    trip.stops.forEach((stop, stopIndex) => {
      const key = placeKey(stop);
      if (seen.has(key)) return;
      seen.add(key);
      const group = groups.get(key) ?? { stop, completed: [], upcoming: [] };
      (completed ? group.completed : group.upcoming).push({ trip, stopIndex });
      groups.set(key, group);
    });
  }
  const stickers = [...groups.entries()]
    .map(([key, group]) => {
      const completed = [...group.completed].sort((a, b) => b.trip.end.localeCompare(a.trip.end));
      const upcoming = [...group.upcoming].sort((a, b) => a.trip.start.localeCompare(b.trip.start));
      const chosen = completed[0] ?? upcoming[0];
      const when = date(chosen.trip.start);
      const count = completed.length;
      const look = homeStickerLook(group.stop.location.countryCode, group.stop.location.city);
      return {
        order: chosen.trip.start,
        sticker: {
          key,
          tripId: chosen.trip.id,
          place: group.stop.location.city,
          region: (group.stop.location.region || group.stop.location.country).trim().toUpperCase(),
          code: stampCode(chosen.trip, group.stop, chosen.stopIndex),
          month: when ? MONTH.format(when).toUpperCase() : "",
          monthYear: when ? MONTH_YEAR.format(when) : "Date not set",
          completedCount: count,
          upcoming: count === 0,
          shape: look.shape,
          colour: look.colour,
          tilt: look.tilt,
          accessibleName: `${group.stop.location.city}, ${when ? MONTH_YEAR.format(when) : "date not set"}, ${Math.max(1, count)} ${Math.max(1, count) === 1 ? "trip" : "trips"}`,
        } satisfies HomeStickerView,
      };
    })
    .sort((a, b) => {
      if (a.sticker.upcoming !== b.sticker.upcoming) return a.sticker.upcoming ? 1 : -1;
      return b.order.localeCompare(a.order);
    })
    .map(({ sticker }) => sticker);

  const places = new Set<string>();
  const countries = new Set<string>();
  const pastViews = past.map((trip) => {
    const totals = packedTotals(trip);
    trip.stops.forEach((stop) => {
      places.add(placeKey(stop));
      if (stop.location.countryCode.trim()) countries.add(stop.location.countryCode.toUpperCase());
    });
    const nights = Math.max(0, daysBetween(trip.start, trip.end));
    const when = date(trip.start);
    return {
      id: trip.id,
      name: tripDisplayName(trip),
      facts: [
        when ? MONTH_YEAR.format(when) : "Date not set",
        trip.travelMode,
        nights === 0 ? "day trip" : nights === 1 ? "1 night" : `${nights} nights`,
      ]
        .filter(Boolean)
        .join(" · "),
      packed: totals.packed,
      total: totals.total,
    };
  });
  return {
    stickers,
    past: pastViews,
    totals: {
      trips: past.length,
      places: places.size,
      countries: countries.size,
      nights: past.reduce((sum, trip) => sum + Math.max(0, daysBetween(trip.start, trip.end)), 0),
    },
    inked: stickers.filter((sticker) => !sticker.upcoming).length,
  };
}
