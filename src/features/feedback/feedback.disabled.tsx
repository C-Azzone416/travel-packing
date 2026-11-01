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

// The report sheet's host (#293): nothing in a hosted build.
export function FeedbackReportHost() {
  return null;
}

// The Feedback item itself (copy and markup): nothing in a hosted build.
export function FeedbackTabItem(_props: { disabled: boolean; onOpen: () => void }) {
  return null;
}

// The phone tab bar's 4th slot (#293). Always off here, so it stays Sign out and no Feedback markup or copy is in the output.
export function useFeedbackTab(): { enabled: boolean; disabled: boolean; open: () => void } {
  return { enabled: false, disabled: true, open: () => undefined };
}

export function FeedbackNotice() {
  return null;
}

export function FeedbackSettings() {
  return null;
}

export function FeedbackEditorEntry() {
  return null;
}

// Sign-out clears unsent feedback on the device. With no feedback in this build there is nothing to clear.
export function useFeedbackSignOut(): () => Promise<void> {
  return async () => undefined;
}

// The sign-out warning (#325). With no feedback in this build nothing is ever unsent, so Sign out stays one tap and the sheet
// (and its copy) is not in the output.
export function useFeedbackAccess(): {
  outbox: {
    waiting: number;
    blocked: number;
    state: "checking" | "available" | "storage-unavailable";
  };
} {
  return { outbox: { waiting: 0, blocked: 0, state: "checking" } };
}

export function unsentCount(outbox: { waiting: number }): number {
  return outbox.waiting;
}

export function SignOutGuardSheet(_props: {
  open: boolean;
  onStay: () => void;
  signOutNow: () => Promise<void>;
}) {
  return null;
}
