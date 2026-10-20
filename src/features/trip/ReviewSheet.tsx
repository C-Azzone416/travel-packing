"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { ModalSheet } from "@/components/ui/ModalSheet";
import { ClampedText } from "./ClampedText";
import { UPDATE_SPLIT_TITLE, type WeatherChange } from "@/domain/weather/diff";

export interface ReviewSheetProps {
  open: boolean;
  changes: WeatherChange[];
  ready: boolean;
  saving: boolean;
  error?: boolean;
  legacyPacked?: boolean;
  onClose: () => void;
  onApply: (selected: WeatherChange[], skipped: WeatherChange[]) => void;
  onSkip: (changes: WeatherChange[]) => void;
}

function changeTitle(change: WeatherChange): string {
  if (change.kind === "add") return `Add ${change.title}`;
  if (change.kind === "remove") return `Remove ${change.title}`;
  return change.title;
}

function changeReason(change: WeatherChange): string {
  if (change.kind === "split") {
    // A trip already split by weather has no Everyday rows to replace: say what changes instead.
    return change.title === UPDATE_SPLIT_TITLE
      ? change.reason
      : "Replaces Everyday tops and Everyday bottoms with short-sleeve, long-sleeve, shorts and pants.";
  }
  return change.userEdited ? `Offered only: ${change.reason}` : change.reason;
}

export function ReviewSheet(props: ReviewSheetProps) {
  const resetKey = props.open
    ? `open:${props.changes.map((change) => `${change.semanticId}:${change.ruleSignature}`).join("|")}`
    : "closed";
  return <ReviewSheetState key={resetKey} {...props} />;
}

function ReviewSheetState({
  open,
  changes,
  ready,
  saving,
  error = false,
  legacyPacked = false,
  onClose,
  onApply,
  onSkip,
}: ReviewSheetProps) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(
    () =>
      new Set(changes.filter((change) => !change.userEdited).map((change) => change.semanticId)),
  );
  const selectAll = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (selectAll.current) {
      selectAll.current.indeterminate = selected.size > 0 && selected.size < changes.length;
    }
  }, [changes.length, selected]);

  const chosen = changes.filter((change) => selected.has(change.semanticId));
  const skipped = changes.filter((change) => !selected.has(change.semanticId));
  const allSelected = changes.length > 0 && chosen.length === changes.length;

  return (
    <ModalSheet
      open={open}
      title="Weather changes"
      description="Based on the weather for your stops. Choose what to add."
      onClose={onClose}
      showClose
      actions={
        <>
          <Button
            variant="secondary"
            className="review-skip"
            disabled={saving}
            onClick={() => onSkip(changes)}
          >
            Skip
          </Button>
          <Button
            className="review-add"
            disabled={saving || chosen.length === 0}
            aria-live="polite"
            onClick={() => onApply(chosen, skipped)}
          >
            {chosen.length > 0 ? `Add selected (${chosen.length})` : "Add selected"}
          </Button>
          <p className="review-skip-copy tiny muted">
            Skipped changes stay hidden until the weather changes them.
          </p>
        </>
      }
    >
      {error ? (
        <div className="field-error" role="alert">
          <p>Couldn’t add those. Nothing was changed.</p>
          <Button
            variant="secondary"
            small
            disabled={saving}
            onClick={() => onApply(chosen, skipped)}
          >
            Try again
          </Button>
        </div>
      ) : null}
      <label className="weather-select-all">
        <input
          ref={selectAll}
          type="checkbox"
          checked={allSelected}
          data-modal-autofocus=""
          onChange={() =>
            setSelected(
              allSelected ? new Set() : new Set(changes.map((change) => change.semanticId)),
            )
          }
        />
        <strong>Select all ({changes.length})</strong>
      </label>
      <div className="weather-change-list">
        {changes.map((change) => {
          const checked = selected.has(change.semanticId);
          return (
            <label key={change.semanticId} className="weather-change-row">
              <input
                type="checkbox"
                checked={checked}
                onChange={() =>
                  setSelected((current) => {
                    const next = new Set(current);
                    if (checked) next.delete(change.semanticId);
                    else next.add(change.semanticId);
                    return next;
                  })
                }
              />
              <span className="weather-change-copy">
                <strong>{changeTitle(change)}</strong>
                <span className="weather-change-reason">
                  <ClampedText text={changeReason(change)} />
                </span>
                {change.kind === "split" ? (
                  <details>
                    <summary>See the new counts</summary>
                    <span>
                      {change.clothing.map((line) => `${line.name} ${line.qty}`).join(" · ")}
                    </span>
                  </details>
                ) : null}
                {change.kind === "split" && legacyPacked ? (
                  <span className="weather-change-caution">
                    Items you’ve already packed in those rows will need to be packed again.
                  </span>
                ) : null}
              </span>
              <span className="weather-change-tags">
                <span className="tag">Weather</span>
                {change.userEdited ? <span className="tag">You edited this</span> : null}
              </span>
            </label>
          );
        })}
      </div>
      {ready ? (
        <p className="weather-ready-callout">
          <span aria-hidden="true">⚠</span>{" "}
          <strong>
            Adding these takes this trip out of Ready. You’ll need to confirm it again.
          </strong>
        </p>
      ) : null}
    </ModalSheet>
  );
}
