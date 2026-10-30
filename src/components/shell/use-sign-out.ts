"use client";

import { useCallback } from "react";
import { useFeedbackSignOut } from "@/features/feedback/FeedbackAccess";

/**
 * The ONE sign-out path for every Sign out button (the nav and Settings, #327). The account's unsent feedback notes and
 * screenshots leave this device before the session does (#260), then the server action ends the session. Anything that must
 * happen before sign-out (the warning sheet in #325) hooks in here, once.
 */
export function useSignOut(signOut: (() => Promise<void>) | undefined): () => Promise<void> {
  const clearFeedback = useFeedbackSignOut();
  return useCallback(async () => {
    await clearFeedback();
    await signOut?.();
  }, [clearFeedback, signOut]);
}
