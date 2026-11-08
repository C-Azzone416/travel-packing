import { cx } from "./cx";
import styles from "./CountdownBadge.module.css";

// The during-trip badge on the luggage tag (#410, spec #393 section 2.2): the countdown's shape with the day instead,
// "Day 3 of 11", and "Last day" on the end date. Words, not colour alone.
export function DayBadge({
  day,
  of,
  last = false,
  className,
}: {
  day: number;
  of: number;
  last?: boolean;
  className?: string;
}) {
  if (last) {
    return (
      <span className={cx(styles.badge, className)} data-day-badge="last">
        Last day
      </span>
    );
  }
  return (
    <span className={cx(styles.badge, className)} data-day-badge="day">
      Day <span className={cx(styles.numeral, styles.dayNumeral)}>{day}</span> of {of}
    </span>
  );
}
