// Fake sign-in for browser (Playwright) tests ONLY. It lets e2e exercise the real proxy, pages, and actions
// without a Neon Auth project. It is compiled out of every build made without NEXT_PUBLIC_E2E_BUILD=1 (see
// next.config.ts and auth-runtime.ts) and refused whenever Vercel's own `VERCEL` variable is present.
//
// The session cookie is an unguessable random token minted at sign-in; the token -> email mapping lives in a
// file under AUTH_E2E_STATE_DIR (one file per token, so the proxy and server actions, which are separate
// bundles, and concurrent test workers all see the same state without races). A forged, tampered, or signed-out
// token has no file and is rejected, so knowing the owner's email is not enough.

import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cookies } from "next/headers";
import type { AuthProvider, AuthSession } from "./types";

export const E2E_COOKIE = "e2e-auth-session";

type Env = Record<string, string | undefined>;

/** 32 random bytes, hex. Anything else is rejected before it is ever used as a file name. */
const TOKEN_PATTERN = /^[0-9a-f]{64}$/;

export function e2eAuthEnabled(env: Env): boolean {
  return (
    env.AUTH_E2E_FAKE === "1" &&
    !env.VERCEL &&
    Boolean(env.AUTH_E2E_PASSWORD) &&
    Boolean(env.AUTH_E2E_STATE_DIR)
  );
}

function sessionFile(env: Env, token: string): string {
  return join(env.AUTH_E2E_STATE_DIR ?? "", token);
}

/** The email behind a token, or null for anything that was not minted by a sign-in and not signed out since. */
function emailFor(env: Env, token: string | undefined): string | null {
  if (!token || !TOKEN_PATTERN.test(token)) return null;
  try {
    return readFileSync(sessionFile(env, token), "utf8").trim() || null;
  } catch {
    return null;
  }
}

/** Any email signs in if it knows the shared synthetic password; the allowlist decides who gets in. */
export function createE2eAuthProvider(env: Env): AuthProvider {
  return {
    async getSession(): Promise<AuthSession | null> {
      const email = emailFor(env, (await cookies()).get(E2E_COOKIE)?.value);
      return email ? { userId: `e2e-${email}`, email } : null;
    },
    async signInWithPassword(email, password) {
      if (!env.AUTH_E2E_PASSWORD || password !== env.AUTH_E2E_PASSWORD) return { ok: false };
      const token = randomBytes(32).toString("hex");
      mkdirSync(env.AUTH_E2E_STATE_DIR ?? "", { recursive: true });
      writeFileSync(sessionFile(env, token), email);
      (await cookies()).set(E2E_COOKIE, token, { httpOnly: true, sameSite: "lax", path: "/" });
      return { ok: true, session: { userId: `e2e-${email}`, email } };
    },
    async signOut() {
      const jar = await cookies();
      const token = jar.get(E2E_COOKIE)?.value;
      if (token && TOKEN_PATTERN.test(token)) rmSync(sessionFile(env, token), { force: true });
      jar.delete(E2E_COOKIE);
    },
  };
}
