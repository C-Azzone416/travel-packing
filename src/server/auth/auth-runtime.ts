// Runtime wiring: picks the provider from environment configuration. Fails closed: if configuration is
// missing or invalid, the app is "unavailable" (nobody can sign in, every request is unauthenticated).

import { logWarning } from "@/server/redact";
import { parseAllowlist, type Allowlist } from "./allowlist";
import { loadAuthConfig } from "./config";
import { createNeonAuthProvider } from "./neon-adapter";
import { logAuthEvent } from "./safe-log";
import type { AuthProvider } from "./types";

export interface RuntimeAuth {
  provider: AuthProvider;
  allowlist: Allowlist;
  /** False when configuration is missing/invalid and everything is denied. */
  available: boolean;
}

const unavailableProvider: AuthProvider = {
  async getSession() {
    return null;
  },
  async signInWithPassword() {
    return { ok: false };
  },
  async signOut() {},
};

export function unavailableAuth(): RuntimeAuth {
  return { provider: unavailableProvider, allowlist: new Set(), available: false };
}

/**
 * The e2e-only fake sign-in. Three independent locks, all required:
 *  1. COMPILE TIME: next.config.ts aliases `@/server/auth/e2e-provider` to a disabled stub unless the build sets
 *     NEXT_PUBLIC_E2E_BUILD=1. In every other build (all deployed builds) the real provider is not in the
 *     bundle at all. CI greps the production build for it (see .github/workflows/ci.yml) so this is checked,
 *     not assumed. (The import must use the exact aliased specifier below.)
 *  2. RUNTIME OPT-IN: AUTH_E2E_FAKE=1 and AUTH_E2E_PASSWORD must be set.
 *  3. NEVER ON VERCEL: refused whenever Vercel's own `VERCEL` variable is present (production and preview).
 */
async function buildE2eAuth(env: Record<string, string | undefined>): Promise<RuntimeAuth | null> {
  if (process.env.NEXT_PUBLIC_E2E_BUILD === "1") {
    const { createE2eAuthProvider, e2eAuthEnabled } = await import("@/server/auth/e2e-provider");
    if (e2eAuthEnabled(env)) {
      logWarning("auth: e2e fake sign-in enabled (e2e builds only; never on Vercel)");
      return {
        provider: createE2eAuthProvider(env),
        allowlist: parseAllowlist(env.OWNER_EMAIL_ALLOWLIST),
        available: true,
      };
    }
  }
  return null;
}

async function buildAuth(env: Record<string, string | undefined>): Promise<RuntimeAuth> {
  const e2e = await buildE2eAuth(env);
  if (e2e) return e2e;
  const loaded = loadAuthConfig(env);
  if (!loaded.ok) {
    // Names of missing settings only; never values.
    logWarning(`auth unavailable: ${loaded.problems.join("; ")}`);
    return unavailableAuth();
  }
  const { baseUrl, cookieSecret, allowlist } = loaded.config;
  try {
    // Loaded lazily so unit tests and builds without configuration never touch the SDK.
    const { createNeonAuth } = await import("@neondatabase/auth/next/server");
    const neon = createNeonAuth({ baseUrl, cookies: { secret: cookieSecret } });
    return { provider: createNeonAuthProvider(neon), allowlist, available: true };
  } catch {
    logAuthEvent("provider-error");
    return unavailableAuth();
  }
}

let cached: Promise<RuntimeAuth> | undefined;

/** The process-wide auth runtime (built once from process.env). */
export function getAuth(
  env: Record<string, string | undefined> = process.env,
): Promise<RuntimeAuth> {
  cached ??= buildAuth(env);
  return cached;
}

/** Test hook: forget the cached runtime. */
export function resetAuthRuntime(): void {
  cached = undefined;
}
