// Thin adapter from the Neon Auth server SDK (@neondatabase/auth/next/server `createNeonAuth`) to AuthProvider.
// It only maps results; all policy (allowlist, denial, logging) lives in guard.ts.
//
// UNVERIFIED against the live service: no Neon Auth credentials exist in this repo or CI, so the mapping is
// tested against a structural stand-in (NeonAuthLike) and type-checked against the SDK's real types in
// auth-runtime.ts. Enabling it in production is blocked on #27.

import { logAuthEvent } from "./safe-log";
import type { AuthProvider, AuthSession, SignInResult } from "./types";

interface NeonUser {
  id?: string | null;
  email?: string | null;
}

/** The subset of the SDK this adapter uses. */
export interface NeonAuthLike {
  getSession(): Promise<{ data?: { user?: NeonUser | null } | null; error?: unknown } | null>;
  signIn: {
    email(input: {
      email: string;
      password: string;
    }): Promise<{ data?: { user?: NeonUser | null } | null; error?: unknown } | null>;
  };
  signOut(): Promise<unknown>;
}

function toSession(user: NeonUser | null | undefined): AuthSession | null {
  return user?.id && user.email ? { userId: user.id, email: user.email } : null;
}

export function createNeonAuthProvider(neon: NeonAuthLike): AuthProvider {
  return {
    async getSession() {
      const result = await neon.getSession();
      return result?.error ? null : toSession(result?.data?.user);
    },
    async signInWithPassword(email, password): Promise<SignInResult> {
      try {
        const result = await neon.signIn.email({ email, password });
        const session = result?.error ? null : toSession(result?.data?.user);
        return session ? { ok: true, session } : { ok: false };
      } catch {
        // Network and API failures look like a failed sign-in to the caller; nothing from the error is logged.
        logAuthEvent("provider-error");
        return { ok: false };
      }
    },
    async signOut() {
      await neon.signOut();
    },
  };
}
