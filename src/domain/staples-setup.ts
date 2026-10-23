import type { Staple } from "./trip";

export const STAPLES_SETUP_STATES = ["incomplete", "skipped", "completed"] as const;
export type StaplesSetupState = (typeof STAPLES_SETUP_STATES)[number];

export interface StaplesSetup {
  state: StaplesSetupState;
  reminderDismissed: boolean;
  staples: Staple[];
}

export interface StapleSuggestion {
  category: "Clothing" | "Bathroom" | "Tech" | "Other essentials";
  staple: Staple;
}

/**
 * Neutral, optional guidance for setup. Nothing here is selected automatically or written until the owner chooses it.
 */
export const STAPLE_SUGGESTIONS: readonly StapleSuggestion[] = [
  {
    category: "Clothing",
    staple: {
      id: "underwear",
      name: "Underwear",
      category: "Clothing",
      qty: 1,
      cadence: "per day",
      packLast: false,
    },
  },
  {
    category: "Clothing",
    staple: {
      id: "socks",
      name: "Socks",
      category: "Clothing",
      qty: 1,
      cadence: "per day",
      packLast: false,
    },
  },
  {
    category: "Clothing",
    staple: {
      id: "sleepwear",
      name: "Sleepwear",
      category: "Clothing",
      qty: 1,
      cadence: "per trip",
      packLast: false,
    },
  },
  {
    category: "Bathroom",
    staple: {
      id: "toothbrush",
      name: "Toothbrush",
      category: "Bathroom",
      qty: 1,
      cadence: "per trip",
      packLast: true,
      groupId: "toiletry-bag",
    },
  },
  {
    category: "Bathroom",
    staple: {
      id: "medicine",
      name: "Medication",
      category: "Bathroom",
      qty: 1,
      cadence: "per day",
      packLast: false,
    },
  },
  {
    category: "Tech",
    staple: {
      id: "chargers",
      name: "Chargers",
      category: "Tech",
      qty: 1,
      cadence: "per trip",
      packLast: true,
    },
  },
  {
    category: "Other essentials",
    staple: {
      id: "travel-documents",
      name: "Travel documents",
      category: "Other essentials",
      qty: 1,
      cadence: "per trip",
      packLast: true,
    },
  },
];
