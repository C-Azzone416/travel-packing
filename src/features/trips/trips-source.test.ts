import { describe, expect, it } from "vitest";
import { LOCATIONS } from "@/domain/locations";
import { classifyTrip, startCopyDraft, startDraft } from "@/domain/trip-lifecycle";
import { DEFAULT_TRIP_CONFIG } from "./draft";
import { sampleLifecycleState } from "./fixtures";
import { createMemoryTripsSource, TripsSourceError } from "./trips-source";

function setup(now = 1_000) {
  const initial = sampleLifecycleState();
  let counter = 0;
  const source = createMemoryTripsSource(initial, {
    now: () => now,
    newId: () => `new-${++counter}`,
    today: () => "2026-10-16",
  });
  return { initial, source };
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

  describe("createTrip", () => {
    const london = LOCATIONS.find((entry) => entry.id === "gb-eng-london")!;
    const completeDraft = () => ({
      ...startDraft(DEFAULT_TRIP_CONFIG, "2026-10-20", "2026-10-24"),
      location: london,
    });

    it("saves a finished draft as a new trip at the front, with clear progress and a forecast from today", async () => {
      const { source } = setup();
      const trip = await source.createTrip(completeDraft());
      expect(trip).toMatchObject({
        id: "new-1",
        destination: "London",
        archived: false,
        ready: false,
        toiletryBagPacked: false,
        copiedFrom: null,
      });
      expect(trip.items.every((item) => item.packed === 0)).toBe(true);
      expect(trip.weather.label).toBe("Close forecast");
      expect(source.snapshot().trips.map((t) => t.id)).toEqual(["new-1", "san-diego", "lisbon"]);
      expect(source.snapshot().draft).toBeNull();
    });

    it("records where a copy came from and leaves the source untouched", async () => {
      const { initial, source } = setup();
      const original = structuredClone(initial.trips[0]);
      const draft = {
        ...startCopyDraft(initial.trips[0], "2026-12-04", "2026-12-08"),
        location: london,
      };
      const trip = await source.createTrip(draft);
      expect(trip.copiedFrom).toBe("san-diego");
      expect(trip.items.every((item) => item.packed === 0)).toBe(true);
      expect(source.snapshot().trips.find((t) => t.id === "san-diego")).toEqual(original);
    });

    it.each([
      ["no destination", { location: null }, "LOCATION_NOT_CONFIRMED"],
      ["no dates", { start: "", end: "" }, "INVALID_DATES"],
    ])("rejects a draft with %s and changes nothing", async (_label, patch, reason) => {
      const { source } = setup();
      const before = source.snapshot();
      await expect(source.createTrip({ ...completeDraft(), ...patch })).rejects.toThrow(reason);
      expect(source.snapshot()).toBe(before);
    });

    it("uses real defaults for ids, today and staples when none are injected", async () => {
      const source = createMemoryTripsSource(sampleLifecycleState(), { now: () => 1 });
      const trip = await source.createTrip(completeDraft());
      expect(trip.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(trip.items.some((item) => item.name === "Toothbrush")).toBe(true);
    });
  });
});
