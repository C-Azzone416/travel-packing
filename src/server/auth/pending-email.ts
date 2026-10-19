// The address a person is verifying, remembered between the sign-up screen and the code screen. It lives in a short-lived
// httpOnly cookie rather than the URL so the address never lands in browser history, a shared link, or an access log.
// It is only a convenience: it grants nothing, and anyone can set it to any address in their own browser.

import { cookies } from "next/headers";
import { cleanEmail } from "./account-flows";

export const PENDING_EMAIL_COOKIE = "cw-pending-email";
export const PENDING_EMAIL_MAX_AGE_SECONDS = 30 * 60;

export async function rememberPendingEmail(email: string): Promise<void> {
  (await cookies()).set(PENDING_EMAIL_COOKIE, email, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: PENDING_EMAIL_MAX_AGE_SECONDS,
    secure: process.env.NODE_ENV === "production",
  });
}

/** The remembered address, or null when there is none or it is not an address. */
export async function pendingEmail(): Promise<string | null> {
  return cleanEmail((await cookies()).get(PENDING_EMAIL_COOKIE)?.value);
}

export async function forgetPendingEmail(): Promise<void> {
  (await cookies()).delete(PENDING_EMAIL_COOKIE);
}
