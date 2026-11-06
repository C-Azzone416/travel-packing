import type { ReactNode } from "react";

/** A route map drawn on the server, with the route it was drawn for (the browser compares it with the trip it shows). */
export interface HomeMap {
  signature: string;
  node: ReactNode;
}

/** By trip id. */
export type HomeMaps = Readonly<Record<string, HomeMap>>;
