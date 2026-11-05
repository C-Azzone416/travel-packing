import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";
import shared from "./shared.module.css";
import styles from "./Chip.module.css";

export interface ChipProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  children: ReactNode;
  /**
   * "plain" is a per-trip chip (paper, --tint border). "scaled" is a per-day or per-night chip, the quantity that
   * grows with the trip (--tint fill, --dark border). The words say it too, so colour is never the only signal.
   */
  tone?: "plain" | "scaled";
  /** "row" is the 30px chip on a Staples row; "editor" is the 37px chip group in the editor. */
  size?: "row" | "editor";
  /** Set it on an editor chip: the chosen cadence is dark and exposed as aria-pressed. A row chip leaves it unset. */
  selected?: boolean;
}

// A cadence chip (spec part 2 section 5). A button that opens the inline editor (row) or sets the cadence (editor).
export function Chip({
  children,
  tone = "plain",
  size = "row",
  selected,
  className,
  type = "button",
  ...rest
}: ChipProps) {
  return (
    <button
      type={type}
      aria-pressed={selected}
      className={cx(
        styles.chip,
        shared.hit,
        shared.ring,
        size === "editor" && styles.editor,
        tone === "scaled" && styles.scaled,
        selected && styles.selected,
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
