import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createMigratedDb, resetData } from "../db/__fixtures__/db";
import type { Db } from "../db/retention";
import {
  createFakeAuth,
  makeContext,
  OWNER,
  OTHER_OWNER,
  seedTrip,
  signedInAs,
} from "./__fixtures__/seed";
import type { DataContext } from "./context";
import type { Result } from "./result";
import type { Staple } from "../../domain/trip";
import * as service from "./service";

let current: DataContext;
vi.mock("./runtime", () => ({ getDataContext: async () => current }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
let fault: "none" | "rows" | "flags" = "none";
vi.mock("./staple-store", async (original) => {
  const store = await original<typeof import("./staple-store")>();
  return {
    ...store,
    saveStaples: async (...args: Parameters<typeof store.saveStaples>) => {
      await store.saveStaples(...args);
      if (fault === "rows") throw new Error("after replacement");
    },
    listStaples: async (...args: Parameters<typeof store.listStaples>) => {
      if (fault === "flags" && !args[2]?.lock) throw new Error("after setup flags");
      return store.listStaples(...args);
    },
  };
});
import { getStaplesSetupAction, saveStaplesSetupAction } from "../../features/trips/trip-actions";
let ctx: Awaited<ReturnType<typeof createMigratedDb>>;
const auth = createFakeAuth();
const ok = <T>(result: Result<T>): T => {
  if (!result.ok) throw new Error(result.error.code);
  return result.data;
};
const staple: Staple = {
  id: "underwear",
  name: "Underwear",
  category: "Clothing",
  qty: 1,
  cadence: "per day",
  packLast: false,
};
const content = (s: Staple) => ({ ...s, semanticId: s.id });
const baseline = (rows: Staple[]) =>
  rows.map((s) => ({ semanticId: s.id, revision: { ...s.revision! } }));
const read = async () => ok(await service.getStaplesSetup(current)).staples;
const write = async (s: Staple, expected = s.revision ?? null) =>
  ok(await service.upsertStapleChecked(current, { staple: content(s), expected }));
const snapshot = async () => ({
  staples: (await ctx.client.query("select * from staples order by owner_id, semantic_id")).rows,
  users: (await ctx.client.query("select * from users order by id")).rows,
  trips: (await ctx.client.query("select * from trips order by id")).rows,
  items: (await ctx.client.query("select * from trip_items order by id")).rows,
});
beforeAll(async () => {
  ctx = await createMigratedDb();
});
beforeEach(async () => {
  fault = "none";
  await resetData(ctx.client);
  signedInAs(auth, OWNER);
  current = makeContext(ctx.db as unknown as Db, auth);
  await service.getStaplesSetup(current);
});
afterAll(async () => {
  await ctx.client.close();
});

describe("captured complete setup membership", () => {
  it.each(["quantity", "insert", "delete", "recreate", "empty insert"])(
    "rejects stale %s at real action boundary without any row/flag/timestamp/trip change",
    async (kind) => {
      if (kind !== "empty insert") await write(staple);
      const initial = await getStaplesSetupAction();
      if (!initial.ok) throw new Error(initial.code);
      const captured = baseline(initial.staples);
      const intended = initial.staples.map((s) => ({ ...s, packLast: true }));
      const row = initial.staples[0];
      await seedTrip(ctx.db as unknown as Db, OWNER.userId);
      await service.skipStaplesSetup(current);
      await service.dismissStaplesReminder(current);
      if (kind === "quantity") await write({ ...row, qty: 9 });
      if (kind === "insert" || kind === "empty insert")
        await write({ ...staple, id: "scarf", name: "Scarf" });
      if (kind === "delete" || kind === "recreate")
        ok(
          await service.removeStapleChecked(current, {
            semanticId: row.id,
            expected: row.revision,
          }),
        );
      if (kind === "recreate") {
        const recreated = (await write(staple))[0];
        expect(recreated.revision!.version).toBe(row.revision!.version);
        expect(recreated.revision!.rowId).not.toBe(row.revision!.rowId);
      }
      const before = await snapshot();
      // This oracle intentionally replays the captured read; no fresh-token fixture helper here.
      expect(await saveStaplesSetupAction(intended, captured)).toEqual({
        ok: false,
        code: "STALE",
      });
      expect(await snapshot()).toEqual(before);
    },
  );

  it("checks an unchecked row even when it is intentionally omitted from the replacement", async () => {
    await write(staple);
    const captured = baseline(await read());
    await write({ ...(await read())[0], qty: 7 });
    const before = await snapshot();
    expect(
      await service.saveStaplesSetup(current, { staples: [], baseline: captured }),
    ).toMatchObject({ ok: false, error: { code: "STALE" } });
    expect(await snapshot()).toEqual(before);
  });

  it("matching complete baseline allows intentional removal then empty selection and returns actual fresh revisions", async () => {
    await write(staple);
    await write({ ...staple, id: "socks", name: "Socks" });
    const initial = await read();
    const saved = await saveStaplesSetupAction([{ ...initial[0], qty: 3 }], baseline(initial));
    expect(saved.ok).toBe(true);
    if (!saved.ok) throw new Error(saved.code);
    expect(saved.staples).toHaveLength(1);
    expect(saved.staples[0]).toMatchObject({
      qty: 3,
      revision: { rowId: initial[0].revision!.rowId, version: 2 },
    });
    expect(saved.staples).toEqual(await read());
    expect(await saveStaplesSetupAction([], baseline(saved.staples))).toMatchObject({
      ok: true,
      staples: [],
      state: "completed",
    });
    expect(await saveStaplesSetupAction([], [])).toMatchObject({ ok: true, staples: [] });
  });

  it.each([
    undefined,
    null,
    {},
    [{ semanticId: "x", revision: null }],
    [{ semanticId: "x", revision: { rowId: "bad", version: 1 } }],
    [{ semanticId: "x", revision: { rowId: "00000000-0000-4000-8000-000000000001", version: 0 } }],
  ])("rejects omitted/malformed baseline %j before writing", async (value) => {
    const before = await snapshot();
    expect(
      await service.saveStaplesSetup(current, { staples: [content(staple)], baseline: value }),
    ).toMatchObject({ ok: false, error: { code: "INVALID_INPUT" } });
    expect(await snapshot()).toEqual(before);
  });

  it("rejects duplicate semantic identities and duplicate physical identities", async () => {
    await write(staple);
    const captured = baseline(await read());
    const before = await snapshot();
    for (const duplicate of [captured[0], { ...captured[0], semanticId: "socks" }]) {
      expect(
        await service.saveStaplesSetup(current, {
          staples: [],
          baseline: [...captured, duplicate],
        }),
      ).toMatchObject({ ok: false, error: { code: "INVALID_INPUT" } });
      expect(await snapshot()).toEqual(before);
    }
  });

  it("old action clients cannot omit a baseline", async () => {
    const before = await snapshot();
    // @ts-expect-error exercise old runtime caller
    expect(await saveStaplesSetupAction([staple])).toEqual({ ok: false, code: "INVALID_INPUT" });
    expect(await snapshot()).toEqual(before);
  });

  it("owner membership cannot authorize another owner and matching writes preserve snapshots", async () => {
    await write(staple);
    const captured = baseline(await read());
    await seedTrip(ctx.db as unknown as Db, OWNER.userId);
    signedInAs(auth, OTHER_OWNER);
    await service.getStaplesSetup(current);
    const before = await snapshot();
    expect(await saveStaplesSetupAction([], captured)).toEqual({ ok: false, code: "STALE" });
    expect(await snapshot()).toEqual(before);
    expect(await saveStaplesSetupAction([], [])).toMatchObject({ ok: true });
    const after = await snapshot();
    expect(after.staples).toEqual(before.staples);
    expect(after.trips).toEqual(before.trips);
    expect(after.items).toEqual(before.items);
  });

  it.each(["rows", "flags"] as const)(
    "rolls back full replacement and setup flags after post-%s fault",
    async (point) => {
      await write(staple);
      await write({ ...staple, id: "socks", name: "Socks" });
      await seedTrip(ctx.db as unknown as Db, OWNER.userId);
      await service.skipStaplesSetup(current);
      await service.dismissStaplesReminder(current);
      const captured = baseline(await read());
      const before = await snapshot();
      fault = point;
      expect(
        await service.saveStaplesSetup(current, {
          staples: [
            content({ ...staple, qty: 7 }),
            content({ ...staple, id: "scarf", name: "Scarf" }),
          ],
          baseline: captured,
        }),
      ).toMatchObject({ ok: false, error: { code: "INTERNAL" } });
      fault = "none";
      expect(await snapshot()).toEqual(before);
    },
  );
});
