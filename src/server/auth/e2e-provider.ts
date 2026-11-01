// Fake sign-in for browser (Playwright) tests ONLY. It lets e2e exercise the real proxy, pages, and actions
// without a Neon Auth project. It is compiled out of every build made without NEXT_PUBLIC_E2E_BUILD=1 (see
// next.config.ts and auth-runtime.ts) and refused whenever Vercel's own `VERCEL` variable is present.
//
// The session cookie is an unguessable random token minted at sign-in; the token -> email mapping lives in a
// file under AUTH_E2E_STATE_DIR (one file per token, so the proxy and server actions, which are separate
// bundles, and concurrent test workers all see the same state without races). A forged, tampered, or signed-out
// token has no file and is rejected, so knowing the owner's email is not enough.

import { randomBytes, randomInt } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cookies } from "next/headers";
import type { AuthProvider, AuthSession, FlowResult } from "./types";

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

/**
 * The email behind a token and when the session was made, or null for anything that was not minted by a sign-in and not
 * signed out since. The file holds the address, a newline, and the creation time in ms (what a real provider reports as
 * the session's createdAt).
 */
function sessionFor(
  env: Env,
  token: string | undefined,
): { email: string; issuedAt: number; identityCreatedAt: number } | null {
  if (!token || !TOKEN_PATTERN.test(token)) return null;
  try {
    const [email, made, identityMade] = readFileSync(sessionFile(env, token), "utf8")
      .trim()
      .split("\n");
    return email
      ? { email, issuedAt: Number(made) || 0, identityCreatedAt: Number(identityMade) || 1 }
      : null;
  } catch {
    return null;
  }
}

/**
 * Sign-up, verification and reset for browser tests. Accounts and "emailed" codes and links are files in the state dir,
 * so a test can read the email the way a person would open their inbox: `inbox-verify-<hex of the address>` holds the
 * latest verification code and `inbox-reset-<hex of the address>` the latest reset link as JSON (`token` and `redirectTo`). Codes
 * and tokens are random per run and live only in that temp dir (never in source, logs or fixtures).
 * Five wrong guesses lock a code (a new code clears the lock); a used code or token is gone.
 */
const MAX_CODE_ATTEMPTS = 5;
type CodeKind = "verify" | "reset";
const hex = (email: string) => Buffer.from(email.trim().toLowerCase()).toString("hex");
const stateDirOf = (env: Env) => env.AUTH_E2E_STATE_DIR ?? "";
const accountFile = (env: Env, email: string) => join(stateDirOf(env), `acct-${hex(email)}`);
const inboxFile = (env: Env, kind: CodeKind, email: string) =>
  join(stateDirOf(env), `inbox-${kind}-${hex(email)}`);
const tokenFile = (env: Env, token: string) => join(stateDirOf(env), `rtoken-${token}`);

interface E2eAccount {
  password: string;
  verified: boolean;
  identityCreatedAt: number;
}

function readAccount(env: Env, email: string): E2eAccount | null {
  try {
    return JSON.parse(readFileSync(accountFile(env, email), "utf8")) as E2eAccount;
  } catch {
    return null;
  }
}

function writeAccount(env: Env, email: string, account: E2eAccount): void {
  mkdirSync(stateDirOf(env), { recursive: true });
  writeFileSync(accountFile(env, email), JSON.stringify(account));
}

function mailCode(env: Env, email: string): void {
  mkdirSync(stateDirOf(env), { recursive: true });
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  writeFileSync(inboxFile(env, "verify", email), `${code}:0`);
}

/**
 * "Emails" a reset link: a fresh single-use token, mapped back to the address, and left in the reset inbox together with the
 * return address the app asked for, as the real provider would build the link (`redirectTo` + `?token=` / `&token=`).
 */
function mailResetLink(env: Env, email: string, redirectTo: string): void {
  mkdirSync(stateDirOf(env), { recursive: true });
  const token = randomBytes(24).toString("hex");
  writeFileSync(tokenFile(env, token), email);
  writeFileSync(inboxFile(env, "reset", email), JSON.stringify({ token, redirectTo }));
}

/** Checks `code` against the pending verification code; counts wrong guesses and locks after the limit. */
function checkCode(env: Env, email: string, code: string): FlowResult<"invalid" | "locked"> {
  const file = inboxFile(env, "verify", email);
  if (!existsSync(file)) return { ok: false, reason: "invalid" };
  const [expected, attempts] = readFileSync(file, "utf8").split(":");
  if (Number(attempts) >= MAX_CODE_ATTEMPTS) return { ok: false, reason: "locked" };
  if (code !== expected) {
    writeFileSync(file, `${expected}:${Number(attempts) + 1}`);
    return { ok: false, reason: "invalid" };
  }
  rmSync(file, { force: true });
  return { ok: true };
}

/** Uses up a reset token, returning the address it was for. Unknown, malformed or used tokens give null. */
function spendToken(env: Env, token: string): string | null {
  if (!/^[0-9a-f]{48}$/.test(token)) return null;
  try {
    const email = readFileSync(tokenFile(env, token), "utf8");
    rmSync(tokenFile(env, token), { force: true });
    return email;
  } catch {
    return null;
  }
}

async function mintSession(env: Env, email: string, identityCreatedAt: number) {
  const token = randomBytes(32).toString("hex");
  mkdirSync(env.AUTH_E2E_STATE_DIR ?? "", { recursive: true });
  const issuedAt = Date.now();
  writeFileSync(sessionFile(env, token), `${email}\n${issuedAt}\n${identityCreatedAt}`);
  (await cookies()).set(E2E_COOKIE, token, { httpOnly: true, sameSite: "lax", path: "/" });
  return { token, session: { userId: `e2e-${email}`, email, issuedAt, identityCreatedAt } };
}

async function startSession(env: Env, email: string, identityCreatedAt: number) {
  const { session } = await mintSession(env, email, identityCreatedAt);
  return { ok: true as const, session };
}

/** Any email signs in if it knows the shared synthetic password; the allowlist decides who gets in. */
export function createE2eAuthProvider(env: Env): AuthProvider {
  async function removeSessions(email: string, except?: string): Promise<void> {
    for (const name of readdirSync(stateDirOf(env), { withFileTypes: true })) {
      if (!name.isFile() || !TOKEN_PATTERN.test(name.name) || name.name === except) continue;
      if (sessionFor(env, name.name)?.email === email)
        rmSync(sessionFile(env, name.name), { force: true });
    }
  }
  return {
    async getSession(): Promise<AuthSession | null> {
      const found = sessionFor(env, (await cookies()).get(E2E_COOKIE)?.value);
      return found
        ? {
            userId: `e2e-${found.email}`,
            email: found.email,
            issuedAt: found.issuedAt,
            identityCreatedAt: found.identityCreatedAt,
          }
        : null;
    },
    async signUp(email, password) {
      if (password.length < 8) return { ok: false, reason: "weak-password" };
      // A taken address looks like a new account, as with the real provider: nothing is created or mailed.
      if (!readAccount(env, email)) {
        writeAccount(env, email, { password, verified: false, identityCreatedAt: Date.now() });
        mailCode(env, email);
      }
      return { ok: true };
    },
    async verifyEmail(email, code) {
      const checked = checkCode(env, email, code);
      const account = readAccount(env, email);
      if (checked.ok && account) writeAccount(env, email, { ...account, verified: true });
      return checked;
    },
    async resendVerificationCode(email) {
      // A new code replaces the old one and clears the wrong-guess count.
      if (readAccount(env, email)?.verified === false) mailCode(env, email);
      return { ok: true };
    },
    async requestPasswordReset(email, redirectTo) {
      if (readAccount(env, email)) mailResetLink(env, email, redirectTo);
      return { ok: true };
    },
    async resetPassword(token, newPassword) {
      if (newPassword.length < 8) return { ok: false, reason: "weak-password" };
      const email = spendToken(env, token);
      const account = email ? readAccount(env, email) : null;
      if (!email || !account) return { ok: false, reason: "invalid" };
      writeAccount(env, email, { ...account, password: newPassword });
      return { ok: true };
    },
    async signInWithPassword(email, password) {
      // A person who signed up here signs in with their own password, and only once verified.
      const account = readAccount(env, email);
      if (account) {
        if (password !== account.password) return { ok: false };
        return account.verified
          ? startSession(env, email, account.identityCreatedAt)
          : { ok: false, unverified: true };
      }
      if (!env.AUTH_E2E_PASSWORD || password !== env.AUTH_E2E_PASSWORD) return { ok: false };
      return startSession(env, email, 1);
    },
    async beginAccountClosure(email, password) {
      const account = readAccount(env, email);
      if (account) {
        if (password !== account.password || !account.verified) return { ok: false };
      } else if (!env.AUTH_E2E_PASSWORD || password !== env.AUTH_E2E_PASSWORD) {
        return { ok: false };
      }
      const { token, session } = await mintSession(env, email, account?.identityCreatedAt ?? 1);
      return {
        ok: true,
        authorization: {
          session,
          async revokeOtherSessions() {
            if (!sessionFor(env, token)) return { ok: false, reason: "unavailable" };
            await removeSessions(email, token);
            return { ok: true };
          },
          async deleteUser(closurePassword) {
            if (!sessionFor(env, token)) return { ok: false, reason: "invalid" };
            const currentAccount = readAccount(env, email);
            const expected = currentAccount?.password ?? env.AUTH_E2E_PASSWORD;
            if (!expected || closurePassword !== expected) return { ok: false, reason: "invalid" };
            await removeSessions(email);
            rmSync(accountFile(env, email), { force: true });
            (await cookies()).delete(E2E_COOKIE);
            return { ok: true };
          },
        },
      };
    },
    async signOut() {
      const jar = await cookies();
      const token = jar.get(E2E_COOKIE)?.value;
      if (token && TOKEN_PATTERN.test(token)) rmSync(sessionFile(env, token), { force: true });
      jar.delete(E2E_COOKIE);
    },
    async revokeOtherSessions() {
      const token = (await cookies()).get(E2E_COOKIE)?.value;
      const session = sessionFor(env, token);
      if (!session) return { ok: false, reason: "unavailable" };
      await removeSessions(session.email, token);
      return { ok: true };
    },
    async deleteUser(password) {
      const jar = await cookies();
      const token = jar.get(E2E_COOKIE)?.value;
      const session = sessionFor(env, token);
      if (!session) return { ok: false, reason: "invalid" };
      const account = readAccount(env, session.email);
      const expected = account?.password ?? env.AUTH_E2E_PASSWORD;
      if (!expected || password !== expected) return { ok: false, reason: "invalid" };
      await removeSessions(session.email);
      rmSync(accountFile(env, session.email), { force: true });
      jar.delete(E2E_COOKIE);
      return { ok: true };
    },
    async isAccountDeletionBlocked() {
      return false;
    },
  };
}
