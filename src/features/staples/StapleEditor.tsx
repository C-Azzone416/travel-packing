"use client";

import { useId, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { ModalSheet } from "@/components/ui/ModalSheet";
import { Switch } from "@/components/ui/Switch";
import { TOILETRY_GROUP_ID } from "@/domain/toiletry-bag";
import type { Staple } from "@/domain/trip";
import { supportsSmartQuantity } from "@/domain/calc";
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
  onRemove?: () => void;
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
  onRemove,
  onEditOther,
}: StapleEditorProps) {
  const editing = staple !== null;
  const [name, setName] = useState(staple?.name ?? "");
  const [qty, setQty] = useState(String(staple?.qty ?? 1));
  const [cadence, setCadence] = useState<Cadence>(staple?.cadence ?? "per trip");
  const [section, setSection] = useState<Section>(staple ? sectionOf(staple) : "Other essentials");
  const [placement, setPlacement] = useState<"main" | "toiletry">(
    staple?.groupId === TOILETRY_GROUP_ID ? "toiletry" : "main",
  );
  const [packLast, setPackLast] = useState(staple?.packLast ?? false);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [problem, setProblem] = useState<null | "name" | "qty">(null);
  const radioName = useId();

  const duplicate = findDuplicate(staples, name, staple?.id ?? null);
  const smartSupported = staple
    ? supportsSmartQuantity(staple.id) && section === "Clothing"
    : false;
  const quantity = Number(qty);
  const qtyValid = Number.isInteger(quantity) && quantity >= 1 && quantity <= MAX_STAPLE_QTY;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (saving) return; // Enter in a field submits too: one save at a time, never two ids for one staple
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
      ...(placement === "toiletry" ? { groupId: TOILETRY_GROUP_ID } : {}),
    });
  }

  if (confirmingRemove && staple && onRemove) {
    return (
      <ModalSheet
        open
        title={`Remove ${staple.name}?`}
        description="This changes future trips only. Existing trip lists and packed progress stay as they are."
        onClose={() => setConfirmingRemove(false)}
        dismissOnBackdrop={false}
        actions={
          <>
            <Button variant="ghost" onClick={() => setConfirmingRemove(false)} disabled={saving}>
              Keep item
            </Button>
            <Button variant="danger" onClick={onRemove} disabled={saving}>
              Remove staple
            </Button>
          </>
        }
      >
        <p className="muted">You can add it again later.</p>
      </ModalSheet>
    );
  }

  return (
    <ModalSheet
      open
      showClose
      title={editing ? "Edit staple" : "Add a staple"}
      description="Set a fixed, per-day, or supported Smart default."
      onClose={onClose}
    >
      <form className="staple-editor-form" onSubmit={submit} noValidate>
        <div className="form-grid staple-editor-fields">
          <label className="field">
            Item name
            <input
              name="name"
              value={name}
              maxLength={50}
              aria-invalid={problem === "name" || duplicate !== undefined}
              aria-describedby={
                problem === "name"
                  ? "staple-name-error"
                  : duplicate
                    ? "staple-duplicate"
                    : undefined
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
              <button
                type="button"
                className="link-button"
                onClick={() => onEditOther(duplicate.id)}
              >
                Edit it instead
              </button>
              {"."}
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
            <legend>How the quantity works</legend>
            <div className="choice-stack">
              {(["per trip", "per day", "smart"] as const).map((value) => (
                <label className="choice" key={value}>
                  <input
                    type="radio"
                    name={radioName}
                    value={value}
                    checked={cadence === value}
                    disabled={value === "smart" && !smartSupported}
                    onChange={() => setCadence(value)}
                  />
                  <span>
                    <strong>
                      {value === "per day"
                        ? "Per day"
                        : value === "per trip"
                          ? "Fixed per trip"
                          : "Smart"}
                    </strong>
                    <small>
                      {value === "per day"
                        ? "Multiplies by every calendar day, including travel days. Laundry does not change it."
                        : value === "per trip"
                          ? "The same amount on every trip."
                          : smartSupported
                            ? "Uses the shared clothing rules, including trip preferences."
                            : "Available only for supported clothing staples."}
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
              onChange={(event) => {
                const next = event.target.value as Section;
                setSection(next);
                if (cadence === "smart" && next !== "Clothing") setCadence("per trip");
              }}
            >
              {SECTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <fieldset className="scope-choice">
            <legend>Placement</legend>
            <div className="choice-stack">
              <label className="choice">
                <input
                  type="radio"
                  name={`${radioName}-placement`}
                  checked={placement === "main"}
                  onChange={() => setPlacement("main")}
                />
                <span>
                  <strong>Main list</strong>
                  <small>Show as a regular packing-list item.</small>
                </span>
              </label>
              <label className="choice">
                <input
                  type="radio"
                  name={`${radioName}-placement`}
                  checked={placement === "toiletry"}
                  onChange={() => setPlacement("toiletry")}
                />
                <span>
                  <strong>Toiletry bag</strong>
                  <small>Include in the separate bag-placement step.</small>
                </span>
              </label>
            </div>
          </fieldset>
          <Switch
            label="Pack last"
            description="Optional timing flag. New staples start off."
            checked={packLast}
            onChange={setPackLast}
          />
          <p className="tiny muted">
            Changes apply to future trips. Existing trips keep their lists.
          </p>
        </div>
        <div className="actions staple-editor-actions">
          {editing && onRemove ? (
            <Button
              type="button"
              variant="danger"
              disabled={saving}
              onClick={() => setConfirmingRemove(true)}
            >
              Remove
            </Button>
          ) : null}
          <Button type="submit" disabled={saving}>
            {editing ? "Save staple" : "Add staple"}
          </Button>
        </div>
      </form>
    </ModalSheet>
  );
}
