// Pure logic for the Plan a trip screen (#390): the five steps, what blocks each one, the summaries a finished step
// shows, and the live preview. The preview is not a second calculation: it builds the trip with the SAME functions the
// server uses to create one (`saveDraft` with the owner's Staples, then the accepted weather changes), so the count it
// shows is the count the created trip has. No React, no clock: `today` is passed in.

import { calculateSuggestions, normalizeTripDates, parseDate } from "@/domain/calc";
import { CUBE_LABELS, CUBES, itemCube, weatherCubeLabel, type Cube } from "@/domain/cubes";
import { packedTotals } from "@/domain/readiness";
import { tripItemsFromList } from "@/domain/saved-lists";
import type { Staple, TripConfig, TripItem } from "@/domain/trip";
import { DEFAULT_THEME, type ThemeId } from "@/domain/themes";
import {
  beginDraft,
  draftStops,
  emptyLifecycleState,
  saveDraft,
  setDraftSavedList,
  type DraftStop,
  type LifecycleTrip,
  type SampleLocation,
  type TripDraft,
} from "@/domain/trip-lifecycle";
import {
  distinctCities,
  joinCities,
  nightsText,
  TRAVEL_MODE_LABEL,
  type TravelMode,
} from "@/domain/trip-route";
import { daysBetween, type TripStop } from "@/domain/trip-stops";
import { applyWeatherChanges, type WeatherAppliedChange } from "@/domain/weather/apply";
import { diffRecommendations, type WeatherChange } from "@/domain/weather/diff";
import { recommendPacking, type WeatherRecommendation } from "@/domain/weather/recommend";
import type { StopWeather } from "@/domain/weather/types";
import type { SavedListDetail } from "@/server/data/service";
import type { AcceptedWeatherDecision } from "@/features/trips/trip-actions";
import { DEFAULT_TRIP_CONFIG } from "@/features/trips/draft";
import { fixSummary, moveStop, stopProblems } from "@/features/trips/stops-draft";
import { toSuggestions } from "@/features/trip/packing/packing-model";
import {
  displayTemperature,
  rainLine,
  weatherRowView,
  type Glyph,
} from "@/features/trip/weather-view";
import type { TemperatureUnit } from "@/server/data/weather-store";

export const STEP_IDS = ["where", "when", "how", "list", "review"] as const;
export type StepId = (typeof STEP_IDS)[number];

export const STEP_TITLES: Readonly<Record<StepId, string>> = {
  where: "Where",
  when: "When",
  how: "How",
  list: "Starting list",
  review: "Review",
};

export const MODE_CHOICES: readonly { mode: TravelMode; label: string; summary: string }[] = [
  { mode: "fly", label: TRAVEL_MODE_LABEL.fly, summary: "Flying" },
  { mode: "drive", label: TRAVEL_MODE_LABEL.drive, summary: "Driving" },
  { mode: "other", label: TRAVEL_MODE_LABEL.other, summary: "Train or other" },
];

export const COPY_DATE_NOTICE = "Choose a new start date for the copy.";

// ------------------------------------------------------------------ blockers

/** Why Where cannot be finished, in words, or null. Every stop needs a confirmed place. */
export function whereBlocker(draft: TripDraft): string | null {
  const stops = draftStops(draft);
  if (stops.every((stop) => stop.location)) return null;
  return stops.length > 1
    ? "Choose a place for each stop to continue."
    : "Choose a destination from the list to continue.";
}

/** Why When cannot be finished, or null. `staleCopy`: a copied route still on the source trip's dates. */
export function whenBlocker(draft: TripDraft, staleCopy = false): string | null {
  if (staleCopy) return COPY_DATE_NOTICE;
  const stops = draftStops(draft);
  if (stops.length > 1) {
    const problems = stopProblems(stops).filter((problem) => problem.field !== "place");
    return problems.length ? fixSummary(problems.length) : null;
  }
  if (!draft.start || !draft.end || !normalizeTripDates(draft.start, draft.end).valid) {
    return "Choose your departure and return dates to continue.";
  }
  return null;
}

/** Why How cannot be finished, or null. */
export function howBlocker(draft: TripDraft): string | null {
  return draft.travelMode ? null : "Choose how you’re getting there to continue.";
}

/** Why a step cannot be finished. The Starting list and Review always can (they only choose). */
export function stepBlocker(draft: TripDraft, step: StepId, staleCopy = false): string | null {
  if (step === "where") return whereBlocker(draft);
  if (step === "when") return whenBlocker(draft, staleCopy);
  if (step === "how") return howBlocker(draft);
  return null;
}

// ------------------------------------------------------------------ summaries

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const month = (date: Date) => MONTHS[date.getUTCMonth()];
const weekdayDay = (date: Date) => `${WEEKDAYS[date.getUTCDay()]} ${date.getUTCDate()}`;

/** "Sat 14 – Tue 24 Mar" (one month) or "Sat 28 Mar – Tue 7 Apr"; blank when a date is missing. */
export function formatPlanRange(start: string, end: string): string {
  const from = parseDate(start);
  const to = parseDate(end);
  if (!from || !to) return "";
  // A day trip has one date (#412): "Sat 14 Mar", never "Sat 14 – Sat 14 Mar".
  if (start === end) return `${weekdayDay(from)} ${month(from)}`;
  const left = month(from) === month(to) ? weekdayDay(from) : `${weekdayDay(from)} ${month(from)}`;
  return `${left} – ${weekdayDay(to)} ${month(to)}`;
}

/** "15–18 Mar" for a stop's row; blank until both dates are real. */
export function stopRange(stop: Pick<DraftStop, "arrive" | "leave">): string {
  const from = parseDate(stop.arrive);
  const to = parseDate(stop.leave);
  if (!from || !to) return "";
  const day = (date: Date) => String(date.getUTCDate());
  // One date for a day trip (#412).
  if (stop.arrive === stop.leave) return `${day(from)} ${month(from)}`;
  return month(from) === month(to)
    ? `${day(from)}–${day(to)} ${month(to)}`
    : `${day(from)} ${month(from)} – ${day(to)} ${month(to)}`;
}

export function placesOf(draft: TripDraft): SampleLocation[] {
  return draftStops(draft)
    .map((stop) => stop.location)
    .filter((location): location is SampleLocation => Boolean(location));
}

/** "Lisbon + Porto" (the Where summary). */
export function whereSummary(draft: TripDraft): string {
  return placesOf(draft)
    .map((place) => place.city)
    .join(" + ");
}

/** Trip nights from the draft, or null while the dates are not real. */
export function nightsOf(draft: TripDraft): number | null {
  if (!parseDate(draft.start) || !parseDate(draft.end)) return null;
  return daysBetween(draft.start, draft.end);
}

/** "Sat 14 – Tue 24 Mar · 10 nights". */
export function whenSummary(draft: TripDraft): string {
  const range = formatPlanRange(draft.start, draft.end);
  const nights = nightsOf(draft);
  return range && nights !== null ? `${range} · ${nightsText(nights)}` : "";
}

export function howSummary(draft: TripDraft): string {
  return MODE_CHOICES.find((choice) => choice.mode === draft.travelMode)?.summary ?? "";
}

/** The trip's days (travel days included), or 0 while the dates are not real. */
export function tripLength(draft: TripDraft): number {
  const nights = nightsOf(draft);
  return nights === null ? 0 : nights + 1;
}

/** The name the tag shows: the first place, then "& Porto" (the rest). Blank-safe. */
export function tagTitle(draft: TripDraft): { title: string; also: string } {
  const cities = distinctCities(
    placesOf(draft).map((location) => ({ location, arrive: "", leave: "" })),
  );
  const named = (draft.name ?? "").trim();
  if (named) return { title: named, also: "" };
  const [first = "", ...rest] = cities;
  return { title: first, also: rest.length ? `& ${joinCities(rest)}` : "" };
}

// ------------------------------------------------------------------ the preview

/** The stops with a confirmed place, as the weather and the map read them. */
export function confirmedStops(draft: TripDraft): TripStop[] {
  return draftStops(draft)
    .filter((stop): stop is DraftStop & { location: SampleLocation } => Boolean(stop.location))
    .map((stop) => ({ location: stop.location, arrive: stop.arrive, leave: stop.leave }));
}

export interface PlanPreview {
  /** Every item the created trip will start with, quantity-counted. */
  items: TripItem[];
  /** Items to start: the sum of quantities (counts are quantity everywhere, decision on #376). */
  total: number;
  /** The cubes that have something in them, in cube order, with their names and quantities. */
  cubes: { cube: Cube; label: string; count: number }[];
}

export interface PreviewInput {
  draft: TripDraft;
  staples: readonly Staple[];
  /** The saved list this trip starts from (replaces Staples and recommendations). */
  list?: SavedListDetail | null;
  /** The weather changes the person kept (empty without weather). */
  accepted?: readonly WeatherAppliedChange[];
  today: string;
}

/**
 * The trip the person is about to create, built the way the server builds it, or null while Where or When is not finished.
 * The owner's Staples and the draft are all it needs; nothing is persisted.
 */
export function previewTrip({
  draft,
  staples,
  list,
  accepted = [],
  today,
}: PreviewInput): PlanPreview | null {
  if (whereBlocker(draft) || whenBlocker(draft)) return null;
  let counter = 0;
  const saved = saveDraft(
    beginDraft(emptyLifecycleState(), list ? draft : { ...draft, savedListId: null }),
    [...staples],
    { newId: () => `preview-${++counter}`, today },
    list ? tripItemsFromList(list) : undefined,
  );
  if (!saved.ok) return null;
  const trip = list ? saved.trip : applyWeatherChanges(saved.trip, accepted);
  // The same quantity total the packing screen counts against (#456); the toiletry bag is not an item.
  return { ...summarizeItems(trip.items), total: packedTotals(trip).total };
}

/** Group items into the cubes they live in. */
export function summarizeItems(items: readonly TripItem[]): PlanPreview {
  const counts = new Map<Cube, TripItem[]>();
  for (const item of items) {
    const cube = itemCube(item);
    counts.set(cube, [...(counts.get(cube) ?? []), item]);
  }
  const quantity = (list: readonly TripItem[]) => list.reduce((sum, item) => sum + item.qty, 0);
  const cubes = CUBES.filter((cube) => counts.has(cube)).map((cube) => {
    const inCube = counts.get(cube) as TripItem[];
    return {
      cube,
      label:
        cube === "weather" ? weatherCubeLabel(inCube.map((item) => item.id)) : CUBE_LABELS[cube],
      count: quantity(inCube),
    };
  });
  return { items: [...items], total: quantity(items), cubes };
}

/** "About 60 items to start". */
export function aboutItems(total: number): string {
  return `About ${total} ${total === 1 ? "item" : "items"} to start`;
}

/** "About 60 items sorted into 6 cubes. You can edit everything after." as its two parts (the count is bold). */
export function sortedLine(preview: PlanPreview): { bold: string; rest: string } {
  const cubes = preview.cubes.length;
  return {
    bold: `About ${preview.total} ${preview.total === 1 ? "item" : "items"}`,
    rest: ` sorted into ${cubes} ${cubes === 1 ? "cube" : "cubes"}. You can edit everything after.`,
  };
}

// ------------------------------------------------------------------ laundry

export interface LaundryEffect {
  /** The Staple the saving shows on: the one that saves the most. */
  name: string;
  /** What it is with laundry on, and with laundry off. */
  on: number;
  off: number;
}

/**
 * What laundry changes on this trip: the Staple row that gets smallest, as the real build computes it. Null when nothing
 * on the Staples is marked ↻ (laundry then changes nothing).
 */
export function laundryEffect(
  draft: TripDraft,
  staples: readonly Staple[],
  today: string,
  /** The chosen saved list: it stands in for the Staples, so the effect is judged on ITS rows (#412). */
  list?: PreviewInput["list"],
): LaundryEffect | null {
  const quantities = (laundry: boolean) => {
    const built = previewTrip({
      draft: {
        ...draft,
        config: { ...draft.config, laundry },
        ...(list ? {} : { savedListId: null }),
      },
      staples,
      list,
      today,
    });
    return new Map((built?.items ?? []).map((item) => [item.id, item]));
  };
  const on = quantities(true);
  const off = quantities(false);
  let best: LaundryEffect | null = null;
  for (const [id, item] of off) {
    const after = on.get(id);
    if (!after || after.qty >= item.qty) continue;
    if (!best || item.qty - after.qty > best.off - best.on) {
      best = { name: item.name, on: after.qty, off: item.qty };
    }
  }
  return best;
}

/** The line under "I’ll have laundry". */
export function laundryLine(effect: LaundryEffect | null, laundry: boolean): string {
  if (!effect) return "Nothing on your Staples is marked ↻, so laundry changes nothing yet.";
  const never = "Underwear and socks stay one per day.";
  return laundry
    ? `${effect.name}: ${effect.on} instead of ${effect.off}. ${never}`
    : `${effect.name} would be ${effect.on} instead of ${effect.off}. ${never}`;
}

// ------------------------------------------------------------------ weather

export function recommendationForDraft(
  draft: TripDraft,
  stops: StopWeather[],
  route: readonly TripStop[],
  compatibilityTheme: ThemeId = DEFAULT_THEME,
): WeatherRecommendation {
  return recommendPacking({
    days: stops.flatMap((stop) => stop.days),
    dayStopNames: route.map((stop) => stop.location.city),
    config: { ...draft.config, start: draft.start, end: draft.end },
    theme: compatibilityTheme,
  });
}

/** A draft has no saved weather lines yet, so a review of it never proposes a removal. */
export function acceptedDecision(
  change: Exclude<WeatherChange, { kind: "remove" }>,
): AcceptedWeatherDecision {
  if (change.kind === "add") {
    const { semanticId, name, category, qty, optional, groupId } = change.item;
    return {
      kind: "add",
      semanticId: change.semanticId,
      ruleSignature: change.ruleSignature,
      item: { semanticId, name, category, qty, optional, ...(groupId ? { groupId } : {}) },
    };
  }
  return {
    kind: "split",
    semanticId: change.semanticId,
    ruleSignature: change.ruleSignature,
    clothing: change.clothing,
  };
}

export interface WeatherAdds {
  /** What goes to the server with the trip when the card is kept. */
  accepted: AcceptedWeatherDecision[];
  /** Items the kept weather adds (after the split of clothing, the difference in the count). */
  added: number;
  /** "Rain gear · 2 added", or a "nothing needed" line. */
  line: string;
}

/**
 * The weather changes for this draft, by the same recommendation and diff the old create flow used. `added` is what the
 * created trip really gains: the preview with them minus the preview without.
 */
export function weatherAdds(
  draft: TripDraft,
  stops: StopWeather[],
  staples: readonly Staple[],
  today: string,
  compatibilityTheme: ThemeId = DEFAULT_THEME,
): WeatherAdds {
  const route = confirmedStops(draft);
  const recommendation = recommendationForDraft(draft, stops, route, compatibilityTheme);
  const baseline = calculateSuggestions({
    ...draft.config,
    start: draft.start,
    end: draft.end,
  }).items;
  const changes = diffRecommendations(baseline, recommendation).filter(
    (change): change is Exclude<WeatherChange, { kind: "remove" }> => change.kind !== "remove",
  );
  const accepted = changes.map(acceptedDecision);
  const without = previewTrip({ draft, staples, today });
  const withIt = previewTrip({ draft, staples, accepted, today });
  const added = (withIt?.total ?? 0) - (without?.total ?? 0);
  const rows = toSuggestions(
    changes,
    route.map((stop) => stop.location.city),
    0,
  );
  // The cubes the suggestions go to ("Rain gear, Sun gear"); the generic "Weather gear" and the clothing split only when nothing
  // more specific is left to name.
  const all = [...new Set(rows.map((row) => row.destination))];
  const specific = all.filter((name) => name !== "Weather gear" && name !== CUBE_LABELS.clothing);
  const names = specific.length > 0 ? specific : all;
  const line = changes.length
    ? `${names.join(", ")} · ${changes.length} added`
    : "Nothing needed for this weather";
  return { accepted, added, line };
}

/** The config a copied trip's preferences give, with this trip's own laundry choice kept. */
export function copyConfig(source: TripConfig, laundry: boolean): TripConfig {
  return { ...source, laundry };
}

// ------------------------------------------------------------------ the draft that gets created

/** What the Starting list step chooses (the route, dates, mode and name live on the draft itself). */
export interface StartChoice {
  /** A past trip whose preferences this one takes (the existing copy). */
  copy: LifecycleTrip | null;
  /** A saved list this trip starts from instead of the Staples; never together with a copy. */
  listId: string | null;
  laundry: boolean;
}

/** The draft the server is asked to create: the person's route and name, plus the Starting list choices. */
export function withChoices(draft: TripDraft, choice: StartChoice): TripDraft {
  const name = (draft.name ?? "").trim();
  const base: TripDraft = {
    ...draft,
    mode: choice.copy ? "copy" : "create",
    sourceId: choice.copy ? choice.copy.id : null,
    config: choice.copy
      ? copyConfig(choice.copy.config, choice.laundry)
      : { ...DEFAULT_TRIP_CONFIG, laundry: choice.laundry },
    name: name || null,
  };
  return setDraftSavedList(base, choice.copy ? null : choice.listId);
}

/** Move a stop to a new place in the route (drag and drop), keeping each stop's nights. */
export function moveStopTo(stops: readonly DraftStop[], from: number, to: number): DraftStop[] {
  let next = [...stops];
  if (from < 0 || to < 0 || from >= next.length || to >= next.length) return next;
  for (let at = from; at < to; at += 1) next = moveStop(next, at, 1);
  for (let at = from; at > to; at -= 1) next = moveStop(next, at, -1);
  return next;
}

// ------------------------------------------------------------------ the weather rows beside the preview

export interface PlanWeatherRow {
  id: string;
  city: string;
  /** "15–18 Mar" */
  dates: string;
  /** "mostly dry", "rain Thu–Sat", "Rain on 2 of 5 days" */
  line: string;
  /** "70° / 54°" */
  range: string;
  glyph: Glyph;
  /** Rain or snow in the stay: the row is outlined and its line is the accent colour. */
  alert: boolean;
  /** Every day of the stay is a real forecast (no typical days mixed in). */
  forecast: boolean;
}

/** One row per stop that has weather, as the preview column prints it. */
export function planWeatherRows(
  route: readonly TripStop[],
  weather: readonly StopWeather[],
  unit: TemperatureUnit,
  today: string,
): PlanWeatherRow[] {
  const rows: PlanWeatherRow[] = [];
  for (const entry of weather) {
    const stop = route[entry.stopIndex];
    const view = stop ? weatherRowView(stop, entry, unit, today) : null;
    if (!stop || !view) continue;
    const wet = view.forecastDays.filter((day) => day.glyph !== "sun");
    const part = view.forecast ?? view.typical;
    const alert = view.glyph !== "sun";
    const first = wet[0]?.parts.weekday;
    const last = wet[wet.length - 1]?.parts.weekday;
    const word = view.glyph === "snow" ? "snow" : "rain";
    const line = !alert
      ? "mostly dry"
      : first
        ? `${word} ${first === last ? first : `${first}–${last}`}`
        : part
          ? rainLine(part, "mostly dry")
          : "mostly dry";
    rows.push({
      id: `${entry.stopIndex}`,
      city: view.city,
      dates: stopRange(stop),
      line,
      range: `${displayTemperature(view.high, unit)}° / ${displayTemperature(view.low, unit)}°`,
      glyph: view.glyph,
      alert,
      forecast: view.source === "forecast" && !view.mixed,
    });
  }
  return rows;
}
