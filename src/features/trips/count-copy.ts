// The plain-language words for the everyday count (design's final copy on #128). Pure text built from numbers the calculator
// already produces: it changes no count, and it stays correct whichever way the return-day decision (#25) goes.

import { RETURN_OFF_POLICY, type ReturnOffPolicy } from "@/domain/calc";

/** "1 day" / "5 days" with a number in front. */
const daysOf = (count: number, noun: string) => `${count} ${count === 1 ? "day" : "days"} ${noun}`;

/** The heading on the live card: "5 days of everyday clothes", "1 day of everyday clothes", or the zero case. */
export function everydayHeading(everydayDays: number): string {
  return everydayDays === 0
    ? "No everyday clothes to pack"
    : `${daysOf(everydayDays, "of everyday clothes")}`;
}

/** The three tiles: days away, the one outfit worn on the way there, and what is held back for the trip home. */
export function countTiles(
  days: number,
  everydayDays: number,
  returnOutfit: boolean,
  policy: ReturnOffPolicy = RETURN_OFF_POLICY,
): { value: number; label: string }[] {
  // Days held back for the way home: whatever is left after the worn day and the everyday days (never below 0).
  const home = Math.max(0, days - 1 - everydayDays);
  // "Set aside for the trip home": 1 with the return outfit on, 0 with it off (the return day is then an everyday day).
  // "Return day, not counted" belongs to the unused exclude-return-day variant only.
  const homeLabel =
    !returnOutfit && policy === "exclude-return-day"
      ? "Return day, not counted"
      : "Set aside for the trip home";
  return [
    { value: days, label: "Days away" },
    { value: 1, label: "Worn on the way there" },
    { value: home, label: homeLabel },
  ];
}

/** The sum on its own: "7 days away − 1 worn − 1 return day = 5 days of everyday clothes." (null when nothing is left to pack). */
export function countEquation(
  days: number,
  everydayDays: number,
  returnOutfit: boolean,
  policy: ReturnOffPolicy = RETURN_OFF_POLICY,
): string | null {
  if (everydayDays === 0) return null;
  const heldBack = returnOutfit
    ? " − 1 for home"
    : policy === "exclude-return-day"
      ? " − 1 return day"
      : "";
  return `${daysOf(days, "away")} − 1 worn${heldBack} = ${daysOf(everydayDays, "of everyday clothes")}.`;
}

/** The callout body after "How we count:". Three variants, plus the very short trip with no sum. */
export function countCallout(
  days: number,
  everydayDays: number,
  returnOutfit: boolean,
  policy: ReturnOffPolicy = RETURN_OFF_POLICY,
): string {
  const worn = "You wear one outfit on the way there, so it isn't packed.";
  const middle = returnOutfit
    ? "The trip home gets its own set, packed separately."
    : policy === "exclude-return-day"
      ? "With no separate return outfit, your return day isn't added to the count either."
      : "With no separate return outfit, your return day is packed like any other day.";
  const sum = countEquation(days, everydayDays, returnOutfit, policy);
  return `${worn} ${middle} ${sum ?? "That leaves no everyday clothes to pack."}`;
}

/** The trip screen's "Trip math" line: the sum, or the short-trip sentence. */
export function tripMathLine(
  days: number,
  everydayDays: number,
  returnOutfit: boolean,
  policy: ReturnOffPolicy = RETURN_OFF_POLICY,
): string {
  return (
    countEquation(days, everydayDays, returnOutfit, policy) ??
    "That leaves no everyday clothes to pack."
  );
}
