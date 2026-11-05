import "server-only";

// The map's geography, decoded once per server process. Server-only on purpose: this module pulls in about 0.85 MB of
// TopoJSON, and `server-only` makes the build fail if a client component ever imports it (#382).
//
// Data: Natural Earth (public domain) via the `world-atlas` package, and US states via `us-atlas` (US Census
// cartographic boundaries, public domain). Countries use the 1:50m file: the 1:110m file (108 KB) turns Portugal,
// Denmark or a Caribbean hop into a blob when the route is short, and a 740 KB file that only the server ever reads
// costs the browser nothing.
import { feature, mesh } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import type { Feature, FeatureCollection, MultiLineString, MultiPolygon, Polygon } from "geojson";
import worldTopology from "world-atlas/countries-50m.json";
import usTopology from "us-atlas/states-10m.json";

export type Area = Feature<Polygon | MultiPolygon, { name?: string }>;

export interface Geography {
  /** All land as one shape (the coast outline). */
  land: FeatureCollection<MultiPolygon | Polygon>;
  countries: Area[];
  /** Borders shared by two countries (no coastline). */
  countryBorders: MultiLineString;
  states: Area[];
  /** Borders shared by two US states (no coastline, no national border). */
  stateBorders: MultiLineString;
}

type World = Topology<{
  countries: GeometryCollection<{ name?: string }>;
  land: GeometryCollection;
}>;
type Us = Topology<{ states: GeometryCollection<{ name?: string }> }>;

let cached: Geography | null = null;

export function geography(): Geography {
  if (cached) return cached;
  const world = worldTopology as unknown as World;
  const us = usTopology as unknown as Us;
  cached = {
    land: feature(world, world.objects.land) as FeatureCollection<MultiPolygon | Polygon>,
    countries: (
      feature(world, world.objects.countries) as FeatureCollection<
        Polygon | MultiPolygon,
        { name?: string }
      >
    ).features,
    countryBorders: mesh(world, world.objects.countries, (a, b) => a !== b),
    states: (
      feature(us, us.objects.states) as FeatureCollection<Polygon | MultiPolygon, { name?: string }>
    ).features,
    stateBorders: mesh(us, us.objects.states, (a, b) => a !== b),
  };
  return cached;
}
