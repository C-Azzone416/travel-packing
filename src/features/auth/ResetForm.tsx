"use client";

import { useActionState } from "react";
import { AuthCard, FormAlert, PasswordField, SubmitButton } from "./AuthParts";
import { PASSWORD_RULE } from "./copy";
import { useDelayed, useFocusInvalid, useHeadingFocus } from "./hooks";
import { INITIAL_FORM, type FormState } from "./state";

export function ResetForm({
  token,
  sealed,
  variant = "reset",
  action,
}: {
  token: string;
  /** The address seal from the link; sent back so using the link can record which account was set up. */
  sealed: string;
  /** "setup" is the first password after signing up (wording only); "reset" is a forgotten one. */
  variant?: "setup" | "reset";
  action: (previous: FormState, formData: FormData) => Promise<FormState>;
}) {
  const [state, formAction, pending] = useActionState(action, INITIAL_FORM);
  const busy = useDelayed(pending);
  const heading = useHeadingFocus(0);
  const form = useFocusInvalid(state, Object.keys(state.fieldErrors).length > 0);
  return (
    <AuthCard
      eyebrow={variant === "setup" ? "Finish setup" : "Reset password"}
      titleId="reset-title"
      title={variant === "setup" ? "Set your password" : "Choose a new password"}
      headingRef={heading}
    >
      <form
        ref={form}
        className="auth-form"
        action={formAction}
        aria-busy={busy}
        noValidate
        onSubmit={(event) => {
          if (pending) event.preventDefault();
        }}
      >
        <input type="hidden" name="token" value={token} />
        <input type="hidden" name="for" value={sealed} />
        <input type="hidden" name="variant" value={variant} />
        <PasswordField
          id="password"
          name="password"
          label="New password"
          autoComplete="new-password"
          hint={PASSWORD_RULE}
          error={state.fieldErrors.password}
        />
        <FormAlert message={state.error} />
        <SubmitButton
          label={variant === "setup" ? "Set password" : "Update password"}
          busy={busy}
        />
      </form>
    </AuthCard>
  );
}
