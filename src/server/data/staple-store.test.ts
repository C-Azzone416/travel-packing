import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_STAPLES } from "../../domain/calc";
import type { Staple } from "../../domain/trip";
import { createMigratedDb, resetData } from "../db/__fixtures__/db";
import type { Db } from "../db/retention";
import { OTHER_OWNER, OWNER, seedOwner } from "./__fixtures__/seed";
import { Refusal } from "./run";
import { ensureDefaultStaples, listStaples, saveStaples } from "./staple-store";

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

describe("ensureDefaultStaples", () => {
  it("seeds the prototype defaults once and never overwrites", async () => {
    await ensureDefaultStaples(db(), OWNER.userId);
    const first = await listStaples(db(), OWNER.userId);
    expect(first.map((staple) => staple.id).sort()).toEqual(
      DEFAULT_STAPLES.map((staple) => staple.id).sort(),
    );

    const edited = first.map((staple) => (staple.id === "socks" ? { ...staple, qty: 3 } : staple));
    await saveStaples(db(), OWNER.userId, edited);
    await ensureDefaultStaples(db(), OWNER.userId);
    expect(
      (await listStaples(db(), OWNER.userId)).find((staple) => staple.id === "socks")?.qty,
    ).toBe(3);
  });

  it("does not re-add a default the owner removed", async () => {
    await ensureDefaultStaples(db(), OWNER.userId);
    const without = (await listStaples(db(), OWNER.userId)).filter(
      (staple) => staple.id !== "sunglasses",
    );
    await saveStaples(db(), OWNER.userId, without);
    await ensureDefaultStaples(db(), OWNER.userId);
    expect(
      (await listStaples(db(), OWNER.userId)).some((staple) => staple.id === "sunglasses"),
    ).toBe(false);
  });

  it("keeps each owner's staples separate", async () => {
    await ensureDefaultStaples(db(), OWNER.userId);
    expect(await listStaples(db(), OTHER_OWNER.userId)).toEqual([]);
  });

  it("preserves the Bathroom group and Pack last flags", async () => {
    await ensureDefaultStaples(db(), OWNER.userId);
    const toothbrush = (await listStaples(db(), OWNER.userId)).find(
      (staple) => staple.id === "last-toothbrush",
    );
    expect(toothbrush).toMatchObject({
      packLast: true,
      groupId: "toiletry-bag",
      cadence: "per trip",
    });
    const underwear = (await listStaples(db(), OWNER.userId)).find(
      (staple) => staple.id === "underwear",
    );
    expect(underwear).not.toHaveProperty("groupId");
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
});
