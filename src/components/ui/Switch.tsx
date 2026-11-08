import { useId, type ReactNode } from "react";

export interface SwitchProps {
  label: string;
  description?: ReactNode;
  /** A small mark before the title (the laundry ↻); hidden from assistive tech, the label already says it. */
  marker?: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  /** Another element's id that also describes this switch (for example why it is disabled). */
  describedBy?: string;
}

// A labelled on/off preference row. A real checkbox with role="switch", so it is
// keyboard and screen-reader operable; the whole switch is a 44px-high target.
export function Switch({
  label,
  description,
  marker,
  checked,
  onChange,
  disabled = false,
  describedBy,
}: SwitchProps) {
  const labelId = useId();
  const descriptionId = useId();
  return (
    <div className="toggle-row">
      <div>
        <strong id={labelId}>
          {marker ? (
            <span className="switch-marker" aria-hidden="true">
              {marker}
            </span>
          ) : null}
          {label}
        </strong>
        {description ? <p id={descriptionId}>{description}</p> : null}
      </div>
      <label className="switch">
        <input
          type="checkbox"
          role="switch"
          checked={checked}
          disabled={disabled}
          aria-labelledby={labelId}
          aria-describedby={
            [description ? descriptionId : null, describedBy].filter(Boolean).join(" ") || undefined
          }
          onChange={(event) => onChange(event.target.checked)}
        />
        <span aria-hidden="true" />
      </label>
    </div>
  );
}
