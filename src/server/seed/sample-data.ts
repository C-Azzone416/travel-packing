// The prototype's synthetic sample set (plan §6): two sample trips and the default staples. Everything here is
// invented: places are from the prototype's local sample list, nothing is real trip data.
// Fixed ids keep the seed idempotent (re-running replaces these exact trips).

import { createHash } from "node:crypto";
import { buildTripItems, DEFAULT_STAPLES, forecastLabel } from "../../domain/calc";
import type { TripConfig, TripItem } from "../../domain/trip";
import type { StoredTrip } from "../data/trip-store";

/** The prototype's fixed "today" for deterministic history and forecast labels (plan §6). */
export const SAMPLE_TODAY = "2026-10-16";

export type SampleTripSlug = "san-diego" | "lisbon";
export const SAMPLE_TRIP_SLUGS: readonly SampleTripSlug[] = ["san-diego", "lisbon"];

/**
 * A stable uuid (v5-style, from a SHA-1 of the owner and slug), so re-seeding replaces exactly the same rows and two
 * different owners never collide on a primary key.
 */
export function sampleTripId(ownerId: string, slug: SampleTripSlug): string {
  const hex = createHash("sha1").update(`travel-packing-sample:${ownerId}:${slug}`).digest("hex");
  const variant = ((parseInt(hex.slice(16, 18), 16) & 0x3f) | 0x80).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(18, 20)}-${hex.slice(20, 32)}`;
}

/** Only the two places the sample trips use; the full curated picker list belongs to the location provider (#15). */
const SAN_DIEGO = {
  id: "us-ca-san-diego",
  city: "San Diego",
  label: "San Diego, California, United States",
};
const LISBON = { id: "pt-lisbon", city: "Lisbon", label: "Lisbon, Lisbon District, Portugal" };

const SAMPLE_CONFIG: TripConfig = {
  laundry: false,
  spare: true,
  niceAttire: true,
  occasionCount: 1,
  reuseNice: true,
  returnOutfit: true,
};

function sampleTrip(
  id: string,
  place: { id: string; city: string; label: string },
  start: string,
  end: string,
  config: TripConfig,
): StoredTrip {
  const built = buildTripItems({ ...config, start, end }, DEFAULT_STAPLES);
  return {
    id,
    destination: place.city,
    locationId: place.id,
    locationLabel: place.label,
    start,
    end,
    config,
    days: built.days,
    dailyDays: built.dailyDays,
    items: built.items.filter((item) => item.qty > 0),
    suggestionMemory: {},
    suppressedSuggestions: {},
    toiletryBagPacked: false,
    ready: false,
    weather: {
      status: "pending",
      label: forecastLabel(start, SAMPLE_TODAY),
      suggestion: "Compact umbrella",
    },
    copiedFrom: null,
    archived: false,
    deletedAt: null,
  };
}

/** San Diego: upcoming, partially packed, Nice outfits on. */
export function sanDiegoTrip(ownerId: string): StoredTrip {
  const trip = sampleTrip(
    sampleTripId(ownerId, "san-diego"),
    SAN_DIEGO,
    "2026-10-23",
    "2026-10-27",
    SAMPLE_CONFIG,
  );
  const partial: Record<string, number> = {
    tops: 1,
    underwear: 2,
    socks: 1,
    sleepwear: 1,
    sunglasses: 1,
  };
  return {
    ...trip,
    items: trip.items.map((item) =>
      item.id in partial ? { ...item, packed: Math.min(item.qty, partial[item.id]) } : item,
    ),
  };
}

/** Lisbon: past, fully packed, bag confirmed, Ready, simulated umbrella accepted. */
export function lisbonTrip(ownerId: string): StoredTrip {
  const trip = sampleTrip(sampleTripId(ownerId, "lisbon"), LISBON, "2026-09-03", "2026-09-07", {
    ...SAMPLE_CONFIG,
    laundry: true,
    spare: false,
  });
  const umbrella: TripItem = {
    id: "weather-umbrella",
    name: "Compact umbrella",
    category: "Weather suggestion",
    qty: 1,
    packed: 1,
    section: "main",
  };
  return {
    ...trip,
    items: [...trip.items.map((item) => ({ ...item, packed: item.qty })), umbrella],
    toiletryBagPacked: true,
    ready: true,
    weather: { ...trip.weather, status: "accepted" },
  };
}

export function sampleTrips(ownerId: string): StoredTrip[] {
  return [sanDiegoTrip(ownerId), lisbonTrip(ownerId)];
}
