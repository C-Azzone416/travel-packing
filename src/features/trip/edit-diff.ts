// What saving the Edit trip sheet would change, as the live "What changes in your list" panel prints it (#389, spec #376
// part 3 section 3). Pure: no React, no clock (`today` is passed in).
//
// This adds no recalculation rules. The list that results is built by the SAME calls the server makes when the sheet saves:
// the route first (`recalculateSuggestions` with the new stops and dates and the saved preferences, as `setTripStops` does), then
// the preferences (`previewRecalculation`, as `updateTripPreferences` does). The rows only describe the difference between the
// list as saved and that result, so the panel cannot disagree with what is saved: items the person added or edited stay as they
// are, and packed items stay ticked (a packed count only drops to the new quantity).

import { nightsText } from "@/domain/trip-route";
import { parseDate } from "@/domain/calc";
import { FORECAST_WINDOW_DAYS } from "@/domain/calc/dates";
import { recalculateSuggestions } from "@/domain/item-ops";
import { previewRecalculation } from "@/domain/recalc-preview";
import { TRAVEL_MODE_LABEL, type TravelMode } from "@/domain/trip-route";
import type { DraftStop, LifecycleTrip } from "@/domain/trip-lifecycle";
import { daysBetween, tripDatesFromStops, type TripStop } from "@/domain/trip-stops";
import type { SuggestFn, TripConfig, TripItem } from "@/domain/trip";
import { countedWithEarlierRule } from "@/features/trips/count-copy";
import { stopProblems } from "@/features/trips/stops-draft";

/** Everything the sheet lets the person edit. */
export interface EditDraft {
  stops: DraftStop[];
  config: TripConfig;
  travelMode: TravelMode | null;
}

export type ChangeKind = "pref" | "stops" | "dates" | "travel" | "item";

/** One line of the panel: a label, the old value (struck) and the new one, and an optional sub-line. */
export interface ChangeRow {
  id: string;
  kind: ChangeKind;
  label: string;
  /** The value before; absent for a new line. Printed struck through. */
  from?: string;
  /** The value after (or a word such as "new stop" / "removed"). */
  to: string;
  sub?: string;
}

/** Which of the two sections a change belongs to (for the dot on an edited section). */
export type EditSection = "route" | "preferences";

export interface EditChanges {
  rows: ChangeRow[];
  /** Which section's fields differ from the saved trip (the dot). Getting there is part of Route & dates. */
  dirty: Record<EditSection, boolean>;
  /** Save is possible: the route has no problems. */
  valid: boolean;
  /** The route is complete enough to recalculate. */
  routeChanged: boolean;
  travelChanged: boolean;
  /** Preferences are applied on save (they changed, or the trip is counted with the earlier rule and is brought up to date). */
  applyPreferences: boolean;
  /** A packed count drops, or a packed or edited line is removed: saving asks for a tick first. */
  needsAcknowledgement: boolean;
  /** Ready turns off, or the toiletry bag placement resets, on saving. */
  notes: string[];
  /** The list as saved would be this after saving (null while the route is incomplete). */
  next: LifecycleTrip | null;
}

const PREF_LABELS: { key: keyof TripConfig; label: string; kind: "toggle" | "number" }[] = [
  { key: "laundry", label: "Laundry", kind: "toggle" },
  { key: "spare", label: "Spare underwear + socks", kind: "toggle" },
  { key: "returnOutfit", label: "Return travel outfit", kind: "toggle" },
  { key: "niceAttire", label: "Nice outfits", kind: "toggle" },
  { key: "occasionCount", label: "Nice occasions", kind: "number" },
  { key: "reuseNice", label: "Reuse one nice look", kind: "toggle" },
];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "14 Mar"; blank when the date is not real. */
export function dayMonth(value: string): string {
  const date = parseDate(value);
  return date ? `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}` : "";
}

// One date for a day trip (#412): "23 Oct", never "23 Oct – 23 Oct".
const dateRange = (start: string, end: string) =>
  start === end ? dayMonth(start) : `${dayMonth(start)} – ${dayMonth(end)}`;
const nightsWord = nightsText;
const onOff = (value: boolean) => (value ? "on" : "off");

const sameStops = (a: readonly DraftStop[], b: readonly TripStop[]) =>
  JSON.stringify(a) === JSON.stringify(b);

/** The preference rows: one per changed preference, "Laundry · on → off". */
function preferenceRows(saved: TripConfig, next: TripConfig): ChangeRow[] {
  return PREF_LABELS.flatMap(({ key, label, kind }): ChangeRow[] => {
    if (saved[key] === next[key]) return [];
    const show = (value: unknown) => (kind === "toggle" ? onOff(Boolean(value)) : String(value));
    return [
      { id: `pref-${key}`, kind: "pref", label, from: show(saved[key]), to: show(next[key]) },
    ];
  });
}

/** The stop rows: each added place, each removed place, or "reordered" when the same places changed order. */
function stopRows(saved: readonly TripStop[], draft: readonly DraftStop[], today: string) {
  const before = saved.map((stop) => stop.location.id);
  const after = draft.map((stop) => stop.location?.id ?? null);
  const rows: ChangeRow[] = [];
  const remaining = [...before];
  for (const [index, stop] of draft.entries()) {
    const at = stop.location ? remaining.indexOf(stop.location.id) : -1;
    if (at >= 0) remaining.splice(at, 1);
    if (!stop.location || at >= 0) continue;
    const far = parseDate(today) && daysBetween(today, stop.arrive) >= FORECAST_WINDOW_DAYS;
    rows.push({
      id: `stop-add-${index}`,
      kind: "stops",
      label: stop.location.city,
      to: "new stop",
      ...(far ? { sub: `Its forecast appears ${FORECAST_WINDOW_DAYS} days out` } : {}),
    });
  }
  for (const [index, id] of remaining.entries()) {
    const stop = saved.find((entry) => entry.location.id === id) as TripStop;
    rows.push({
      id: `stop-remove-${index}`,
      kind: "stops",
      label: stop.location.city,
      to: "removed",
      sub: "Items you packed for it stay ticked",
    });
  }
  const kept = after.filter((id) => id !== null && before.includes(id as string));
  const order = before.filter((id) => kept.includes(id));
  if (rows.length === 0 && kept.length === order.length && kept.join() !== order.join()) {
    rows.push({ id: "stop-order", kind: "stops", label: "Stops", to: "reordered" });
  }
  return rows;
}

/** "Already packed · add 2 more" for a packed line that grows; the packed count that drops for one that shrinks. */
function itemRows(before: readonly TripItem[], after: readonly TripItem[]): ChangeRow[] {
  const next = new Map(after.map((item) => [item.id, item]));
  const old = new Map(before.map((item) => [item.id, item]));
  const rows: ChangeRow[] = [];
  for (const item of before) {
    const kept = next.get(item.id);
    if (!kept) {
      rows.push({
        id: `item-${item.id}`,
        kind: "item",
        label: item.name,
        from: `× ${item.qty}`,
        to: "removed",
        sub:
          item.packed > 0 || item.userEdited
            ? "Remembered: it returns with your edits and packed count if you turn it back on"
            : undefined,
      });
      continue;
    }
    if (kept.qty === item.qty) continue;
    const grew = kept.qty - item.qty;
    rows.push({
      id: `item-${item.id}`,
      kind: "item",
      label: kept.name,
      from: `× ${item.qty}`,
      to: `× ${kept.qty}`,
      ...(grew > 0 && item.packed >= item.qty
        ? { sub: `Already packed · add ${grew} more` }
        : kept.packed < item.packed
          ? { sub: `Packed ${item.packed} → ${kept.packed}` }
          : {}),
    });
  }
  for (const item of after) {
    if (old.has(item.id)) continue;
    rows.push({
      id: `item-${item.id}`,
      kind: "item",
      label: item.name,
      to: `new · × ${item.qty}`,
      ...(item.optional ? { sub: "Optional" } : {}),
    });
  }
  return rows;
}

/**
 * Compare the draft with the saved trip. `suggest` is the calculator (injected, like every item operation). Rows are in the
 * spec's order: preferences, stops, dates, getting there, then each item whose quantity changes.
 */
export function editChanges(
  trip: LifecycleTrip,
  draft: EditDraft,
  suggest: SuggestFn,
  today: string,
): EditChanges {
  const routeChanged = !sameStops(draft.stops, trip.stops);
  const prefsChanged = PREF_LABELS.some(({ key }) => trip.config[key] !== draft.config[key]);
  const savedMode = trip.travelMode ?? null;
  const travelChanged = draft.travelMode !== null && draft.travelMode !== savedMode;
  const valid = stopProblems(draft.stops).length === 0;
  // A trip counted with the earlier rule is brought up to date on any save; a route change already does that itself.
  const applyPreferences = prefsChanged || (countedWithEarlierRule(trip) && !routeChanged);

  const rows: ChangeRow[] = preferenceRows(trip.config, draft.config);
  let next: LifecycleTrip | null = trip;
  if (routeChanged) {
    rows.push(...stopRows(trip.stops, draft.stops, today));
    if (valid) {
      const stops = draft.stops as TripStop[];
      const { start, end } = tripDatesFromStops(stops);
      if (start !== trip.start || end !== trip.end) {
        const was = daysBetween(trip.start, trip.end);
        const now = daysBetween(start, end);
        rows.push({
          id: "dates",
          kind: "dates",
          label: "Dates",
          from: dateRange(trip.start, trip.end),
          to: dateRange(start, end),
          sub: `${was} → ${nightsWord(now)}`,
        });
      }
      next = recalculateSuggestions({ ...trip, stops, start, end }, trip.config, suggest);
    } else next = null;
  }
  if (travelChanged) {
    rows.push({
      id: "travel",
      kind: "travel",
      label: "Getting there",
      ...(savedMode ? { from: TRAVEL_MODE_LABEL[savedMode] } : {}),
      to: TRAVEL_MODE_LABEL[draft.travelMode as TravelMode],
    });
  }

  let needsAcknowledgement = false;
  const notes: string[] = [];
  if (next && (applyPreferences || routeChanged)) {
    let final = next;
    if (applyPreferences) {
      const preview = previewRecalculation(next, draft.config, suggest);
      final = preview.next;
      if (preview.bagWillReset) notes.push("Toiletry bag placement resets.");
    }
    rows.push(...itemRows(trip.items, final.items));
    // Saving costs packed progress or an edit: a packed count drops (a shorter trip, a preference), or a packed or edited line goes.
    needsAcknowledgement = trip.items.some((item) => {
      const kept = final.items.find((entry) => entry.id === item.id);
      return kept ? kept.packed < item.packed : item.packed > 0 || Boolean(item.userEdited);
    });
    if (trip.ready) notes.unshift("Ready turns off. Check the list, then mark it Ready again.");
    next = final;
  }

  return {
    rows,
    dirty: {
      route: routeChanged || travelChanged,
      preferences: prefsChanged,
    },
    valid,
    routeChanged,
    travelChanged,
    applyPreferences,
    needsAcknowledgement,
    notes,
    next,
  };
}

/** "5 changes", "1 change". */
export function changeCount(count: number): string {
  return `${count} ${count === 1 ? "change" : "changes"}`;
}

/** "Save 5 changes", "Save 1 change"; "Save changes" while there are none (the button is disabled then). */
export function saveLabel(count: number): string {
  return count === 0 ? "Save changes" : `Save ${changeCount(count)}`;
}
