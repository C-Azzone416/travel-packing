import type { ReactNode } from "react";

// Hosted builds resolve every Framebriar entry point to this file. Keep it free of SDK imports and feature copy: the
// production build scan asserts both stay out of the output.
export function FeedbackAccessProvider({ children }: { children: ReactNode }) {
  return children;
}

export async function clearLocalFeedbackAfterAccountClosure(): Promise<void> {}

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
