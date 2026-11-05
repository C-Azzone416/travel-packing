import { cx } from "./cx";
import styles from "./CountdownBadge.module.css";

function wholeDays(days: number): number {
  return Number.isFinite(days) ? Math.max(0, Math.floor(days)) : 0;
}

/** "12 days", "1 day", "Today". Negative or fractional input is clamped to a whole day count from today. */
export function countdownLabel(days: number): string {
  const whole = wholeDays(days);
  if (whole === 0) return "Today";
  return whole === 1 ? "1 day" : `${whole} days`;
}

// The countdown badge on the luggage tag (spec part 2 section 3): accent fill, --onDark text. Words, not colour alone.
// `toGo` is the laptop Home tag's longer form: a big Fraunces numeral and "days to go" ("Today" stays "Today").
export function CountdownBadge({
  days,
  toGo = false,
  className,
}: {
  days: number;
  toGo?: boolean;
  className?: string;
}) {
  const whole = wholeDays(days);
  if (toGo && whole > 0) {
    return (
      <span className={cx(styles.badge, className)} data-countdown="to-go">
        <span className={styles.numeral}>{whole}</span>
        {whole === 1 ? " day to go" : " days to go"}
      </span>
    );
  }
  return (
    <span className={cx(styles.badge, className)} data-countdown>
      {countdownLabel(days)}
    </span>
  );
}
