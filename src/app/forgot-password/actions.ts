"use server";

import { accountContext, field } from "@/features/auth/server";
import { INVALID_EMAIL, TOO_MANY_REQUESTS, UNAVAILABLE } from "@/features/auth/copy";
import type { ForgotState, ResendState } from "@/features/auth/state";
import { requestPasswordReset } from "@/server/auth/account-flows";
import { RESEND_COOLDOWN_SECONDS } from "@/server/auth/flow-limits";
import { withMinimumDuration } from "@/server/auth/min-duration";

/**
 * Ask for a reset link. The answer is the same for every address (and for one asked about a moment ago): the form is
 * replaced by "Check your email". Only a malformed address, a cap, or an outage says anything else.
 */
export async function forgotAction(
  _previous: ForgotState,
  formData: FormData,
): Promise<ForgotState> {
  const email = field(formData, "email");
  const state = (changes: Partial<ForgotState>): ForgotState => ({
    error: null,
    fieldErrors: {},
    email,
    sent: null,
    ...changes,
  });
  const { auth, limits, address, resetRedirect } = await accountContext();
  if (!auth.available || !resetRedirect) return state({ error: UNAVAILABLE });

  const outcome = await withMinimumDuration(() =>
    requestPasswordReset(auth, limits, address, email, resetRedirect),
  );
  switch (outcome.status) {
    case "invalid-email":
      return state({ fieldErrors: { email: INVALID_EMAIL } });
    case "ok":
      return state({ sent: { email: outcome.email, cooldownSeconds: outcome.cooldownSeconds } });
    case "cooldown":
      // Asked a moment ago: still "check your email", with the time that is left.
      return state({
        sent: { email: email.trim().toLowerCase(), cooldownSeconds: outcome.retryAfterSeconds },
      });
    case "rate-limited":
      return state({ error: TOO_MANY_REQUESTS });
    case "unavailable":
      return state({ error: UNAVAILABLE });
  }
}

export async function resendResetAction(
  previous: ResendState,
  formData: FormData,
): Promise<ResendState> {
  const reply = (status: ResendState["status"], cooldownSeconds = 0): ResendState => ({
    nonce: previous.nonce + 1,
    status,
    cooldownSeconds,
  });
  const { auth, limits, address, resetRedirect } = await accountContext();
  if (!auth.available || !resetRedirect) return reply("error");
  const email = field(formData, "email");
  const outcome = await withMinimumDuration(() =>
    requestPasswordReset(auth, limits, address, email, resetRedirect),
  );
  switch (outcome.status) {
    case "ok":
      return reply("sent", outcome.cooldownSeconds || RESEND_COOLDOWN_SECONDS);
    case "cooldown":
      return reply("cooldown", outcome.retryAfterSeconds);
    case "rate-limited":
      return reply("limited");
    default:
      return reply("error");
  }
}
