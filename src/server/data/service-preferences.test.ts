// Changing a saved trip's packing preferences through the data layer (#203): the stored list keeps the person's work, a stale
// review is refused, and `updatedAt` moves with every save so a review can say what it was based on. PGlite, no network.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createMigratedDb, resetData } from "../db/__fixtures__/db";
import type { Db } from "../db/retention";
import {
  CONFIG,
  createFakeAuth,
  makeContext,
  OTHER_OWNER,
  OWNER,
  seedOwner,
  seedTrip,
  signedInAs,
} from "./__fixtures__/seed";
import type { Result } from "./result";
import { setDataLogSink } from "./safe-log";
import * as service from "./service";
import { loadTrip } from "./trip-store";

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
const item = (trip: { items: { id: string }[] }, id: string) =>
  trip.items.find((entry) => entry.id === id) as
    { id: string; qty: number; packed: number; name: string; userEdited?: boolean } | undefined;

const withPrefs = (tripId: string, change: Partial<typeof CONFIG>, basedOn?: string) =>
  service.updateTripPreferences(context(), {
    tripId,
    config: { ...CONFIG, ...change },
    ...(basedOn ? { basedOn } : {}),
  });

describe("updateTripPreferences keeps the person's list work, stored", () => {
  it("manual, edited and packed items and removed optional suggestions survive, and untouched ones update", async () => {
    const trip = await seedTrip(db(), OWNER.userId);
    const id = trip.id;
    data(
      await service.addItemToTrip(context(), {
        tripId: id,
        name: "Camera",
        category: "Tech",
        neededQty: 2,
      }),
    );
    data(
      await service.editTripItem(context(), {
        tripId: id,
        itemId: "sleepwear",
        name: "Pajamas",
        qty: 3,
        timing: "main",
        scope: "this-trip",
      }),
    );
    data(await service.setPackedItem(context(), { tripId: id, itemId: "underwear", packed: 4 }));
    data(
      await service.removeItemFromTrip(context(), {
        tripId: id,
        itemId: "nice-shoes",
        scope: "this-trip",
      }),
    );

    const applied = data(await withPrefs(id, { laundry: true, occasionCount: 3 }));
    const reloaded = (await loadTrip(db(), OWNER.userId, id))!;
    expect(reloaded.config).toMatchObject({ laundry: true, occasionCount: 3 });

    // The person's work, exactly as it was.
    expect(reloaded.items.find((entry) => entry.name === "Camera")).toMatchObject({
      qty: 2,
      packed: 0,
    });
    expect(item(reloaded, "sleepwear")).toMatchObject({
      name: "Pajamas",
      qty: 3,
      userEdited: true,
    });
    expect(item(reloaded, "underwear")?.packed).toBe(4);
    expect(item(reloaded, "nice-shoes")).toBeUndefined();
    expect(reloaded.suppressedSuggestions).toEqual({ "nice-shoes": true });
    // Untouched suggestions follow the new preferences.
    expect(item(reloaded, "tops")?.qty).toBeLessThan(item(trip, "tops")!.qty);
    expect(item(reloaded, "nice-top")?.qty).toBe(3);
    expect(applied.trip.items.map((entry) => entry.id).sort()).toEqual(
      reloaded.items.map((entry) => entry.id).sort(),
    );
  });

  it("lowers a packed count only to the new target, and never raises one", async () => {
    const trip = await seedTrip(db(), OWNER.userId);
    data(
      await service.setPackedItem(context(), {
        tripId: trip.id,
        itemId: "tops",
        packed: item(trip, "tops")!.qty,
      }),
    );
    data(await withPrefs(trip.id, { laundry: true }));
    const reloaded = (await loadTrip(db(), OWNER.userId, trip.id))!;
    expect(item(reloaded, "tops")).toMatchObject({ packed: item(reloaded, "tops")!.qty });
    expect(item(reloaded, "tops")!.qty).toBeLessThan(item(trip, "tops")!.qty);
  });

  it("turning Nice outfits off and back on restores the nice items with their packed counts", async () => {
    const trip = await seedTrip(db(), OWNER.userId);
    data(
      await service.setPackedItem(context(), { tripId: trip.id, itemId: "nice-top", packed: 1 }),
    );
    data(await withPrefs(trip.id, { niceAttire: false }));
    expect(item((await loadTrip(db(), OWNER.userId, trip.id))!, "nice-top")).toBeUndefined();
    data(await withPrefs(trip.id, { niceAttire: true }));
    expect(item((await loadTrip(db(), OWNER.userId, trip.id))!, "nice-top")?.packed).toBe(1);
  });
});

describe("updatedAt and the stale-review guard", () => {
  it("every save moves updatedAt, and the saved trip returned says when", async () => {
    const trip = await seedTrip(db(), OWNER.userId);
    const first = (await loadTrip(db(), OWNER.userId, trip.id))!.updatedAt;
    expect(first).toMatch(/^\d{4}-\d\d-\d\dT/);
    await new Promise((resolve) => setTimeout(resolve, 5));
    const changed = data(
      await service.setPackedItem(context(), { tripId: trip.id, itemId: "tops", packed: 1 }),
    );
    expect(changed.trip.updatedAt).not.toBe(first);
    // What the call returned is what the database now holds, so the next review can be based on it.
    expect((await loadTrip(db(), OWNER.userId, trip.id))!.updatedAt).toBe(changed.trip.updatedAt);
  });

  it("applies when the review is still current, and the result can be the basis of the next one", async () => {
    const trip = await seedTrip(db(), OWNER.userId);
    const basis = (await loadTrip(db(), OWNER.userId, trip.id))!.updatedAt;
    const applied = data(await withPrefs(trip.id, { spare: false }, basis));
    expect(applied.trip.config.spare).toBe(false);
    data(await withPrefs(trip.id, { spare: true }, applied.trip.updatedAt));
  });

  it("refuses a review the trip has moved on from (STALE), and changes nothing", async () => {
    const trip = await seedTrip(db(), OWNER.userId);
    const basis = (await loadTrip(db(), OWNER.userId, trip.id))!.updatedAt;
    await new Promise((resolve) => setTimeout(resolve, 5));
    data(await service.setPackedItem(context(), { tripId: trip.id, itemId: "tops", packed: 1 })); // another tab
    const before = JSON.stringify(await loadTrip(db(), OWNER.userId, trip.id));
    expect(errorOf(await withPrefs(trip.id, { laundry: true }, basis))?.code).toBe("STALE");
    expect(JSON.stringify(await loadTrip(db(), OWNER.userId, trip.id))).toBe(before);
  });

  it("without a basis it applies as it always did", async () => {
    const trip = await seedTrip(db(), OWNER.userId);
    expect(data(await withPrefs(trip.id, { laundry: true })).trip.config.laundry).toBe(true);
  });

  it("is owner-scoped: another owner's trip is NOT_FOUND, never STALE", async () => {
    const trip = await seedTrip(db(), OWNER.userId);
    await seedOwner(db(), OTHER_OWNER.userId);
    as(OTHER_OWNER);
    expect(errorOf(await withPrefs(trip.id, { laundry: true }, "anything"))?.code).toBe(
      "NOT_FOUND",
    );
  });
});
