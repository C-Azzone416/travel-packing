"use client";

import { useId } from "react";
import { APPEARANCE_OPTIONS, appearanceName, type Appearance } from "@/domain/appearance";

export interface ThemePickerProps {
  value: Appearance;
  onChange: (appearance: Appearance) => void;
}

/**
 * The Theme radiogroup (#139 §4). Native radio inputs, each in a label whose text names the theme, so the accessible
 * name comes from the words and the arrow keys, Space and focus all work with no script. The swatch trio (accent,
 * second accent, surface) is drawn from the theme's own tokens through data-theme-preview and is decorative.
 */
export function ThemePicker({ value, onChange }: ThemePickerProps) {
  const name = useId();
  return (
    <>
      <div className="theme-options" role="radiogroup" aria-label="Theme">
        {APPEARANCE_OPTIONS.map((option) => (
          <label key={option.id} className="appearance-option">
            <input
              type="radio"
              name={name}
              value={option.id}
              checked={value === option.id}
              onChange={() => onChange(option.id)}
            />
            <span className="appearance-swatches" data-theme-preview={option.id} aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            <span className="appearance-copy">
              <strong>{option.name}</strong>
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
