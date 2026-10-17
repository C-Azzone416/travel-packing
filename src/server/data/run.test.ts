import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { createMigratedDb, resetData } from "../db/__fixtures__/db";
import type { Db } from "../db/retention";
import { createFakeAuth, makeContext, OTHER_OWNER, OWNER, signedInAs } from "./__fixtures__/seed";
import { fail } from "./result";
import { refuse, run } from "./run";
import { setDataLogSink } from "./safe-log";

let ctx: Awaited<ReturnType<typeof createMigratedDb>>;
const fake = createFakeAuth();
let logged: string[];

beforeAll(async () => {
  ctx = await createMigratedDb();
});
beforeEach(async () => {
  await resetData(ctx.client);
  signedInAs(fake, OWNER);
  fake.signOutCalls = 0;
  logged = [];
  setDataLogSink((line) => logged.push(line));
});
afterEach(() => setDataLogSink());
afterAll(async () => {
  await ctx.client.close();
});

const context = () => makeContext(ctx.db as unknown as Db, fake);
const schema = z.object({ name: z.string().min(1) });

describe("run", () => {
  it("passes the session's owner id and validated input to the handler", async () => {
    const result = await run(
      context(),
      schema,
      { name: "x", ownerId: "someone-else" },
      async (scope, input) => ({
        owner: scope.ownerId,
        input,
      }),
    );
    expect(result).toEqual({ ok: true, data: { owner: OWNER.userId, input: { name: "x" } } });
  });

  it("creates the owner's users row on first use, once", async () => {
    await run(context(), schema, { name: "x" }, async () => null);
    await run(context(), schema, { name: "x" }, async () => null);
    const rows = await ctx.client.query<{ id: string }>('SELECT id FROM "users"');
    expect(rows.rows).toEqual([{ id: OWNER.userId }]);
  });

  it("a signed-out request is UNAUTHENTICATED and never reaches the handler or the database", async () => {
    signedInAs(fake, null);
    let ran = false;
    const result = await run(context(), schema, { name: "x" }, async () => {
      ran = true;
    });
    expect(result).toEqual(fail("UNAUTHENTICATED"));
    expect(ran).toBe(false);
    expect((await ctx.client.query('SELECT 1 FROM "users"')).rows).toEqual([]);
  });

  it("a non-allowlisted user is FORBIDDEN and signed out", async () => {
    signedInAs(fake, { userId: "intruder", email: "intruder@example.test" });
    expect(await run(context(), schema, { name: "x" }, async () => null)).toEqual(
      fail("FORBIDDEN"),
    );
    expect(fake.current).toBeNull();
  });

  it("rejects invalid input with field paths but never values", async () => {
    const result = await run(context(), schema, { name: "" }, async () => null);
    expect(result).toEqual(fail("INVALID_INPUT", { fields: ["name"] }));
    const nested = await run(
      context(),
      z.object({ a: z.object({ b: z.number() }) }),
      { a: { b: "secret-value" } },
      async () => null,
    );
    expect(nested).toEqual(fail("INVALID_INPUT", { fields: ["a.b"] }));
    expect(JSON.stringify(nested)).not.toContain("secret-value");
    expect(await run(context(), z.string(), 5, async () => null)).toEqual(
      fail("INVALID_INPUT", { fields: ["(root)"] }),
    );
  });

  it("passes typed refusals through unchanged", async () => {
    const result = await run(context(), schema, { name: "x" }, async () =>
      refuse(fail("REJECTED", { reason: "NOT_ALL_PACKED" })),
    );
    expect(result).toEqual({
      ok: false,
      error: {
        code: "REJECTED",
        message: "That change isn't allowed right now",
        reason: "NOT_ALL_PACKED",
      },
    });
  });

  it("turns unexpected errors into a generic INTERNAL without leaking their text", async () => {
    const result = await run(context(), schema, { name: "x" }, async () => {
      throw new Error("insert into trips (destination) values ('Secret City') failed");
    });
    expect(result).toEqual(fail("INTERNAL"));
    expect(JSON.stringify(result)).not.toContain("Secret City");
  });

  it("fails INTERNAL if the database is unavailable", async () => {
    const broken = {
      ...context(),
      db: {
        insert: () => {
          throw new Error("connection refused for host db.example.test");
        },
      } as unknown as Db,
    };
    const result = await run(broken, schema, { name: "x" }, async () => null);
    expect(result).toEqual(fail("INTERNAL"));
  });

  it("logs only event codes", async () => {
    signedInAs(fake, null);
    await run(context(), schema, { name: "Secret City" }, async () => null);
    signedInAs(fake, OWNER);
    await run(context(), schema, { name: "" }, async () => null);
    await run(context(), schema, { name: "Secret City" }, async () => {
      throw new Error("Secret City 2030-04-01");
    });
    await run(context(), schema, { name: "x" }, async () => refuse(fail("NOT_FOUND")));
    const events = logged.map((line) => JSON.parse(line).event);
    expect(events).toEqual([
      "error:UNAUTHENTICATED",
      "error:INVALID_INPUT",
      "error:INTERNAL",
      "error:NOT_FOUND",
    ]);
    expect(logged.join("")).not.toMatch(/Secret|2030|owner/);
  });

  it("other owners use their own rows", async () => {
    signedInAs(fake, OTHER_OWNER);
    const result = await run(context(), schema, { name: "x" }, async (scope) => scope.ownerId);
    expect(result).toEqual({ ok: true, data: OTHER_OWNER.userId });
  });
});

describe("safe-log default sink", () => {
  it("writes to console.info unless a sink is installed", async () => {
    const { logDataEvent } = await import("./safe-log");
    setDataLogSink();
    const lines: unknown[] = [];
    const original = console.info;
    console.info = (line: unknown) => void lines.push(line);
    try {
      logDataEvent("ensure-user");
    } finally {
      console.info = original;
    }
    expect(lines).toEqual(['{"scope":"data","event":"ensure-user"}']);
  });
});
