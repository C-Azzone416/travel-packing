"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { ModalSheet } from "@/components/ui/ModalSheet";

export interface DeleteListSheetProps {
  name: string;
  /** Delete the list; resolves false when it did not go through (the sheet stays open and says so). */
  onDelete: () => Promise<boolean>;
  onClose: () => void;
}

// Delete a saved list (#167). The words matter: trips made from a list keep their own copy. Permanent, and the sheet says so
// (Caroline's decision): no undo.
export function DeleteListSheet({ name, onDelete, onClose }: DeleteListSheetProps) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function confirm() {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    const done = await onDelete();
    setBusy(false);
    if (!done) setFailed(true);
  }

  return (
    <ModalSheet
      open
      title={`Delete “${name}”?`}
      description="This can't be undone. Trips already made from this list aren't affected. The list and its items are removed."
      onClose={onClose}
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" disabled={busy} onClick={() => void confirm()}>
            Delete list
          </Button>
        </>
      }
    >
      {failed ? (
        <p className="field-error" role="alert">
          Couldn’t delete. Nothing was changed.
        </p>
      ) : null}
    </ModalSheet>
  );
}
