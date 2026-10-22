// Creating a trip from one saved list (#170): the trip is a copy of the list's items only (no staples, no length-based
// items), all unpacked, owner-isolated, and independent of the list afterwards. PGlite, synthetic data only.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createMigratedDb, resetData } from "../db/__fixtures__/db";
import type { Db } from "../db/retention";
import {
  createFakeAuth,
  makeContext,
  OTHER_OWNER,
  OWNER,
  seedOwner,
  signedInAs,
} from "./__fixtures__/seed";
import type { Result } from "./result";
import { createSavedList } from "./saved-list-store";
import { setDataLogSink } from "./safe-log";
import * as service from "./service";

const LOCATION = {
  id: "sample-b",
  city: "Exampleville",
  region: "Sample Region",
  country: "Sampleland",
  countryCode: "SL",
  label: "Exampleville, Sample Region, Sampleland",
};
const CONFIG = {
  laundry: false,
  spare: true,
  niceAttire: true,
  occasionCount: 1,
  reuseNice: true,
  returnOutfit: true,
};
const trip = {
  location: { id: LOCATION.id },
  start: "2030-03-15",
  end: "2030-03-20",
  config: CONFIG,
};
const MISSING = "00000000-0000-4000-8000-0000000000ff";

let ctx: Awaited<ReturnType<typeof createMigratedDb>>;
const fake = createFakeAuth();
const db = () => ctx.db as unknown as Db;
const context = () => ({
  ...makeContext(db(), fake),
  resolveLocation: async (id: string) => (id === LOCATION.id ? LOCATION : null),
});
const as = (user: typeof OWNER | null) => signedInAs(fake, user);

beforeAll(async () => {
  ctx = await createMigratedDb();
});
beforeEach(async () => {
  await resetData(ctx.client);
  as(OWNER);
  await seedOwner(db(), OWNER.userId);
  await seedOwner(db(), OTHER_OWNER.userId);
  setDataLogSink(() => {});
});
afterEach(() => setDataLogSink());
afterAll(async () => {
  await ctx.client.close();
});

function data<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(`expected ok, got ${result.error.code}`);
  return result.data;
}
const errorOf = (result: Result<unknown>) => (result.ok ? null : result.error);
const countTrips = async () =>
  Number(
    (await ctx.client.query<{ n: string }>('SELECT count(*)::text AS n FROM "trips"')).rows[0].n,
  );

const beach = {
  name: "Beach week",
  items: [
    { id: "towel", name: "Beach towel", category: "Other essentials", qty: 2 },
    { id: "sunscreen", name: "Sunscreen", category: "Bathroom", qty: 1 },
    { id: "swim-a", name: "Swimsuit", category: "Clothing", qty: 2 },
    { id: "swim-b", name: "Swimsuit", category: "Clothing", qty: 1 },
  ],
};

describe("createTrip with a saved list", () => {
  it("starts from the list's items only: no staples, no length-based items, copies, all unpacked, in list order", async () => {
    const list = await createSavedList(db(), OWNER.userId, beach);
    const created = data(await service.createTrip(context(), { ...trip, savedListId: list.id }));
    expect(created.items.map((item) => [item.name, item.category, item.qty, item.packed])).toEqual([
      ["Beach towel", "Other essentials", 2, 0],
      ["Sunscreen", "Bathroom", 1, 0],
      ["Swimsuit", "Clothing", 2, 0],
      ["Swimsuit", "Clothing", 1, 0],
    ]);
    expect(created.items.some((item) => ["socks", "underwear", "tops"].includes(item.id))).toBe(
      false,
    );
    expect(created.items.every((item) => item.id.startsWith(`saved:${list.id}:`))).toBe(true);
    // The trip's own facts are still computed from its dates.
    expect(created).toMatchObject({ days: 6, ready: false, toiletryBagPacked: false });
  });

  it("puts Bathroom rows in the toiletries group, and keeps two matching rows as two rows (never summed)", async () => {
    const list = await createSavedList(db(), OWNER.userId, beach);
    const created = data(await service.createTrip(context(), { ...trip, savedListId: list.id }));
    expect(created.items.find((item) => item.name === "Sunscreen")?.groupId).toBe("toiletry-bag");
    expect(created.items.find((item) => item.name === "Beach towel")?.groupId).toBeUndefined();
    expect(
      created.items.filter((item) => item.name === "Swimsuit").map((item) => item.qty),
    ).toEqual([2, 1]);
  });

  it("is a copy: editing or deleting the list later never changes the trip, and two trips from one list are independent", async () => {
    const list = await createSavedList(db(), OWNER.userId, beach);
    const first = data(await service.createTrip(context(), { ...trip, savedListId: list.id }));
    const second = data(await service.createTrip(context(), { ...trip, savedListId: list.id }));
    data(await service.removeSavedListItem(context(), { listId: list.id, itemId: "towel" }));
    data(await service.deleteSavedListById(context(), { listId: list.id }));
    const reloaded = data(await service.getTrip(context(), { tripId: first.id }));
    expect(reloaded.items).toHaveLength(4);
    expect(first.id).not.toBe(second.id);
    expect(first.items[0].id).toBe(second.items[0].id);
    data(
      await service.setPackedItem(context(), {
        tripId: first.id,
        itemId: first.items[0].id,
        packed: 1,
      }),
    );
    expect(data(await service.getTrip(context(), { tripId: second.id })).items[0].packed).toBe(0);
  });

  it("without a list is exactly today's behaviour: the owner's staples and the length-based items", async () => {
    const created = data(await service.createTrip(context(), trip));
    expect(created.items.some((item) => item.id === "socks")).toBe(true);
    expect(created.items.some((item) => item.id.startsWith("saved:"))).toBe(false);
  });

  it("is NOT_FOUND for another owner's list or a missing one, and no trip is made", async () => {
    const theirs = await createSavedList(db(), OTHER_OWNER.userId, beach);
    expect(
      errorOf(await service.createTrip(context(), { ...trip, savedListId: theirs.id }))?.code,
    ).toBe("NOT_FOUND");
    expect(
      errorOf(await service.createTrip(context(), { ...trip, savedListId: MISSING }))?.code,
    ).toBe("NOT_FOUND");
    expect(await countTrips()).toBe(0);
  });

  it("refuses a list with no items (nothing to start from) and a malformed id, creating nothing", async () => {
    const empty = await createSavedList(db(), OWNER.userId, { name: "Empty", items: [] });
    const refused = errorOf(
      await service.createTrip(context(), { ...trip, savedListId: empty.id }),
    );
    expect(refused).toMatchObject({ code: "INVALID_INPUT", fields: ["savedListId"] });
    expect(
      errorOf(await service.createTrip(context(), { ...trip, savedListId: "not-a-uuid" }))?.code,
    ).toBe("INVALID_INPUT");
    expect(await countTrips()).toBe(0);
  });

  it("works for a multi-stop route too", async () => {
    const list = await createSavedList(db(), OWNER.userId, beach);
    const created = data(
      await service.createTrip(context(), {
        stops: [
          { location: { id: LOCATION.id }, arrive: "2030-03-15", leave: "2030-03-17" },
          { location: { id: LOCATION.id }, arrive: "2030-03-17", leave: "2030-03-20" },
        ],
        config: CONFIG,
        savedListId: list.id,
      }),
    );
    expect(created.stops).toHaveLength(2);
    expect(created.items).toHaveLength(4);
  });
});
