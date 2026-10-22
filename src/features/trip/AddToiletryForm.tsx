"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { ModalSheet } from "@/components/ui/ModalSheet";
import { Switch } from "@/components/ui/Switch";
import type { Scope } from "@/domain/trip";
import type { NewToiletryItem } from "@/features/trips/trips-source";
import { ScopeChoice } from "./ScopeChoice";

export interface AddToiletryFormProps {
  destination: string;
  saving: boolean;
  onClose: () => void;
  onAdd: (item: NewToiletryItem) => void;
  /** Filled in when the person arrives from "＋ Add item" with Bathroom chosen. */
  initialName?: string;
  initialQty?: number;
}

// Adds one normal Bathroom checkbox, for this trip or for future trips too, optionally flagged Pack last.
export function AddToiletryForm({
  destination,
  saving,
  onClose,
  onAdd,
  initialName = "",
  initialQty = 1,
}: AddToiletryFormProps) {
  const [name, setName] = useState(initialName);
  const [qty, setQty] = useState(String(initialQty));
  const [packLast, setPackLast] = useState(false);
  const [scope, setScope] = useState<Scope>("this-trip");
  const [nameError, setNameError] = useState(false);

  function submit(event: FormEvent) {
    event.preventDefault();
    // The button is disabled while saving, but Enter in a field submits the form too: one save only.
    if (saving) return;
    if (name.trim() === "") {
      setNameError(true);
      return;
    }
    onAdd({ name, qty: Number(qty), packLast, scope });
  }

  return (
    <ModalSheet
      open
      showClose
      title="Add a Bathroom item"
      description="Create a normal toiletry checklist item."
      onClose={onClose}
    >
      <form className="form-grid" onSubmit={submit} noValidate>
        <label className="field">
          Item name
          <input
            name="name"
            value={name}
            maxLength={50}
            placeholder="Face wash"
            aria-invalid={nameError}
            aria-describedby={nameError ? "toiletry-name-error" : undefined}
            onChange={(event) => {
              setName(event.target.value);
              setNameError(false);
            }}
          />
        </label>
        {nameError ? (
          <span id="toiletry-name-error" className="field-error" role="alert">
            Enter a name.
          </span>
        ) : null}
        <label className="field">
          Quantity
          <input
            name="qty"
            type="number"
            min={1}
            max={30}
            value={qty}
            onChange={(event) => setQty(event.target.value)}
          />
        </label>
        <ScopeChoice
          legend="Apply this addition to"
          destination={destination}
          value={scope}
          onChange={setScope}
        />
        <Switch
          label="Pack last"
          description="Optional timing flag. New items default off."
          checked={packLast}
          onChange={setPackLast}
        />
        <div className="callout">
          <strong>Bathroom item.</strong> This creates one normal checkbox in Toiletries. Pack last
          stays an optional timing flag.
        </div>
        <Button type="submit" disabled={saving}>
          Add toiletry item
        </Button>
      </form>
    </ModalSheet>
  );
}
