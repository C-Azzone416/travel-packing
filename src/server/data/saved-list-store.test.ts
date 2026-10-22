import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { applySavedLists } from "../../domain/saved-lists";
import { createMigratedDb, resetData } from "../db/__fixtures__/db";
import type { Db } from "../db/retention";
import { OTHER_OWNER, OWNER, makeStoredTrip, seedOwner } from "./__fixtures__/seed";
import {
  createSavedList,
  deleteSavedList,
  getSavedList,
  getSavedLists,
  listSavedLists,
  updateSavedList,
} from "./saved-list-store";
import { Refusal } from "./run";
import { insertTrip, loadTrip } from "./trip-store";

let ctx: Awaited<ReturnType<typeof createMigratedDb>>;
const db = () => ctx.db as unknown as Db;
const A = OWNER.userId;
const B = OTHER_OWNER.userId;

beforeAll(async () => {
  ctx = await createMigratedDb();
});
beforeEach(async () => {
  await resetData(ctx.client);
  await seedOwner(db(), A);
  await seedOwner(db(), B);
});
afterAll(async () => {
  await ctx.client.close();
});

const beach = {
  name: "Beach",
  items: [
    { id: "towel", name: "Beach towel", category: "Other essentials", qty: 2 },
    { id: "sunscreen", name: "Sunscreen", category: "Toiletries", qty: 1 },
  ],
};

async function code(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof Refusal && !error.result.ok) return error.result.error.code;
    throw error;
  }
  return undefined;
}

describe("saved lists CRUD", () => {
  it("creates, reads back in order, edits and deletes", async () => {
    const created = await createSavedList(db(), A, { ...beach, name: "  Beach " });
    expect(created.name).toBe("Beach");
    expect(created.items.map((item) => item.id)).toEqual(["towel", "sunscreen"]);
    expect(await getSavedList(db(), A, created.id)).toEqual(created);

    const edited = await updateSavedList(db(), A, created.id, {
      name: "Beach day",
      items: [{ id: "hat", name: "Hat", category: "Accessories", qty: 1 }, beach.items[0]],
    });
    expect(edited.name).toBe("Beach day");
    expect(edited.items.map((item) => item.id)).toEqual(["hat", "towel"]);
    expect(await listSavedLists(db(), A)).toEqual([edited]);

    await deleteSavedList(db(), A, created.id);
    expect(await listSavedLists(db(), A)).toEqual([]);
    const left = await ctx.client.query("SELECT 1 FROM saved_list_items");
    expect(left.rows).toHaveLength(0);
  });

  it("allows an empty list and keeps lists oldest first", async () => {
    const one = await createSavedList(db(), A, { name: "Empty", items: [] });
    const two = await createSavedList(db(), A, beach);
    expect(one.items).toEqual([]);
    expect((await listSavedLists(db(), A)).map((list) => list.id)).toEqual([one.id, two.id]);
  });

  it("getSavedLists returns the lists in the order asked", async () => {
    const one = await createSavedList(db(), A, { name: "One", items: [] });
    const two = await createSavedList(db(), A, beach);
    expect((await getSavedLists(db(), A, [two.id, one.id])).map((list) => list.name)).toEqual([
      "Beach",
      "One",
    ]);
  });

  it.each([
    ["a blank name", { name: "  ", items: [] }],
    ["a name over 80 characters", { name: "x".repeat(81), items: [] }],
    [
      "an unknown category",
      { name: "L", items: [{ id: "a", name: "A", category: "Nope", qty: 1 }] },
    ],
    ["a zero quantity", { name: "L", items: [{ id: "a", name: "A", category: "Tech", qty: 0 }] }],
    [
      "a fractional quantity",
      { name: "L", items: [{ id: "a", name: "A", category: "Tech", qty: 1.5 }] },
    ],
    ["a blank item name", { name: "L", items: [{ id: "a", name: " ", category: "Tech", qty: 1 }] }],
    ["a blank item id", { name: "L", items: [{ id: " ", name: "A", category: "Tech", qty: 1 }] }],
    [
      "a repeated item id",
      {
        name: "L",
        items: [
          { id: "a", name: "A", category: "Tech", qty: 1 },
          { id: "a", name: "B", category: "Tech", qty: 1 },
        ],
      },
    ],
  ])("refuses %s on create and update", async (_label, input) => {
    expect(await code(createSavedList(db(), A, input))).toBe("INVALID_INPUT");
    const list = await createSavedList(db(), A, beach);
    expect(await code(updateSavedList(db(), A, list.id, input))).toBe("INVALID_INPUT");
    expect(await getSavedList(db(), A, list.id)).toEqual(list);
  });

  it("answers NOT_FOUND for an unknown list", async () => {
    const missing = "00000000-0000-4000-8000-00000000ffff";
    expect(await code(getSavedList(db(), A, missing))).toBe("NOT_FOUND");
    expect(await code(updateSavedList(db(), A, missing, beach))).toBe("NOT_FOUND");
    expect(await code(deleteSavedList(db(), A, missing))).toBe("NOT_FOUND");
  });
});

describe("owner isolation", () => {
  it("another owner can't list, read, apply, edit or delete a list", async () => {
    const mine = await createSavedList(db(), A, beach);

    expect(await listSavedLists(db(), B)).toEqual([]);
    expect(await code(getSavedList(db(), B, mine.id))).toBe("NOT_FOUND");
    expect(await code(getSavedLists(db(), B, [mine.id]))).toBe("NOT_FOUND");
    expect(await code(updateSavedList(db(), B, mine.id, { name: "Stolen", items: [] }))).toBe(
      "NOT_FOUND",
    );
    expect(await code(deleteSavedList(db(), B, mine.id))).toBe("NOT_FOUND");

    expect(await getSavedList(db(), A, mine.id)).toEqual(mine);
  });

  it("the database refuses an item that points at another owner's list", async () => {
    const mine = await createSavedList(db(), A, beach);
    await expect(
      ctx.client.query(
        `INSERT INTO saved_list_items (list_id, owner_id, semantic_id, name, category, qty)
         VALUES ($1, $2, 'x', 'X', 'Tech', 1)`,
        [mine.id, B],
      ),
    ).rejects.toThrow();
  });

  it("deleting an owner removes their lists", async () => {
    await createSavedList(db(), A, beach);
    await ctx.client.query('DELETE FROM "users" WHERE id = $1', [A]);
    expect((await ctx.client.query("SELECT 1 FROM saved_lists")).rows).toHaveLength(0);
    expect((await ctx.client.query("SELECT 1 FROM saved_list_items")).rows).toHaveLength(0);
  });
});

describe("lists and trips are independent", () => {
  it("editing or deleting a list never touches a trip that used it", async () => {
    const list = await createSavedList(db(), A, beach);
    const [applied] = [applySavedLists([], [list])];
    expect(applied.planned.every((item) => item.packed === 0)).toBe(true);

    const trip = makeStoredTrip();
    await insertTrip(db(), A, trip);
    const before = JSON.stringify(await loadTrip(db(), A, trip.id));

    await updateSavedList(db(), A, list.id, { name: "Renamed", items: [] });
    await deleteSavedList(db(), A, list.id);

    expect(JSON.stringify(await loadTrip(db(), A, trip.id))).toBe(before);
  });
});
