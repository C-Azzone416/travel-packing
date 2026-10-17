import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createMigratedDb, resetData } from "./__fixtures__/db";
import {
  listRecentlyDeleted,
  purgeDeletedBefore,
  restoreDeletedTrip,
  softDeleteTrip,
} from "./retention";
import * as schema from "./schema";

let ctx: Awaited<ReturnType<typeof createMigratedDb>>;

beforeAll(async () => {
  ctx = await createMigratedDb();
});

beforeEach(async () => {
  await resetData(ctx.client);
});

afterAll(async () => {
  await ctx.client.close();
});

async function seedOwner(id: string, tripCount = 1): Promise<string[]> {
  await ctx.db.insert(schema.users).values({ id });
  const created = await ctx.db
    .insert(schema.trips)
    .values(
      Array.from({ length: tripCount }, (_, index) => ({
        ownerId: id,
        destination: `Sampleton ${index}`,
        startDate: "2030-04-01",
        endDate: "2030-04-08",
        days: 8,
        dailyDays: 6,
      })),
    )
    .returning({ id: schema.trips.id });
  return created.map((row) => row.id);
}

async function tripIds(): Promise<string[]> {
  const rows = await ctx.db.select({ id: schema.trips.id }).from(schema.trips);
  return rows.map((row) => row.id).sort();
}

const at = (iso: string) => new Date(iso);

describe("recoverable delete", () => {
  it("soft delete stamps deleted_at and keeps the row and its children", async () => {
    const [tripId] = await seedOwner("alice");
    await ctx.db.insert(schema.tripItems).values({
      tripId,
      ownerId: "alice",
      semanticId: "underwear",
      name: "Underwear",
      category: "Clothing",
      qty: 2,
    });
    expect(await softDeleteTrip(ctx.db, "alice", tripId, at("2030-05-01T00:00:00Z"))).toBe(true);
    expect(await listRecentlyDeleted(ctx.db, "alice")).toEqual([
      { id: tripId, deletedAt: at("2030-05-01T00:00:00Z") },
    ]);
    expect(await ctx.db.select().from(schema.tripItems)).toHaveLength(1);
  });

  it("soft delete is refused for a missing trip, another owner's trip, or one already deleted", async () => {
    const [tripId] = await seedOwner("alice");
    await ctx.db.insert(schema.users).values({ id: "bob" });
    expect(await softDeleteTrip(ctx.db, "bob", tripId, at("2030-05-01T00:00:00Z"))).toBe(false);
    expect(
      await softDeleteTrip(ctx.db, "alice", crypto.randomUUID(), at("2030-05-01T00:00:00Z")),
    ).toBe(false);
    expect(await softDeleteTrip(ctx.db, "alice", tripId, at("2030-05-01T00:00:00Z"))).toBe(true);
    expect(await softDeleteTrip(ctx.db, "alice", tripId, at("2030-06-01T00:00:00Z"))).toBe(false);
    expect((await listRecentlyDeleted(ctx.db, "alice"))[0].deletedAt).toEqual(
      at("2030-05-01T00:00:00Z"),
    );
  });

  it("restore clears deleted_at; restoring twice or restoring a live trip is a no-op", async () => {
    const [tripId] = await seedOwner("alice");
    await softDeleteTrip(ctx.db, "alice", tripId, at("2030-05-01T00:00:00Z"));
    expect(await restoreDeletedTrip(ctx.db, "bob", tripId)).toBe(false);
    expect(await restoreDeletedTrip(ctx.db, "alice", tripId)).toBe(true);
    expect(await restoreDeletedTrip(ctx.db, "alice", tripId)).toBe(false);
    expect(await listRecentlyDeleted(ctx.db, "alice")).toEqual([]);
  });

  it("lists only the owner's deleted trips, newest first", async () => {
    const [first, second] = await seedOwner("alice", 2);
    const [other] = await seedOwner("bob");
    await softDeleteTrip(ctx.db, "alice", first, at("2030-05-01T00:00:00Z"));
    await softDeleteTrip(ctx.db, "alice", second, at("2030-05-03T00:00:00Z"));
    await softDeleteTrip(ctx.db, "bob", other, at("2030-05-02T00:00:00Z"));
    expect((await listRecentlyDeleted(ctx.db, "alice")).map((row) => row.id)).toEqual([
      second,
      first,
    ]);
    expect(await listRecentlyDeleted(ctx.db, "nobody")).toEqual([]);
  });
});

describe("purge seam", () => {
  it("has no built-in retention period: the cutoff is a required argument", () => {
    expect(purgeDeletedBefore.length).toBeGreaterThanOrEqual(2);
  });

  it("purges only trips deleted strictly before the cutoff, with their children", async () => {
    const [old, boundary, recent, live] = await seedOwner("alice", 4);
    await ctx.db.insert(schema.tripItems).values({
      tripId: old,
      ownerId: "alice",
      semanticId: "socks",
      name: "Socks",
      category: "Clothing",
      qty: 1,
    });
    await softDeleteTrip(ctx.db, "alice", old, at("2030-05-01T00:00:00Z"));
    await softDeleteTrip(ctx.db, "alice", boundary, at("2030-05-10T00:00:00Z"));
    await softDeleteTrip(ctx.db, "alice", recent, at("2030-05-20T00:00:00Z"));

    expect(await purgeDeletedBefore(ctx.db, at("2030-05-10T00:00:00Z"))).toEqual([old]);
    expect(await tripIds()).toEqual([boundary, recent, live].sort());
    expect(await ctx.db.select().from(schema.tripItems)).toEqual([]);
  });

  it("never touches live trips, however old", async () => {
    await seedOwner("alice", 2);
    const before = await tripIds();
    expect(await purgeDeletedBefore(ctx.db, at("2099-01-01T00:00:00Z"))).toEqual([]);
    expect(await tripIds()).toEqual(before);
  });

  it("can be scoped to one owner", async () => {
    const [mine] = await seedOwner("alice");
    const [theirs] = await seedOwner("bob");
    await softDeleteTrip(ctx.db, "alice", mine, at("2030-05-01T00:00:00Z"));
    await softDeleteTrip(ctx.db, "bob", theirs, at("2030-05-01T00:00:00Z"));
    expect(await purgeDeletedBefore(ctx.db, at("2030-06-01T00:00:00Z"), "alice")).toEqual([mine]);
    expect(await tripIds()).toEqual([theirs]);
    expect(await purgeDeletedBefore(ctx.db, at("2030-06-01T00:00:00Z"))).toEqual([theirs]);
  });

  it("a copy survives the purge of its source with copied_from cleared", async () => {
    const [source] = await seedOwner("alice");
    const [copy] = await ctx.db
      .insert(schema.trips)
      .values({
        ownerId: "alice",
        destination: "Copy",
        startDate: "2030-07-01",
        endDate: "2030-07-02",
        days: 2,
        dailyDays: 0,
        copiedFrom: source,
      })
      .returning({ id: schema.trips.id });
    await softDeleteTrip(ctx.db, "alice", source, at("2030-05-01T00:00:00Z"));
    await purgeDeletedBefore(ctx.db, at("2030-06-01T00:00:00Z"));
    const rows = await ctx.db.select().from(schema.trips);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: copy.id, copiedFrom: null });
  });
});
