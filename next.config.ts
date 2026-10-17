import { resolve } from "node:path";
import type { NextConfig } from "next";

// Test-only modules are compiled in ONLY when the build sets NEXT_PUBLIC_E2E_BUILD=1 (Playwright's webServer does; no
// deployed build does). In every other build each import resolves to a stub that can never enable anything, so the
// real module is absent from the bundle. This holds for both bundlers (Turbopack, the default, and webpack via
// `next build --webpack`); CI builds with each and fails if any marker appears (scripts/check-no-e2e-in-build.ts).
const e2eBuild = process.env.NEXT_PUBLIC_E2E_BUILD === "1";

export const E2E_ONLY_MODULES: readonly { specifier: string; stub: string }[] = [
  // The fake sign-in (#9).
  { specifier: "@/server/auth/e2e-provider", stub: "./src/server/auth/e2e-provider.disabled.ts" },
  // The Postgres driver for the e2e database (#52).
  { specifier: "@/server/db/e2e-driver", stub: "./src/server/db/e2e-driver.disabled.ts" },
];

// The slice of webpack's config and API this file uses (Next does not export these types).
interface WebpackConfig {
  plugins?: unknown[];
}
interface WebpackApi {
  NormalModuleReplacementPlugin: new (
    pattern: RegExp,
    replace: (resource: { request: string }) => void,
  ) => unknown;
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

const nextConfig: NextConfig = {
  turbopack: {
    resolveAlias: e2eBuild
      ? {}
      : Object.fromEntries(E2E_ONLY_MODULES.map(({ specifier, stub }) => [specifier, stub])),
  },
  webpack(config: WebpackConfig, { webpack }: { webpack: WebpackApi }) {
    if (!e2eBuild) {
      // Rewrites each request before any resolution (so it also beats tsconfig `paths`). Exact matches only.
      config.plugins = [
        ...(config.plugins ?? []),
        ...E2E_ONLY_MODULES.map(
          ({ specifier, stub }) =>
            new webpack.NormalModuleReplacementPlugin(
              new RegExp(`^${escapeRegExp(specifier)}$`),
              (resource) => {
                resource.request = resolve(stub);
              },
            ),
        ),
      ];
    }
    return config;
  },
};

export default nextConfig;
