"use client";

import { useId, useState } from "react";
import { THEMES, type ThemeId } from "@/domain/themes";

export interface ThemePickerProps {
  value: ThemeId;
  onChange: (theme: ThemeId) => void;
  /** Wording under the legend. */
  help?: string;
}

// A native radio group (so Tab enters it once and the arrow keys move and select). Every tile shows its name as
// text and a check badge when selected, so colour is never the only signal. A thumbnail that fails to load leaves
// the neutral box in place with the label still visible.
export function ThemePicker({
  value,
  onChange,
  help = "Pick a picture for your trip. You can change it later.",
}: ThemePickerProps) {
  const name = useId();
  const [failed, setFailed] = useState<ReadonlySet<ThemeId>>(new Set());
  return (
    <fieldset className="theme-picker">
      <legend>Trip theme</legend>
      <p className="tiny muted">{help}</p>
      <div className="theme-grid">
        {THEMES.map((theme) => (
          <label key={theme.id} className="theme-tile" data-theme-id={theme.id}>
            <input
              type="radio"
              name={name}
              value={theme.id}
              checked={value === theme.id}
              onChange={() => onChange(theme.id)}
            />
            <span className="theme-thumb" aria-hidden="true">
              {failed.has(theme.id) ? null : (
                // eslint-disable-next-line @next/next/no-img-element -- SVG: the image optimizer refuses it, and there is nothing to optimize
                <img
                  src={theme.src}
                  alt=""
                  onError={() => setFailed((current) => new Set(current).add(theme.id))}
                />
              )}
            </span>
            <span className="theme-label">{theme.label}</span>
            <span className="theme-check" aria-hidden="true">
              ✓
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
