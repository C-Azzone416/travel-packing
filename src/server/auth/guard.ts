// Authorization decisions. One implementation, used by the proxy (optimistic gate) AND by every data-layer
// entry point (authoritative gate), so the allowlist cannot be skipped by bypassing the UI route guard.

import { isAllowed, type Allowlist } from "./allowlist";
import { logAuthEvent } from "./safe-log";
import type { AuthProvider, AuthSession } from "./types";

export type AuthDecision =
  { status: "ok"; session: AuthSession } | { status: "unauthenticated" } | { status: "forbidden" };

/**
 * Signed out -> unauthenticated. Signed in but not on the allowlist -> forbidden, and the session is ended
 * here so the person is signed out. Only an allowlisted owner gets `ok`.
 */
export async function authorizeOwner(
  provider: AuthProvider,
  allowlist: Allowlist,
): Promise<AuthDecision> {
  let session: AuthSession | null;
  try {
    session = await provider.getSession();
  } catch {
    logAuthEvent("provider-error");
    return { status: "unauthenticated" };
  }
  if (!session) {
    logAuthEvent("unauthenticated");
    return { status: "unauthenticated" };
  }
  if (!isAllowed(allowlist, session.email)) {
    logAuthEvent("forbidden");
    try {
      await provider.signOut();
    } catch {
      logAuthEvent("provider-error");
    }
    return { status: "forbidden" };
  }
  return { status: "ok", session };
}

export type AuthFailureCode = "UNAUTHENTICATED" | "FORBIDDEN";

/** Thrown by requireOwner. The message is deliberately generic: no email, no hints. */
export class AuthFailure extends Error {
  readonly code: AuthFailureCode;
  readonly httpStatus: 401 | 403;

  constructor(code: AuthFailureCode) {
    super(code === "UNAUTHENTICATED" ? "Authentication required" : "Access denied");
    this.name = "AuthFailure";
    this.code = code;
    this.httpStatus = code === "UNAUTHENTICATED" ? 401 : 403;
  }
}

/** Data-layer gate: returns the owner's session or throws AuthFailure. Call before any data access. */
export async function requireOwner(
  provider: AuthProvider,
  allowlist: Allowlist,
): Promise<AuthSession> {
  const decision = await authorizeOwner(provider, allowlist);
  if (decision.status === "ok") return decision.session;
  throw new AuthFailure(decision.status === "unauthenticated" ? "UNAUTHENTICATED" : "FORBIDDEN");
}

/**
 * Wrap a route handler or server action so it cannot run without an allowlisted owner, however it is
 * called (the UI guard may be bypassed; this cannot).
 */
export function withOwner<Args extends unknown[], Result>(
  getAuth: () => Promise<{ provider: AuthProvider; allowlist: Allowlist }>,
  handler: (session: AuthSession, ...args: Args) => Promise<Result>,
): (...args: Args) => Promise<Result> {
  return async (...args) => {
    const { provider, allowlist } = await getAuth();
    return handler(await requireOwner(provider, allowlist), ...args);
  };
}
