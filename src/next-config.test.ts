import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function loadConfig() {
  vi.resetModules();
  return (await import("../next.config")).default;
}

/** A stand-in for webpack's API that records the plugins the config registers. */
function fakeWebpack() {
  const registered: { pattern: RegExp; replace: (resource: { request: string }) => void }[] = [];
  class NormalModuleReplacementPlugin {
    constructor(
      readonly pattern: RegExp,
      readonly replace: (resource: { request: string }) => void,
    ) {
      registered.push({ pattern, replace });
    }
  }
  return { webpack: { NormalModuleReplacementPlugin }, registered };
}

type WebpackFn = (config: { plugins?: unknown[] }, options: unknown) => { plugins?: unknown[] };
const runWebpack = async (existing: unknown[] = []) => {
  const config = await loadConfig();
  const api = fakeWebpack();
  const result = (config.webpack as unknown as WebpackFn)(
    { plugins: existing },
    { webpack: api.webpack },
  );
  return { result, ...api };
};

describe("next.config: the e2e-only sign-in is compiled in only for e2e builds", () => {
  describe("Turbopack", () => {
    it("routes the e2e provider to the disabled stub in every build without the e2e flag", async () => {
      vi.stubEnv("NEXT_PUBLIC_E2E_BUILD", "");
      expect((await loadConfig()).turbopack?.resolveAlias).toEqual({
        "@/server/auth/e2e-provider": "./src/server/auth/e2e-provider.disabled.ts",
      });
    });

    it.each(["0", "true", "yes", "2"])(
      "only the exact value 1 compiles the real provider in (got %s)",
      async (value) => {
        vi.stubEnv("NEXT_PUBLIC_E2E_BUILD", value);
        expect((await loadConfig()).turbopack?.resolveAlias).toHaveProperty(
          "@/server/auth/e2e-provider",
        );
      },
    );

    it("compiles the real provider in only when the e2e flag is exactly 1", async () => {
      vi.stubEnv("NEXT_PUBLIC_E2E_BUILD", "1");
      expect((await loadConfig()).turbopack?.resolveAlias).toEqual({});
    });
  });

  describe("webpack (next build --webpack)", () => {
    it("registers a replacement that rewrites the provider import to the disabled stub", async () => {
      vi.stubEnv("NEXT_PUBLIC_E2E_BUILD", "");
      const { result, registered } = await runWebpack(["existing-plugin"]);
      expect(registered).toHaveLength(1);
      expect(result.plugins).toHaveLength(2);
      expect(result.plugins?.[0]).toBe("existing-plugin");
      const resource = { request: "@/server/auth/e2e-provider" };
      registered[0].replace(resource);
      expect(resource.request).toBe(resolve("./src/server/auth/e2e-provider.disabled.ts"));
    });

    it("matches that exact specifier only", async () => {
      vi.stubEnv("NEXT_PUBLIC_E2E_BUILD", "");
      const { registered } = await runWebpack();
      const { pattern } = registered[0];
      expect(pattern.test("@/server/auth/e2e-provider")).toBe(true);
      for (const other of [
        "@/server/auth/e2e-provider.disabled",
        "@/server/auth/e2e-provider-extra",
        "./e2e-provider",
        "@/server/auth/auth-runtime",
        "x@/server/auth/e2e-provider",
      ]) {
        expect(pattern.test(other)).toBe(false);
      }
    });

    it("starts from no plugins when the config has none", async () => {
      vi.stubEnv("NEXT_PUBLIC_E2E_BUILD", "");
      const config = await loadConfig();
      const api = fakeWebpack();
      const result = (config.webpack as unknown as WebpackFn)({}, { webpack: api.webpack });
      expect(result.plugins).toHaveLength(1);
    });

    it("registers nothing in an e2e build", async () => {
      vi.stubEnv("NEXT_PUBLIC_E2E_BUILD", "1");
      const { result, registered } = await runWebpack(["existing-plugin"]);
      expect(registered).toEqual([]);
      expect(result.plugins).toEqual(["existing-plugin"]);
    });
  });
});
