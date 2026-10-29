import { randomBytes, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createMigratedDb, resetData } from "../db/__fixtures__/db";
import type { Db } from "../db/retention";
import * as schema from "../db/schema";
import { createFakeService, type FakeService } from "./__fixtures__/fake-service";
import { REDEMPTION_WINDOW_MS } from "./enrollment-store";
import {
  createEnrollmentService,
  outboxKeyFor,
  type EnrollmentService,
} from "./enrollment-service";
import { createFramebriarClient } from "./framebriar-client";
import { parseKeyRing, type KeyRing } from "./key-ring";

let ctx: Awaited<ReturnType<typeof createMigratedDb>>;
const db = () => ctx.db as unknown as Db;
const keyText = () => randomBytes(32).toString("base64");
const ringOf = (current: string, keys: Record<string, string>) =>
  parseKeyRing(JSON.stringify({ current, keys }))!;

let clock = Date.parse("2026-10-26T12:00:00Z");
const now = () => clock;
let fake: FakeService;
let ring: KeyRing | null;
const K1 = keyText();

function service(overrides: { keys?: () => KeyRing | null } = {}): EnrollmentService {
  return createEnrollmentService({
    db: db(),
    client: createFramebriarClient({ fetchImpl: fake.fetch, now }),
    keys: overrides.keys ?? (() => ring),
    now,
  });
}

const A = "owner-a";
const B = "owner-b";
let logs: unknown[][];

beforeAll(async () => {
  ctx = await createMigratedDb();
});
beforeEach(async () => {
  await resetData(ctx.client);
  clock = Date.parse("2026-10-26T12:00:00Z");
  fake = createFakeService(now);
  ring = ringOf("k1", { k1: K1 });
  logs = [];
  for (const level of ["log", "info", "warn", "error", "debug"] as const)
    vi.spyOn(console, level).mockImplementation((...args) => void logs.push(args));
});
afterEach(() => {
  vi.restoreAllMocks();
});
afterAll(async () => {
  await ctx.client.close();
});

async function connect(svc: EnrollmentService, owner = A) {
  const invitation = fake.issueInvitation();
  const result = await svc.redeem(owner, invitation);
  expect(result).toMatchObject({ ok: true, status: "connected" });
  return invitation;
}

const rows = () => db().select().from(schema.framebriarEnrollments);

/** A database whose erase either throws or reports that a concurrent write moved the revision (nothing deleted). */
function erasing(mode: "throw" | "lost"): Db {
  const real = db();
  return new Proxy(real as object, {
    get(target, property, receiver) {
      if (property === "delete") {
        return () => {
          if (mode === "throw") throw new Error("down");
          return { where: () => ({ returning: async () => [] }) };
        };
      }
      const value = Reflect.get(target, property, receiver) as unknown;
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as unknown as Db;
}

/** A database where the first `times` credential updates lose the revision race (nothing written). */
function losingUpdates(times: number, beforeLoss?: () => Promise<void>): Db {
  let left = times;
  const real = db();
  return new Proxy(real as object, {
    get(target, property, receiver) {
      if (property === "update" && left > 0) {
        return () => {
          left -= 1;
          return {
            set: () => ({
              where: () => ({
                returning: async () => {
                  await beforeLoss?.();
                  return [];
                },
              }),
            }),
          };
        };
      }
      const value = Reflect.get(target, property, receiver) as unknown;
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as unknown as Db;
}

describe("status hasRecord (#304)", () => {
  it("is false for an account that holds nothing, and true for a row in ANY state or a redemption attempt", async () => {
    const svc = service();
    expect(await svc.status(A)).toMatchObject({ status: "not-connected", hasRecord: false });
    await connect(svc);
    expect(await svc.status(A)).toMatchObject({ status: "connected", hasRecord: true });
    clock += 31 * 86_400_000;
    expect(await svc.status(A)).toMatchObject({ status: "expired", hasRecord: true });
    ring = ringOf("k9", { k9: keyText() });
    expect(await service().status(A)).toMatchObject({ hasRecord: true });
    expect(await service({ keys: () => null }).status(A)).toMatchObject({
      status: "unavailable",
      hasRecord: true,
    });
    await service().disconnect(A);
    expect(await service().status(A)).toMatchObject({ hasRecord: false });
  });

  it("a pending redemption is a record, even after its retry window has passed", async () => {
    const svc = service();
    fake.failNext("redeem", { kind: "lost-response" });
    await svc.redeem(B, fake.issueInvitation());
    expect(await svc.status(B)).toMatchObject({ redemption: "pending", hasRecord: true });
    clock += REDEMPTION_WINDOW_MS + 1000;
    expect(await svc.status(B)).toMatchObject({ redemption: "none", hasRecord: true });
  });

  it("one account's record is not another's", async () => {
    const svc = service();
    await connect(svc, A);
    expect(await svc.status(B)).toMatchObject({ hasRecord: false });
  });

  it("the status view when the database is unreachable claims no record", async () => {
    const broken = {
      insert: () => {
        throw new Error("down");
      },
    } as unknown as Db;
    const svc = createEnrollmentService({
      db: broken,
      client: createFramebriarClient({ fetchImpl: fake.fetch, now }),
      keys: () => ring,
      now,
    });
    expect(await svc.status(A)).toMatchObject({ status: "unavailable", hasRecord: false });
  });
});

describe("status", () => {
  it("is not-connected for a new account, with an opaque outbox key and no redemption pending", async () => {
    const view = await service().status(A);
    expect(view).toMatchObject({ status: "not-connected", expiresAt: null, redemption: "none" });
    expect(view.outboxKey).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(view.outboxKey).not.toContain(A);
  });

  it("is unavailable, and makes no network call, when the key ring is missing or invalid", async () => {
    for (const keys of [() => null, () => parseKeyRing("not json")]) {
      const svc = service({ keys });
      expect(await svc.status(A)).toMatchObject({ status: "unavailable" });
      expect(await svc.redeem(A, fake.issueInvitation())).toEqual({
        ok: false,
        code: "UNAVAILABLE",
      });
      expect(fake.count("redeem")).toBe(0);
    }
  });

  it("is unavailable with no outbox key when the database cannot be reached", async () => {
    const broken = createEnrollmentService({
      db: {
        insert: () => {
          throw new Error("connection refused: postgres://user:pass@host/db");
        },
      } as unknown as Db,
      client: createFramebriarClient({ fetchImpl: fake.fetch, now }),
      keys: () => ring,
      now,
    });
    expect(await broken.status(A)).toEqual({
      status: "unavailable",
      expiresAt: null,
      redemption: "none",
      hasRecord: false,
      outboxKey: null,
    });
  });
});

describe("redeeming an invitation", () => {
  it("connects once, stores only a sealed credential, and spends exactly one invitation", async () => {
    const svc = service();
    const invitation = await connect(svc);
    expect(fake.familyCount()).toBe(1);
    const [row] = await rows();
    expect(row.credentials).not.toContain(invitation);
    expect(row.credentials.startsWith("v1.")).toBe(true);
    expect(JSON.stringify(row)).not.toMatch(/refreshToken/);
    expect(await svc.status(A)).toMatchObject({
      status: "connected",
      expiresAt: new Date(clock + 30 * 86_400_000).toISOString(),
    });
    expect(await db().select().from(schema.framebriarRedemptions)).toHaveLength(0);
  });

  it("does not spend another invitation when already connected", async () => {
    const svc = service();
    await connect(svc);
    const second = fake.issueInvitation();
    expect(await svc.redeem(A, second)).toEqual({ ok: false, code: "ALREADY_CONNECTED" });
    expect(fake.count("redeem")).toBe(1);
  });

  it("refuses an invalid, expired or used invitation generically and clears the attempt", async () => {
    const svc = service();
    expect(await svc.redeem(A, "A".repeat(43))).toEqual({ ok: false, code: "INVITATION_REJECTED" });
    const invitation = fake.issueInvitation();
    await svc.redeem(B, invitation);
    expect(await svc.redeem(A, invitation)).toEqual({ ok: false, code: "INVITATION_REJECTED" });
    expect((await svc.status(A)).redemption).toBe("none");
  });

  it("a rate limit from Framebriar is a retryable answer, and nothing is left pending", async () => {
    const svc = service();
    fake.failNext("redeem", { kind: "status", status: 429, retryAfterSeconds: 30 });
    expect(await svc.redeem(A, fake.issueInvitation())).toEqual({
      ok: false,
      code: "RATE_LIMITED",
      retryAfterSeconds: 30,
    });
    expect((await svc.status(A)).redemption).toBe("none");
  });

  it("a lost response is recovered with the SAME attempt id: one family, one spent invitation, then connected", async () => {
    const svc = service();
    const invitation = fake.issueInvitation(1);
    fake.failNext("redeem", { kind: "lost-response" });
    expect(await svc.redeem(A, invitation)).toEqual({ ok: false, code: "UNCERTAIN" });
    // The invitation was spent upstream, but nothing was committed here: it is pending, and status says so.
    expect(fake.familyCount()).toBe(1);
    expect(await rows()).toHaveLength(0);
    expect(await svc.status(A)).toMatchObject({ status: "not-connected", redemption: "pending" });
    const [pending] = await db().select().from(schema.framebriarRedemptions);

    // The retry (even from another instance) reuses the persisted attempt id and gets the same family back.
    expect(await service().redeem(A, invitation)).toMatchObject({ ok: true, status: "connected" });
    expect(fake.familyCount()).toBe(1);
    expect(pending.attemptId).toMatch(/^[0-9a-f-]{36}$/);
    expect(await db().select().from(schema.framebriarRedemptions)).toHaveLength(0);
    expect((await service().status(A)).status).toBe("connected");
  });

  it("a timeout, a server error and a malformed answer are all uncertain and keep the attempt", async () => {
    const svc = service();
    const invitation = fake.issueInvitation(3);
    for (const failure of [
      { kind: "network" },
      { kind: "status", status: 503 },
      { kind: "malformed" },
    ] as const) {
      fake.failNext("redeem", failure);
      expect(await svc.redeem(A, invitation)).toEqual({ ok: false, code: "UNCERTAIN" });
      expect((await svc.status(A)).redemption).toBe("pending");
    }
    const attempts = await db().select().from(schema.framebriarRedemptions);
    expect(attempts).toHaveLength(1);
  });

  it("after the idempotency window a new attempt id is used", async () => {
    const svc = service();
    const invitation = fake.issueInvitation(2);
    fake.failNext("redeem", { kind: "network" });
    await svc.redeem(A, invitation);
    const [first] = await db().select().from(schema.framebriarRedemptions);
    clock += REDEMPTION_WINDOW_MS + 1000;
    expect((await svc.status(A)).redemption).toBe("none");
    fake.failNext("redeem", { kind: "network" });
    await svc.redeem(A, invitation);
    const [second] = await db().select().from(schema.framebriarRedemptions);
    expect(second.attemptId).not.toBe(first.attemptId);
  });

  it("never reports success before the encrypted commit: a failed write keeps the attempt for a safe retry", async () => {
    const svc = service();
    const invitation = fake.issueInvitation(1);
    const spy = vi.spyOn(db(), "transaction").mockRejectedValueOnce(new Error("disk full"));
    expect(await svc.redeem(A, invitation)).toEqual({ ok: false, code: "UNAVAILABLE" });
    spy.mockRestore();
    expect(await rows()).toHaveLength(0);
    expect((await svc.status(A)).redemption).toBe("pending");
    expect(await svc.redeem(A, invitation)).toMatchObject({ ok: true });
    expect(fake.familyCount()).toBe(1);
  });

  it("redeeming again after revocation replaces the old enrollment", async () => {
    const svc = service();
    await connect(svc);
    fake.revokeAll();
    expect(await svc.accessToken(A, true)).toEqual({ ok: false, code: "REVOKED" });
    expect((await svc.status(A)).status).toBe("revoked");
    await connect(svc);
    expect((await svc.status(A)).status).toBe("connected");
    expect(await rows()).toHaveLength(1);
  });
});

describe("two accounts, two devices, a cleared browser", () => {
  it("one account's enrollment is invisible to another account", async () => {
    const svc = service();
    await connect(svc, A);
    expect(await svc.status(B)).toMatchObject({ status: "not-connected" });
    expect(await svc.accessToken(B)).toEqual({ ok: false, code: "NOT_CONNECTED" });
    expect((await svc.status(A)).outboxKey).not.toBe((await svc.status(B)).outboxKey);
  });

  it("a second device or a cleared browser (a new session, a new server instance) sees the same enrollment with no new invitation", async () => {
    await connect(service());
    const other = service();
    expect(await other.status(A)).toMatchObject({ status: "connected" });
    expect(await other.accessToken(A)).toMatchObject({ ok: true });
    expect(fake.count("redeem")).toBe(1);
    expect((await other.status(A)).outboxKey).toBe((await service().status(A)).outboxKey);
  });

  it("a recreated account never inherits the old enrollment, and its outbox key is new", async () => {
    const svc = service();
    await connect(svc);
    const before = await svc.status(A);
    const [{ generation }] = await db().select().from(schema.users).where(eq(schema.users.id, A));
    // The account is deleted and a new one is created with the same provider id.
    await db().delete(schema.users).where(eq(schema.users.id, A));
    expect(await rows()).toHaveLength(0);
    const after = await svc.status(A);
    expect(after).toMatchObject({ status: "not-connected", redemption: "none" });
    const [{ generation: next }] = await db()
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, A));
    expect(next).not.toBe(generation);
    expect(after.outboxKey).not.toBe(before.outboxKey);
    expect(outboxKeyFor(A, next)).toBe(after.outboxKey);
  });

  describe("an older generation's leftovers are never this account's (#304, isolation)", () => {
    // The foreign key makes a previous-generation row impossible by construction (deleting the user cascades). To prove the READ
    // side filters by generation on its own, the constraints are lifted for one test and restored afterwards.
    async function withOrphans(seed: () => PromiseLike<unknown>, run: () => Promise<void>) {
      await ctx.client.exec(
        "ALTER TABLE framebriar_enrollments DROP CONSTRAINT framebriar_enrollments_user_fk; ALTER TABLE framebriar_redemptions DROP CONSTRAINT framebriar_redemptions_user_fk",
      );
      try {
        await seed();
        await run();
      } finally {
        await ctx.client.exec(
          "DELETE FROM framebriar_enrollments; DELETE FROM framebriar_redemptions; ALTER TABLE framebriar_enrollments ADD CONSTRAINT framebriar_enrollments_user_fk FOREIGN KEY (owner_id, generation) REFERENCES users(id, generation) ON DELETE CASCADE; ALTER TABLE framebriar_redemptions ADD CONSTRAINT framebriar_redemptions_user_fk FOREIGN KEY (owner_id, generation) REFERENCES users(id, generation) ON DELETE CASCADE",
        );
      }
    }
    const rotateGeneration = () =>
      db().update(schema.users).set({ generation: randomUUID() }).where(eq(schema.users.id, A));

    it("an old-generation enrollment is not a record, is not disconnected and is left untouched", async () => {
      const svc = service();
      await connect(svc);
      const [old] = await rows();
      await withOrphans(rotateGeneration, async () => {
        expect(await svc.status(A)).toMatchObject({ status: "not-connected", hasRecord: false });
        expect(await svc.disconnect(A)).toEqual({ ok: true, outcome: "nothing", revoked: false });
        expect(fake.count("disconnect")).toBe(0);
        expect(fake.activeFamilies()).toBe(1);
        expect(await rows()).toEqual([old]);
        expect(await svc.accessToken(A)).toEqual({ ok: false, code: "NOT_CONNECTED" });
      });
    });

    it("an old-generation redemption attempt is not a record or a pending connection, and is left untouched", async () => {
      const svc = service();
      fake.failNext("redeem", { kind: "lost-response" });
      await svc.redeem(A, fake.issueInvitation());
      const before = await db().select().from(schema.framebriarRedemptions);
      expect(before).toHaveLength(1);
      await withOrphans(rotateGeneration, async () => {
        expect(await svc.status(A)).toMatchObject({
          redemption: "none",
          hasRecord: false,
        });
        expect(await svc.disconnect(A)).toEqual({ ok: true, outcome: "nothing", revoked: false });
        expect(await db().select().from(schema.framebriarRedemptions)).toEqual(before);
      });
    });
  });

  it("a row can only exist for the account generation that made it (database constraint)", async () => {
    await service().status(A);
    await expect(
      db()
        .insert(schema.framebriarEnrollments)
        .values({
          ownerId: A,
          generation: randomUUID(),
          keyVersion: "k1",
          credentials: "v1.x",
          expiresAt: new Date(clock + 1000),
        }),
    ).rejects.toThrow();
  });

  it("a sealed credential copied to another account does not open", async () => {
    const svc = service();
    await connect(svc, A);
    await service().status(B);
    const [row] = await rows();
    const [{ generation }] = await db().select().from(schema.users).where(eq(schema.users.id, B));
    await db().insert(schema.framebriarEnrollments).values({
      ownerId: B,
      generation,
      keyVersion: row.keyVersion,
      credentials: row.credentials,
      expiresAt: row.expiresAt,
    });
    expect(await svc.accessToken(B)).toEqual({ ok: false, code: "NEEDS_RECONNECT" });
    expect((await svc.status(B)).status).toBe("needs_reconnect");
  });
});

describe("access tokens", () => {
  it("are cached and shared: many requests, one refresh an hour", async () => {
    const svc = service();
    await connect(svc);
    // The grant from redeem is cached and still fresh: nothing to refresh.
    await Promise.all([svc.accessToken(A), svc.accessToken(A), service().accessToken(A)]);
    expect(fake.count("refresh")).toBe(0);
    clock += 59 * 60_000;
    const tokens = await Promise.all(Array.from({ length: 6 }, () => svc.accessToken(A)));
    expect(new Set(tokens.map((t) => (t.ok ? t.token : "x"))).size).toBe(1);
    expect(fake.count("refresh")).toBe(1);
    await svc.accessToken(A);
    expect(fake.count("refresh")).toBe(1);
  });

  it("concurrent refreshes from several instances never corrupt the stored credential", async () => {
    await connect(service());
    clock += 59 * 60_000;
    const release = fake.holdRefresh();
    const instances = [service(), service(), service()];
    const pending = instances.map((svc) => svc.accessToken(A));
    await new Promise((resolve) => setTimeout(resolve, 20));
    release();
    const results = await Promise.all(pending);
    expect(results.every((result) => result.ok)).toBe(true);
    expect(await rows()).toHaveLength(1);
    // Whatever order they wrote in, the row opens and still holds the same family.
    expect(await service().accessToken(A)).toMatchObject({ ok: true });
    expect(fake.activeFamilies()).toBe(1);
    expect((await rows())[0].revision).toBeGreaterThan(1);
  });

  it("the stored deadline is Framebriar's, never extended", async () => {
    const svc = service();
    await connect(svc);
    const [first] = await rows();
    clock += 59 * 60_000;
    await svc.accessToken(A);
    expect((await rows())[0].expiresAt.getTime()).toBe(first.expiresAt.getTime());
  });

  it("expired is decided locally, without calling Framebriar", async () => {
    const svc = service();
    await connect(svc);
    clock += 31 * 86_400_000;
    expect(await svc.accessToken(A)).toEqual({ ok: false, code: "EXPIRED" });
    expect((await svc.status(A)).status).toBe("expired");
    expect(fake.count("refresh")).toBe(0);
  });

  it("revoked and disabled are remembered, and shown by status", async () => {
    const svc = service();
    await connect(svc, A);
    await connect(svc, B);
    clock += 59 * 60_000;
    fake.failNext("refresh", { kind: "status", status: 401 });
    expect(await svc.accessToken(A)).toEqual({ ok: false, code: "REVOKED" });
    expect((await svc.status(A)).status).toBe("revoked");
    fake.disable();
    expect(await svc.accessToken(B)).toEqual({ ok: false, code: "DISABLED" });
    expect((await svc.status(B)).status).toBe("disabled");
    // No further calls for a known-dead enrollment.
    const calls = fake.count("refresh");
    await svc.accessToken(A);
    await svc.accessToken(B);
    expect(fake.count("refresh")).toBe(calls);
  });

  it("a Framebriar rate limit is respected: no hammering until the wait has passed", async () => {
    const svc = service();
    await connect(svc);
    clock += 59 * 60_000;
    fake.failNext("refresh", { kind: "status", status: 429, retryAfterSeconds: 60 });
    expect(await svc.accessToken(A)).toMatchObject({ ok: false, code: "RATE_LIMITED" });
    const calls = fake.count("refresh");
    expect(await svc.accessToken(A)).toMatchObject({ ok: false, code: "RATE_LIMITED" });
    expect(fake.count("refresh")).toBe(calls);
    clock += 61_000;
    expect(await svc.accessToken(A)).toMatchObject({ ok: true });
  });

  it("an unreachable Framebriar is uncertain and changes nothing", async () => {
    const svc = service();
    await connect(svc);
    clock += 59 * 60_000;
    const before = (await rows())[0];
    fake.failNext("refresh", { kind: "network" });
    expect(await svc.accessToken(A)).toEqual({ ok: false, code: "UNCERTAIN" });
    expect((await rows())[0]).toEqual(before);
  });

  it("a refresh that rotates the refresh credential is refused as malformed", async () => {
    const svc = service();
    await connect(svc);
    clock += 59 * 60_000;
    const rotating = createEnrollmentService({
      db: db(),
      client: createFramebriarClient({
        fetchImpl: (async (input: RequestInfo | URL, init?: RequestInit) => {
          const response = await fake.fetch(input, init);
          const body = (await response.json()) as Record<string, unknown>;
          return Response.json({ ...body, refreshToken: "x".repeat(40) });
        }) as typeof fetch,
        now,
      }),
      keys: () => ring,
      now,
    });
    expect(await rotating.accessToken(A)).toEqual({ ok: false, code: "UNCERTAIN" });
  });
});

describe("key rotation", () => {
  it("re-encrypts an old row under the current key on its next use, and old keys keep working until removed", async () => {
    await connect(service());
    expect((await rows())[0].keyVersion).toBe("k1");
    const K2 = keyText();
    ring = ringOf("k2", { k1: K1, k2: K2 });
    expect(await service().accessToken(A)).toMatchObject({ ok: true });
    expect((await rows())[0].keyVersion).toBe("k2");
    // Retiring k1 now loses nothing.
    ring = ringOf("k2", { k2: K2 });
    expect(await service().accessToken(A)).toMatchObject({ ok: true });
  });

  it("a key ring that cannot open the row (a removed version, or a wrong key) is needs_reconnect, not connected", async () => {
    await connect(service());
    for (const wrong of [ringOf("k9", { k9: keyText() }), ringOf("k1", { k1: keyText() })]) {
      ring = wrong;
      const svc = service();
      expect(await svc.status(A)).toMatchObject({
        status: "needs_reconnect",
        expiresAt: null,
        redemption: "none",
      });
      expect(await svc.accessToken(A)).toEqual({ ok: false, code: "NEEDS_RECONNECT" });
    }
    expect(fake.count("refresh")).toBe(0);
  });

  it("a missing key ring is unavailable and touches nothing: a missing secret is not lost data", async () => {
    await connect(service());
    const before = (await rows())[0];
    const svc = service({ keys: () => null });
    expect((await svc.status(A)).status).toBe("unavailable");
    expect(await svc.accessToken(A)).toEqual({ ok: false, code: "UNAVAILABLE" });
    expect(await svc.redeem(A, fake.issueInvitation())).toEqual({ ok: false, code: "UNAVAILABLE" });
    expect(await svc.disconnect(A)).toEqual({ ok: false, code: "UNAVAILABLE" });
    expect(await svc.revokeAndEraseEnrollment(A)).toEqual({
      status: "failed",
      reason: "unavailable",
    });
    expect((await rows())[0]).toEqual(before);
    // The key comes back and everything works again.
    expect((await service().status(A)).status).toBe("connected");
  });

  it("a row nobody can read replaces cleanly on a new invitation, and the recovery is a real connection", async () => {
    await connect(service());
    ring = ringOf("k9", { k9: keyText() });
    const svc = service();
    expect((await svc.status(A)).status).toBe("needs_reconnect");
    const [stale] = await rows();
    expect(await svc.redeem(A, fake.issueInvitation())).toMatchObject({
      ok: true,
      status: "connected",
    });
    const [fresh] = await rows();
    expect(fresh.keyVersion).toBe("k9");
    expect(fresh.revision).toBe(stale.revision + 1);
    expect((await svc.status(A)).status).toBe("connected");
    expect(await svc.accessToken(A)).toMatchObject({ ok: true });
    expect(fake.count("redeem")).toBe(2);
  });

  it("replacing is safe against a racing writer: it never overwrites a row that changed since it was seen", async () => {
    await connect(service());
    ring = ringOf("k9", { k9: keyText() });
    const invitation = fake.issueInvitation();
    const svc = service();
    // Another instance replaces the row between this redeem reading it and committing.
    const original = fake.fetch;
    let raced = false;
    const racing = createEnrollmentService({
      db: db(),
      client: createFramebriarClient({
        fetchImpl: (async (input: RequestInfo | URL, init?: RequestInit) => {
          if (!raced) {
            raced = true;
            await db()
              .update(schema.framebriarEnrollments)
              .set({ revision: 99 })
              .where(eq(schema.framebriarEnrollments.ownerId, A));
          }
          return original(input, init);
        }) as typeof fetch,
        now,
      }),
      keys: () => ring,
      now,
    });
    expect(await racing.redeem(A, invitation)).toEqual({ ok: false, code: "UNCERTAIN" });
    expect((await rows())[0].revision).toBe(99);
    expect((await racing.status(A)).redemption).toBe("pending");
    // The retry reuses the attempt id (the same family) and commits against the row as it is now.
    expect(await svc.redeem(A, invitation)).toMatchObject({ ok: true });
    expect(fake.familyCount()).toBe(2);
    expect((await rows())[0].revision).toBe(100);
  });

  it("a first connection that loses a race to another first connection does not overwrite it", async () => {
    const svc = service();
    const invitation = fake.issueInvitation();
    const original = fake.fetch;
    let raced = false;
    const racing = createEnrollmentService({
      db: db(),
      client: createFramebriarClient({
        fetchImpl: (async (input: RequestInfo | URL, init?: RequestInit) => {
          if (!raced) {
            raced = true;
            await connect(svc, A);
          }
          return original(input, init);
        }) as typeof fetch,
        now,
      }),
      keys: () => ring,
      now,
    });
    expect(await racing.redeem(A, invitation)).toEqual({ ok: false, code: "UNCERTAIN" });
    expect((await rows())[0].revision).toBe(1);
  });
});

describe("disconnect and revokeAndEraseEnrollment", () => {
  it("disconnect revokes the family, then erases the credential", async () => {
    const svc = service();
    await connect(svc);
    expect(await svc.disconnect(A)).toEqual({ ok: true, outcome: "ended", revoked: true });
    expect(fake.activeFamilies()).toBe(0);
    expect(await rows()).toHaveLength(0);
    expect((await svc.status(A)).status).toBe("not-connected");
    expect(await svc.disconnect(A)).toEqual({ ok: true, outcome: "nothing", revoked: false });
  });

  it("an unreachable Framebriar erases nothing, so the family can still be revoked later", async () => {
    const svc = service();
    await connect(svc);
    for (const failure of [
      { kind: "network" },
      { kind: "status", status: 503 },
      { kind: "status", status: 429 },
    ] as const) {
      fake.failNext("disconnect", failure);
      const result = await svc.revokeAndEraseEnrollment(A);
      expect(result).toEqual({ status: "failed", reason: "uncertain" });
      expect(await rows()).toHaveLength(1);
    }
    expect(fake.activeFamilies()).toBe(1);
    expect(await svc.revokeAndEraseEnrollment(A)).toEqual({
      status: "erased",
      revoked: true,
      unrevocableAttempts: 0,
    });
  });

  it("a family Framebriar no longer knows is erased without a revoke", async () => {
    const svc = service();
    await connect(svc);
    fake.failNext("disconnect", { kind: "status", status: 401 });
    expect(await svc.revokeAndEraseEnrollment(A)).toEqual({
      status: "erased",
      revoked: false,
      unrevocableAttempts: 0,
    });
  });

  it("an already revoked, disabled or expired enrollment is erased locally without calling Framebriar", async () => {
    const svc = service();
    await connect(svc);
    clock += 31 * 86_400_000;
    expect(await svc.revokeAndEraseEnrollment(A)).toMatchObject({
      status: "erased",
      revoked: false,
    });
    expect(fake.count("disconnect")).toBe(0);
  });

  it("reports a partial result when the revoke worked but the erase did not", async () => {
    const svc = service();
    await connect(svc);
    const failing = {
      ...db(),
      select: db().select.bind(db()),
      insert: db().insert.bind(db()),
      delete: () => {
        throw new Error("down");
      },
    } as unknown as Db;
    const result = await createEnrollmentService({
      db: failing,
      client: createFramebriarClient({ fetchImpl: fake.fetch, now }),
      keys: () => ring,
      now,
    }).revokeAndEraseEnrollment(A);
    expect(result).toEqual({ status: "partial", revoked: true, erased: false });
    expect(fake.activeFamilies()).toBe(0);
    // Retrying finishes the erase, and a family that is already gone does not block it.
    expect(await svc.revokeAndEraseEnrollment(A)).toMatchObject({ status: "erased" });
    expect(await rows()).toHaveLength(0);
  });

  it("with no key ring at all it fails closed instead of erasing anything", async () => {
    await connect(service());
    const result = await service({ keys: () => null }).revokeAndEraseEnrollment(A);
    expect(result).toEqual({ status: "failed", reason: "unavailable" });
    expect(await rows()).toHaveLength(1);
  });

  it("a ring that cannot open the row: disconnect erases it and says nothing was revoked", async () => {
    await connect(service());
    ring = ringOf("k9", { k9: keyText() });
    expect(await service().disconnect(A)).toEqual({
      ok: true,
      outcome: "erased_unrevocable",
      revoked: false,
    });
    expect(await rows()).toHaveLength(0);
    expect(fake.count("disconnect")).toBe(0);
    expect(fake.activeFamilies()).toBe(1);
    expect((await service().status(A)).status).toBe("not-connected");
  });

  it("a ring that cannot open the row: the seam erases everything and reports erased_unrevocable, a distinct result", async () => {
    await connect(service());
    ring = ringOf("k9", { k9: keyText() });
    const result = await service().revokeAndEraseEnrollment(A);
    expect(result).toEqual({ status: "erased_unrevocable", unrevocableAttempts: 0 });
    expect(result.status).not.toBe("erased");
    expect(await rows()).toHaveLength(0);
    expect(await db().select().from(schema.framebriarRedemptions)).toHaveLength(0);
    expect(await service().revokeAndEraseEnrollment(A)).toEqual({ status: "none" });
  });

  it("erased_unrevocable also clears an abandoned attempt and counts it, and a failing erase is a failure not a success", async () => {
    const svc = service();
    await connect(svc);
    clock += REDEMPTION_WINDOW_MS + 1000;
    fake.failNext("redeem", { kind: "network" });
    ring = ringOf("k9", { k9: keyText() });
    await service().redeem(A, fake.issueInvitation());
    // The redeem above replaced nothing (network failure) and left an attempt; the row is still the old unreadable one.
    clock += REDEMPTION_WINDOW_MS + 1000;
    const failing = {
      ...db(),
      select: db().select.bind(db()),
      insert: db().insert.bind(db()),
      delete: () => {
        throw new Error("down");
      },
    } as unknown as Db;
    const broken = createEnrollmentService({
      db: failing,
      client: createFramebriarClient({ fetchImpl: fake.fetch, now }),
      keys: () => ring,
      now,
    });
    expect(await broken.revokeAndEraseEnrollment(A)).toEqual({
      status: "failed",
      reason: "unavailable",
    });
    expect(await rows()).toHaveLength(1);
    expect(await service().revokeAndEraseEnrollment(A)).toEqual({
      status: "erased_unrevocable",
      unrevocableAttempts: 1,
    });
    expect(await rows()).toHaveLength(0);
    expect(await db().select().from(schema.framebriarRedemptions)).toHaveLength(0);
  });

  it("a revoked or expired row nobody can read is still just erased as before (no revoke is needed)", async () => {
    await connect(service());
    clock += 31 * 86_400_000;
    ring = ringOf("k9", { k9: keyText() });
    expect((await service().status(A)).status).toBe("expired");
    expect(await service().revokeAndEraseEnrollment(A)).toMatchObject({
      status: "erased",
      revoked: false,
    });
  });

  it("while a redemption can still be retried it refuses, then counts an abandoned attempt as unrevocable", async () => {
    const svc = service();
    fake.failNext("redeem", { kind: "lost-response" });
    await svc.redeem(A, fake.issueInvitation());
    expect(await svc.revokeAndEraseEnrollment(A)).toEqual({
      status: "failed",
      reason: "pending-redemption",
    });
    clock += REDEMPTION_WINDOW_MS + 1000;
    expect(await svc.revokeAndEraseEnrollment(A)).toEqual({
      status: "erased",
      revoked: false,
      unrevocableAttempts: 1,
    });
    expect(await svc.revokeAndEraseEnrollment(A)).toEqual({ status: "none" });
  });

  describe("disconnect reports the real outcome (#304)", () => {
    it("a record that was already dead is erased as 'nothing', not as ended", async () => {
      const svc = service();
      await connect(svc);
      clock += 31 * 86_400_000;
      expect(await svc.disconnect(A)).toEqual({ ok: true, outcome: "nothing", revoked: false });
      expect(fake.count("disconnect")).toBe(0);
    });

    it("a family Framebriar no longer knows is 'nothing' to end", async () => {
      const svc = service();
      await connect(svc);
      fake.failNext("disconnect", { kind: "status", status: 401 });
      expect(await svc.disconnect(A)).toEqual({ ok: true, outcome: "nothing", revoked: false });
    });

    it("an abandoned connection attempt cannot be revoked: erased_unrevocable, not 'nothing'", async () => {
      const svc = service();
      fake.failNext("redeem", { kind: "lost-response" });
      await svc.redeem(A, fake.issueInvitation());
      clock += REDEMPTION_WINDOW_MS + 1000;
      expect(await svc.disconnect(A)).toEqual({
        ok: true,
        outcome: "erased_unrevocable",
        revoked: false,
      });
    });

    it("an account with nothing held is 'nothing'", async () => {
      expect(await service().disconnect(A)).toEqual({
        ok: true,
        outcome: "nothing",
        revoked: false,
      });
    });

    it("a live connection attempt is its own failure, not 'unavailable'", async () => {
      const svc = service();
      fake.failNext("redeem", { kind: "lost-response" });
      await svc.redeem(A, fake.issueInvitation());
      expect(await svc.disconnect(A)).toEqual({ ok: false, code: "PENDING_REDEMPTION" });
      expect((await db().select().from(schema.framebriarRedemptions)).length).toBe(1);
    });

    it("an unconfirmed revoke is UNCERTAIN and a failed erase after a revoke is PARTIAL, and the retry finishes", async () => {
      const svc = service();
      await connect(svc);
      fake.failNext("disconnect", { kind: "network" });
      expect(await svc.disconnect(A)).toEqual({ ok: false, code: "UNCERTAIN" });
      expect(await rows()).toHaveLength(1);
      const broken = createEnrollmentService({
        db: erasing("throw"),
        client: createFramebriarClient({ fetchImpl: fake.fetch, now }),
        keys: () => ring,
        now,
      });
      expect(await broken.disconnect(A)).toEqual({ ok: false, code: "PARTIAL" });
      expect(fake.activeFamilies()).toBe(0);
      // The family is already gone and does not block the retry.
      expect(await svc.disconnect(A)).toEqual({ ok: true, outcome: "nothing", revoked: false });
      expect(await rows()).toHaveLength(0);
    });

    it("a failed revoke keeps the credential so the retry can revoke, and the retry works", async () => {
      const svc = service();
      await connect(svc);
      fake.failNext("disconnect", { kind: "status", status: 503 });
      expect(await svc.disconnect(A)).toEqual({ ok: false, code: "UNCERTAIN" });
      expect(fake.activeFamilies()).toBe(1);
      expect(await rows()).toHaveLength(1);
      expect(await svc.disconnect(A)).toEqual({ ok: true, outcome: "ended", revoked: true });
      expect(fake.activeFamilies()).toBe(0);
      expect(await rows()).toHaveLength(0);
    });
  });

  describe("the judge's #262 prerequisites", () => {
    const withDb = (database: Db) =>
      createEnrollmentService({
        db: database,
        client: createFramebriarClient({ fetchImpl: fake.fetch, now }),
        keys: () => ring,
        now,
      });

    it("an erase that returns false (a lost revision race) in the erased_unrevocable path is 'failed', never a success", async () => {
      await connect(service());
      ring = ringOf("k9", { k9: keyText() });
      const racing = withDb(erasing("lost"));
      expect(await racing.revokeAndEraseEnrollment(A)).toEqual({
        status: "failed",
        reason: "unavailable",
      });
      expect(await racing.disconnect(A)).toEqual({ ok: false, code: "UNAVAILABLE" });
      expect(await rows()).toHaveLength(1);
      // Nothing was lost: the next attempt, with the row unchanged, finishes it.
      expect(await service().revokeAndEraseEnrollment(A)).toEqual({
        status: "erased_unrevocable",
        unrevocableAttempts: 0,
      });
    });

    it("an erase that returns false after a successful revoke is 'partial', and a retry finishes it", async () => {
      const svc = service();
      await connect(svc);
      expect(await withDb(erasing("lost")).revokeAndEraseEnrollment(A)).toEqual({
        status: "partial",
        revoked: true,
        erased: false,
      });
      expect(await svc.revokeAndEraseEnrollment(A)).toMatchObject({ status: "erased" });
    });

    it("a refresh that loses the revision race re-checks exactly once: two refreshes, and the token is still served", async () => {
      await connect(service());
      clock += 59 * 60_000;
      expect(await withDb(losingUpdates(1)).accessToken(A)).toMatchObject({ ok: true });
      expect(fake.count("refresh")).toBe(2);
      expect((await rows())[0].revision).toBe(1 + 1);
    });

    it("never loops: when every write is lost it stops after the one re-check", async () => {
      await connect(service());
      clock += 59 * 60_000;
      expect(await withDb(losingUpdates(10)).accessToken(A)).toMatchObject({ ok: true });
      expect(fake.count("refresh")).toBe(2);
      expect((await rows())[0].revision).toBe(1);
    });

    it("if the race was a disconnect, the re-check finds nothing and no token outlives the erase", async () => {
      const svc = service();
      await connect(svc);
      clock += 59 * 60_000;
      const losing = losingUpdates(1, async () => {
        await svc.disconnect(A);
      });
      expect(await withDb(losing).accessToken(A)).toEqual({ ok: false, code: "NOT_CONNECTED" });
      expect(fake.count("refresh")).toBe(1);
      expect(await rows()).toHaveLength(0);
    });
  });

  it("is a no-op for an account with nothing held", async () => {
    expect(await service().revokeAndEraseEnrollment(A)).toEqual({ status: "none" });
  });

  it("does not touch another account's enrollment", async () => {
    const svc = service();
    await connect(svc, A);
    await connect(svc, B);
    await svc.revokeAndEraseEnrollment(A);
    expect((await svc.status(B)).status).toBe("connected");
    expect(fake.activeFamilies()).toBe(1);
  });
});

describe("what never leaves the service", () => {
  it("no result, row or log line carries an invitation, credential, key, owner id or email", async () => {
    const svc = service();
    const invitation = fake.issueInvitation();
    const results: unknown[] = [];
    results.push(await svc.redeem(A, invitation));
    results.push(await svc.status(A));
    const access = await svc.accessToken(A);
    results.push(await svc.disconnect(A));
    results.push(await svc.revokeAndEraseEnrollment(A));
    const text = JSON.stringify(results) + JSON.stringify(logs);
    expect(text).not.toContain(invitation);
    expect(text).not.toContain(K1);
    expect(text).not.toContain(A);
    if (access.ok) expect(text).not.toContain(access.token);
    expect(logs).toEqual([]);
  });
});
