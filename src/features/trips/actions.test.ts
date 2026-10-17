import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createMigratedDb, resetData } from "@/server/db/__fixtures__/db";
import type { Db } from "@/server/db/retention";
import {
  createFakeAuth,
  makeContext,
  OTHER_OWNER,
  OWNER,
  seedTrip,
  signedInAs,
} from "@/server/data/__fixtures__/seed";
import type { DataContext } from "@/server/data/context";
import { CONFIG } from "@/server/data/__fixtures__/seed";

let current: DataContext | null = null;
vi.mock("@/server/data/runtime", () => ({ getDataContext: async () => current }));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  },
}));

import type { TripDraft } from "@/domain/trip-lifecycle";
import {
  archiveTripAction,
  createTripAction,
  loadTripsAction,
  removeTripAction,
  restoreTripAction,
  undoRemoveTripAction,
} from "./actions";

let ctx: Awaited<ReturnType<typeof createMigratedDb>>;
const fake = createFakeAuth();
const db = () => ctx.db as unknown as Db;
const as = (user: typeof OWNER | null) => signedInAs(fake, user);

beforeAll(async () => {
  ctx = await createMigratedDb();
});
beforeEach(async () => {
  await resetData(ctx.client);
  as(OWNER);
  current = makeContext(db(), fake);
});
afterAll(async () => {
  await ctx.client.close();
});

const stateOf = (result: Awaited<ReturnType<typeof loadTripsAction>>) => {
  if (!result.ok) throw new Error(`expected ok, got ${result.code}`);
  return result.state;
};

describe("trips server actions", () => {
  it("load returns the owner's trips in the dashboard's shape, with nothing deleted and no draft", async () => {
    const trip = await seedTrip(db(), OWNER.userId, {
      destination: "San Diego",
      locationId: "us-ca-san-diego",
      locationLabel: "San Diego, California, United States",
    });
    const state = stateOf(await loadTripsAction());
    expect(state.trips.map((entry) => entry.id)).toEqual([trip.id]);
    expect(state.trips[0].location).toMatchObject({
      region: "California",
      country: "United States",
    });
    expect(state.deletedTrips).toEqual([]);
    expect(state.draft).toBeNull();
  });

  it("archive, restore, remove and undo each write through the data layer and return the fresh state", async () => {
    const trip = await seedTrip(db(), OWNER.userId);

    expect(stateOf(await archiveTripAction(trip.id)).trips[0].archived).toBe(true);
    expect(stateOf(await restoreTripAction(trip.id)).trips[0].archived).toBe(false);

    const removed = stateOf(await removeTripAction(trip.id));
    expect(removed.trips).toEqual([]);
    expect(removed.deletedTrips.map((entry) => entry.trip.id)).toEqual([trip.id]);
    expect(removed.deletedTrips[0].deletedAt).toBeGreaterThan(0);

    const undone = stateOf(await undoRemoveTripAction(trip.id));
    expect(undone.trips.map((entry) => entry.id)).toEqual([trip.id]);
    expect(undone.deletedTrips).toEqual([]);
  });

  it("returns a NOT_FOUND code (not an exception) for a trip that is missing or removed", async () => {
    const trip = await seedTrip(db(), OWNER.userId);
    expect(await archiveTripAction("00000000-0000-4000-8000-0000000000ff")).toEqual({
      ok: false,
      code: "NOT_FOUND",
    });
    await removeTripAction(trip.id);
    expect(await archiveTripAction(trip.id)).toEqual({ ok: false, code: "NOT_FOUND" });
    expect(await restoreTripAction(trip.id)).toEqual({ ok: false, code: "NOT_FOUND" });
    expect(await removeTripAction(trip.id)).toEqual({ ok: false, code: "NOT_FOUND" });
  });

  it("returns INVALID_INPUT for a malformed trip id", async () => {
    expect(await archiveTripAction("not-a-uuid")).toEqual({ ok: false, code: "INVALID_INPUT" });
  });

  it("another owner cannot touch, or even see, the first owner's trips", async () => {
    const trip = await seedTrip(db(), OWNER.userId);
    as(OTHER_OWNER);
    expect(stateOf(await loadTripsAction()).trips).toEqual([]);
    expect(await archiveTripAction(trip.id)).toEqual({ ok: false, code: "NOT_FOUND" });
    expect(await removeTripAction(trip.id)).toEqual({ ok: false, code: "NOT_FOUND" });
    as(OWNER);
    const state = stateOf(await loadTripsAction());
    expect(state.trips.map((entry) => entry.id)).toEqual([trip.id]);
    expect(state.trips[0].archived).toBe(false);
  });

  describe("createTripAction", () => {
    const location = {
      id: "us-ca-san-diego",
      city: "San Diego",
      region: "California",
      country: "United States",
      countryCode: "US",
      label: "San Diego, California, United States",
    };
    const draft = (patch: Partial<TripDraft> = {}): TripDraft => ({
      mode: "create",
      sourceId: null,
      location,
      start: "2030-04-01",
      end: "2030-04-05",
      config: CONFIG,
      ...patch,
    });

    it("saves a new trip for the signed-in owner and returns it in the dashboard's shape", async () => {
      const result = await createTripAction(draft());
      if (!result.ok) throw new Error(`expected ok, got ${result.code}`);
      expect(result.trip).toMatchObject({
        destination: "San Diego",
        start: "2030-04-01",
        end: "2030-04-05",
      });
      expect(result.trip.location).toMatchObject({
        id: "us-ca-san-diego",
        country: "United States",
      });
      expect(stateOf(await loadTripsAction()).trips.map((entry) => entry.id)).toEqual([
        result.trip.id,
      ]);
    });

    it("copies one of the owner's own trips, recording where it came from", async () => {
      const source = await seedTrip(db(), OWNER.userId);
      const result = await createTripAction(
        draft({ mode: "copy", sourceId: source.id, start: "2030-06-01", end: "2030-06-03" }),
      );
      if (!result.ok) throw new Error(`expected ok, got ${result.code}`);
      expect(result.trip.copiedFrom).toBe(source.id);
      expect(result.trip.id).not.toBe(source.id);
    });

    it("cannot copy another owner's trip (NOT_FOUND)", async () => {
      const source = await seedTrip(db(), OTHER_OWNER.userId);
      expect(await createTripAction(draft({ mode: "copy", sourceId: source.id }))).toEqual({
        ok: false,
        code: "NOT_FOUND",
      });
    });

    it("rejects a draft without a confirmed location, bad dates, or an unknown location shape", async () => {
      expect(await createTripAction(draft({ location: null }))).toEqual({
        ok: false,
        code: "INVALID_INPUT",
      });
      expect(await createTripAction(draft({ start: "nope" }))).toEqual({
        ok: false,
        code: "INVALID_INPUT",
      });
      expect(await createTripAction(draft({ location: { ...location, countryCode: "" } }))).toEqual(
        { ok: false, code: "INVALID_INPUT" },
      );
      expect(stateOf(await loadTripsAction()).trips).toEqual([]);
    });

    it("signed out redirects to sign-in; a non-allowlisted user to access-denied; no database is INTERNAL", async () => {
      as(null);
      await expect(createTripAction(draft())).rejects.toThrow("NEXT_REDIRECT:/sign-in");
      as({ userId: "intruder", email: "intruder@example.test" });
      await expect(createTripAction(draft())).rejects.toThrow("NEXT_REDIRECT:/access-denied");
      current = null;
      expect(await createTripAction(draft())).toEqual({ ok: false, code: "INTERNAL" });
    });
  });

  describe("Result -> UI mapping", () => {
    it.each([
      ["load", () => loadTripsAction()],
      ["archive", () => archiveTripAction("00000000-0000-4000-8000-000000000001")],
      ["restore", () => restoreTripAction("00000000-0000-4000-8000-000000000001")],
      ["remove", () => removeTripAction("00000000-0000-4000-8000-000000000001")],
      ["undoRemove", () => undoRemoveTripAction("00000000-0000-4000-8000-000000000001")],
    ])("%s: signed out redirects to sign-in", async (_name, call) => {
      as(null);
      await expect(call()).rejects.toThrow("NEXT_REDIRECT:/sign-in");
    });

    it.each([
      ["load", () => loadTripsAction()],
      ["archive", () => archiveTripAction("00000000-0000-4000-8000-000000000001")],
      ["remove", () => removeTripAction("00000000-0000-4000-8000-000000000001")],
    ])(
      "%s: a non-allowlisted user is redirected to access-denied and signed out",
      async (_name, call) => {
        as({ userId: "intruder", email: "intruder@example.test" });
        await expect(call()).rejects.toThrow("NEXT_REDIRECT:/access-denied");
        expect(fake.current).toBeNull();
      },
    );

    it("a missing database configuration is an INTERNAL result, never a crash", async () => {
      current = null;
      expect(await loadTripsAction()).toEqual({ ok: false, code: "INTERNAL" });
      expect(await archiveTripAction("00000000-0000-4000-8000-000000000001")).toEqual({
        ok: false,
        code: "INTERNAL",
      });
    });

    it("a database failure is an INTERNAL result without any error text", async () => {
      current = {
        ...makeContext(db(), fake),
        db: {
          insert: () => {
            throw new Error("connection refused for db.example.test");
          },
        } as unknown as Db,
      };
      const result = await loadTripsAction();
      expect(result).toEqual({ ok: false, code: "INTERNAL" });
      expect(JSON.stringify(result)).not.toContain("example.test");
    });
  });
});
