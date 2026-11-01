// The anonymous palette cookie (#283); see ANONYMOUS_APPEARANCE_COOKIE for what it holds and why. Server-only helpers.
// Nothing here may read a session or influence an auth decision: the value is a palette id and nothing else.

import { cookies } from "next/headers";
import {
  ANONYMOUS_APPEARANCE_COOKIE,
  ANONYMOUS_APPEARANCE_COOKIE_MAX_AGE,
  isAppearance,
  type Appearance,
} from "@/domain/appearance";
import { secureCookie } from "@/server/auth/pending-email";

/** The remembered palette, or undefined when absent, malformed, unknown or from a newer build (all mean Base). */
export async function readAnonymousAppearance(): Promise<Appearance | undefined> {
  const value = (await cookies()).get(ANONYMOUS_APPEARANCE_COOKIE)?.value;
  return isAppearance(value) ? value : undefined;
}

/** Remember a palette id for signed-out pages. Only a validated id is ever written. */
export async function rememberAnonymousAppearance(appearance: Appearance): Promise<void> {
  if (!isAppearance(appearance)) return;
  (await cookies()).set(ANONYMOUS_APPEARANCE_COOKIE, appearance, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: ANONYMOUS_APPEARANCE_COOKIE_MAX_AGE,
    secure: secureCookie(),
  });
}

export async function forgetAnonymousAppearance(): Promise<void> {
  (await cookies()).delete(ANONYMOUS_APPEARANCE_COOKIE);
}
