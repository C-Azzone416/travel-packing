import * as service from "@/server/data/service";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createMigratedDb, resetData } from "@/server/db/__fixtures__/db";
import type { Db } from "@/server/db/retention";
import {
  createFakeAuth,
  makeContext,
  OTHER_OWNER,
  OWNER,
  seedOwner,
  seedTrip,
  signedInAs,
} from "@/server/data/__fixtures__/seed";
import type { DataContext } from "@/server/data/context";
import { createSavedList } from "@/server/data/saved-list-store";
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
  createTripWithWeatherAction,
  loadTripsAction,
  removeTripAction,
  restoreTripAction,
  undoRemoveTripAction,
} from "./actions";
import { getHomeCityAction } from "./trip-actions";

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
        theme: "travel",
      });
      expect(result.trip.location).toMatchObject({
        id: "us-ca-san-diego",
        country: "United States",
      });
      expect(stateOf(await loadTripsAction()).trips.map((entry) => entry.id)).toEqual([
        result.trip.id,
      ]);
    });

    it("starts a new trip from one of the owner's saved lists when the draft names one (#170)", async () => {
      await seedOwner(db(), OWNER.userId);
      const list = await createSavedList(db(), OWNER.userId, {
        name: "Beach week",
        items: [{ id: "towel", name: "Towel", category: "Other essentials", qty: 2 }],
      });
      const result = await createTripAction(draft({ savedListId: list.id }));
      if (!result.ok) throw new Error(`expected ok, got ${result.code}`);
      expect(result.trip.items.map((entry) => [entry.name, entry.qty, entry.packed])).toEqual([
        ["Towel", 2, 0],
      ]);
    });

    it("refuses a saved list that is not the signed-in owner's", async () => {
      await seedOwner(db(), OTHER_OWNER.userId);
      const theirs = await createSavedList(db(), OTHER_OWNER.userId, {
        name: "Theirs",
        items: [{ id: "a", name: "Hat", category: "Accessories", qty: 1 }],
      });
      expect(await createTripAction(draft({ savedListId: theirs.id }))).toEqual({
        ok: false,
        code: "NOT_FOUND",
      });
    });

    it("ignores a saved list on a copy: a copy never starts from one", async () => {
      const source = await seedTrip(db(), OWNER.userId);
      await seedOwner(db(), OWNER.userId);
      const list = await createSavedList(db(), OWNER.userId, {
        name: "Beach week",
        items: [{ id: "towel", name: "Towel", category: "Other essentials", qty: 2 }],
      });
      const result = await createTripAction(
        draft({
          mode: "copy",
          sourceId: source.id,
          start: "2030-06-01",
          end: "2030-06-03",
          savedListId: list.id,
        }),
      );
      if (!result.ok) throw new Error(`expected ok, got ${result.code}`);
      expect(result.trip.items.some((entry) => entry.name === "Towel")).toBe(false);
    });

    it("copies one of the owner's own trips, preserving its legacy theme without changing the source", async () => {
      const source = await seedTrip(db(), OWNER.userId, { theme: "city" });
      const before = stateOf(await loadTripsAction()).trips.find((trip) => trip.id === source.id);
      const result = await createTripAction(
        draft({ mode: "copy", sourceId: source.id, start: "2030-06-01", end: "2030-06-03" }),
      );
      if (!result.ok) throw new Error(`expected ok, got ${result.code}`);
      expect(result.trip.copiedFrom).toBe(source.id);
      expect(result.trip.id).not.toBe(source.id);
      expect(result.trip.theme).toBe("city");
      expect(stateOf(await loadTripsAction()).trips.find((trip) => trip.id === source.id)).toEqual(
        before,
      );
    });

    it("a copy saves the preferences on the draft, not the source's (#202: Nice outfits turned off on the copy)", async () => {
      const source = await seedTrip(db(), OWNER.userId);
      expect(source.config.niceAttire).toBe(true);
      const result = await createTripAction(
        draft({
          mode: "copy",
          sourceId: source.id,
          start: "2030-06-01",
          end: "2030-06-04",
          config: { ...CONFIG, niceAttire: false },
        }),
      );
      if (!result.ok) throw new Error(`expected ok, got ${result.code}`);
      expect(result.trip.config.niceAttire).toBe(false);
      expect(result.trip.items.some((entry) => entry.id.startsWith("nice-"))).toBe(false);
    });

    it("atomically saves the draft with its Shape-the-list weather rows", async () => {
      const result = await createTripWithWeatherAction(draft(), [
        {
          kind: "add",
          semanticId: "weather-umbrella",
          ruleSignature: "rain",
          item: {
            semanticId: "weather-umbrella",
            name: "Compact umbrella",
            category: "Accessories",
            qty: 1,
            optional: false,
          },
        },
      ]);
      if (!result.ok) throw new Error(`expected ok, got ${result.code}`);
      expect(result.trip.items.find((item) => item.id === "weather-umbrella")).toMatchObject({
        name: "Compact umbrella",
        packed: 0,
      });
      expect(result.trip.weather.status).toBe("accepted");
      expect(result.trip.theme).toBe("travel");

      await resetData(ctx.client);
      const invalid = await createTripWithWeatherAction(draft(), [
        {
          kind: "add",
          semanticId: "bad",
          ruleSignature: "bad",
          item: {
            semanticId: "bad",
            name: "Bad",
            category: "Accessories",
            qty: 0,
            optional: false,
          },
        },
      ]);
      expect(invalid).toEqual({ ok: false, code: "INVALID_INPUT" });
      expect(stateOf(await loadTripsAction()).trips).toEqual([]);
    });

    describe("origin, travel mode and name (#390)", () => {
      const stored = async () =>
        (
          await ctx.client.query(
            "SELECT origin_city, travel_mode, name FROM trips ORDER BY created_at DESC",
          )
        ).rows as { origin_city: string | null; travel_mode: string | null; name: string | null }[];
      const lisbon = {
        id: "pt-lisbon",
        city: "Lisbon",
        region: "Lisbon District",
        country: "Portugal",
        countryCode: "PT",
        label: "Lisbon, Lisbon District, Portugal",
      };

      it("saves where the trip leaves from, how, and the owner's name for it", async () => {
        const result = await createTripAction(
          draft({ origin: lisbon, travelMode: "drive", name: "Road trip" }),
        );
        expect(result.ok).toBe(true);
        expect(await stored()).toEqual([
          { origin_city: "Lisbon", travel_mode: "drive", name: "Road trip" },
        ]);
      });

      it("a null origin means no origin, and a blank name means no name", async () => {
        expect((await createTripAction(draft({ origin: null, name: null }))).ok).toBe(true);
        expect(await stored()).toEqual([{ origin_city: null, travel_mode: null, name: null }]);
      });

      it("leaving the origin out uses the account's home city", async () => {
        await seedOwner(db(), OWNER.userId);
        await service.setHomeCity(makeContext(db(), fake), { location: { id: "pt-lisbon" } });
        expect((await createTripAction(draft())).ok).toBe(true);
        expect((await stored())[0].origin_city).toBe("Lisbon");
      });

      it("cross-user: another owner's home city is never this owner's origin, and this owner's never theirs", async () => {
        await seedOwner(db(), OWNER.userId);
        await seedOwner(db(), OTHER_OWNER.userId);
        await service.setHomeCity(makeContext(db(), fake), { location: { id: "pt-lisbon" } });
        as(OTHER_OWNER);
        await service.setHomeCity(makeContext(db(), fake), { location: { id: "us-co-denver" } });
        expect(await getHomeCityAction()).toMatchObject({
          ok: true,
          home: { location: { city: "Denver" } },
        });

        // The other owner saves a trip without an origin: it takes THEIR home (Denver), never Lisbon.
        expect((await createTripAction(draft())).ok).toBe(true);
        expect((await stored())[0].origin_city).toBe("Denver");

        // Back as the first owner: their own home (Lisbon) is the default, never Denver.
        as(OWNER);
        expect((await createTripAction(draft())).ok).toBe(true);
        expect((await stored())[0].origin_city).toBe("Lisbon");
        expect(await getHomeCityAction()).toMatchObject({
          ok: true,
          home: { location: { city: "Lisbon" } },
        });
      });

      it("cross-user: an owner with no home city gets no origin, even when another owner has one", async () => {
        await seedOwner(db(), OWNER.userId);
        await seedOwner(db(), OTHER_OWNER.userId);
        await service.setHomeCity(makeContext(db(), fake), { location: { id: "pt-lisbon" } });
        as(OTHER_OWNER);
        expect((await createTripAction(draft())).ok).toBe(true);
        expect((await stored())[0].origin_city).toBeNull();
      });

      it("a copy and a weather-reviewed trip take them too", async () => {
        const source = await seedTrip(db(), OWNER.userId);
        await createTripAction(
          draft({
            mode: "copy",
            sourceId: source.id,
            origin: lisbon,
            travelMode: "other",
            name: "Again",
          }),
        );
        expect((await stored())[0]).toEqual({
          origin_city: "Lisbon",
          travel_mode: "other",
          name: "Again",
        });
        await createTripWithWeatherAction(
          draft({ origin: lisbon, travelMode: "fly", name: "Sun" }),
          [],
        );
        expect((await stored())[0]).toEqual({
          origin_city: "Lisbon",
          travel_mode: "fly",
          name: "Sun",
        });
      });

      it("refuses an origin the server does not know", async () => {
        expect(await createTripAction(draft({ origin: { ...lisbon, id: "not-a-place" } }))).toEqual(
          { ok: false, code: "INVALID_INPUT" },
        );
        expect(await stored()).toEqual([]);
      });
    });

    it("cannot copy another owner's trip (NOT_FOUND)", async () => {
      const source = await seedTrip(db(), OTHER_OWNER.userId);
      expect(await createTripAction(draft({ mode: "copy", sourceId: source.id }))).toEqual({
        ok: false,
        code: "NOT_FOUND",
      });
    });

    it("rejects a draft without a confirmed location, bad dates, or a place the server does not know", async () => {
      expect(await createTripAction(draft({ location: null }))).toEqual({
        ok: false,
        code: "INVALID_INPUT",
      });
      expect(await createTripAction(draft({ start: "nope" }))).toEqual({
        ok: false,
        code: "INVALID_INPUT",
      });
      expect(
        await createTripAction(draft({ location: { ...location, id: "not-a-place" } })),
      ).toEqual({ ok: false, code: "INVALID_INPUT" });
      expect(stateOf(await loadTripsAction()).trips).toEqual([]);
    });

    it("sends only the place id: whatever else the browser says about the place is ignored", async () => {
      const result = await createTripAction(
        draft({
          location: { ...location, city: "Forged City", label: "Forged", country: "Nowhere" },
        }),
      );
      if (!result.ok) throw new Error(`expected ok, got ${result.code}`);
      expect(result.trip.destination).toBe("San Diego");
      expect(result.trip.location).toMatchObject({
        label: "San Diego, California, United States",
        country: "United States",
      });
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
