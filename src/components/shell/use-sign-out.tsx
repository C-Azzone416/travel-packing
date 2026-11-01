"use client";

import { useCallback, useState, type ReactNode } from "react";
import {
  unsentCount,
  useFeedbackAccess,
  useFeedbackSignOut,
} from "@/features/feedback/FeedbackAccess";
import { SignOutGuardSheet } from "@/features/feedback/SignOutGuardSheet";

export interface SignOut {
  /** The `<form action>` for a Sign out button. */
  action: () => Promise<void>;
  /** The warning sheet (#325). Render it once next to the form; it shows only when feedback is waiting to send. */
  sheet: ReactNode;
}

/**
 * The ONE sign-out path for every Sign out button (the nav and Settings, #327). With no unsent feedback it is one tap: the account's
 * feedback leaves this device before the session does (#260), then the server action ends the session. With unsent feedback it
 * opens the warning sheet instead (#325), whose choices end in the same two steps.
 */
export function useSignOut(signOut: (() => Promise<void>) | undefined): SignOut {
  const clearFeedback = useFeedbackSignOut();
  const { outbox } = useFeedbackAccess();
  const [warning, setWarning] = useState(false);
  const run = useCallback(async () => {
    await clearFeedback();
    await signOut?.();
  }, [clearFeedback, signOut]);
  const hasUnsent = outbox.state === "available" && unsentCount(outbox) > 0;
  const action = useCallback(async () => {
    if (hasUnsent) setWarning(true);
    else await run();
  }, [hasUnsent, run]);
  return {
    action,
    sheet: <SignOutGuardSheet open={warning} onStay={() => setWarning(false)} signOutNow={run} />,
  };
}
