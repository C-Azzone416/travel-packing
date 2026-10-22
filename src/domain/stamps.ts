// Which route stamps to show for a trip (#144 spec §5, #157). Pure. Every label is exactly three characters: an airport
// IATA code or a country alpha-3 code. A label is never invented and never derived from a city name.

import { alpha3For } from "./iso-alpha3";
import type { TripStop } from "./trip-stops";

export interface StampSpec {
  /**
   * country: a route stamp (alpha-3 of a country on the route).
   * airport: the largest airport serving the first stop; its code can equal a country's (FRA, AUS), so it is marked
   * apart in the rendering and the accessible label.
   * place: the first stop has no airport, so its country's alpha-3 stands in; it renders like a country stamp.
   */
  kind: "country" | "airport" | "place";
  /** Exactly three characters. */
  label: string;
  /** The first stop's city as entered, for "LIS airport, Lisbon, departure stamp" (airport and place stamps). */
  cityName?: string;
}

function countryStamp(code: string): StampSpec {
  return { kind: "country", label: code };
}

/** The stamp for a trip's first stop: its airport code, else its country's alpha-3, else nothing. */
function firstStopStamp(stop: TripStop | undefined): StampSpec | null {
  if (!stop) return null;
  const cityName = stop.location.city.trim();
  if (stop.airportCode && /^[A-Z]{3}$/.test(stop.airportCode))
    return { kind: "airport", label: stop.airportCode, cityName };
  const code = alpha3For(stop.location.countryCode);
  return code ? { kind: "place", label: code, cityName } : null;
}

const fallback = (stop: TripStop | undefined): StampSpec[] => {
  const stamp = firstStopStamp(stop);
  return stamp ? [stamp] : [];
};

const cityKey = (stop: TripStop) => stop.location.city.trim().toLowerCase();

export function selectStamps(stops: readonly TripStop[]): StampSpec[] {
  const first = stops[0];
  if (stops.length < 2 || stops.every((stop) => cityKey(stop) === cityKey(first))) {
    return fallback(first);
  }
  const codes: string[] = [];
  for (const stop of stops) {
    const code = alpha3For(stop.location.countryCode);
    if (!code) return fallback(first);
    if (!codes.includes(code)) codes.push(code);
  }
  return codes.length === 1 || codes.length === 2 ? codes.map(countryStamp) : fallback(first);
}

/** "PRT, ESP route stamps", "LIS airport, Lisbon, departure stamp" or "CHE, Zermatt, departure stamp". */
export function stampsAriaLabel(stamps: readonly StampSpec[]): string {
  const first = stamps[0];
  if (!first) return "";
  if (first.kind === "country") return `${stamps.map((s) => s.label).join(", ")} route stamps`;
  const place = first.cityName ? `, ${first.cityName}` : "";
  if (first.kind === "airport") return `${first.label} airport${place}, departure stamp`;
  return `${first.label}${place}, departure stamp`;
}
