// Adapts stored trips (what the data layer returns) to the lifecycle shape the dashboard renders.
// Storage keeps a place as destination + location id + label ("City, Region, Country"); the dashboard wants a
// location with region and country, so they are read back out of the label.

import type { LifecycleState, LifecycleTrip, SampleLocation } from "../../domain/trip-lifecycle";
import type { StoredTrip } from "../data/trip-store";

/** "San Diego, California, United States" with city "San Diego" -> region "California", country "United States". */
export function locationFromStored(
  trip: Pick<StoredTrip, "destination" | "locationId" | "locationLabel">,
): SampleLocation | null {
  if (!trip.locationId) return null;
  const label = trip.locationLabel?.trim() || trip.destination;
  const prefix = `${trip.destination}, `;
  const tail = label.startsWith(prefix) ? label.slice(prefix.length) : "";
  const parts = tail.split(", ").filter(Boolean);
  const country = parts.length > 1 ? parts[parts.length - 1] : "";
  const region = parts.length > 1 ? parts.slice(0, -1).join(", ") : (parts[0] ?? "");
  return {
    id: trip.locationId,
    city: trip.destination,
    region,
    country,
    countryCode: "",
    label,
  };
}

export function toLifecycleTrip(stored: StoredTrip): LifecycleTrip {
  const { locationId: _id, locationLabel: _label, deletedAt: _deleted, ...rest } = stored;
  void [_id, _label, _deleted];
  return { ...rest, location: locationFromStored(stored) };
}

/** Live trips (newest first, as stored) and the recently-deleted list, as the dashboard's state. */
export function toLifecycleState(live: StoredTrip[], deleted: StoredTrip[]): LifecycleState {
  return {
    trips: live.map(toLifecycleTrip),
    deletedTrips: deleted.map((trip) => ({
      trip: toLifecycleTrip(trip),
      deletedAt: trip.deletedAt?.getTime() ?? 0,
    })),
    draft: null,
  };
}
