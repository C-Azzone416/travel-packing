// Runtime wiring: picks the provider from environment configuration. Fails closed: if configuration is
// missing or invalid, the app is "unavailable" (nobody can sign in, every request is unauthenticated).

import "server-only";
import { getAppDb } from "@/server/db/app-db";
import { logWarning } from "@/server/redact";
import { parseAllowlist, type Allowlist } from "./allowlist";
import { loadAuthConfig } from "./config";
import {
  NOTHING_SET_UP,
  createDbSetupStore,
  setupDigestKey,
  withSetupGate,
  type AccountSetupStore,
} from "./account-setup";
import { createNeonAuthProvider } from "./neon-adapter";
import { NO_SEALS, createSetupSeals, sealKey, type SetupSeals } from "./setup-seal";
import { allowlistFingerprint, malformedEntries } from "./allowlist-fingerprint";
import { logAllowlistLoaded, logAuthEvent } from "./safe-log";
import type { AuthProvider } from "./types";

export interface RuntimeAuth {
  /** Normal app provider, wrapped with the setup/deletion gate. */
  provider: AuthProvider;
  /** Raw provider used only by the fenced account-deletion recovery flow. Never use this for app-data access. */
  deletionProvider: AuthProvider;
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
  async revokeOtherSessions() {
    return { ok: false, reason: "unavailable" };
  },
  async deleteUser() {
    return { ok: false, reason: "unavailable" };
  },
  async isAccountDeletionBlocked() {
    return true;
  },
};

export function unavailableAuth(): RuntimeAuth {
  return {
    provider: unavailableProvider,
    deletionProvider: unavailableProvider,
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
      const deletionProvider = createE2eAuthProvider(env);
      return {
        provider: withSetupGate(deletionProvider, setup, parseAllowlist(env.OWNER_EMAIL_ALLOWLIST)),
        deletionProvider,
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

/**
 * Where "has this account been set up?" is recorded: the app database (records are keyed with a key derived from the
 * secret in use, so they cannot be tested against known addresses), or an injected store (tests). Null when there is none.
 */
async function openSetupStores(
  env: Record<string, string | undefined>,
  deps: AuthRuntimeDeps,
): Promise<((secret: string) => AccountSetupStore) | null> {
  if (deps.setupStore) {
    const injected = deps.setupStore;
    return () => injected;
  }
  const db = await getAppDb(env);
  return db ? (secret) => createDbSetupStore(db, setupDigestKey(secret)) : null;
}

async function buildAuth(
  env: Record<string, string | undefined>,
  deps: AuthRuntimeDeps,
): Promise<RuntimeAuth> {
  const storeFor = await openSetupStores(env, deps);
  const e2e = storeFor ? await buildE2eAuth(env, storeFor(env.AUTH_E2E_PASSWORD ?? "")) : null;
  if (e2e) return e2e;
  const loaded = loadAuthConfig(env);
  if (!loaded.ok) {
    // Names of missing settings only; never values.
    logWarning(`auth unavailable: ${loaded.problems.join("; ")}`);
    return unavailableAuth();
  }
  // Without the database nobody can be known to have finished setting up, so nobody can sign in (the app has no data
  // without it either): fail closed and say so, by name only.
  if (!storeFor) {
    logWarning("auth unavailable: DATABASE_URL is not set");
    return unavailableAuth();
  }
  const { baseUrl, cookieSecret, allowlist } = loaded.config;
  // Once per start: how many addresses this deployment's allowlist holds and its keyed fingerprint (never an address), so
  // the copy the app runs with can be compared with the deploy's copy (docs/deploy.md).
  logAllowlistLoaded(
    allowlist.size,
    allowlistFingerprint(allowlist, cookieSecret),
    malformedEntries(allowlist),
  );
  const setup = storeFor(cookieSecret);
  try {
    // Loaded lazily so unit tests and builds without configuration never touch the SDK.
    const { createNeonAuth } = await import("@neondatabase/auth/next/server");
    const neon = createNeonAuth({ baseUrl, cookies: { secret: cookieSecret } });
    const deletionProvider = createNeonAuthProvider(neon);
    return {
      provider: withSetupGate(deletionProvider, setup, allowlist),
      deletionProvider,
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
