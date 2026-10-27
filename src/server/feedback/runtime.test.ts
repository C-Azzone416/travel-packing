import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeAuth } from "@/server/auth/__fixtures__/fake-auth";
import { parseAllowlist } from "@/server/auth/allowlist";
import { createMigratedDb } from "../db/__fixtures__/db";
import type { Db } from "../db/retention";

const auth = createFakeAuth([{ email: "owner@example.test", password: "pw", userId: "owner_1" }]);
let database: unknown = null;

vi.mock("@/server/auth/auth-runtime", () => ({
  getAuth: async () => ({ provider: auth, allowlist: parseAllowlist("owner@example.test") }),
}));
vi.mock("@/server/db/app-db", () => ({ getAppDb: async () => database }));

beforeEach(async () => {
  vi.stubEnv("VERCEL_ENV", "preview");
  vi.stubEnv("FRAMEBRIAR_CREDENTIAL_KEYS", "");
  auth.current = null;
  database = null;
  vi.resetModules();
});

const status = () =>
  new Request("https://travel-packing-preview.vercel.app/api/feedback/enrollment");

describe("the real wiring", () => {
  it("answers 503 UNAVAILABLE when the database is not configured", async () => {
    const { feedbackRoutes } = await import("./runtime");
    await auth.signInWithPassword("owner@example.test", "pw");
    const response = await feedbackRoutes.status(status());
    expect(response.status).toBe(503);
  });

  it("serves status from the real database, and the key ring comes from the environment", async () => {
    const { db } = await createMigratedDb();
    database = db as unknown as Db;
    const { feedbackRoutes } = await import("./runtime");
    await auth.signInWithPassword("owner@example.test", "pw");
    const body = (await (await feedbackRoutes.status(status())).json()) as Record<string, unknown>;
    expect(body).toMatchObject({ v: 1, status: "unavailable", redemption: "none" });
    // The same service instance is reused.
    expect((await feedbackRoutes.status(status())).status).toBe(200);
  });

  it("is signed-out safe", async () => {
    const { feedbackRoutes } = await import("./runtime");
    expect((await feedbackRoutes.status(status())).status).toBe(401);
  });
});

describe("the Production stub", () => {
  it("answers 404 to everything and imports nothing", async () => {
    const { feedbackRoutes } = await import("./runtime.disabled");
    for (const handler of Object.values(feedbackRoutes)) {
      const response = await handler();
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ v: 1, error: "NOT_FOUND" });
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
  });
});

describe("the route files", () => {
  it("export exactly the methods the contract names", async () => {
    const enrollment = await import("@/app/api/feedback/enrollment/route");
    const redeem = await import("@/app/api/feedback/enrollment/redeem/route");
    const disconnect = await import("@/app/api/feedback/enrollment/disconnect/route");
    const reports = await import("@/app/api/feedback/reports/route");
    expect(typeof enrollment.GET).toBe("function");
    expect(typeof redeem.POST).toBe("function");
    expect(typeof disconnect.POST).toBe("function");
    expect(typeof reports.POST).toBe("function");
    expect(reports.maxDuration).toBe(30);
    for (const route of [enrollment, redeem, disconnect, reports]) {
      expect(route.dynamic).toBe("force-dynamic");
      expect(
        Object.keys(route).filter((name) => ["PUT", "PATCH", "DELETE"].includes(name)),
      ).toEqual([]);
    }
  });
});
