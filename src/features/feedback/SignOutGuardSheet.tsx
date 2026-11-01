"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { ModalSheet } from "@/components/ui/ModalSheet";
import { unsentCount, useFeedbackAccess } from "./FeedbackAccess";

// The warning before Sign out when feedback is still waiting on this device (#325, design's spec). Signing out deletes unsent
// reports (#260), so the person may send them first, stay, or sign out anyway. The sheet only decides; `signOutNow` (the one shared
// sign-out path, use-sign-out.tsx) clears the device and ends the session.

/** How long "Sending…" stays up on a repeat tap. */
export const REPEAT_FEEDBACK_MS = 600;

type Phase = "idle" | "sending" | "sent" | "leaving";

export interface SignOutGuardSheetProps {
  open: boolean;
  /** Close without signing out. */
  onStay: () => void;
  /** Clear this device's feedback, then end the session. */
  signOutNow: () => Promise<void>;
}

const reportsText = (n: number) =>
  n === 1
    ? "1 report hasn’t sent yet. Signing out deletes it from this device."
    : `${n} reports haven’t sent yet. Signing out deletes them from this device.`;

export function SignOutGuardSheet({ open, onStay, signOutNow }: SignOutGuardSheetProps) {
  const fb = useFeedbackAccess();
  const [phase, setPhase] = useState<Phase>("idle");
  /** What the last Send now came to when it did not finish the job: `tap` counts the failures in a row (it also re-keys the message). */
  const [outcome, setOutcome] = useState<{ attempted: boolean; tap: number } | null>(null);
  const failed = outcome !== null;
  const tryAgain = useRef<HTMLButtonElement>(null);
  const stay = useRef<HTMLButtonElement>(null);

  const unsent = unsentCount(fb.outbox);
  const offline = fb.status?.online === false;
  const connected = fb.status?.connected === true;
  const canSend = !offline && connected;
  const allSent = phase === "idle" && unsent === 0;
  const busy = phase !== "idle";

  // The busy button kept focus (aria-disabled), so after a partial failure Try again takes it back. If Send now vanishes (the
  // connection was lost, or it was never offered) the safe choice, Stay signed in, holds focus.
  useEffect(() => {
    if (!open || phase !== "idle") return;
    if (canSend) {
      if (failed) tryAgain.current?.focus();
    } else stay.current?.focus();
  }, [open, phase, failed, canSend]);

  async function leave() {
    try {
      await signOutNow();
    } catch {
      setPhase("idle");
    }
  }

  async function sendNow() {
    if (busy) return;
    const taps = outcome?.tap ?? 0;
    setPhase("sending");
    // A repeat tap keeps "Sending…" up for a moment, so an unchanged result still reads as a fresh answer.
    const [result] = await Promise.all([
      fb.flushNow(), // never rejects: a failed send resolves with what is left
      taps > 0 ? new Promise((done) => setTimeout(done, REPEAT_FEEDBACK_MS)) : null,
    ]);
    if (result.remaining === 0) {
      setPhase("sent");
      await leave();
      return;
    }
    setOutcome({ attempted: result.attempted, tap: taps + 1 });
    setPhase("idle");
  }

  async function signOutAnyway() {
    if (busy) return;
    setPhase("leaving");
    await leave();
  }

  function stayNow() {
    if (busy) return;
    setOutcome(null);
    onStay();
  }

  const status =
    phase === "sending" ? "Sending your reports…" : phase === "sent" ? "Sent. Signing out…" : "";
  const dim = busy ? ({ "aria-disabled": true } as const) : {};
  const showSend = canSend && !allSent;

  return (
    <ModalSheet
      open={open}
      title="Feedback hasn’t sent yet"
      onClose={stayNow}
      dismissOnBackdrop={false}
      showClose={false}
      actions={
        <>
          <Button variant={allSent ? "primary" : "danger"} {...dim} onClick={signOutAnyway}>
            {allSent ? "Sign out" : phase === "leaving" ? "Signing out…" : "Sign out anyway"}
          </Button>
          <Button
            ref={stay}
            variant={showSend || allSent ? "secondary" : "primary"}
            data-modal-autofocus=""
            {...dim}
            onClick={stayNow}
          >
            Stay signed in
          </Button>
          {showSend ? (
            <Button
              ref={tryAgain}
              {...dim}
              aria-busy={phase === "sending" || undefined}
              onClick={sendNow}
            >
              {phase === "sending" ? "Sending…" : failed ? "Try again" : "Send now"}
            </Button>
          ) : null}
        </>
      }
    >
      <div className="sign-out-guard">
        <p>{allSent ? "Everything has sent. You can sign out." : reportsText(unsent)}</p>
        {allSent ? null : (
          <p className="tiny muted">Reports saved on your other devices aren’t affected.</p>
        )}
        {!showSend && !allSent ? (
          <p className="tiny muted">
            {offline
              ? "You’re offline, so these can’t be sent right now."
              : "Feedback isn’t connected, so these can’t be sent."}
          </p>
        ) : null}
        {/* Read out, never drawn: the button already says "Sending…", and a drawn line would push the sheet about 28px. */}
        <p className="sr-only" role="status">
          {status}
        </p>
        <div role="alert">
          {outcome && !allSent ? (
            outcome.attempted ? (
              <p key={outcome.tap} className="auth-error">
                <span aria-hidden="true">⚠ </span>
                {outcome.tap > 1
                  ? "Still couldn’t send. They’re still on this device."
                  : "Some reports couldn’t be sent yet. They’re still on this device."}
              </p>
            ) : (
              <p key={outcome.tap} className="tiny muted">
                Not sent yet. They’ll retry on their own in a moment, so you can wait here or try
                again shortly.
              </p>
            )
          ) : null}
        </div>
      </div>
    </ModalSheet>
  );
}
