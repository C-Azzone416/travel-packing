import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Staple } from "../../domain/trip";
import { createMigratedDb, resetData } from "../db/__fixtures__/db";
import type { Db } from "../db/retention";
import { OTHER_OWNER, OWNER, seedOwner } from "./__fixtures__/seed";
import { Refusal } from "./run";
import { listStaples, saveStaples } from "./staple-store";

let ctx: Awaited<ReturnType<typeof createMigratedDb>>;
const db = () => ctx.db as unknown as Db;

beforeAll(async () => {
  ctx = await createMigratedDb();
});
beforeEach(async () => {
  await resetData(ctx.client);
  await seedOwner(db(), OWNER.userId);
  await seedOwner(db(), OTHER_OWNER.userId);
});
afterAll(async () => {
  await ctx.client.close();
});

const versions = async () =>
  (
    await ctx.client.query<{ semantic_id: string; version: number }>(
      'SELECT semantic_id, version FROM "staples" ORDER BY semantic_id',
    )
  ).rows;

describe("an uninitialized owner's Staples", () => {
  it("starts empty and stays empty across repeated reads", async () => {
    expect(await listStaples(db(), OWNER.userId)).toEqual([]);
    expect(await listStaples(db(), OWNER.userId)).toEqual([]);
    expect(await listStaples(db(), OTHER_OWNER.userId)).toEqual([]);
  });
});

describe("saveStaples", () => {
  const base: Staple = {
    id: "scarf",
    name: "Scarf",
    category: "Accessories",
    qty: 1,
    cadence: "per trip",
    packLast: false,
  };

  it("inserts new staples at version 1", async () => {
    await saveStaples(db(), OWNER.userId, [base]);
    expect(await listStaples(db(), OWNER.userId)).toEqual([base]);
    expect(await versions()).toEqual([{ semantic_id: "scarf", version: 1 }]);
  });

  it("bumps the version only for staples that actually changed", async () => {
    const other: Staple = { ...base, id: "hat", name: "Hat" };
    await saveStaples(db(), OWNER.userId, [base, other]);
    await saveStaples(db(), OWNER.userId, [{ ...base, qty: 2 }, other]);
    expect(await versions()).toEqual([
      { semantic_id: "hat", version: 1 },
      { semantic_id: "scarf", version: 2 },
    ]);
    await saveStaples(db(), OWNER.userId, [{ ...base, qty: 2 }, other]);
    expect((await versions()).map((row) => row.version)).toEqual([1, 2]);
  });

  it.each([
    ["name", { name: "Wool scarf" }],
    ["category", { category: "Other essentials" }],
    ["cadence", { cadence: "per day" as const }],
    ["Pack last", { packLast: true }],
    ["group", { groupId: "toiletry-bag" }],
  ])("a changed %s is saved", async (_label, change) => {
    await saveStaples(db(), OWNER.userId, [base]);
    await saveStaples(db(), OWNER.userId, [{ ...base, ...change }]);
    expect(await listStaples(db(), OWNER.userId)).toEqual([{ ...base, ...change }]);
    expect((await versions())[0].version).toBe(2);
  });

  it("clearing a group is a change", async () => {
    await saveStaples(db(), OWNER.userId, [{ ...base, groupId: "toiletry-bag" }]);
    await saveStaples(db(), OWNER.userId, [base]);
    expect(await listStaples(db(), OWNER.userId)).toEqual([base]);
  });

  it("deletes staples that are no longer present, only for this owner", async () => {
    await saveStaples(db(), OWNER.userId, [base]);
    await saveStaples(db(), OTHER_OWNER.userId, [base]);
    await saveStaples(db(), OWNER.userId, []);
    expect(await listStaples(db(), OWNER.userId)).toEqual([]);
    expect(await listStaples(db(), OTHER_OWNER.userId)).toEqual([base]);
  });

  it("rejects a category outside the enum before writing", async () => {
    await expect(
      saveStaples(db(), OWNER.userId, [{ ...base, category: "Gadgets" }]),
    ).rejects.toBeInstanceOf(Refusal);
    expect(await listStaples(db(), OWNER.userId)).toEqual([]);
  });

  it("accepts Smart only for documented clothing identities", async () => {
    await saveStaples(db(), OWNER.userId, [
      { ...base, id: "tops", name: "My shirts", category: "Clothing", cadence: "smart" },
    ]);
    expect(await listStaples(db(), OWNER.userId)).toEqual([
      { ...base, id: "tops", name: "My shirts", category: "Clothing", cadence: "smart" },
    ]);
    await expect(
      saveStaples(db(), OWNER.userId, [{ ...base, cadence: "smart" }]),
    ).rejects.toBeInstanceOf(Refusal);
  });

  it("rejects two raw ids that resolve to one canonical identity", async () => {
    await expect(
      saveStaples(db(), OWNER.userId, [
        { ...base, id: "sunscreen", name: "My SPF" },
        { ...base, id: "weather-sunscreen", name: "Sun cream" },
      ]),
    ).rejects.toBeInstanceOf(Refusal);
    expect(await listStaples(db(), OWNER.userId)).toEqual([]);
  });

  describe("another owner with the same default ids", () => {
    const base: Staple = {
      id: "socks",
      name: "Socks",
      category: "Clothing",
      qty: 1,
      cadence: "per day",
      packLast: false,
    };

    it.each([
      ["A saves first", [OWNER.userId, OTHER_OWNER.userId]],
      ["B saves first", [OTHER_OWNER.userId, OWNER.userId]],
    ])("each owner's edit persists and bumps only their own version (%s)", async (_name, order) => {
      for (const owner of order) await saveStaples(db(), owner, [base]);
      await saveStaples(db(), OWNER.userId, [{ ...base, qty: 3 }]);
      expect((await listStaples(db(), OWNER.userId))[0].qty).toBe(3);
      expect((await listStaples(db(), OTHER_OWNER.userId))[0].qty).toBe(1);
      await saveStaples(db(), OTHER_OWNER.userId, [{ ...base, qty: 5 }]);
      expect((await listStaples(db(), OTHER_OWNER.userId))[0].qty).toBe(5);
      expect((await listStaples(db(), OWNER.userId))[0].qty).toBe(3);
      const versions = (
        await ctx.client.query<{ owner_id: string; version: number }>(
          "SELECT owner_id, version FROM staples ORDER BY owner_id",
        )
      ).rows;
      expect(versions).toEqual([
        { owner_id: OWNER.userId, version: 2 },
        { owner_id: OTHER_OWNER.userId, version: 2 },
      ]);
    });

    it("deleting one owner's staple leaves the other's identical staple", async () => {
      await saveStaples(db(), OWNER.userId, [base]);
      await saveStaples(db(), OTHER_OWNER.userId, [base]);
      await saveStaples(db(), OWNER.userId, []);
      expect(await listStaples(db(), OTHER_OWNER.userId)).toEqual([base]);
    });
  });
});
