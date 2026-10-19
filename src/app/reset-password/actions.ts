"use server";

import { redirect } from "next/navigation";
import { accountContext, field } from "@/features/auth/server";
import { TOO_MANY_REQUESTS, UNAVAILABLE, passwordError } from "@/features/auth/copy";
import type { FormState } from "@/features/auth/state";
import { resetOwnerPassword } from "@/server/auth/account-flows";
import { withMinimumDuration } from "@/server/auth/min-duration";
import { RESET_PASSWORD_PATH, SIGN_IN_PATH } from "@/server/auth/public-paths";

/**
 * Choose a new password with the link's token. Success goes to sign-in with a notice; it never signs anyone in. A token
 * that no longer works goes back to the "This link isn't valid" screen (without the token in the address).
 */
export async function resetAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const state = (changes: Partial<FormState>): FormState => ({
    error: null,
    fieldErrors: {},
    email: "",
    ...changes,
  });
  const { auth } = await accountContext();
  if (!auth.available) return state({ error: UNAVAILABLE });

  const outcome = await withMinimumDuration(() =>
    resetOwnerPassword(auth, field(formData, "token"), formData.get("password")),
  );
  switch (outcome.status) {
    case "ok":
      redirect(`${SIGN_IN_PATH}?notice=password-updated`);
    case "invalid-link":
      redirect(`${RESET_PASSWORD_PATH}?error=invalid`);
    case "weak-password":
      return state({ fieldErrors: { password: passwordError(outcome.problem) } });
    case "rate-limited":
      return state({ error: TOO_MANY_REQUESTS });
    case "unavailable":
      return state({ error: UNAVAILABLE });
  }
}
