import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { RoutePoint } from "@/domain/route-map/geometry";
import { geography } from "./geography";
import { buildRouteMapModel, MAP_DEFAULTS } from "./model";
import { RouteMap } from "./RouteMap";

const home: RoutePoint = { kind: "home", label: "New York", code: "NYC", lat: 40.64, lng: -73.78 };
const lisbon: RoutePoint = { kind: "stop", label: "Lisbon", code: "LIS", lat: 38.72, lng: -9.14 };
const porto: RoutePoint = { kind: "stop", label: "Porto", code: "OPO", lat: 41.15, lng: -8.61 };
const chicago: RoutePoint = { kind: "home", label: "Chicago", lat: 41.88, lng: -87.63 };
const denver: RoutePoint = { kind: "stop", label: "Denver", lat: 39.74, lng: -104.99 };
const honolulu: RoutePoint = { kind: "home", label: "Honolulu", lat: 21.3, lng: -157.86 };
const tokyo: RoutePoint = { kind: "stop", label: "Tokyo", lat: 35.68, lng: 139.69 };

const coordinates = (d: string) =>
  [...d.matchAll(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g)].map(
    (m) => [Number(m[1]), Number(m[2])] as const,
  );

describe("geography", () => {
  it("decodes the bundled Natural Earth data once", () => {
    const geo = geography();
    expect(geo).toBe(geography());
    expect(geo.countries.length).toBeGreaterThan(150);
    expect(geo.states.length).toBeGreaterThanOrEqual(50);
    expect(geo.countries.some((c) => c.properties.name === "Portugal")).toBe(true);
    expect(geo.states.some((s) => s.properties.name === "Illinois")).toBe(true);
    expect(geo.land.features.length).toBeGreaterThan(0);
    expect(geo.countryBorders.coordinates.length).toBeGreaterThan(0);
    expect(geo.stateBorders.coordinates.length).toBeGreaterThan(0);
  });
});

describe("buildRouteMapModel", () => {
  it("draws a transatlantic fly route inside the frame with pins at both ends and a plane", () => {
    const m = buildRouteMapModel([home, lisbon, porto], { mode: "fly" });
    expect(m.width).toBe(MAP_DEFAULTS.width);
    expect(m.height).toBe(MAP_DEFAULTS.height);
    expect(m.pins).toHaveLength(3);
    for (const pin of m.pins) {
      expect(pin.x).toBeGreaterThan(0);
      expect(pin.x).toBeLessThan(m.width);
      expect(pin.y).toBeGreaterThan(0);
      expect(pin.y).toBeLessThan(m.height);
    }
    // Home is the westernmost pin, and drawn last so nothing hides it.
    const westmost = Math.min(...m.pins.map((p) => p.x));
    expect(m.pins[m.pins.length - 1]).toMatchObject({ kind: "home", x: westmost });
    expect(m.plane).not.toBeNull();
    // Heading east and a little north: pointing up-right means a rotation between 0 and 90 for an icon that points up.
    expect(m.plane!.angle).toBeGreaterThan(0);
    expect(m.plane!.angle).toBeLessThan(90);
    expect(m.legs.length).toBeGreaterThan(0);
    expect(m.land).toMatch(/^M/);
    expect(m.graticule).toMatch(/^M/);
    expect(m.countryBorders).toMatch(/^M/);
    expect(m.stateBorders).toMatch(/^M/);
  });

  it("paints the home state and destination country gold, but not the home country", () => {
    const m = buildRouteMapModel([home, lisbon, porto], { mode: "fly" });
    // New York (state) + Portugal.
    expect(m.highlights).toHaveLength(2);
  });

  it("paints states, not the whole country, on a domestic route", () => {
    const m = buildRouteMapModel([chicago, denver], { mode: "drive" });
    expect(m.highlights).toHaveLength(2);
    // Two states are a small part of the frame's path data compared with a whole-country fill.
    const ill = geography().states.find((s) => s.properties.name === "Illinois")!;
    expect(ill).toBeDefined();
  });

  it("has no plane unless flying", () => {
    expect(buildRouteMapModel([home, lisbon], { mode: "drive" }).plane).toBeNull();
    expect(buildRouteMapModel([home, lisbon], { mode: "other" }).plane).toBeNull();
    expect(buildRouteMapModel([lisbon], { mode: "fly" }).plane).toBeNull();
  });

  it("shows the Atlantic's name between the continents and keeps it clear of the route", () => {
    const m = buildRouteMapModel([home, lisbon, porto], { mode: "fly" });
    expect(m.ocean?.text).toBe("ATLANTIC OCEAN");
    expect(
      buildRouteMapModel([home, lisbon, porto], { mode: "fly", oceanLabel: false }).ocean,
    ).toBeNull();
  });

  it("leaves the ocean label off when the route crosses none, or when there is no room", () => {
    expect(buildRouteMapModel([chicago, denver], { mode: "drive" }).ocean).toBeNull();
    // A tiny frame has nowhere for the text.
    expect(
      buildRouteMapModel([home, lisbon], { mode: "fly", width: 90, height: 40 }).ocean,
    ).toBeNull();
  });

  it("names the Pacific for a route across the antimeridian and draws it the short way", () => {
    const m = buildRouteMapModel([honolulu, tokyo], { mode: "fly" });
    expect(m.ocean?.text).toBe("PACIFIC OCEAN");
    // The route is one connected band: no leg jumps across the whole frame.
    for (const leg of m.legs) {
      const pts = coordinates(leg);
      for (let i = 1; i < pts.length; i += 1) {
        expect(Math.abs(pts[i]![0] - pts[i - 1]![0])).toBeLessThan(m.width / 4);
      }
    }
    const xs = m.pins.map((p) => p.x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(m.width / 2);
  });

  it("works with stops only: a line between them and no home pin", () => {
    const m = buildRouteMapModel([lisbon, porto], { mode: "drive" });
    expect(m.pins.every((p) => p.kind === "stop")).toBe(true);
    expect(m.legs).toHaveLength(1);
  });

  it("shows a region, not a blank square, for one point (minimum zoom)", () => {
    const m = buildRouteMapModel([lisbon], { mode: "other" });
    expect(m.legs).toEqual([]);
    expect(m.pins).toHaveLength(1);
    // The neighbourhood has land and a coast in it: both land and borders have path data.
    expect(m.land.length).toBeGreaterThan(200);
    expect(m.countryBorders.length).toBeGreaterThan(50);
    // And the pin is in the middle.
    expect(m.pins[0]!.x).toBeCloseTo(m.width / 2, 0);
    // Mercator stretches towards the poles, so the middle latitude sits a few pixels off the middle of the frame.
    expect(Math.abs(m.pins[0]!.y - m.height / 2)).toBeLessThan(8);
  });

  it("zooms in on two close points rather than showing the whole country (minimum zoom)", () => {
    const close = buildRouteMapModel(
      [
        { kind: "stop", label: "A", lat: 38.7, lng: -9.1 },
        { kind: "stop", label: "B", lat: 38.75, lng: -9.15 },
      ],
      { mode: "drive" },
    );
    const dx = Math.abs(close.pins[0]!.x - close.pins[1]!.x);
    // 0.05 degrees apart on an 8 degree frame: well under a tenth of the frame, not stretched to the padding.
    expect(dx).toBeLessThan(close.width / 10);
  });

  it("copes with no points at all", () => {
    const m = buildRouteMapModel([], { mode: "fly" });
    expect(m.pins).toEqual([]);
    expect(m.legs).toEqual([]);
    expect(m.plane).toBeNull();
    expect(m.ocean).toBeNull();
    expect(m.highlights).toEqual([]);
  });

  it("drops the way back over a single stop's path", () => {
    expect(buildRouteMapModel([home, lisbon], { mode: "fly" }).legs).toHaveLength(1);
    expect(buildRouteMapModel([home, lisbon, porto], { mode: "fly" }).legs).toHaveLength(2);
    expect(buildRouteMapModel([chicago, denver], { mode: "drive" }).legs).toHaveLength(1);
  });

  it("uses a point on the shore: coordinates the coarse outline calls water still find the country", () => {
    const shore: RoutePoint = { kind: "stop", label: "Haneda", lat: 35.55, lng: 139.78 };
    const m = buildRouteMapModel([honolulu, shore], { mode: "fly" });
    expect(m.highlights.length).toBeGreaterThanOrEqual(1);
  });

  it("paints nothing for a stop in open water", () => {
    const sea: RoutePoint = { kind: "stop", label: "Mid-Atlantic", lat: 30, lng: -40 };
    expect(buildRouteMapModel([sea], { mode: "other" }).highlights).toEqual([]);
  });

  it("does not paint the home country when the stop is in another country with no state data", () => {
    const toronto: RoutePoint = { kind: "stop", label: "Toronto", lat: 43.7, lng: -79.4 };
    const m = buildRouteMapModel([home, toronto], { mode: "drive" });
    // New York (home state) + Canada.
    expect(m.highlights).toHaveLength(2);
  });

  it("does not paint a domestic stop's country when the home is outside the US", () => {
    const paris: RoutePoint = { kind: "home", label: "Paris", lat: 48.85, lng: 2.35 };
    const lyon: RoutePoint = { kind: "stop", label: "Lyon", lat: 45.76, lng: 4.84 };
    expect(buildRouteMapModel([paris, lyon], { mode: "drive" }).highlights).toEqual([]);
  });

  it("honours the requested size", () => {
    const m = buildRouteMapModel([home, lisbon], { mode: "fly", width: 346, height: 133 });
    expect(m).toMatchObject({ width: 346, height: 133 });
    for (const pin of m.pins) expect(pin.x).toBeLessThan(346);
  });
});

describe("RouteMap", () => {
  const html = (props: Partial<Parameters<typeof RouteMap>[0]> = {}) =>
    renderToStaticMarkup(<RouteMap points={[home, lisbon, porto]} mode="fly" {...props} />);

  it("is an image named for the route, with the drawing hidden from assistive tech", () => {
    const out = html();
    expect(out).toContain('role="img"');
    expect(out).toContain('aria-label="Route map: New York to Lisbon to Porto and back"');
    expect(out).toContain('<g aria-hidden="true">');
    // Nothing focusable or readable outside the hidden group.
    expect(out).not.toContain("<title>");
  });

  it("uses the scheme tokens for every colour and no literal colours", () => {
    const out = html();
    for (const token of [
      "sea",
      "seaLine",
      "paper",
      "coast",
      "accent",
      "accentSoft",
      "gold",
      "dark",
      "info",
    ]) {
      expect(out).toContain(`var(--${token})`);
    }
    expect(out).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it("styles the route as dots, the pins with a paper ring and the state borders as dashes", () => {
    const out = html();
    expect(out).toContain("stroke-dasharray:0.1 7");
    expect(out).toContain("stroke-linecap:round");
    expect(out).toContain("stroke-dasharray:3 3");
    expect(out).toContain('data-part="home-pin"');
    expect(out).toContain('data-part="stop-pin"');
    expect(out).toContain('data-part="plane"');
    expect(out).toContain('data-part="ocean-label"');
    expect(out).toContain("ATLANTIC OCEAN");
  });

  it("sets the ocean label in the body font variable, which exists (#415), not a made-up one", () => {
    const out = renderToStaticMarkup(<RouteMap points={[home, lisbon, porto]} mode="fly" />);
    expect(out).toContain("font-family:var(--font-body)");
    expect(out).not.toContain("--font-dm-sans");
  });

  it("scales to its container: viewBox plus fluid width, never a fixed pixel width", () => {
    const out = html({ width: 346, height: 133 });
    expect(out).toContain('viewBox="0 0 346 133"');
    expect(out).toContain("width:100%");
    expect(out).toContain("max-width:100%");
    expect(out).toContain("aspect-ratio:346 / 133");
    expect(out).not.toMatch(/<svg[^>]* width="/);
    expect(out).toContain("min-width:0");
  });

  it("rounds its corners by the given radius", () => {
    expect(html()).toContain("border-radius:16px");
    expect(html({ radius: 12 })).toContain("border-radius:12px");
  });

  it("hides the ocean name on narrow containers with a container query", () => {
    expect(html()).toContain("@container (max-width:320px)");
  });

  it("leaves out the plane unless flying, and the ocean name when asked", () => {
    expect(html({ mode: "drive" })).not.toContain('data-part="plane"');
    expect(html({ oceanLabel: false })).not.toContain('data-part="ocean-label"');
  });

  it("highlights regions in the accent tint with a gold stroke", () => {
    const out = html();
    expect(out).toContain('data-part="highlight"');
    expect(out).toContain("stroke-width:1.5");
  });

  it("still renders, with an empty-route name, for no points", () => {
    const out = renderToStaticMarkup(<RouteMap points={[]} mode="other" />);
    expect(out).toContain('aria-label="Route map"');
  });
});
