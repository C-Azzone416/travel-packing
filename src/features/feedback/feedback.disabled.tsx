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
