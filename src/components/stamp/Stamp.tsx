import { stampLabelSize, stampsAriaLabel, type StampSpec } from "@/domain/stamps";
import styles from "./Stamp.module.css";

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

export interface StampsProps {
  stamps: readonly StampSpec[];
  /** The trip's first departure, YYYY-MM-DD. */
  departure: string;
}

function dayMonth(date: string): { dayMonth: string; year: string } {
  const [year = "", month = "", day = ""] = date.split("-");
  return { dayMonth: `${day} ${MONTHS[Number(month) - 1] ?? ""}`.trim(), year };
}

// Route stamps (spec §5). Border, rings and text all follow currentColor so they can never drift apart. The
// container carries the one accessible name; the inner text is hidden from assistive tech.
export function Stamps({ stamps, departure }: StampsProps) {
  const { dayMonth: when, year } = dayMonth(departure);
  return (
    <div className={styles.cluster} role="img" aria-label={stampsAriaLabel(stamps)}>
      {stamps.slice(0, 2).map((stamp, index) => (
        <div
          key={`${stamp.kind}-${stamp.label}-${index}`}
          className={`${styles.stamp} ${index === 0 ? styles.first : styles.second}`}
          data-size={stampLabelSize(stamp.label)}
          aria-hidden="true"
        >
          <span className={styles.label}>{stamp.label}</span>
          <span className={styles.date}>{when}</span>
          <span className={styles.year}>{year}</span>
        </div>
      ))}
    </div>
  );
}
