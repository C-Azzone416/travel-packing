"use client";

import { useId } from "react";
import { APPEARANCE_OPTIONS, appearanceName, type Appearance } from "@/domain/appearance";

export interface ThemePickerProps {
  value: Appearance;
  onChange: (appearance: Appearance) => void;
}

/**
 * Three native radio cards. The miniature suitcase in each card is scoped to that scheme's own tokens, so it remains
 * truthful without hard-coded colours; arrow keys, Space and focus remain native.
 */
export function ThemePicker({ value, onChange }: ThemePickerProps) {
  const name = useId();
  return (
    <>
      <div className="theme-options" role="radiogroup" aria-label="Colour scheme">
        {APPEARANCE_OPTIONS.map((option) => (
          <label key={option.id} className="appearance-option">
            <input
              type="radio"
              name={name}
              value={option.id}
              checked={value === option.id}
              onChange={() => onChange(option.id)}
            />
            <span className="appearance-swatches" data-scheme={option.id} aria-hidden="true">
              <i className="appearance-swatch-accent" />
              <i className="appearance-swatch-gold" />
            </span>
            <span className="appearance-copy">
              <strong>{option.name}</strong>
              {option.id === "ocean" ? <small>Default</small> : null}
              <span>{option.description}</span>
            </span>
            <span className="appearance-check" aria-hidden="true">
              ✓
            </span>
          </label>
        ))}
      </div>
      <p className="appearance-status" role="status" aria-live="polite">
        Current theme: <strong>{appearanceName(value)}</strong>
      </p>
    </>
  );
}
