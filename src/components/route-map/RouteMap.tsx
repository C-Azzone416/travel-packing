import { accessibleName, type RoutePoint, type TravelMode } from "@/domain/route-map/geometry";
import { buildRouteMapModel } from "./model";

export interface RouteMapProps {
  /** Ordered stops, and optionally the home city (`kind: "home"`). With stops only the line runs stop to stop. */
  points: readonly RoutePoint[];
  mode: TravelMode;
  /** Size of the drawing's own coordinate space; the SVG then scales to its container. 638x244 laptop, 346x133 phone. */
  width?: number;
  height?: number;
  /** Corner radius in drawing units (16 on the laptop card, 12 inside the tag). */
  radius?: number;
  /** Set false to leave the ocean's name off (very narrow phones). */
  oceanLabel?: boolean;
}

// Plane glyph on a 24 grid, nose up, drawn at 22 px in the spec.
const PLANE =
  "M12 2c.8 0 1.5.9 1.5 2v5.5l8 4.5v2.2l-8-2.2v4.3l2.2 1.7V22L12 21l-3.7 1v-1.8l2.2-1.7v-4.3l-8 2.2v-2.2l8-4.5V4c0-1.1.7-2 1.5-2z";

// Below this container width the ocean's name would print under 6 px: hide it (the spec omits it on phones <= 320).
const OCEAN_HIDE_CSS =
  ".ps-route-map{container-type:inline-size}@container (max-width:320px){.ps-route-map text{display:none}}";

/**
 * The trip's route on a real map (#382). A server component: d3 and the geography run on the server and the page gets
 * only SVG paths, so none of the map data is in the client bundle. Colours come from the scheme tokens, so it follows
 * whichever `[data-scheme]` it sits in. No tiles, no network calls, no keys.
 */
export function RouteMap({
  points,
  mode,
  width,
  height,
  radius = 16,
  oceanLabel = true,
}: RouteMapProps) {
  const m = buildRouteMapModel(points, { width, height, mode, oceanLabel });
  const name = accessibleName(points);
  const fill = (token: string) => ({ fill: `var(--${token})` });
  return (
    <div className="ps-route-map" style={{ width: "100%", minWidth: 0 }}>
      <style>{OCEAN_HIDE_CSS}</style>
      <svg
        role="img"
        aria-label={name}
        viewBox={`0 0 ${m.width} ${m.height}`}
        preserveAspectRatio="xMidYMid slice"
        style={{
          display: "block",
          width: "100%",
          height: "auto",
          maxWidth: "100%",
          aspectRatio: `${m.width} / ${m.height}`,
          borderRadius: radius,
          overflow: "hidden",
        }}
      >
        <g aria-hidden="true">
          <rect width={m.width} height={m.height} style={fill("sea")} />
          <path
            d={m.graticule}
            data-part="graticule"
            style={{ fill: "none", stroke: "var(--seaLine)", strokeWidth: 1 }}
          />
          <path
            d={m.land}
            data-part="land"
            style={{ fill: "var(--paper)", stroke: "var(--coast)", strokeWidth: 1 }}
          />
          <path
            d={m.stateBorders}
            data-part="state-borders"
            style={{ fill: "none", stroke: "var(--coast)", strokeWidth: 1, strokeDasharray: "3 3" }}
          />
          <path
            d={m.countryBorders}
            data-part="country-borders"
            style={{ fill: "none", stroke: "var(--coast)", strokeWidth: 1 }}
          />
          {m.highlights.map((d, i) => (
            <path
              key={i}
              d={d}
              data-part="highlight"
              style={{ fill: "var(--accentSoft)", stroke: "var(--gold)", strokeWidth: 1.5 }}
            />
          ))}
          {m.ocean ? (
            <text
              x={m.ocean.x}
              y={m.ocean.y}
              textAnchor="middle"
              dominantBaseline="middle"
              data-part="ocean-label"
              style={{
                fill: "var(--info)",
                opacity: 0.7,
                fontFamily: "var(--font-body), system-ui, sans-serif",
                fontWeight: 700,
                fontStyle: "italic",
                fontSize: m.ocean.fontSize,
                letterSpacing: "0.2em",
              }}
            >
              {m.ocean.text}
            </text>
          ) : null}
          {m.legs.map((d, i) => (
            <path
              key={i}
              d={d}
              data-part="leg"
              style={{
                fill: "none",
                stroke: "var(--accent)",
                strokeWidth: 3,
                strokeLinecap: "round",
                strokeDasharray: "0.1 7",
              }}
            />
          ))}
          {m.pins.map((pin, i) => (
            <circle
              key={i}
              cx={pin.x}
              cy={pin.y}
              r={10.5}
              data-part={pin.kind === "home" ? "home-pin" : "stop-pin"}
              style={{
                fill: pin.kind === "home" ? "var(--dark)" : "var(--accent)",
                stroke: "var(--paper)",
                strokeWidth: 3,
              }}
            />
          ))}
          {m.plane ? (
            <path
              d={PLANE}
              data-part="plane"
              transform={`translate(${m.plane.x.toFixed(1)} ${m.plane.y.toFixed(1)}) rotate(${m.plane.angle.toFixed(1)}) scale(0.9167) translate(-12 -12)`}
              style={{
                fill: "var(--dark)",
                stroke: "var(--paper)",
                strokeWidth: 1,
                strokeLinejoin: "round",
              }}
            />
          ) : null}
        </g>
      </svg>
    </div>
  );
}
