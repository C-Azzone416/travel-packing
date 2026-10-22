"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/Button";
import { ADD_ITEM_NAME_MAX, ADD_ITEM_QTY_MAX, ADDABLE_CATEGORIES } from "@/domain/item-ops";
import type { TripItem } from "@/domain/trip";
import { findExistingItem } from "@/domain/item-ops";
import type { NewCustomItem } from "@/features/trips/trips-source";

/** The Bathroom choice is not an addable category: it hands off to the Bathroom form, which gates bag placement. */
export const BATHROOM_CHOICE = "Bathroom";

export interface AddItemInlineProps {
  items: readonly TripItem[];
  /** Another save is in flight (a dialog, a row): Add waits for the source. */
  busy?: boolean;
  /** Adds the item; true when it was saved (the form folds away), false when it was not (the typed values stay). */
  onAdd: (item: NewCustomItem) => Promise<boolean>;
  /** Bathroom was chosen: open the existing Bathroom form with the name and quantity filled in. */
  onBathroom: (name: string, qty: number) => void;
  /** The item is already on the list: open its quantity editor. */
  onEditExisting: (itemId: string) => void;
  /** "hero": the dashboard hero's action row (the toggle is one of its buttons, the form takes the next row). */
  variant?: "packing" | "hero";
  /** Where the form is drawn when it must sit apart from its button (the hero's full-width row under the actions). */
  formHost?: HTMLElement | null;
}

const CATEGORY_CHOICES = [...ADDABLE_CATEGORIES, BATHROOM_CHOICE] as const;

/**
 * "＋ Add item": a progressively disclosed inline input (#139 spec §4, #147). Name, a category and the needed
 * quantity. An item that is already on the list is never added twice: the form says so and offers to edit its
 * quantity. Bathroom hands off to the Bathroom form because those items gate bag placement.
 */
export function AddItemInline({
  items,
  busy = false,
  onAdd,
  onBathroom,
  onEditExisting,
  variant = "packing",
  formHost = null,
}: AddItemInlineProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [category, setCategory] = useState<string>(ADDABLE_CATEGORIES[0]);
  const [qty, setQty] = useState("1");
  const [problems, setProblems] = useState<{ name?: boolean; qty?: boolean }>({});
  const [existingId, setExistingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const panelId = useId();
  const isBathroom = category === BATHROOM_CHOICE;

  const edited = () => {
    setExistingId(null);
    setFailed(false);
  };

  function close() {
    setOpen(false);
    setProblems({});
    setExistingId(null);
    setFailed(false);
    toggle.current?.focus();
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving || busy) return;
    const trimmed = name.trim();
    const count = Number(qty);
    const bad = {
      name: trimmed === "" || trimmed.length > ADD_ITEM_NAME_MAX,
      qty: !Number.isInteger(count) || count < 1 || count > ADD_ITEM_QTY_MAX,
    };
    setProblems(bad);
    if (bad.name) return nameInput.current?.focus();
    if (bad.qty) return;
    if (isBathroom) {
      setName("");
      setQty("1");
      close();
      return onBathroom(trimmed, count);
    }
    const existing = findExistingItem({ items: [...items] }, trimmed, category);
    if (existing) return setExistingId(existing.id);
    setSaving(true);
    setFailed(false);
    const saved = await onAdd({ name: trimmed, category, neededQty: count });
    setSaving(false);
    if (saved) {
      setName("");
      setQty("1");
      close();
    } else {
      setFailed(true);
    }
  }

  const existing = existingId ? items.find((item) => item.id === existingId) : null;

  const formEl = (
    <form className="add-item-form" id={panelId} onSubmit={submit} noValidate>
      <div className="add-item-field">
        <label className="field">
          Item name
          <input
            ref={nameInput}
            name="name"
            value={name}
            maxLength={ADD_ITEM_NAME_MAX}
            placeholder="Camera"
            autoFocus
            aria-invalid={problems.name === true}
            aria-describedby={problems.name ? `${panelId}-name` : undefined}
            onChange={(event) => {
              setName(event.target.value);
              setProblems((current) => ({ ...current, name: false }));
              edited();
            }}
          />
        </label>
        {problems.name ? (
          <span id={`${panelId}-name`} className="field-error" role="alert">
            Enter an item name.
          </span>
        ) : null}
      </div>
      <label className="field">
        Category
        <select
          name="category"
          value={category}
          onChange={(event) => {
            setCategory(event.target.value);
            edited();
          }}
        >
          {CATEGORY_CHOICES.map((choice) => (
            <option key={choice} value={choice}>
              {choice}
            </option>
          ))}
        </select>
      </label>
      <div className="add-item-field">
        <label className="field add-item-qty">
          Needed
          <input
            name="qty"
            type="number"
            inputMode="numeric"
            min={1}
            max={ADD_ITEM_QTY_MAX}
            value={qty}
            aria-invalid={problems.qty === true}
            aria-describedby={problems.qty ? `${panelId}-qty` : undefined}
            onChange={(event) => {
              setQty(event.target.value);
              setProblems((current) => ({ ...current, qty: false }));
              edited();
            }}
          />
        </label>
        {problems.qty ? (
          <span id={`${panelId}-qty`} className="field-error" role="alert">
            Enter a whole number from 1 to {ADD_ITEM_QTY_MAX}.
          </span>
        ) : null}
      </div>
      <div className="add-item-actions">
        <Button type="submit" disabled={saving || busy}>
          {isBathroom ? "Continue to Bathroom item" : "Add to list"}
        </Button>
        <Button variant="secondary" onClick={close}>
          Cancel
        </Button>
      </div>
      {isBathroom ? (
        <p className="tiny muted add-item-note">
          Bathroom items go in the toiletry bag, so they use the Bathroom form.
        </p>
      ) : null}
      {existing ? (
        <p className="add-item-exists" role="alert">
          {existing.name} is already on your list (needed: {existing.qty}).{" "}
          <button
            type="button"
            className="link-button"
            onClick={() => {
              close();
              onEditExisting(existing.id);
            }}
          >
            Edit quantity
          </button>
        </p>
      ) : null}
      {failed ? (
        <p className="field-error" role="alert">
          Couldn’t add that item. Nothing was changed.
        </p>
      ) : null}
    </form>
  );

  return (
    <div className={variant === "hero" ? "add-item hero" : "add-item"}>
      <Button
        ref={toggle}
        variant="secondary"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => (open ? close() : setOpen(true))}
      >
        ＋ Add item
      </Button>
      {open && formHost ? createPortal(formEl, formHost) : open ? formEl : null}
    </div>
  );
}
