"use client";

import { useActionState } from "react";
import { AuthCard, AuthLink, FormAlert, SubmitButton, TextField } from "./AuthParts";
import { forgotSentHelper } from "./copy";
import { useDelayed, useFocusInvalid, useHeadingFocus } from "./hooks";
import { DidntGetIt } from "./DidntGetIt";
import { ResendControl } from "./ResendControl";
import { INITIAL_FORGOT, type ForgotState, type ResendState } from "./state";

export function ForgotForm({
  action,
  resendAction,
  appHost = null,
}: {
  /** The Preview's web address for the "Didn't get it?" note; null elsewhere. */
  appHost?: string | null;
  action: (previous: ForgotState, formData: FormData) => Promise<ForgotState>;
  resendAction: (previous: ResendState, formData: FormData) => Promise<ResendState>;
}) {
  const [state, formAction, pending] = useActionState(action, INITIAL_FORGOT);
  const busy = useDelayed(pending);
  const heading = useHeadingFocus(state.sent ? "sent" : "ask");
  const form = useFocusInvalid(state, Object.keys(state.fieldErrors).length > 0);

  if (state.sent) {
    return (
      <AuthCard
        titleId="forgot-title"
        eyebrow="Reset password"
        title="Check your email"
        headingRef={heading}
      >
        <p className="auth-helper">{forgotSentHelper(state.sent.email)}</p>
        <ResendControl
          kind="reset"
          action={resendAction}
          email={state.sent.email}
          initialCooldown={state.sent.cooldownSeconds}
        />
        <DidntGetIt host={appHost} />
        <p className="auth-links">
          <AuthLink href="/sign-in">Back to sign in</AuthLink>
        </p>
      </AuthCard>
    );
  }
  return (
    <AuthCard
      titleId="forgot-title"
      eyebrow="Reset password"
      title="Reset your password"
      headingRef={heading}
    >
      <p className="auth-helper">
        Enter your email and we&rsquo;ll send a reset link if there&rsquo;s an account for it.
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
        <SubmitButton label="Send reset link" busy={busy} />
      </form>
      <p className="auth-links">
        <AuthLink href="/sign-in">Back to sign in</AuthLink>
      </p>
    </AuthCard>
  );
}
