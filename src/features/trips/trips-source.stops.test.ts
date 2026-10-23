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
      dailyDays: 8,
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
    expect((await on.setStops("san-diego", route)).trip).toMatchObject({ days: 10, dailyDays: 8 });
    const off = source();
    const trip = await off.getTrip("san-diego");
    await off.updatePreferences("san-diego", { ...trip.config, returnOutfit: false });
    // The checkout day needs an everyday look when there is no return outfit.
    expect((await off.setStops("san-diego", route)).trip).toMatchObject({ days: 10, dailyDays: 9 });
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
