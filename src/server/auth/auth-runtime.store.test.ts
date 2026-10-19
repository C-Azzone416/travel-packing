// The production wiring of the setup store (#83): the runtime must build the DATABASE-backed store, keyed from the right
// secret, and the gate over it must use the row's real time. Unit tests with an injected store cannot see any of that, so
// this runs the runtime against a real (PGlite) database with the real migrations.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createMigratedDb } from "../db/__fixtures__/db";
import type { Db } from "../db/retention";

let db: Db;
vi.mock("@/server/db/app-db", () => ({
  getAppDb: async () => db,
  resetAppDb: () => {},
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
const createNeonAuth = vi.fn();
vi.mock("@neondatabase/auth/next/server", () => ({
  createNeonAuth: (...args: unknown[]) => createNeonAuth(...args),
}));

import { emailDigest, setupDigestKey } from "./account-setup";
import { getAuth, resetAuthRuntime } from "./auth-runtime";
import { setAuthLogSink } from "./safe-log";

const SECRET = "s".repeat(40);
const OWNER = "owner@example.test";
const env = {
  NEON_AUTH_BASE_URL: "https://auth.example.test",
  NEON_AUTH_COOKIE_SECRET: SECRET,
  OWNER_EMAIL_ALLOWLIST: OWNER,
};

let ctx: Awaited<ReturnType<typeof createMigratedDb>>;
beforeAll(async () => {
  ctx = await createMigratedDb();
  db = ctx.db as unknown as Db;
});
afterAll(async () => {
  await ctx.client.close();
});
beforeEach(async () => {
  await ctx.client.exec('TRUNCATE TABLE "account_setups"');
  resetAuthRuntime();
  createNeonAuth.mockReset();
  setAuthLogSink(() => {});
});
afterEach(() => {
  setAuthLogSink();
  vi.unstubAllEnvs();
});

const stored = async () =>
  (
    await ctx.client.query<{ email_digest: string }>(`SELECT email_digest FROM account_setups`)
  ).rows.map((row) => row.email_digest);

describe("the runtime's setup store (Neon provider)", () => {
  it("is the database store, keyed with a key derived from the cookie secret, not from anything else", async () => {
    createNeonAuth.mockReturnValue({});
    const auth = await getAuth(env);
    await auth.setup.markComplete(OWNER);
    expect(await stored()).toEqual([emailDigest(OWNER, setupDigestKey(SECRET))]);
    // Not the empty key, not the raw secret, not another secret.
    for (const wrong of ["", SECRET, setupDigestKey(""), setupDigestKey("t".repeat(40))]) {
      expect(await stored()).not.toContain(emailDigest(OWNER, wrong));
    }
  });

  it("makes the gate use the row's real time: a session made before it is refused, one after is not", async () => {
    let createdAt = new Date(0).toISOString();
    createNeonAuth.mockReturnValue({
      getSession: async () => ({
        data: {
          user: { id: "u1", email: OWNER, emailVerified: true },
          session: { createdAt },
        },
      }),
    });
    const auth = await getAuth(env);
    expect(await auth.provider.getSession()).toBeNull();
    await auth.setup.markComplete(OWNER);
    // Made long before the setup (and an hour before, to be clear of any clock difference): refused.
    createdAt = new Date(Date.now() - 3_600_000).toISOString();
    expect(await auth.provider.getSession()).toBeNull();
    // Made after the setup: allowed.
    createdAt = new Date(Date.now() + 60_000).toISOString();
    expect(await auth.provider.getSession()).toMatchObject({ email: OWNER });
  });

  it("a link's seal and the digest key are separate keys derived from the same secret", async () => {
    createNeonAuth.mockReturnValue({});
    const auth = await getAuth(env);
    const sealed = auth.seals.seal(OWNER);
    expect(auth.seals.open(sealed)).toBe(OWNER);
    expect(sealed).not.toContain(setupDigestKey(SECRET));
  });
});

describe("the runtime's setup store (e2e build)", () => {
  it("is keyed from the e2e sign-in password, the same key the e2e database seed uses", async () => {
    vi.stubEnv("NEXT_PUBLIC_E2E_BUILD", "1");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const auth = await getAuth({
      AUTH_E2E_FAKE: "1",
      AUTH_E2E_PASSWORD: "synthetic-e2e-only",
      AUTH_E2E_STATE_DIR: "/tmp/e2e-state-not-used-in-this-test",
      OWNER_EMAIL_ALLOWLIST: OWNER,
    });
    await auth.setup.markComplete(OWNER);
    expect(await stored()).toEqual([emailDigest(OWNER, setupDigestKey("synthetic-e2e-only"))]);
  });
});
