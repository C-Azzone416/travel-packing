import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function loadConfig() {
  vi.resetModules();
  return (await import("../next.config")).default;
}

describe("next.config e2e alias", () => {
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
