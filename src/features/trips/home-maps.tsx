import "server-only";
import { RouteMap } from "@/components/route-map/RouteMap";
import { routeSignature, tripRoutePoints, withHomeOrigin } from "@/domain/trip-route";
import { addDays } from "@/domain/trip-stops";
import { getDataContext } from "@/server/data/runtime";
import * as service from "@/server/data/service";
import { toLifecycleTrip } from "@/server/trips/to-lifecycle";
import type { HomeMap, HomeMaps } from "./home-map-types";

/** The maps the laptop Home may need: the earliest two trips not yet over, by the server's clock. */
const CANDIDATES = 2;

/**
 * Draws the route map of the next trips on the server (RouteMap is server-only: the atlas data never reaches the
 * browser). Same owner-scoped read as the dashboard's own load. Anything that goes wrong means no maps, never an error:
 * the Home shows its plain placeholder instead.
 */
export async function homeMaps(now: Date = new Date()): Promise<HomeMaps> {
  try {
    const context = await getDataContext();
    if (!context) return {};
    const live = await service.listTrips(context);
    if (!live.ok) return {};
    // The browser's own date decides which trip is next (device-local, #26): keep two days of slack.
    const floor = addDays(now.toISOString().slice(0, 10), -2);
    // A trip that never had an origin starts from the account's Home as it is now (#497; display only, nothing is written).
    // A failed read is no Home: the destination-only map still draws.
    const homeRead = await service.getHomeCity(context).catch(() => null);
    const home = homeRead?.ok ? homeRead.data : null;
    const maps: Record<string, HomeMap> = {};
    live.data
      .filter((trip) => !trip.archived && trip.end >= floor)
      .sort((a, b) => a.start.localeCompare(b.start))
      .slice(0, CANDIDATES)
      .forEach((stored) => {
        const own = toLifecycleTrip(stored);
        const trip = withHomeOrigin(own, home);
        const points = tripRoutePoints(trip);
        if (points.length === 0) return;
        maps[trip.id] = {
          signature: routeSignature(points, trip.travelMode),
          node: <RouteMap points={points} mode={trip.travelMode ?? "other"} />,
          ...(trip.origin !== own.origin && home ? { home } : {}),
        };
      });
    return maps;
  } catch {
    return {};
  }
}
