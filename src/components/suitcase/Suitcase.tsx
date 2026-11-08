import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";
import styles from "./Suitcase.module.css";

export type SuitcaseInterior = "paper" | "dark";
/** How far the content sits from the rim: Home 20/12, Staples 14/9, Stamps 24/16 (laptop/phone), or touching the rim. */
export type SuitcaseInset = "none" | "home" | "staples" | "stamps";

export interface SuitcaseProps extends HTMLAttributes<HTMLDivElement> {
  /** paper = the Home suitcase (--paper2); dark = Packing, Staples and Stamps (cards sit directly on the case). */
  interior?: SuitcaseInterior;
  /** Defaults to "home" for a paper interior and "none" for a dark one. */
  inset?: SuitcaseInset;
  /** A ribbon that hangs from the handle (PackedRibbon, #411). Absent or null: the suitcase is unchanged. */
  ribbon?: ReactNode;
}

// The suitcase (spec part 2 section 1): a dark rim with a hollow handle on top and an interior that holds the screen's
// content. Laptop and phone sizes are one component; the 1024px switch is in the CSS. Purely visual: the children keep
// their own landmarks and headings.
export function Suitcase({
  interior = "paper",
  inset,
  ribbon,
  className,
  children,
  ...rest
}: SuitcaseProps) {
  const resolved: SuitcaseInset = inset ?? (interior === "paper" ? "home" : "none");
  return (
    <div className={cx(styles.suitcase, className)} {...rest}>
      <div className={styles.rim}>
        <span className={styles.handle} aria-hidden="true" data-suitcase-handle />
        {ribbon ? <div className={styles.ribbon}>{ribbon}</div> : null}
        <div
          className={cx(styles.interior, styles[interior], styles[resolved])}
          data-interior={interior}
          data-inset={resolved}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
