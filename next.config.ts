import { resolve } from "node:path";
import type { NextConfig } from "next";

// The e2e-only fake sign-in (src/server/auth/e2e-provider.ts) is compiled in ONLY when this build sets
// NEXT_PUBLIC_E2E_BUILD=1 (Playwright's webServer does; no deployed build does). In every other build the import
// resolves to a stub that can never enable anything, so the real provider is absent from the bundle. This is
// enforced for both bundlers (Turbopack, the default, and webpack via `next build --webpack`); CI checks both.
const e2eBuild = process.env.NEXT_PUBLIC_E2E_BUILD === "1";

export const E2E_PROVIDER_SPECIFIER = "@/server/auth/e2e-provider";
const DISABLED_STUB = "./src/server/auth/e2e-provider.disabled.ts";

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

const nextConfig: NextConfig = {
  turbopack: {
    resolveAlias: e2eBuild ? {} : { [E2E_PROVIDER_SPECIFIER]: DISABLED_STUB },
  },
  webpack(config: WebpackConfig, { webpack }: { webpack: WebpackApi }) {
    if (!e2eBuild) {
      // Rewrites the request before any resolution (so it also beats tsconfig `paths`). Exact match only.
      config.plugins = [
        ...(config.plugins ?? []),
        new webpack.NormalModuleReplacementPlugin(/^@\/server\/auth\/e2e-provider$/, (resource) => {
          resource.request = resolve(DISABLED_STUB);
        }),
      ];
    }
    return config;
  },
};

export default nextConfig;
