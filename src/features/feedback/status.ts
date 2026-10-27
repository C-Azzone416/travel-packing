// What the feedback UI knows about the account's enrollment (#260), reduced from the server's answer plus what only the browser
// can know (is it online, did a send just get limited). Pure, so every state can be tested without a page.

import type { EnrollmentState, EnrollmentView } from "./enrollment-client";

/** Things the strip under the header may say. Each means "feedback cannot send until something changes", and none leaves the app unusable. */
export type FeedbackNoticeKind =
  "expired" | "revoked" | "disabled" | "unavailable" | "needs-reconnect" | "finish-connecting";

export interface FeedbackStatus {
  /** The server's last answer: unavailable, not-connected, connected, expired, revoked or disabled. */
  connection: EnrollmentState;
  expiresAt: string | null;
  /** A redemption was started and its answer lost: the same invitation finishes it. */
  pendingRedemption: boolean;
  /** False after a request could not reach the server, until one can again. Saved reports still work offline. */
  online: boolean;
  /** A recent send was refused as "too many for now"; reports wait on this device. */
  rateLimited: boolean;
  connected: boolean;
  /** The Feedback button works only while connected. Saving needs no network, so being offline does not turn it off. */
  canCapture: boolean;
  notice: FeedbackNoticeKind | null;
}

export function feedbackStatus(
  view: EnrollmentView,
  options: { online: boolean; rateLimited: boolean },
): FeedbackStatus {
  const connected = view.status === "connected";
  const pendingRedemption = view.redemption === "pending" && !connected;
  const notice: FeedbackNoticeKind | null =
    view.status === "expired" ||
    view.status === "revoked" ||
    view.status === "disabled" ||
    view.status === "unavailable"
      ? view.status
      : view.status === "needs_reconnect"
        ? "needs-reconnect"
        : pendingRedemption
          ? "finish-connecting"
          : null;
  return {
    connection: view.status,
    expiresAt: connected ? view.expiresAt : null,
    pendingRedemption,
    online: options.online,
    rateLimited: options.rateLimited,
    connected,
    canCapture: connected,
    notice,
  };
}
