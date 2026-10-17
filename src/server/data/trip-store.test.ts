import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createMigratedDb, resetData } from "../db/__fixtures__/db";
import type { Db } from "../db/retention";
import { Refusal } from "./run";
import {
  makeStoredTrip,
  newUuid,
  OTHER_OWNER,
  OWNER,
  seedOwner,
  seedTrip,
} from "./__fixtures__/seed";
import { insertTrip, loadTrip, loadTrips, lockTrip, saveTrip } from "./trip-store";

let ctx: Awaited<ReturnType<typeof createMigratedDb>>;
const db = () => ctx.db as unknown as Db;

beforeAll(async () => {
  ctx = await createMigratedDb();
});
beforeEach(async () => {
  await resetData(ctx.client);
});
afterAll(async () => {
  await ctx.client.close();
});

/** What a trip looks like once stored: absent flags and null groups are omitted rather than false/null. */
function canonical<T>(value: T): T {
  return JSON.parse(JSON.stringify(value), (_key, entry) =>
    entry === false || entry === null ? undefined : entry,
  );
}

describe("round trip", () => {
  it("stores and reloads a trip, its preferences, weather, and items with progress", async () => {
    const trip = makeStoredTrip({ toiletryBagPacked: true, ready: true });
    trip.items = trip.items.map((item, index) => ({ ...item, packed: index % 2 ? item.qty : 0 }));
    trip.suggestionMemory = { "nice-shoes": { ...trip.items[0], name: "Remembered" } };
    trip.suppressedSuggestions = { "nice-makeup": true };
    trip.weather = { status: "accepted", label: "Close forecast", suggestion: "Compact umbrella" };
    await seedOwner(db(), OWNER.userId);
    await insertTrip(db(), OWNER.userId, trip);

    const loaded = await loadTrip(db(), OWNER.userId, trip.id);
    expect(loaded).not.toBeNull();
    expect(canonical(loaded)).toEqual(canonical(trip));
    expect(loaded?.items.map((item) => item.id)).toEqual(trip.items.map((item) => item.id));
    expect(loaded?.items.map((item) => item.packed)).toEqual(trip.items.map((item) => item.packed));
  });

  it("omits false and empty optional item flags", async () => {
    const trip = await seedTrip(db(), OWNER.userId);
    const loaded = await loadTrip(db(), OWNER.userId, trip.id);
    const plain = loaded?.items.find((item) => item.id === "sunglasses");
    expect(plain).not.toHaveProperty("optional");
    expect(plain).not.toHaveProperty("userEdited");
    expect(plain).not.toHaveProperty("groupId");
    const toiletry = loaded?.items.find((item) => item.groupId);
    expect(toiletry?.groupId).toBe("toiletry-bag");
  });

  it("rebuilds defaults when optional child rows are absent", async () => {
    const trip = await seedTrip(db(), OWNER.userId);
    await ctx.client.query('DELETE FROM "trip_preferences"');
    await ctx.client.query('DELETE FROM "weather_suggestions"');
    const loaded = await loadTrip(db(), OWNER.userId, trip.id);
    expect(loaded?.config).toEqual({
      laundry: false,
      spare: false,
      niceAttire: false,
      occasionCount: 1,
      reuseNice: false,
      returnOutfit: true,
    });
    expect(loaded?.weather).toMatchObject({ status: "pending", label: "" });
    expect(loaded?.suggestionMemory).toEqual({});
    expect(loaded?.suppressedSuggestions).toEqual({});
  });

  it("an item without a progress row loads as 0 packed", async () => {
    const trip = await seedTrip(db(), OWNER.userId);
    await ctx.client.query('DELETE FROM "trip_item_progress"');
    const loaded = await loadTrip(db(), OWNER.userId, trip.id);
    expect(loaded?.items.every((item) => item.packed === 0)).toBe(true);
  });
});

describe("owner scoping", () => {
  it("never returns another owner's trip, however it is asked for", async () => {
    const trip = await seedTrip(db(), OWNER.userId);
    await seedOwner(db(), OTHER_OWNER.userId);
    expect(await loadTrip(db(), OTHER_OWNER.userId, trip.id)).toBeNull();
    expect(await loadTrips(db(), OTHER_OWNER.userId, { filter: "live" })).toEqual([]);
    expect(await loadTrips(db(), OTHER_OWNER.userId, { filter: "deleted" })).toEqual([]);
  });

  it("lists only the owner's live trips, newest first, and deleted ones separately", async () => {
    const first = await seedTrip(db(), OWNER.userId, { destination: "First" });
    const second = await seedTrip(db(), OWNER.userId, { destination: "Second" });
    await seedTrip(db(), OTHER_OWNER.userId);
    await ctx.client.query(
      'UPDATE "trips" SET "created_at" = now() - interval \'1 day\' WHERE "id" = $1',
      [first.id],
    );
    await ctx.client.query('UPDATE "trips" SET "deleted_at" = now() WHERE "id" = $1', [second.id]);

    expect(
      (await loadTrips(db(), OWNER.userId, { filter: "live" })).map((trip) => trip.id),
    ).toEqual([first.id]);
    expect(
      (await loadTrips(db(), OWNER.userId, { filter: "deleted" })).map((trip) => trip.id),
    ).toEqual([second.id]);
    expect(await loadTrip(db(), OWNER.userId, second.id)).toBeNull();
    expect((await loadTrip(db(), OWNER.userId, second.id, "deleted"))?.deletedAt).toBeInstanceOf(
      Date,
    );
  });

  it("returns several trips with their own items", async () => {
    const a = await seedTrip(db(), OWNER.userId, { destination: "A" });
    const b = await seedTrip(db(), OWNER.userId, {
      destination: "B",
      start: "2030-05-01",
      end: "2030-05-03",
    });
    const loaded = await loadTrips(db(), OWNER.userId, { filter: "live" });
    expect(loaded).toHaveLength(2);
    expect(loaded.find((trip) => trip.id === a.id)?.items.length).toBe(a.items.length);
    expect(loaded.find((trip) => trip.id === b.id)?.items.length).toBe(b.items.length);
  });
});

describe("saveTrip", () => {
  it("persists progress, flags, and preference changes", async () => {
    const trip = await seedTrip(db(), OWNER.userId);
    const changed = {
      ...trip,
      ready: true,
      archived: true,
      toiletryBagPacked: true,
      config: { ...trip.config, laundry: true },
      items: trip.items.map((item) => ({ ...item, packed: item.qty })),
    };
    expect(await saveTrip(db(), OWNER.userId, changed)).toBe(true);
    const loaded = await loadTrip(db(), OWNER.userId, trip.id);
    expect(loaded).toMatchObject({ ready: true, archived: true, toiletryBagPacked: true });
    expect(loaded?.config.laundry).toBe(true);
    expect(loaded?.items.every((item) => item.packed === item.qty)).toBe(true);
  });

  it("adds, removes, reorders, and re-quantifies items; lowering qty clamps stored progress", async () => {
    const trip = await seedTrip(db(), OWNER.userId);
    const tops = trip.items.find((item) => item.id === "tops");
    if (!tops) throw new Error("fixture lacks tops");
    const withProgress = {
      ...trip,
      items: trip.items.map((item) => (item.id === "tops" ? { ...item, packed: item.qty } : item)),
    };
    await saveTrip(db(), OWNER.userId, withProgress);

    const extra = {
      id: "extra-item",
      name: "Scarf",
      category: "Accessories",
      qty: 2,
      packed: 1,
      section: "main" as const,
    };
    const remaining = withProgress.items.filter((item) => item.id !== "sunglasses");
    const reordered = [
      extra,
      ...remaining.map((item) => (item.id === "tops" ? { ...item, qty: 1, packed: 1 } : item)),
    ];
    await saveTrip(db(), OWNER.userId, { ...withProgress, items: reordered });

    const loaded = await loadTrip(db(), OWNER.userId, trip.id);
    expect(loaded?.items.map((item) => item.id)).toEqual(reordered.map((item) => item.id));
    expect(loaded?.items.find((item) => item.id === "sunglasses")).toBeUndefined();
    expect(loaded?.items.find((item) => item.id === "tops")).toMatchObject({ qty: 1, packed: 1 });
    expect(loaded?.items[0]).toMatchObject({ id: "extra-item", name: "Scarf", packed: 1 });
  });

  it("re-adding an item with the same semantic id after removal works", async () => {
    const trip = await seedTrip(db(), OWNER.userId);
    const without = { ...trip, items: trip.items.filter((item) => item.id !== "sunglasses") };
    await saveTrip(db(), OWNER.userId, without);
    await saveTrip(db(), OWNER.userId, trip);
    expect(
      (await loadTrip(db(), OWNER.userId, trip.id))?.items.some((item) => item.id === "sunglasses"),
    ).toBe(true);
  });

  it("refuses another owner's trip, a missing trip, and a deleted trip without changing anything", async () => {
    const trip = await seedTrip(db(), OWNER.userId);
    await seedOwner(db(), OTHER_OWNER.userId);
    const attempt = { ...trip, ready: true };
    expect(await saveTrip(db(), OTHER_OWNER.userId, attempt)).toBe(false);
    expect(await saveTrip(db(), OWNER.userId, { ...attempt, id: newUuid() })).toBe(false);
    await ctx.client.query('UPDATE "trips" SET "deleted_at" = now()');
    expect(await saveTrip(db(), OWNER.userId, attempt)).toBe(false);
    await ctx.client.query('UPDATE "trips" SET "deleted_at" = NULL');
    expect((await loadTrip(db(), OWNER.userId, trip.id))?.ready).toBe(false);
  });

  it("rejects an item category the schema does not know, before writing", async () => {
    const trip = await seedTrip(db(), OWNER.userId);
    const bad = { ...trip, items: [{ ...trip.items[0], category: "Gadgets" }] };
    await expect(saveTrip(db(), OWNER.userId, bad)).rejects.toBeInstanceOf(Refusal);
    await expect(insertTrip(db(), OWNER.userId, { ...bad, id: newUuid() })).rejects.toBeInstanceOf(
      Refusal,
    );
    expect((await loadTrip(db(), OWNER.userId, trip.id))?.items.length).toBe(trip.items.length);
  });

  it("is atomic: a failing write rolls the whole aggregate back", async () => {
    const trip = await seedTrip(db(), OWNER.userId);
    const broken = {
      ...trip,
      ready: true,
      items: [
        ...trip.items,
        {
          id: "bad-qty",
          name: "Zero",
          category: "Accessories",
          qty: 0,
          packed: 0,
          section: "main" as const,
        },
      ],
    };
    await expect(saveTrip(db(), OWNER.userId, broken)).rejects.toThrow();
    const loaded = await loadTrip(db(), OWNER.userId, trip.id);
    expect(loaded?.ready).toBe(false);
    expect(loaded?.items.some((item) => item.id === "bad-qty")).toBe(false);
  });
});

describe("lockTrip", () => {
  it("locks only the owner's own live trip", async () => {
    const trip = await seedTrip(db(), OWNER.userId);
    await seedOwner(db(), OTHER_OWNER.userId);
    expect(await lockTrip(db(), OWNER.userId, trip.id)).toBe(true);
    // The owner filter is a security filter: another owner cannot take (or probe) the lock on this trip.
    expect(await lockTrip(db(), OTHER_OWNER.userId, trip.id)).toBe(false);
  });

  it("refuses a missing trip and a removed trip", async () => {
    const trip = await seedTrip(db(), OWNER.userId);
    expect(await lockTrip(db(), OWNER.userId, newUuid())).toBe(false);
    await ctx.client.query('UPDATE "trips" SET "deleted_at" = now() WHERE "id" = $1', [trip.id]);
    expect(await lockTrip(db(), OWNER.userId, trip.id)).toBe(false);
  });

  it("takes a row lock inside a transaction (FOR UPDATE), so a competing lock waits for it", async () => {
    const trip = await seedTrip(db(), OWNER.userId);
    const order: string[] = [];
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    const first = db().transaction(async (tx) => {
      await lockTrip(tx as Db, OWNER.userId, trip.id);
      order.push("first locked");
      await held;
      order.push("first done");
    });
    // PGlite runs transactions one at a time, so the second can only start after the first ends.
    const second = db().transaction(async (tx) => {
      await lockTrip(tx as Db, OWNER.userId, trip.id);
      order.push("second locked");
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    release();
    await Promise.all([first, second]);
    expect(order).toEqual(["first locked", "first done", "second locked"]);
  });
});
