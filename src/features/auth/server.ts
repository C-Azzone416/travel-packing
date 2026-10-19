// What every account action needs from the request, in one place: the auth runtime, the limits, and who is calling.

import { headers } from "next/headers";
import { getAuth } from "@/server/auth/auth-runtime";
import { clientAddress } from "@/server/auth/sign-in-limit";
import { flowLimits } from "@/server/auth/flow-limits";
import { resetPasswordUrl } from "@/server/auth/request-origin";

export async function accountContext() {
  const [auth, requestHeaders] = await Promise.all([getAuth(), headers()]);
  return {
    auth,
    limits: flowLimits(),
    address: clientAddress(requestHeaders),
    resetUrl: resetPasswordUrl(requestHeaders),
  };
}

/** A form field as a string ("" when absent or not text). */
export function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}
