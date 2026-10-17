import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getAuth, resetAuthRuntime, unavailableAuth } from "./auth-runtime";
import { setAuthLogSink } from "./safe-log";

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
});
