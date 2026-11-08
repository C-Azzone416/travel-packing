"use client";

import { useId, useState } from "react";
import type { Staple } from "@/domain/trip";
import styles from "./Staples.module.css";

export const STAPLE_NAME_MAX = 50;

export interface StapleNameFieldProps {
  staple: Staple;
  /** The staple that already has this name (other than this one), if any. */
  taken: (name: string, exceptId: string) => Staple | undefined;
  onRename: (name: string) => void;
}

// Rename in the editor. The new name is checked and saved when the field is left or Enter is pressed (never per keystroke,
// so a half-typed name is not stored): it must not be empty or another staple's name.
export function StapleNameField({ staple, taken, onRename }: StapleNameFieldProps) {
  const [value, setValue] = useState(staple.name);
  const [problem, setProblem] = useState<string | null>(null);
  const errorId = useId();

  const commit = () => {
    const name = value.trim();
    if (name === staple.name) {
      setValue(name);
      return setProblem(null);
    }
    if (name === "") return setProblem("Enter a name.");
    const duplicate = taken(name, staple.id);
    if (duplicate) return setProblem(`You already have ${duplicate.name}.`);
    setProblem(null);
    setValue(name);
    onRename(name);
  };

  return (
    <div className={styles.nameField}>
      <label className={styles.nameLabel}>
        Name
        <input
          className={styles.nameInput}
          name="packing-item-name"
          value={value}
          maxLength={STAPLE_NAME_MAX}
          autoComplete="off"
          aria-invalid={problem !== null}
          aria-describedby={problem ? errorId : undefined}
          onChange={(event) => {
            setValue(event.target.value);
            setProblem(null);
          }}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commit();
            }
          }}
        />
      </label>
      {problem ? (
        <p id={errorId} role="alert" className={styles.nameProblem}>
          {problem}
        </p>
      ) : null}
    </div>
  );
}
