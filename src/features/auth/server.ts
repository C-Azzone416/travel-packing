// What every account action needs from the request, in one place: the auth runtime, the limits, and who is calling.

import { headers } from "next/headers";
import { getAuth } from "@/server/auth/auth-runtime";
import { clientAddress } from "@/server/auth/sign-in-limit";
import { flowLimits } from "@/server/auth/flow-limits";
import { resetPasswordUrl } from "@/server/auth/request-origin";

export async function accountContext() {
  const [auth, requestHeaders] = await Promise.all([getAuth(), headers()]);
  const resetUrl = resetPasswordUrl(requestHeaders);
  return {
    auth,
    limits: flowLimits(),
    address: clientAddress(requestHeaders),
    /**
     * The return address for a reset link made for one address: the app's /reset-password page plus a seal naming that
     * address, so using the link can record which account was set up (#83). Null if the host cannot be worked out.
     */
    resetRedirect: resetUrl ? (email: string) => `${resetUrl}?for=${auth.seals.seal(email)}` : null,
    /** The same, for the link that finishes sign-up; `setup=1` only changes the wording on the reset page (never behaviour). */
    setupRedirect: resetUrl
      ? (email: string) => `${resetUrl}?for=${auth.seals.seal(email)}&setup=1`
      : null,
  };
}

/** A form field as a string ("" when absent or not text). */
export function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}
