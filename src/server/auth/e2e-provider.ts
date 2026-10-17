// Fake sign-in for browser (Playwright) tests ONLY. It lets e2e exercise the real proxy, pages, and actions
// without a Neon Auth project. It is impossible to enable on any Vercel deployment (production or preview):
// the guard below refuses whenever Vercel's own `VERCEL` variable is present, and it needs an explicit opt-in.

import { cookies } from "next/headers";
import type { AuthProvider, AuthSession } from "./types";

export const E2E_COOKIE = "e2e-auth-session";

type Env = Record<string, string | undefined>;

export function e2eAuthEnabled(env: Env): boolean {
  return env.AUTH_E2E_FAKE === "1" && !env.VERCEL && Boolean(env.AUTH_E2E_PASSWORD);
}

/** Any email signs in if it knows the shared synthetic password; the allowlist decides who gets in. */
export function createE2eAuthProvider(env: Env): AuthProvider {
  return {
    async getSession(): Promise<AuthSession | null> {
      const email = (await cookies()).get(E2E_COOKIE)?.value;
      return email ? { userId: `e2e-${email}`, email } : null;
    },
    async signInWithPassword(email, password) {
      if (!env.AUTH_E2E_PASSWORD || password !== env.AUTH_E2E_PASSWORD) return { ok: false };
      (await cookies()).set(E2E_COOKIE, email, { httpOnly: true, sameSite: "lax", path: "/" });
      return { ok: true, session: { userId: `e2e-${email}`, email } };
    },
    async signOut() {
      (await cookies()).delete(E2E_COOKIE);
    },
  };
}
