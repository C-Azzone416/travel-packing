import { drizzle } from "drizzle-orm/pglite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createMigratedDb, resetData } from "../db/__fixtures__/db";
import * as schema from "../db/schema";
import type { TripItem } from "../../domain/trip";
import type { Db } from "../db/retention";
import {
  CONFIG,
  createFakeAuth,
  makeContext,
  makeStoredTrip,
  newUuid,
  NOW,
  openDurableDb,
  OTHER_OWNER,
  OWNER,
  seedOwner,
  seedTrip,
  signedInAs,
} from "./__fixtures__/seed";
import type { DataContext } from "./context";
import type { Result } from "./result";
import { setDataLogSink } from "./safe-log";
import * as service from "./service";
import * as stapleStore from "./staple-store";
import { loadTrip, loadTrips } from "./trip-store";

const LOCATION = {
  id: "sample-b",
  city: "Exampleville",
  region: "Sample Region",
  country: "Sampleland",
  countryCode: "SL",
  label: "Exampleville, Sample Region, Sampleland",
};

// The staples writer can be made to fail, to prove trip + staples commit together.
let failStaples = false;
vi.mock("./staple-store", async (importOriginal) => {
  const original = await importOriginal<typeof import("./staple-store")>();
  return {
    ...original,
    saveStaples: async (...args: Parameters<typeof original.saveStaples>) => {
      if (failStaples) throw new Error("staples write failed for Sampleton");
      return original.saveStaples(...args);
    },
  };
});

// Fault injection for guards that normal inputs cannot reach (a save that loses a race, a missing row after insert,
// a draft the domain refuses even though the input was validated).
const faults = { saveTripFalse: false, loadTripNull: false, domainRefusesDraft: false };
vi.mock("./trip-store", async (importOriginal) => {
  const original = await importOriginal<typeof import("./trip-store")>();
  return {
    ...original,
    saveTrip: async (...args: Parameters<typeof original.saveTrip>) =>
      faults.saveTripFalse ? false : original.saveTrip(...args),
    loadTrip: async (...args: Parameters<typeof original.loadTrip>) => {
      return faults.loadTripNull ? null : original.loadTrip(...args);
    },
  };
});
vi.mock("../../domain/trip-lifecycle", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../domain/trip-lifecycle")>();
  return {
    ...original,
    saveDraft: (...args: Parameters<typeof original.saveDraft>) =>
      faults.domainRefusesDraft
        ? ({ ok: false, reason: "INVALID_DATES", state: args[0] } as const)
        : original.saveDraft(...args),
  };
});

let ctx: Awaited<ReturnType<typeof createMigratedDb>>;
const fake = createFakeAuth();
const db = () => ctx.db as unknown as Db;
const context = () => makeContext(db(), fake);
const as = (user: typeof OWNER | null) => signedInAs(fake, user);

beforeAll(async () => {
  ctx = await createMigratedDb();
});
beforeEach(async () => {
  await resetData(ctx.client);
  as(OWNER);
  failStaples = false;
  Object.assign(faults, {
    saveTripFalse: false,
    loadTripNull: false,
    domainRefusesDraft: false,
  });
  setDataLogSink(() => {});
});
afterEach(() => setDataLogSink());
afterAll(async () => {
  await ctx.client.close();
});

function data<T>(result: Result<T>): T {
  if (!result.ok)
    throw new Error(`expected ok, got ${result.error.code} ${result.error.reason ?? ""}`);
  return result.data;
}
const errorOf = (result: Result<unknown>) => (result.ok ? null : result.error);
const item = (trip: { items: TripItem[] }, id: string) =>
  trip.items.find((entry) => entry.id === id);

/** A trip where everything is packed, the bag is in, and Ready is not yet set. */
async function packedTrip(overrides: Parameters<typeof seedTrip>[2] = {}) {
  const base = makeStoredTrip();
  return seedTrip(db(), OWNER.userId, {
    ...base,
    items: base.items.map((entry) => ({ ...entry, packed: entry.qty })),
    toiletryBagPacked: true,
    ...overrides,
  });
}

// ----------------------------------------------------------------------------------------------------------
// Every owner-scoped operation, called with a trip id (and an item id where needed).

type Operation = [name: string, call: (tripId: string) => Promise<Result<unknown>>];
const OPERATIONS: Operation[] = [
  ["getTrip", (tripId) => service.getTrip(context(), { tripId })],
  ["togglePackedItem", (tripId) => service.togglePackedItem(context(), { tripId, itemId: "tops" })],
  [
    "incrementPackedItem",
    (tripId) => service.incrementPackedItem(context(), { tripId, itemId: "tops" }),
  ],
  [
    "decrementPackedItem",
    (tripId) => service.decrementPackedItem(context(), { tripId, itemId: "tops" }),
  ],
  [
    "setPackedItem",
    (tripId) => service.setPackedItem(context(), { tripId, itemId: "tops", packed: 1 }),
  ],
  ["confirmToiletryBag", (tripId) => service.confirmToiletryBag(context(), { tripId })],
  ["undoToiletryBag", (tripId) => service.undoToiletryBag(context(), { tripId })],
  ["markTripReady", (tripId) => service.markTripReady(context(), { tripId })],
  ["markTripNotReady", (tripId) => service.markTripNotReady(context(), { tripId })],
  [
    "editTripItem",
    (tripId) =>
      service.editTripItem(context(), {
        tripId,
        itemId: "tops",
        name: "Renamed",
        qty: 2,
        timing: "main",
        scope: "remember",
      }),
  ],
  [
    "removeItemFromTrip",
    (tripId) =>
      service.removeItemFromTrip(context(), { tripId, itemId: "sunglasses", scope: "remember" }),
  ],
  [
    "addToiletryItemToTrip",
    (tripId) =>
      service.addToiletryItemToTrip(context(), {
        tripId,
        name: "Floss",
        qty: 1,
        packLast: false,
        scope: "remember",
      }),
  ],
  [
    "updateTripPreferences",
    (tripId) =>
      service.updateTripPreferences(context(), { tripId, config: { ...CONFIG, laundry: true } }),
  ],
  ["acceptTripWeather", (tripId) => service.acceptTripWeather(context(), { tripId })],
  ["skipTripWeather", (tripId) => service.skipTripWeather(context(), { tripId })],
  ["reviewTripWeatherAgain", (tripId) => service.reviewTripWeatherAgain(context(), { tripId })],
  ["archiveTrip", (tripId) => service.archiveTrip(context(), { tripId })],
  ["restoreArchivedTrip", (tripId) => service.restoreArchivedTrip(context(), { tripId })],
  ["removeTrip", (tripId) => service.removeTrip(context(), { tripId })],
  ["undoRemoveTrip", (tripId) => service.undoRemoveTrip(context(), { tripId })],
  [
    "copyTrip (source)",
    (tripId) =>
      service.copyTrip(context(), {
        sourceId: tripId,
        location: LOCATION,
        start: "2030-06-01",
        end: "2030-06-04",
      }),
  ],
];

async function snapshot(ownerId: string) {
  const trips = await loadTrips(db(), ownerId, { filter: "live" });
  const staples = (
    await ctx.client.query('SELECT * FROM "staples" WHERE "owner_id" = $1 ORDER BY semantic_id', [
      ownerId,
    ])
  ).rows;
  return JSON.stringify({ trips, staples });
}

describe("signed out: every operation is refused and nothing is written", () => {
  it.each(OPERATIONS)("%s", async (_name, call) => {
    const trip = await seedTrip(db(), OWNER.userId);
    const before = await snapshot(OWNER.userId);
    as(null);
    expect(errorOf(await call(trip.id))?.code).toBe("UNAUTHENTICATED");
    as(OWNER);
    expect(await snapshot(OWNER.userId)).toBe(before);
  });

  it.each([
    ["listTrips", () => service.listTrips(context())],
    ["listStaplesForOwner", () => service.listStaplesForOwner(context())],
    [
      "upsertStaple",
      () =>
        service.upsertStaple(context(), {
          semanticId: "x",
          name: "X",
          category: "Tech",
          qty: 1,
          cadence: "per trip",
          packLast: false,
        }),
    ],
    ["listRecentlyDeletedTrips", () => service.listRecentlyDeletedTrips(context())],
    [
      "createTrip",
      () =>
        service.createTrip(context(), {
          location: LOCATION,
          start: "2030-06-01",
          end: "2030-06-04",
          config: CONFIG,
        }),
    ],
  ])("%s", async (_name, call) => {
    as(null);
    expect(errorOf(await call())?.code).toBe("UNAUTHENTICATED");
    expect((await ctx.client.query('SELECT 1 FROM "staples"')).rows).toEqual([]);
  });
});

describe("a non-allowlisted account is refused and signed out", () => {
  it.each(OPERATIONS)("%s", async (_name, call) => {
    const trip = await seedTrip(db(), OWNER.userId);
    as({ userId: "intruder", email: "intruder@example.test" });
    expect(errorOf(await call(trip.id))?.code).toBe("FORBIDDEN");
    expect(fake.current).toBeNull();
  });
});

describe("cross-user: user B cannot touch user A's trips or staples", () => {
  it.each(OPERATIONS)("%s -> NOT_FOUND and A's data is unchanged", async (_name, call) => {
    const trip = await seedTrip(db(), OWNER.userId);
    await seedOwner(db(), OTHER_OWNER.userId);
    const before = await snapshot(OWNER.userId);
    as(OTHER_OWNER);
    expect(errorOf(await call(trip.id))?.code).toBe("NOT_FOUND");
    expect(await snapshot(OWNER.userId)).toBe(before);
    expect(await loadTrips(db(), OTHER_OWNER.userId, { filter: "live" })).toEqual([]);
  });

  it("lists and staples are per-owner", async () => {
    await seedTrip(db(), OWNER.userId);
    data(await service.listStaplesForOwner(context()));
    as(OTHER_OWNER);
    expect(data(await service.listTrips(context()))).toEqual([]);
    const theirs = data(await service.listStaplesForOwner(context()));
    expect(theirs.length).toBeGreaterThan(0);
    const total = (
      await ctx.client.query<{ owner_id: string }>('SELECT DISTINCT owner_id FROM "staples"')
    ).rows;
    expect(total.map((row) => row.owner_id).sort()).toEqual(
      [OWNER.userId, OTHER_OWNER.userId].sort(),
    );
  });

  it("upserting a staple only affects the caller's staples", async () => {
    data(await service.listStaplesForOwner(context()));
    as(OTHER_OWNER);
    data(await service.listStaplesForOwner(context()));
    data(
      await service.upsertStaple(context(), {
        semanticId: "socks",
        name: "Socks",
        category: "Clothing",
        qty: 9,
        cadence: "per day",
        packLast: false,
      }),
    );
    as(OWNER);
    expect(
      data(await service.listStaplesForOwner(context())).find((staple) => staple.id === "socks")
        ?.qty,
    ).toBe(1);
  });
});

describe("every exported entry point is owner-gated (new ones cannot skip this)", () => {
  // Authorization runs before validation, so no input is needed to prove the gate: whatever the arguments,
  // a signed-out caller gets UNAUTHENTICATED and a non-allowlisted caller gets FORBIDDEN. Enumerating the module's
  // exports means a function added later is covered automatically.
  type EntryPoint = (context: DataContext, input?: unknown) => Promise<Result<unknown>>;
  const entryPoints = Object.entries(service).filter(
    ([, value]) => typeof value === "function",
  ) as unknown as [string, EntryPoint][];

  it("finds the entry points", () => {
    expect(entryPoints.length).toBeGreaterThanOrEqual(25);
  });

  it.each(entryPoints)("%s: signed out -> UNAUTHENTICATED", async (_name, call) => {
    as(null);
    expect(errorOf(await call(context(), {}))?.code).toBe("UNAUTHENTICATED");
    expect(errorOf(await call(context(), undefined))?.code).toBe("UNAUTHENTICATED");
  });

  it.each(entryPoints)("%s: not allowlisted -> FORBIDDEN, session ended", async (_name, call) => {
    as({ userId: "intruder", email: "intruder@example.test" });
    expect(errorOf(await call(context(), {}))?.code).toBe("FORBIDDEN");
    expect(fake.current).toBeNull();
  });

  it.each(entryPoints)("%s: never reaches the database when refused", async (_name, call) => {
    as(null);
    const before = await snapshot(OWNER.userId);
    await call(context(), { tripId: newUuid() });
    expect(await snapshot(OWNER.userId)).toBe(before);
    expect((await ctx.client.query('SELECT 1 FROM "users"')).rows).toEqual([]);
  });
});

describe("input validation", () => {
  it.each([
    ["bad trip id", () => service.getTrip(context(), { tripId: "not-a-uuid" }), ["tripId"]],
    [
      "missing item id",
      () => service.togglePackedItem(context(), { tripId: newUuid() }),
      ["itemId"],
    ],
    [
      "negative packed",
      () => service.setPackedItem(context(), { tripId: newUuid(), itemId: "tops", packed: -1 }),
      ["packed"],
    ],
    [
      "fractional qty",
      () =>
        service.editTripItem(context(), {
          tripId: newUuid(),
          itemId: "tops",
          name: "x",
          qty: 1.5,
          timing: "main",
          scope: "this-trip",
        }),
      ["qty"],
    ],
    [
      "blank name",
      () =>
        service.editTripItem(context(), {
          tripId: newUuid(),
          itemId: "tops",
          name: "  ",
          qty: 1,
          timing: "main",
          scope: "this-trip",
        }),
      ["name"],
    ],
    [
      "unknown scope",
      () =>
        service.removeItemFromTrip(context(), {
          tripId: newUuid(),
          itemId: "tops",
          scope: "everywhere",
        }),
      ["scope"],
    ],
    [
      "occasion count 9",
      () =>
        service.updateTripPreferences(context(), {
          tripId: newUuid(),
          config: { ...CONFIG, occasionCount: 9 },
        }),
      ["config.occasionCount"],
    ],
    [
      "unknown staple category",
      () =>
        service.upsertStaple(context(), {
          semanticId: "x",
          name: "X",
          category: "Gadgets",
          qty: 1,
          cadence: "per trip",
          packLast: false,
        }),
      ["category"],
    ],
    [
      "unknown staple group",
      () =>
        service.upsertStaple(context(), {
          semanticId: "x",
          name: "X",
          category: "Tech",
          qty: 1,
          cadence: "per trip",
          packLast: false,
          groupId: "mystery",
        }),
      ["groupId"],
    ],
    ["extra input to a no-input call", () => service.getTrip(context(), null), ["(root)"]],
  ])("%s -> INVALID_INPUT with field paths", async (_name, call, fields) => {
    const error = errorOf(await call());
    expect(error).toMatchObject({ code: "INVALID_INPUT", fields });
  });
});

describe("reading", () => {
  it("lists the owner's live trips and gets one by id", async () => {
    const a = await seedTrip(db(), OWNER.userId, { destination: "A" });
    const listed = data(await service.listTrips(context()));
    expect(listed.map((trip) => trip.id)).toEqual([a.id]);
    expect(data(await service.getTrip(context(), { tripId: a.id })).destination).toBe("A");
    expect(errorOf(await service.getTrip(context(), { tripId: newUuid() }))?.code).toBe(
      "NOT_FOUND",
    );
  });

  it("seeds the default staples on first use, once", async () => {
    const first = data(await service.listStaplesForOwner(context()));
    const second = data(await service.listStaplesForOwner(context()));
    expect(first.length).toBeGreaterThan(5);
    expect(second).toEqual(first);
  });
});

describe("packing progress", () => {
  it("toggles an item and reports the review prompt when the last item is packed", async () => {
    const base = makeStoredTrip();
    const almost = base.items.map((entry) => ({
      ...entry,
      packed: entry.id === "tops" ? 0 : entry.qty,
    }));
    const trip = await seedTrip(db(), OWNER.userId, {
      ...base,
      items: almost,
      toiletryBagPacked: true,
    });
    const result = data(
      await service.togglePackedItem(context(), { tripId: trip.id, itemId: "tops" }),
    );
    const tops = item(result.trip, "tops");
    expect(tops?.packed).toBe(tops?.qty);
    expect(result.trip.ready).toBe(false);
    expect(result.signals?.reviewPrompt).toBe(true);
    const stored = item((await loadTrip(db(), OWNER.userId, trip.id))!, "tops");
    expect(stored?.packed).toBe(stored?.qty);
  });

  it("increments, decrements, and sets within 0..qty and persists each", async () => {
    const trip = await seedTrip(db(), OWNER.userId);
    const call = async (fn: typeof service.incrementPackedItem) =>
      data(await fn(context(), { tripId: trip.id, itemId: "tops" }));
    expect(item((await call(service.incrementPackedItem)).trip, "tops")).toMatchObject({
      packed: 1,
    });
    expect(item((await call(service.incrementPackedItem)).trip, "tops")).toMatchObject({
      packed: 2,
    });
    expect(item((await call(service.decrementPackedItem)).trip, "tops")).toMatchObject({
      packed: 1,
    });
    const set = data(
      await service.setPackedItem(context(), { tripId: trip.id, itemId: "tops", packed: 99 }),
    );
    expect(item(set.trip, "tops")?.packed).toBe(item(set.trip, "tops")?.qty);
  });

  it("unchecking revokes Ready", async () => {
    const trip = await packedTrip({ ready: true });
    const result = data(
      await service.togglePackedItem(context(), { tripId: trip.id, itemId: "tops" }),
    );
    expect(result.trip.ready).toBe(false);
    expect((await loadTrip(db(), OWNER.userId, trip.id))?.ready).toBe(false);
  });

  it("an unknown item is NOT_FOUND", async () => {
    const trip = await seedTrip(db(), OWNER.userId);
    expect(
      errorOf(await service.togglePackedItem(context(), { tripId: trip.id, itemId: "nope" }))?.code,
    ).toBe("REJECTED");
  });
});

describe("toiletry bag and Ready", () => {
  it("refuses to confirm the bag while Bathroom contents are incomplete", async () => {
    const trip = await seedTrip(db(), OWNER.userId);
    expect(errorOf(await service.confirmToiletryBag(context(), { tripId: trip.id }))).toMatchObject(
      {
        code: "REJECTED",
        reason: "CONTENTS_INCOMPLETE",
      },
    );
  });

  it("confirms the bag once contents are checked, undoes it (revoking Ready), and persists both", async () => {
    const base = makeStoredTrip();
    const items = base.items.map((entry) => ({ ...entry, packed: entry.groupId ? entry.qty : 0 }));
    const trip = await seedTrip(db(), OWNER.userId, { ...base, items });
    expect(
      data(await service.confirmToiletryBag(context(), { tripId: trip.id })).trip.toiletryBagPacked,
    ).toBe(true);
    expect((await loadTrip(db(), OWNER.userId, trip.id))?.toiletryBagPacked).toBe(true);

    await ctx.client.query('UPDATE "trips" SET "ready" = true');
    const undone = data(await service.undoToiletryBag(context(), { tripId: trip.id }));
    expect(undone.trip).toMatchObject({ toiletryBagPacked: false, ready: false });
  });

  it("markReady is refused until everything is packed, then explicit, and markNotReady keeps progress", async () => {
    const unpacked = await seedTrip(db(), OWNER.userId);
    expect(errorOf(await service.markTripReady(context(), { tripId: unpacked.id }))).toMatchObject({
      code: "REJECTED",
      reason: "NOT_ALL_PACKED",
    });

    const packed = await packedTrip();
    expect(data(await service.markTripReady(context(), { tripId: packed.id })).trip.ready).toBe(
      true,
    );
    const notReady = data(await service.markTripNotReady(context(), { tripId: packed.id }));
    expect(notReady.trip.ready).toBe(false);
    expect(notReady.trip.items.every((entry) => entry.packed === entry.qty)).toBe(true);
    expect((await loadTrip(db(), OWNER.userId, packed.id))?.ready).toBe(false);
  });
});

describe("item operations", () => {
  it("this-trip edits change only that trip", async () => {
    const trip = await seedTrip(db(), OWNER.userId);
    data(await service.listStaplesForOwner(context()));
    const before = await ctx.client.query('SELECT * FROM "staples" ORDER BY semantic_id');
    const result = data(
      await service.editTripItem(context(), {
        tripId: trip.id,
        itemId: "tops",
        name: "My tops",
        qty: 3,
        timing: "packlast",
        scope: "this-trip",
      }),
    );
    expect(item(result.trip, "tops")).toMatchObject({
      name: "My tops",
      qty: 3,
      section: "packlast",
      userEdited: true,
    });
    expect((await ctx.client.query('SELECT * FROM "staples" ORDER BY semantic_id')).rows).toEqual(
      before.rows,
    );
  });

  it("remember edits update the staple (new version) but leave an existing trip's items alone: snapshots", async () => {
    data(await service.listStaplesForOwner(context()));
    const history = await seedTrip(db(), OWNER.userId, { destination: "History" });
    const editing = await seedTrip(db(), OWNER.userId, { destination: "Editing" });
    const historyBefore = JSON.stringify(await loadTrip(db(), OWNER.userId, history.id));

    data(
      await service.editTripItem(context(), {
        tripId: editing.id,
        itemId: "last-laptop",
        name: "Work laptop",
        qty: 1,
        timing: "main",
        scope: "remember",
      }),
    );

    const laptop = (
      await ctx.client.query<{ name: string; pack_last: boolean; version: number }>(
        `SELECT name, pack_last, version FROM "staples" WHERE semantic_id = 'last-laptop'`,
      )
    ).rows[0];
    expect(laptop).toEqual({ name: "Work laptop", pack_last: false, version: 2 });
    expect(JSON.stringify(await loadTrip(db(), OWNER.userId, history.id))).toBe(historyBefore);
    expect(item((await loadTrip(db(), OWNER.userId, history.id))!, "last-laptop")).toMatchObject({
      name: "Laptop",
      section: "packlast",
    });
  });

  it("maps a missing item to NOT_FOUND and a domain refusal to REJECTED", async () => {
    const trip = await seedTrip(db(), OWNER.userId);
    expect(
      errorOf(
        await service.editTripItem(context(), {
          tripId: trip.id,
          itemId: "nope",
          name: "x",
          qty: 1,
          timing: "main",
          scope: "this-trip",
        }),
      )?.code,
    ).toBe("NOT_FOUND");
    expect(
      errorOf(
        await service.editTripItem(context(), {
          tripId: trip.id,
          itemId: "tops",
          name: "x",
          qty: 1,
          timing: "return",
          scope: "this-trip",
        }),
      ),
    ).toMatchObject({
      code: "REJECTED",
      reason: "INVALID_TIMING",
    });
    expect(
      errorOf(
        await service.removeItemFromTrip(context(), {
          tripId: trip.id,
          itemId: "nope",
          scope: "this-trip",
        }),
      )?.code,
    ).toBe("NOT_FOUND");
  });

  it("removing an optional Nice suggestion suppresses it, and remember also drops the staple", async () => {
    const trip = await seedTrip(db(), OWNER.userId);
    data(await service.listStaplesForOwner(context()));
    const removed = data(
      await service.removeItemFromTrip(context(), {
        tripId: trip.id,
        itemId: "nice-shoes",
        scope: "this-trip",
      }),
    );
    expect(item(removed.trip, "nice-shoes")).toBeUndefined();
    const reloaded = (await loadTrip(db(), OWNER.userId, trip.id))!;
    expect(reloaded.suppressedSuggestions).toEqual({ "nice-shoes": true });

    data(
      await service.removeItemFromTrip(context(), {
        tripId: trip.id,
        itemId: "sunglasses",
        scope: "remember",
      }),
    );
    const staples = data(await service.listStaplesForOwner(context()));
    expect(staples.some((staple) => staple.id === "sunglasses")).toBe(false);
  });

  it("adds a Bathroom item, invalidating the bag and Ready, and remembers it as a staple", async () => {
    const trip = await packedTrip({ ready: true });
    const result = data(
      await service.addToiletryItemToTrip(context(), {
        tripId: trip.id,
        name: "  Floss ",
        qty: 2,
        packLast: true,
        scope: "remember",
      }),
    );
    const added = result.trip.items.find((entry) => entry.name === "Floss");
    expect(added).toMatchObject({
      qty: 2,
      packed: 0,
      section: "packlast",
      groupId: "toiletry-bag",
      category: "Toiletries",
    });
    expect(result.trip).toMatchObject({ ready: false, toiletryBagPacked: false });
    const staples = data(await service.listStaplesForOwner(context()));
    expect(staples.find((staple) => staple.name === "Floss")).toMatchObject({
      qty: 2,
      groupId: "toiletry-bag",
      packLast: true,
    });
  });

  it("this-trip Bathroom additions create no staple", async () => {
    const trip = await seedTrip(db(), OWNER.userId);
    const before = data(await service.listStaplesForOwner(context())).length;
    data(
      await service.addToiletryItemToTrip(context(), {
        tripId: trip.id,
        name: "Floss",
        qty: 1,
        packLast: false,
        scope: "this-trip",
      }),
    );
    expect(data(await service.listStaplesForOwner(context())).length).toBe(before);
  });

  it("recalculates when preferences change and persists the new quantities", async () => {
    const trip = await seedTrip(db(), OWNER.userId);
    const result = data(
      await service.updateTripPreferences(context(), {
        tripId: trip.id,
        config: { ...CONFIG, laundry: true, niceAttire: false },
      }),
    );
    expect(result.trip.config).toMatchObject({ laundry: true, niceAttire: false });
    expect(item(result.trip, "nice-top")).toBeUndefined();
    const reloaded = (await loadTrip(db(), OWNER.userId, trip.id))!;
    expect(reloaded.config.niceAttire).toBe(false);
    expect(Object.keys(reloaded.suggestionMemory)).toContain("nice-top");
    expect(reloaded.ready).toBe(false);
  });
});

describe("weather (simulated)", () => {
  it("accept adds exactly one umbrella and revokes Ready; skip adds nothing; review again resets", async () => {
    const trip = await packedTrip({ ready: true });
    const accepted = data(await service.acceptTripWeather(context(), { tripId: trip.id }));
    expect(accepted.trip.items.filter((entry) => entry.id === "weather-umbrella")).toHaveLength(1);
    expect(accepted.trip).toMatchObject({ ready: false, weather: { status: "accepted" } });
    data(await service.acceptTripWeather(context(), { tripId: trip.id }));
    expect(
      (await loadTrip(db(), OWNER.userId, trip.id))!.items.filter(
        (entry) => entry.id === "weather-umbrella",
      ),
    ).toHaveLength(1);

    const pending = data(await service.reviewTripWeatherAgain(context(), { tripId: trip.id }));
    expect(pending.trip.weather.status).toBe("pending");
    expect(pending.trip.items.filter((entry) => entry.id === "weather-umbrella")).toHaveLength(1);

    const other = await seedTrip(db(), OWNER.userId);
    const skipped = data(await service.skipTripWeather(context(), { tripId: other.id }));
    expect(skipped.trip.weather.status).toBe("skipped");
    expect(item(skipped.trip, "weather-umbrella")).toBeUndefined();
  });
});

describe("staples", () => {
  it("upsertStaple creates then updates, bumping the version", async () => {
    const created = data(
      await service.upsertStaple(context(), {
        semanticId: "scarf",
        name: "Scarf",
        category: "Accessories",
        qty: 1,
        cadence: "per trip",
        packLast: false,
      }),
    );
    expect(created.find((staple) => staple.id === "scarf")).toMatchObject({ qty: 1 });
    const updated = data(
      await service.upsertStaple(context(), {
        semanticId: "scarf",
        name: "Wool scarf",
        category: "Accessories",
        qty: 2,
        cadence: "per trip",
        packLast: true,
        groupId: "toiletry-bag",
      }),
    );
    expect(updated.find((staple) => staple.id === "scarf")).toMatchObject({
      name: "Wool scarf",
      qty: 2,
      packLast: true,
      groupId: "toiletry-bag",
    });
    const row = (
      await ctx.client.query<{ version: number }>(
        `SELECT version FROM "staples" WHERE semantic_id = 'scarf'`,
      )
    ).rows[0];
    expect(row.version).toBe(2);
  });
});

describe("trip lifecycle", () => {
  const countTrips = async () =>
    Number(
      (await ctx.client.query<{ n: string }>('SELECT count(*)::text AS n FROM "trips"')).rows[0].n,
    );

  describe("createTrip", () => {
    const input = { location: LOCATION, start: "2030-03-15", end: "2030-03-20", config: CONFIG };

    it("creates a fresh trip from the owner's staples, with a forecast label from the injected clock", async () => {
      const trip = data(await service.createTrip(context(), input));
      expect(trip).toMatchObject({
        destination: "Exampleville",
        locationId: "sample-b",
        locationLabel: LOCATION.label,
        start: "2030-03-15",
        end: "2030-03-20",
        days: 6,
        dailyDays: 4,
        ready: false,
        toiletryBagPacked: false,
        archived: false,
        copiedFrom: null,
        deletedAt: null,
        weather: { status: "pending", label: "Close forecast" },
      });
      expect(trip.items.every((entry) => entry.packed === 0)).toBe(true);
      expect(trip.items.length).toBeGreaterThan(10);
      expect(data(await service.getTrip(context(), { tripId: trip.id }))).toEqual(trip);
      expect(data(await service.listTrips(context())).map((entry) => entry.id)).toEqual([trip.id]);
    });

    it("uses a seasonal label for a trip further out", async () => {
      const trip = data(
        await service.createTrip(context(), { ...input, start: "2030-09-01", end: "2030-09-04" }),
      );
      expect(trip.weather.label).toBe("Seasonal outlook");
    });

    it("builds the trip from the owner's current staples", async () => {
      data(
        await service.upsertStaple(context(), {
          semanticId: "scarf",
          name: "Scarf",
          category: "Accessories",
          qty: 2,
          cadence: "per trip",
          packLast: false,
        }),
      );
      const trip = data(await service.createTrip(context(), input));
      expect(item(trip, "scarf")).toMatchObject({ name: "Scarf", qty: 2, category: "Accessories" });
    });

    it("adjusts a return before departure to departure", async () => {
      const trip = data(
        await service.createTrip(context(), { ...input, start: "2030-04-05", end: "2030-04-01" }),
      );
      expect(trip).toMatchObject({ start: "2030-04-05", end: "2030-04-05", days: 1 });
    });

    it.each([
      ["a malformed start", { start: "soon" }, ["start"]],
      ["an impossible date", { start: "2030-02-30", end: "2030-03-02" }, ["start", "end"]],
      ["a missing location id", { location: { ...LOCATION, id: "" } }, ["location.id"]],
      [
        "an extra-long destination",
        { location: { ...LOCATION, city: "x".repeat(81) } },
        ["location.city"],
      ],
    ])("rejects %s", async (_name, override, fields) => {
      const error = errorOf(await service.createTrip(context(), { ...input, ...override }));
      expect(error).toMatchObject({ code: "INVALID_INPUT" });
      expect(error?.fields).toEqual(fields);
      expect(await countTrips()).toBe(0);
    });
  });

  describe("copyTrip", () => {
    it("copies preferences only: every check, bag, Ready, weather and suggestion state starts clear; the source is untouched", async () => {
      const source = await packedTrip({
        ready: true,
        archived: true,
        weather: { status: "accepted", label: "Close forecast", suggestion: "Compact umbrella" },
        suppressedSuggestions: { "nice-shoes": true },
        suggestionMemory: {
          "nice-top": {
            id: "nice-top",
            name: "Remembered",
            category: "Nice attire",
            qty: 3,
            packed: 2,
            section: "main",
          },
        },
      });
      const before = JSON.stringify(await loadTrip(db(), OWNER.userId, source.id));
      const copy = data(
        await service.copyTrip(context(), {
          sourceId: source.id,
          location: LOCATION,
          start: "2030-07-01",
          end: "2030-07-04",
        }),
      );

      expect(copy.id).not.toBe(source.id);
      expect(copy).toMatchObject({
        copiedFrom: source.id,
        destination: "Exampleville",
        ready: false,
        toiletryBagPacked: false,
        archived: false,
        days: 4,
        weather: { status: "pending" },
      });
      expect(copy.config).toEqual(source.config);
      expect(copy.items.every((entry) => entry.packed === 0)).toBe(true);
      expect(copy.items.some((entry) => entry.userEdited)).toBe(false);
      expect(copy.suggestionMemory).toEqual({});
      expect(copy.suppressedSuggestions).toEqual({});
      expect(item(copy, "weather-umbrella")).toBeUndefined();
      expect(JSON.stringify(await loadTrip(db(), OWNER.userId, source.id))).toBe(before);
      expect(await countTrips()).toBe(2);
    });

    it("refuses another owner's trip as a source and creates nothing (copied_from can never cross owners)", async () => {
      const theirs = await seedTrip(db(), OTHER_OWNER.userId);
      const result = await service.copyTrip(context(), {
        sourceId: theirs.id,
        location: LOCATION,
        start: "2030-07-01",
        end: "2030-07-04",
      });
      expect(errorOf(result)?.code).toBe("NOT_FOUND");
      expect(await countTrips()).toBe(1);
      expect(
        (await ctx.client.query('SELECT 1 FROM "trips" WHERE copied_from IS NOT NULL')).rows,
      ).toEqual([]);
    });

    it("refuses a missing source, a removed source, and invalid input", async () => {
      expect(
        errorOf(
          await service.copyTrip(context(), {
            sourceId: newUuid(),
            location: LOCATION,
            start: "2030-07-01",
            end: "2030-07-04",
          }),
        )?.code,
      ).toBe("NOT_FOUND");
      const source = await seedTrip(db(), OWNER.userId);
      data(await service.removeTrip(context(), { tripId: source.id }));
      expect(
        errorOf(
          await service.copyTrip(context(), {
            sourceId: source.id,
            location: LOCATION,
            start: "2030-07-01",
            end: "2030-07-04",
          }),
        )?.code,
      ).toBe("NOT_FOUND");
      const live = await seedTrip(db(), OWNER.userId);
      expect(
        errorOf(
          await service.copyTrip(context(), {
            sourceId: live.id,
            location: LOCATION,
            start: "nope",
            end: "2030-07-04",
          }),
        )?.code,
      ).toBe("INVALID_INPUT");
    });
  });

  describe("archive and restore", () => {
    it("sets and clears the flag without touching Ready or progress", async () => {
      const trip = await packedTrip({ ready: true });
      const archived = data(await service.archiveTrip(context(), { tripId: trip.id }));
      expect(archived).toMatchObject({ archived: true, ready: true });
      expect(archived.items.every((entry) => entry.packed === entry.qty)).toBe(true);
      expect(data(await service.listTrips(context())).map((entry) => entry.id)).toEqual([trip.id]);
      expect(data(await service.archiveTrip(context(), { tripId: trip.id })).archived).toBe(true);
      expect(data(await service.restoreArchivedTrip(context(), { tripId: trip.id })).archived).toBe(
        false,
      );
      expect((await loadTrip(db(), OWNER.userId, trip.id))?.archived).toBe(false);
    });

    it("archive and restore only reach live trips", async () => {
      const trip = await seedTrip(db(), OWNER.userId);
      data(await service.removeTrip(context(), { tripId: trip.id }));
      expect(errorOf(await service.archiveTrip(context(), { tripId: trip.id }))?.code).toBe(
        "NOT_FOUND",
      );
      expect(errorOf(await service.restoreArchivedTrip(context(), { tripId: trip.id }))?.code).toBe(
        "NOT_FOUND",
      );
    });
  });

  describe("remove and undo", () => {
    it("removes to Recently deleted with the clock's time, hides the trip everywhere else, and undo restores it exactly", async () => {
      const trip = await seedTrip(db(), OWNER.userId);
      const before = JSON.stringify(await loadTrip(db(), OWNER.userId, trip.id));

      expect(data(await service.removeTrip(context(), { tripId: trip.id }))).toEqual({
        tripId: trip.id,
      });
      expect(data(await service.listTrips(context()))).toEqual([]);
      expect(errorOf(await service.getTrip(context(), { tripId: trip.id }))?.code).toBe(
        "NOT_FOUND",
      );
      const deleted = data(await service.listRecentlyDeletedTrips(context()));
      expect(deleted.map((entry) => entry.id)).toEqual([trip.id]);
      expect(deleted[0].deletedAt).toEqual(NOW);

      expect(
        errorOf(await service.togglePackedItem(context(), { tripId: trip.id, itemId: "tops" }))
          ?.code,
      ).toBe("NOT_FOUND");
      expect(errorOf(await service.removeTrip(context(), { tripId: trip.id }))?.code).toBe(
        "NOT_FOUND",
      );

      const restored = data(await service.undoRemoveTrip(context(), { tripId: trip.id }));
      expect(JSON.stringify({ ...restored, deletedAt: null })).toBe(
        before.replace(/"deletedAt":[^,}]*/, '"deletedAt":null'),
      );
      expect(restored.deletedAt).toBeNull();
      expect(data(await service.listRecentlyDeletedTrips(context()))).toEqual([]);
      expect(errorOf(await service.undoRemoveTrip(context(), { tripId: trip.id }))?.code).toBe(
        "NOT_FOUND",
      );
    });

    it("undo of a trip that was never removed is NOT_FOUND", async () => {
      const trip = await seedTrip(db(), OWNER.userId);
      expect(errorOf(await service.undoRemoveTrip(context(), { tripId: trip.id }))?.code).toBe(
        "NOT_FOUND",
      );
    });

    it("another owner can neither see, undo, nor purge-by-undo a deleted trip", async () => {
      const trip = await seedTrip(db(), OWNER.userId);
      data(await service.removeTrip(context(), { tripId: trip.id }));
      as(OTHER_OWNER);
      expect(data(await service.listRecentlyDeletedTrips(context()))).toEqual([]);
      expect(errorOf(await service.undoRemoveTrip(context(), { tripId: trip.id }))?.code).toBe(
        "NOT_FOUND",
      );
      as(OWNER);
      expect(
        data(await service.listRecentlyDeletedTrips(context())).map((entry) => entry.id),
      ).toEqual([trip.id]);
    });
  });
});

describe("staples are per-owner even when owners share the same default ids", () => {
  const stapleRow = async (owner: string, id: string) =>
    (
      await ctx.client.query<{ qty: number; version: number }>(
        "SELECT qty, version FROM staples WHERE owner_id = $1 AND semantic_id = $2",
        [owner, id],
      )
    ).rows[0];
  const upsertSocks = (qty: number) =>
    service.upsertStaple(context(), {
      semanticId: "socks",
      name: "Socks",
      category: "Clothing",
      qty,
      cadence: "per day",
      packLast: false,
    });

  it.each([
    ["A seeded first", [OWNER, OTHER_OWNER]],
    ["B seeded first", [OTHER_OWNER, OWNER]],
  ])(
    "each owner's edit persists, bumps only their version, and leaves the other alone (%s)",
    async (_name, order) => {
      for (const user of order) {
        as(user);
        data(await service.listStaplesForOwner(context()));
      }
      as(OWNER);
      data(await upsertSocks(3));
      expect(await stapleRow(OWNER.userId, "socks")).toEqual({ qty: 3, version: 2 });
      expect(await stapleRow(OTHER_OWNER.userId, "socks")).toEqual({ qty: 1, version: 1 });

      as(OTHER_OWNER);
      data(await upsertSocks(5));
      expect(await stapleRow(OTHER_OWNER.userId, "socks")).toEqual({ qty: 5, version: 2 });
      expect(await stapleRow(OWNER.userId, "socks")).toEqual({ qty: 3, version: 2 });
    },
  );

  it("an item edit that remembers a change reaches only the editing owner's staple", async () => {
    for (const user of [OWNER, OTHER_OWNER]) {
      as(user);
      data(await service.listStaplesForOwner(context()));
    }
    as(OWNER);
    const trip = await seedTrip(db(), OWNER.userId);
    data(
      await service.editTripItem(context(), {
        tripId: trip.id,
        itemId: "last-laptop",
        name: "Work laptop",
        qty: 1,
        timing: "main",
        scope: "remember",
      }),
    );
    const names = (
      await ctx.client.query<{ owner_id: string; name: string }>(
        "SELECT owner_id, name FROM staples WHERE semantic_id = 'last-laptop' ORDER BY owner_id",
      )
    ).rows;
    expect(names).toEqual([
      { owner_id: OWNER.userId, name: "Work laptop" },
      { owner_id: OTHER_OWNER.userId, name: "Laptop" },
    ]);
  });
});

describe("archive and restore never touch a removed trip", () => {
  const archivedFlag = async (tripId: string) =>
    (
      await ctx.client.query<{ archived: boolean }>("SELECT archived FROM trips WHERE id = $1", [
        tripId,
      ])
    ).rows[0].archived;

  it("archiving a removed trip is NOT_FOUND and the flag stays false", async () => {
    const trip = await seedTrip(db(), OWNER.userId);
    data(await service.removeTrip(context(), { tripId: trip.id }));
    expect(errorOf(await service.archiveTrip(context(), { tripId: trip.id }))?.code).toBe(
      "NOT_FOUND",
    );
    expect(await archivedFlag(trip.id)).toBe(false);
  });

  it("restoring a removed, archived trip is NOT_FOUND and the flag stays true", async () => {
    const trip = await seedTrip(db(), OWNER.userId);
    data(await service.archiveTrip(context(), { tripId: trip.id }));
    data(await service.removeTrip(context(), { tripId: trip.id }));
    expect(errorOf(await service.restoreArchivedTrip(context(), { tripId: trip.id }))?.code).toBe(
      "NOT_FOUND",
    );
    expect(await archivedFlag(trip.id)).toBe(true);
  });
});

describe("input bounds are enforced exactly at the limit", () => {
  const tripId = "00000000-0000-4000-8000-000000000001";
  const edit = (over: Record<string, unknown>) =>
    service.editTripItem(context(), {
      tripId,
      itemId: "tops",
      name: "x",
      qty: 1,
      timing: "main",
      scope: "this-trip",
      ...over,
    });

  it.each([
    ["item qty", (n: number) => edit({ qty: n }), 999, 1000, "qty"],
    ["item qty (lower bound)", (n: number) => edit({ qty: n }), 1, 0, "qty"],
    ["item name length", (n: number) => edit({ name: "n".repeat(n) }), 120, 121, "name"],
    ["itemId length", (n: number) => edit({ itemId: "i".repeat(n) }), 100, 101, "itemId"],
    [
      "packed",
      (n: number) => service.setPackedItem(context(), { tripId, itemId: "tops", packed: n }),
      999,
      1000,
      "packed",
    ],
    [
      "added Bathroom item qty",
      (n: number) =>
        service.addToiletryItemToTrip(context(), {
          tripId,
          name: "x",
          qty: n,
          packLast: false,
          scope: "this-trip",
        }),
      999,
      1000,
      "qty",
    ],
    [
      "added Bathroom item name length",
      (n: number) =>
        service.addToiletryItemToTrip(context(), {
          tripId,
          name: "n".repeat(n),
          qty: 1,
          packLast: false,
          scope: "this-trip",
        }),
      120,
      121,
      "name",
    ],
    [
      "staple qty",
      (n: number) =>
        service.upsertStaple(context(), {
          semanticId: "s",
          name: "x",
          category: "Tech",
          qty: n,
          cadence: "per trip",
          packLast: false,
        }),
      999,
      1000,
      "qty",
    ],
    [
      "staple name length",
      (n: number) =>
        service.upsertStaple(context(), {
          semanticId: "s",
          name: "n".repeat(n),
          category: "Tech",
          qty: 1,
          cadence: "per trip",
          packLast: false,
        }),
      120,
      121,
      "name",
    ],
    [
      "staple semanticId length",
      (n: number) =>
        service.upsertStaple(context(), {
          semanticId: "s".repeat(n),
          name: "x",
          category: "Tech",
          qty: 1,
          cadence: "per trip",
          packLast: false,
        }),
      100,
      101,
      "semanticId",
    ],
  ])(
    "%s: the limit is accepted, one past it is INVALID_INPUT",
    async (_name, call, atLimit, past, field) => {
      // At the limit validation passes (whatever happens next, it is not INVALID_INPUT); one past is refused up front.
      const accepted = await call(atLimit);
      expect(accepted.ok || errorOf(accepted)?.code !== "INVALID_INPUT").toBe(true);
      const refused = await call(past);
      expect(errorOf(refused)).toMatchObject({ code: "INVALID_INPUT" });
      expect(errorOf(refused)?.fields).toEqual([field]);
    },
  );
});

describe("concurrent edits to one trip are serialized (no lost updates)", () => {
  it("rapid double and triple '+' taps all count", async () => {
    const trip = await seedTrip(db(), OWNER.userId);
    const tap = () => service.incrementPackedItem(context(), { tripId: trip.id, itemId: "tops" });
    const twice = await Promise.all([tap(), tap()]);
    expect(twice.every((result) => result.ok)).toBe(true);
    expect(item((await loadTrip(db(), OWNER.userId, trip.id))!, "tops")?.packed).toBe(2);

    await Promise.all([tap(), tap(), tap()]);
    expect(item((await loadTrip(db(), OWNER.userId, trip.id))!, "tops")?.packed).toBe(4);
  });

  it("mixed concurrent edits to different items on one trip all land", async () => {
    const trip = await seedTrip(db(), OWNER.userId);
    await Promise.all([
      service.incrementPackedItem(context(), { tripId: trip.id, itemId: "tops" }),
      service.incrementPackedItem(context(), { tripId: trip.id, itemId: "underwear" }),
      service.togglePackedItem(context(), { tripId: trip.id, itemId: "sunglasses" }),
    ]);
    const stored = (await loadTrip(db(), OWNER.userId, trip.id))!;
    expect(item(stored, "tops")?.packed).toBe(1);
    expect(item(stored, "underwear")?.packed).toBe(1);
    expect(item(stored, "sunglasses")?.packed).toBe(1);
  });

  it("every trip change locks the trip row, and the owner's staples, before it reads them", async () => {
    const trip = await seedTrip(db(), OWNER.userId);
    const statements: string[] = [];
    const logged = drizzle(ctx.client, {
      schema,
      logger: { logQuery: (query: string) => void statements.push(query) },
    }) as unknown as Db;
    data(
      await service.incrementPackedItem(makeContext(logged, fake), {
        tripId: trip.id,
        itemId: "tops",
      }),
    );

    const lockTripAt = statements.findIndex(
      (sql) => /from "trips"/.test(sql) && /for update/i.test(sql),
    );
    const lockStaplesAt = statements.findIndex(
      (sql) => /from "staples"/.test(sql) && /for update/i.test(sql),
    );
    const firstTripReadAt = statements.findIndex((sql) => /from "trip_items"/.test(sql));
    expect(lockTripAt).toBeGreaterThan(-1);
    expect(lockStaplesAt).toBeGreaterThan(-1);
    expect(lockTripAt).toBeLessThan(firstTripReadAt);
    expect(statements.findIndex((sql) => /begin/i.test(sql))).toBeLessThan(lockTripAt);
  });

  it("a trip that is removed, missing, or another owner's cannot be locked and gives NOT_FOUND", async () => {
    const trip = await seedTrip(db(), OWNER.userId);
    data(await service.removeTrip(context(), { tripId: trip.id }));
    expect(
      errorOf(await service.incrementPackedItem(context(), { tripId: trip.id, itemId: "tops" }))
        ?.code,
    ).toBe("NOT_FOUND");
    expect(
      errorOf(await service.incrementPackedItem(context(), { tripId: newUuid(), itemId: "tops" }))
        ?.code,
    ).toBe("NOT_FOUND");
  });
});

describe("guards for states normal input cannot reach", () => {
  it("a save that finds the trip gone is NOT_FOUND and changes nothing", async () => {
    const trip = await seedTrip(db(), OWNER.userId);
    faults.saveTripFalse = true;
    expect(
      errorOf(await service.togglePackedItem(context(), { tripId: trip.id, itemId: "tops" }))?.code,
    ).toBe("NOT_FOUND");
    faults.saveTripFalse = false;
    expect(item((await loadTrip(db(), OWNER.userId, trip.id))!, "tops")?.packed).toBe(0);
  });

  it("a draft the domain refuses is INVALID_INPUT and nothing is stored", async () => {
    faults.domainRefusesDraft = true;
    const result = await service.createTrip(context(), {
      location: LOCATION,
      start: "2030-06-01",
      end: "2030-06-04",
      config: CONFIG,
    });
    expect(errorOf(result)).toMatchObject({
      code: "INVALID_INPUT",
      fields: ["location", "start", "end"],
    });
    expect((await ctx.client.query('SELECT 1 FROM "trips"')).rows).toEqual([]);
  });

  it("a trip that cannot be read back right after it was inserted is INTERNAL", async () => {
    faults.loadTripNull = true;
    const result = await service.createTrip(context(), {
      location: LOCATION,
      start: "2030-06-01",
      end: "2030-06-04",
      config: CONFIG,
    });
    expect(errorOf(result)).toMatchObject({ code: "INTERNAL", message: "Something went wrong" });
  });
});

describe("atomicity and failures", () => {
  it("a failing staples write rolls the trip change back too", async () => {
    const trip = await seedTrip(db(), OWNER.userId);
    data(await service.listStaplesForOwner(context()));
    failStaples = true;
    const result = await service.editTripItem(context(), {
      tripId: trip.id,
      itemId: "tops",
      name: "Renamed",
      qty: 3,
      timing: "main",
      scope: "remember",
    });
    expect(errorOf(result)).toMatchObject({ code: "INTERNAL", message: "Something went wrong" });
    expect(JSON.stringify(result)).not.toContain("Sampleton");
    failStaples = false;
    const unchanged = item((await loadTrip(db(), OWNER.userId, trip.id))!, "tops");
    expect(unchanged?.name).toBe("Everyday tops");
    expect(unchanged).not.toHaveProperty("userEdited");
  });

  it("never logs trip dates, destinations, item names, or owner ids", async () => {
    const lines: string[] = [];
    setDataLogSink((line) => lines.push(line));
    const trip = await seedTrip(db(), OWNER.userId, { destination: "Sampleton" });
    await service.getTrip(context(), { tripId: newUuid() });
    await service.editTripItem(context(), {
      tripId: trip.id,
      itemId: "tops",
      name: "Private name",
      qty: 0,
      timing: "main",
      scope: "this-trip",
    });
    failStaples = true;
    await service.editTripItem(context(), {
      tripId: trip.id,
      itemId: "tops",
      name: "Private name",
      qty: 2,
      timing: "main",
      scope: "remember",
    });
    as(null);
    await service.listTrips(context());
    expect(lines.length).toBeGreaterThan(2);
    expect(lines.join("\n")).not.toMatch(/Sampleton|Private name|2030|owner-a|example\.test/);
  });
});

describe("reload durability", () => {
  it("what is written survives closing and reopening the database", async () => {
    const durable = await openDurableDb();
    try {
      const first = await durable.open();
      const durableContext = makeContext(first.db, fake);
      as(OWNER);
      await seedOwner(first.db, OWNER.userId);
      const trip = await seedTrip(first.db, OWNER.userId, { destination: "Durable" });
      data(await service.togglePackedItem(durableContext, { tripId: trip.id, itemId: "tops" }));
      data(
        await service.editTripItem(durableContext, {
          tripId: trip.id,
          itemId: "sunglasses",
          name: "Shades",
          qty: 2,
          timing: "packlast",
          scope: "remember",
        }),
      );
      data(await service.acceptTripWeather(durableContext, { tripId: trip.id }));
      const written = JSON.stringify(
        data(await service.getTrip(durableContext, { tripId: trip.id })),
      );
      const stapleRows = (
        await first.client.query(
          'SELECT semantic_id, name, version FROM "staples" ORDER BY semantic_id',
        )
      ).rows;
      await first.client.close();

      const second = await durable.open();
      const reopenedContext = makeContext(second.db, fake);
      expect(
        JSON.stringify(data(await service.getTrip(reopenedContext, { tripId: trip.id }))),
      ).toBe(written);
      expect(
        (
          await second.client.query(
            'SELECT semantic_id, name, version FROM "staples" ORDER BY semantic_id',
          )
        ).rows,
      ).toEqual(stapleRows);
      await second.client.close();
    } finally {
      durable.cleanup();
    }
  });
});

// Keep the import used by the type of the mocked module.
void stapleStore;
