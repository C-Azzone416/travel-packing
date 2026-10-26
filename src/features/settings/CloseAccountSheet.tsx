"use client";

import Link from "next/link";
import { useActionState, useId } from "react";
import { Button } from "@/components/ui/Button";
import { ModalSheet } from "@/components/ui/ModalSheet";
import { PasswordField, TextField } from "@/features/auth/AuthParts";
import { INITIAL_CLOSE_ACCOUNT_STATE, type CloseAccountState } from "./close-account-state";

export function CloseAccountSheet({
  action,
  onClose,
}: {
  action: (previous: CloseAccountState, formData: FormData) => Promise<CloseAccountState>;
  onClose: () => void;
}) {
  const formId = useId();
  const [state, formAction, pending] = useActionState(action, INITIAL_CLOSE_ACCOUNT_STATE);
  return (
    <ModalSheet
      open
      title="Close your account?"
      description="This permanently removes your account identity, trips, packing lists, Staples, saved lists, and preferences. An opaque security record is kept to prevent deleted data from being recreated. It can’t be undone."
      onClose={onClose}
      dismissOnBackdrop={false}
      actions={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button
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
      <form id={formId} action={formAction} className="close-account-form" noValidate>
        <p>
          To confirm, enter your current password and type <strong>DELETE</strong>.
        </p>
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
            {state.recovery ? <Link href="/close-account">Finish account closure</Link> : null}
          </div>
        ) : null}
      </form>
    </ModalSheet>
  );
}
