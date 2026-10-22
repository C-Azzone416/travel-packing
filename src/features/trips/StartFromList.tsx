"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import type { SavedListDetail, SavedListSummary } from "@/server/data/service";
import { itemsLabel, updatedText } from "@/features/saved-lists/saved-lists-view";

export interface StartFromListProps {
  lists: readonly SavedListSummary[];
  /** The chosen list's id, or null for "No saved list" (the default). */
  chosenId: string | null;
  onChoose: (listId: string | null) => void;
  /** Loads one list's items for the inline preview. */
  loadList: (listId: string) => Promise<SavedListDetail>;
  /** Continue is waiting for the chosen list's items. */
  busy: boolean;
  /** The list could not be loaded when Continue was pressed. */
  error: boolean;
  onContinue: () => void;
  onBack: () => void;
}

type Preview =
  { phase: "loading" } | { phase: "error" } | { phase: "ready"; list: SavedListDetail };

/**
 * "Start from a saved list (optional)" (#170, #140 spec §2): one radiogroup, single select, "No saved list" first and
 * selected by default. A list replaces the staples and the length-based recommendations, which the callout says as
 * soon as one is chosen. Native radios, so arrow keys and Space need no script; each list can show its items inline.
 */
export function StartFromList({
  lists,
  chosenId,
  onChoose,
  loadList,
  busy,
  error,
  onContinue,
  onBack,
}: StartFromListProps) {
  const group = useId();
  const [open, setOpen] = useState<string | null>(null);
  const [previews, setPreviews] = useState<Readonly<Record<string, Preview>>>({});
  const chosen = lists.find((list) => list.id === chosenId) ?? null;

  function togglePreview(listId: string) {
    if (open === listId) {
      setOpen(null);
      return;
    }
    setOpen(listId);
    if (previews[listId]?.phase === "ready") return;
    setPreviews((current) => ({ ...current, [listId]: { phase: "loading" } }));
    loadList(listId).then(
      (list) => setPreviews((current) => ({ ...current, [listId]: { phase: "ready", list } })),
      () => setPreviews((current) => ({ ...current, [listId]: { phase: "error" } })),
    );
  }

  return (
    <Card padded>
      <div className="start-options" role="radiogroup" aria-label="Starting point">
        <label className="start-option">
          <input
            type="radio"
            name={group}
            checked={chosenId === null}
            onChange={() => onChoose(null)}
          />
          <span className="start-copy">
            <strong>No saved list</strong>
            <span>Staples plus recommendations for this trip’s length.</span>
            <span>The usual starting point.</span>
          </span>
          <span className="start-check" aria-hidden="true">
            ✓
          </span>
        </label>
        {lists.map((list) => {
          const empty = list.itemCount === 0;
          const preview = previews[list.id];
          const panel = `${group}-items-${list.id}`;
          return (
            <div key={list.id} className="start-entry">
              <label className="start-option" data-empty={empty ? "true" : undefined}>
                <input
                  type="radio"
                  name={group}
                  checked={chosenId === list.id}
                  disabled={empty}
                  onChange={() => onChoose(list.id)}
                />
                <span className="start-copy">
                  <strong>{list.name}</strong>
                  <span>
                    {itemsLabel(list.itemCount)} · updated {updatedText(list.updatedAt)}
                  </span>
                  {empty ? <span>This list is empty. Add items to it first.</span> : null}
                </span>
                <span className="start-check" aria-hidden="true">
                  ✓
                </span>
              </label>
              {empty ? null : (
                <Button
                  variant="ghost"
                  small
                  aria-expanded={open === list.id}
                  aria-controls={panel}
                  onClick={() => togglePreview(list.id)}
                >
                  Preview items <span className="sr-only">in {list.name}</span>
                </Button>
              )}
              {open === list.id ? (
                <div
                  id={panel}
                  className="start-preview"
                  role="region"
                  aria-label={`Items in ${list.name}`}
                >
                  {preview?.phase === "ready" ? (
                    <ul>
                      {preview.list.items.map((item) => (
                        <li key={item.id}>
                          <span>{item.name}</span>
                          <span className="muted">
                            {item.category} · qty {item.qty}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : preview?.phase === "error" ? (
                    <p className="field-error">Couldn’t load this list. Nothing was changed.</p>
                  ) : (
                    <p className="muted">Loading…</p>
                  )}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      <div className="callout start-callout" role="status" aria-label="Saved list choice">
        {chosen ? (
          <>
            <strong>“{chosen.name}” replaces your staples and recommendations.</strong> The trip
            starts with only this list’s {itemsLabel(chosen.itemCount)}, all unpacked. Later edits
            to the list won’t change this trip, and this trip won’t change the list. You can still
            add items on the packing screen.
          </>
        ) : null}
      </div>
      {error ? (
        <p className="field-error" role="alert">
          Couldn’t load that list. Nothing was changed.
        </p>
      ) : null}
      <div className="actions">
        <Button disabled={busy} aria-busy={busy} onClick={onContinue}>
          {busy ? "Loading…" : "Continue"}
        </Button>
        <Button variant="secondary" disabled={busy} onClick={onBack}>
          Back
        </Button>
      </div>
    </Card>
  );
}
