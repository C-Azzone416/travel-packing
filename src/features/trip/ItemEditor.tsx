"use client";

import { z } from "zod";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useSaveStatus } from "@/components/shell/SaveStatus";
import type { StapleRevision } from "@/domain/calc/staples";
import { TripsSourceError, type TripChange } from "@/features/trips/trips-source";
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
  tripDays: number;
  staples: Staple[];
  saving: boolean;
  onClose: () => void;
  onSave: (edit: ItemEdit, expected?: StapleRevision | null) => Promise<TripChange>;
  onRemove: (scope: Scope, expected?: StapleRevision | null) => Promise<TripChange>;
  onWrite: (write: () => Promise<TripChange>, retryable: () => boolean, after: () => void) => void;
  onReview: () => Promise<{
    item?: TripItem;
    staples: Staple[];
    tripDays: number;
    destination: string;
  }>;
}

/** Optional Nice suggestions and Bathroom items can be removed; everything else is simply edited. */
export const isRemovable = (item: TripItem): boolean =>
  Boolean(item.optional) || item.groupId === TOILETRY_GROUP_ID;

function previewText(preview: ReturnType<typeof rememberPreview>): string {
  if (preview === null) return "";
  return preview.kind === "per-day"
    ? `Saved as ${preview.perDay} per day for future trips.`
    : "This trip has no calendar days, so the saved quantity stays the same.";
}

function capture(item: TripItem, staples: Staple[], tripDays: number, destination: string) {
  const row = staples.find((entry) => entry.id === item.id);
  return structuredClone({
    item,
    staples,
    tripDays,
    destination,
    expected: row ? row.revision : null,
  });
}

export function ItemEditor({
  item,
  destination,
  tripDays,
  staples,
  saving,
  onClose,
  onSave,
  onRemove,
  onWrite,
  onReview,
}: ItemEditorProps) {
  const { discard } = useSaveStatus();
  const [view, setView] = useState(() => capture(item, staples, tripDays, destination));
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  const reviewing = useRef(false);
  const body = useRef<HTMLDivElement>(null);
  const operation = useRef<{
    retired: boolean;
    pending: boolean;
    stale: boolean;
    write: () => Promise<TripChange>;
  } | null>(null);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (operation.current) {
        operation.current.retired = true;
        discard(operation.current.write);
      }
    };
  }, [discard]);
  const locked = busy || saving || operation.current !== null;
  function retire() {
    if (operation.current) {
      operation.current.retired = true;
      discard(operation.current.write);
    }
    operation.current = null;
  }
  function close() {
    alive.current = false;
    retire();
    onClose();
  }
  function start(run: () => Promise<TripChange>) {
    // Register synchronously: two submit events can precede React's disabled render.
    if (operation.current || reviewing.current || saving || !alive.current) return;
    if (view.expected) Object.freeze(view.expected);
    const op = {
      retired: false,
      pending: false,
      stale: false,
      write: async (): Promise<TripChange> => {
        if (op.retired || op.pending || op.stale || reviewing.current)
          throw new TripsSourceError("STALE");
        op.pending = true;
        if (alive.current && operation.current === op) {
          setBusy(true);
          setFailure(null);
        }
        try {
          return await run();
        } catch (error) {
          op.stale =
            error instanceof TripsSourceError &&
            (error.message === "STALE" || error.message === "INVALID_INPUT");
          if (alive.current && !op.retired && operation.current === op)
            setFailure(
              op.stale
                ? "Your Staples changed. Reload and review before editing."
                : "Couldn’t save. Retry this change or discard it.",
            );
          throw error;
        } finally {
          op.pending = false;
          if (alive.current && !op.retired && operation.current === op) setBusy(false);
        }
      },
    };
    operation.current = op;
    retry(op);
  }
  function retry(op = operation.current) {
    if (!op || op.pending || op.retired || op.stale || reviewing.current) return;
    onWrite(
      op.write,
      () => !op.pending && !op.retired && !op.stale && !reviewing.current,
      () => {
        if (alive.current && !op.retired && operation.current === op) close();
      },
    );
  }
  async function review() {
    if (operation.current?.pending || reviewing.current || saving || !alive.current) return;
    reviewing.current = true;
    setBusy(true);
    // Retire locally before discard: the provider can refuse while other work is pending.
    if (operation.current) {
      operation.current.retired = true;
      discard(operation.current.write);
    }
    try {
      const fresh = await onReview();
      if (!alive.current) return;
      if (!fresh.item) return close();
      const next = capture(fresh.item, fresh.staples, fresh.tripDays, fresh.destination);
      if (
        next.staples.some((row) => row.id === next.item.id) &&
        !z
          .strictObject({ rowId: z.uuid(), version: z.number().int().min(1).max(2_147_483_647) })
          .safeParse(next.expected).success
      )
        throw Error("Missing or invalid revision");
      retire();
      setView(next);
      setName(next.item.name);
      setQty(String(next.item.qty));
      setPackLast(next.item.section === "packlast");
      setScope("this-trip");
      setNameError(false);
      setConfirming(false);
      setFailure(null);
    } catch {
      if (alive.current)
        setFailure(
          "Couldn’t reload. Your unsaved change is still shown. Try Reload and review again, or discard it.",
        );
    } finally {
      reviewing.current = false;
      if (alive.current) setBusy(false);
    }
  }
  const [name, setName] = useState(item.name);
  const [qty, setQty] = useState(String(item.qty));
  const [packLast, setPackLast] = useState(item.section === "packlast");
  const [scope, setScope] = useState<Scope>("this-trip");
  const [nameError, setNameError] = useState(false);
  const [confirming, setConfirming] = useState(false);

  // Native fieldset disabling also affects descendants without a disabled attribute.
  // Bound the existing modal's Tab loop locally so it skips those radios in both engines.
  useEffect(() => {
    if (!locked) return;
    const dialog = body.current?.closest('[role="dialog"]');
    const trap = (event: Event) => {
      const key = event as KeyboardEvent;
      if (key.key !== "Tab") return;
      const controls = [
        ...dialog!.querySelectorAll<HTMLElement>(
          "button, input, select, textarea, a[href], [tabindex]",
        ),
      ].filter((node) => !node.matches(":disabled") && node.tabIndex >= 0);
      const index = controls.indexOf(document.activeElement as HTMLElement);
      key.preventDefault();
      key.stopPropagation();
      const next = key.shiftKey
        ? index <= 0
          ? controls.length - 1
          : index - 1
        : index < 0 || index === controls.length - 1
          ? 0
          : index + 1;
      controls[next]?.focus();
    };
    dialog?.addEventListener("keydown", trap, true);
    return () => dialog?.removeEventListener("keydown", trap, true);
  }, [locked, confirming]);

  const isReturn = view.item.section === "return";
  const preview =
    scope === "remember"
      ? rememberPreview(view.staples, view.item.id, normalizeQty(Number(qty)), view.tripDays)
      : null;

  function submit(event: FormEvent) {
    event.preventDefault();
    // The button is disabled while saving, but Enter in a field submits the form too: one save only.
    if (locked) return;
    if (name.trim() === "") {
      setNameError(true);
      return;
    }
    const edit: ItemEdit = Object.freeze({
      name,
      qty: Number(qty),
      timing: isReturn ? "return" : packLast ? "packlast" : "main",
      scope,
    });
    start(() =>
      edit.scope === "remember" && view.expected === undefined
        ? Promise.reject(new TripsSourceError("INVALID_INPUT"))
        : onSave(edit, view.expected),
    );
  }

  const recovery = failure ? (
    <div role="alert">
      <p>{failure}</p>
      {!operation.current?.stale && !operation.current?.retired ? (
        <Button disabled={busy} onClick={() => retry()}>
          Retry change
        </Button>
      ) : null}
      <Button disabled={busy} onClick={() => void review()}>
        Reload and review
      </Button>
      <Button disabled={busy} onClick={close}>
        Discard change and close
      </Button>
    </div>
  ) : null;

  if (confirming) {
    const everywhere = scope === "remember";
    return (
      <ModalSheet
        key="confirm"
        open
        title={`Remove ${view.item.name}?`}
        showClose={locked}
        description={
          everywhere
            ? "It is removed from this trip and from your staples, so future trips will not add it."
            : "It is removed from this trip only. Your staples and other trips are not changed."
        }
        onClose={() => (locked ? close() : setConfirming(false))}
        dismissOnBackdrop={false}
        actions={
          <>
            <Button variant="secondary" disabled={locked} onClick={() => setConfirming(false)}>
              Keep item
            </Button>
            <Button
              variant="danger"
              disabled={locked}
              onClick={() => {
                const capturedScope = scope;
                start(() =>
                  capturedScope === "remember" && view.expected === undefined
                    ? Promise.reject(new TripsSourceError("INVALID_INPUT"))
                    : onRemove(capturedScope, view.expected),
                );
              }}
            >
              Remove item
            </Button>
          </>
        }
      >
        <div ref={body}>
          {recovery}
          {failure ? <p>Close discards this unsaved change.</p> : null}
        </div>
      </ModalSheet>
    );
  }

  return (
    <ModalSheet
      key="edit"
      open
      showClose
      title="Edit item"
      description={
        failure ? "Close discards this unsaved change." : "Existing trips stay as they were."
      }
      onClose={close}
    >
      <div ref={body}>
        {recovery}
        <form className="form-grid editor-form" onSubmit={submit} noValidate autoComplete="off">
          <label className="field">
            Item name
            <input
              disabled={locked}
              name="packing-item-name"
              value={name}
              maxLength={50}
              autoComplete="off"
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
              disabled={locked}
              name="qty"
              type="number"
              min={1}
              max={99}
              value={qty}
              onChange={(event) => setQty(event.target.value)}
            />
          </label>
          <ScopeFieldset
            destination={view.destination}
            scope={scope}
            onScope={setScope}
            disabled={locked}
            preview={previewText(preview)}
          />
          {view.item.optional ? (
            <div className="callout">
              <strong>Optional suggestion.</strong> Edit it, keep it, or remove it from this trip.
            </div>
          ) : null}
          {view.item.groupId === TOILETRY_GROUP_ID ? (
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
              disabled={locked}
              checked={packLast}
              onChange={setPackLast}
            />
          )}
          <div className="actions">
            <Button type="submit" disabled={locked}>
              Save item
            </Button>
            {isRemovable(view.item) ? (
              <Button variant="danger" disabled={locked} onClick={() => setConfirming(true)}>
                Remove item
              </Button>
            ) : null}
          </div>
        </form>
      </div>
    </ModalSheet>
  );
}

function ScopeFieldset({
  destination,
  scope,
  onScope,
  preview,
  disabled,
}: {
  destination: string;
  scope: Scope;
  onScope: (scope: Scope) => void;
  preview: string;
  disabled: boolean;
}) {
  return (
    <fieldset disabled={disabled} style={{ border: 0, padding: 0, margin: 0 }}>
      <ScopeChoice
        legend="Apply this change to"
        destination={destination}
        value={scope}
        onChange={onScope}
      />
      <p className="tiny muted scope-preview" role="status" aria-label="Saved quantity">
        {preview}
      </p>
    </fieldset>
  );
}
