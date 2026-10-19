import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createMigratedDb } from "../db/__fixtures__/db";
import type { Db } from "../db/retention";
import { createFakeAuth, type FakeAuth } from "./__fixtures__/fake-auth";
import {
  NOTHING_SET_UP,
  createDbSetupStore,
  createMemorySetupStore,
  emailDigest,
  withSetupGate,
  type AccountSetupStore,
} from "./account-setup";
import { setAuthLogSink } from "./safe-log";

const OWNER = { email: "owner@example.test", password: "owner-password", userId: "u1" };
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
  it("is a SHA-256 hex of the normalized address, so the stored value is not the address", () => {
    expect(emailDigest("  Owner@Example.TEST ")).toBe(emailDigest("owner@example.test"));
    expect(emailDigest("owner@example.test")).toMatch(/^[0-9a-f]{64}$/);
    expect(emailDigest("owner@example.test")).not.toContain("owner");
    expect(emailDigest("a@example.test")).not.toBe(emailDigest("b@example.test"));
  });
});

describe("stores", () => {
  describe("memory", () => {
    it("remembers set-up addresses, case-insensitively, and never forgets", async () => {
      const store = createMemorySetupStore(["Owner@Example.test"]);
      expect(await store.isComplete("owner@example.test")).toBe(true);
      expect(await store.isComplete("other@example.test")).toBe(false);
      await store.markComplete("Other@Example.test");
      expect(await store.isComplete("other@example.test")).toBe(true);
    });
  });

  it("the no-database store has nobody set up and records nothing", async () => {
    await NOTHING_SET_UP.markComplete("owner@example.test");
    expect(await NOTHING_SET_UP.isComplete("owner@example.test")).toBe(false);
  });

  describe("database", () => {
    let ctx: Awaited<ReturnType<typeof createMigratedDb>>;
    let store: AccountSetupStore;
    beforeAll(async () => {
      ctx = await createMigratedDb();
      store = createDbSetupStore(ctx.db as unknown as Db);
    });
    afterAll(async () => {
      await ctx.client.close();
    });

    it("has nobody set up to begin with, then remembers an address once it is marked", async () => {
      expect(await store.isComplete("owner@example.test")).toBe(false);
      await store.markComplete("Owner@Example.test");
      expect(await store.isComplete("owner@example.test")).toBe(true);
      expect(await store.isComplete("someone-else@example.test")).toBe(false);
    });

    it("marking twice is harmless, and stores a digest, never the address", async () => {
      await store.markComplete("owner@example.test");
      await store.markComplete("owner@example.test");
      const rows = await ctx.client.query<{ email_digest: string }>(
        `SELECT email_digest FROM account_setups`,
      );
      expect(rows.rows).toEqual([{ email_digest: emailDigest("owner@example.test") }]);
      expect(JSON.stringify(rows.rows)).not.toContain("example.test");
    });
  });
});

describe("withSetupGate", () => {
  it("gives no session to a verified account that was never set up, and signs the attempt out", async () => {
    const gated = withSetupGate(fake, createMemorySetupStore());
    // The "attacker's" pre-registered password is right and the address is verified: still no session.
    expect(await gated.signInWithPassword(OWNER.email, OWNER.password)).toEqual({
      ok: false,
      unfinished: true,
    });
    expect(fake.signOutCalls).toBe(1);
    expect(fake.current).toBeNull();
    expect(await gated.getSession()).toBeNull();
    expect(events()).toEqual(["sign-in-setup-pending"]);
  });

  it("denies a session that already exists (one minted by calling the auth service directly)", async () => {
    fake.current = { userId: "u1", email: OWNER.email };
    const gated = withSetupGate(fake, createMemorySetupStore());
    expect(await gated.getSession()).toBeNull();
  });

  it("lets a set-up account sign in and keep its session", async () => {
    const gated = withSetupGate(fake, createMemorySetupStore([OWNER.email]));
    expect(await gated.signInWithPassword(OWNER.email, OWNER.password)).toEqual({
      ok: true,
      session: { userId: "u1", email: OWNER.email },
    });
    expect(await gated.getSession()).toEqual({ userId: "u1", email: OWNER.email });
    expect(fake.signOutCalls).toBe(0);
  });

  it("starts allowing the account the moment it is marked set up", async () => {
    const store = createMemorySetupStore();
    const gated = withSetupGate(fake, store);
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
    const gated = withSetupGate(users, {
      isComplete: async () => {
        asked += 1;
        return true;
      },
      markComplete: async () => {},
    });
    expect(await gated.signInWithPassword(OWNER.email, OWNER.password)).toEqual({
      ok: false,
      unverified: true,
    });
    expect(await gated.signInWithPassword("b@example.test", "wrong")).toEqual({ ok: false });
    expect(asked).toBe(0);
  });

  it("fails closed when the store errors, logging only a code", async () => {
    const broken: AccountSetupStore = {
      isComplete: async () => {
        throw new Error("connection to db for owner@example.test refused");
      },
      markComplete: async () => {},
    };
    const gated = withSetupGate(fake, broken);
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
    const gated = withSetupGate(fake, createMemorySetupStore());
    expect(await gated.signInWithPassword(OWNER.email, OWNER.password)).toMatchObject({
      unfinished: true,
    });
    expect(events()).toEqual(["sign-in-setup-pending", "provider-error"]);
  });

  it("remembers a positive answer, so the store is asked once per address, not once per request", async () => {
    let asked = 0;
    const store: AccountSetupStore = {
      isComplete: async () => {
        asked += 1;
        return true;
      },
      markComplete: async () => {},
    };
    const gated = withSetupGate(fake, store);
    fake.current = { userId: "u1", email: OWNER.email };
    for (let i = 0; i < 5; i += 1) await gated.getSession();
    expect(asked).toBe(1);
  });

  it("does not remember a negative answer: a newly set-up account gets in at once", async () => {
    const store = createMemorySetupStore();
    const gated = withSetupGate(fake, store);
    fake.current = { userId: "u1", email: OWNER.email };
    expect(await gated.getSession()).toBeNull();
    expect(await gated.getSession()).toBeNull();
    await store.markComplete(OWNER.email);
    expect(await gated.getSession()).not.toBeNull();
  });

  it("leaves every other provider call as it was", async () => {
    const gated = withSetupGate(fake, createMemorySetupStore());
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
