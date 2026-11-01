// The words for what Disconnect came to (#304; design's #261 spec, section 3). One table, shared by Settings and by any other surface
// that offers Disconnect, so the messages cannot drift apart. Each is true of exactly what happened: nothing says "ended" when the
// access could not be ended, and nothing says "still connected" when the saved copy is already gone.

import { REDEMPTION_WINDOW_MINUTES } from "@/domain/redemption-window";
import type { DisconnectResult } from "./FeedbackAccess";

const DATE = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });

/** The results that finished the disconnect. Everything else changed nothing or not everything, and can be repeated. */
export const DISCONNECT_SUCCESS: readonly DisconnectResult[] = [
  "ended",
  "nothing",
  "erased_unrevocable",
];

export const isDisconnectSuccess = (result: DisconnectResult): boolean =>
  DISCONNECT_SUCCESS.includes(result);

const FIXED: Record<Exclude<DisconnectResult, "erased_unrevocable">, string> = {
  ended: "Disconnected. Your feedback access was ended.",
  nothing: "You weren’t connected, so there was nothing to end.",
  partial:
    "Your feedback access was ended, but we couldn’t finish removing this app’s saved copy. Try again to finish.",
  unavailable:
    "We couldn’t reach the service to end the access. You’re still connected. Try again.",
  uncertain:
    "We couldn’t confirm whether your access was ended. You may still be connected. Try again.",
  pending: `Connecting didn’t finish, so it can’t be ended just yet. Wait up to ${REDEMPTION_WINDOW_MINUTES} minutes and try again.`,
  offline: "You’re offline, so nothing was changed. Disconnect again when you’re back online.",
  "signed-out": "You’ve been signed out, so nothing was changed. Sign in again to disconnect.",
};

/** The date the leftover access ends, or null when it was not known before disconnecting. */
export function deadlineDate(expiresAt: string | null | undefined): string | null {
  const date = expiresAt ? new Date(expiresAt) : null;
  return date && !Number.isNaN(date.getTime()) ? DATE.format(date) : null;
}

/** `expiresAt` is the access deadline the status showed BEFORE disconnecting (the status is gone afterwards). */
export function disconnectText(result: DisconnectResult, expiresAt?: string | null): string {
  if (result !== "erased_unrevocable") return FIXED[result];
  const date = deadlineDate(expiresAt);
  return `Disconnected. We removed this app’s copy of your feedback connection, but we couldn’t end the access itself. It stops on its own ${
    date ? `on ${date}` : "at the deadline Framebriar set"
  }. Feedback can’t be sent from this app.`;
}
