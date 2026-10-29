"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { APPEARANCE_COOKIE } from "@/domain/appearance";
import { forgetAnonymousAppearance } from "./anonymous-appearance";
import { getAuth } from "@/server/auth/auth-runtime";
import { accountClosureEnabled } from "@/server/auth/account-closure-rollout";
import {
  ACCOUNT_CLOSURE_COMPLETE_PATH,
  issueAccountClosureCompletion,
} from "@/server/auth/account-closure-completion";
import { closeAccount, deletionSession } from "@/server/auth/close-account";
import { hasSameRequestOrigin } from "@/server/auth/csrf";
import { forgetPendingEmail } from "@/server/auth/pending-email";
import { clientAddress, signInLimits } from "@/server/auth/sign-in-limit";
import { getAppDb } from "@/server/db/app-db";
import { accountHoldsFeedback } from "@/server/feedback/enrollment-store";
import type { CloseAccountState } from "./close-account-state";

const inputSchema = z.object({
  password: z.string().min(1).max(128),
  confirmation: z.literal("DELETE"),
});

const TRY_AGAIN = "We couldn’t close your account. Nothing was deleted. Try again.";
const PARTIAL =
  "Your Packed Smart content is removed and protected by a temporary closure marker, but identity deletion wasn’t confirmed. Use Finish account closure to retry now. If you are signed out, sign in again and Packed Smart will take you straight to the recovery step.";
const PARTIAL_RETRY =
  "Your Packed Smart content is removed and protected by a temporary closure marker, but identity deletion wasn’t confirmed. Use Finish account closure below to retry now.";
const UNKNOWN =
  "We couldn’t confirm whether account closure started. Try again. If you are signed out, sign in again and Packed Smart will take you straight to the recovery step.";
const FINAL_CLEANUP =
  "Your identity and Packed Smart content were deleted, but removal of a temporary closure marker couldn’t be confirmed. Do not create a new account yet.";
const CLOSURE_DISABLED = "Account closure is not available right now. Nothing was deleted.";

/** The provider identity is already gone. Local-cookie cleanup is best effort; redirect must always complete. */
async function finishConfirmedClosure(auth: Awaited<ReturnType<typeof getAuth>>): Promise<never> {
  const completionIssued = await issueAccountClosureCompletion(auth.completionSignals);
  try {
    (await cookies()).delete(APPEARANCE_COOKIE);
  } catch {
    // Do not strand a user whose provider identity was already deleted.
  }
  try {
    await forgetAnonymousAppearance();
  } catch {
    // Do not strand a user whose provider identity was already deleted.
  }
  try {
    await forgetPendingEmail();
  } catch {
    // Do not strand a user whose provider identity was already deleted.
  }
  redirect(completionIssued ? ACCOUNT_CLOSURE_COMPLETE_PATH : "/sign-in?notice=account-closed");
}

export async function closeAccountAction(
  _previous: CloseAccountState,
  formData: FormData,
): Promise<CloseAccountState> {
  if (!accountClosureEnabled()) return { error: CLOSURE_DISABLED, fieldErrors: {} };
  const requestHeaders = await headers();
  if (!hasSameRequestOrigin(requestHeaders)) return { error: TRY_AGAIN, fieldErrors: {} };

  const raw = {
    password: typeof formData.get("password") === "string" ? formData.get("password") : "",
    confirmation:
      typeof formData.get("confirmation") === "string" ? formData.get("confirmation") : "",
  };
  const parsed = inputSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      error: null,
      fieldErrors: {
        ...(parsed.error.issues.some((issue) => issue.path[0] === "password")
          ? { password: "Enter your current password." }
          : {}),
        ...(parsed.error.issues.some((issue) => issue.path[0] === "confirmation")
          ? { confirmation: "Type DELETE exactly to confirm." }
          : {}),
      },
    };
  }

  const [auth, db] = await Promise.all([getAuth(), getAppDb()]);
  if (!auth.available || !db) return { error: TRY_AGAIN, fieldErrors: {} };
  const session = await deletionSession(auth);
  if (!session) redirect("/sign-in");

  // The Framebriar gate at the action (#261), before any rate-limit accounting or reauthentication: while the server holds this
  // account's feedback enrollment or a connection attempt, closing is refused and the sheet goes back to the Disconnect step. This
  // covers a stale tab, a second device and a hand-made request. The destructive core repeats the check on its own.
  try {
    if (await accountHoldsFeedback(db, session.userId))
      return { error: null, fieldErrors: {}, feedbackBlocking: true };
  } catch {
    return { error: TRY_AGAIN, fieldErrors: {} };
  }

  const address = clientAddress(requestHeaders);
  const limits = signInLimits();
  if (limits.blocked(session.email, address)) {
    return { error: "Too many attempts. Wait a while, then try again.", fieldErrors: {} };
  }

  const outcome = await closeAccount(auth, db, session, parsed.data.password);
  // Refused before reauthentication, so it is not a failed password and counts against no limit.
  if (outcome.status === "feedback-blocking")
    return { error: null, fieldErrors: {}, feedbackBlocking: true };
  if (outcome.status === "wrong-password") {
    limits.recordFailure(session.email, address);
    return { error: null, fieldErrors: { password: "That password wasn’t correct." } };
  }
  if (outcome.status === "unauthenticated") redirect("/sign-in");
  if (outcome.status === "unavailable") {
    const deletionStarted = outcome.deletionStarted;
    return {
      error: outcome.providerDeleted
        ? FINAL_CLEANUP
        : deletionStarted === true
          ? PARTIAL
          : deletionStarted === false
            ? TRY_AGAIN
            : UNKNOWN,
      fieldErrors: {},
      ...(deletionStarted === false || outcome.providerDeleted ? {} : { recovery: true as const }),
    };
  }

  limits.recordSuccess(session.email, address);
  return finishConfirmedClosure(auth);
}

/** Retry only an already-fenced deletion. It cannot be used as an alternate entry point for an active account. */
export async function retryCloseAccountAction(
  _previous: CloseAccountState,
  formData: FormData,
): Promise<CloseAccountState> {
  if (!accountClosureEnabled()) {
    return { error: CLOSURE_DISABLED, fieldErrors: {}, recovery: true };
  }
  const requestHeaders = await headers();
  if (!hasSameRequestOrigin(requestHeaders)) return { error: TRY_AGAIN, fieldErrors: {} };

  const raw = {
    password: typeof formData.get("password") === "string" ? formData.get("password") : "",
    confirmation:
      typeof formData.get("confirmation") === "string" ? formData.get("confirmation") : "",
  };
  const parsed = inputSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      error: null,
      fieldErrors: {
        ...(parsed.error.issues.some((issue) => issue.path[0] === "password")
          ? { password: "Enter your current password." }
          : {}),
        ...(parsed.error.issues.some((issue) => issue.path[0] === "confirmation")
          ? { confirmation: "Type DELETE exactly to confirm." }
          : {}),
      },
      recovery: true,
    };
  }

  const [auth, db] = await Promise.all([getAuth(), getAppDb()]);
  if (!auth.available || !db) return { error: PARTIAL_RETRY, fieldErrors: {}, recovery: true };
  const session = await deletionSession(auth);
  if (!session) redirect("/sign-in");
  let deletionPending = false;
  try {
    deletionPending = (await auth.setup.isAccountDeletionBlocked?.(session.userId)) ?? false;
  } catch {
    return { error: PARTIAL_RETRY, fieldErrors: {}, recovery: true };
  }
  if (!deletionPending) redirect("/settings");

  const address = clientAddress(requestHeaders);
  const limits = signInLimits();
  if (limits.blocked(session.email, address)) {
    return {
      error: "Too many attempts. Wait a while, then try again.",
      fieldErrors: {},
      recovery: true,
    };
  }
  const outcome = await closeAccount(auth, db, session, parsed.data.password);
  if (outcome.status === "wrong-password") {
    limits.recordFailure(session.email, address);
    return {
      error: null,
      fieldErrors: { password: "That password wasn’t correct." },
      recovery: true,
    };
  }
  if (outcome.status === "unauthenticated") redirect("/sign-in");
  // A fenced retry has no owner row left, so this cannot happen; if it ever does, nothing was done and the retry stays available.
  if (outcome.status === "feedback-blocking")
    return { error: TRY_AGAIN, fieldErrors: {}, recovery: true };
  if (outcome.status === "unavailable") {
    return outcome.providerDeleted
      ? { error: FINAL_CLEANUP, fieldErrors: {} }
      : { error: PARTIAL_RETRY, fieldErrors: {}, recovery: true };
  }

  limits.recordSuccess(session.email, address);
  return finishConfirmedClosure(auth);
}
