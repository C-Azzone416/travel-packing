// Which route stamps to show for a trip (#144, spec §5). Pure; never infers a country from a city name.

import { alpha3For } from "./iso-alpha3";
import type { TripStop } from "./trip-stops";

export interface StampSpec {
  /** "airport" looks like a country code (FRA, AUS), so it is marked apart in the rendering and the accessible label. */
  kind: "country" | "city" | "airport";
  /** Text on the stamp: an alpha-3 code, an airport code, or the uppercased city name cut to 9 characters and an ellipsis. */
  label: string;
  /** Untruncated name or code, for the accessible label. */
  fullName: string;
  /** The city as the person entered it (airport stamps only), for "LIS airport, Lisbon, departure stamp". */
  cityName?: string;
}

export const MAX_CITY_LABEL = 9;

function cityStamp(stop: TripStop | undefined): StampSpec {
  const name = (stop?.location.city ?? "").trim();
  const full = name.toUpperCase();
  // A reliably matched airport code (#152) replaces the city name on the stamp; the name stays in the accessible label.
  if (stop?.airportCode && /^[A-Z]{3}$/.test(stop.airportCode))
    return { kind: "airport", label: stop.airportCode, fullName: full, cityName: name };
  const label = full.length > MAX_CITY_LABEL ? `${full.slice(0, MAX_CITY_LABEL)}…` : full;
  return { kind: "city", label, fullName: full };
}

function countryStamp(code: string): StampSpec {
  return { kind: "country", label: code, fullName: code };
}

const cityKey = (stop: TripStop) => stop.location.city.trim().toLowerCase();

/** Font size step for a stamp label: up to 5 characters, 6–7, then 8–9 (spec §5.4). */
export function stampLabelSize(label: string): "large" | "medium" | "small" {
  const length = label.replace("…", "").length;
  return length <= 5 ? "large" : length <= 7 ? "medium" : "small";
}

export function selectStamps(stops: readonly TripStop[]): StampSpec[] {
  const first = stops[0];
  if (stops.length < 2 || stops.every((stop) => cityKey(stop) === cityKey(first))) {
    return [cityStamp(first)];
  }
  const codes: string[] = [];
  for (const stop of stops) {
    const code = alpha3For(stop.location.countryCode);
    if (!code) return [cityStamp(first)];
    if (!codes.includes(code)) codes.push(code);
  }
  return codes.length === 1 || codes.length === 2 ? codes.map(countryStamp) : [cityStamp(first)];
}

/** "PRT, ESP route stamps", "LISBON departure stamp" or "LIS airport, Lisbon, departure stamp". */
export function stampsAriaLabel(stamps: readonly StampSpec[]): string {
  if (stamps[0]?.kind === "country")
    return `${stamps.map((s) => s.fullName).join(", ")} route stamps`;
  if (stamps[0]?.kind === "airport")
    return `${stamps[0].label} airport, ${stamps[0].cityName ?? stamps[0].fullName}, departure stamp`;
  return `${stamps[0]?.fullName ?? ""} departure stamp`;
}
