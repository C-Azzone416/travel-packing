import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { createMigratedDb, resetData } from "../db/__fixtures__/db";
import { accountDeletions, users } from "../db/schema";
import type { Db } from "../db/retention";
import { lockAccountDeletion } from "../auth/account-deletion-lock";
import { beginAccountDeletion } from "../auth/account-deletion";
import { createFakeAuth, makeContext, OTHER_OWNER, OWNER, signedInAs } from "./__fixtures__/seed";
import { fail } from "./result";
import { createRateLimiter } from "../locations/rate-limit";
import { DATA_CALLS_PER_MINUTE, dataCallsPerMinute, refuse, run, setDataRateLimiter } from "./run";
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
afterEach(() => {
  setDataLogSink();
  setDataRateLimiter();
});
afterAll(async () => {
  await ctx.client.close();
});

const context = () => makeContext(ctx.db as unknown as Db, fake);
const schema = z.object({ name: z.string().min(1) });

describe("dataCallsPerMinute", () => {
  it("pins the default allowance as the literal 300 (not just the constant)", () => {
    expect(DATA_CALLS_PER_MINUTE).toBe(300);
    expect(dataCallsPerMinute({})).toBe(300);
  });

  it("uses DATA_CALLS_PER_MINUTE when it is a whole number in range, else the default", () => {
    expect(dataCallsPerMinute({ DATA_CALLS_PER_MINUTE: " 5000 " })).toBe(5000);
    for (const bad of [undefined, "", "0", "-1", "1.5", "abc", "100001", "1000000"]) {
      expect(dataCallsPerMinute({ DATA_CALLS_PER_MINUTE: bad })).toBe(DATA_CALLS_PER_MINUTE);
    }
  });
});

describe("run rate limit (#22)", () => {
  it("refuses an owner past the allowance with a retryable UNAVAILABLE, per owner, and recovers", async () => {
    let now = 0;
    setDataRateLimiter(createRateLimiter({ limit: 2, windowMs: 1000, now: () => now }));
    let ran = 0;
    const call = () => run(context(), schema, { name: "x" }, async () => ++ran);
    expect((await call()).ok).toBe(true);
    expect((await call()).ok).toBe(true);
    const refused = await call();
    expect(refused).toEqual(fail("UNAVAILABLE", { reason: "RATE_LIMITED" }));
    expect(ran).toBe(2);
    expect(logged).toContain(JSON.stringify({ scope: "data", event: "error:UNAVAILABLE" }));

    signedInAs(fake, OTHER_OWNER);
    expect((await call()).ok).toBe(true);

    signedInAs(fake, OWNER);
    now = 1001;
    expect((await call()).ok).toBe(true);
  });
});

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

  it("cannot recreate an owner or run a handler while a transient deletion fence exists", async () => {
    await ctx.client.query(
      "INSERT INTO account_deletions (user_id, identity_created_at, setup_email_digest) VALUES ($1, $2, $3)",
      [OWNER.userId, new Date(1), "a".repeat(64)],
    );
    let ran = false;
    const result = await run(context(), schema, { name: "x" }, async () => {
      ran = true;
    });
    expect(result).toEqual(fail("UNAUTHENTICATED"));
    expect(ran).toBe(false);
    expect((await ctx.client.query("SELECT id FROM users")).rows).toEqual([]);
  });

  it("revalidates under the owner lock so an in-flight stale session cannot recreate the owner", async () => {
    const original = fake.getSession.bind(fake);
    let reads = 0;
    fake.getSession = async () => {
      reads += 1;
      return reads === 1 ? OWNER : null;
    };
    try {
      let ran = false;
      const result = await run(context(), schema, { name: "x" }, async () => {
        ran = true;
      });
      expect(result).toEqual(fail("UNAUTHENTICATED"));
      expect(reads).toBe(2);
      expect(ran).toBe(false);
      expect((await ctx.client.query("SELECT id FROM users")).rows).toEqual([]);
    } finally {
      fake.getSession = original;
    }
  });

  it("rejects an id-reused provider identity when its incarnation changed during the owner-lock wait", async () => {
    const original = fake.getSession.bind(fake);
    let reads = 0;
    fake.getSession = async () => {
      reads += 1;
      return reads === 1 ? { ...OWNER, identityCreatedAt: 1 } : { ...OWNER, identityCreatedAt: 2 };
    };
    try {
      const result = await run(context(), schema, { name: "x" }, async () => "ran");
      expect(result).toEqual(fail("UNAUTHENTICATED"));
      expect(reads).toBe(2);
      expect((await ctx.client.query("SELECT id FROM users")).rows).toEqual([]);
    } finally {
      fake.getSession = original;
    }
  });

  it("keeps the owner lock through the handler so deletion cannot overtake an old request", async () => {
    let handlerEntered!: () => void;
    const entered = new Promise<void>((resolve) => {
      handlerEntered = resolve;
    });
    let releaseHandler!: () => void;
    const release = new Promise<void>((resolve) => {
      releaseHandler = resolve;
    });
    const oldRequest = run(context(), schema, { name: "x" }, async () => {
      handlerEntered();
      await release;
      return "old request finished";
    });
    await entered;

    let deletionSettled = false;
    const deletion = beginAccountDeletion(
      ctx.db as unknown as Db,
      OWNER.userId,
      1,
      "a".repeat(64),
    ).then((result) => {
      deletionSettled = true;
      return result;
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
    expect(deletionSettled).toBe(false);

    releaseHandler();
    await expect(oldRequest).resolves.toEqual({ ok: true, data: "old request finished" });
    await expect(deletion).resolves.toBe("started");
    expect((await ctx.client.query("SELECT id FROM users")).rows).toEqual([]);
  });

  it("waits behind an in-flight deletion and refuses provisioning after its fence commits", async () => {
    // PGlite serializes transactions on its single connection, so this verifies the durable outcome but cannot prove
    // real PostgreSQL advisory-lock contention. The contract tests separately pin both lock calls and their ordering;
    // the hosted gate in docs/account-deletion.md covers true multi-connection contention.
    await ctx.client.query("INSERT INTO users (id) VALUES ($1)", [OWNER.userId]);
    let releaseDeletion!: () => void;
    const release = new Promise<void>((resolve) => {
      releaseDeletion = resolve;
    });
    let deletionLocked!: () => void;
    const locked = new Promise<void>((resolve) => {
      deletionLocked = resolve;
    });
    const deletion = ctx.db.transaction(async (transaction) => {
      await lockAccountDeletion(transaction, OWNER.userId);
      await transaction.insert(accountDeletions).values({
        userId: OWNER.userId,
        identityCreatedAt: new Date(1),
        setupEmailDigest: "a".repeat(64),
      });
      deletionLocked();
      await release;
      await transaction.delete(users).where(eq(users.id, OWNER.userId));
    });
    await locked;

    let provisioningSettled = false;
    const provisioning = run(context(), schema, { name: "x" }, async () => "ran").then((result) => {
      provisioningSettled = true;
      return result;
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
    expect(provisioningSettled).toBe(false);

    releaseDeletion();
    await deletion;
    expect(await provisioning).toEqual(fail("UNAUTHENTICATED"));
    expect((await ctx.client.query("SELECT id FROM users")).rows).toEqual([]);
    expect((await ctx.client.query("SELECT user_id FROM account_deletions")).rows).toEqual([
      { user_id: OWNER.userId },
    ]);
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
