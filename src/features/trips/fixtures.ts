// Synthetic sample trips, from the approved prototype (San Diego upcoming, Lisbon past and
// fully packed). Temporary stand-in for real data until #10 wires the data layer. Never real
// trip data.

import { SYNTHETIC_STAPLES } from "@/domain/calc";
import {
  buildTrip,
  emptyLifecycleState,
  type LifecycleState,
  type SampleLocation,
} from "@/domain/trip-lifecycle";
import type { TripConfig } from "@/domain/trip";

export const SAMPLE_LOCATIONS: Record<string, SampleLocation> = {
  "us-ca-san-diego": {
    id: "us-ca-san-diego",
    city: "San Diego",
    region: "California",
    country: "United States",
    countryCode: "US",
    label: "San Diego, California, United States",
  },
  "pt-lisbon": {
    id: "pt-lisbon",
    city: "Lisbon",
    region: "Lisbon District",
    country: "Portugal",
    countryCode: "PT",
    label: "Lisbon, Lisbon District, Portugal",
  },
};

const BASE_CONFIG: TripConfig = {
  laundry: false,
  spare: true,
  niceAttire: true,
  occasionCount: 1,
  reuseNice: true,
  returnOutfit: true,
};

export function sampleLifecycleState(): LifecycleState {
  const deps = (id: string) => ({ newId: () => id, today: "2026-10-16" });
  const sanDiego = buildTrip(
    "San Diego",
    SAMPLE_LOCATIONS["us-ca-san-diego"],
    "2026-10-23",
    "2026-10-27",
    BASE_CONFIG,
    SYNTHETIC_STAPLES,
    deps("san-diego"),
  );
  sanDiego.theme = "beach";
  sanDiego.items = sanDiego.items.map((item) =>
    ["tops", "underwear", "socks", "sleepwear", "sunglasses"].includes(item.id)
      ? { ...item, packed: Math.min(item.qty, item.id === "underwear" ? 2 : 1) }
      : item,
  );

  const lisbon = buildTrip(
    "Lisbon",
    SAMPLE_LOCATIONS["pt-lisbon"],
    "2026-09-03",
    "2026-09-07",
    { ...BASE_CONFIG, laundry: true, spare: false },
    SYNTHETIC_STAPLES,
    deps("lisbon"),
  );
  lisbon.theme = "city";
  lisbon.items = lisbon.items.map((item) => ({ ...item, packed: item.qty }));
  lisbon.toiletryBagPacked = true;
  lisbon.ready = true;

  return { ...emptyLifecycleState(), trips: [sanDiego, lisbon] };
}
