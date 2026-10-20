import { RETURN_OFF_POLICY, type ReturnOffPolicy } from "./return-policy";

export function dailyDaysFor(
  days: number,
  returnOutfit: boolean,
  policy: ReturnOffPolicy = RETURN_OFF_POLICY,
): number {
  const returnDayExcluded = returnOutfit || policy === "exclude-return-day";
  return Math.max(0, days - (returnDayExcluded ? 2 : 1));
}
