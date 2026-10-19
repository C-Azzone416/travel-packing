"use server";

import { accountContext } from "@/features/auth/server";
import type { ResendState } from "@/features/auth/state";
import { requestPasswordReset } from "@/server/auth/account-flows";
import { withMinimumDuration } from "@/server/auth/min-duration";
import { pendingEmail } from "@/server/auth/pending-email";

/** Send the "finish setting up" link again to the remembered address, with the same 30-second gap as every other send. */
export async function resendSetupAction(
  previous: ResendState,
  _formData: FormData,
): Promise<ResendState> {
  const reply = (status: ResendState["status"], cooldownSeconds = 0): ResendState => ({
    nonce: previous.nonce + 1,
    status,
    cooldownSeconds,
  });
  const { auth, limits, address, setupRedirect } = await accountContext();
  const email = await pendingEmail();
  if (!auth.available || !setupRedirect || !email) return reply("error");
  const outcome = await withMinimumDuration(() =>
    requestPasswordReset(auth, limits, address, email, setupRedirect),
  );
  switch (outcome.status) {
    case "ok":
      return reply("sent", outcome.cooldownSeconds);
    case "cooldown":
      return reply("cooldown", outcome.retryAfterSeconds);
    case "rate-limited":
      return reply("limited");
    default:
      return reply("error");
  }
}
