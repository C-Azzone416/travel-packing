"use client";

import { useId, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { ModalSheet } from "@/components/ui/ModalSheet";
import { Switch } from "@/components/ui/Switch";
import { TOILETRY_GROUP_ID } from "@/domain/toiletry-bag";
import type { Staple } from "@/domain/trip";
import {
  categoryFor,
  findDuplicate,
  newStapleId,
  SECTIONS,
  sectionOf,
  type Section,
} from "./staples-view";

export const MAX_STAPLE_QTY = 30;

export interface StapleEditorProps {
  /** The staple being edited, or null to add a new one. */
  staple: Staple | null;
  staples: readonly Staple[];
  saving: boolean;
  onClose: () => void;
  onSave: (staple: Staple) => void;
  /** Open another staple's editor (from the duplicate-name message). */
  onEditOther: (id: string) => void;
}

type Cadence = Staple["cadence"];

// Add or edit one staple (same modal primitives as the item editor). New staples start with Pack last off; editing
// keeps whatever the staple has. Changes apply to future trips only, and the editor says so.
export function StapleEditor({
  staple,
  staples,
  saving,
  onClose,
  onSave,
  onEditOther,
}: StapleEditorProps) {
  const editing = staple !== null;
  const [name, setName] = useState(staple?.name ?? "");
  const [qty, setQty] = useState(String(staple?.qty ?? 1));
  const [cadence, setCadence] = useState<Cadence>(staple?.cadence ?? "per trip");
  const [section, setSection] = useState<Section>(staple ? sectionOf(staple) : "Other essentials");
  const [packLast, setPackLast] = useState(staple?.packLast ?? false);
  const [problem, setProblem] = useState<null | "name" | "qty">(null);
  const radioName = useId();

  const duplicate = findDuplicate(staples, name, staple?.id ?? null);
  const isBathroom = staple?.groupId === TOILETRY_GROUP_ID;
  const quantity = Number(qty);
  const qtyValid = Number.isInteger(quantity) && quantity >= 1 && quantity <= MAX_STAPLE_QTY;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (name.trim() === "") return setProblem("name");
    if (!qtyValid) return setProblem("qty");
    if (duplicate) return; // the message below says what to do
    onSave({
      id: staple?.id ?? newStapleId(),
      name: name.trim(),
      qty: quantity,
      cadence,
      category: categoryFor(staple?.category ?? null, section),
      packLast,
      ...(staple?.groupId ? { groupId: staple.groupId } : {}),
    });
  }

  return (
    <ModalSheet
      open
      showClose
      title={editing ? "Edit staple" : "Add a staple"}
      description="Set a per-day or per-trip default."
      onClose={onClose}
    >
      <form className="form-grid editor-form" onSubmit={submit} noValidate>
        <label className="field">
          Item name
          <input
            name="name"
            value={name}
            maxLength={50}
            aria-invalid={problem === "name" || duplicate !== undefined}
            aria-describedby={
              problem === "name" ? "staple-name-error" : duplicate ? "staple-duplicate" : undefined
            }
            onChange={(event) => {
              setName(event.target.value);
              setProblem(null);
            }}
          />
        </label>
        {problem === "name" ? (
          <span id="staple-name-error" className="field-error" role="alert">
            Enter a name.
          </span>
        ) : null}
        {duplicate ? (
          <span id="staple-duplicate" className="field-error" role="alert">
            You already have {duplicate.name}.{" "}
            <button type="button" className="link-button" onClick={() => onEditOther(duplicate.id)}>
              Edit it instead
            </button>
            .
          </span>
        ) : null}
        <label className="field">
          Quantity
          <input
            name="qty"
            type="number"
            min={1}
            max={MAX_STAPLE_QTY}
            value={qty}
            aria-invalid={problem === "qty"}
            aria-describedby={problem === "qty" ? "staple-qty-error" : undefined}
            onChange={(event) => {
              setQty(event.target.value);
              setProblem(null);
            }}
          />
        </label>
        {problem === "qty" ? (
          <span id="staple-qty-error" className="field-error" role="alert">
            Enter a quantity from 1 to {MAX_STAPLE_QTY}.
          </span>
        ) : null}
        <fieldset className="scope-choice">
          <legend>Frequency</legend>
          <div className="choice-stack">
            {(["per day", "per trip"] as const).map((value) => (
              <label className="choice" key={value}>
                <input
                  type="radio"
                  name={radioName}
                  value={value}
                  checked={cadence === value}
                  onChange={() => setCadence(value)}
                />
                <span>
                  <strong>{value === "per day" ? "Per day" : "Per trip"}</strong>
                  <small>
                    {value === "per day"
                      ? "Scales with the number of packing days."
                      : "The same amount on every trip."}
                  </small>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <label className="field">
          Category
          <select
            name="category"
            value={section}
            onChange={(event) => setSection(event.target.value as Section)}
          >
            {SECTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
        {isBathroom ? (
          <div className="callout">
            <strong>Bathroom staple.</strong> Editing here keeps it in the Toiletries group.
          </div>
        ) : null}
        <Switch
          label="Pack last"
          description="Optional timing flag. New staples start off."
          checked={packLast}
          onChange={setPackLast}
        />
        <p className="tiny muted">
          Changes apply to future trips. Existing trips keep their lists.
        </p>
        <div className="actions">
          <Button type="submit" disabled={saving}>
            {editing ? "Save staple" : "Add staple"}
          </Button>
        </div>
      </form>
    </ModalSheet>
  );
}
