import type { HTMLAttributes } from "react";
import { Icon } from "@/components/ui/Icon";
import { cx } from "./cx";
import styles from "./Markers.module.css";

/**
 * The laundry marker (spec part 3 section 6): the open-circle refresh icon, 16px in an item row, after the quantity.
 * It is a real icon, not a glyph, so the packed strike never crosses it. Never colour alone: the visually hidden text
 * says what it means. `variant="staples"` is the 22px circle that sits before the cadence chip.
 */
export function LaundryMarker({
  variant = "row",
  onDark = false,
  className,
  ...rest
}: {
  variant?: "row" | "staples";
  /** On the dark suitcase the marker uses --onDarkMuted. */
  onDark?: boolean;
} & HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cx(
        styles.laundry,
        variant === "staples" && styles.staples,
        onDark && styles.onDark,
        className,
      )}
      data-laundry-marker={variant}
      {...rest}
    >
      <Icon name="refresh" size={variant === "staples" ? 14 : 16} className={styles.laundryIcon} />
      <span className="sr-only">Fewer with laundry</span>
    </span>
  );
}

/**
 * The Morning-of marker (spec part 3 section 6): plain text, 13px 600, no icon and no fill. It takes its colour from
 * where it sits (--muted on paper, --onDarkMuted on dark, and the active chip's own text colour).
 */
export function MorningOfMarker({ className, ...rest }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span className={cx(styles.morning, className)} data-morning-of {...rest}>
      Morning of
    </span>
  );
}
