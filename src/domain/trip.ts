// Trip-level types shared by item operations (plan §7). Pure data; no framework imports.

import type {
  CalcConfig,
  ItemSection,
  Staple,
  Suggestions,
  TripItem as CalcTripItem,
} from "./calc";
import type { ReadinessTrip } from "./toiletry-bag";
import type { TripStop } from "./trip-stops";

// Item, staple, suggestion, and config shapes come from the calculator module (src/domain/calc);
// this file only adds what trip state needs on top of them.
export type { ItemSection, Staple, Suggestions };
export type Scope = "this-trip" | "remember";

/** A calculator item plus the flag item operations keep when the user edits it. */
export interface TripItem extends CalcTripItem {
  userEdited?: boolean;
}

/** The planning preferences, derived from the calculator's config so the two cannot drift. */
export type TripConfig = Required<Omit<CalcConfig, "start" | "end" | "occasionCount">> & {
  occasionCount: number;
};

export type WeatherStatus = "pending" | "accepted" | "skipped";

export interface WeatherState {
  status: WeatherStatus;
  label: string;
  suggestion: string;
}

export interface Trip extends ReadinessTrip<TripItem> {
  id: string;
  start: string;
  end: string;
  /** Ordered stops (epic #107); `start`/`end` are always the first arrive and last leave. */
  stops: TripStop[];
  config: TripConfig;
  days: number;
  dailyDays: number;
  suggestionMemory: Record<string, TripItem>;
  suppressedSuggestions: Record<string, boolean>;
  weather: WeatherState;
}

/** The calculator, injected so item operations do not depend on how it is packaged. */
export type SuggestFn = (input: CalcConfig) => Suggestions;
