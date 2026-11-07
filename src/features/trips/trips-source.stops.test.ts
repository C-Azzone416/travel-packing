import { describe, expect, it } from "vitest";
import { locationById } from "@/domain/locations";
import type { TripStop } from "@/domain/trip-stops";
import { sampleLifecycleState } from "./fixtures";
import { createMemoryTripsSource, TripsSourceError } from "./trips-source";

const source = () =>
  createMemoryTripsSource(sampleLifecycleState(), {
    now: () => 1,
    newId: () => "new",
    today: () => "2026-10-16",
  });
const stop = (id: string, arrive: string, leave: string): TripStop => ({
  location: locationById(id)!,
  arrive,
  leave,
});

describe("setStops (memory source)", () => {
  it("replaces the route; dates, day counts and the calculated items follow", async () => {
    const memory = source();
    const before = await memory.getTrip("san-diego");
    const change = await memory.setStops("san-diego", [
      stop("us-ca-san-diego", "2026-10-23", "2026-10-26"),
      stop("pt-lisbon", "2026-10-26", "2026-11-01"),
    ]);
    expect(change.trip).toMatchObject({
      start: "2026-10-23",
      end: "2026-11-01",
      days: 10,
      dailyDays: 9,
      destination: "San Diego → Lisbon",
    });
    expect(change.trip.location?.city).toBe("San Diego");
    expect(change.trip.stops).toHaveLength(2);
    const qty = (trip: typeof before) => trip.items.find((entry) => entry.id === "tops")?.qty;
    expect(qty(change.trip)).toBeGreaterThan(qty(before) as number);
    expect(change.signals).toEqual({ promptBagPlacement: false, reviewPrompt: false });
    expect((await memory.getTrip("san-diego")).stops).toHaveLength(2);
  });

  it("keeps dailyDays in step with the return outfit after a route edit (#205)", async () => {
    const route = [
      stop("us-ca-san-diego", "2026-10-23", "2026-10-26"),
      stop("pt-lisbon", "2026-10-26", "2026-11-01"),
    ];
    const on = source();
    expect((await on.setStops("san-diego", route)).trip).toMatchObject({ days: 10, dailyDays: 9 });
    const off = source();
    const trip = await off.getTrip("san-diego");
    await off.updatePreferences("san-diego", { ...trip.config, returnOutfit: false });
    // Every day needs an everyday look when there is no return outfit (#295).
    expect((await off.setStops("san-diego", route)).trip).toMatchObject({
      days: 10,
      dailyDays: 10,
    });
  });

  it("keeps a title the person edited, and leaves other trips alone", async () => {
    const memory = source();
    const lisbonBefore = await memory.getTrip("lisbon");
    const [first] = (await memory.load()).trips;
    const custom = { ...first, destination: "Spring break" };
    const edited = createMemoryTripsSource(
      { ...(await memory.load()), trips: [custom, lisbonBefore] },
      { now: () => 1 },
    );
    const change = await edited.setStops("san-diego", [
      stop("us-ca-san-diego", "2026-10-23", "2026-10-25"),
    ]);
    expect(change.trip.destination).toBe("Spring break");
    expect(await edited.getTrip("lisbon")).toEqual(lisbonBefore);
  });

  it("rejects an invalid route and changes nothing", async () => {
    const memory = source();
    const before = await memory.getTrip("san-diego");
    await expect(
      memory.setStops("san-diego", [
        stop("us-ca-san-diego", "2026-10-23", "2026-10-26"),
        stop("pt-lisbon", "2026-10-28", "2026-11-01"),
      ]),
    ).rejects.toThrow(new TripsSourceError("INVALID_INPUT"));
    expect(await memory.getTrip("san-diego")).toEqual(before);
  });

  it("rejects an unknown trip", async () => {
    await expect(
      source().setStops("nope", [stop("pt-lisbon", "2026-10-23", "2026-10-26")]),
    ).rejects.toThrow("NOT_FOUND");
  });
});

describe("setTravelMode (memory source, Edit trip #389)", () => {
  it("changes only the travel mode", async () => {
    const memory = source();
    const before = await memory.getTrip("san-diego");
    const change = await memory.setTravelMode("san-diego", "drive");
    expect(change.trip.travelMode).toBe("drive");
    expect({ ...change.trip, travelMode: before.travelMode }).toEqual(before);
    expect(change.signals).toEqual({ promptBagPlacement: false, reviewPrompt: false });
    expect((await memory.getTrip("san-diego")).travelMode).toBe("drive");
  });

  it("refuses an unknown mode and a missing trip", async () => {
    const memory = source();
    await expect(memory.setTravelMode("san-diego", "rocket" as never)).rejects.toThrow(
      new TripsSourceError("INVALID_INPUT"),
    );
    await expect(memory.setTravelMode("nope", "fly")).rejects.toThrow(TripsSourceError);
  });
});

describe("the reviewed version on the memory source's route and travel saves (#389)", () => {
  const withVersion = () => {
    const state = sampleLifecycleState();
    state.trips[0] = { ...state.trips[0], updatedAt: "T1" };
    return createMemoryTripsSource(state, {
      now: () => 1,
      newId: () => "new",
      today: () => "2026-10-16",
    });
  };
  const one = [stop("us-ca-san-diego", "2026-10-23", "2026-10-26")];

  it("a save based on another version is STALE and changes nothing", async () => {
    const memory = withVersion();
    await expect(memory.setStops("san-diego", one, "T0")).rejects.toThrow(
      new TripsSourceError("STALE"),
    );
    await expect(memory.setTravelMode("san-diego", "drive", "T0")).rejects.toThrow(
      new TripsSourceError("STALE"),
    );
    expect((await memory.getTrip("san-diego")).travelMode).toBeUndefined();
  });

  it("the current version applies; no version at all is unchecked", async () => {
    const memory = withVersion();
    expect((await memory.setStops("san-diego", one, "T1")).trip.end).toBe("2026-10-26");
    expect((await memory.setTravelMode("san-diego", "drive", "T1")).trip.travelMode).toBe("drive");
    expect((await memory.setTravelMode("san-diego", "fly")).trip.travelMode).toBe("fly");
  });
});
