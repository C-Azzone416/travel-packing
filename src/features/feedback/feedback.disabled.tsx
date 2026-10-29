import type { ReactNode } from "react";
import { NO_CLOSURE_FEEDBACK, type ClosureFeedback } from "./closure-feedback-types";

// Hosted builds resolve every Framebriar entry point to this file. Keep it free of SDK imports and feature copy: the
// production build scan asserts both stay out of the output.
export function FeedbackAccessProvider({ children }: { children: ReactNode }) {
  return children;
}

export async function clearLocalFeedbackAfterAccountClosure(): Promise<void> {}

// Account closure (#261). With no feedback in this build there is no enrollment to disconnect and no outbox to remember.
export function useClosureFeedback(): ClosureFeedback {
  return NO_CLOSURE_FEEDBACK;
}

export function FeedbackButton() {
  return null;
}

export function FeedbackNotice() {
  return null;
}

export function FeedbackSettings() {
  return null;
}

// Sign-out clears unsent feedback on the device. With no feedback in this build there is nothing to clear.
export function useFeedbackSignOut(): () => Promise<void> {
  return async () => undefined;
}
