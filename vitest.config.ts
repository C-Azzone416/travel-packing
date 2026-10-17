import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        // Tests themselves are not product code.
        "src/**/*.test.{ts,tsx}",
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
