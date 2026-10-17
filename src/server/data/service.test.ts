import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createMigratedDb, resetData } from "../db/__fixtures__/db";
import type { TripItem } from "../../domain/trip";
import type { Db } from "../db/retention";
import {
  CONFIG,
  createFakeAuth,
  makeContext,
  makeStoredTrip,
  newUuid,
  openDurableDb,
  OTHER_OWNER,
  OWNER,
  seedOwner,
  seedTrip,
  signedInAs,
} from "./__fixtures__/seed";
import type { Result } from "./result";
import { setDataLogSink } from "./safe-log";
import * as service from "./service";
import * as stapleStore from "./staple-store";
import { loadTrip, loadTrips } from "./trip-store";

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
