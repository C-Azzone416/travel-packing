import type { ThemeId } from "../themes";
import { hasUsableWeather, recommendPacking } from "../weather/recommend";
import type { DayWeather } from "../weather/types";
import { tripDays } from "./dates";
import { dailyDaysFor } from "./daily-days";

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

/** Weather for the trip (#110). Absent or empty: the calculator behaves exactly as before. */
export interface WeatherInput {
  days: readonly DayWeather[];
  /** Place names by stop index, used only to word the reasons. */
  stopNames?: readonly string[];
  theme?: ThemeId;
}

export interface Suggestion {
  id: string;
  name: string;
  category: string;
  qty: number;
  optional?: boolean;
  /** Set on weather-driven lines: the stable id, why it is suggested, and where it is filed. */
  semanticId?: string;
  reason?: string;
  groupId?: string;
  fromWeather?: boolean;
}

export interface Suggestions {
  days: number;
  dailyDays: number;
  items: Suggestion[];
}

export { RETURN_OFF_POLICY, type ReturnOffPolicy } from "./return-policy";

export { dailyDaysFor };

export function calculateSuggestions(config: CalcConfig, weather?: WeatherInput): Suggestions {
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

  if (weather && hasUsableWeather(weather.days, config)) {
    const { clothing, extras } = recommendPacking({
      days: weather.days,
      dayStopNames: weather.stopNames ?? [],
      config,
      theme: weather.theme,
    });
    const at = items.findIndex((item) => item.id === "tops");
    items.splice(at, 2, ...clothing.map((line) => ({ ...line, fromWeather: true })));
    for (const extra of extras) {
      items.push({
        id: extra.semanticId,
        semanticId: extra.semanticId,
        name: extra.name,
        category: extra.category,
        qty: extra.qty,
        optional: extra.optional,
        reason: extra.reason,
        fromWeather: true,
        ...(extra.groupId ? { groupId: extra.groupId } : {}),
      });
    }
  }

  return { days, dailyDays, items: items.filter((item) => item.qty > 0) };
}
