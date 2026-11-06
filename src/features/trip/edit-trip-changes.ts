import { calculateSuggestions } from "@/domain/calc";
import { previewRecalculation, type RecalcPreview } from "@/domain/recalc-preview";
import type { TripConfig } from "@/domain/trip";
import type { LifecycleTrip } from "@/domain/trip-lifecycle";
import type { Trip } from "@/domain/trip";
import type { TravelMode } from "@/domain/trip-route";
import { daysBetween, tripDatesFromStops, type TripStop } from "@/domain/trip-stops";

export interface EditChangeLine {
  id: string;
  label: string;
  before?: string;
  after: string;
  note?: string;
}

export interface EditTripChanges {
  preview: RecalcPreview<Trip>;
  lines: EditChangeLine[];
}

const sameStops = (a: readonly TripStop[], b: readonly TripStop[]) =>
  JSON.stringify(a) === JSON.stringify(b);

const dateLabel = (value: string) => {
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("en", { day: "numeric", month: "short", timeZone: "UTC" }).format(
        date,
      );
};

const rangeLabel = (start: string, end: string) => `${dateLabel(start)} – ${dateLabel(end)}`;

const modeLabel = (mode: TravelMode | null | undefined) =>
  mode === "fly"
    ? "Fly"
    : mode === "drive"
      ? "Drive"
      : mode === "other"
        ? "Train or other"
        : "Not set";

/** The live Edit-trip review. It deliberately delegates item reconciliation to previewRecalculation. */
export function editTripChanges(
  trip: Trip & Partial<Pick<LifecycleTrip, "travelMode">>,
  stops: readonly TripStop[],
  config: TripConfig,
  travelMode: TravelMode | null,
): EditTripChanges {
  const validStops = stops.length > 0;
  const dates = validStops ? tripDatesFromStops(stops) : { start: trip.start, end: trip.end };
  const draftTrip: Trip = {
    ...trip,
    stops: validStops ? [...stops] : trip.stops,
    start: dates.start,
    end: dates.end,
  };
  const preview = previewRecalculation(draftTrip, config, calculateSuggestions);
  const lines: EditChangeLine[] = [];

  const preferenceLines: Array<
    [keyof TripConfig, string, (value: TripConfig[keyof TripConfig]) => string]
  > = [
    ["laundry", "Laundry", (value) => (value ? "on" : "off")],
    ["spare", "Spare underwear + socks", (value) => (value ? "on" : "off")],
    ["returnOutfit", "Return travel outfit", (value) => (value ? "on" : "off")],
    ["niceAttire", "Nice outfits", (value) => (value ? "on" : "off")],
    ["occasionCount", "Nice occasions", String],
    ["reuseNice", "Reuse one nice look", (value) => (value ? "on" : "off")],
  ];
  for (const [key, label, format] of preferenceLines) {
    if (trip.config[key] !== config[key])
      lines.push({
        id: `preference-${key}`,
        label,
        before: format(trip.config[key]),
        after: format(config[key]),
      });
  }

  if (!sameStops(stops, trip.stops)) {
    const oldIds = trip.stops.map((stop) => stop.location.id);
    const newIds = stops.map((stop) => stop.location.id);
    for (const stop of stops.filter((entry) => !oldIds.includes(entry.location.id))) {
      lines.push({
        id: `stop-add-${stop.location.id}`,
        label: stop.location.city,
        after: "new stop",
      });
    }
    for (const stop of trip.stops.filter((entry) => !newIds.includes(entry.location.id))) {
      lines.push({
        id: `stop-remove-${stop.location.id}`,
        label: stop.location.city,
        after: "removed",
        note: "Items you packed for it stay ticked",
      });
    }
    const sharedBefore = oldIds.filter((id) => newIds.includes(id));
    const sharedAfter = newIds.filter((id) => oldIds.includes(id));
    if (sharedBefore.join("|") !== sharedAfter.join("|"))
      lines.push({
        id: "stops-reordered",
        label: "Stops",
        before: "saved order",
        after: "reordered",
      });
  }

  if (dates.start !== trip.start || dates.end !== trip.end) {
    const oldNights = daysBetween(trip.start, trip.end);
    const newNights = daysBetween(dates.start, dates.end);
    lines.push({
      id: "dates",
      label: "Dates",
      before: rangeLabel(trip.start, trip.end),
      after: rangeLabel(dates.start, dates.end),
      note: `${oldNights} → ${newNights} ${newNights === 1 ? "night" : "nights"}`,
    });
  }

  if ((trip.travelMode ?? null) !== travelMode)
    lines.push({
      id: "travel-mode",
      label: "Getting there",
      before: modeLabel(trip.travelMode),
      after: modeLabel(travelMode),
    });

  for (const line of preview.updated) {
    const add = line.toQty > line.fromQty ? line.toQty - line.fromQty : 0;
    lines.push({
      id: `item-${line.id}`,
      label: line.name,
      before: `× ${line.fromQty}`,
      after: `× ${line.toQty}`,
      note:
        add > 0 &&
        line.packedFrom === undefined &&
        trip.items.find((item) => item.id === line.id)?.packed === line.fromQty
          ? `Already packed · add ${add} more`
          : line.packedFrom !== undefined
            ? `Packed ${line.packedFrom} → ${line.packedTo}`
            : undefined,
    });
  }
  for (const line of preview.removed)
    lines.push({
      id: `item-remove-${line.id}`,
      label: line.name,
      before: `× ${line.qty}`,
      after: "removed",
    });
  for (const line of preview.added)
    lines.push({ id: `item-add-${line.id}`, label: line.name, after: `× ${line.qty} added` });

  return { preview, lines };
}
