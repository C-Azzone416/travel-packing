import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createAppDb = vi.fn(() => ({ fake: "db" }));
vi.mock("../db/neon", () => ({
  createAppDb: (...args: unknown[]) => createAppDb(...(args as [])),
}));
const auth = { provider: {}, allowlist: new Set<string>(), available: true };
vi.mock("../auth/auth-runtime", () => ({ getAuth: async () => auth }));

const createE2eDb = vi.fn((url: string) => ({ e2eDbFor: url }));
vi.mock("@/server/db/e2e-driver", () => ({
  e2eDatabaseEnabled: (env: Record<string, string | undefined>) =>
    env.NEXT_PUBLIC_E2E_BUILD === "1" && Boolean(env.E2E_DATABASE_URL?.trim()) && !env.VERCEL,
  createE2eDb: (url: string) => createE2eDb(url),
  createSharedE2eDb: (url: string) => createE2eDb(url),
}));

import { curatedResolver } from "../locations/resolver";
import { getDataContext, resetDataRuntime } from "./runtime";

beforeEach(() => {
  resetDataRuntime();
  createAppDb.mockClear();
  createE2eDb.mockClear();
});
afterEach(() => vi.unstubAllEnvs());

describe("getDataContext", () => {
  it("is null when the database is not configured", async () => {
    expect(await getDataContext({})).toBeNull();
    expect(await getDataContext({ DATABASE_URL: "   " })).toBeNull();
    expect(createAppDb).not.toHaveBeenCalled();
  });

  it("builds the context from the database, the auth runtime, and the real clock", async () => {
    const before = Date.now();
    const context = await getDataContext({ DATABASE_URL: " postgres://example.test/db " });
    expect(context).not.toBeNull();
    expect(createAppDb).toHaveBeenCalledWith("postgres://example.test/db");
    expect(context?.db).toEqual({ fake: "db" });
    expect(context?.auth).toBe(auth);
    expect(context?.now().getTime()).toBeGreaterThanOrEqual(before);
  });

  it("opens one connection per process", async () => {
    await getDataContext({ DATABASE_URL: "postgres://example.test/db" });
    await getDataContext({ DATABASE_URL: "postgres://example.test/db" });
    expect(createAppDb).toHaveBeenCalledTimes(1);
  });

  it("resolves places from the curated list only, unless LOCATION_PROVIDER is exactly open-meteo", async () => {
    const plain = await getDataContext({ DATABASE_URL: "postgres://example.test/db" });
    expect(plain?.resolveLocation).toBe(curatedResolver);
    resetDataRuntime();
    const wrongCase = await getDataContext({
      DATABASE_URL: "postgres://example.test/db",
      LOCATION_PROVIDER: "Open-Meteo",
    });
    expect(wrongCase?.resolveLocation).toBe(curatedResolver);
    resetDataRuntime();
    const on = await getDataContext({
      DATABASE_URL: "postgres://example.test/db",
      LOCATION_PROVIDER: "open-meteo",
    });
    expect(on?.resolveLocation).toBeTypeOf("function");
    expect(on?.resolveLocation).not.toBe(curatedResolver);
  });
});

describe("getDataContext: the e2e database (three locks, as for the fake sign-in)", () => {
  const e2e = { E2E_DATABASE_URL: " postgres://127.0.0.1:5433/postgres " };

  it("lock 1, compile time: without the e2e build flag E2E_DATABASE_URL is ignored", async () => {
    vi.stubEnv("NEXT_PUBLIC_E2E_BUILD", "");
    expect(await getDataContext(e2e)).toBeNull();
    expect(createE2eDb).not.toHaveBeenCalled();
    expect(createAppDb).not.toHaveBeenCalled();
  });

  it("lock 2, opt-in: the build flag alone enables nothing", async () => {
    vi.stubEnv("NEXT_PUBLIC_E2E_BUILD", "1");
    expect(await getDataContext({})).toBeNull();
    expect(createE2eDb).not.toHaveBeenCalled();
  });

  it("lock 3, never on Vercel: ignored there even in an e2e build", async () => {
    vi.stubEnv("NEXT_PUBLIC_E2E_BUILD", "1");
    expect(await getDataContext({ ...e2e, VERCEL: "1" })).toBeNull();
    expect(createE2eDb).not.toHaveBeenCalled();
  });

  it("uses the e2e database only when all three hold, instead of DATABASE_URL", async () => {
    vi.stubEnv("NEXT_PUBLIC_E2E_BUILD", "1");
    const context = await getDataContext({ ...e2e, DATABASE_URL: "postgres://example.test/real" });
    expect(createE2eDb).toHaveBeenCalledWith("postgres://127.0.0.1:5433/postgres");
    expect(createAppDb).not.toHaveBeenCalled();
    expect(context?.db).toEqual({ e2eDbFor: "postgres://127.0.0.1:5433/postgres" });
  });

  it("an e2e build on Vercel falls back to the real database setting", async () => {
    vi.stubEnv("NEXT_PUBLIC_E2E_BUILD", "1");
    await getDataContext({ ...e2e, VERCEL: "1", DATABASE_URL: "postgres://example.test/real" });
    expect(createE2eDb).not.toHaveBeenCalled();
    expect(createAppDb).toHaveBeenCalledWith("postgres://example.test/real");
  });
});
