"use client";

import { useId, type KeyboardEvent } from "react";
import { Chip } from "@/components/suitcase/Chip";
import { Stepper } from "@/components/suitcase/Stepper";
import { Icon } from "@/components/ui/Icon";
import { CUBE_LABELS, type Cube } from "@/domain/cubes";
import type { Staple } from "@/domain/trip";
import {
  cadenceChoices,
  withCadence,
  STAPLE_CUBES,
  canHaveLaundry,
  moveToCube,
  stapleCube,
  withLaundry,
} from "./staples-cubes";
import { StapleNameField } from "./StapleNameField";
import styles from "./Staples.module.css";

export interface StapleEditorControls {
  staple: Staple;
  /** The staple that already has this name (other than `exceptId`), for the rename check. */
  taken: (name: string, exceptId: string) => Staple | undefined;
  onChange: (next: Staple) => void;
  onRemove: () => void;
  onClose: () => void;
}

/** Why the laundry flag is unavailable, or null when it can be set. */
export function laundryBlockedReason(staple: Staple): string | null {
  if (canHaveLaundry(staple)) return null;
  return staple.cadence === "smart"
    ? "A Smart count follows your trip's preferences, so laundry does not change it."
    : "Underwear and socks stay one per day, with or without laundry.";
}

// The laptop's inline editor (spec part 3 section 1.5): it opens in place under the row. Changes save as they are made.
// Escape closes it. Pack last, the one control the redesign does not draw, lives here as a small switch.
export function StapleInlineEditor({
  staple,
  taken,
  onChange,
  onRemove,
  onClose,
}: StapleEditorControls) {
  const hintId = useId();
  const blocked = laundryBlockedReason(staple);
  const on = Boolean(staple.laundryHalves) && blocked === null;
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
    }
  };
  return (
    <div
      className={styles.editor}
      role="group"
      aria-label={`Edit ${staple.name}`}
      onKeyDown={onKeyDown}
    >
      <StapleNameField
        key={`${staple.id}:${staple.name}`}
        staple={staple}
        taken={taken}
        onRename={(name) => onChange({ ...staple, name })}
      />
      <div className={styles.editorRow}>
        <Stepper
          label={`Quantity for ${staple.name}`}
          itemName={staple.name}
          value={staple.qty}
          onChange={(qty) => onChange({ ...staple, qty })}
        />
        <select
          className={styles.cubeSelect}
          aria-label={`Cube for ${staple.name}`}
          value={stapleCube(staple)}
          onChange={(event) => onChange(moveToCube(staple, event.target.value as Cube))}
        >
          {STAPLE_CUBES.map((cube) => (
            <option key={cube} value={cube}>
              {CUBE_LABELS[cube]}
            </option>
          ))}
        </select>
      </div>
      <div className={styles.editorRow} role="group" aria-label={`How ${staple.name} scales`}>
        {cadenceChoices(staple).map((cadence) => (
          <Chip
            key={cadence}
            size="row"
            selected={staple.cadence === cadence}
            onClick={() => onChange(withCadence(staple, cadence))}
          >
            {cadence}
          </Chip>
        ))}
      </div>
      <div className={styles.editorRow}>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label="Fewer with laundry"
          aria-describedby={blocked ? hintId : undefined}
          disabled={blocked !== null}
          className={styles.laundryPill}
          onClick={() => onChange(withLaundry(staple, !on))}
        >
          <Icon name="refresh" size={14} />
          {`Fewer with laundry · ${on ? "on" : "off"}`}
        </button>
        <button type="button" className={styles.remove} onClick={onRemove}>
          Remove
        </button>
      </div>
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
      {blocked ? (
        <p id={hintId} className={styles.hint}>
          {blocked}
        </p>
      ) : null}
    </div>
  );
}
