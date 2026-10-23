import { parseDate } from "../calc/dates";
import { dailyDaysFor } from "../calc/daily-days";
import { RETURN_OFF_POLICY, type ReturnOffPolicy } from "../calc/return-policy";
import type { CalcConfig, Suggestion } from "../calc/suggestions";
import type { ThemeId } from "../themes";
import { TOILETRY_GROUP_ID } from "../toiletry-bag";
import type { DayWeather } from "./types";

// Every threshold the engine uses lives here so design can tune it in one place (epic #107 §3).
export const WEATHER_RULES = {
  /** Clothing bands, by the day's high in °C. */
  hotFromC: 27,
  warmFromC: 21,
  coolFromC: 13,
  /** Warm days wear shorts from here up, pants below. */
  shortsFromC: 24,
  /** Layers, by the trip's coldest low / high. */
  lightLayerBelowLowC: 15,
  warmCoatBelowLowC: 5,
  warmCoatBelowHighC: 10,
  coldAccessoriesBelowLowC: 0,
  /** Rain. */
  rainProbability: 0.4,
  rainDaysForJacket: 2,
  heavyRainMm: 10,
  /** Waterproof boots: a real snow day (a typical-data average turns one flake into a fraction). */
  snowBootsCm: 1,
  /** Sun. */
  sunscreenUv: 3,
  sunscreenHighC: 21,
  sunscreenSunshineHours: 6,
  sunHatUv: 8,
  swimsuitHighC: 27,
  /** Themes that always want sunscreen. */
  sunscreenThemes: ["beach", "outdoors", "theme_park"] as readonly ThemeId[],
} as const;

export type ClothingBand = "hot" | "warm" | "cool" | "cold";

export interface WeatherSuggestion {
  semanticId: string;
  name: string;
  category: string;
  qty: number;
  optional: boolean;
  /** "Rain likely in Lisbon, Oct 3–5". */
  reason: string;
  /** One or two words for the item's weather pill: "Rain", "Cold". */
  tag: string;
  /** Which branch of the rule fired; never raw weather. Changes when the recommendation changes. */
  ruleSignature: string;
  groupId?: string;
}

export interface WeatherRecommendation {
  clothing: Suggestion[];
  extras: WeatherSuggestion[];
}

const EXTRA_TAGS: Readonly<Record<string, string>> = {
  "layer-light": "Cool nights",
  "layer-warm": "Cold",
  "cold-accessories": "Freezing",
  "weather-umbrella": "Rain",
  "weather-rain-jacket": "Rain",
  "weather-swimsuit": "Hot",
  "weather-sunscreen": "Sun",
  "weather-sun-hat": "Sun",
  "weather-snow-boots": "Snow",
};

export type RangeFormatter = (startDate: string, endDate: string) => string;

export interface RecommendInput {
  /** One entry per trip day that has weather, in any order. Missing days count as cool. */
  days: readonly DayWeather[];
  /** Place names by stop index. Used only to word reasons. */
  dayStopNames: readonly string[];
  config: CalcConfig;
  theme?: ThemeId;
  returnPolicy?: ReturnOffPolicy;
  /** Injectable so copy and tests do not depend on locale. */
  formatRange?: RangeFormatter;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function monthDay(date: string): { month: string; day: number } {
  const parsed = parseDate(date);
  return parsed
    ? { month: MONTHS[parsed.getUTCMonth()], day: parsed.getUTCDate() }
    : { month: "", day: 0 };
}

/** "Oct 3", "Oct 3–5", "Oct 30–Nov 2". */
export const defaultFormatRange: RangeFormatter = (start, end) => {
  const from = monthDay(start);
  const to = monthDay(end);
  if (start === end) return `${from.month} ${from.day}`;
  if (from.month === to.month) return `${from.month} ${from.day}–${to.day}`;
  return `${from.month} ${from.day}–${to.month} ${to.day}`;
};

export function classifyDay(highC: number): ClothingBand {
  if (highC >= WEATHER_RULES.hotFromC) return "hot";
  if (highC >= WEATHER_RULES.warmFromC) return "warm";
  if (highC >= WEATHER_RULES.coolFromC) return "cool";
  return "cold";
}

type Look = "short-shorts" | "short-pants" | "long-pants";
const LOOKS: readonly Look[] = ["short-shorts", "short-pants", "long-pants"];

/** The look for a day's high; a day with no weather is cool, the conservative choice. */
export function lookFor(highC: number | null): Look {
  if (highC === null) return "long-pants";
  const band = classifyDay(highC);
  if (band === "hot") return "short-shorts";
  if (band === "warm") return highC >= WEATHER_RULES.shortsFromC ? "short-shorts" : "short-pants";
  return "long-pants";
}

/** Splits `total` across `weights` so the parts sum to `total`; ties go to the earlier entry. */
export function allocateLargestRemainder(total: number, weights: readonly number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum === 0 || total <= 0) return weights.map(() => 0);
  const exact = weights.map((weight) => (weight * total) / sum);
  const parts = exact.map(Math.floor);
  let left = total - parts.reduce((a, b) => a + b, 0);
  const order = exact
    .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (const { index } of order) {
    if (left <= 0) break;
    parts[index] += 1;
    left -= 1;
  }
  return parts;
}

function addDays(date: string, count: number): string {
  const parsed = parseDate(date) as Date;
  return new Date(parsed.getTime() + count * 86_400_000).toISOString().slice(0, 10);
}

function tripDates(start: string, end: string): string[] {
  const from = parseDate(start);
  const to = parseDate(end);
  if (!from || !to || to < from) return [];
  const dates: string[] = [];
  for (let date = start; date <= end; date = addDays(date, 1)) dates.push(date);
  return dates;
}

/** The trip's weather days, limited to the trip's own dates and sorted. */
function tripWeather(days: readonly DayWeather[], dates: readonly string[]): DayWeather[] {
  const inTrip = new Set(dates);
  return days.filter((day) => inTrip.has(day.date)).sort((a, b) => a.date.localeCompare(b.date));
}

export function hasUsableWeather(days: readonly DayWeather[], config: CalcConfig): boolean {
  return tripWeather(days, tripDates(config.start, config.end)).length > 0;
}

const MAX_PLACES = 2;

function capped(entries: readonly string[]): string {
  const shown = entries.slice(0, MAX_PLACES).join(" and ");
  return entries.length > MAX_PLACES ? `${shown} and more` : shown;
}

function byStop(matching: readonly DayWeather[]): [number, DayWeather[]][] {
  const groups = new Map<number, DayWeather[]>();
  for (const day of matching)
    groups.set(day.stopIndex, [...(groups.get(day.stopIndex) ?? []), day]);
  return [...groups].sort(([a], [b]) => a - b);
}

/** True when every matching day is a multi-year average, so the wording must not promise a forecast. */
function isTypical(matching: readonly DayWeather[]): boolean {
  return matching.length > 0 && matching.every((day) => day.source === "typical");
}

/** " in Lisbon, Oct 3–5 and Porto, Oct 8" (two places at most, then "and more"). */
function placesWithDates(
  matching: readonly DayWeather[],
  names: readonly string[],
  formatRange: RangeFormatter,
): string {
  const entries = byStop(matching).map(([index, days]) => {
    const dates = days.map((day) => day.date).sort();
    const range = formatRange(dates[0], dates[dates.length - 1]);
    return names[index] ? `${names[index]}, ${range}` : range;
  });
  const anyNamed = byStop(matching).some(([index]) => names[index]);
  return `${anyNamed ? " in " : ", "}${capped(entries)}`;
}

/** " in Lisbon and Porto"; empty when no stop has a name. */
function placeNames(matching: readonly DayWeather[], names: readonly string[]): string {
  const named = byStop(matching)
    .map(([index]) => names[index])
    .filter(Boolean);
  return named.length ? ` in ${capped(named)}` : "";
}

const BAND_ORDER: readonly ClothingBand[] = ["hot", "warm", "cool", "cold"];

/**
 * "Mostly warm days", and, only when the garment's days span another band, "; 3 cool days in Porto" for the next most
 * common band (design #108 §7.4). One band says it once; it never repeats itself.
 */
function clothingReason(matching: readonly DayWeather[], names: readonly string[]): string {
  if (matching.length === 0) return "Mostly cool days";
  const counts = BAND_ORDER.map(
    (band) => matching.filter((day) => classifyDay(day.highC) === band).length,
  );
  const mostly = BAND_ORDER[counts.indexOf(Math.max(...counts))];
  let reason = `Mostly ${mostly} days`;
  const others = BAND_ORDER.map((band, at) => ({ band, count: counts[at] })).filter(
    (entry) => entry.band !== mostly && entry.count > 0,
  );
  if (others.length === 0) return reason;
  const other = others.reduce((best, entry) => (entry.count > best.count ? entry : best));
  const inBand = matching.filter((day) => classifyDay(day.highC) === other.band);
  const [index, days] = byStop(inBand).sort(([, a], [, b]) => b.length - a.length)[0];
  const city = names[index] ? ` in ${names[index]}` : "";
  reason += `; ${days.length} ${other.band} days${city}`;
  return reason;
}

export function legacyClothing(everydayLooks: number, laundry: boolean): Suggestion[] {
  return [
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
  ];
}

function bottomsFor(looks: number, laundry: boolean): number {
  return looks ? Math.max(1, Math.ceil(looks / (laundry ? 4 : 2))) : 0;
}

export function recommendPacking(input: RecommendInput): WeatherRecommendation {
  const { config } = input;
  const formatRange = input.formatRange ?? defaultFormatRange;
  const policy = input.returnPolicy ?? RETURN_OFF_POLICY;
  const dates = tripDates(config.start, config.end);
  const weather = tripWeather(input.days, dates);
  const laundry = Boolean(config.laundry);

  const returnOutfit = config.returnOutfit !== false;
  const dailyDays = dailyDaysFor(dates.length, returnOutfit, policy);
  // Nice occasions are in addition to everyday outfits (#205), so they do not reduce the everyday looks.
  const everydayLooks = dailyDays;

  if (weather.length === 0) return { clothing: legacyClothing(everydayLooks, laundry), extras: [] };

  const byDate = new Map(weather.map((day) => [day.date, day]));
  const returnDayExcluded = returnOutfit || policy === "exclude-return-day";
  const dailyDates = dates.slice(1, dates.length - (returnDayExcluded ? 1 : 0));
  const counts = LOOKS.map(
    (look) => dailyDates.filter((date) => lookFor(byDate.get(date)?.highC ?? null) === look).length,
  );
  const [shortShorts, shortPants, longPants] = allocateLargestRemainder(everydayLooks, counts);

  const daysOf = (look: Look) =>
    weather.filter((day) => dailyDates.includes(day.date) && lookFor(day.highC) === look);
  const shortTops = shortShorts + shortPants;
  const shorts = shortShorts;
  const pants = shortPants + longPants;

  const clothing: Suggestion[] = [];
  const addClothing = (id: string, name: string, qty: number, matching: DayWeather[]) => {
    if (qty <= 0) return;
    clothing.push({
      id,
      name,
      category: "Clothing",
      qty,
      semanticId: id,
      reason: clothingReason(matching, input.dayStopNames),
      tag: id === "tops-short" || id === "bottoms-shorts" ? "Warm" : "Cool",
    });
  };
  const hotDays = daysOf("short-shorts");
  const shortSleeveDays = [...hotDays, ...daysOf("short-pants")];
  const pantsDays = [...daysOf("short-pants"), ...daysOf("long-pants")];
  addClothing(
    "tops-short",
    "Short-sleeve tops",
    laundry ? Math.ceil(shortTops / 2) : shortTops,
    shortSleeveDays,
  );
  addClothing(
    "tops-long",
    "Long-sleeve tops",
    laundry ? Math.ceil(longPants / 2) : longPants,
    daysOf("long-pants"),
  );
  addClothing("bottoms-shorts", "Shorts", bottomsFor(shorts, laundry), hotDays);
  addClothing("bottoms-pants", "Pants", bottomsFor(pants, laundry), pantsDays);

  return { clothing, extras: conditionalExtras(weather, input, formatRange) };
}

function conditionalExtras(
  weather: readonly DayWeather[],
  input: RecommendInput,
  formatRange: RangeFormatter,
): WeatherSuggestion[] {
  const rules = WEATHER_RULES;
  const theme = input.theme;
  const names = input.dayStopNames;
  const dated = (matching: readonly DayWeather[]) => placesWithDates(matching, names, formatRange);
  const where = (matching: readonly DayWeather[]) => placeNames(matching, names);
  const extras: WeatherSuggestion[] = [];
  const add = (
    semanticId: string,
    name: string,
    category: string,
    optional: boolean,
    reason: string,
    ruleSignature: string,
    groupId?: string,
  ) => {
    extras.push({
      semanticId,
      name,
      category,
      qty: 1,
      optional,
      reason,
      tag: EXTRA_TAGS[semanticId] ?? "Weather",
      ruleSignature,
      ...(groupId ? { groupId } : {}),
    });
  };

  const light = weather.filter((day) => day.lowC < rules.lightLayerBelowLowC);
  if (light.length) {
    add(
      "layer-light",
      "Light jacket or sweater",
      "Clothing",
      false,
      `${isTypical(light) ? "Often cold at night" : "Cold nights"}${where(light)}`,
      "low",
    );
  }
  const cold = weather.filter(
    (day) => day.lowC < rules.warmCoatBelowLowC || day.highC < rules.warmCoatBelowHighC,
  );
  if (cold.length) {
    add(
      "layer-warm",
      "Warm coat",
      "Clothing",
      false,
      `${isTypical(cold) ? "Often cold at night" : "Cold nights"}${where(cold)}`,
      "cold",
    );
  }
  const freezing = weather.filter((day) => day.lowC < rules.coldAccessoriesBelowLowC);
  if (freezing.length) {
    add(
      "cold-accessories",
      "Hat and gloves",
      "Clothing",
      true,
      `${isTypical(freezing) ? "Often cold at night" : "Cold nights"}${where(freezing)}`,
      "freezing",
    );
  }

  const wet = weather.filter((day) => day.precipProbability >= rules.rainProbability);
  if (wet.length) {
    add(
      "weather-umbrella",
      "Compact umbrella",
      "Accessories",
      false,
      `${isTypical(wet) ? "Often rainy" : "Rain likely"}${dated(wet)}`,
      "rain",
    );
  }
  const downpour = weather.filter((day) => day.precipMm >= rules.heavyRainMm);
  const manyWet = wet.length >= rules.rainDaysForJacket;
  if (manyWet || downpour.length) {
    const matching = [...new Set([...(manyWet ? wet : []), ...downpour])];
    add(
      "weather-rain-jacket",
      "Rain jacket",
      "Clothing",
      false,
      `${isTypical(matching) ? "Rain on about" : "Rain on"} ${matching.length} ${matching.length === 1 ? "day" : "days"}${dated(matching)}`,
      [manyWet ? "days" : "", downpour.length ? "heavy" : ""].filter(Boolean).join("+"),
    );
  }

  const beach = theme === "beach";
  const hot = weather.filter((day) => day.highC >= rules.swimsuitHighC);
  if (beach || hot.length) {
    add(
      "weather-swimsuit",
      "Swimsuit",
      "Clothing",
      !beach,
      hot.length ? `${isTypical(hot) ? "Often hot" : "Hot days"}${dated(hot)}` : "Beach trip",
      [beach ? "beach" : "", hot.length ? "hot" : ""].filter(Boolean).join("+"),
    );
  }

  const uv = weather.filter(
    (day) => day.uvIndexMax !== null && day.uvIndexMax >= rules.sunscreenUv,
  );
  const bright = weather.filter(
    (day) =>
      day.uvIndexMax === null &&
      day.highC >= rules.sunscreenHighC &&
      (day.sunshineHours ?? 0) >= rules.sunscreenSunshineHours,
  );
  const sunny = [...uv, ...bright];
  const strongSun = weather.filter(
    (day) => day.uvIndexMax !== null && day.uvIndexMax >= rules.sunHatUv,
  );
  const themed = theme !== undefined && rules.sunscreenThemes.includes(theme);
  if (sunny.length || themed) {
    add(
      "weather-sunscreen",
      "Sunscreen",
      "Bathroom",
      false,
      strongSun.length
        ? `Strong sun${dated(strongSun)}`
        : sunny.length
          ? `Sunny days${where(sunny)}`
          : "Outdoor trip",
      [uv.length ? "uv" : "", bright.length ? "sun" : "", themed ? "theme" : ""]
        .filter(Boolean)
        .join("+"),
      TOILETRY_GROUP_ID,
    );
  }

  if (strongSun.length || beach) {
    add(
      "weather-sun-hat",
      "Sun hat",
      "Accessories",
      true,
      strongSun.length ? `Strong sun${dated(strongSun)}` : "Beach trip",
      [strongSun.length ? "uv" : "", beach ? "beach" : ""].filter(Boolean).join("+"),
    );
  }

  const snow = weather.filter((day) => day.snowCm >= rules.snowBootsCm);
  if (snow.length) {
    add(
      "weather-snow-boots",
      "Waterproof boots",
      "Accessories",
      true,
      isTypical(snow) ? `Snow is common${where(snow)} at this time` : `Snow expected${dated(snow)}`,
      "snow",
    );
  }

  return extras;
}
