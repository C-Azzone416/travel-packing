// Runtime wiring: picks the provider from environment configuration. Fails closed: if configuration is
// missing or invalid, the app is "unavailable" (nobody can sign in, every request is unauthenticated).

import type { Allowlist } from "./allowlist";
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

async function buildAuth(env: Record<string, string | undefined>): Promise<RuntimeAuth> {
  const loaded = loadAuthConfig(env);
  if (!loaded.ok) {
    // Names of missing settings only; never values.
    console.warn(`auth unavailable: ${loaded.problems.join("; ")}`);
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
