// Pure geometry for the route map (#382). No map data and no d3 here: just numbers in, numbers out, so every rule is
// unit-tested directly. Coordinates are [longitude, latitude] in degrees, pixels are [x, y].

export type LngLat = readonly [lng: number, lat: number];
export type Px = readonly [x: number, y: number];

export type TravelMode = "fly" | "drive" | "other";

export interface RoutePoint {
  lat: number;
  lng: number;
  /** What people read: "Lisbon". Used in the accessible name. */
  label: string;
  /** Short code for captions: "LIS". Falls back to the label's first three letters, upper-cased. */
  code?: string;
  kind: "home" | "stop";
}

export interface Extent {
  west: number;
  east: number;
  south: number;
  north: number;
}

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

/** Mercator stretches without limit towards the poles, so the view never goes beyond this latitude. */
export const MAX_LAT = 80;

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Longitude folded into [-180, 180). */
export function normalizeLng(lng: number): number {
  return ((((lng + 180) % 360) + 360) % 360) - 180;
}

/**
 * Shifts each longitude by whole turns so that neighbours are never more than 180 degrees apart. A route from Honolulu
 * (-158) to Tokyo (140) becomes -158 to -220, which a map centred on the route draws as the short way across the
 * Pacific instead of the long way round.
 */
export function unwrapLongitudes(lngs: readonly number[]): number[] {
  const out: number[] = [];
  for (const lng of lngs) {
    const previous = out[out.length - 1];
    if (previous === undefined) {
      out.push(lng);
      continue;
    }
    let next = lng;
    while (next - previous > 180) next -= 360;
    while (next - previous < -180) next += 360;
    out.push(next);
  }
  return out;
}

function toVector([lng, lat]: LngLat): [number, number, number] {
  const phi = lat * RAD;
  const lambda = lng * RAD;
  return [Math.cos(phi) * Math.cos(lambda), Math.cos(phi) * Math.sin(lambda), Math.sin(phi)];
}

/** Angular distance between two places along the great circle, in degrees (0 to 180). */
export function angularDistanceDeg(a: LngLat, b: LngLat): number {
  const [ax, ay, az] = toVector(a);
  const [bx, by, bz] = toVector(b);
  const dot = clamp(ax * bx + ay * by + az * bz, -1, 1);
  return Math.acos(dot) * DEG;
}

/** How many segments a leg of this length is drawn with: smooth on long legs, cheap on short ones. */
export function legSegments(distanceDeg: number): number {
  return clamp(Math.ceil(distanceDeg / 2), 8, 90);
}

/**
 * Points along the great circle from `a` to `b`, endpoints included (`segments + 1` points). Longitudes continue from
 * `a.lng` without jumping at the antimeridian, so a leg that crosses it comes out as, say, -170, -175, -181, -186.
 */
export function greatCircle(a: LngLat, b: LngLat, segments?: number): LngLat[] {
  const omega = angularDistanceDeg(a, b) * RAD;
  const count = segments ?? legSegments(omega * DEG);
  if (omega < 1e-9 || Math.abs(Math.PI - omega) < 1e-6) {
    // Same place, or exact opposites (every meridian is a great circle): fall back to a straight blend.
    const [bLng] = unwrapLongitudes([a[0], b[0]]).slice(1);
    return Array.from({ length: count + 1 }, (_, i) => {
      const t = i / count;
      return [a[0] + (bLng! - a[0]) * t, a[1] + (b[1] - a[1]) * t] as const;
    });
  }
  const va = toVector(a);
  const vb = toVector(b);
  const sinOmega = Math.sin(omega);
  const raw: LngLat[] = [];
  for (let i = 0; i <= count; i += 1) {
    const t = i / count;
    const wa = Math.sin((1 - t) * omega) / sinOmega;
    const wb = Math.sin(t * omega) / sinOmega;
    const x = wa * va[0] + wb * vb[0];
    const y = wa * va[1] + wb * vb[1];
    const z = wa * va[2] + wb * vb[2];
    raw.push([Math.atan2(y, x) * DEG, Math.atan2(z, Math.hypot(x, y)) * DEG]);
  }
  // Continue from the caller's longitude for `a`, then unwrap the rest.
  const lngs = unwrapLongitudes([a[0], ...raw.slice(1).map((p) => p[0])]);
  // Pin the ends to the inputs exactly (the trigonometry leaves 1e-14 of noise there).
  return raw.map((p, i) =>
    i === 0 ? ([a[0], a[1]] as const) : ([lngs[i]!, i === count ? b[1] : p[1]] as const),
  );
}

/** The route as legs of sampled points: home -> stops -> home (the way back only when there is a home). */
export function routeLegs(points: readonly RoutePoint[]): LngLat[][] {
  const home = points.find((p) => p.kind === "home");
  const stops = points.filter((p) => p.kind === "stop");
  if (stops.length === 0 || (!home && stops.length < 2)) return [];
  const ordered: RoutePoint[] = home ? [home, ...stops, home] : stops;
  // One unwrapped chain for the whole route, so legs line up end to start.
  const lngs = unwrapLongitudes(ordered.map((p) => p.lng));
  const legs: LngLat[][] = [];
  for (let i = 0; i < ordered.length - 1; i += 1) {
    const from: LngLat = [lngs[i]!, ordered[i]!.lat];
    const to: LngLat = [lngs[i + 1]!, ordered[i + 1]!.lat];
    legs.push(greatCircle(from, to));
  }
  return legs;
}

/** Bounding box of sampled points (longitudes already unwrapped); latitude is held inside Mercator's range. */
export function extentOf(samples: readonly LngLat[]): Extent {
  if (samples.length === 0) return { west: -100, east: 100, south: -50, north: 70 };
  let west = Infinity;
  let east = -Infinity;
  let south = Infinity;
  let north = -Infinity;
  for (const [lng, lat] of samples) {
    west = Math.min(west, lng);
    east = Math.max(east, lng);
    south = Math.min(south, lat);
    north = Math.max(north, lat);
  }
  return { west, east, south: Math.max(south, -MAX_LAT), north: Math.min(north, MAX_LAT) };
}

/**
 * Grows an extent to at least `minSpanDeg` in each direction, centred where it was, so one point (or two neighbours)
 * shows a region instead of a blank square. Never wider than a full turn or taller than Mercator allows.
 */
export function ensureMinSpan(extent: Extent, minSpanDeg: number): Extent {
  const lngSpan = Math.max(extent.east - extent.west, minSpanDeg);
  const latSpan = Math.max(extent.north - extent.south, minSpanDeg);
  const lngMid = (extent.east + extent.west) / 2;
  let south = (extent.north + extent.south) / 2 - latSpan / 2;
  let north = south + latSpan;
  // Slide rather than squash when the box would pass the Mercator limit.
  if (north > MAX_LAT) {
    south -= north - MAX_LAT;
    north = MAX_LAT;
  }
  if (south < -MAX_LAT) {
    north += -MAX_LAT - south;
    south = -MAX_LAT;
  }
  const half = Math.min(lngSpan, 360) / 2;
  return {
    west: lngMid - half,
    east: lngMid + half,
    south: Math.max(south, -MAX_LAT),
    north: Math.min(north, MAX_LAT),
  };
}

/** Longitude at the middle of an extent: the projection is rotated to put this at the centre of the map. */
export function centerLng(extent: Extent): number {
  return (extent.west + extent.east) / 2;
}

/** Angle in degrees of the step from one pixel to the next, 0 = pointing right, 90 = pointing down (SVG's y). */
export function angleDeg(from: Px, to: Px): number {
  return Math.atan2(to[1] - from[1], to[0] - from[0]) * DEG;
}

export interface PxLeg {
  from: Px;
  to: Px;
}

/**
 * Legs to draw. A leg that only retraces an earlier one (the way home from a single stop, or home from the last of two
 * close stops) would lay a second row of dots over the first and make the line look dense, so it is dropped when both
 * of its ends sit within `tolerance` pixels of the earlier leg's ends, in either direction.
 */
export function dropRetracedLegs(legs: readonly PxLeg[], tolerance: number): number[] {
  const kept: number[] = [];
  const near = (a: Px, b: Px) => Math.hypot(a[0] - b[0], a[1] - b[1]) <= tolerance;
  legs.forEach((leg, index) => {
    const retraces = kept.some((k) => {
      const earlier = legs[k]!;
      return (
        (near(leg.from, earlier.to) && near(leg.to, earlier.from)) ||
        (near(leg.from, earlier.from) && near(leg.to, earlier.to))
      );
    });
    if (!retraces) kept.push(index);
  });
  return kept;
}

/** Short code for a point: its own, or the first three letters of the label, upper-cased. */
export function pointCode(point: Pick<RoutePoint, "code" | "label">): string {
  const code = point.code?.trim();
  if (code) return code.toUpperCase();
  return point.label
    .replace(/[^\p{L}\p{N}]/gu, "")
    .slice(0, 3)
    .toUpperCase();
}

/** "SEA → LIS → OPO → SEA": the caption's route part (home first and last when there is a home). */
export function routeCodes(points: readonly RoutePoint[]): string {
  const home = points.find((p) => p.kind === "home");
  const stops = points.filter((p) => p.kind === "stop");
  const ordered = home ? [home, ...stops, home] : stops;
  return ordered.map(pointCode).join(" → ");
}

/**
 * The map's accessible name, built from the labels: "Route map: Seattle to Lisbon to Porto and back". With no home
 * it is "Route map: Lisbon to Porto"; with nothing to show it is just "Route map".
 */
export function accessibleName(points: readonly RoutePoint[]): string {
  const home = points.find((p) => p.kind === "home");
  const stops = points.filter((p) => p.kind === "stop");
  const names = [...(home ? [home] : []), ...stops].map((p) => p.label.trim()).filter(Boolean);
  if (names.length === 0) return "Route map";
  const route = names.join(" to ");
  return `Route map: ${route}${home && stops.length > 0 ? " and back" : ""}`;
}
