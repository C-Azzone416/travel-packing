import { describe, expect, it } from "vitest";
import { classifyTrip } from "@/domain/trip-lifecycle";
import { sampleLifecycleState } from "./fixtures";
import { createMemoryTripsSource, TripsSourceError } from "./trips-source";

function setup(now = 1_000) {
  const initial = sampleLifecycleState();
  return { initial, source: createMemoryTripsSource(initial, { now: () => now }) };
}

describe("memory trips source", () => {
  it("loads the initial state", async () => {
    const { initial, source } = setup();
    expect(await source.load()).toBe(initial);
    expect(source.snapshot()).toBe(initial);
  });

  it("archives and restores a trip, returning the new state each time", async () => {
    const { source } = setup();
    const archived = await source.archive("san-diego");
    expect(archived.trips.find((trip) => trip.id === "san-diego")?.archived).toBe(true);
    expect(classifyTrip(archived.trips[0], "2026-10-16")).toBe("archived");
    const restored = await source.restore("san-diego");
    expect(restored.trips.find((trip) => trip.id === "san-diego")?.archived).toBe(false);
    expect(source.snapshot()).toBe(restored);
  });

  it("removes with the injected timestamp and undoes to the exact same trip", async () => {
    const { initial, source } = setup(4242);
    const original = initial.trips.find((trip) => trip.id === "lisbon")!;
    const removed = await source.remove("lisbon");
    expect(removed.trips.map((trip) => trip.id)).toEqual(["san-diego"]);
    expect(removed.deletedTrips).toEqual([{ trip: original, deletedAt: 4242 }]);
    const undone = await source.undoRemove("lisbon");
    expect(undone.deletedTrips).toEqual([]);
    expect(undone.trips.find((trip) => trip.id === "lisbon")).toEqual(original);
  });

  it("treats undoing an unknown or already-undone trip as a no-op", async () => {
    const { source } = setup();
    const before = source.snapshot();
    expect(await source.undoRemove("nope")).toBe(before);
    await source.remove("lisbon");
    await source.undoRemove("lisbon");
    const after = source.snapshot();
    expect(await source.undoRemove("lisbon")).toBe(after);
  });

  it.each(["archive", "restore", "remove"] as const)(
    "%s rejects an unknown trip and keeps its state",
    async (command) => {
      const { source } = setup();
      const before = source.snapshot();
      await expect(source[command]("missing")).rejects.toThrow(TripsSourceError);
      await expect(source[command]("missing")).rejects.toThrow("TRIP_NOT_FOUND");
      expect(source.snapshot()).toBe(before);
    },
  );

  it("names its error type", () => {
    expect(new TripsSourceError("x").name).toBe("TripsSourceError");
  });
});
