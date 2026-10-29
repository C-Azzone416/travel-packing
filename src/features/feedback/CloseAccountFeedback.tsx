"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { forgetClosingOutbox, rememberClosingOutbox } from "./account-closure-cleanup";
import type { ClosureContinue, ClosureFeedback } from "./closure-feedback-types";
import { deadlineDate, disconnectText, isDisconnectSuccess } from "./disconnect-copy";
import { useFeedbackAccess, type DisconnectResult } from "./FeedbackAccess";
import { connectionBadge, expiryText, plural } from "./FeedbackSettings";
import type { FeedbackStatus } from "./status";

// The "Disconnect feedback first" step of Close account (#261, design's spec). Closing an account deletes the owner row, and the
// sealed Framebriar credentials cascade with it, so the person must disconnect (revoke and erase) first, right here in the flow. The
// step uses the same `disconnect` and the same result copy as Settings. Nothing in a failure moves toward deletion: no Continue, no
// password field. The sheet owns the two-step state; this hook owns what feedback knows and the step's content.

const BOUNCED =
  "Feedback is still connected to your account, possibly from another device or tab. Disconnect it to continue. Nothing was deleted.";

export function useClosureFeedback({
  bounced,
  onContinue,
}: {
  /** A closing attempt was refused because the server still holds feedback for this account. */
  bounced: boolean;
  onContinue: (info: ClosureContinue) => void;
}): ClosureFeedback {
  const fb = useFeedbackAccess();
  const resultId = useId();
  const disconnectId = useId();
  const wrapper = useRef<HTMLElement | null>(null);
  // What the status said when Disconnect was pressed: the live status changes under the step once the disconnect works.
  const [snapshot, setSnapshot] = useState<FeedbackStatus | null>(null);
  const [deadline, setDeadline] = useState<string | null>(null);
  const [result, setResult] = useState<DisconnectResult | null>(null);
  const [busy, setBusy] = useState(false);

  const status = fb.status;
  const needs: ClosureFeedback["needs"] = !fb.available
    ? "none"
    : status === null
      ? "checking"
      : status.hasRecord
        ? "required"
        : "none";
  const unsent = fb.outbox.waiting + fb.outbox.blocked;

  // Focus goes to the step's own container when it appears, and to Continue when it appears (a stable callback, so it runs on mount
  // only and never steals focus on a later render).
  const focusContainer = useCallback((node: HTMLElement | null) => {
    wrapper.current = node;
    node?.focus();
  }, []);
  const focusOnMount = useCallback((node: HTMLElement | null) => node?.focus(), []);

  // After a failure the button is back and keeps focus (it was disabled during the call, which drops focus to the page).
  useEffect(() => {
    if (!busy && result !== null && !isDisconnectSuccess(result))
      document.getElementById(disconnectId)?.focus();
  }, [busy, result, disconnectId]);

  async function disconnect() {
    if (busy) return;
    setResult(null);
    setSnapshot(status);
    setDeadline(status?.expiresAt ?? null);
    setBusy(true);
    wrapper.current?.focus();
    const outcome = await fb.disconnect();
    setBusy(false);
    setResult(outcome);
  }

  const scope = fb.scopeKey;
  const rememberOutbox = useCallback(() => rememberClosingOutbox(scope), [scope]);
  const forgetOutbox = useCallback(() => forgetClosingOutbox(), []);

  const shown = snapshot ?? status;
  const badge = shown ? connectionBadge(shown) : null;
  const expiry = shown?.connected ? expiryText(shown.expiresAt) : null;
  const done = result !== null && isDisconnectSuccess(result);
  const failed = result !== null && !done;

  const body =
    needs === "checking" && result === null && snapshot === null ? (
      <div
        ref={focusContainer}
        tabIndex={-1}
        data-modal-autofocus=""
        data-feedback-sensitive-portal=""
      >
        <p className="tiny muted" role="status" aria-busy="true">
          Checking your feedback access…
        </p>
      </div>
    ) : (
      <div
        ref={focusContainer}
        tabIndex={-1}
        data-modal-autofocus=""
        data-feedback-sensitive-portal=""
        className="close-account-form"
      >
        {bounced && !done ? (
          <p className="auth-error" role="alert">
            <span aria-hidden="true">⚠ </span>
            {BOUNCED}
          </p>
        ) : null}
        {badge ? (
          <div className="feedback-state">
            <StatusBadge status={badge.tone}>{badge.label}</StatusBadge>
            {expiry ? <p className="tiny muted">{expiry}</p> : null}
          </div>
        ) : null}
        <p>
          Disconnecting ends your feedback access on every device. You’ll need a new invitation to
          connect again.
        </p>
        {unsent > 0 ? (
          <>
            <p className="tiny muted">
              {plural(unsent, "unsent report", "unsent reports")} on this device will be deleted
              when you close your account. They won’t be sent.
            </p>
            <p className="tiny muted">
              Reports saved on your other devices can’t be reached from here.
            </p>
          </>
        ) : null}
        <p className="tiny muted">Feedback you already sent can’t be deleted from here.</p>
        {/* Both live regions stay in the page so a result is announced when it appears; a failure is never colour alone. */}
        <div role="status" className="tiny" id={resultId}>
          {done ? disconnectText(result, deadline) : null}
        </div>
        <div role="alert" className="tiny">
          {failed ? (
            <p>
              <span aria-hidden="true">⚠ </span>
              {disconnectText(result, deadline)}
            </p>
          ) : null}
        </div>
      </div>
    );

  const actions =
    needs === "checking" && result === null && snapshot === null ? null : done ? (
      <Button
        key="continue"
        ref={focusOnMount}
        aria-describedby={resultId}
        onClick={() =>
          onContinue({
            unrevocable: result === "erased_unrevocable",
            deadline,
          })
        }
      >
        Continue
      </Button>
    ) : (
      <Button
        key="act"
        id={disconnectId}
        variant="danger"
        disabled={busy}
        aria-busy={busy}
        onClick={() => void disconnect()}
      >
        {busy
          ? "Disconnecting…"
          : failed && result !== "offline" && result !== "signed-out"
            ? "Try again"
            : "Disconnect"}
      </Button>
    );

  return {
    needs,
    unsent,
    rememberOutbox,
    forgetOutbox,
    refresh: fb.refresh,
    notes: (carried, hadStepOne) => {
      const date = deadlineDate(carried?.deadline);
      return (
        <>
          {carried?.unrevocable ? (
            <p className="tiny muted">
              Any feedback access that couldn’t be ended stops on its own{date ? ` on ${date}` : ""}
              .
            </p>
          ) : null}
          {!hadStepOne && unsent > 0 ? (
            <p className="tiny muted">
              {plural(unsent, "unsent report", "unsent reports")} on this device will be deleted
              when you close your account. They won’t be sent.
            </p>
          ) : null}
        </>
      );
    },
    step: {
      title: "Disconnect feedback first",
      description:
        "To close your account, we first end your feedback connection. This cannot be left for later.",
      body,
      actions,
      busy,
    },
  };
}
