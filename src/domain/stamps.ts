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
   * custom: the owner typed the label (#151). It no longer claims to be an airport or a country, so it renders like a country stamp.
   */
  kind: "country" | "airport" | "place" | "custom";
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

/** The owner's label for each stamp slot in route order (#151); null = automatic. Only the override is ever stored. */
export type StampLabels = readonly [string | null, string | null];
export const NO_STAMP_LABELS: StampLabels = [null, null];

export const STAMP_LABEL_MESSAGE = "Use exactly 3 letters or numbers (A–Z, 0–9).";

/**
 * A typed stamp label made ready to store: trimmed, checked, then upper-cased. The check comes FIRST and is ASCII only
 * (exactly three of A-Z, a-z and 0-9), so a character that upper-casing would turn into something else is refused instead
 * of transliterated: "ſab" would become SAB, "ıab" IAB and "ﬁx" FIX. Empty or blank means no override (null).
 */
export function normaliseStampLabel(
  raw: string,
): { ok: true; label: string | null } | { ok: false } {
  const typed = raw.trim();
  if (typed === "") return { ok: true, label: null };
  return /^[A-Za-z0-9]{3}$/.test(typed) ? { ok: true, label: typed.toUpperCase() } : { ok: false };
}

/**
 * Upper-case only the ASCII letters of what is being typed into the label field. `toUpperCase()` on the whole text would
 * quietly turn ſ into S and ı into I as you type; this leaves them as typed so validation can refuse them.
 */
export const upperCaseAscii = (text: string): string =>
  text.replace(/[a-z]/g, (letter) => letter.toUpperCase());

/** The stamps a trip shows: the automatic ones, each slot's label replaced by the owner's override when there is one. */
export function selectStamps(stops: readonly TripStop[], overrides?: StampLabels): StampSpec[] {
  const automatic = automaticStamps(stops);
  const [one, two] = overrides ?? NO_STAMP_LABELS;
  if (automatic.length === 0) {
    // No automatic label (the stop has no country): an override on slot 1 still makes a single stamp.
    return one ? [customStamp(one, stops[0])] : [];
  }
  return automatic.map((stamp, index) => {
    const label = index === 0 ? one : two;
    return label ? customStamp(label, stops[0]) : stamp;
  });
}

function customStamp(label: string, first: TripStop | undefined): StampSpec {
  const cityName = first?.location.city.trim();
  return { kind: "custom", label, ...(cityName ? { cityName } : {}) };
}

/** What each slot's stamp would say with no override: the numbering the overrides use (1 = first stamp in route order). */
export function automaticStamps(stops: readonly TripStop[]): StampSpec[] {
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
  if (stamps.length > 1 || first.kind === "country")
    return `${stamps.map((s) => s.label).join(", ")} route stamps`;
  const place = first.cityName ? `, ${first.cityName}` : "";
  if (first.kind === "airport") return `${first.label} airport${place}, departure stamp`;
  return `${first.label}${place}, departure stamp`;
}
