import { Icon } from "@/components/ui/Icon";
import { cx } from "./cx";
import shared from "./shared.module.css";
import styles from "./Stepper.module.css";

export interface StepperProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  /** "inline" is the 77 by 31 stepper in a row (laptop; 103 by 40 on a phone); "sheet" is always the 103 by 40 one. */
  size?: "inline" | "sheet";
  /** Names the group for assistive tech (default "Quantity"). */
  label?: string;
  /** What is being counted ("socks"): the buttons then read "Fewer socks" and "More socks" instead of the bare words. */
  itemName?: string;
  className?: string;
}

// The quantity stepper (spec part 2 section 5): "- n +", min 1, max 99. The buttons are named "Fewer" and "More" and
// disable at the ends; the value is an output, so a change is announced politely.
export function Stepper({
  value,
  onChange,
  min = 1,
  max = 99,
  size = "inline",
  label = "Quantity",
  itemName,
  className,
}: StepperProps) {
  const named = (word: string) => (itemName ? `${word} ${itemName}` : word);
  return (
    <div
      role="group"
      aria-label={label}
      className={cx(styles.stepper, size === "sheet" && styles.sheet, className)}
    >
      <button
        type="button"
        aria-label={named("Fewer")}
        disabled={value <= min}
        className={cx(styles.button, shared.hit, shared.ring)}
        onClick={() => onChange(Math.max(min, value - 1))}
      >
        <Icon name="minus" size={16} />
      </button>
      <output className={styles.value}>{value}</output>
      <button
        type="button"
        aria-label={named("More")}
        disabled={value >= max}
        className={cx(styles.button, shared.hit, shared.ring)}
        onClick={() => onChange(Math.min(max, value + 1))}
      >
        <Icon name="plus" size={16} />
      </button>
    </div>
  );
}
