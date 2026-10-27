import { clearLocalFeedbackAfterAccountClosure } from "@/features/feedback/account-closure-cleanup";

/** Called only after the one-time confirmed-deletion signal has been consumed. */
export const runConfirmedAccountClosureClientCleanup = clearLocalFeedbackAfterAccountClosure;
