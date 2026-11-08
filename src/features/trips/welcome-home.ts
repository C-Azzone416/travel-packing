// The Welcome home card (#410, spec #393 part 1 section 2.3): once, after a trip, with its first sticker inking in. Pure
// view-model and the device-local "seen" list; no React, no clock (`today` is passed in, device-local per #26).

import { packedTotals } from "@/domain/readiness";
import { isPastTrip, type LifecycleTrip } from "@/domain/trip-lifecycle";
import { tripDisplayName } from "@/domain/trip-route";
import { daysBetween } from "@/domain/trip-stops";
import { stampsView, type StickerView } from "@/features/stamps/stamps-view";

/** The card shows for this many days after the trip's end date, or until it is dismissed. */
export const WELCOME_HOME_DAYS = 14;

export interface WelcomeHomeModel {
  tripId: string;
  /** "Lisbon & Porto is inked." */
  title: string;
  /** The trip's first-stop sticker, exactly as Stamps draws it (repeat count included). */
  sticker: StickerView;
  /** "LIS and OPO are in your Stamps. 10 nights, 41 of 41 packed." */
  line: string;
  /** Read once, after the sticker has inked. */
  announcement: string;
}

const ORDINAL: Record<number, string> = { 2: "second", 3: "third" };

function ordinal(count: number): string {
  if (ORDINAL[count]) return ORDINAL[count];
  const last = count % 10;
  const teen = count % 100 >= 11 && count % 100 <= 13;
  return `${count}${teen ? "th" : last === 1 ? "st" : last === 2 ? "nd" : last === 3 ? "rd" : "th"}`;
}

/** "LIS", "LIS and OPO", "LIS, OPO and FAO". */
function joinList(values: readonly string[]): string {
  return values.length <= 1
    ? (values[0] ?? "")
    : `${values.slice(0, -1).join(", ")} and ${values[values.length - 1]}`;
}

const placeKey = (countryCode: string, city: string) => `${countryCode}|${city}`.toLowerCase();

/**
 * The card for the most recent trip that ended within the last 14 days (the day after its end date is the first day), or
 * null. Archived trips are left out. Several trips completing at once show only the most recent one.
 */
export function welcomeHomeCandidate(
  trips: readonly LifecycleTrip[],
  today: string,
): LifecycleTrip | null {
  const recent = trips
    .filter((trip) => !trip.archived && isPastTrip(trip, today))
    .filter((trip) => daysBetween(trip.end, today) <= WELCOME_HOME_DAYS)
    .sort((a, b) => b.end.localeCompare(a.end) || b.start.localeCompare(a.start));
  return recent[0] ?? null;
}

export function welcomeHomeModel(
  trips: readonly LifecycleTrip[],
  today: string,
): WelcomeHomeModel | null {
  const trip = welcomeHomeCandidate(trips, today);
  if (!trip || trip.stops.length === 0) return null;
  const stickers = stampsView(trips, today, "all").stickers;
  // One sticker per distinct place of this trip, in route order.
  const seen = new Set<string>();
  const mine: StickerView[] = [];
  for (const stop of trip.stops) {
    const key = placeKey(stop.location.countryCode, stop.location.city);
    if (seen.has(key)) continue;
    seen.add(key);
    const sticker = stickers.find((entry) => entry.key === key);
    if (sticker) mine.push(sticker);
  }
  if (mine.length === 0) return null;

  const fresh = mine.filter((sticker) => sticker.completedCount <= 1);
  const repeats = mine.filter((sticker) => sticker.completedCount > 1);
  const codes = fresh.map((sticker) => sticker.code).filter((code) => code !== "");
  const sentences: string[] = [];
  if (codes.length > 0)
    sentences.push(`${joinList(codes)} ${codes.length === 1 ? "is" : "are"} in your Stamps.`);
  for (const sticker of repeats)
    sentences.push(
      `Your ${ordinal(sticker.completedCount)} ${sticker.place}: ${sticker.code} now has ×${sticker.completedCount}.`,
    );
  const nights = Math.max(0, daysBetween(trip.start, trip.end));
  const totals = packedTotals(trip);
  const facts = [
    nights === 0 ? "Day trip" : `${nights} ${nights === 1 ? "night" : "nights"}`,
    ...(totals.total > 0 ? [`${totals.packed} of ${totals.total} packed`] : []),
  ].join(", ");

  const places = fresh.map((sticker) => sticker.place);
  return {
    tripId: trip.id,
    title: `${tripDisplayName(trip)} is inked.`,
    sticker: mine[0],
    line: [...sentences, `${facts}.`].join(" "),
    announcement:
      places.length > 0
        ? `${joinList(places)} ${places.length === 1 ? "sticker" : "stickers"} added to Stamps.`
        : "Stamps updated.",
  };
}

// ---------------------------------------------------------------- seen on this device

/** Trip ids are unique across accounts, so one list per device is also one list per account. */
export const WELCOME_SEEN_KEY = "welcomeHomeSeen";

export function readWelcomeSeen(
  storage: Pick<Storage, "getItem"> | null = safeStorage(),
): string[] {
  try {
    const parsed: unknown = JSON.parse(storage?.getItem(WELCOME_SEEN_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

/** Remembers a dismissed card. Storage that is blocked or full is ignored: the card then shows until it ages out. */
export function markWelcomeSeen(
  tripId: string,
  storage: Pick<Storage, "getItem" | "setItem"> | null = safeStorage(),
): void {
  try {
    const now = readWelcomeSeen(storage);
    if (!now.includes(tripId)) storage?.setItem(WELCOME_SEEN_KEY, JSON.stringify([...now, tripId]));
  } catch {
    /* storage unavailable */
  }
}

function safeStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}
