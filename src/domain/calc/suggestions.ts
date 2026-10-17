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

export function calculateSuggestions(config: CalcConfig): Suggestions {
  const days = tripDays(config.start, config.end);
  const dailyDays = Math.max(0, days - 2);
  const laundry = Boolean(config.laundry);
  const spare = config.spare ? 1 : 0;
  const niceCount = config.niceAttire ? Math.max(1, Number(config.occasionCount) || 1) : 0;
  const niceLooks = config.reuseNice ? Math.min(niceCount, 1) : niceCount;
  const everydayLooks = Math.max(0, dailyDays - niceCount);

  const items: Suggestion[] = [
    {
      id: "tops",
      name: "Everyday tops",
      category: "Clothes",
      qty: laundry ? Math.ceil(everydayLooks / 2) : everydayLooks,
    },
    {
      id: "bottoms",
      name: "Everyday bottoms",
      category: "Clothes",
      qty: everydayLooks ? Math.max(1, Math.ceil(everydayLooks / (laundry ? 4 : 2))) : 0,
    },
    { id: "underwear", name: "Underwear", category: "Clothes", qty: dailyDays + spare },
    { id: "socks", name: "Socks", category: "Clothes", qty: dailyDays + spare },
    { id: "sleepwear", name: "Sleepwear", category: "Clothes", qty: days > 1 ? 1 : 0 },
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
