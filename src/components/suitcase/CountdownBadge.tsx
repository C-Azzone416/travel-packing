import { cx } from "./cx";
import styles from "./CountdownBadge.module.css";

/** "12 days", "1 day", "Today". Negative or fractional input is clamped to a whole day count from today. */
export function countdownLabel(days: number): string {
  const whole = Number.isFinite(days) ? Math.max(0, Math.floor(days)) : 0;
  if (whole === 0) return "Today";
  return whole === 1 ? "1 day" : `${whole} days`;
}

// The countdown badge on the luggage tag (spec part 2 section 3): accent fill, --onDark text. Words, not colour alone.
export function CountdownBadge({ days, className }: { days: number; className?: string }) {
  return (
    <span className={cx(styles.badge, className)} data-countdown>
      {countdownLabel(days)}
    </span>
  );
}
