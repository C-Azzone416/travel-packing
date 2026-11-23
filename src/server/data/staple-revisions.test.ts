import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createMigratedDb, resetData } from "../db/__fixtures__/db";
import type { Db } from "../db/retention";
import {
  createFakeAuth,
  makeContext,
  OWNER,
  OTHER_OWNER,
  CONFIG,
  signedInAs,
} from "./__fixtures__/seed";
import * as service from "./service";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "../db/schema";
import type { Staple } from "../../domain/trip";
import type { Result } from "./result";

const faults = vi.hoisted(() => ({ afterWrite: false }));
vi.mock("./staple-store", async (importOriginal) => {
  const original = await importOriginal<typeof import("./staple-store")>();
  return {
    ...original,
    saveStaples: async (...args: Parameters<typeof original.saveStaples>) => {
      await original.saveStaples(...args);
      if (faults.afterWrite) throw Error("injected failure after nested store savepoint");
    },
  };
});

let ctx: Awaited<ReturnType<typeof createMigratedDb>>;
const fake = createFakeAuth();
const context = () => makeContext(ctx.db as unknown as Db, fake);
function data<T>(result: Result<T>): T {
  if (!result.ok) throw Error(result.error.code);
  return result.data;
}
const content = {
  semanticId: "scarf",
  name: "Scarf",
  category: "Accessories",
  qty: 1,
  cadence: "per trip",
  packLast: false,
};
const raw = async () =>
  (
    await ctx.client.query<{ id: string; version: number }>(
      "SELECT * FROM staples ORDER BY owner_id, semantic_id",
    )
  ).rows;
const read = async () => data(await service.listStaplesForOwner(context()));
const token = async () => (await read())[0].revision!;
const upsert = (staple: typeof content, expected: Staple["revision"] | null) =>
  service.upsertStapleChecked(context(), { staple, expected });
const remove = (expected: Staple["revision"] | null) =>
  service.removeStapleChecked(context(), { semanticId: "scarf", expected });
const state = async () => ({
  staples: await raw(),
  users: (await ctx.client.query("SELECT * FROM users ORDER BY id")).rows,
  trips: (await ctx.client.query("SELECT * FROM trips ORDER BY id")).rows,
  items: (await ctx.client.query("SELECT * FROM trip_items ORDER BY id")).rows,
});
beforeAll(async () => {
  ctx = await createMigratedDb();
});
afterAll(async () => {
  await ctx.client.close();
});
beforeEach(async () => {
  faults.afterWrite = false;
  await resetData(ctx.client);
  signedInAs(fake, OWNER);
  data(await service.upsertStaple(context(), content));
});
describe("captured Staple revision policy", () => {
  it("rejects stale same-row update atomically", async () => {
    const expected = await token();
    data(await service.upsertStaple(context(), { ...content, qty: 3 }));
    const before = await raw();
    expect(await upsert({ ...content, packLast: true }, expected)).toMatchObject({
      ok: false,
      error: { code: "STALE" },
    });
    expect(await raw()).toEqual(before);
  });
  it("rejects stale delete atomically", async () => {
    const expected = await token();
    data(await service.upsertStaple(context(), { ...content, qty: 3 }));
    const before = await raw();
    expect(await remove(expected)).toMatchObject({ ok: false, error: { code: "STALE" } });
    expect(await raw()).toEqual(before);
  });
  it("rejects resurrection after delete atomically", async () => {
    const expected = await token();
    data(await service.removeStaple(context(), { semanticId: "scarf" }));
    const before = await raw();
    expect(await upsert({ ...content, qty: 3 }, expected)).toMatchObject({
      ok: false,
      error: { code: "STALE" },
    });
    expect(await raw()).toEqual(before);
  });
});

describe("checked Staple commands", () => {
  it("returns UUID/version on reads, advances changed content, preserves a matching no-op", async () => {
    const expected = await token();
    expect(expected).toEqual({ rowId: expect.stringMatching(/^[0-9a-f-]{36}$/), version: 1 });
    const [stored] = await raw();
    expect(expected).toEqual({ rowId: stored.id, version: stored.version });
    const changed = data(await upsert({ ...content, qty: 3 }, expected))[0];
    expect(changed.id).toBe("scarf");
    expect(changed.revision).toEqual({ ...expected, version: 2 });
    const before = await state();
    expect(data(await upsert({ ...content, qty: 3 }, changed.revision))[0]).toEqual(changed);
    expect(await state()).toEqual(before);
  });

  it("checks even an equal-content stale no-op before any staple/trip writes", async () => {
    const expected = await token();
    data(await upsert({ ...content, qty: 3 }, expected));
    const before = await state();
    const queries: string[] = [];
    const logged = drizzle(ctx.client, {
      schema,
      logger: { logQuery: (q) => void queries.push(q) },
    }) as unknown as Db;
    expect(
      await service.upsertStapleChecked(makeContext(logged, fake), {
        staple: { ...content, qty: 3 },
        expected,
      }),
    ).toMatchObject({ ok: false, error: { code: "STALE" } });
    expect(
      queries.filter((q) =>
        /^(insert into|update|delete from) "(staples|trips|trip_items)"/i.test(q),
      ),
    ).toEqual([]);
    expect(await state()).toEqual(before);
    expect(queries.findIndex((q) => q.includes("pg_advisory_xact_lock"))).toBeLessThan(
      queries.findIndex((q) => q.includes('from "staples"')),
    );
  });

  it.each([
    undefined,
    {},
    { rowId: "bad", version: 1 },
    { rowId: "00000000-0000-4000-8000-000000000001", version: 0 },
    { rowId: "00000000-0000-4000-8000-000000000001", version: 1.5 },
    { rowId: "00000000-0000-4000-8000-000000000001", version: 1, bypass: true },
  ])("fails closed for malformed/missing expectation %j", async (expected) => {
    const before = await state();
    for (const result of [
      await upsert(content, expected as never),
      await remove(expected as never),
    ]) {
      expect(result).toMatchObject({ ok: false, error: { code: "INVALID_INPUT" } });
    }
    expect(await state()).toEqual(before);
  });

  it("null succeeds only for absence; matching delete succeeds and returns remaining fresh tokens", async () => {
    const before = await state();
    expect(await upsert(content, null)).toMatchObject({ ok: false, error: { code: "STALE" } });
    expect(await remove(null)).toMatchObject({ ok: false, error: { code: "STALE" } });
    expect(await state()).toEqual(before);
    expect(data(await remove(await token()))).toEqual([]);
    expect(data(await remove(null))).toEqual([]);
    const created = data(await upsert(content, null))[0];
    expect(created.revision).toMatchObject({ version: 1 });
  });

  it("old UUID cannot update or delete a recreated row with the same version", async () => {
    const old = await token();
    data(await remove(old));
    data(await upsert(content, null));
    expect(await token()).toMatchObject({ version: old.version });
    expect((await token()).rowId).not.toBe(old.rowId);
    const before = await state();
    expect(await upsert({ ...content, qty: 4 }, old)).toMatchObject({
      ok: false,
      error: { code: "STALE" },
    });
    expect(await remove(old)).toMatchObject({ ok: false, error: { code: "STALE" } });
    expect(await state()).toEqual(before);
  });

  it("compares only the target and preserves another row's earlier change", async () => {
    data(await upsert({ ...content, semanticId: "hat", name: "Hat" }, null));
    const [a, b] = await read();
    data(await upsert({ ...content, qty: 3 }, a.revision));
    const first = (await raw())[1]; // ordered hat, scarf
    const result = data(
      await upsert({ ...content, semanticId: b.id, name: b.name, qty: 2 }, b.revision),
    );
    expect(result.map((s) => [s.id, s.qty])).toEqual([
      ["scarf", 3],
      ["hat", 2],
    ]);
    expect((await raw())[1]).toEqual(first);
  });

  it("serializes checked inserts even from an empty owner set", async () => {
    data(await remove(await token()));
    const results = await Promise.all([
      upsert(content, null),
      upsert({ ...content, semanticId: "hat", name: "Hat" }, null),
    ]);
    expect(results.every((result) => result.ok)).toBe(true);
    expect((await read()).map((s) => s.id).sort()).toEqual(["hat", "scarf"]);
  });

  it("is owner scoped even when semantic identities match", async () => {
    const ownerToken = await token();
    const before = await raw();
    signedInAs(fake, OTHER_OWNER);
    expect(await upsert({ ...content, qty: 5 }, ownerToken)).toMatchObject({
      ok: false,
      error: { code: "STALE" },
    });
    expect(await raw()).toEqual(before);
    const other = data(await upsert(content, null))[0];
    expect(other.revision!.rowId).not.toBe(ownerToken.rowId);
    expect(await remove(ownerToken)).toMatchObject({ ok: false, error: { code: "STALE" } });
    data(await upsert({ ...content, qty: 5 }, other.revision));
    signedInAs(fake, OWNER);
    expect((await read())[0]).toMatchObject({ qty: 1, revision: ownerToken });
  });

  it("rolls back completed nested saves on injected update, create and delete failure", async () => {
    const expected = await token();
    const before = await state();
    faults.afterWrite = true;
    for (const attempt of [
      () => upsert({ ...content, qty: 3 }, expected),
      () => upsert({ ...content, semanticId: "hat" }, null),
      () => remove(expected),
    ]) {
      expect(await attempt()).toMatchObject({ ok: false, error: { code: "INTERNAL" } });
      expect(await state()).toEqual(before);
    }
    faults.afterWrite = false;
    data(await upsert({ ...content, qty: 3 }, expected));
    expect((await token()).version).toBe(2);
  });

  it("keeps read revisions out of real trip snapshots and preserves existing trips", async () => {
    const c = {
      ...context(),
      resolveLocation: async () => ({
        id: "sample-b",
        city: "Exampleville",
        region: "",
        country: "Sampleland",
        countryCode: "SL",
        label: "Exampleville",
      }),
    };
    const trip = data(
      await service.createTrip(c, {
        location: { id: "sample-b" },
        start: "2030-04-01",
        end: "2030-04-08",
        config: CONFIG,
      }),
    );
    expect(trip.items.find((s) => s.id === "scarf")).toMatchObject({ name: "Scarf" });
    for (const item of trip.items) expect(item).not.toHaveProperty("revision");
    expect(JSON.stringify(trip)).not.toContain((await token()).rowId);
    const before = data(await service.getTrip(context(), { tripId: trip.id }));
    data(await upsert({ ...content, qty: 3 }, await token()));
    data(await remove(await token()));
    expect(data(await service.getTrip(context(), { tripId: trip.id }))).toEqual(before);
  });
});
