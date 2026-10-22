import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createMigratedDb, resetData } from "@/server/db/__fixtures__/db";
import type { Db } from "@/server/db/retention";
import {
  createFakeAuth,
  makeContext,
  OTHER_OWNER,
  OWNER,
  seedOwner,
  signedInAs,
} from "@/server/data/__fixtures__/seed";
import type { DataContext } from "@/server/data/context";
import { createSavedList } from "@/server/data/saved-list-store";

let current: DataContext | null = null;
vi.mock("@/server/data/runtime", () => ({ getDataContext: async () => current }));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  },
}));

import {
  addSavedListItemAction,
  deleteSavedListAction,
  getSavedListAction,
  listSavedListsAction,
  removeSavedListItemAction,
  renameSavedListAction,
  updateSavedListItemAction,
} from "./saved-list-actions";

let ctx: Awaited<ReturnType<typeof createMigratedDb>>;
const fake = createFakeAuth();
const db = () => ctx.db as unknown as Db;
const as = (user: typeof OWNER | null) => signedInAs(fake, user);
const MISSING = "00000000-0000-4000-8000-0000000000ff";

beforeAll(async () => {
  ctx = await createMigratedDb();
});
beforeEach(async () => {
  await resetData(ctx.client);
  as(OWNER);
  current = makeContext(db(), fake);
  await seedOwner(db(), OWNER.userId);
  await seedOwner(db(), OTHER_OWNER.userId);
});
afterAll(async () => {
  await ctx.client.close();
});

const seed = () =>
  createSavedList(db(), OWNER.userId, {
    name: "Beach week",
    items: [{ id: "towel", name: "Beach towel", category: "Other essentials", qty: 2 }],
  });

describe("saved list actions", () => {
  it("lists, reads, renames, edits and deletes through the owner-gated service", async () => {
    const list = await seed();
    const all = await listSavedListsAction();
    expect(all).toMatchObject({
      ok: true,
      lists: [{ id: list.id, name: "Beach week", itemCount: 1 }],
    });
    expect(await getSavedListAction(list.id)).toMatchObject({
      ok: true,
      list: { name: "Beach week" },
    });
    expect(await renameSavedListAction(list.id, "Lake week")).toMatchObject({
      ok: true,
      list: { name: "Lake week" },
    });
    const added = await addSavedListItemAction(list.id, {
      name: "Camera",
      category: "Tech",
      qty: 1,
    });
    expect(added.ok && added.list.items).toHaveLength(2);
    const updated = await updateSavedListItemAction(list.id, "towel", {
      name: "Towel",
      category: "Other essentials",
      qty: 3,
    });
    expect(updated.ok && updated.list.items[0]).toMatchObject({ name: "Towel", qty: 3 });
    const removed = await removeSavedListItemAction(list.id, "towel");
    expect(removed.ok && removed.list.items).toHaveLength(1);
    expect(await deleteSavedListAction(list.id)).toEqual({ ok: true, id: list.id });
    expect(await getSavedListAction(list.id)).toEqual({ ok: false, code: "NOT_FOUND" });
  });

  it("hands refusals back as data: NAME_TAKEN, EXISTS and the invalid field names", async () => {
    const list = await seed();
    await createSavedList(db(), OWNER.userId, { name: "Ski", items: [] });
    expect(await renameSavedListAction(list.id, "ski")).toEqual({
      ok: false,
      code: "REJECTED",
      reason: "NAME_TAKEN",
    });
    expect(
      await addSavedListItemAction(list.id, {
        name: "beach towel",
        category: "Other essentials",
        qty: 1,
      }),
    ).toEqual({
      ok: false,
      code: "REJECTED",
      reason: "EXISTS",
    });
    expect(await addSavedListItemAction(list.id, { name: "", category: "Nope", qty: 0 })).toEqual({
      ok: false,
      code: "INVALID_INPUT",
      fields: expect.arrayContaining(["name", "category", "qty"]),
    });
  });

  it("answers NOT_FOUND, not an error page, for a missing list or another owner's", async () => {
    const list = await seed();
    expect(await getSavedListAction(MISSING)).toEqual({ ok: false, code: "NOT_FOUND" });
    as(OTHER_OWNER);
    for (const result of [
      await getSavedListAction(list.id),
      await renameSavedListAction(list.id, "Mine now"),
      await deleteSavedListAction(list.id),
      await removeSavedListItemAction(list.id, "towel"),
    ]) {
      expect(result).toEqual({ ok: false, code: "NOT_FOUND" });
    }
    expect(await listSavedListsAction()).toEqual({ ok: true, lists: [] });
  });

  it("sends a signed-out caller to sign-in and a non-allowed account to access-denied", async () => {
    as(null);
    await expect(listSavedListsAction()).rejects.toThrow("NEXT_REDIRECT:/sign-in");
    as({ userId: "intruder", email: "intruder@example.test" });
    await expect(listSavedListsAction()).rejects.toThrow("NEXT_REDIRECT:/access-denied");
  });

  it("fails without a data context", async () => {
    current = null;
    expect(await listSavedListsAction()).toEqual({ ok: false, code: "INTERNAL" });
  });
});
