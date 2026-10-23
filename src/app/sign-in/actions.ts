"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { APPEARANCE_COOKIE } from "@/domain/appearance";
import { requestPasswordReset, resendVerificationCode } from "@/server/auth/account-flows";
import { getAuth } from "@/server/auth/auth-runtime";
import { flowLimits } from "@/server/auth/flow-limits";
import { forgetPendingEmail, rememberPendingEmail } from "@/server/auth/pending-email";
import { ACCESS_DENIED_PATH, SIGN_IN_PATH } from "@/server/auth/proxy-handler";
import { FINISH_SETUP_PATH, VERIFY_PATH } from "@/server/auth/public-paths";
import { resetPasswordUrl } from "@/server/auth/request-origin";
import { logAuthEvent } from "@/server/auth/safe-log";
import { signInOwner, signOutOwner } from "@/server/auth/sign-in";
import { clientAddress, signInLimits } from "@/server/auth/sign-in-limit";
import {
  INVALID_CREDENTIALS_MESSAGE,
  RATE_LIMITED_MESSAGE,
  UNAVAILABLE_MESSAGE,
  type SignInState,
} from "./state";

/** Form action for the sign-in screen. The allowlist check happens here on the server, not in the UI. */
export async function signInAction(
  _previous: SignInState,
  formData: FormData,
): Promise<SignInState> {
  const auth = await getAuth();
  if (!auth.available) return { error: UNAVAILABLE_MESSAGE };
  // Ask first, before the credentials are looked at: once guessing is blocked, not even the right password gets in.
  // Only failures count, and the lockout is per (email, address), so nobody can lock the owner out from elsewhere.
  const email = typeof formData.get("email") === "string" ? (formData.get("email") as string) : "";
  const address = clientAddress(await headers());
  const limits = signInLimits();
  if (limits.blocked(email, address)) {
    logAuthEvent("sign-in-rate-limited");
    return { error: RATE_LIMITED_MESSAGE };
  }
  const outcome = await signInOwner(auth, formData.get("email"), formData.get("password"));
  if (outcome === "ok") {
    limits.recordSuccess(email, address);
    // The remembered address belongs to the sign-up or setup that is now over; the next visitor must not see it (#209).
    await forgetPendingEmail();
    redirect("/");
  }
  if (outcome === "unverified") {
    // The password was right but the address was never confirmed: send a fresh code and go to the code screen. This
    // reveals nothing the person could not already know, since they just proved the password.
    limits.recordSuccess(email, address);
    await resendVerificationCode(auth, flowLimits(), address, email);
    await rememberPendingEmail(email.trim().toLowerCase());
    redirect(VERIFY_PATH);
  }
  if (outcome === "unfinished") {
    // The password was right and the address verified, but its password was never set through an emailed link (#83): no
    // session. Send that link and say "check your email". As with an unverified account, the person just proved the password.
    limits.recordSuccess(email, address);
    const url = resetPasswordUrl(await headers());
    if (url) {
      await requestPasswordReset(auth, flowLimits(), address, email, (clean) => {
        return `${url}?for=${auth.seals.seal(clean)}&setup=1`;
      });
    }
    await rememberPendingEmail(email.trim().toLowerCase());
    redirect(FINISH_SETUP_PATH);
  }
  limits.recordFailure(email, address);
  if (outcome === "denied") redirect(ACCESS_DENIED_PATH);
  return { error: INVALID_CREDENTIALS_MESSAGE };
}

/** Sign out goes straight through (no confirm), then back to sign-in. */
export async function signOutAction(): Promise<void> {
  await signOutOwner((await getAuth()).provider);
  // The theme cookie mirrors the account, so it must not outlive the session on a shared browser.
  (await cookies()).delete(APPEARANCE_COOKIE);
  // So does the address remembered for the code and setup screens (#209).
  await forgetPendingEmail();
  redirect(SIGN_IN_PATH);
}
