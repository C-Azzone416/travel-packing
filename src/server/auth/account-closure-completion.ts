import "server-only";

import { cookies } from "next/headers";
import {
  ACCOUNT_CLOSURE_SIGNAL_LIFETIME_MS,
  type AccountClosureSignals,
} from "./account-closure-signal";

export const ACCOUNT_CLOSURE_COMPLETE_PATH = "/close-account/complete";
export const ACCOUNT_CLOSURE_COMPLETION_COOKIE = "ps-account-closure-complete";

const cookieOptions = () => ({
  httpOnly: true as const,
  sameSite: "strict" as const,
  secure: process.env.NODE_ENV === "production",
  path: ACCOUNT_CLOSURE_COMPLETE_PATH,
});

/** Issue an identity-free browser signal only after terminal provider deletion. Failure falls back to a direct sign-in redirect. */
export async function issueAccountClosureCompletion(
  signals: AccountClosureSignals,
): Promise<boolean> {
  try {
    const value = signals.issue();
    if (!value) return false;
    (await cookies()).set(ACCOUNT_CLOSURE_COMPLETION_COOKIE, value, {
      ...cookieOptions(),
      maxAge: Math.ceil(ACCOUNT_CLOSURE_SIGNAL_LIFETIME_MS / 1000),
    });
    return true;
  } catch {
    return false;
  }
}

/** Consume the path-scoped signal before client cleanup. The exact-path expiry makes sequential use one-time. */
export async function consumeAccountClosureCompletion(
  signals: AccountClosureSignals,
): Promise<boolean> {
  try {
    const jar = await cookies();
    const value = jar.get(ACCOUNT_CLOSURE_COMPLETION_COOKIE)?.value;
    jar.set(ACCOUNT_CLOSURE_COMPLETION_COOKIE, "", {
      ...cookieOptions(),
      expires: new Date(0),
      maxAge: 0,
    });
    return signals.open(value);
  } catch {
    return false;
  }
}
