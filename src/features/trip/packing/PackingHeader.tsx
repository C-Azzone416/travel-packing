"use client";

import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import { cx } from "@/components/suitcase/cx";
import type { Headline } from "./packing-model";
import styles from "./packing.module.css";

export interface PackingHeaderProps {
  tripName: string;
  headline: Headline;
  /** The trip's laundry preference. */
  laundry: boolean;
  /** A laundry change is being saved: the toggle waits. */
  laundryBusy?: boolean;
  onLaundry: (next: boolean) => void;
  onEditTrip: () => void;
}

// The header of the laptop Packing view (#376 part 3 section 1.3): "‹ Trip" and the title, the quantity progress, and the
// two actions. The "All packed" wording on the right is the hook #411 builds on (data-all-packed on the progress zone).
export function PackingHeader({
  tripName,
  headline,
  laundry,
  laundryBusy = false,
  onLaundry,
  onEditTrip,
}: PackingHeaderProps) {
  const allPacked = headline.total > 0 && headline.toGo === 0;
  return (
    <header className={styles.header}>
      <div className={styles.titleZone}>
        <Link href="/" className={styles.back}>
          <Icon name="chevronLeft" size={14} />
          <span>{tripName}</span>
        </Link>
        <h1 id="trip-title" className={styles.title}>
          Packing
        </h1>
      </div>
      <div className={styles.progressZone} data-all-packed={allPacked ? "true" : undefined}>
        <div className={styles.progressTop}>
          <p className={styles.progressLine}>
            <span className={styles.bigNumber}>{headline.packed}</span> of {headline.total} in the
            bag
          </p>
          <p className={styles.toGo}>{headline.toGo > 0 ? `${headline.toGo} to go` : "0 to go"}</p>
        </div>
        <div
          className={styles.track}
          role="progressbar"
          aria-label="Packing progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={headline.percent}
          aria-valuetext={`${headline.packed} of ${headline.total} packed`}
        >
          <span style={{ width: `${headline.percent}%` }} />
        </div>
      </div>
      <div className={styles.actions}>
        <button
          type="button"
          className={cx(styles.action, laundry ? styles.actionOn : styles.actionOff)}
          aria-pressed={laundry}
          disabled={laundryBusy}
          onClick={() => onLaundry(!laundry)}
        >
          <Icon name="refresh" size={16} />
          {laundry ? "Laundry on" : "Laundry off"}
        </button>
        <Link href="/staples" className={cx(styles.action, styles.actionOff)}>
          Edit Staples
        </Link>
        <button type="button" className={cx(styles.action, styles.actionOff)} onClick={onEditTrip}>
          Edit trip
        </button>
      </div>
    </header>
  );
}
