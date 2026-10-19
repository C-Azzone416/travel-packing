"use server";

import { redirect } from "next/navigation";
import { accountContext, field } from "@/features/auth/server";
import {
  INVALID_EMAIL,
  LOCKED_CODE,
  MISSING_CODE,
  TOO_MANY_REQUESTS,
  UNAVAILABLE,
  WRONG_CODE,
} from "@/features/auth/copy";
import type { FormState, ResendState } from "@/features/auth/state";
import { cleanEmail, resendVerificationCode, verifyOwnerEmail } from "@/server/auth/account-flows";
import { withMinimumDuration } from "@/server/auth/min-duration";
import { forgetPendingEmail, pendingEmail } from "@/server/auth/pending-email";
import { ACCESS_DENIED_PATH, SIGN_IN_PATH } from "@/server/auth/public-paths";

/** The address being verified: the remembered one, else what was typed. */
async function addressFor(formData: FormData): Promise<string> {
  return (await pendingEmail()) ?? field(formData, "email");
}

export async function verifyAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const email = await addressFor(formData);
  const state = (changes: Partial<FormState>): FormState => ({
    error: null,
    fieldErrors: {},
    email,
    ...changes,
  });
  const fieldErrors = {
    ...(cleanEmail(email) ? {} : { email: INVALID_EMAIL }),
    ...(field(formData, "code").trim() ? {} : { code: MISSING_CODE }),
  };
  if (Object.keys(fieldErrors).length > 0) return state({ fieldErrors });
  const { auth, limits } = await accountContext();
  if (!auth.available) return state({ error: UNAVAILABLE });

  const outcome = await withMinimumDuration(() =>
    verifyOwnerEmail(auth, limits, email, field(formData, "code")),
  );
  switch (outcome.status) {
    case "signed-in":
      await forgetPendingEmail();
      redirect("/");
    case "verified":
      await forgetPendingEmail();
      redirect(`${SIGN_IN_PATH}?notice=verified`);
    case "denied":
      await forgetPendingEmail();
      redirect(ACCESS_DENIED_PATH);
    case "invalid":
      return state({ code: field(formData, "code"), fieldErrors: { code: WRONG_CODE } });
    case "locked":
      return state({ fieldErrors: { code: LOCKED_CODE } });
    case "rate-limited":
      return state({ error: TOO_MANY_REQUESTS });
    case "unavailable":
      return state({ error: UNAVAILABLE });
  }
}

export async function resendVerifyAction(
  previous: ResendState,
  formData: FormData,
): Promise<ResendState> {
  const reply = (status: ResendState["status"], cooldownSeconds = 0): ResendState => ({
    nonce: previous.nonce + 1,
    status,
    cooldownSeconds,
  });
  const { auth, limits, address } = await accountContext();
  if (!auth.available) return reply("error");
  const email = await addressFor(formData);
  const outcome = await withMinimumDuration(() =>
    resendVerificationCode(auth, limits, address, email),
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
