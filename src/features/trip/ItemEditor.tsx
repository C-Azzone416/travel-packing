"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { ModalSheet } from "@/components/ui/ModalSheet";
import { Switch } from "@/components/ui/Switch";
import { rememberPreview, type ItemEdit } from "@/domain/item-ops";
import { normalizeQty } from "@/domain/readiness";
import { TOILETRY_GROUP_ID } from "@/domain/toiletry-bag";
import type { Scope, Staple, TripItem } from "@/domain/trip";
import { ScopeChoice } from "./ScopeChoice";

export interface ItemEditorProps {
  item: TripItem;
  destination: string;
  dailyDays: number;
  staples: Staple[];
  saving: boolean;
  onClose: () => void;
  onSave: (edit: ItemEdit) => void;
  onRemove: (scope: Scope) => void;
}

/** Optional Nice suggestions and Bathroom items can be removed; everything else is simply edited. */
export const isRemovable = (item: TripItem): boolean =>
  Boolean(item.optional) || item.groupId === TOILETRY_GROUP_ID;

function previewText(preview: ReturnType<typeof rememberPreview>): string {
  if (preview === null) return "";
  return preview.kind === "per-day"
    ? `Saved as ${preview.perDay} per day for future trips.`
    : "This trip has no packing days, so the saved quantity stays the same.";
}

export function ItemEditor({
  item,
  destination,
  dailyDays,
  staples,
  saving,
  onClose,
  onSave,
  onRemove,
}: ItemEditorProps) {
  const [name, setName] = useState(item.name);
  const [qty, setQty] = useState(String(item.qty));
  const [packLast, setPackLast] = useState(item.section === "packlast");
  const [scope, setScope] = useState<Scope>("this-trip");
  const [nameError, setNameError] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const isReturn = item.section === "return";
  const preview =
    scope === "remember"
      ? rememberPreview(staples, item.id, normalizeQty(Number(qty)), dailyDays)
      : null;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (name.trim() === "") {
      setNameError(true);
      return;
    }
    onSave({
      name,
      qty: Number(qty),
      timing: isReturn ? "return" : packLast ? "packlast" : "main",
      scope,
    });
  }

  if (confirming) {
    const everywhere = scope === "remember";
    return (
      <ModalSheet
        key="confirm"
        open
        title={`Remove ${item.name}?`}
        description={
          everywhere
            ? "It is removed from this trip and from your staples, so future trips will not add it."
            : "It is removed from this trip only. Your staples and other trips are not changed."
        }
        onClose={() => setConfirming(false)}
        dismissOnBackdrop={false}
        actions={
          <>
            <Button variant="secondary" onClick={() => setConfirming(false)}>
              Keep item
            </Button>
            <Button variant="danger" disabled={saving} onClick={() => onRemove(scope)}>
              Remove item
            </Button>
          </>
        }
      >
        {null}
      </ModalSheet>
    );
  }

  return (
    <ModalSheet
      key="edit"
      open
      showClose
      title="Edit item"
      description="Existing trips stay as they were."
      onClose={onClose}
    >
      <form className="form-grid editor-form" onSubmit={submit} noValidate>
        <label className="field">
          Item name
          <input
            name="name"
            value={name}
            maxLength={50}
            aria-invalid={nameError}
            aria-describedby={nameError ? "name-error" : undefined}
            onChange={(event) => {
              setName(event.target.value);
              setNameError(false);
            }}
          />
        </label>
        {nameError ? (
          <span id="name-error" className="field-error" role="alert">
            Enter a name.
          </span>
        ) : null}
        <label className="field">
          Quantity
          <input
            name="qty"
            type="number"
            min={1}
            max={99}
            value={qty}
            onChange={(event) => setQty(event.target.value)}
          />
        </label>
        <ScopeFieldset
          destination={destination}
          scope={scope}
          onScope={setScope}
          preview={previewText(preview)}
        />
        {item.optional ? (
          <div className="callout">
            <strong>Optional suggestion.</strong> Edit it, keep it, or remove it from this trip.
          </div>
        ) : null}
        {item.groupId === TOILETRY_GROUP_ID ? (
          <div className="callout">
            <strong>Bathroom item.</strong> This is one checkbox in Toiletries. Bag placement is
            confirmed separately after all contents are checked.
          </div>
        ) : null}
        {isReturn ? (
          <div className="callout">
            <strong>Return outfit item.</strong> It stays in the dedicated return set.
          </div>
        ) : (
          <Switch
            label="Pack last"
            description="A timing flag only. The item can still be saved to My staples."
            checked={packLast}
            onChange={setPackLast}
          />
        )}
        <div className="actions">
          <Button type="submit" disabled={saving}>
            Save item
          </Button>
          {isRemovable(item) ? (
            <Button variant="danger" onClick={() => setConfirming(true)}>
              Remove item
            </Button>
          ) : null}
        </div>
      </form>
    </ModalSheet>
  );
}

function ScopeFieldset({
  destination,
  scope,
  onScope,
  preview,
}: {
  destination: string;
  scope: Scope;
  onScope: (scope: Scope) => void;
  preview: string;
}) {
  return (
    <div>
      <ScopeChoice
        legend="Apply this change to"
        destination={destination}
        value={scope}
        onChange={onScope}
      />
      <p className="tiny muted scope-preview" role="status" aria-label="Saved quantity">
        {preview}
      </p>
    </div>
  );
}
