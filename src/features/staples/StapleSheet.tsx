"use client";

import { useId } from "react";
import { Chip } from "@/components/suitcase/Chip";
import { Stepper } from "@/components/suitcase/Stepper";
import { Icon } from "@/components/ui/Icon";
import { ModalSheet } from "@/components/ui/ModalSheet";
import { CUBE_LABELS, type Cube } from "@/domain/cubes";
import {
  CADENCE_CHOICES,
  STAPLE_CUBES,
  moveToCube,
  stapleCube,
  withLaundry,
} from "./staples-cubes";
import { laundryBlockedReason, type StapleEditorControls } from "./StapleInlineEditor";
import styles from "./Staples.module.css";

// The phone's editor (spec part 3 section 1.5, st-p-sheet): a bottom sheet with CUBE chips, HOW MANY, the laundry row,
// and Remove / Done. ModalSheet gives it the focus trap, Escape, and the return of focus to the row that opened it.
export function StapleSheet({ staple, onChange, onRemove, onClose }: StapleEditorControls) {
  const radioName = useId();
  const hintId = useId();
  const blocked = laundryBlockedReason(staple);
  const on = Boolean(staple.laundryHalves) && blocked === null;
  const cube = stapleCube(staple);
  return (
    <ModalSheet
      open
      title={staple.name}
      onClose={onClose}
      actions={
        <div className={styles.sheetActions}>
          <button type="button" className={styles.sheetRemove} onClick={onRemove}>
            Remove
          </button>
          <button type="button" className={styles.sheetDone} onClick={onClose}>
            Done
          </button>
        </div>
      }
    >
      <div className={styles.sheet}>
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
            {CADENCE_CHOICES.map((cadence) => (
              <Chip
                key={cadence}
                size="editor"
                selected={staple.cadence === cadence}
                onClick={() => onChange({ ...staple, cadence })}
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
      </div>
    </ModalSheet>
  );
}
