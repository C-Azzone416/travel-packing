import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function loadModule() {
  vi.resetModules();
  return import("../next.config");
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
  const { default: config } = await loadModule();
  const api = fakeWebpack();
  const result = (config.webpack as unknown as WebpackFn)(
    { plugins: existing },
    { webpack: api.webpack },
  );
  return { result, ...api };
};

const MODULES = [
  [
    "the e2e fake sign-in",
    "@/server/auth/e2e-provider",
    "./src/server/auth/e2e-provider.disabled.ts",
  ],
  ["the e2e Postgres driver", "@/server/db/e2e-driver", "./src/server/db/e2e-driver.disabled.ts"],
] as const;

describe("next.config: test-only modules are compiled in only for e2e builds", () => {
  it("covers exactly the known e2e-only modules", async () => {
    const { E2E_ONLY_MODULES } = await loadModule();
    expect(E2E_ONLY_MODULES.map(({ specifier, stub }) => [specifier, stub])).toEqual(
      MODULES.map(([, specifier, stub]) => [specifier, stub]),
    );
  });

  describe("Turbopack", () => {
    it("routes every e2e-only module to its disabled stub in a build without the e2e flag", async () => {
      vi.stubEnv("NEXT_PUBLIC_E2E_BUILD", "");
      const { default: config } = await loadModule();
      expect(config.turbopack?.resolveAlias).toEqual(
        Object.fromEntries(MODULES.map(([, specifier, stub]) => [specifier, stub])),
      );
    });

    it.each(["0", "true", "yes", "2"])(
      "only the exact value 1 compiles the real modules in (got %s)",
      async (value) => {
        vi.stubEnv("NEXT_PUBLIC_E2E_BUILD", value);
        const { default: config } = await loadModule();
        for (const [, specifier] of MODULES) {
          expect(config.turbopack?.resolveAlias).toHaveProperty(specifier);
        }
      },
    );

    it("compiles the real modules in only when the e2e flag is exactly 1", async () => {
      vi.stubEnv("NEXT_PUBLIC_E2E_BUILD", "1");
      const { default: config } = await loadModule();
      expect(config.turbopack?.resolveAlias).toEqual({});
    });
  });

  describe("webpack (next build --webpack)", () => {
    it("registers one replacement per module, each rewriting to that module's disabled stub", async () => {
      vi.stubEnv("NEXT_PUBLIC_E2E_BUILD", "");
      const { result, registered } = await runWebpack(["existing-plugin"]);
      expect(registered).toHaveLength(MODULES.length);
      expect(result.plugins).toHaveLength(MODULES.length + 1);
      expect(result.plugins?.[0]).toBe("existing-plugin");
      for (const [index, [, specifier, stub]] of MODULES.entries()) {
        const resource = { request: specifier };
        expect(registered[index].pattern.test(specifier)).toBe(true);
        registered[index].replace(resource);
        expect(resource.request).toBe(resolve(stub));
      }
    });

    it("each pattern matches its own specifier exactly and nothing else", async () => {
      vi.stubEnv("NEXT_PUBLIC_E2E_BUILD", "");
      const { registered } = await runWebpack();
      for (const [index, [, specifier]] of MODULES.entries()) {
        const { pattern } = registered[index];
        expect(pattern.test(specifier)).toBe(true);
        for (const other of [
          `${specifier}.disabled`,
          `${specifier}-extra`,
          `x${specifier}`,
          "./e2e-provider",
          "@/server/auth/auth-runtime",
          ...MODULES.map(([, otherSpecifier]) => otherSpecifier).filter((s) => s !== specifier),
        ]) {
          expect(pattern.test(other)).toBe(false);
        }
      }
    });

    it("starts from no plugins when the config has none", async () => {
      vi.stubEnv("NEXT_PUBLIC_E2E_BUILD", "");
      const { default: config } = await loadModule();
      const api = fakeWebpack();
      const result = (config.webpack as unknown as WebpackFn)({}, { webpack: api.webpack });
      expect(result.plugins).toHaveLength(MODULES.length);
    });

    it("registers nothing in an e2e build", async () => {
      vi.stubEnv("NEXT_PUBLIC_E2E_BUILD", "1");
      const { result, registered } = await runWebpack(["existing-plugin"]);
      expect(registered).toEqual([]);
      expect(result.plugins).toEqual(["existing-plugin"]);
    });
  });
});

const CAPTURE = "@/features/feedback/screenshot-capture";
const CAPTURE_STUB = "./src/features/feedback/screenshot-capture.disabled.ts";

describe("next.config: screenshot capture is compiled in only when screenshots are switched on (#130)", () => {
  it("lists exactly the capture module and its stub", async () => {
    const { SCREENSHOT_ONLY_MODULES } = await loadModule();
    expect(SCREENSHOT_ONLY_MODULES).toEqual([{ specifier: CAPTURE, stub: CAPTURE_STUB }]);
  });

  it.each([
    ["a local or preview build", {}],
    ["a preview deploy", { VERCEL_ENV: "preview" }],
  ])("keeps the real capture in %s", async (_name, given) => {
    const env: Record<string, string | undefined> = given;
    vi.stubEnv("NEXT_PUBLIC_E2E_BUILD", "1");
    vi.stubEnv("VERCEL_ENV", env.VERCEL_ENV ?? "");
    const { default: config } = await loadModule();
    expect(config.turbopack?.resolveAlias).toEqual({});
    const { registered } = await runWebpack();
    expect(registered).toEqual([]);
  });

  it.each([
    ["production", { VERCEL_ENV: "production" }],
    ["the off switch", { FEEDBACK_SCREENSHOTS: "0" }],
    ["production with the switch on", { VERCEL_ENV: "production", FEEDBACK_SCREENSHOTS: "1" }],
  ])(
    "stubs the capture for %s, with Turbopack and with webpack, even in an e2e build",
    async (_name, given) => {
      const env: Record<string, string | undefined> = given;
      vi.stubEnv("NEXT_PUBLIC_E2E_BUILD", "1");
      vi.stubEnv("VERCEL_ENV", env.VERCEL_ENV ?? "");
      vi.stubEnv("FEEDBACK_SCREENSHOTS", env.FEEDBACK_SCREENSHOTS ?? "");
      const { default: config } = await loadModule();
      expect(config.turbopack?.resolveAlias).toEqual({ [CAPTURE]: CAPTURE_STUB });
      const { registered } = await runWebpack();
      expect(registered).toHaveLength(1);
      const resource = { request: CAPTURE };
      expect(registered[0].pattern.test(CAPTURE)).toBe(true);
      expect(registered[0].pattern.test(`${CAPTURE}.disabled`)).toBe(false);
      registered[0].replace(resource);
      expect(resource.request).toBe(resolve(CAPTURE_STUB));
    },
  );

  it("stubs both the e2e-only modules and the capture in a production build that is not an e2e build", async () => {
    vi.stubEnv("NEXT_PUBLIC_E2E_BUILD", "");
    vi.stubEnv("VERCEL_ENV", "production");
    const { default: config } = await loadModule();
    expect(config.turbopack?.resolveAlias).toEqual({
      ...Object.fromEntries(MODULES.map(([, specifier, stub]) => [specifier, stub])),
      [CAPTURE]: CAPTURE_STUB,
    });
  });
});
