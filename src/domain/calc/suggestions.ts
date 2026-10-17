import { tripDays } from "./dates";

export interface CalcConfig {
  start: string;
  end: string;
  laundry?: boolean;
  spare?: boolean;
  niceAttire?: boolean;
  occasionCount?: number | string | null;
  reuseNice?: boolean;
  returnOutfit?: boolean;
}

export interface Suggestion {
  id: string;
  name: string;
  category: string;
  qty: number;
  optional?: boolean;
}

export interface Suggestions {
  days: number;
  dailyDays: number;
  items: Suggestion[];
}

// What turning the dedicated return outfit off means for everyday quantities.
// Current prototype behavior is "exclude-return-day": the return day is never
// counted, even with no return outfit. The alternative adds that day back.
// TODO(#25): decide, then change RETURN_OFF_POLICY (the only switch point).
export type ReturnOffPolicy = "exclude-return-day" | "add-return-day-back";
export const RETURN_OFF_POLICY: ReturnOffPolicy = "exclude-return-day";

export function dailyDaysFor(
  days: number,
  returnOutfit: boolean,
  policy: ReturnOffPolicy = RETURN_OFF_POLICY,
): number {
  const returnDayExcluded = returnOutfit || policy === "exclude-return-day";
  return Math.max(0, days - (returnDayExcluded ? 2 : 1));
}

export function calculateSuggestions(config: CalcConfig): Suggestions {
  const days = tripDays(config.start, config.end);
  const dailyDays = dailyDaysFor(days, config.returnOutfit !== false);
  const laundry = Boolean(config.laundry);
  const spare = config.spare ? 1 : 0;
  const niceCount = config.niceAttire ? Math.max(1, Number(config.occasionCount) || 1) : 0;
  const niceLooks = config.reuseNice ? Math.min(niceCount, 1) : niceCount;
  const everydayLooks = Math.max(0, dailyDays - niceCount);

  const items: Suggestion[] = [
    {
      id: "tops",
      name: "Everyday tops",
      category: "Clothing",
      qty: laundry ? Math.ceil(everydayLooks / 2) : everydayLooks,
    },
    {
      id: "bottoms",
      name: "Everyday bottoms",
      category: "Clothing",
      qty: everydayLooks ? Math.max(1, Math.ceil(everydayLooks / (laundry ? 4 : 2))) : 0,
    },
    { id: "underwear", name: "Underwear", category: "Clothing", qty: dailyDays + spare },
    { id: "socks", name: "Socks", category: "Clothing", qty: dailyDays + spare },
    { id: "sleepwear", name: "Sleepwear", category: "Clothing", qty: days > 1 ? 1 : 0 },
    { id: "nice-top", name: "Nice-attire top", category: "Nice attire", qty: niceLooks },
    { id: "nice-bottom", name: "Nice-attire bottom", category: "Nice attire", qty: niceLooks },
    {
      id: "nice-shoes",
      name: "Dress shoes",
      category: "Nice attire",
      qty: niceCount ? 1 : 0,
      optional: true,
    },
    {
      id: "nice-makeup",
      name: "Makeup",
      category: "Bathroom",
      qty: niceCount ? 1 : 0,
      optional: true,
    },
    {
      id: "nice-undergarments",
      name: "Dress-specific undergarments",
      category: "Nice attire",
      qty: niceCount ? 1 : 0,
      optional: true,
    },
  ];

  return { days, dailyDays, items: items.filter((item) => item.qty > 0) };
}
