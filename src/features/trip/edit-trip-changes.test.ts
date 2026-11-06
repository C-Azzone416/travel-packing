import { describe, expect, it } from "vitest";
import { sampleLifecycleState } from "@/features/trips/fixtures";
import { addDays } from "@/domain/trip-stops";
import { editTripChanges } from "./edit-trip-changes";

describe("editTripChanges", () => {
  it("shows preferences, dates, travel mode and the resulting item quantities in one ordered review", () => {
    const trip = { ...sampleLifecycleState().trips[0], travelMode: "fly" as const };
    const stops = trip.stops.map((stop, index, all) => ({
      ...stop,
      leave: index === all.length - 1 ? addDays(stop.leave, 2) : stop.leave,
    }));
    const result = editTripChanges(trip, stops, { ...trip.config, laundry: true }, "drive");
    expect(result.lines.slice(0, 3).map((line) => line.id)).toEqual([
      "preference-laundry",
      "dates",
      "travel-mode",
    ]);
    expect(result.lines.some((line) => line.id.startsWith("item-") && line.before)).toBe(true);
    expect(result.preview.next.config.laundry).toBe(true);
  });

  it("keeps user-edited rows out of quantity changes and describes removed stops", () => {
    const original = sampleLifecycleState().trips[0];
    const second = {
      ...original.stops[0],
      location: { ...original.stops[0].location, id: "synthetic-second", city: "Second stop" },
      arrive: original.stops[0].leave,
      leave: addDays(original.stops[0].leave, 2),
    };
    const trip = { ...original, stops: [original.stops[0], second], end: second.leave };
    const result = editTripChanges(trip, [trip.stops[0]], trip.config, null);
    expect(result.lines).toContainEqual(
      expect.objectContaining({
        id: `stop-remove-${trip.stops[1].location.id}`,
        after: "removed",
        note: "Items you packed for it stay ticked",
      }),
    );
    for (const stay of result.preview.stays.filter((line) => line.why === "edited by you")) {
      expect(result.lines.some((line) => line.id === `item-${stay.id}`)).toBe(false);
    }
  });
});
