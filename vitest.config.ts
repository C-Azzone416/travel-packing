import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // The real package throws outside React Server Components; in unit tests it is a no-op.
      "server-only": fileURLToPath(new URL("./src/test/server-only.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    // Threads use about 19% less CPU than the default forks here (same tests, same coverage); CI minutes are billed.
    pool: "threads",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["./src/test/setup.ts"],
    // PGlite (in-memory Postgres) starts in a beforeAll and can take several seconds when the machine is busy,
    // for example several full test runs at once. Generous timeouts avoid flaky starts; they never mask a hang
    // because every test is still bounded.
    hookTimeout: 60_000,
    testTimeout: 30_000,
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        // Tests themselves are not product code.
        "src/**/*.test.{ts,tsx}",
        // Shared test setup, not product code.
        "src/test/**",
        // Type-only declaration files have no runtime statements to cover.
        "src/**/*.d.ts",
        // Test doubles (e.g. the calculator stand-in); used only by tests, never shipped.
        "src/**/__fixtures__/**",
        // Next.js root layout is framework wiring (html/body shell, metadata); exercised by e2e + build.
        "src/app/layout.tsx",
      ],
      reporter: ["text", "lcov"],
      thresholds: { lines: 90, branches: 90, functions: 90, statements: 90 },
    },
  },
});
