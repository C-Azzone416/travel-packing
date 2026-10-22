"use client";

import { useId, useMemo, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { ModalSheet } from "@/components/ui/ModalSheet";
import type { TripItem } from "@/domain/trip";
import {
  allDecided,
  droppedRowIds,
  groupDuplicates,
  type DuplicateChoice,
  type DuplicateChoices,
  type DuplicateRow,
} from "@/features/saved-lists/duplicates";
import { DuplicateResolver } from "@/features/saved-lists/DuplicateResolver";
import { LIST_NAME_MAX } from "@/features/saved-lists/ListNameSheet";

export type SaveOutcome = { ok: true } | { ok: false; reason: "NAME_TAKEN" | "FAILED" };

export interface SaveAsListSheetProps {
  /** The trip's destination: the list name starts as this, selected so typing replaces it. */
  tripName: string;
  items: readonly TripItem[];
  /** Save the list with exactly these items, in this order; resolves with why it did not save. */
  onSave: (name: string, itemIds: string[]) => Promise<SaveOutcome>;
  onClose: () => void;
}

/** The packing screen's own groups, so the checklist reads like the list the person has been packing from. */
const GROUPS = ["Everyday & occasion", "Toiletries", "Return outfit", "Pack last"] as const;
type Group = (typeof GROUPS)[number];

function groupOf(item: TripItem): Group {
  if (item.groupId) return "Toiletries";
  if (item.section === "return") return "Return outfit";
  if (item.section === "packlast") return "Pack last";
  return "Everyday & occasion";
}

// Save as a list (#169, design §1): name it, every item ticked (untick to leave out), and if two ticked items are the
// same normalised name and category, decide which to keep before saving. Saves name, category and needed quantity only.
export function SaveAsListSheet({ tripName, items, onSave, onClose }: SaveAsListSheetProps) {
  const formId = useId();
  const [name, setName] = useState(tripName.slice(0, LIST_NAME_MAX));
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set(items.map((item) => item.id)));
  const [step, setStep] = useState<"choose" | "duplicates">("choose");
  const [choices, setChoices] = useState<DuplicateChoices>({});
  const [problem, setProblem] = useState<null | "EMPTY" | "NAME_TAKEN" | "FAILED">(null);
  const [saving, setSaving] = useState(false);

  const grouped = useMemo(
    () =>
      GROUPS.map((group) => ({
        group,
        rows: items.filter((item) => groupOf(item) === group),
      })).filter((entry) => entry.rows.length > 0),
    [items],
  );
  const ordered = useMemo(() => grouped.flatMap((entry) => entry.rows), [grouped]);
  const tickedItems = ordered.filter((item) => ticked.has(item.id));

  const duplicateRows: DuplicateRow[] = tickedItems.map((item) => ({
    id: item.id,
    name: item.name,
    category: item.category,
    qty: item.qty,
    source: `in ${groupOf(item)}`,
  }));
  const groups = useMemo(() => groupDuplicates(duplicateRows), [duplicateRows]);
  const allTicked = ticked.size === items.length;
  const trimmed = name.trim();

  async function save(itemIds: string[]) {
    setSaving(true);
    const outcome = await onSave(trimmed, itemIds);
    setSaving(false);
    if (outcome.ok) return;
    setProblem(outcome.reason);
    if (outcome.reason === "NAME_TAKEN") setStep("choose");
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    if (step === "choose") {
      if (trimmed === "") return setProblem("EMPTY");
      if (tickedItems.length === 0) return;
      if (groups.length > 0) {
        setChoices({});
        setProblem(null);
        return setStep("duplicates");
      }
      return void save(tickedItems.map((item) => item.id));
    }
    if (!allDecided(groups, choices)) return;
    const dropped = new Set(droppedRowIds(groups, choices));
    void save(tickedItems.filter((item) => !dropped.has(item.id)).map((item) => item.id));
  }

  const toggle = (id: string) =>
    setTicked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const nameMessage =
    problem === "EMPTY"
      ? "Give the list a name."
      : problem === "NAME_TAKEN"
        ? `You already have a list called “${trimmed}”. Pick another name.`
        : null;
  const canSave = step === "choose" ? tickedItems.length > 0 : allDecided(groups, choices);
  const statusId = `${formId}-status`;

  return (
    <ModalSheet
      open
      showClose
      title={step === "choose" ? "Save as a list" : "Some items appear twice"}
      description={
        step === "duplicates"
          ? "A list is cleaner without repeats. Choose what to keep. Nothing is combined or added together."
          : undefined
      }
      onClose={onClose}
      actions={
        <>
          <Button
            type="submit"
            form={formId}
            disabled={saving || !canSave}
            aria-describedby={!canSave && step === "duplicates" ? statusId : undefined}
          >
            {saving ? "Saving…" : "Save list"}
          </Button>
          {step === "duplicates" ? (
            <Button variant="secondary" onClick={() => setStep("choose")}>
              Back
            </Button>
          ) : (
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
          )}
        </>
      }
    >
      <form id={formId} className="save-list-form" onSubmit={submit} noValidate>
        {step === "choose" ? (
          <>
            <label className="field">
              List name
              <input
                name="name"
                value={name}
                maxLength={LIST_NAME_MAX}
                autoComplete="off"
                autoFocus
                onFocus={(event) => event.currentTarget.select()}
                aria-invalid={nameMessage !== null}
                aria-describedby={nameMessage ? `${formId}-name` : undefined}
                onChange={(event) => {
                  setName(event.target.value);
                  setProblem(null);
                }}
              />
            </label>
            {nameMessage ? (
              <span id={`${formId}-name`} className="field-error" role="alert">
                {nameMessage}
              </span>
            ) : null}
            <p className="tiny muted">
              Saves the items and quantities from this trip. Packed progress isn’t saved. Every item
              is ticked; untick any you want to leave out.
            </p>
            <div className="save-list-count">
              <strong aria-live="polite">
                {tickedItems.length} of {items.length} items
              </strong>
              <button
                type="button"
                className="link-button"
                onClick={() =>
                  setTicked(allTicked ? new Set() : new Set(items.map((item) => item.id)))
                }
              >
                {allTicked ? "Untick all" : "Tick all"}
              </button>
            </div>
            <div className="save-list-items">
              {grouped.map(({ group, rows }) => (
                <fieldset key={group} className="save-list-group">
                  <legend>{group}</legend>
                  {rows.map((item) => (
                    <label key={item.id} className="save-list-row">
                      <input
                        type="checkbox"
                        checked={ticked.has(item.id)}
                        onChange={() => toggle(item.id)}
                      />
                      <span className="save-list-box" aria-hidden="true">
                        ✓
                      </span>
                      <span className="save-list-copy">
                        <strong>{item.name}</strong>
                        <small>
                          {item.category} · qty {item.qty}
                        </small>
                      </span>
                    </label>
                  ))}
                </fieldset>
              ))}
            </div>
          </>
        ) : (
          <DuplicateResolver
            groups={groups}
            choices={choices}
            statusId={statusId}
            onChoose={(key: string, choice: DuplicateChoice) =>
              setChoices((current) => ({ ...current, [key]: choice }))
            }
          />
        )}
        {problem === "FAILED" ? (
          <p className="field-error" role="alert">
            Couldn’t save. Nothing was changed.
          </p>
        ) : null}
      </form>
    </ModalSheet>
  );
}
