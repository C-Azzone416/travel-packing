import type { ReactNode } from "react";
import type { TripOrigin } from "@/domain/trip-route";

/** A route map drawn on the server, with the route it was drawn for (the browser compares it with the trip it shows). */
export interface HomeMap {
  signature: string;
  node: ReactNode;
  /**
   * The account's Home, when the trip has no origin of its own and the map starts from Home instead (#497). Display only:
   * the trip is never rewritten. The browser applies the same fallback so both sides draw (and compare) the same route.
   */
  home?: TripOrigin;
}

/** By trip id. */
export type HomeMaps = Readonly<Record<string, HomeMap>>;
