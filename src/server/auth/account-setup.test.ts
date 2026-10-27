import { createHash } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createMigratedDb } from "../db/__fixtures__/db";
import type { Db } from "../db/retention";
import { createFakeAuth, type FakeAuth } from "./__fixtures__/fake-auth";
import {
  NOTHING_SET_UP,
  createDbSetupStore,
  createMemorySetupStore,
  emailDigest,
  setupDigestKey,
  withSetupGate,
  type AccountSetupStore,
} from "./account-setup";
import { parseAllowlist } from "./allowlist";
import { setAuthLogSink } from "./safe-log";

const DB_KEY = setupDigestKey("a-secret-of-some-length");
const OWNER = { email: "owner@example.test", password: "owner-password", userId: "u1" };
const allowlist = parseAllowlist("owner@example.test");
let fake: FakeAuth;
let logged: string[];
beforeEach(() => {
  fake = createFakeAuth([OWNER]);
  logged = [];
  setAuthLogSink((line) => logged.push(line));
});
afterEach(() => setAuthLogSink());
const events = () => logged.map((line) => (JSON.parse(line) as { event: string }).event);

describe("emailDigest", () => {
  const key = setupDigestKey("a-secret-of-some-length");

  it("is a keyed hex digest of the normalized address, so the stored value is not the address", () => {
    expect(emailDigest("  Owner@Example.TEST ", key)).toBe(emailDigest("owner@example.test", key));
    expect(emailDigest("owner@example.test", key)).toMatch(/^[0-9a-f]{64}$/);
    expect(emailDigest("owner@example.test", key)).not.toContain("owner");
    expect(emailDigest("a@example.test", key)).not.toBe(emailDigest("b@example.test", key));
  });

  it("cannot be reproduced without the key, so a leaked table cannot be tested against known addresses", () => {
    const plain = createHash("sha256").update("owner@example.test").digest("hex");
    expect(emailDigest("owner@example.test", key)).not.toBe(plain);
    expect(emailDigest("owner@example.test", key)).not.toBe(
      emailDigest("owner@example.test", setupDigestKey("another-secret-of-length")),
    );
  });

  it("derives the key from the secret with a label, never using the secret itself", () => {
    expect(setupDigestKey("a-secret-of-some-length")).toMatch(/^[0-9a-f]{64}$/);
    expect(setupDigestKey("a-secret-of-some-length")).not.toContain("secret");
    expect(setupDigestKey("a-secret-of-some-length")).toBe(
      setupDigestKey("a-secret-of-some-length"),
    );
    expect(setupDigestKey("a-secret-of-some-length")).not.toBe(
      setupDigestKey("another-secret-of-length"),
    );
  });
});

describe("stores", () => {
  describe("memory", () => {
    it("remembers set-up addresses, case-insensitively, and never forgets", async () => {
      const store = createMemorySetupStore(["Owner@Example.test"]);
      expect((await store.completedAt("owner@example.test")) !== null).toBe(true);
      expect((await store.completedAt("other@example.test")) !== null).toBe(false);
      await store.markComplete("Other@Example.test");
      expect((await store.completedAt("other@example.test")) !== null).toBe(true);
    });
  });

  it("the no-database store has nobody set up and records nothing", async () => {
    await NOTHING_SET_UP.markComplete("owner@example.test");
    expect((await NOTHING_SET_UP.completedAt("owner@example.test")) !== null).toBe(false);
  });

  describe("database", () => {
    let ctx: Awaited<ReturnType<typeof createMigratedDb>>;
    let store: AccountSetupStore;
    beforeAll(async () => {
      ctx = await createMigratedDb();
      store = createDbSetupStore(ctx.db as unknown as Db, DB_KEY);
    });
    beforeEach(async () => {
      await ctx.client.exec('TRUNCATE TABLE "account_deletions", "account_setups"');
    });
    afterAll(async () => {
      await ctx.client.close();
    });

    it("has nobody set up to begin with, then remembers an address once it is marked", async () => {
      expect((await store.completedAt("owner@example.test")) !== null).toBe(false);
      await store.markComplete("Owner@Example.test");
      expect((await store.completedAt("owner@example.test")) !== null).toBe(true);
      expect((await store.completedAt("someone-else@example.test")) !== null).toBe(false);
    });

    it("returns the time the row was written, never 0 or null (0 would mean 'no age requirement')", async () => {
      const before = Date.now();
      await store.markComplete("timed@example.test");
      const at = await store.completedAt("timed@example.test");
      expect(at).not.toBeNull();
      expect(at).toBeGreaterThan(0);
      // The database's clock and this one agree to within seconds.
      expect(Math.abs((at ?? 0) - before)).toBeLessThan(5_000);
    });

    it("keeps the first time when an address is marked again", async () => {
      await store.markComplete("again@example.test");
      const first = await store.completedAt("again@example.test");
      await new Promise((resolve) => setTimeout(resolve, 20));
      await store.markComplete("again@example.test");
      expect(await store.completedAt("again@example.test")).toBe(first);
    });

    it("drives the gate: a session made before the recorded time is refused, a later one is not", async () => {
      await store.markComplete(OWNER.email);
      const at = (await store.completedAt(OWNER.email)) ?? 0;
      const gated = withSetupGate(fake, store, allowlist);
      fake.current = {
        userId: "u1",
        email: OWNER.email,
        issuedAt: at - 1_000,
        identityCreatedAt: 1,
      };
      expect(await gated.getSession()).toBeNull();
      fake.current = { userId: "u1", email: OWNER.email, issuedAt: at, identityCreatedAt: 1 };
      expect(await gated.getSession()).toBeNull();
      fake.current = {
        userId: "u1",
        email: OWNER.email,
        issuedAt: at + 1_000,
        identityCreatedAt: 1,
      };
      expect(await gated.getSession()).toMatchObject({ email: OWNER.email });
    });

    it("marking twice is harmless, and stores a digest, never the address", async () => {
      await store.markComplete("owner@example.test");
      await store.markComplete("owner@example.test");
      const rows = await ctx.client.query<{ email_digest: string }>(
        `SELECT email_digest FROM account_setups`,
      );
      expect(rows.rows).toEqual([{ email_digest: emailDigest("owner@example.test", DB_KEY) }]);
      expect(JSON.stringify(rows.rows)).not.toContain("example.test");
    });

    it("removes a stale fence and old setup proof when a provider id is reused", async () => {
      await store.markComplete(OWNER.email);
      await ctx.client.query(
        "INSERT INTO account_deletions (user_id, identity_created_at, setup_email_digest) VALUES ($1, $2, $3)",
        [OWNER.userId, new Date(1), emailDigest(OWNER.email, DB_KEY)],
      );
      const at = (await store.completedAt(OWNER.email)) ?? 0;
      fake.current = {
        userId: OWNER.userId,
        email: OWNER.email,
        identityCreatedAt: 2,
        issuedAt: at + 1,
      };

      await expect(withSetupGate(fake, store, allowlist).getSession()).resolves.toBeNull();
      expect((await ctx.client.query("SELECT * FROM account_deletions")).rows).toEqual([]);
      expect((await ctx.client.query("SELECT * FROM account_setups")).rows).toEqual([]);
    });

    it("does not open a transaction for the common no-fence session check", async () => {
      await store.markComplete(OWNER.email);
      const at = (await store.completedAt(OWNER.email)) ?? 0;
      fake.current = {
        userId: OWNER.userId,
        email: OWNER.email,
        identityCreatedAt: 2,
        issuedAt: at + 1,
      };
      const transactionSpy = vi.spyOn(ctx.db, "transaction");

      await expect(withSetupGate(fake, store, allowlist).getSession()).resolves.toMatchObject({
        userId: OWNER.userId,
      });
      expect(transactionSpy).not.toHaveBeenCalled();
      transactionSpy.mockRestore();
    });
  });
});

describe("withSetupGate", () => {
  it("gives no session to a verified account that was never set up, and signs the attempt out", async () => {
    const gated = withSetupGate(fake, createMemorySetupStore(), allowlist);
    // The "attacker's" pre-registered password is right and the address is verified: still no session.
    expect(await gated.signInWithPassword(OWNER.email, OWNER.password)).toEqual({
      ok: false,
      unfinished: true,
      diagnostic: { reason: "setup-pending" },
    });
    expect(fake.signOutCalls).toBe(1);
    expect(fake.current).toBeNull();
    expect(await gated.getSession()).toBeNull();
    // The request-scoped sign-in service logs this outcome with its support reference.
    expect(events()).toEqual([]);
  });

  it("denies a session that already exists (one minted by calling the auth service directly)", async () => {
    fake.current = { userId: "u1", email: OWNER.email };
    const gated = withSetupGate(fake, createMemorySetupStore(), allowlist);
    expect(await gated.getSession()).toBeNull();
  });

  it("lets a set-up account sign in and keep its session", async () => {
    const gated = withSetupGate(fake, createMemorySetupStore([OWNER.email]), allowlist);
    expect(await gated.signInWithPassword(OWNER.email, OWNER.password)).toMatchObject({
      ok: true,
      session: { userId: "u1", email: OWNER.email },
    });
    expect(await gated.getSession()).toMatchObject({ userId: "u1", email: OWNER.email });
    expect(fake.signOutCalls).toBe(0);
  });

  it("keeps a fenced identity out of the app but preserves its raw session for deletion recovery", async () => {
    const store = createMemorySetupStore([OWNER.email]);
    store.blockedUserIds.add(OWNER.userId);
    const gated = withSetupGate(fake, store, allowlist);
    expect(await gated.signInWithPassword(OWNER.email, OWNER.password)).toEqual({
      ok: false,
      deletionPending: true,
      diagnostic: { reason: "account-deletion-pending" },
    });
    expect(fake.current).toMatchObject({ userId: OWNER.userId });
    expect(await gated.getSession()).toBeNull();
    expect(fake.signOutCalls).toBe(0);
  });

  it("fails closed and cleans up a new session if the deletion fence cannot be checked", async () => {
    const store = createMemorySetupStore([OWNER.email]);
    store.deletionState = async () => {
      throw new Error("synthetic database outage for owner@example.test");
    };
    const gated = withSetupGate(fake, store, allowlist);
    expect(await gated.signInWithPassword(OWNER.email, OWNER.password)).toEqual({
      ok: false,
      unfinished: true,
      diagnostic: { reason: "setup-unavailable" },
    });
    expect(fake.current).toBeNull();
    expect(fake.signOutCalls).toBe(1);
  });

  it("starts allowing the account the moment it is marked set up", async () => {
    const store = createMemorySetupStore();
    const gated = withSetupGate(fake, store, allowlist);
    expect(await gated.signInWithPassword(OWNER.email, OWNER.password)).toMatchObject({
      unfinished: true,
    });
    await store.markComplete(OWNER.email);
    expect(await gated.signInWithPassword(OWNER.email, OWNER.password)).toMatchObject({ ok: true });
  });

  it("passes failed and unverified sign-ins through untouched, without asking the store", async () => {
    const users = createFakeAuth([
      { ...OWNER, verified: false },
      { email: "b@example.test", password: "pw", userId: "u2" },
    ]);
    let asked = 0;
    const gated = withSetupGate(
      users,
      {
        completedAt: async () => {
          asked += 1;
          return 0;
        },
        markComplete: async () => {},
        resetPasswordAndMarkComplete: async (_email, reset) => reset(),
      },
      allowlist,
    );
    expect(await gated.signInWithPassword(OWNER.email, OWNER.password)).toEqual({
      ok: false,
      unverified: true,
      diagnostic: { reason: "email-unverified" },
    });
    expect(await gated.signInWithPassword("b@example.test", "wrong")).toMatchObject({
      ok: false,
      diagnostic: { reason: "credentials-rejected" },
    });
    expect(asked).toBe(0);
  });

  it("fails closed when the store errors, logging only a code", async () => {
    const broken: AccountSetupStore = {
      completedAt: async () => {
        throw new Error("connection to db for owner@example.test refused");
      },
      markComplete: async () => {},
      resetPasswordAndMarkComplete: async (_email, reset) => reset(),
    };
    const gated = withSetupGate(fake, broken, allowlist);
    expect(await gated.signInWithPassword(OWNER.email, OWNER.password)).toMatchObject({
      unfinished: true,
    });
    fake.current = { userId: "u1", email: OWNER.email };
    expect(await gated.getSession()).toBeNull();
    expect(events()).toContain("provider-error");
    expect(logged.join()).not.toContain("owner@example.test");
  });

  it("still ends the attempt when signing out fails", async () => {
    fake.failNextSignOut = true;
    const gated = withSetupGate(fake, createMemorySetupStore(), allowlist);
    expect(await gated.signInWithPassword(OWNER.email, OWNER.password)).toMatchObject({
      unfinished: true,
      diagnostic: { reason: "setup-pending", cleanupFailed: true },
    });
    expect(events()).toEqual([]);
  });

  it("rechecks a positive answer so account closure takes effect without retaining a provider-id tombstone", async () => {
    let asked = 0;
    const store: AccountSetupStore = {
      completedAt: async () => {
        asked += 1;
        return 0;
      },
      markComplete: async () => {},
      resetPasswordAndMarkComplete: async (_email, reset) => reset(),
    };
    const gated = withSetupGate(fake, store, allowlist);
    fake.current = { userId: "u1", email: OWNER.email };
    for (let i = 0; i < 5; i += 1) await gated.getSession();
    expect(asked).toBe(5);
  });

  it("does not let a newly registered or reused provider identity inherit the deleted setup", async () => {
    const store = createMemorySetupStore([OWNER.email]);
    const gated = withSetupGate(fake, store, allowlist);
    fake.current = { userId: "old-provider-id", email: OWNER.email };
    expect(await gated.getSession()).not.toBeNull();
    store.digests.clear();
    fake.current = { userId: "old-provider-id", email: OWNER.email };
    expect(await gated.getSession()).toBeNull();
  });

  it("does not remember a negative answer: a newly set-up account gets in at once", async () => {
    // Recorded at time 0 (no requirement on when sessions were made), so only "was it ever set up" is being tested.
    const store = createMemorySetupStore([], () => 0);
    const gated = withSetupGate(fake, store, allowlist);
    fake.current = { userId: "u1", email: OWNER.email };
    expect(await gated.getSession()).toBeNull();
    expect(await gated.getSession()).toBeNull();
    await store.markComplete(OWNER.email);
    expect(await gated.getSession()).not.toBeNull();
  });

  describe("a session made before the password was set through the link", () => {
    const SETUP_AT = 1_000_000;
    const stores = () => createMemorySetupStore([], () => SETUP_AT);

    it("stays refused after the link is used, however it was made", async () => {
      const store = stores();
      await store.markComplete(OWNER.email);
      const gated = withSetupGate(fake, store, allowlist);
      // Minted with the pre-registered password before the owner finished setting up: older than the setup.
      fake.current = { userId: "u1", email: OWNER.email, issuedAt: SETUP_AT - 1 };
      expect(await gated.getSession()).toBeNull();
      // One that does not say when it was made cannot be shown to be newer, so it is refused too.
      fake.current = { userId: "u1", email: OWNER.email };
      expect(await gated.getSession()).toBeNull();
    });

    it("refuses a session made in the same instant as the setup, and lets a later one through", async () => {
      const store = stores();
      await store.markComplete(OWNER.email);
      const gated = withSetupGate(fake, store, allowlist);
      fake.current = { userId: "u1", email: OWNER.email, issuedAt: SETUP_AT };
      expect(await gated.getSession()).toBeNull();
      for (const issuedAt of [SETUP_AT + 1, SETUP_AT + 3_600_000]) {
        fake.current = { userId: "u1", email: OWNER.email, issuedAt };
        expect(await gated.getSession()).toEqual({ userId: "u1", email: OWNER.email, issuedAt });
      }
    });

    it("makes no demand of an address that was set up before sessions carried a time (time 0)", async () => {
      const gated = withSetupGate(fake, createMemorySetupStore([OWNER.email]), allowlist);
      fake.current = { userId: "u1", email: OWNER.email };
      expect(await gated.getSession()).not.toBeNull();
    });

    it("applies the moment the setup is recorded, even for a session the gate already looked at", async () => {
      const store = stores();
      const gated = withSetupGate(fake, store, allowlist);
      fake.current = { userId: "u1", email: OWNER.email, issuedAt: SETUP_AT - 500 };
      expect(await gated.getSession()).toBeNull();
      await store.markComplete(OWNER.email);
      expect(await gated.getSession()).toBeNull();
    });
  });

  it("leaves an address that is not allowlisted to the allowlist's own denial, whatever its setup says", async () => {
    const stranger = { email: "stranger@example.test", password: "pw", userId: "u9" };
    const users = createFakeAuth([stranger]);
    const gated = withSetupGate(users, createMemorySetupStore(), allowlist);
    // Passed through untouched: the allowlist check (sign-in, guard) refuses it exactly as it did before this gate.
    expect(await gated.signInWithPassword(stranger.email, stranger.password)).toMatchObject({
      ok: true,
    });
    expect(await gated.getSession()).toMatchObject({ userId: "u9", email: stranger.email });
    expect(users.signOutCalls).toBe(0);
  });

  it("leaves every other provider call as it was", async () => {
    const gated = withSetupGate(fake, createMemorySetupStore(), allowlist);
    await gated.signUp("a@example.test", "a-long-password");
    await gated.verifyEmail("a@example.test", "123456");
    await gated.requestPasswordReset("a@example.test", "https://a.test/r");
    await gated.signOut();
    expect(fake.flows.calls.map((call) => call.method)).toEqual([
      "signUp",
      "verifyEmail",
      "requestPasswordReset",
    ]);
    expect(fake.signOutCalls).toBe(1);
  });
});
