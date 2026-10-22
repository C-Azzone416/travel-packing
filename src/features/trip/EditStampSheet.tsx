"use client";

import { useId, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { ModalSheet } from "@/components/ui/ModalSheet";
import { Stamps } from "@/components/stamp/Stamp";
import { alpha3For } from "@/domain/iso-alpha3";
import {
  NO_STAMP_LABELS,
  STAMP_LABEL_MESSAGE,
  normaliseStampLabel,
  upperCaseAscii,
  type StampLabels,
  type StampSpec,
} from "@/domain/stamps";
import type { TripStop } from "@/domain/trip-stops";

export interface EditStampSheetProps {
  /** What each stamp says with no override, in route order (at most two; none when the route has no country). */
  automatic: readonly StampSpec[];
  /** The trip's stops, to say where an automatic label comes from. */
  stops: readonly TripStop[];
  /** The labels saved now (null = automatic). */
  saved: StampLabels | undefined;
  /** The trip's first departure, for the preview. */
  departure: string;
  saving: boolean;
  /** The last save did not go through. The sheet stays open and Save tries again. */
  failed?: boolean;
  onClose: () => void;
  /** The typed text for each slot, or null for automatic. The server trims, upper-cases and validates it again. */
  onSave: (slot1: string | null, slot2: string | null) => void;
}

type Mode = "automatic" | "custom";

/** "LIS, the largest airport near Lisbon" or "PRT, the country code for Portugal": where an automatic label comes from. */
function automaticReason(stamp: StampSpec, stops: readonly TripStop[]): string {
  const first = stops[0]?.location;
  if (stamp.kind === "airport") return `${stamp.label}, the largest airport near ${stamp.cityName}`;
  const stop =
    stops.find((entry) => alpha3For(entry.location.countryCode) === stamp.label) ?? stops[0];
  const place = stop?.location.country || first?.country || stamp.cityName || stamp.label;
  return `${stamp.label}, the country code for ${place}`;
}

// Edit the stamp labels (#151, design's spec): one block per stamp the trip shows, Automatic or Custom for each, a live
// preview, and Reset to automatic for a saved override. A custom label is exactly three of A-Z and 0-9; the server
// checks it again. Cancel discards.
export function EditStampSheet({
  automatic,
  stops,
  saved,
  departure,
  saving,
  failed = false,
  onClose,
  onSave,
}: EditStampSheetProps) {
  const formId = useId();
  const labels = saved ?? NO_STAMP_LABELS;
  const slots = Math.max(automatic.length, 1);
  const [modes, setModes] = useState<Mode[]>(
    labels.map((label) => (label ? "custom" : "automatic")),
  );
  const [texts, setTexts] = useState<string[]>(labels.map((label) => label ?? ""));
  const [touched, setTouched] = useState<boolean[]>([false, false]);

  const draft = (index: number): { value: string | null; valid: boolean } => {
    if (modes[index] === "automatic") return { value: null, valid: true };
    const label = normaliseStampLabel(texts[index]);
    if (!label.ok || label.label === null) return { value: null, valid: false };
    return { value: label.label === automatic[index]?.label ? null : label.label, valid: true };
  };
  const drafts = [0, 1].map((index) =>
    index < slots ? draft(index) : { value: null, valid: true },
  );
  const dirty = drafts.some((entry, index) => entry.value !== (labels[index] ?? null));
  const invalid = drafts.some((entry, index) => index < slots && !entry.valid);

  const setMode = (index: number, mode: Mode) => {
    setModes((current) => current.map((entry, at) => (at === index ? mode : entry)));
    // Switching to Custom starts from something real: the label it would show now.
    if (mode === "custom" && texts[index] === "") {
      setTexts((current) =>
        current.map((entry, at) => (at === index ? (automatic[index]?.label ?? "") : entry)),
      );
    }
  };
  const touch = (index: number) =>
    setTouched((current) => current.map((entry, at) => (at === index ? true : entry)));

  function submit(event: FormEvent) {
    event.preventDefault();
    if (saving || !dirty) return;
    if (invalid) {
      setTouched([true, true]);
      return;
    }
    onSave(drafts[0].value, slots > 1 ? drafts[1].value : null);
  }

  return (
    <ModalSheet
      open
      showClose
      title="Stamp label"
      description="Choose what each stamp says on this trip. Automatic labels come from your route."
      onClose={onClose}
      actions={
        <>
          <Button type="submit" form={formId} disabled={saving || !dirty || invalid}>
            {saving ? "Saving…" : "Save"}
          </Button>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
        </>
      }
    >
      <form id={formId} className="stamp-form" onSubmit={submit} noValidate>
        {Array.from({ length: slots }, (_, index) => {
          const number = index + 1;
          const mode = modes[index];
          const auto = automatic[index];
          const problem = touched[index] && !drafts[index].valid;
          const text = texts[index];
          const shown = mode === "custom" && drafts[index].valid ? normaliseStampLabel(text) : null;
          const previewLabel = (shown?.ok ? shown.label : null) ?? auto?.label ?? null;
          const modeName = `${formId}-mode-${number}`;
          const fieldId = `${formId}-label-${number}`;
          return (
            <div
              key={number}
              className="stamp-block"
              role="group"
              aria-label={`Stamp ${number}, ${mode}`}
            >
              <div className="stamp-preview" aria-hidden="true">
                {previewLabel ? (
                  <Stamps
                    compact
                    firstSlot={number === 2 ? 2 : 1}
                    departure={departure}
                    stamps={[
                      {
                        kind: mode === "custom" ? "custom" : (auto?.kind ?? "custom"),
                        label: previewLabel,
                      },
                    ]}
                  />
                ) : (
                  <p className="tiny muted">No stamp</p>
                )}
              </div>
              <div className="stamp-controls">
                <div className="stamp-heading">
                  <h3>Stamp {number}</h3>
                  <span className="stamp-tag" data-mode={mode}>
                    {mode === "custom" ? "Custom" : "Automatic"}
                  </span>
                </div>
                <div
                  className="temperature-unit-options"
                  role="radiogroup"
                  aria-label={`Stamp ${number} label mode`}
                >
                  {(["automatic", "custom"] as const).map((option) => (
                    <label key={option}>
                      <input
                        type="radio"
                        name={modeName}
                        value={option}
                        checked={mode === option}
                        onChange={() => setMode(index, option)}
                      />
                      <span>{option === "automatic" ? "Automatic" : "Custom"}</span>
                    </label>
                  ))}
                </div>
                {mode === "automatic" ? (
                  <p className="tiny muted">
                    {auto
                      ? automaticReason(auto, stops)
                      : "No automatic label (this route has no country)."}
                  </p>
                ) : (
                  <>
                    <label className="field">
                      Label
                      <input
                        id={fieldId}
                        className="stamp-input"
                        value={text}
                        maxLength={3}
                        autoCapitalize="characters"
                        autoComplete="off"
                        spellCheck={false}
                        aria-invalid={problem}
                        aria-describedby={`${fieldId}-help${problem ? ` ${fieldId}-error` : ""}`}
                        onChange={(event) =>
                          setTexts((current) =>
                            current.map((entry, at) =>
                              at === index
                                ? upperCaseAscii(event.target.value).replace(/\s/g, "")
                                : entry,
                            ),
                          )
                        }
                        onBlur={() => touch(index)}
                      />
                    </label>
                    <p id={`${fieldId}-help`} className="tiny muted">
                      3 letters or numbers
                    </p>
                    {problem ? (
                      <p id={`${fieldId}-error`} className="field-error" role="alert">
                        {STAMP_LABEL_MESSAGE}
                      </p>
                    ) : null}
                  </>
                )}
                {labels[index] ? (
                  <button
                    type="button"
                    className="link-button"
                    onClick={() => setMode(index, "automatic")}
                  >
                    Reset to automatic
                  </button>
                ) : null}
              </div>
            </div>
          );
        })}
        {failed ? (
          <p className="field-error" role="alert">
            Couldn’t save the stamp. Nothing changed. Press Save to try again.
          </p>
        ) : null}
      </form>
    </ModalSheet>
  );
}
