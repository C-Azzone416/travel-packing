import { geoContains, geoGraticule, geoMercator, geoPath } from "d3-geo";
import type { GeoPermissibleObjects } from "d3-geo";
import {
  angleDeg,
  centerLng,
  dropRetracedLegs,
  ensureMinSpan,
  extentOf,
  routeLegs,
  type LngLat,
  type Px,
  type RoutePoint,
} from "@/domain/route-map/geometry";
import { chooseOcean, estimateLabelWidth, placeLabel } from "@/domain/route-map/oceans";
import { geography, type Area } from "./geography";

export const MAP_DEFAULTS = {
  width: 638,
  height: 244,
  /** Inner padding so pins, their rings and the plane are never cut off. */
  padding: 32,
  /** Smallest region shown, in degrees: one stop or two close ones still show a country, not a blank square. */
  minSpanDeg: 8,
  graticuleStep: 15,
  pinRadius: 9,
  oceanFontSize: 10,
  /** Fraction along the first leg where the plane sits. */
  planeAt: 0.08,
};

export interface RouteMapModel {
  width: number;
  height: number;
  graticule: string;
  land: string;
  countryBorders: string;
  stateBorders: string;
  /** Home state and destination countries/states, painted over the land. */
  highlights: string[];
  /** One path per drawn leg, dotted. */
  legs: string[];
  pins: { x: number; y: number; kind: "home" | "stop" }[];
  /** Only for fly, and only when there is a leg to put it on. `angle` is a rotation for an icon that points up. */
  plane: { x: number; y: number; angle: number } | null;
  ocean: { text: string; x: number; y: number; fontSize: number } | null;
}

export interface BuildOptions {
  width?: number;
  height?: number;
  mode: "fly" | "drive" | "other";
  oceanLabel?: boolean;
}

const SEARCH_OFFSETS: readonly (readonly [number, number])[] = [
  [0, 0],
  [0.15, 0],
  [-0.15, 0],
  [0, 0.15],
  [0, -0.15],
  [0.4, 0.4],
  [-0.4, 0.4],
  [0.4, -0.4],
  [-0.4, -0.4],
];

const hasPoint = (area: Area, p: LngLat) => geoContains(area, [p[0], p[1]]);
const key = (area: Area) => area.properties.name ?? "";

/** The areas to paint gold: the home state (US only, the only region data we ship) and where the stops are. */
function highlightAreas(points: readonly RoutePoint[]): Area[] {
  const geo = geography();
  const home = points.find((p) => p.kind === "home");
  const stops = points.filter((p) => p.kind === "stop");
  // City coordinates often sit on the shore, which the coarse outline calls water: look a little around the point too.
  const at = (areas: Area[], p: RoutePoint) => {
    for (const [dx, dy] of SEARCH_OFFSETS) {
      const found = areas.find((a) => hasPoint(a, [p.lng + dx, p.lat + dy]));
      if (found) return found;
    }
    return undefined;
  };
  const out = new Map<string, Area>();
  const add = (area: Area | undefined) => {
    if (area) out.set(key(area), area);
  };
  const homeCountry = home ? at(geo.countries, home) : undefined;
  if (home) add(at(geo.states, home));
  for (const stop of stops) {
    const country = at(geo.countries, stop);
    // Domestic trips would paint the whole country, which says nothing: paint the state instead.
    if (country && homeCountry && key(country) === key(homeCountry)) add(at(geo.states, stop));
    else add(country);
  }
  return [...out.values()];
}

/** Turns a route into SVG path strings. All the d3 work happens here, on the server. */
export function buildRouteMapModel(
  points: readonly RoutePoint[],
  options: BuildOptions,
): RouteMapModel {
  const width = options.width ?? MAP_DEFAULTS.width;
  const height = options.height ?? MAP_DEFAULTS.height;
  const { padding, minSpanDeg, pinRadius, oceanFontSize } = MAP_DEFAULTS;
  const geo = geography();

  const legs = routeLegs(points);
  // Points that sit alone (one stop, no home) have no leg but still set the view.
  const samples: LngLat[] = legs.length ? legs.flat() : points.map((p) => [p.lng, p.lat] as const);
  // With no home, stops are unwrapped by routeLegs only when there is a leg; one point needs no unwrapping.
  const box = ensureMinSpan(extentOf(samples), minSpanDeg);

  const projection = geoMercator()
    .rotate([-centerLng(box), 0])
    .fitExtent(
      [
        [padding, padding],
        [width - padding, height - padding],
      ],
      {
        type: "MultiPoint",
        coordinates: [
          [box.west, box.south],
          [box.east, box.north],
          [box.west, box.north],
          [box.east, box.south],
        ],
      },
    );
  projection.clipExtent([
    [0, 0],
    [width, height],
  ]);
  const path = geoPath(projection).digits(1);
  const d = (object: GeoPermissibleObjects) => path(object) ?? "";
  const project = (p: LngLat): Px => {
    const out = projection([p[0], p[1]]);
    return out ? [out[0], out[1]] : [width / 2, height / 2];
  };

  const graticule = geoGraticule()
    .extent([
      [-180, -80],
      [180, 80],
    ])
    .step([MAP_DEFAULTS.graticuleStep, MAP_DEFAULTS.graticuleStep])
    .lines();
  const graticuleLines: GeoPermissibleObjects = {
    type: "MultiLineString",
    coordinates: graticule.map((line) => line.coordinates),
  };

  const legPx = legs.map((leg) => leg.map(project));
  const kept = dropRetracedLegs(
    legPx.map((line) => ({ from: line[0]!, to: line[line.length - 1]! })),
    // Two pins closer than this overlap (a pin is 24 across), so a way back to the second of them adds nothing.
    width * 0.06,
  );
  const drawn = kept.map((i) => legPx[i]!);
  const line = (pts: Px[]) =>
    "M" + pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join("L");

  const pinPoints: { point: RoutePoint; px: Px }[] = points.map((point) => ({
    point,
    px: project([point.lng, point.lat]),
  }));
  // Home pin last so it is never hidden by a stop that is close to it.
  const pins = [
    ...pinPoints.filter((p) => p.point.kind === "stop"),
    ...pinPoints.filter((p) => p.point.kind === "home"),
  ].map(({ point, px }) => ({ x: px[0], y: px[1], kind: point.kind }));

  let plane: RouteMapModel["plane"] = null;
  if (options.mode === "fly" && drawn.length > 0) {
    const first = drawn[0]!;
    const index = Math.min(
      first.length - 2,
      Math.max(0, Math.round((first.length - 1) * MAP_DEFAULTS.planeAt)),
    );
    const here = first[index]!;
    const next = first[index + 1]!;
    // The icon points up (-90 in SVG angles); rotate it by the step's heading.
    plane = { x: here[0], y: here[1], angle: angleDeg(here, next) + 90 };
  }

  let ocean: RouteMapModel["ocean"] = null;
  const chosen = options.oceanLabel === false ? null : chooseOcean(samples);
  if (chosen) {
    const at = placeLabel({
      // Every anchor is open water by construction (see OCEANS), so there is no land to test against.
      candidates: chosen.anchors.map(project),
      width: estimateLabelWidth(chosen.name, oceanFontSize),
      height: oceanFontSize * 1.4,
      viewport: { width, height },
      margin: 6,
      avoid: [...drawn, ...pins.map((p) => [[p.x, p.y]] as Px[])],
      clearance: pinRadius + 8,
    });
    if (at) ocean = { text: chosen.name, x: at[0], y: at[1], fontSize: oceanFontSize };
  }

  return {
    width,
    height,
    graticule: d(graticuleLines),
    land: d(geo.land),
    countryBorders: d(geo.countryBorders),
    stateBorders: d(geo.stateBorders),
    highlights: highlightAreas(points).map(d),
    legs: drawn.map(line),
    pins,
    plane,
    ocean,
  };
}
