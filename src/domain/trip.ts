// Trip-level types shared by item operations (plan §7). Pure data; no framework imports.

import type { PackableItem, ReadinessTrip } from "./toiletry-bag";

export type Section = "main" | "return" | "packlast";
export type Scope = "this-trip" | "remember";

export interface TripItem extends PackableItem {
  name: string;
  category: string;
  section: Section;
  optional?: boolean;
  userEdited?: boolean;
}

export interface Staple {
  id: string;
  name: string;
  category: string;
  qty: number;
  cadence: "per day" | "per trip";
  packLast: boolean;
  groupId?: string;
}

export interface TripConfig {
  laundry: boolean;
  spare: boolean;
  niceAttire: boolean;
  occasionCount: number;
  reuseNice: boolean;
  returnOutfit: boolean;
}

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
  config: TripConfig;
  days: number;
  dailyDays: number;
  suggestionMemory: Record<string, TripItem>;
  suppressedSuggestions: Record<string, boolean>;
  weather: WeatherState;
}

/** One calculated suggestion, in the shape the #4 calculator produces (`core.js` calculateSuggestions). */
export interface SuggestedItem {
  id: string;
  name: string;
  category: string;
  qty: number;
  optional?: boolean;
}

export interface Suggestions {
  days: number;
  dailyDays: number;
  items: SuggestedItem[];
}

/** The calculator, injected so item operations do not depend on how #4 packages it. */
export type SuggestFn = (input: TripConfig & { start: string; end: string }) => Suggestions;
