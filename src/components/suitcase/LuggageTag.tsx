import type { HTMLAttributes } from "react";
import { cx } from "./cx";
import styles from "./LuggageTag.module.css";

export interface LuggageTagProps extends HTMLAttributes<HTMLDivElement> {
  /** "card" is the hero tag (Home, Plan preview); "mini" is an upcoming-trip row (64px laptop, 58px phone). */
  variant?: "card" | "mini";
}

// The luggage tag (spec part 2 section 3): a paper card whose left corners are cut diagonally, with a punched hole on
// the left edge. The shadow is a drop-shadow on the wrapper so it follows the notch. The tag only draws the shape; the
// trip text inside it belongs to the screen.
export function LuggageTag({ variant = "card", className, children, ...rest }: LuggageTagProps) {
  return (
    <div className={cx(styles.wrap, variant === "mini" && styles.mini, className)} {...rest}>
      <div className={styles.tag} data-luggage-tag={variant}>
        <span className={styles.hole} aria-hidden="true" data-luggage-hole />
        <div className={styles.content}>{children}</div>
      </div>
    </div>
  );
}
