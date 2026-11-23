import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { DataContext } from "@/server/data/context";
import type { Db } from "@/server/db/retention";
import { createMigratedDb, resetData } from "@/server/db/__fixtures__/db";
import {
  createFakeAuth,
  makeContext,
  OWNER,
  OTHER_OWNER,
  seedTrip,
  signedInAs,
} from "@/server/data/__fixtures__/seed";
import * as service from "@/server/data/service";
import type { Result } from "@/server/data/result";
import type { StapleRevision } from "@/domain/calc/staples";
import { createServerTripsSource, type TripActions, type TripsActions } from "./server-source";

let current: DataContext;
const faults = vi.hoisted(() => ({ trip: false, staples: false, tripWrites: 0, defaultWrites: 0 }));
vi.mock("@/server/data/runtime", () => ({ getDataContext: async () => current }));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw Error(path);
  },
}));
vi.mock("@/server/data/staple-store", async (load) => {
  const original = await load<typeof import("@/server/data/staple-store")>();
  return {
    ...original,
    saveStaples: async (...args: Parameters<typeof original.saveStaples>) => {
      faults.defaultWrites += 1;
      await original.saveStaples(...args);
      if (faults.staples) throw Error("after default write");
    },
  };
});
vi.mock("@/server/data/trip-store", async (load) => {
  const original = await load<typeof import("@/server/data/trip-store")>();
  return {
    ...original,
    saveTripAt: async (...args: Parameters<typeof original.saveTripAt>) => {
      faults.tripWrites += 1;
      const result = await original.saveTripAt(...args);
      if (faults.trip) throw Error("after trip write");
      return result;
    },
  };
});
import {
  editItemAction,
  removeItemAction,
  listStaplesAction,
  getTripAction,
  addToiletryItemAction,
} from "./trip-actions";
let ctx: Awaited<ReturnType<typeof createMigratedDb>>;
const fake = createFakeAuth();
const data = <T>(result: Result<T>): T => {
  if (!result.ok) throw Error(result.error.code);
  return result.data;
};
const edit = { name: "Travel wash", qty: 4, timing: "main", scope: "remember" } as const;
const source = () =>
  createServerTripsSource(
    {} as TripsActions,
    {
      editItem: editItemAction,
      removeItem: removeItemAction,
      listStaples: listStaplesAction,
      getTrip: getTripAction,
      addToiletryItem: addToiletryItemAction,
    } as TripActions,
  );
const state = async () => {
  const tables = ["users", "staples", "trips", "trip_items"];
  return Promise.all(
    tables.map(
      async (table) => (await ctx.client.query(`SELECT * FROM ${table} ORDER BY id`)).rows,
    ),
  );
};
// Actual remembered ADD arranges state only. Every conflict/retry oracle keeps this original read.
async function arrange() {
  const trip = await seedTrip(ctx.db as unknown as Db, OWNER.userId);
  const snapshot = await seedTrip(ctx.db as unknown as Db, OWNER.userId);
  const result = data(
    await service.addToiletryItemToTrip(current, {
      tripId: trip.id,
      name: "Travel wash",
      qty: 1,
      packLast: false,
      scope: "remember",
    }),
  );
  const row = data(await service.listStaplesForOwner(current)).find(
    (row) => row.name === "Travel wash",
  )!;
  return {
    tripId: trip.id,
    itemId: row.id,
    row,
    expected: structuredClone(row.revision!),
    snapshot: data(await service.getTrip(current, { tripId: snapshot.id })),
    added: result,
  };
}
const external = (
  row: Awaited<ReturnType<typeof arrange>>["row"],
  expected: StapleRevision,
  qty = 8,
) =>
  service.upsertStapleChecked(current, { staple: { ...row, semanticId: row.id, qty }, expected });
beforeAll(async () => {
  ctx = await createMigratedDb();
});
afterAll(async () => {
  await ctx.client.close();
});
beforeEach(async () => {
  faults.trip = false;
  faults.staples = false;
  await resetData(ctx.client);
  signedInAs(fake, OWNER);
  current = makeContext(ctx.db as unknown as Db, fake);
});

describe("remembered edit/remove actual source action persistence contract", () => {
  it.each(["edit", "remove", "equal-content"])(
    "rejects stale %s before every trip/default write",
    async (operation) => {
      const { tripId, itemId, row, expected } = await arrange();
      data(await external(row, expected));
      const before = await state();
      faults.tripWrites = 0;
      faults.defaultWrites = 0;
      const command =
        operation === "remove"
          ? source().removeItem(tripId, itemId, "remember", expected)
          : source().editItem(
              tripId,
              itemId,
              { ...edit, qty: operation === "equal-content" ? 8 : 4 },
              expected,
            );
      await expect(command).rejects.toThrow("STALE");
      expect(faults.tripWrites).toBe(0);
      expect(faults.defaultWrites).toBe(0);
      expect(await state()).toEqual(before);
    },
  );
  it("rejects resurrection after an intentional delete", async () => {
    const { tripId, itemId, expected } = await arrange();
    data(await service.removeStapleChecked(current, { semanticId: itemId, expected }));
    const before = await state();
    await expect(source().editItem(tripId, itemId, edit, expected)).rejects.toThrow("STALE");
    expect(await state()).toEqual(before);
  });
  it("Retry retains the original command and token after a committed but lost response", async () => {
    const { tripId, itemId, expected } = await arrange();
    const intent = Object.freeze({ ...edit });
    const token = Object.freeze({ ...expected });
    const retry = () => source().editItem(tripId, itemId, intent, token);
    await retry();
    const before = await state();
    await expect(retry()).rejects.toThrow("STALE");
    expect(await state()).toEqual(before);
  });
  it("rejects an old UUID after delete/recreate at the same version", async () => {
    const { tripId, itemId, row, expected } = await arrange();
    data(await service.removeStapleChecked(current, { semanticId: itemId, expected }));
    const recreated = data(
      await service.upsertStapleChecked(current, {
        staple: { ...row, semanticId: itemId },
        expected: null,
      }),
    )[0];
    expect(recreated.revision!.version).toBe(expected.version);
    expect(recreated.revision!.rowId).not.toBe(expected.rowId);
    const before = await state();
    await expect(source().removeItem(tripId, itemId, "remember", expected)).rejects.toThrow(
      "STALE",
    );
    expect(await state()).toEqual(before);
  });
  it.each([
    undefined,
    {},
    { rowId: "bad", version: 1 },
    { rowId: "00000000-0000-4000-8000-000000000001", version: 0 },
    { rowId: "00000000-0000-4000-8000-000000000001", version: 1, extra: true },
  ])("rejects missing/malformed expectation %j through source/action/runtime", async (expected) => {
    const { tripId, itemId } = await arrange();
    const before = await state();
    await expect(
      source().editItem(tripId, itemId, edit, expected as StapleRevision),
    ).rejects.toThrow("INVALID_INPUT");
    await expect(
      source().removeItem(tripId, itemId, "remember", expected as StapleRevision),
    ).rejects.toThrow("INVALID_INPUT");
    expect(await state()).toEqual(before);
  });
  it("supports this-trip edit/remove without Staples metadata", async () => {
    const { tripId, itemId } = await arrange();
    const before = data(await service.listStaplesForOwner(current));
    await source().editItem(tripId, itemId, { ...edit, scope: "this-trip" });
    await source().removeItem(tripId, itemId, "this-trip");
    expect(data(await service.listStaplesForOwner(current))).toEqual(before);
  });
  it("requires explicit reviewed absence and returns real persisted fresh tokens without touching snapshots", async () => {
    const { tripId, itemId, expected, snapshot } = await arrange();
    data(await service.removeStapleChecked(current, { semanticId: itemId, expected }));
    const absent = await state();
    await expect(source().editItem(tripId, itemId, edit)).rejects.toThrow("INVALID_INPUT");
    expect(await state()).toEqual(absent);
    const result = await source().editItem(tripId, itemId, edit, null);
    const persisted = await source().listStaples();
    expect(result.staples).toEqual(persisted);
    expect(result.staples![0].revision).toEqual({ rowId: expect.any(String), version: 1 });
    expect(result.staples![0].revision!.rowId).not.toBe(expected.rowId);
    expect(data(await service.getTrip(current, { tripId: snapshot.id }))).toEqual(snapshot);
    expect(data(await service.getTrip(current, { tripId: snapshot.id })).items).toEqual(
      snapshot.items,
    );
    const token = structuredClone(result.staples![0].revision!);
    result.staples![0].revision!.version = 999;
    expect((await source().listStaples())[0].revision).toEqual(token);
    const changed = await source().editItem(tripId, itemId, { ...edit, qty: 7 }, token);
    expect(changed.staples![0].revision).toEqual({ ...token, version: 2 });
    const noop = await source().editItem(
      tripId,
      itemId,
      { ...edit, qty: 7 },
      changed.staples![0].revision!,
    );
    expect(noop.staples).toEqual(changed.staples);
    const removed = await source().removeItem(
      tripId,
      itemId,
      "remember",
      noop.staples![0].revision!,
    );
    expect(removed.staples).toEqual([]);
  });
  it("explicit absence cannot overwrite an existing remembered row", async () => {
    const { tripId, itemId } = await arrange();
    const before = await state();
    await expect(source().editItem(tripId, itemId, edit, null)).rejects.toThrow("STALE");
    await expect(source().removeItem(tripId, itemId, "remember", null)).rejects.toThrow("STALE");
    expect(await state()).toEqual(before);
  });
  it.each(["trip", "staples"] as const)(
    "rolls back all raw state after a post-%s-save fault",
    async (fault) => {
      const { tripId, itemId, expected } = await arrange();
      const before = await state();
      faults[fault] = true;
      await expect(source().editItem(tripId, itemId, edit, expected)).rejects.toThrow("INTERNAL");
      expect(await state()).toEqual(before);
      await expect(source().removeItem(tripId, itemId, "remember", expected)).rejects.toThrow(
        "INTERNAL",
      );
      expect(await state()).toEqual(before);
    },
  );
  it("isolates owner and foreign-trip access without changing raw state", async () => {
    const { tripId, itemId, expected } = await arrange();
    signedInAs(fake, OTHER_OWNER);
    const ownTrip = await seedTrip(ctx.db as unknown as Db, OTHER_OWNER.userId);
    const before = await state();
    await expect(source().editItem(tripId, itemId, edit, expected)).rejects.toThrow("NOT_FOUND");
    await expect(source().editItem(ownTrip.id, itemId, edit, expected)).rejects.toThrow("STALE");
    expect(await state()).toEqual(before);
  });
  it.each(["per day", "per night"] as const)(
    "preserves %s quantity conversion and raw no-op revisions",
    async (cadence) => {
      const { tripId, itemId, row, expected } = await arrange();
      const baseline = data(
        await service.upsertStapleChecked(current, {
          staple: { ...row, semanticId: itemId, cadence, qty: 2 },
          expected,
        }),
      )[0];
      const trip = data(await service.getTrip(current, { tripId }));
      const result = await source().editItem(
        tripId,
        itemId,
        { ...edit, qty: trip.days * 3 },
        baseline.revision!,
      );
      expect(result.staples![0]).toMatchObject({ cadence, qty: cadence === "per day" ? 3 : 2 });
      const before = (await state())[1];
      const token = result.staples![0].revision!;
      await source().editItem(tripId, itemId, { ...edit, qty: trip.days * 3 }, token);
      expect((await state())[1]).toEqual(before);
    },
  );
  it("preserves a laundry-halved saved rule rather than storing the trip total", async () => {
    const { tripId } = await arrange();
    const baseline = data(
      await service.upsertStapleChecked(current, {
        staple: {
          semanticId: "tops",
          name: "Tops",
          category: "Clothing",
          qty: 2,
          cadence: "per day",
          packLast: false,
          laundryHalves: true,
        },
        expected: null,
      }),
    ).find((row) => row.id === "tops")!;
    const result = await source().editItem(
      tripId,
      "tops",
      { ...edit, qty: 15 },
      baseline.revision!,
    );
    expect(result.staples!.find((row) => row.id === "tops")).toMatchObject({
      qty: 2,
      cadence: "per day",
      laundryHalves: true,
    });
  });
  it("preserves an unrelated writer while applying a matching target intent", async () => {
    const { tripId, itemId, expected } = await arrange();
    data(
      await service.upsertStapleChecked(current, {
        staple: {
          semanticId: "scarf",
          name: "Scarf",
          category: "Accessories",
          qty: 5,
          cadence: "per trip",
          packLast: false,
        },
        expected: null,
      }),
    );
    const unrelated = (await ctx.client.query("SELECT * FROM staples WHERE semantic_id='scarf'"))
      .rows;
    await expect(source().editItem(tripId, itemId, edit, expected)).resolves.toMatchObject({
      staples: expect.arrayContaining([expect.objectContaining({ id: itemId, qty: 4 })]),
    });
    expect(
      (await ctx.client.query("SELECT * FROM staples WHERE semantic_id='scarf'")).rows,
    ).toEqual(unrelated);
  });
});
