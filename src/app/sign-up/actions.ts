"use server";

import { redirect } from "next/navigation";
import { accountContext, field } from "@/features/auth/server";
import { INVALID_EMAIL, TOO_MANY_REQUESTS, UNAVAILABLE, passwordError } from "@/features/auth/copy";
import type { FormState } from "@/features/auth/state";
import { cleanEmail, passwordProblem, signUpOwner } from "@/server/auth/account-flows";
import { withMinimumDuration } from "@/server/auth/min-duration";
import { rememberPendingEmail } from "@/server/auth/pending-email";
import { VERIFY_PATH } from "@/server/auth/public-paths";

/**
 * Create the account and go to the code screen. The answer and the timing are the same for an address that already has
 * an account and for one that is not allowed in: the screen after this one never says which.
 */
export async function signUpAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const email = field(formData, "email");
  const state = (changes: Partial<FormState>): FormState => ({
    error: null,
    fieldErrors: {},
    email,
    ...changes,
  });
  // Both problems at once, so a person fixes the form in one go. The service checks again; this is only for the screen.
  const problem = passwordProblem(formData.get("password"));
  const fieldErrors = {
    ...(cleanEmail(email) ? {} : { email: INVALID_EMAIL }),
    ...(problem ? { password: passwordError(problem) } : {}),
  };
  if (Object.keys(fieldErrors).length > 0) return state({ fieldErrors });
  const { auth, limits, address } = await accountContext();
  if (!auth.available) return state({ error: "Sign-up isn't available right now." });

  const outcome = await withMinimumDuration(() =>
    signUpOwner(auth, limits, address, email, formData.get("password")),
  );
  switch (outcome.status) {
    case "invalid-email":
      return state({ fieldErrors: { email: INVALID_EMAIL } });
    case "weak-password":
      return state({ fieldErrors: { password: passwordError(outcome.problem) } });
    case "rate-limited":
      return state({ error: TOO_MANY_REQUESTS });
    case "unavailable":
      return state({ error: UNAVAILABLE });
    case "ok":
      await rememberPendingEmail(outcome.email);
      redirect(VERIFY_PATH);
  }
}
