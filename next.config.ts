import { resolve } from "node:path";
import type { NextConfig } from "next";
import { securityHeaders } from "./src/security/headers";
import { screenshotsEnabled } from "./src/tooling/feedback-screenshots";

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

// Screenshot capture is compiled in ONLY when screenshots are switched on (#130): Preview deploys, local development and
// e2e builds. In a Production build (VERCEL_ENV=production) or with FEEDBACK_SCREENSHOTS=0 this import resolves to a stub,
// so the capture code is absent from the bundle; CI builds production-mode with both bundlers and fails if it is present
// (scripts/check-no-capture-in-build.ts). Feedback itself (notes and context codes) is not behind this switch.
export const SCREENSHOT_ONLY_MODULES: readonly { specifier: string; stub: string }[] = [
  {
    specifier: "@/features/feedback/screenshot-capture",
    stub: "./src/features/feedback/screenshot-capture.disabled.ts",
  },
];

/** Every import this build replaces with a stub: the e2e-only modules unless this is an e2e build, the capture unless enabled. */
const stubbedModules = [
  ...(e2eBuild ? [] : E2E_ONLY_MODULES),
  ...(screenshotsEnabled() ? [] : SCREENSHOT_ONLY_MODULES),
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
  // Security headers on every route (#22). `next dev` is the only development run; builds are production.
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders(process.env.NODE_ENV === "development") },
    ];
  },
  turbopack: {
    resolveAlias: Object.fromEntries(
      stubbedModules.map(({ specifier, stub }) => [specifier, stub]),
    ),
  },
  webpack(config: WebpackConfig, { webpack }: { webpack: WebpackApi }) {
    if (stubbedModules.length > 0) {
      // Rewrites each request before any resolution (so it also beats tsconfig `paths`). Exact matches only.
      config.plugins = [
        ...(config.plugins ?? []),
        ...stubbedModules.map(
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
