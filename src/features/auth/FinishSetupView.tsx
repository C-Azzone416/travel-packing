"use client";

import { AuthCard, AuthLink } from "./AuthParts";
import { FINISH_SETUP_TITLE, finishSetupHelper } from "./copy";
import { DidntGetIt } from "./DidntGetIt";
import { ResendControl } from "./ResendControl";
import type { ResendState } from "./state";

/**
 * "Check your email to finish setting up" (#83). Shown after a sign-up code is accepted, and when someone signs in before
 * their password was set through the emailed link. It says the same thing in both cases and never whether an account exists.
 */
export function FinishSetupView({
  email,
  initialCooldown,
  resendAction,
  appHost = null,
}: {
  /** The Preview's web address for the "Didn't get it?" note; null elsewhere. */
  appHost?: string | null;
  /** The address the link went to, or null when the page does not know it. */
  email: string | null;
  initialCooldown: number;
  resendAction: (previous: ResendState, formData: FormData) => Promise<ResendState>;
}) {
  return (
    <AuthCard titleId="finish-setup-title" eyebrow="Finish setup" title={FINISH_SETUP_TITLE}>
      <p className="auth-helper">{finishSetupHelper(email)}</p>
      {email ? (
        <>
          <ResendControl kind="setup" action={resendAction} initialCooldown={initialCooldown} />
          <DidntGetIt host={appHost} />
        </>
      ) : (
        <p className="auth-links">
          <AuthLink href="/forgot-password">Send me a link</AuthLink>
        </p>
      )}
      <p className="auth-links">
        <AuthLink href="/sign-in">Back to sign in</AuthLink>
      </p>
    </AuthCard>
  );
}
