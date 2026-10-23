"use client";

import { useActionState } from "react";
import { AuthCard, AuthLink, FormAlert, SubmitButton, TextField } from "./AuthParts";
import { useDelayed, useFocusInvalid, useHeadingFocus } from "./hooks";
import { INITIAL_FORM, type FormState } from "./state";
import { CODE_LENGTH } from "@/server/auth/account-flows";

export function SignUpForm({
  action,
}: {
  action: (previous: FormState, formData: FormData) => Promise<FormState>;
}) {
  const [state, formAction, pending] = useActionState(action, INITIAL_FORM);
  const busy = useDelayed(pending);
  const heading = useHeadingFocus(0);
  const form = useFocusInvalid(state, Object.keys(state.fieldErrors).length > 0);
  return (
    <AuthCard
      titleId="sign-up-title"
      eyebrow="Create account"
      title="Create your account"
      headingRef={heading}
    >
      <p className="auth-helper">
        We&rsquo;ll email you a {CODE_LENGTH}-digit code to confirm your address, then a link to
        choose your password.
      </p>
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
        <TextField
          id="email"
          name="email"
          label="Email"
          type="email"
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          required
          defaultValue={state.email}
          error={state.fieldErrors.email}
        />
        <FormAlert message={state.error} />
        <SubmitButton label="Create account" busy={busy} />
      </form>
      <p className="auth-links">
        Already have an account? <AuthLink href="/sign-in">Sign in</AuthLink>
      </p>
    </AuthCard>
  );
}
