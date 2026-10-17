import { beforeEach, describe, expect, it, vi } from "vitest";

const createAppDb = vi.fn(() => ({ fake: "db" }));
vi.mock("../db/neon", () => ({
  createAppDb: (...args: unknown[]) => createAppDb(...(args as [])),
}));
const auth = { provider: {}, allowlist: new Set<string>(), available: true };
vi.mock("../auth/auth-runtime", () => ({ getAuth: async () => auth }));

import { curatedResolver } from "../locations/resolver";
import { getDataContext, resetDataRuntime } from "./runtime";

beforeEach(() => {
  resetDataRuntime();
  createAppDb.mockClear();
});

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
