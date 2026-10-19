// Runtime wiring: picks the provider from environment configuration. Fails closed: if configuration is
// missing or invalid, the app is "unavailable" (nobody can sign in, every request is unauthenticated).

import { getAppDb } from "@/server/db/app-db";
import { logWarning } from "@/server/redact";
import { parseAllowlist, type Allowlist } from "./allowlist";
import { loadAuthConfig } from "./config";
import {
  NOTHING_SET_UP,
  createDbSetupStore,
  withSetupGate,
  type AccountSetupStore,
} from "./account-setup";
import { createNeonAuthProvider } from "./neon-adapter";
import { NO_SEALS, createSetupSeals, sealKey, type SetupSeals } from "./setup-seal";
import { logAuthEvent } from "./safe-log";
import type { AuthProvider } from "./types";

export interface RuntimeAuth {
  provider: AuthProvider;
  allowlist: Allowlist;
  /** False when configuration is missing/invalid and everything is denied. */
  available: boolean;
  /** Which accounts have had their password set through an emailed link (#83). The provider above already enforces it. */
  setup: AccountSetupStore;
  /** Signs and opens the "this link is for <address>" value on reset links. */
  seals: SetupSeals;
}

const unavailableProvider: AuthProvider = {
  async getSession() {
    return null;
  },
  async signInWithPassword() {
    return { ok: false };
  },
  async signUp() {
    return { ok: false, reason: "unavailable" };
  },
  async verifyEmail() {
    return { ok: false, reason: "unavailable" };
  },
  async resendVerificationCode() {
    return { ok: false, reason: "unavailable" };
  },
  async requestPasswordReset() {
    return { ok: false, reason: "unavailable" };
  },
  async resetPassword() {
    return { ok: false, reason: "unavailable" };
  },
  async signOut() {},
};

export function unavailableAuth(): RuntimeAuth {
  return {
    provider: unavailableProvider,
    allowlist: new Set(),
    available: false,
    setup: NOTHING_SET_UP,
    seals: NO_SEALS,
  };
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
async function buildE2eAuth(
  env: Record<string, string | undefined>,
  setup: AccountSetupStore,
): Promise<RuntimeAuth | null> {
  if (process.env.NEXT_PUBLIC_E2E_BUILD === "1") {
    const { createE2eAuthProvider, e2eAuthEnabled } = await import("@/server/auth/e2e-provider");
    if (e2eAuthEnabled(env)) {
      logWarning("auth: e2e fake sign-in enabled (e2e builds only; never on Vercel)");
      return {
        provider: withSetupGate(
          createE2eAuthProvider(env),
          setup,
          parseAllowlist(env.OWNER_EMAIL_ALLOWLIST),
        ),
        allowlist: parseAllowlist(env.OWNER_EMAIL_ALLOWLIST),
        available: true,
        setup,
        // Any non-empty secret signs the e2e links; the fake password is already required to be set.
        seals: createSetupSeals(sealKey(env.AUTH_E2E_PASSWORD ?? "")),
      };
    }
  }
  return null;
}

/** Where "has this account been set up?" lives: the app database, or an injected store (tests). */
export interface AuthRuntimeDeps {
  setupStore?: AccountSetupStore;
}

async function openSetupStore(
  env: Record<string, string | undefined>,
  deps: AuthRuntimeDeps,
): Promise<AccountSetupStore | null> {
  if (deps.setupStore) return deps.setupStore;
  const db = await getAppDb(env);
  return db ? createDbSetupStore(db) : null;
}

async function buildAuth(
  env: Record<string, string | undefined>,
  deps: AuthRuntimeDeps,
): Promise<RuntimeAuth> {
  const setup = await openSetupStore(env, deps);
  const e2e = setup ? await buildE2eAuth(env, setup) : null;
  if (e2e) return e2e;
  const loaded = loadAuthConfig(env);
  if (!loaded.ok) {
    // Names of missing settings only; never values.
    logWarning(`auth unavailable: ${loaded.problems.join("; ")}`);
    return unavailableAuth();
  }
  // Without the database nobody can be known to have finished setting up, so nobody can sign in (the app has no data
  // without it either): fail closed and say so, by name only.
  if (!setup) {
    logWarning("auth unavailable: DATABASE_URL is not set");
    return unavailableAuth();
  }
  const { baseUrl, cookieSecret, allowlist } = loaded.config;
  try {
    // Loaded lazily so unit tests and builds without configuration never touch the SDK.
    const { createNeonAuth } = await import("@neondatabase/auth/next/server");
    const neon = createNeonAuth({ baseUrl, cookies: { secret: cookieSecret } });
    return {
      provider: withSetupGate(createNeonAuthProvider(neon), setup, allowlist),
      allowlist,
      available: true,
      setup,
      seals: createSetupSeals(sealKey(cookieSecret)),
    };
  } catch {
    logAuthEvent("provider-error");
    return unavailableAuth();
  }
}

let cached: Promise<RuntimeAuth> | undefined;

/** The process-wide auth runtime (built once from process.env). */
export function getAuth(
  env: Record<string, string | undefined> = process.env,
  deps: AuthRuntimeDeps = {},
): Promise<RuntimeAuth> {
  cached ??= buildAuth(env, deps);
  return cached;
}

/** Test hook: forget the cached runtime. */
export function resetAuthRuntime(): void {
  cached = undefined;
}
