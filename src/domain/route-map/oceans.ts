// Which ocean a route crosses and where its name can go on the map (#382). Pure: the map code passes in projected pixels.

import { normalizeLng, type LngLat, type Px } from "./geometry";

interface Box {
  west: number;
  east: number;
  south: number;
  north: number;
}

export interface Ocean {
  /** Printed as is (caps are in the text, not the CSS, so the accessible text matches what is drawn). */
  name: string;
  /** Rough water boxes in normalized longitude; the Pacific needs two because it straddles the antimeridian. */
  boxes: readonly Box[];
  /** Places to try for the label, best first. They are tested for land and for the route, so a bad one just loses. */
  anchors: readonly LngLat[];
}

export const OCEANS: readonly Ocean[] = [
  {
    name: "ATLANTIC OCEAN",
    boxes: [{ west: -68, east: -10, south: -55, north: 62 }],
    anchors: [
      [-38, 28],
      [-38, 14],
      [-30, 40],
      [-30, -8],
      [-25, -25],
      [-42, 50],
    ],
  },
  {
    name: "PACIFIC OCEAN",
    boxes: [
      { west: 140, east: 180, south: -55, north: 62 },
      // Stops short of North America's west coast so a Seattle to San Diego drive is not "Pacific".
      { west: -180, east: -126, south: -55, north: 62 },
    ],
    anchors: [
      [-150, 30],
      [-170, 18],
      [-140, 8],
      [175, 25],
      [-160, -15],
      [-135, 46],
      [165, 8],
    ],
  },
  {
    name: "INDIAN OCEAN",
    boxes: [{ west: 42, east: 110, south: -50, north: 22 }],
    anchors: [
      [75, -8],
      [70, -25],
      [85, 5],
    ],
  },
];

/** A route "spans" an ocean when at least this share of its sampled points are over it. */
export const OCEAN_MIN_SHARE = 0.25;

function inBox([lng, lat]: LngLat, box: Box): boolean {
  const l = normalizeLng(lng);
  return l >= box.west && l <= box.east && lat >= box.south && lat <= box.north;
}

/** Share (0 to 1) of the sampled points that lie inside the ocean's boxes. */
export function oceanShare(samples: readonly LngLat[], ocean: Ocean): number {
  if (samples.length === 0) return 0;
  const inside = samples.filter((p) => ocean.boxes.some((box) => inBox(p, box))).length;
  return inside / samples.length;
}

/** The ocean most of the route crosses, or null when it crosses none for long enough (a land route, a short hop). */
export function chooseOcean(samples: readonly LngLat[]): Ocean | null {
  let best: Ocean | null = null;
  let bestShare = OCEAN_MIN_SHARE;
  for (const ocean of OCEANS) {
    const share = oceanShare(samples, ocean);
    if (share >= bestShare) {
      best = ocean;
      bestShare = share;
    }
  }
  return best;
}

/** Width of the label text, estimated: bold italic caps at this size plus .2em tracking come to about .8em per letter. */
export function estimateLabelWidth(text: string, fontSize: number): number {
  return text.length * fontSize * 0.8;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Distance from a point to a rectangle (0 when inside). */
export function distanceToRect([x, y]: Px, rect: Rect): number {
  const dx = Math.max(rect.x - x, 0, x - (rect.x + rect.width));
  const dy = Math.max(rect.y - y, 0, y - (rect.y + rect.height));
  return Math.hypot(dx, dy);
}

/** True when any part of the polyline comes within `clearance` of the rectangle (sampled finely along each segment). */
export function polylineNearRect(line: readonly Px[], rect: Rect, clearance: number): boolean {
  for (let i = 0; i < line.length; i += 1) {
    const a = line[i]!;
    const b = line[i + 1] ?? a;
    const steps = Math.max(
      1,
      Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / Math.max(clearance / 2, 1)),
    );
    for (let s = 0; s <= steps; s += 1) {
      const t = s / steps;
      const point: Px = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      if (distanceToRect(point, rect) <= clearance) return true;
    }
  }
  return false;
}

export interface PlaceLabelInput {
  /** Candidate centres in pixels, best first. */
  candidates: readonly Px[];
  width: number;
  height: number;
  /** The map's own size; the label must stay `margin` pixels inside it. */
  viewport: { width: number; height: number };
  margin: number;
  /** Everything the label must keep clear of: the route's legs (as polylines) and the pins (as single points). */
  avoid: readonly (readonly Px[])[];
  clearance: number;
}

/** The first candidate where the text fits inside the map and stays clear of the route and pins, or null. */
export function placeLabel(input: PlaceLabelInput): Px | null {
  const { width, height, viewport, margin, avoid, clearance } = input;
  for (const [cx, cy] of input.candidates) {
    const rect: Rect = { x: cx - width / 2, y: cy - height / 2, width, height };
    const inside =
      rect.x >= margin &&
      rect.y >= margin &&
      rect.x + width <= viewport.width - margin &&
      rect.y + height <= viewport.height - margin;
    if (!inside) continue;
    if (avoid.some((line) => polylineNearRect(line, rect, clearance))) continue;
    return [cx, cy];
  }
  return null;
}
