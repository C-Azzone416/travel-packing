"use client";

import { useEffect, useId, useRef } from "react";
import { Chip } from "@/components/suitcase/Chip";
import { Stepper } from "@/components/suitcase/Stepper";
import { Icon } from "@/components/ui/Icon";
import { ModalSheet } from "@/components/ui/ModalSheet";
import { CUBE_LABELS, type Cube } from "@/domain/cubes";
import {
  cadenceChoices,
  withCadence,
  STAPLE_CUBES,
  moveToCube,
  stapleCube,
  withLaundry,
} from "./staples-cubes";
import { laundryBlockedReason, type StapleEditorControls } from "./StapleInlineEditor";
import { StapleNameField } from "./StapleNameField";
import styles from "./Staples.module.css";

// The phone's editor (spec part 3 section 1.5, st-p-sheet): a bottom sheet with CUBE chips, HOW MANY, the laundry row,
// and Remove / Done. ModalSheet gives it the focus trap, Escape, and the return of focus to the row that opened it.
export function StapleSheet({
  staple,
  locked = false,
  recovery,
  taken,
  onChange,
  onRemove,
  onClose,
}: StapleEditorControls) {
  const sheetRef = useRef<HTMLFieldSetElement>(null);
  const radioName = useId();
  useEffect(() => {
    if (!locked) return;
    const dialog = sheetRef.current?.closest('[role="dialog"]');
    // ModalSheet's attribute selector misses native fieldset disabling; tab only among recovery and Done.
    const tab = (event: KeyboardEvent) => {
      if (event.key !== "Tab" || !dialog?.contains(document.activeElement)) return;
      const buttons = [...dialog.querySelectorAll<HTMLButtonElement>("button")].filter(
        (button) => !button.matches(":disabled"),
      );
      const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.shiftKey
        ? current <= 0
          ? buttons.length - 1
          : current - 1
        : current === buttons.length - 1
          ? 0
          : current + 1;
      event.preventDefault();
      event.stopPropagation();
      buttons[next]?.focus();
    };
    window.addEventListener("keydown", tab, true);
    return () => window.removeEventListener("keydown", tab, true);
  }, [locked]);
  const hintId = useId();
  const blocked = laundryBlockedReason(staple);
  const on = Boolean(staple.laundryHalves) && blocked === null;
  const cube = stapleCube(staple);
  return (
    <ModalSheet
      open
      title={staple.name}
      focusTitle={locked}
      onClose={onClose}
      actions={
        <div className={styles.sheetActions}>
          <button type="button" className={styles.sheetRemove} disabled={locked} onClick={onRemove}>
            Remove
          </button>
          <button type="button" className={styles.sheetDone} onClick={onClose}>
            Done
          </button>
        </div>
      }
    >
      <fieldset
        ref={sheetRef}
        disabled={locked}
        className={styles.sheet}
        style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
      >
        <StapleNameField
          key={`${staple.id}:${staple.name}`}
          staple={staple}
          taken={taken}
          onRename={(name) => onChange({ ...staple, name })}
        />
        <p className={styles.eyebrow} id={`${radioName}-cube`}>
          Cube
        </p>
        <div className={styles.chips} role="radiogroup" aria-labelledby={`${radioName}-cube`}>
          {STAPLE_CUBES.map((option) => (
            <label key={option} className={styles.radioChip}>
              <input
                type="radio"
                name={radioName}
                value={option}
                checked={cube === option}
                onChange={() => onChange(moveToCube(staple, option as Cube))}
              />
              <span>{CUBE_LABELS[option]}</span>
            </label>
          ))}
        </div>
        <p className={styles.eyebrow}>How many</p>
        <div className={styles.chips}>
          <Stepper
            size="sheet"
            label={`Quantity for ${staple.name}`}
            itemName={staple.name}
            value={staple.qty}
            onChange={(qty) => onChange({ ...staple, qty })}
          />
          <div className={styles.chips} role="group" aria-label={`How ${staple.name} scales`}>
            {cadenceChoices(staple).map((cadence) => (
              <Chip
                key={cadence}
                size="editor"
                selected={staple.cadence === cadence}
                onClick={() => onChange(withCadence(staple, cadence))}
              >
                {cadence}
              </Chip>
            ))}
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label="Fewer with laundry"
          aria-describedby={blocked ? hintId : undefined}
          disabled={blocked !== null}
          className={styles.laundryRow}
          onClick={() => onChange(withLaundry(staple, !on))}
        >
          <span>
            <Icon name="refresh" size={18} />
            <span className={styles.laundryText}>Fewer with laundry</span>
          </span>
          <span>{on ? "On" : "Off"}</span>
        </button>
        {blocked ? (
          <p id={hintId} className={styles.hint}>
            {blocked}
          </p>
        ) : null}
        <label className={`${styles.switchRow} ${styles.packLastSwitch}`}>
          Pack last
          <input
            className={styles.switchInput}
            type="checkbox"
            role="switch"
            checked={staple.packLast}
            onChange={(event) => onChange({ ...staple, packLast: event.target.checked })}
          />
          <span className={styles.switchTrack} aria-hidden="true" />
        </label>
        <p className={styles.packLastHint}>Packed last, on the morning you leave</p>
      </fieldset>
      {recovery}
    </ModalSheet>
  );
}
