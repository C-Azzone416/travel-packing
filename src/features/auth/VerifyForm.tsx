"use client";

import { useActionState } from "react";
import { AuthCard, AuthLink, FormAlert, SubmitButton, TextField } from "./AuthParts";
import { verifyHelper } from "./copy";
import { useDelayed, useFocusInvalid, useHeadingFocus } from "./hooks";
import { DidntGetIt } from "./DidntGetIt";
import { ResendControl } from "./ResendControl";
import { INITIAL_FORM, type FormState, type ResendState } from "./state";
import { CODE_LENGTH } from "@/server/auth/account-flows";

/** Strip anything that is not a digit as it is typed or pasted ("123 456" and "123-456" both work). */
export function onlyDigits(value: string): string {
  return value.replace(/\D/g, "").slice(0, CODE_LENGTH);
}

export function VerifyForm({
  email,
  initialCooldown,
  verifyAction,
  resendAction,
  appHost = null,
}: {
  /** The Preview's web address for the "Didn't get it?" note; null elsewhere. */
  appHost?: string | null;
  /** The address being verified, or null when the page does not know it (the person types it). */
  email: string | null;
  initialCooldown: number;
  verifyAction: (previous: FormState, formData: FormData) => Promise<FormState>;
  resendAction: (previous: ResendState, formData: FormData) => Promise<ResendState>;
}) {
  const [state, formAction, pending] = useActionState(verifyAction, INITIAL_FORM);
  const busy = useDelayed(pending);
  const heading = useHeadingFocus(0);
  const form = useFocusInvalid(state, Object.keys(state.fieldErrors).length > 0);
  const known = email ?? (state.email || null);
  return (
    <AuthCard
      eyebrow="Verify email"
      titleId="verify-title"
      title={known ? "Check your email" : "Confirm your email"}
      headingRef={heading}
    >
      <p className="auth-helper">
        {known
          ? verifyHelper(known)
          : `Enter your email and the ${CODE_LENGTH}-digit code we sent.`}
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
        {email ? null : (
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
        )}
        <TextField
          id="code"
          name="code"
          label={`${CODE_LENGTH}-digit code`}
          className="code-input"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={CODE_LENGTH}
          pattern="[0-9]*"
          autoFocus={Boolean(email)}
          defaultValue={state.code}
          data-select-on-error=""
          required
          error={state.fieldErrors.code}
          onChange={(event) => {
            event.currentTarget.value = onlyDigits(event.currentTarget.value);
          }}
          // maxLength would cut "123 456" at six characters, dropping a digit, so a paste is cleaned before it lands.
          onPaste={(event) => {
            event.preventDefault();
            event.currentTarget.value = onlyDigits(event.clipboardData.getData("text"));
          }}
        />
        <FormAlert message={state.error} />
        <SubmitButton label="Verify" busy={busy} />
      </form>
      <ResendControl
        kind="verify"
        action={resendAction}
        email={email ? undefined : (known ?? undefined)}
        initialCooldown={initialCooldown}
      />
      <DidntGetIt host={appHost} />
      <p className="auth-links">
        <AuthLink href="/sign-up">Use a different email</AuthLink>
      </p>
    </AuthCard>
  );
}
