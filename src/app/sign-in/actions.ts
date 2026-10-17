"use server";

import { redirect } from "next/navigation";
import { getAuth } from "@/server/auth/auth-runtime";
import { ACCESS_DENIED_PATH, SIGN_IN_PATH } from "@/server/auth/proxy-handler";
import { signInOwner, signOutOwner } from "@/server/auth/sign-in";
import { INVALID_CREDENTIALS_MESSAGE, UNAVAILABLE_MESSAGE, type SignInState } from "./state";

/** Form action for the sign-in screen. The allowlist check happens here on the server, not in the UI. */
export async function signInAction(
  _previous: SignInState,
  formData: FormData,
): Promise<SignInState> {
  const auth = await getAuth();
  if (!auth.available) return { error: UNAVAILABLE_MESSAGE };
  const outcome = await signInOwner(auth, formData.get("email"), formData.get("password"));
  if (outcome === "ok") redirect("/");
  if (outcome === "denied") redirect(ACCESS_DENIED_PATH);
  return { error: INVALID_CREDENTIALS_MESSAGE };
}

/** Sign out goes straight through (no confirm), then back to sign-in. */
export async function signOutAction(): Promise<void> {
  await signOutOwner((await getAuth()).provider);
  redirect(SIGN_IN_PATH);
}
