// View logic for the suitcase Staples screen (#384): cube sections and the trip preview. No React, no clock.

import {
  calculateSuggestions,
  stapleContext,
  stapleQuantity,
  type CalcConfig,
} from "@/domain/calc";
import { CUBES, CUBE_LABELS, canCarryLaundryFlag, itemCube, type Cube } from "@/domain/cubes";
import { canonicalItemId } from "@/domain/item-identity";
import { TOILETRY_GROUP_ID } from "@/domain/toiletry-bag";
import type { Staple } from "@/domain/trip";
import { cubeForItem } from "@/domain/cubes";

/** The cubes a Staple can live in, in the order the screen shows them. The weather cube is filled by the forecast. */
export const STAPLE_CUBES: readonly Cube[] = CUBES.filter((cube) => cube !== "weather");
export const MIN_NIGHTS = 1;
export const MAX_NIGHTS = 21;
export const DEFAULT_NIGHTS = 4;

export type StapleCadenceChoice = "per trip" | "per day" | "per night";
export const CADENCE_CHOICES: readonly StapleCadenceChoice[] = ["per trip", "per day", "per night"];

/** The cube a Staple is shown in. A stored weather cube (never expected on a Staple) is shown in Misc. */
export function stapleCube(staple: Staple): Cube {
  const cube = itemCube(staple);
  return cube === "weather" ? "misc" : cube;
}

/** The stored category for a cube, so screens that still read categories file the Staple in the same place. */
const CATEGORY_FOR_CUBE: Record<Cube, string> = {
  clothing: "Clothing",
  toiletries: "Bathroom",
  tech: "Tech",
  documents: "Other essentials",
  misc: "Other essentials",
  weather: "Other essentials",
};

/**
 * The Staple after it moves to `cube`: the category follows the cube, the toiletry-bag group follows Toiletries, and an
 * explicit cube is stored only when the category alone would not put it there (Documents vs Misc).
 */
export function moveToCube(staple: Staple, cube: Cube): Staple {
  const rest: Staple = { ...staple };
  delete rest.cube;
  delete rest.groupId;
  const keepsCategory = cubeForItem(rest) === cube;
  const next: Staple = {
    ...rest,
    category: keepsCategory ? staple.category : CATEGORY_FOR_CUBE[cube],
    ...(cube === "toiletries" ? { groupId: TOILETRY_GROUP_ID } : {}),
  };
  if (cubeForItem(next) !== cube) next.cube = cube;
  return next;
}

/** Whether a Staple can carry "fewer with laundry": never underwear or socks, and not a legacy Smart quantity. */
export const canHaveLaundry = (staple: Pick<Staple, "id" | "cadence">): boolean =>
  canCarryLaundryFlag(staple.id) && staple.cadence !== "smart";

/** The Staple with the laundry flag set or cleared (it stays clear where the flag cannot apply). */
export function withLaundry(staple: Staple, on: boolean): Staple {
  const next: Staple = { ...staple };
  delete next.laundryHalves;
  if (on && canHaveLaundry(staple)) next.laundryHalves = true;
  return next;
}

/** A cadence change; Smart cannot carry the laundry flag, but the three plain cadences keep it. */
export function withCadence(staple: Staple, cadence: StapleCadenceChoice): Staple {
  return { ...staple, cadence };
}

export interface CubeSection {
  cube: Cube;
  label: string;
  staples: Staple[];
}

/** One section per Staples cube, always in cube order, each with its staples in stored order. */
export function groupByCube(staples: readonly Staple[]): CubeSection[] {
  return STAPLE_CUBES.map((cube) => ({
    cube,
    label: CUBE_LABELS[cube],
    staples: staples.filter((staple) => stapleCube(staple) === cube),
  }));
}

export interface PreviewRow {
  staple: Staple;
  /** What a trip gets with laundry off. */
  plain: number;
  /** What it gets with the preview's laundry setting. */
  qty: number;
}

export interface PreviewSummary {
  rows: PreviewRow[];
  /** Items to start: the sum of every Staple's quantity under the preview's laundry setting. */
  total: number;
  /** What turning laundry on saves (zero when nothing is marked). The same number whether laundry is on or off. */
  saves: number;
  perCube: { cube: Cube; label: string; items: number }[];
}

/**
 * The calculator's config for a trip of `nights` nights; the day counts come from `calculateSuggestions`. The preview
 * counts every trip day as an everyday outfit (no return outfit), as the design's sample numbers do: the return outfit is
 * a separate trip feature, added on top when a real trip is planned.
 */
function previewConfig(nights: number, laundry: boolean): CalcConfig {
  const end = new Date(Date.UTC(2026, 0, 1 + nights)).toISOString().slice(0, 10);
  return {
    start: "2026-01-01",
    end,
    laundry,
    spare: false,
    niceAttire: true,
    occasionCount: 1,
    returnOutfit: false,
  };
}

/**
 * What a trip of `nights` nights starts with from these Staples. Every count is the domain's own `stapleQuantity` (or,
 * for a legacy Smart staple, the calculator's line); nothing is re-derived here.
 */
export function previewStaples(
  staples: readonly Staple[],
  nights: number,
  laundry: boolean,
): PreviewSummary {
  const plainConfig = previewConfig(nights, false);
  const laundryConfig = previewConfig(nights, true);
  const plainDays = calculateSuggestions(plainConfig);
  const laundryDays = calculateSuggestions(laundryConfig);
  const quantityFor = (staple: Staple, on: boolean): number => {
    const config = on ? laundryConfig : plainConfig;
    const computed = on ? laundryDays : plainDays;
    if (staple.cadence === "smart") {
      const identity = canonicalItemId(staple.id);
      return computed.items.find((item) => canonicalItemId(item.id) === identity)?.qty ?? 0;
    }
    return stapleQuantity(staple, stapleContext(config, computed));
  };
  const rows = staples.map((staple) => ({
    staple,
    plain: quantityFor(staple, false),
    qty: quantityFor(staple, laundry),
  }));
  const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
  return {
    rows,
    total: sum(rows.map((row) => row.qty)),
    saves: sum(rows.map((row) => row.plain)) - sum(staples.map((s) => quantityFor(s, true))),
    perCube: STAPLE_CUBES.map((cube) => ({
      cube,
      label: CUBE_LABELS[cube],
      items: sum(rows.filter((row) => stapleCube(row.staple) === cube).map((row) => row.qty)),
    })),
  };
}

/** The staples whose count grows with the trip (per day, per night, or legacy Smart). */
export const scalesWithTrip = (staple: Pick<Staple, "cadence">): boolean =>
  staple.cadence !== "per trip";

export const nightsLabel = (nights: number): string =>
  `${nights} ${nights === 1 ? "night" : "nights"}`;
export const itemsLabel = (count: number): string => `${count} ${count === 1 ? "item" : "items"}`;
export const stapleCount = (count: number): string =>
  `${count} ${count === 1 ? "staple" : "staples"}`;
