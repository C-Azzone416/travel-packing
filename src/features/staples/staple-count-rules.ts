import type { Staple } from "@/domain/trip";

export interface StapleCountRule {
  cadence: Staple["cadence"];
  label: string;
  description: string;
}

/** The cadence copy shared by first-time setup and the Staples-page disclosure (#422). */
export const STAPLE_COUNT_RULES: readonly StapleCountRule[] = [
  {
    cadence: "per trip",
    label: "Fixed per trip",
    description: "The same amount on every trip.",
  },
  {
    cadence: "per day",
    label: "Per day",
    description: "Multiplies by every calendar day, including travel days.",
  },
  {
    cadence: "per night",
    label: "Per night",
    description: "Multiplies by the nights away, one fewer than the days.",
  },
  {
    cadence: "smart",
    label: "Smart",
    description: "Uses the shared clothing rules, including trip preferences.",
  },
];

export const STAPLE_LAUNDRY_NOTE =
  "Items marked ↻ are halved when a trip has laundry. Underwear and socks stay one per day.";

export function stapleCountRule(cadence: Staple["cadence"]): StapleCountRule {
  return STAPLE_COUNT_RULES.find((rule) => rule.cadence === cadence)!;
}

/** Setup adds item-specific availability and laundry details without duplicating the shared rule copy. */
export function stapleCountRuleDescription(
  cadence: Staple["cadence"],
  options: { laundryHalves: boolean; smartSupported: boolean },
): string {
  const rule = stapleCountRule(cadence);
  if (cadence === "per day") {
    return `${rule.description} ${
      options.laundryHalves
        ? "Halves (rounding up) when the trip has laundry."
        : "Laundry does not change it."
    }`;
  }
  if (cadence === "smart" && !options.smartSupported) {
    return "Available only for supported clothing staples.";
  }
  return rule.description;
}
