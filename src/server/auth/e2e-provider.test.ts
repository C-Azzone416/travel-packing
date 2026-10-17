import { beforeEach, describe, expect, it, vi } from "vitest";

const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name) } : undefined),
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => void jar.delete(name),
  }),
}));

import { createE2eAuthProvider, e2eAuthEnabled, E2E_COOKIE } from "./e2e-provider";

const env = { AUTH_E2E_FAKE: "1", AUTH_E2E_PASSWORD: "synthetic-e2e-only" };

beforeEach(() => jar.clear());

describe("e2eAuthEnabled", () => {
  it("needs the explicit opt-in and a password", () => {
    expect(e2eAuthEnabled(env)).toBe(true);
    expect(e2eAuthEnabled({})).toBe(false);
    expect(e2eAuthEnabled({ AUTH_E2E_FAKE: "0", AUTH_E2E_PASSWORD: "x" })).toBe(false);
    expect(e2eAuthEnabled({ AUTH_E2E_FAKE: "true", AUTH_E2E_PASSWORD: "x" })).toBe(false);
    expect(e2eAuthEnabled({ AUTH_E2E_FAKE: "1" })).toBe(false);
    expect(e2eAuthEnabled({ AUTH_E2E_FAKE: "1", AUTH_E2E_PASSWORD: "" })).toBe(false);
  });

  it.each([
    ["production", { VERCEL: "1", VERCEL_ENV: "production" }],
    ["preview", { VERCEL: "1", VERCEL_ENV: "preview" }],
    ["any Vercel runtime", { VERCEL: "1" }],
  ])("is never enabled on a Vercel %s deployment", (_name, vercel) => {
    expect(e2eAuthEnabled({ ...env, ...vercel })).toBe(false);
  });
});

describe("createE2eAuthProvider", () => {
  const provider = createE2eAuthProvider(env);

  it("starts signed out", async () => {
    expect(await provider.getSession()).toBeNull();
  });

  it("signs in with the shared synthetic password and keeps the session in an httpOnly cookie", async () => {
    expect(await provider.signInWithPassword("owner@example.test", env.AUTH_E2E_PASSWORD)).toEqual({
      ok: true,
      session: { userId: "e2e-owner@example.test", email: "owner@example.test" },
    });
    expect(jar.get(E2E_COOKIE)).toBe("owner@example.test");
    expect(await provider.getSession()).toEqual({
      userId: "e2e-owner@example.test",
      email: "owner@example.test",
    });
  });

  it("rejects a wrong password and leaves no session", async () => {
    expect(await provider.signInWithPassword("owner@example.test", "nope")).toEqual({ ok: false });
    expect(jar.size).toBe(0);
  });

  it("rejects everything when no password is configured", async () => {
    expect(await createE2eAuthProvider({}).signInWithPassword("owner@example.test", "")).toEqual({
      ok: false,
    });
  });

  it("signs out by deleting the cookie", async () => {
    await provider.signInWithPassword("owner@example.test", env.AUTH_E2E_PASSWORD);
    await provider.signOut();
    expect(await provider.getSession()).toBeNull();
  });
});
