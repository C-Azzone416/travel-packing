import { useId, type ReactNode } from "react";

export interface SwitchProps {
  label: string;
  description?: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}

// A labelled on/off preference row. A real checkbox with role="switch", so it is
// keyboard and screen-reader operable; the whole switch is a 44px-high target.
export function Switch({ label, description, checked, onChange, disabled = false }: SwitchProps) {
  const labelId = useId();
  const descriptionId = useId();
  return (
    <div className="toggle-row">
      <div>
        <strong id={labelId}>{label}</strong>
        {description ? <p id={descriptionId}>{description}</p> : null}
      </div>
      <label className="switch">
        <input
          type="checkbox"
          role="switch"
          checked={checked}
          disabled={disabled}
          aria-labelledby={labelId}
          aria-describedby={description ? descriptionId : undefined}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span aria-hidden="true" />
      </label>
    </div>
  );
}
