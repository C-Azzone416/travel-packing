"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { ModalSheet } from "@/components/ui/ModalSheet";

export const LIST_NAME_MAX = 60;

export type RenameOutcome = { ok: true } | { ok: false; reason: "NAME_TAKEN" | "FAILED" };

export interface ListNameSheetProps {
  currentName: string;
  /** Save the new name; resolves with why it did not save, so the sheet can say so beside the field. */
  onSave: (name: string) => Promise<RenameOutcome>;
  onClose: () => void;
}

// Rename a saved list (#167, design §3). Names are unique per owner once normalised; the sheet stays open on a problem.
export function ListNameSheet({ currentName, onSave, onClose }: ListNameSheetProps) {
  const [name, setName] = useState(currentName);
  const [problem, setProblem] = useState<null | "EMPTY" | "NAME_TAKEN" | "FAILED">(null);
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    const trimmed = name.trim();
    if (trimmed === "") return setProblem("EMPTY");
    setSaving(true);
    const outcome = await onSave(trimmed);
    setSaving(false);
    if (!outcome.ok) setProblem(outcome.reason);
  }

  const message =
    problem === "EMPTY"
      ? "Give the list a name."
      : problem === "NAME_TAKEN"
        ? `You already have a list called “${name.trim()}”. Pick another name.`
        : null;

  return (
    <ModalSheet open showClose title="Rename list" onClose={onClose}>
      <form className="form-grid" onSubmit={submit} noValidate>
        <label className="field">
          List name
          <input
            name="name"
            value={name}
            maxLength={LIST_NAME_MAX}
            autoComplete="off"
            autoFocus
            aria-invalid={message !== null}
            aria-describedby={message ? "list-name-error" : undefined}
            onChange={(event) => {
              setName(event.target.value);
              setProblem(null);
            }}
          />
        </label>
        {message ? (
          <span id="list-name-error" className="field-error" role="alert">
            {message}
          </span>
        ) : null}
        {problem === "FAILED" ? (
          <p className="field-error" role="alert">
            Couldn’t save. Nothing was changed.
          </p>
        ) : null}
        <div className="actions">
          <Button type="submit" disabled={saving}>
            Save
          </Button>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </ModalSheet>
  );
}
