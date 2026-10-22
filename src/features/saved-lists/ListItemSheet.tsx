"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { ModalSheet } from "@/components/ui/ModalSheet";
import type { SavedListItem } from "@/domain/saved-lists";
import { categoryOptions } from "./saved-lists-view";

export const LIST_ITEM_NAME_MAX = 120;
export const LIST_ITEM_QTY_MAX = 999;

export type ItemOutcome = { ok: true } | { ok: false; reason: "EXISTS" | "FAILED" };

export interface ListItemSheetProps {
  /** The item being edited, or null to add a new one. */
  item: SavedListItem | null;
  /** The list's other items, to name the one that already matches. */
  items: readonly SavedListItem[];
  onSave: (value: { name: string; category: string; qty: number }) => Promise<ItemOutcome>;
  onClose: () => void;
  /** Open another item's editor (from the "already in this list" message). */
  onEditOther: (itemId: string) => void;
}

// Add or edit one item in a saved list (#167, design §4): name, category, needed quantity; no packed state. An item that
// matches another one in the list is not added or merged: the sheet says so and offers to edit that one (the keep one /
// keep both prompt arrives with the shared resolver).
export function ListItemSheet({ item, items, onSave, onClose, onEditOther }: ListItemSheetProps) {
  const [name, setName] = useState(item?.name ?? "");
  const [category, setCategory] = useState(item?.category ?? "Clothing");
  const [qty, setQty] = useState(String(item?.qty ?? 1));
  const [problem, setProblem] = useState<null | "name" | "qty" | "EXISTS" | "FAILED">(null);
  const [existing, setExisting] = useState<SavedListItem | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    const trimmed = name.trim();
    const count = Number(qty);
    if (trimmed === "") return setProblem("name");
    if (!Number.isInteger(count) || count < 1 || count > LIST_ITEM_QTY_MAX)
      return setProblem("qty");
    setSaving(true);
    const outcome = await onSave({ name: trimmed, category, qty: count });
    setSaving(false);
    if (outcome.ok) return;
    if (outcome.reason === "EXISTS") {
      // Which row it matched, for the message and the "Edit that item" button.
      const key = (value: SavedListItem) => `${value.name.trim().toLowerCase()}|${value.category}`;
      const wanted = `${trimmed.toLowerCase()}|${category}`;
      setExisting(items.find((other) => other.id !== item?.id && key(other) === wanted) ?? null);
    }
    setProblem(outcome.reason);
  }

  return (
    <ModalSheet open showClose title={item ? "Edit item" : "Add an item"} onClose={onClose}>
      <form className="form-grid" onSubmit={submit} noValidate>
        <label className="field">
          Item name
          <input
            name="name"
            value={name}
            maxLength={LIST_ITEM_NAME_MAX}
            autoComplete="off"
            autoFocus
            aria-invalid={problem === "name" || problem === "EXISTS"}
            onChange={(event) => {
              setName(event.target.value);
              setProblem(null);
            }}
          />
        </label>
        {problem === "name" ? (
          <span className="field-error" role="alert">
            Enter an item name.
          </span>
        ) : null}
        <label className="field">
          Category
          <select
            name="category"
            value={category}
            onChange={(event) => {
              setCategory(event.target.value);
              setProblem(null);
            }}
          >
            {categoryOptions(item?.category ?? null).map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Needed quantity
          <input
            name="qty"
            type="number"
            inputMode="numeric"
            min={1}
            max={LIST_ITEM_QTY_MAX}
            value={qty}
            aria-invalid={problem === "qty"}
            onChange={(event) => {
              setQty(event.target.value);
              setProblem(null);
            }}
          />
        </label>
        {problem === "qty" ? (
          <span className="field-error" role="alert">
            Enter a whole number from 1 to {LIST_ITEM_QTY_MAX}.
          </span>
        ) : null}
        {problem === "EXISTS" ? (
          <p className="add-item-exists" role="alert">
            {existing
              ? `${existing.name} is already in this list (needed: ${existing.qty}). `
              : "That item is already in this list. "}
            {existing ? (
              <button
                type="button"
                className="link-button"
                onClick={() => {
                  onClose();
                  onEditOther(existing.id);
                }}
              >
                Edit that item
              </button>
            ) : null}
          </p>
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
