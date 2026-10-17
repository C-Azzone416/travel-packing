import type { NextConfig } from "next";

// The e2e-only fake sign-in (src/server/auth/e2e-provider.ts) is compiled in ONLY when this build sets
// NEXT_PUBLIC_E2E_BUILD=1 (Playwright's webServer does; no deployed build does). In every other build the import
// resolves to a stub that can never enable anything, so the real provider is absent from the bundle. CI checks.
const e2eBuild = process.env.NEXT_PUBLIC_E2E_BUILD === "1";

const nextConfig: NextConfig = {
  turbopack: {
    resolveAlias: e2eBuild
      ? {}
      : { "@/server/auth/e2e-provider": "./src/server/auth/e2e-provider.disabled.ts" },
  },
};

export default nextConfig;
