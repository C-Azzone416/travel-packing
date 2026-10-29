"use client";

import Link from "next/link";
import { useActionState, useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/Button";
import { ModalSheet } from "@/components/ui/ModalSheet";
import { PasswordField, TextField } from "@/features/auth/AuthParts";
import { useClosureFeedback } from "@/features/feedback/CloseAccountFeedback";
import type { ClosureContinue } from "@/features/feedback/closure-feedback-types";
import { INITIAL_CLOSE_ACCOUNT_STATE, type CloseAccountState } from "./close-account-state";

type Step = "decide" | "disconnect" | "confirm";

/**
 * One sheet, two steps (#261). Step 1, only when this account has a feedback enrollment or an unfinished connection, disconnects
 * feedback right here; step 2 is the permanent-deletion confirmation. Whether step 1 exists is decided once when the sheet opens and
 * then latched, so it cannot vanish mid-flow when the status refreshes after Disconnect. The server refuses to close while any
 * feedback remains (a stale tab, a second device, a hand-made request): that sends the sheet back to step 1.
 */
export function CloseAccountSheet({
  action,
  onClose,
}: {
  action: (previous: CloseAccountState, formData: FormData) => Promise<CloseAccountState>;
  onClose: () => void;
}) {
  const formId = useId();
  const [state, formAction, pending] = useActionState(action, INITIAL_CLOSE_ACCOUNT_STATE);
  const [step, setStep] = useState<Step>("decide");
  const [bounced, setBounced] = useState(false);
  const [carried, setCarried] = useState<ClosureContinue | null>(null);
  const [handled, setHandled] = useState(state);
  const feedback = useClosureFeedback({
    bounced,
    onContinue: (info) => {
      setCarried(info);
      setStep("confirm");
    },
  });

  // Latch once: step 1 when the server holds feedback for this account, otherwise straight to the confirmation.
  if (step === "decide" && feedback.needs !== "checking")
    setStep(feedback.needs === "required" ? "disconnect" : "confirm");

  // A closing attempt the server refused because feedback is still connected: back to step 1, with the password and DELETE fields
  // gone (the form unmounts, so nothing typed lingers in the page).
  if (state !== handled) {
    setHandled(state);
    if (state.feedbackBlocking) {
      setBounced(true);
      setCarried(null);
      setStep("disconnect");
    }
  }

  const { forgetOutbox, refresh } = feedback;
  useEffect(() => {
    if (state === INITIAL_CLOSE_ACCOUNT_STATE) return;
    // The attempt did not end in closure: no account is closing, so no outbox is remembered as the one to delete.
    forgetOutbox();
    if (state.feedbackBlocking) void refresh();
  }, [state, forgetOutbox, refresh]);

  // Moving to the confirmation puts focus in the password field, as when the sheet opens straight on it.
  useEffect(() => {
    if (step === "confirm") document.getElementById("close-account-password")?.focus();
  }, [step]);

  const working = pending || feedback.step.busy;
  const hadStepOne = step === "disconnect" || carried !== null || bounced;

  function close() {
    // Escape and Cancel do nothing while a disconnect is in flight: it cannot be taken back half way.
    if (feedback.step.busy) return;
    forgetOutbox();
    onClose();
  }

  if (step !== "confirm") {
    return (
      <ModalSheet
        open
        title={feedback.step.title}
        description={feedback.step.description}
        eyebrow={step === "disconnect" ? "Step 1 of 2" : undefined}
        onClose={close}
        dismissOnBackdrop={false}
        actions={
          <>
            <Button variant="secondary" onClick={close} disabled={working}>
              Cancel
            </Button>
            {feedback.step.actions}
          </>
        }
      >
        {feedback.step.body}
      </ModalSheet>
    );
  }

  return (
    <ModalSheet
      open
      title="Close your account?"
      description="This permanently deletes your account identity, trips, packing lists, Staples, saved lists, and preferences. Confirmed closure leaves no live Packed Smart account record. Feedback you already sent to the developer can’t be deleted from here. Provider backups may follow separate retention policies. It can’t be undone."
      eyebrow={hadStepOne ? "Step 2 of 2" : undefined}
      onClose={close}
      dismissOnBackdrop={false}
      actions={
        <>
          <Button variant="secondary" onClick={close} disabled={pending}>
            Cancel
          </Button>
          {/* A key of its own: this button must never be the very element step 1's Continue was, or the click that moves to this step
              would also submit the (still blank) form once the element became a submit button. */}
          <Button
            key="close"
            variant="danger"
            type="submit"
            form={formId}
            disabled={pending}
            aria-busy={pending}
          >
            {pending ? "Closing…" : "Close account permanently"}
          </Button>
        </>
      }
    >
      {/* While this is open no feedback screenshot is taken at all (#273): it holds a password and a confirmation. */}
      <form
        id={formId}
        action={formAction}
        onSubmit={feedback.rememberOutbox}
        className="close-account-form"
        data-feedback-sensitive-portal=""
        noValidate
      >
        <p>
          To confirm, enter your current password and type <strong>DELETE</strong>.
        </p>
        {feedback.notes(carried, hadStepOne)}
        <PasswordField
          id="close-account-password"
          name="password"
          label="Current password"
          autoComplete="current-password"
          modalAutoFocus
          error={pending ? undefined : state.fieldErrors.password}
        />
        <TextField
          id="close-account-confirmation"
          name="confirmation"
          label="Type DELETE to confirm"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          required
          error={pending ? undefined : state.fieldErrors.confirmation}
        />
        {!pending && state.error ? (
          <div className="auth-error" role="alert">
            <span aria-hidden="true">⚠ </span>
            {state.error}{" "}
            {state.recovery ? (
              <Link className="auth-link inline-link" href="/close-account">
                Finish account closure
              </Link>
            ) : null}
          </div>
        ) : null}
      </form>
    </ModalSheet>
  );
}
