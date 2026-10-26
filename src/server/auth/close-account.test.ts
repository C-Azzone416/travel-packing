import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createMigratedDb, resetData } from "@/server/db/__fixtures__/db";
import type { Db } from "@/server/db/retention";
import { createFakeAuth } from "./__fixtures__/fake-auth";
import { createMemorySetupStore } from "./account-setup";
import { parseAllowlist } from "./allowlist";
import { closeAccount, deletionSession } from "./close-account";
import type { RuntimeAuth } from "./auth-runtime";

const SESSION = { userId: "synthetic-owner", email: "owner@example.test" };
const PASSWORD = "synthetic-password";
let context: Awaited<ReturnType<typeof createMigratedDb>>;
let fake: ReturnType<typeof createFakeAuth>;
let auth: RuntimeAuth;
let setup: ReturnType<typeof createMemorySetupStore>;

beforeAll(async () => {
  context = await createMigratedDb();
});
beforeEach(async () => {
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
afterAll(async () => context.client.close());

describe("closeAccount", () => {
  it("reads only the raw recovery provider session", async () => {
    auth.provider = { ...fake, getSession: async () => null };
    expect(await deletionSession(auth)).toEqual(SESSION);
  });

  it("reauthenticates, fences and purges app data, revokes other sessions, then deletes the identity", async () => {
    expect(await closeAccount(auth, context.db as unknown as Db, SESSION, PASSWORD)).toEqual({
      status: "ok",
    });
    expect(fake.flows.calls).toEqual([
      { method: "revokeOtherSessions", args: [] },
      { method: "deleteUser", args: [PASSWORD] },
    ]);
    expect(fake.current).toBeNull();
    expect((await context.client.query("SELECT * FROM users")).rows).toEqual([]);
    expect((await context.client.query("SELECT user_id FROM account_deletions")).rows).toEqual([
      { user_id: SESSION.userId },
    ]);
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
    ).toEqual([{ count: 1 }]);
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
});
