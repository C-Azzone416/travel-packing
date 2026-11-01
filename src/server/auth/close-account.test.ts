import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createMigratedDb, resetData } from "@/server/db/__fixtures__/db";
import type { Db } from "@/server/db/retention";
import { createFakeAuth } from "./__fixtures__/fake-auth";
import { createMemorySetupStore } from "./account-setup";
import { parseAllowlist } from "./allowlist";
import { closeAccount, deletionSession } from "./close-account";
import type { RuntimeAuth } from "./auth-runtime";

const SESSION = {
  userId: "synthetic-owner",
  email: "owner@example.test",
  identityCreatedAt: 1_700_000_000_000,
};
const PASSWORD = "synthetic-password";
let context: Awaited<ReturnType<typeof createMigratedDb>>;
let fake: ReturnType<typeof createFakeAuth>;
let auth: RuntimeAuth;
let setup: ReturnType<typeof createMemorySetupStore>;

beforeAll(async () => {
  context = await createMigratedDb();
});
beforeEach(async () => {
  vi.stubEnv("CLOSE_ACCOUNT_ENABLED", "1");
  await resetData(context.client);
  await context.client.query("INSERT INTO users (id) VALUES ($1)", [SESSION.userId]);
  fake = createFakeAuth([{ ...SESSION, password: PASSWORD }]);
  fake.current = SESSION;
  setup = createMemorySetupStore([SESSION.email]);
  auth = {
    provider: fake,
    deletionProvider: fake,
    allowlist: parseAllowlist(SESSION.email),
    available: true,
    setup,
    seals: { seal: () => "", open: () => null },
    completionSignals: { issue: () => "", open: () => false },
  };
});
afterEach(() => vi.unstubAllEnvs());
afterAll(async () => context.client.close());

/** The read the Framebriar gate (#261) makes before anything else: partial database fakes must still answer it. */
const reads = () => ({ select: context.db.select.bind(context.db) });

describe("closeAccount", () => {
  const withProviderIdentityAbsent = (): Db =>
    new Proxy(context.db as unknown as Db, {
      get(target, property, receiver) {
        if (property === "execute") return async () => ({ rows: [{ exists: false }] });
        const value = Reflect.get(target, property, receiver) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    });

  it("refuses a direct core call while rollout is off without authenticating or touching data", async () => {
    vi.stubEnv("CLOSE_ACCOUNT_ENABLED", "");
    expect(await closeAccount(auth, context.db as unknown as Db, SESSION, PASSWORD)).toEqual({
      status: "unavailable",
      deletionStarted: false,
    });
    expect(fake.flows.calls).toEqual([]);
    expect(fake.current).toEqual(SESSION);
    expect((await context.client.query("SELECT id FROM users")).rows).toEqual([
      { id: SESSION.userId },
    ]);
    expect((await context.client.query("SELECT * FROM account_deletions")).rows).toEqual([]);
  });

  it("reads only the raw recovery provider session", async () => {
    auth.provider = { ...fake, getSession: async () => null };
    expect(await deletionSession(auth)).toEqual(SESSION);
  });

  it("fails closed when the raw recovery session is unavailable or not allowlisted", async () => {
    fake.current = { userId: "synthetic-other", email: "other@example.test" };
    expect(await deletionSession(auth)).toBeNull();
    fake.getSession = async () => {
      throw new Error("synthetic provider outage");
    };
    expect(await deletionSession(auth)).toBeNull();
  });

  it("reauthenticates, purges app data, deletes the identity, then removes the transient fence", async () => {
    expect(await closeAccount(auth, context.db as unknown as Db, SESSION, PASSWORD)).toEqual({
      status: "ok",
    });
    expect(fake.flows.calls).toEqual([
      { method: "revokeOtherSessions", args: [] },
      { method: "deleteUser", args: [PASSWORD] },
    ]);
    expect(fake.current).toBeNull();
    expect((await context.client.query("SELECT * FROM users")).rows).toEqual([]);
    expect((await context.client.query("SELECT user_id FROM account_deletions")).rows).toEqual([]);
  });

  it("does nothing when the current password is wrong", async () => {
    expect(await closeAccount(auth, context.db as unknown as Db, SESSION, "wrong")).toEqual({
      status: "wrong-password",
    });
    expect(fake.flows.calls).toEqual([]);
    expect((await context.client.query("SELECT id FROM users")).rows).toEqual([
      { id: SESSION.userId },
    ]);
    expect((await context.client.query("SELECT * FROM account_deletions")).rows).toEqual([]);
  });

  it("does nothing when fresh authentication is unavailable", async () => {
    fake.signInWithPassword = async () => ({
      ok: false,
      diagnostic: { reason: "provider-unavailable" },
    });
    expect(await closeAccount(auth, context.db as unknown as Db, SESSION, PASSWORD)).toEqual({
      status: "unavailable",
      deletionStarted: false,
    });
    expect((await context.client.query("SELECT * FROM account_deletions")).rows).toEqual([]);
  });

  it("fails closed and ends a mismatched session before any database deletion", async () => {
    const signIn = fake.signInWithPassword.bind(fake);
    fake.signInWithPassword = async (email, password) => {
      const result = await signIn(email, password);
      return result.ok
        ? { ...result, session: { ...result.session, userId: "different-synthetic-owner" } }
        : result;
    };
    expect(await closeAccount(auth, context.db as unknown as Db, SESSION, PASSWORD)).toEqual({
      status: "unavailable",
      deletionStarted: false,
    });
    expect(fake.signOutCalls).toBe(1);
    expect((await context.client.query("SELECT id FROM users")).rows).toEqual([
      { id: SESSION.userId },
    ]);
  });

  it("fails closed on a mismatched email even if provider sign-out also fails", async () => {
    const signIn = fake.signInWithPassword.bind(fake);
    fake.signInWithPassword = async (email, password) => {
      const result = await signIn(email, password);
      return result.ok
        ? { ...result, session: { ...result.session, email: "other@example.test" } }
        : result;
    };
    fake.signOut = async () => {
      throw new Error("synthetic sign-out failure");
    };
    expect(await closeAccount(auth, context.db as unknown as Db, SESSION, PASSWORD)).toEqual({
      status: "unavailable",
      deletionStarted: false,
    });
    expect((await context.client.query("SELECT * FROM account_deletions")).rows).toEqual([]);
  });

  it("does nothing when the setup digest needed for scoped cleanup is unavailable", async () => {
    setup.removalDigest = undefined;
    expect(await closeAccount(auth, context.db as unknown as Db, SESSION, PASSWORD)).toEqual({
      status: "unavailable",
      deletionStarted: false,
    });
    expect((await context.client.query("SELECT * FROM account_deletions")).rows).toEqual([]);
  });

  it("never deletes a new provider identity that reused an id from a pending deletion", async () => {
    await context.client.query(
      "INSERT INTO account_deletions (user_id, identity_created_at, setup_email_digest) VALUES ($1, $2, $3)",
      [SESSION.userId, new Date(SESSION.identityCreatedAt - 1), "b".repeat(64)],
    );

    expect(await closeAccount(auth, context.db as unknown as Db, SESSION, PASSWORD)).toEqual({
      status: "unavailable",
      deletionStarted: false,
    });
    expect(fake.flows.calls).toEqual([]);
    expect(fake.signOutCalls).toBe(1);
    expect((await context.client.query("SELECT id FROM users")).rows).toEqual([
      { id: SESSION.userId },
    ]);
  });

  it("leaves a safe, retryable fence if session revocation fails after the app purge", async () => {
    fake.flows.answers.revokeOtherSessions = { ok: false, reason: "unavailable" };
    expect(await closeAccount(auth, context.db as unknown as Db, SESSION, PASSWORD)).toEqual({
      status: "unavailable",
      deletionStarted: true,
    });
    expect(fake.flows.calls.map((call) => call.method)).toEqual(["revokeOtherSessions"]);
    expect(fake.current).not.toBeNull();
    expect((await context.client.query("SELECT * FROM users")).rows).toEqual([]);
    expect((await context.client.query("SELECT user_id FROM account_deletions")).rows).toEqual([
      { user_id: SESSION.userId },
    ]);
  });

  it("is safe to retry after provider deletion failed", async () => {
    fake.flows.answers.deleteUser = { ok: false, reason: "unavailable" };
    expect(await closeAccount(auth, context.db as unknown as Db, SESSION, PASSWORD)).toEqual({
      status: "unavailable",
      deletionStarted: true,
    });
    delete fake.flows.answers.deleteUser;
    expect(await closeAccount(auth, context.db as unknown as Db, SESSION, PASSWORD)).toEqual({
      status: "ok",
    });
    expect(
      (await context.client.query("SELECT count(*)::int AS count FROM account_deletions")).rows,
    ).toEqual([{ count: 0 }]);
  });

  it("finishes when a lost provider response is reconciled to an absent auth identity", async () => {
    fake.flows.answers.deleteUser = { ok: false, reason: "unavailable" };
    expect(await closeAccount(auth, withProviderIdentityAbsent(), SESSION, PASSWORD)).toEqual({
      status: "ok",
    });
    expect((await context.client.query("SELECT * FROM account_deletions")).rows).toEqual([]);
    expect((await context.client.query("SELECT * FROM users")).rows).toEqual([]);
  });

  it("does not claim completion when provider deletion succeeds but transient fence removal fails", async () => {
    let transactions = 0;
    const wrapped = {
      ...context.db,
      ...reads(),
      transaction: async (work: Parameters<Db["transaction"]>[0]) => {
        transactions += 1;
        if (transactions === 2) throw new Error("synthetic final cleanup outage");
        const result = await context.db.transaction(work);
        setup.blockedUserIds.add(SESSION.userId);
        return result;
      },
    } as unknown as Db;

    expect(await closeAccount(auth, wrapped, SESSION, PASSWORD)).toEqual({
      status: "unavailable",
      deletionStarted: true,
      providerDeleted: true,
    });
    expect(fake.current).toBeNull();
    expect((await context.client.query("SELECT * FROM users")).rows).toEqual([]);
    expect((await context.client.query("SELECT user_id FROM account_deletions")).rows).toEqual([
      { user_id: SESSION.userId },
    ]);
  });

  it("accepts terminal cleanup whose commit acknowledgement was lost when the fence reread is absent", async () => {
    let transactions = 0;
    const wrapped = {
      ...context.db,
      ...reads(),
      transaction: async (work: Parameters<Db["transaction"]>[0]) => {
        transactions += 1;
        if (transactions !== 2) return context.db.transaction(work);
        await context.db.transaction(work);
        setup.blockedUserIds.delete(SESSION.userId);
        throw new Error("synthetic final cleanup acknowledgement lost");
      },
    } as unknown as Db;

    expect(await closeAccount(auth, wrapped, SESSION, PASSWORD)).toEqual({ status: "ok" });
    expect((await context.client.query("SELECT * FROM account_deletions")).rows).toEqual([]);
  });

  it("does not report success when the terminal fence belongs to another identity generation", async () => {
    const deleteUser = fake.deleteUser.bind(fake);
    fake.deleteUser = async (password) => {
      const result = await deleteUser(password);
      await context.client.query(
        "UPDATE account_deletions SET identity_created_at = $2 WHERE user_id = $1",
        [SESSION.userId, new Date(SESSION.identityCreatedAt + 1)],
      );
      return result;
    };

    expect(await closeAccount(auth, context.db as unknown as Db, SESSION, PASSWORD)).toEqual({
      status: "unavailable",
      deletionStarted: "unknown",
      providerDeleted: true,
    });
    expect((await context.client.query("SELECT user_id FROM account_deletions")).rows).toEqual([
      { user_id: SESSION.userId },
    ]);
  });

  it("does not call the provider delete if the database transaction fails", async () => {
    const broken = {
      ...reads(),
      transaction: async () => {
        throw new Error("synthetic database failure");
      },
    } as unknown as Db;
    expect(await closeAccount(auth, broken, SESSION, PASSWORD)).toEqual({
      status: "unavailable",
      deletionStarted: false,
    });
    expect(fake.flows.calls).toEqual([]);
  });

  it("detects a durable fence after an ambiguous transaction acknowledgement", async () => {
    const ambiguous = {
      ...reads(),
      transaction: async () => {
        setup.blockedUserIds.add(SESSION.userId);
        throw new Error("synthetic acknowledgement lost after commit");
      },
    } as unknown as Db;
    expect(await closeAccount(auth, ambiguous, SESSION, PASSWORD)).toEqual({
      status: "unavailable",
      deletionStarted: true,
    });
  });

  it("reports a confirmed transaction rollback when the fence reread is false", async () => {
    const broken = {
      ...reads(),
      transaction: async () => {
        throw new Error("synthetic rollback");
      },
    } as unknown as Db;
    expect(await closeAccount(auth, broken, SESSION, PASSWORD)).toEqual({
      status: "unavailable",
      deletionStarted: false,
    });
  });

  it("preserves uncertainty when the fence reread capability is unavailable", async () => {
    setup.isAccountDeletionBlocked = undefined;
    const broken = {
      ...reads(),
      transaction: async () => {
        throw new Error("synthetic unknown transaction result");
      },
    } as unknown as Db;
    expect(await closeAccount(auth, broken, SESSION, PASSWORD)).toEqual({
      status: "unavailable",
      deletionStarted: "unknown",
    });
  });

  it("preserves uncertainty when both the transaction and fence re-read fail", async () => {
    setup.isAccountDeletionBlocked = async () => {
      throw new Error("synthetic fence read failure");
    };
    const broken = {
      ...reads(),
      transaction: async () => {
        throw new Error("synthetic unknown transaction result");
      },
    } as unknown as Db;
    expect(await closeAccount(auth, broken, SESSION, PASSWORD)).toEqual({
      status: "unavailable",
      deletionStarted: "unknown",
    });
  });

  describe("the Framebriar gate (#261): nothing is deleted while sealed feedback credentials remain", () => {
    const hold = {
      enrollment: (owner = SESSION.userId) =>
        context.client.query(
          "INSERT INTO framebriar_enrollments (owner_id, generation, key_version, credentials, expires_at) SELECT id, generation, 'k1', 'v1.synthetic', now() + interval '1 day' FROM users WHERE id = $1",
          [owner],
        ),
      redemption: (owner = SESSION.userId, ageHours = 0) =>
        context.client.query(
          "INSERT INTO framebriar_redemptions (owner_id, generation, attempt_id, created_at) SELECT id, generation, gen_random_uuid(), now() - make_interval(hours => $2) FROM users WHERE id = $1",
          [owner, ageHours],
        ),
    };
    const untouched = async () => {
      expect((await context.client.query("SELECT id FROM users")).rows).toEqual([
        { id: SESSION.userId },
      ]);
      expect((await context.client.query("SELECT * FROM account_deletions")).rows).toEqual([]);
      expect(fake.flows.calls).toEqual([]);
      expect(fake.current).toEqual(SESSION);
    };

    it.each([
      ["an enrollment row", () => hold.enrollment()],
      ["a pending connection attempt", () => hold.redemption()],
      [
        "a stale connection attempt (past its retry window)",
        () => hold.redemption(SESSION.userId, 5),
      ],
    ])("refuses on %s, before reauthentication, and deletes nothing", async (_label, seed) => {
      await seed();
      expect(await closeAccount(auth, context.db as unknown as Db, SESSION, PASSWORD)).toEqual({
        status: "feedback-blocking",
      });
      await untouched();
      expect(
        (await context.client.query("SELECT owner_id FROM framebriar_enrollments")).rows.length +
          (await context.client.query("SELECT owner_id FROM framebriar_redemptions")).rows.length,
      ).toBe(1);
    });

    it("refuses with a wrong password too: the gate comes first, so nothing about the password is learned", async () => {
      await hold.enrollment();
      expect(
        await closeAccount(auth, context.db as unknown as Db, SESSION, "not-the-password"),
      ).toEqual({ status: "feedback-blocking" });
      await untouched();
    });

    it("another account's feedback does not block this one", async () => {
      await context.client.query("INSERT INTO users (id) VALUES ('synthetic-other')");
      await hold.enrollment("synthetic-other");
      await hold.redemption("synthetic-other");
      expect(await closeAccount(auth, context.db as unknown as Db, SESSION, PASSWORD)).toEqual({
        status: "ok",
      });
      expect((await context.client.query("SELECT id FROM users")).rows).toEqual([
        { id: "synthetic-other" },
      ]);
      expect(
        (await context.client.query("SELECT owner_id FROM framebriar_enrollments")).rows,
      ).toEqual([{ owner_id: "synthetic-other" }]);
    });

    it("closes normally once nothing is held (disconnected first)", async () => {
      await hold.enrollment();
      await hold.redemption();
      await context.client.query("DELETE FROM framebriar_enrollments");
      await context.client.query("DELETE FROM framebriar_redemptions");
      expect(await closeAccount(auth, context.db as unknown as Db, SESSION, PASSWORD)).toEqual({
        status: "ok",
      });
      expect((await context.client.query("SELECT * FROM users")).rows).toEqual([]);
    });

    it("a gate that cannot be evaluated attempts nothing and says nothing was started", async () => {
      const signIn = vi.spyOn(fake, "signInWithPassword");
      const broken = {
        ...reads(),
        select: () => {
          throw new Error("synthetic read outage");
        },
      } as unknown as Db;
      expect(await closeAccount(auth, broken, SESSION, PASSWORD)).toEqual({
        status: "unavailable",
        deletionStarted: false,
      });
      expect(fake.flows.calls).toEqual([]);
      // F2 (#311): the core must not reauthenticate when its gate cannot answer.
      expect(signIn).not.toHaveBeenCalled();
    });

    it("the core refuses by itself when the early read missed it (an enrollment that appeared in between)", async () => {
      await hold.enrollment();
      let firstRead = true;
      const real = context.db as unknown as Db;
      const racing = new Proxy(real as object, {
        get(target, property, receiver) {
          if (property === "select") {
            return (...args: unknown[]) => {
              if (firstRead) {
                firstRead = false;
                // The early read sees no owner row (so no feedback): the authoritative check inside the transaction must catch it.
                return { from: () => ({ where: async () => [] }) };
              }
              return (real.select as (...a: unknown[]) => unknown)(...args);
            };
          }
          const value = Reflect.get(target, property, receiver) as unknown;
          return typeof value === "function" ? value.bind(target) : value;
        },
      }) as unknown as Db;
      expect(await closeAccount(auth, racing, SESSION, PASSWORD)).toEqual({
        status: "feedback-blocking",
      });
      expect(
        (await context.client.query("SELECT owner_id FROM framebriar_enrollments")).rows,
      ).toEqual([{ owner_id: SESSION.userId }]);
      expect((await context.client.query("SELECT * FROM account_deletions")).rows).toEqual([]);
      expect((await context.client.query("SELECT id FROM users")).rows).toEqual([
        { id: SESSION.userId },
      ]);
    });
  });

  it("leaves the durable fence when provider identity deletion fails", async () => {
    fake.flows.answers.deleteUser = { ok: false, reason: "unavailable" };
    expect(await closeAccount(auth, context.db as unknown as Db, SESSION, PASSWORD)).toEqual({
      status: "unavailable",
      deletionStarted: true,
    });
    expect((await context.client.query("SELECT user_id FROM account_deletions")).rows).toEqual([
      { user_id: SESSION.userId },
    ]);
  });
});
