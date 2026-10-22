"use client";

import { useActionState, useState } from "react";
import { RESEND_COPY, TOO_MANY_REQUESTS, UNAVAILABLE } from "./copy";
import { useCountdown } from "./hooks";
import { INITIAL_RESEND, type ResendState } from "./state";

/**
 * "Send a new code" / "Send it again" with its 30-second gap (design spec #27).
 * - The gap is enforced on the server too; this only shows it. The ticking text is visual only (aria-hidden).
 * - One persistent polite live region announces twice per send and never per tick: "sent" when the answer arrives and
 *   "ready" when the gap ends. The button takes the text's place in the DOM, so focus order does not jump.
 * - A server cap ("a few minutes") or an outage is shown as plain text in the same live region.
 */
export function ResendControl({
  kind,
  action,
  email,
  initialCooldown = 0,
}: {
  kind: "verify" | "reset" | "setup";
  action: (previous: ResendState, formData: FormData) => Promise<ResendState>;
  /** Sent along when the page does not already know the address (it is otherwise remembered server-side). */
  email?: string;
  initialCooldown?: number;
}) {
  const copy = RESEND_COPY[kind];
  const [announcement, setAnnouncement] = useState("");
  const countdown = useCountdown(initialCooldown, () => setAnnouncement(copy.ready));
  // Each answer from the server starts the gap it names and says what happened. This runs in the action itself, so it is
  // an event, not a render or an effect.
  const [, formAction, pending] = useActionState(
    async (previous: ResendState, formData: FormData) => {
      const next = await action(previous, formData);
      if (next.status === "sent" || next.status === "cooldown")
        countdown.start(next.cooldownSeconds);
      if (next.status === "sent") setAnnouncement(copy.sent);
      else if (next.status === "limited") setAnnouncement(TOO_MANY_REQUESTS);
      else if (next.status === "error") setAnnouncement(UNAVAILABLE);
      else setAnnouncement("");
      return next;
    },
    INITIAL_RESEND,
  );

  const waiting = countdown.remaining > 0;
  const visibleNote = announcement === TOO_MANY_REQUESTS || announcement === UNAVAILABLE;
  return (
    <div className="resend-row">
      <form
        action={formAction}
        onSubmit={(event) => {
          if (pending) event.preventDefault();
        }}
      >
        {email ? <input type="hidden" name="email" value={email} /> : null}
        {waiting ? (
          <span className="resend-wait" aria-hidden="true">
            {copy.wait(countdown.remaining)}
          </span>
        ) : (
          <button type="submit" className="auth-link auth-link-button" aria-busy={pending}>
            {copy.button}
          </button>
        )}
      </form>
      <p role="status" className={visibleNote ? "resend-note" : "sr-only"}>
        {announcement}
      </p>
    </div>
  );
}
