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
      transaction: async () => {
        throw new Error("synthetic unknown transaction result");
      },
    } as unknown as Db;
    expect(await closeAccount(auth, broken, SESSION, PASSWORD)).toEqual({
      status: "unavailable",
      deletionStarted: "unknown",
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
