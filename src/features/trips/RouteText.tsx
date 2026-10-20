import { routeDisplay, ROUTE_BUDGET } from "./view";

export interface RouteTextProps {
  cities: readonly string[];
  /** Characters before the middle is dropped. The dashboard card uses the default; a roomier surface can pass more. */
  budget?: number;
  className?: string;
}

// "Lisbon → Porto → Madrid", or "Lisbon → … → Madrid · 5 stops" when it would not fit. The full route is always in
// the title and in the spoken text; the arrows are decoration.
export function RouteText({ cities, budget = ROUTE_BUDGET, className }: RouteTextProps) {
  const route = routeDisplay(cities, budget);
  return (
    <span
      className={className ? `route-text ${className}` : "route-text"}
      title={cities.join(" → ")}
    >
      <span className="sr-only">{route.spoken}</span>
      <span aria-hidden="true">
        {route.cities.join(" → ")}
        {route.shortened ? <span className="route-count"> · {route.count} stops</span> : null}
      </span>
    </span>
  );
}
