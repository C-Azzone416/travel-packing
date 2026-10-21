// Which packing items the live weather recommendation touches, for the pill and note on a packing row (#144).
// Matches item.id to the recommendation's semanticId; weather items are created with id = semanticId, so an
// item the forecast no longer calls for simply loses its pill.

import type { WeatherRecommendation } from "./recommend";

export interface ItemGuidance {
  tag: string;
  /** "Rain likely in Lisbon, Oct 3–5". */
  reason: string;
}

export function weatherGuidance(
  itemIds: readonly string[],
  recommendation: WeatherRecommendation,
): Map<string, ItemGuidance> {
  const present = new Set(itemIds);
  const guidance = new Map<string, ItemGuidance>();
  for (const line of recommendation.clothing) {
    if (line.semanticId && line.reason && line.tag && present.has(line.semanticId))
      guidance.set(line.semanticId, { tag: line.tag, reason: line.reason });
  }
  for (const extra of recommendation.extras) {
    if (present.has(extra.semanticId))
      guidance.set(extra.semanticId, { tag: extra.tag, reason: extra.reason });
  }
  return guidance;
}
