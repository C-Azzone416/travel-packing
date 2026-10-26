import { resolve } from "node:path";
import type { NextConfig } from "next";
import { securityHeaders } from "./src/security/headers";
import { screenshotsEnabled } from "./src/tooling/feedback-screenshots";

// Test-only modules are compiled in ONLY when the build sets NEXT_PUBLIC_E2E_BUILD=1 (Playwright's webServer does; no
// deployed build does). In every other build each import resolves to a stub that can never enable anything, so the
// real module is absent from the bundle. This holds for both bundlers (Turbopack, the default, and webpack via
// `next build --webpack`); CI builds with each and fails if any marker appears (scripts/check-no-e2e-in-build.ts).
const e2eBuild = process.env.NEXT_PUBLIC_E2E_BUILD === "1";
const hostedBuild = ["preview", "production"].includes(process.env.VERCEL_ENV ?? "");
const feedbackBuild = !hostedBuild && (process.env.NODE_ENV === "development" || e2eBuild);

export const E2E_ONLY_MODULES: readonly { specifier: string; stub: string }[] = [
  // The fake sign-in (#9).
  { specifier: "@/server/auth/e2e-provider", stub: "./src/server/auth/e2e-provider.disabled.ts" },
  // The Postgres driver for the e2e database (#52).
  { specifier: "@/server/db/e2e-driver", stub: "./src/server/db/e2e-driver.disabled.ts" },
];

// Framebriar is local-only for now. A normal or hosted build replaces every app entry point with one inert module, so
// neither the UI nor the SDK's dynamic imports can enter a Preview or Production build. E2e builds keep the real modules
// because Playwright routes every SDK request to its in-process fake service; Vercel is forbidden from carrying the e2e
// flag by the deploy environment gate.
export const FEEDBACK_ONLY_MODULES: readonly { specifier: string; stub: string }[] = [
  {
    specifier: "@/features/feedback/FeedbackAccess",
    stub: "./src/features/feedback/feedback.disabled.tsx",
  },
  {
    specifier: "@/features/feedback/FeedbackButton",
    stub: "./src/features/feedback/feedback.disabled.tsx",
  },
  {
    specifier: "@/features/feedback/FeedbackNotice",
    stub: "./src/features/feedback/feedback.disabled.tsx",
  },
  {
    specifier: "@/features/feedback/FeedbackSettings",
    stub: "./src/features/feedback/feedback.disabled.tsx",
  },
];

// Screenshot capture is compiled in only when screenshots are switched on (#130): local development, e2e and (although
// Framebriar's entry points are now all stubbed there) Preview builds. In a Production build or with
// FEEDBACK_SCREENSHOTS=0 this import also resolves to a stub. The broader FEEDBACK_ONLY_MODULES gate above is what removes
// all feedback UI and SDK code from every hosted build.
export const SCREENSHOT_ONLY_MODULES: readonly { specifier: string; stub: string }[] = [
  {
    specifier: "@/features/feedback/screenshot-capture",
    stub: "./src/features/feedback/screenshot-capture.disabled.ts",
  },
];

/** Every import this build replaces with a stub: the e2e-only modules unless this is an e2e build, the capture unless enabled. */
const stubbedModules = [
  ...(e2eBuild ? [] : E2E_ONLY_MODULES),
  ...(feedbackBuild ? [] : FEEDBACK_ONLY_MODULES),
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
  // The commit this build was made from, so feedback reports name the build (#131). Not a secret; the SDK takes only
  // 7 to 40 hex characters and the app turns anything else into null.
  env: {
    NEXT_PUBLIC_BUILD_SHA: process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GITHUB_SHA ?? "",
  },
  // Security headers on every route (#22). `next dev` is the only development run; builds are production.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders(process.env.NODE_ENV === "development", feedbackBuild),
      },
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
