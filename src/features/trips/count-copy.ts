// The plain-language words for the everyday count (design's final copy on #128, reworded for #295). Pure text built from numbers
// the calculator already produces: it changes no count. The travel outfit is what you wear on the way there: worn, not packed.

import { dailyDaysFor } from "@/domain/calc";

/** "1 day" / "5 days" with a number in front. */
const daysOf = (count: number, noun: string) => `${count} ${count === 1 ? "day" : "days"} ${noun}`;

const WORN_NOT_PACKED = "Your travel outfit is worn, not packed.";
const DAY_TRIP =
  "A day trip: you wear one outfit all day, so there are no everyday clothes to pack.";
const NOTHING_LEFT = "That leaves no everyday clothes to pack.";

/** The sum on its own: "7 days away − 1 for home = 6 days of everyday clothes." (null when there is no sum: a day trip or bad dates). */
export function countEquation(
  days: number,
  everydayDays: number,
  returnOutfit: boolean,
): string | null {
  if (days < 2) return null;
  const heldBack = returnOutfit ? " − 1 for home" : ", none held back for home";
  return `${daysOf(days, "away")}${heldBack} = ${daysOf(everydayDays, "of everyday clothes")}.`;
}

/** The trip screen's "Trip math" line: the sum plus the travel-outfit sentence, or the short-trip sentence. */
export function tripMathLine(days: number, everydayDays: number, returnOutfit: boolean): string {
  if (days === 1) return DAY_TRIP;
  const equation = countEquation(days, everydayDays, returnOutfit);
  return equation ? `${equation} ${WORN_NOT_PACKED}` : NOTHING_LEFT;
}

/** True when a saved trip's stored count is not what today's rule gives (saved before #295): its sum would show wrong arithmetic. */
export function countedWithEarlierRule(trip: {
  days: number;
  dailyDays: number;
  config: { returnOutfit: boolean };
}): boolean {
  return trip.dailyDays !== dailyDaysFor(trip.days, trip.config.returnOutfit);
}
