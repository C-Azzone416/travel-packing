import { stampsAriaLabel, type StampSpec } from "@/domain/stamps";
import styles from "./Stamp.module.css";

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

export interface StampsProps {
  stamps: readonly StampSpec[];
  /** The trip's first departure, YYYY-MM-DD. */
  departure: string;
  /** The stamps sit on a picture: each gets a backing disc. Off on the clean ledger hero, where the rules show through. */
  onPicture?: boolean;
  /** 86px at every width, for a preview inside a sheet (#151). */
  compact?: boolean;
  /** Which slot the first stamp is: a preview of the second stamp wears the second stamp's colour. */
  firstSlot?: 1 | 2;
}

function dayMonth(date: string): { dayMonth: string; year: string } {
  const [year = "", month = "", day = ""] = date.split("-");
  return { dayMonth: `${day} ${MONTHS[Number(month) - 1] ?? ""}`.trim(), year };
}

// Route stamps (spec §5). Border, rings and text all follow currentColor so they can never drift apart. The
// container carries the one accessible name; the inner text is hidden from assistive tech.
export function Stamps({
  stamps,
  departure,
  onPicture = false,
  compact = false,
  firstSlot = 1,
}: StampsProps) {
  const { dayMonth: when, year } = dayMonth(departure);
  if (stamps.length === 0) return null;
  return (
    <div
      className={`${styles.cluster}${compact ? ` ${styles.compact}` : ""}`}
      role="img"
      aria-label={stampsAriaLabel(stamps)}
    >
      {stamps.slice(0, 2).map((stamp, index) => (
        <div
          key={`${stamp.kind}-${stamp.label}-${index}`}
          className={`${styles.stamp} ${firstSlot + index === 1 ? styles.first : styles.second}${onPicture ? ` ${styles.onPicture}` : ""}`}
          data-stamp={stamp.kind}
          data-on-picture={onPicture ? "true" : undefined}
          aria-hidden="true"
        >
          <span className={styles.label}>{stamp.label}</span>
          <span className={styles.date}>{when}</span>
          <span className={styles.year}>
            {stamp.kind === "airport" ? <span aria-hidden="true">✈ </span> : null}
            {year}
          </span>
        </div>
      ))}
    </div>
  );
}
