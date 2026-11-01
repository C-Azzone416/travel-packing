"use client";

import { useActionState } from "react";
import {
  AuthCard,
  FormAlert,
  PasswordField,
  SubmitButton,
  TextField,
} from "@/features/auth/AuthParts";
import { retryCloseAccountAction } from "@/features/settings/close-account-actions";
import { INITIAL_CLOSE_ACCOUNT_STATE } from "@/features/settings/close-account-state";

export function RetryCloseAccountForm() {
  const [state, action, pending] = useActionState(
    retryCloseAccountAction,
    INITIAL_CLOSE_ACCOUNT_STATE,
  );
  return (
    <AuthCard
      titleId="close-account-title"
      eyebrow="Account closure"
      title="Finish closing your account"
    >
      <p>
        Your Packed Smart data has already been removed and app access is blocked. Finish removing
        the account identity and its remaining sessions.
      </p>
      <form action={action} className="auth-form" noValidate>
        <PasswordField
          id="close-account-password"
          name="password"
          label="Current password"
          autoComplete="current-password"
          error={pending ? undefined : state.fieldErrors.password}
        />
        <TextField
          id="close-account-confirmation"
          name="confirmation"
          label="Type DELETE to confirm"
          autoComplete="one-time-code"
          autoCapitalize="characters"
          spellCheck={false}
          required
          error={pending ? undefined : state.fieldErrors.confirmation}
        />
        <FormAlert message={pending ? null : state.error} />
        <SubmitButton label="Finish account closure" busy={pending} />
      </form>
    </AuthCard>
  );
}
