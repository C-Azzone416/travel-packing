import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getAuth, resetAuthRuntime, unavailableAuth } from "./auth-runtime";
import { setAuthLogSink } from "./safe-log";

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
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
  logged = [];
  setAuthLogSink((line) => logged.push(line));
});

afterEach(() => {
  setAuthLogSink();
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
      getSession: async () => ({ data: { user: { id: "u1", email: "owner@example.test" } } }),
      signIn: { email: async () => ({ data: null, error: { message: "x" } }) },
      signOut: async () => {},
    });
    const auth = await getAuth(env);
    expect(createNeonAuth).toHaveBeenCalledWith({
      baseUrl: "https://auth.example.test",
      cookies: { secret: SECRET },
    });
    expect(auth.available).toBe(true);
    expect([...auth.allowlist]).toEqual(["owner@example.test"]);
    expect(await auth.provider.getSession()).toEqual({ userId: "u1", email: "owner@example.test" });
  });

  it("fails closed if the SDK cannot be constructed", async () => {
    createNeonAuth.mockImplementation(() => {
      throw new Error(`bad config ${SECRET}`);
    });
    const auth = await getAuth(env);
    expect(auth.available).toBe(false);
    expect(logged).toEqual([JSON.stringify({ scope: "auth", event: "provider-error" })]);
    expect(logged.join("")).not.toContain(SECRET);
  });

  it("builds once per process until reset", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const first = getAuth({});
    expect(getAuth(env)).toBe(first);
    resetAuthRuntime();
    expect(getAuth({})).not.toBe(first);
  });

  describe("e2e fake sign-in", () => {
    const e2eEnv = {
      AUTH_E2E_FAKE: "1",
      AUTH_E2E_PASSWORD: "synthetic-e2e-only",
      OWNER_EMAIL_ALLOWLIST: "owner@example.test",
    };

    it("is used when explicitly enabled outside Vercel, with the allowlist still applied", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const auth = await getAuth(e2eEnv);
      expect(auth.available).toBe(true);
      expect([...auth.allowlist]).toEqual(["owner@example.test"]);
      expect(createNeonAuth).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("e2e fake sign-in enabled"));
      expect(await auth.provider.getSession()).toBeNull();
    });

    it.each([
      ["production", { VERCEL: "1", VERCEL_ENV: "production" }],
      ["preview", { VERCEL: "1", VERCEL_ENV: "preview" }],
    ])("is ignored on a Vercel %s deployment: auth stays unavailable", async (_name, vercel) => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const auth = await getAuth({ ...e2eEnv, ...vercel });
      expect(auth.available).toBe(false);
      expect(
        await auth.provider.signInWithPassword("owner@example.test", "synthetic-e2e-only"),
      ).toEqual({ ok: false });
    });
  });
});
