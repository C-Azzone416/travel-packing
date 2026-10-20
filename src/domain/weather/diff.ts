import type { Suggestion } from "../calc/suggestions";
import type { WeatherRecommendation, WeatherSuggestion } from "./recommend";

/** Every id the engine can emit as a conditional item; only these are ever offered for removal. */
export const WEATHER_EXTRA_IDS = [
  "layer-light",
  "layer-warm",
  "cold-accessories",
  "weather-umbrella",
  "weather-rain-jacket",
  "weather-swimsuit",
  "weather-sunscreen",
  "weather-sun-hat",
  "weather-snow-boots",
] as const;

export const CLOTHING_SPLIT_ID = "clothing-split";
const SPLIT_IDS = ["tops-short", "tops-long", "bottoms-shorts", "bottoms-pants"];
const CLOTHING_IDS = ["tops", "bottoms", ...SPLIT_IDS];

export interface SavedItem {
  id: string;
  qty: number;
  userEdited?: boolean;
}

export type WeatherChange =
  | {
      kind: "add";
      semanticId: string;
      title: string;
      reason: string;
      ruleSignature: string;
      userEdited: false;
      item: WeatherSuggestion;
    }
  | {
      kind: "remove";
      semanticId: string;
      title: string;
      reason: string;
      ruleSignature: string;
      /** True when the person edited the saved item: offered, and the review must not overwrite it. */
      userEdited: boolean;
    }
  | {
      kind: "split";
      semanticId: typeof CLOTHING_SPLIT_ID;
      title: string;
      reason: string;
      ruleSignature: string;
      userEdited: boolean;
      clothing: Suggestion[];
    };

/** Skipped changes: semantic id -> the ruleSignature that was skipped. */
export type SuppressedChanges = Readonly<Record<string, string>>;

const nameFor = (id: string) => WEATHER_EXTRA_NAMES[id] ?? id;
const WEATHER_EXTRA_NAMES: Record<string, string> = {
  "layer-light": "Light jacket or sweater",
  "layer-warm": "Warm coat",
  "cold-accessories": "Hat and gloves",
  "weather-umbrella": "Compact umbrella",
  "weather-rain-jacket": "Rain jacket",
  "weather-swimsuit": "Swimsuit",
  "weather-sunscreen": "Sunscreen",
  "weather-sun-hat": "Sun hat",
  "weather-snow-boots": "Waterproof boots",
};

function splitSignature(lines: readonly { id: string; qty: number }[]): string {
  return lines
    .map((line) => `${line.id}:${line.qty}`)
    .sort()
    .join("|");
}

/**
 * What the weather now recommends that the saved list does not have (#110, epic §4). Pure: it never edits
 * anything. Items the person edited are reported with `userEdited` so the sheet offers instead of overwriting,
 * and a skipped change stays hidden until its ruleSignature changes.
 */
export function diffRecommendations(
  saved: readonly SavedItem[],
  recommendation: WeatherRecommendation,
  suppressed: SuppressedChanges = {},
): WeatherChange[] {
  const changes: WeatherChange[] = [];
  const byId = new Map(saved.map((item) => [item.id, item]));

  for (const extra of recommendation.extras) {
    if (byId.has(extra.semanticId)) continue;
    changes.push({
      kind: "add",
      semanticId: extra.semanticId,
      title: extra.name,
      reason: extra.reason,
      ruleSignature: extra.ruleSignature,
      userEdited: false,
      item: extra,
    });
  }

  const recommended = new Set(recommendation.extras.map((extra) => extra.semanticId));
  for (const id of WEATHER_EXTRA_IDS) {
    const item = byId.get(id);
    if (!item || recommended.has(id)) continue;
    changes.push({
      kind: "remove",
      semanticId: id,
      title: nameFor(id),
      reason: "The weather no longer calls for this",
      ruleSignature: "removed",
      userEdited: Boolean(item.userEdited),
    });
  }

  const wanted = recommendation.clothing.filter((line) => line.semanticId);
  if (wanted.length) {
    const have = saved.filter((item) => CLOTHING_IDS.includes(item.id));
    const wantedSignature = splitSignature(wanted);
    if (splitSignature(have) !== wantedSignature) {
      changes.push({
        kind: "split",
        semanticId: CLOTHING_SPLIT_ID,
        title: have.some((item) => SPLIT_IDS.includes(item.id))
          ? "Update clothing split"
          : "Split clothing by weather",
        reason: wanted.map((line) => `${line.qty} × ${line.name}`).join(", "),
        ruleSignature: wantedSignature,
        userEdited: have.some((item) => item.userEdited),
        clothing: wanted,
      });
    }
  }

  return changes.filter((change) => suppressed[change.semanticId] !== change.ruleSignature);
}
