import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemorySetupStore } from "./account-setup";
import { getAuth, resetAuthRuntime, unavailableAuth } from "./auth-runtime";
import { allowlistFingerprint } from "./allowlist-fingerprint";
import { setAuthLogSink } from "./safe-log";

const runtimeCookieJar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      runtimeCookieJar.has(name) ? { name, value: runtimeCookieJar.get(name) } : undefined,
    set: (name: string, value: string) => void runtimeCookieJar.set(name, value),
    delete: (name: string) => void runtimeCookieJar.delete(name),
  }),
  headers: async () =>
    new Headers({
      cookie: "__Secure-neon-auth.session_token=signed-ambient-cookie",
      origin: "https://app.example.test",
    }),
}));

const createNeonAuth = vi.fn();
vi.mock("@neondatabase/auth/next/server", () => ({
  createNeonAuth: (...args: unknown[]) => createNeonAuth(...args),
}));

const SECRET = "s".repeat(40);
const env = {
  NEON_AUTH_BASE_URL: "https://auth.example.test",
  NEON_AUTH_COOKIE_SECRET: SECRET,
  OWNER_EMAIL_ALLOWLIST: "owner@example.test",
};

let logged: string[];

beforeEach(() => {
  resetAuthRuntime();
  createNeonAuth.mockReset();
  runtimeCookieJar.clear();
  runtimeCookieJar.set("__Secure-neon-auth.session_token", "signed-ambient-cookie");
  logged = [];
  setAuthLogSink((line) => logged.push(line));
});

afterEach(() => {
  setAuthLogSink();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("unavailableAuth", () => {
  it("denies everything", async () => {
    const auth = unavailableAuth();
    expect(auth.available).toBe(false);
    expect(auth.allowlist.size).toBe(0);
    expect(await auth.provider.getSession()).toBeNull();
    expect(await auth.provider.signInWithPassword("a@example.test", "pw")).toEqual({ ok: false });
    await expect(auth.provider.signOut()).resolves.toBeUndefined();
  });

  it("cannot sign up, verify, send a code or link, or reset a password", async () => {
    const { provider } = unavailableAuth();
    const down = { ok: false, reason: "unavailable" };
    expect(await provider.signUp("a@example.test", "a-long-password")).toEqual(down);
    expect(await provider.verifyEmail("a@example.test", "123456")).toEqual(down);
    expect(await provider.resendVerificationCode("a@example.test")).toEqual(down);
    expect(await provider.requestPasswordReset("a@example.test", "https://a.test/r")).toEqual(down);
    expect(await provider.resetPassword("fake-token-one", "a-long-password")).toEqual(down);
  });
});

describe("getAuth", () => {
  it("fails closed when configuration is missing, naming settings but never values", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const auth = await getAuth({ NEON_AUTH_COOKIE_SECRET: "too-short-secret" });
    expect(auth.available).toBe(false);
    expect(createNeonAuth).not.toHaveBeenCalled();
    const message = String(warn.mock.calls[0][0]);
    expect(message).toContain("NEON_AUTH_BASE_URL is not set");
    expect(message).toContain("NEON_AUTH_COOKIE_SECRET is shorter than 32 characters");
    expect(message).not.toContain("too-short-secret");
  });

  it("builds the Neon provider from configuration and the allowlist", async () => {
    createNeonAuth.mockReturnValue({
      getSession: async () => ({
        data: { user: { id: "u1", email: "owner@example.test", emailVerified: true } },
      }),
      signIn: { email: async () => ({ data: null, error: { message: "x" } }) },
      signOut: async () => {},
    });
    const auth = await getAuth(env, { setupStore: createMemorySetupStore(["owner@example.test"]) });
    expect(createNeonAuth).toHaveBeenCalledWith({
      baseUrl: "https://auth.example.test",
      cookies: { secret: SECRET },
    });
    expect(auth.available).toBe(true);
    expect([...auth.allowlist]).toEqual(["owner@example.test"]);
    expect(await auth.provider.getSession()).toEqual({ userId: "u1", email: "owner@example.test" });
  });

  it("wires the fresh signed cookie through begin, revoke and delete at runtime", async () => {
    createNeonAuth.mockReturnValue({
      getSession: async () => ({ data: null, error: null }),
      signIn: {
        email: async () => {
          runtimeCookieJar.set(
            "__Secure-neon-auth.session_token",
            "raw-body-token.synthetic-signature",
          );
          return {
            data: {
              token: "raw-body-token",
              user: {
                id: "synthetic-user",
                email: "owner@example.test",
                emailVerified: true,
                createdAt: new Date(1_600_000_000_000),
              },
            },
            error: null,
          };
        },
      },
      signOut: async () => ({ data: { success: true }, error: null }),
    });
    const fetchMock = vi.fn(async (...args: [string | URL | Request, RequestInit?]) => {
      const [input] = args;
      const path = new URL(input instanceof Request ? input.url : input.toString()).pathname;
      return path.endsWith("/revoke-other-sessions")
        ? Response.json({ status: true })
        : Response.json(
            { success: true, message: "User deleted" },
            {
              headers: {
                "set-cookie":
                  "__Secure-neon-auth.session_token=; Path=/; HttpOnly; Secure; Max-Age=0",
              },
            },
          );
    });
    vi.stubGlobal("fetch", fetchMock);

    const auth = await getAuth(env, {
      setupStore: createMemorySetupStore(["owner@example.test"]),
    });
    const begun = await auth.deletionProvider.beginAccountClosure(
      "owner@example.test",
      "synthetic-password",
    );
    expect(begun.ok).toBe(true);
    if (!begun.ok) throw new Error("synthetic closure sign-in failed");
    await expect(begun.authorization.revokeOtherSessions()).resolves.toEqual({ ok: true });
    await expect(begun.authorization.deleteUser("synthetic-password")).resolves.toEqual({
      ok: true,
    });

    expect(
      fetchMock.mock.calls.map(([, init]) =>
        new Headers((init as RequestInit).headers).get("cookie"),
      ),
    ).toEqual([
      "__Secure-neon-auth.session_token=raw-body-token.synthetic-signature",
      "__Secure-neon-auth.session_token=raw-body-token.synthetic-signature",
    ]);
    expect(runtimeCookieJar.get("__Secure-neon-auth.session_token")).toBe("");
  });

  it("logs the allowlist's size and keyed fingerprint once at start, and never an address", async () => {
    createNeonAuth.mockImplementation(() => ({
      getSession: async () => ({ data: null, error: null }),
    }));
    await getAuth(env, { setupStore: createMemorySetupStore(["owner@example.test"]) });
    const loadedLines = logged.filter((line) => line.includes("allowlist-loaded"));
    expect(loadedLines).toHaveLength(1);
    const parsed = JSON.parse(loadedLines[0]) as Record<string, unknown>;
    expect(parsed).toEqual({
      scope: "auth",
      event: "allowlist-loaded",
      entries: 1,
      malformed: 0,
      fingerprint: allowlistFingerprint(new Set(["owner@example.test"]), SECRET),
    });
    expect(logged.join("")).not.toMatch(/owner@example/);
    await getAuth(env);
    expect(logged.filter((line) => line.includes("allowlist-loaded"))).toHaveLength(1);
  });

  it("fails closed if the SDK cannot be constructed", async () => {
    createNeonAuth.mockImplementation(() => {
      throw new Error(`bad config ${SECRET}`);
    });
    const auth = await getAuth(env, { setupStore: createMemorySetupStore() });
    expect(auth.available).toBe(false);
    // The allowlist is logged as a count and a fingerprint first (never an address), then the failure.
    expect(logged.map((line) => (JSON.parse(line) as { event: string }).event)).toEqual([
      "allowlist-loaded",
      "provider-error",
    ]);
    expect(logged.join("")).not.toContain(SECRET);
    expect(logged.join("")).not.toContain("owner@example.test");
  });

  it("fails closed, by name only, when there is no database to record who has finished setting up", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const auth = await getAuth(env);
    expect(auth.available).toBe(false);
    expect(createNeonAuth).not.toHaveBeenCalled();
    expect(String(warn.mock.calls[0][0])).toContain("auth unavailable: DATABASE_URL is not set");
  });

  it("only gives a session to an account that has been set up through an emailed link", async () => {
    let sessionCreatedAt = 1_000;
    createNeonAuth.mockReturnValue({
      getSession: async () => ({
        data: {
          user: { id: "u1", email: "owner@example.test", emailVerified: true },
          session: { createdAt: new Date(sessionCreatedAt).toISOString() },
        },
      }),
      signIn: { email: async () => ({ data: null, error: { message: "x" } }) },
      signOut: async () => {},
    });
    const setupStore = createMemorySetupStore([], () => 5_000);
    const auth = await getAuth(env, { setupStore });
    expect(await auth.provider.getSession()).toBeNull();
    await auth.setup.markComplete("Owner@Example.test");
    // The provider's session says when it was made (createdAt); one made before the setup is refused, one after is not.
    expect(await auth.provider.getSession()).toBeNull();
    sessionCreatedAt = 6_000;
    expect(await auth.provider.getSession()).toEqual({
      userId: "u1",
      email: "owner@example.test",
      issuedAt: 6_000,
    });
  });

  it("signs and opens the setup-link seals with the cookie secret", async () => {
    createNeonAuth.mockReturnValue({});
    const auth = await getAuth(env, { setupStore: createMemorySetupStore() });
    const sealed = auth.seals.seal("Owner@Example.test");
    expect(auth.seals.open(sealed, ["owner@example.test"])).toBe("owner@example.test");
    expect(unavailableAuth().seals.open(sealed, ["owner@example.test"])).toBeNull();
    expect(unavailableAuth().seals.seal("owner@example.test")).toBe("");
  });

  it("signs identity-free account-closure completion signals with a purpose-derived key", async () => {
    createNeonAuth.mockReturnValue({});
    const auth = await getAuth(env, { setupStore: createMemorySetupStore() });
    const signal = auth.completionSignals.issue();
    expect(auth.completionSignals.open(signal)).toBe(true);
    expect(signal).not.toContain("owner@example.test");
    expect(unavailableAuth().completionSignals.open(signal)).toBe(false);
    expect(unavailableAuth().completionSignals.issue()).toBe("");
  });

  it("builds once per process until reset", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const first = getAuth({});
    expect(getAuth(env)).toBe(first);
    resetAuthRuntime();
    expect(getAuth({})).not.toBe(first);
  });

  describe("e2e fake sign-in (three independent locks)", () => {
    const e2eEnv = {
      AUTH_E2E_FAKE: "1",
      AUTH_E2E_PASSWORD: "synthetic-e2e-only",
      AUTH_E2E_STATE_DIR: "/tmp/e2e-state-not-used-in-this-test",
      OWNER_EMAIL_ALLOWLIST: "owner@example.test",
    };

    afterEach(() => vi.unstubAllEnvs());

    it("lock 1, compile time: without the e2e build flag the opt-in is ignored entirely", async () => {
      vi.stubEnv("NEXT_PUBLIC_E2E_BUILD", "");
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const auth = await getAuth(e2eEnv);
      expect(auth.available).toBe(false);
      expect(
        await auth.provider.signInWithPassword("owner@example.test", "synthetic-e2e-only"),
      ).toEqual({ ok: false });
      expect(createNeonAuth).not.toHaveBeenCalled();
    });

    it("lock 2, runtime opt-in: the build flag alone enables nothing", async () => {
      vi.stubEnv("NEXT_PUBLIC_E2E_BUILD", "1");
      vi.spyOn(console, "warn").mockImplementation(() => {});
      expect((await getAuth({ OWNER_EMAIL_ALLOWLIST: "owner@example.test" })).available).toBe(
        false,
      );
    });

    it("is used only when the build flag, the opt-in, and a non-Vercel runtime all hold; the allowlist still applies", async () => {
      vi.stubEnv("NEXT_PUBLIC_E2E_BUILD", "1");
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const auth = await getAuth(e2eEnv, { setupStore: createMemorySetupStore() });
      expect(auth.available).toBe(true);
      expect([...auth.allowlist]).toEqual(["owner@example.test"]);
      expect(createNeonAuth).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("e2e fake sign-in enabled"));
      expect(await auth.provider.getSession()).toBeNull();
    });

    it.each([
      ["production", { VERCEL: "1", VERCEL_ENV: "production" }],
      ["preview", { VERCEL: "1", VERCEL_ENV: "preview" }],
    ])(
      "lock 3, never on Vercel: ignored on a %s deployment even in an e2e build",
      async (_name, vercel) => {
        vi.stubEnv("NEXT_PUBLIC_E2E_BUILD", "1");
        vi.spyOn(console, "warn").mockImplementation(() => {});
        const auth = await getAuth({ ...e2eEnv, ...vercel });
        expect(auth.available).toBe(false);
        expect(
          await auth.provider.signInWithPassword("owner@example.test", "synthetic-e2e-only"),
        ).toEqual({ ok: false });
      },
    );
  });
});
