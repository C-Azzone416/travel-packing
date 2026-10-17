// Test doubles for the #4 calculator, mirroring reference/prototype/dist/core.js.
// Fixtures only: excluded from coverage (see vitest.config.ts), never imported by shipped code.

import type { SuggestFn } from "../trip";

export const suggest: SuggestFn = (input) => {
  const days = Math.max(
    0,
    Math.round((Date.parse(input.end) - Date.parse(input.start)) / 86400000) + 1,
  );
  const dailyDays = Math.max(0, days - 2);
  const spare = input.spare ? 1 : 0;
  const niceCount = input.niceAttire ? Math.max(1, input.occasionCount) : 0;
  const niceLooks = input.reuseNice ? Math.min(niceCount, 1) : niceCount;
  const everydayLooks = Math.max(0, dailyDays - niceCount);
  const items = [
    {
      id: "tops",
      name: "Everyday tops",
      category: "Clothes",
      qty: input.laundry ? Math.ceil(everydayLooks / 2) : everydayLooks,
    },
    {
      id: "bottoms",
      name: "Everyday bottoms",
      category: "Clothes",
      qty: everydayLooks ? Math.max(1, Math.ceil(everydayLooks / (input.laundry ? 4 : 2))) : 0,
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
  return { days, dailyDays, items: items.filter((entry) => entry.qty > 0) };
};

const MS_PER_DAY = 86400000;

export function normalizeDates(
  start: string,
  end: string,
): { start: string; end: string; valid: boolean } {
  const from = Date.parse(start);
  if (Number.isNaN(from)) return { start, end, valid: false };
  const to = Date.parse(end);
  if (Number.isNaN(to) || to < from) return { start, end: start, valid: true };
  return { start, end, valid: true };
}

export function forecastLabel(start: string, today: string): string {
  const distance = Math.ceil((Date.parse(start) - Date.parse(today)) / MS_PER_DAY);
  return distance >= 0 && distance <= 10 ? "Close forecast" : "Seasonal outlook";
}
