"use client";

import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import { cx } from "@/components/suitcase/cx";
import type { PackedState } from "../packed-state";
import type { Headline } from "./packing-model";
import styles from "./packing.module.css";

export interface PackingHeaderProps {
  tripName: string;
  headline: Headline;
  /** The trip's laundry preference. */
  laundry: boolean;
  /** The toggle is drawn only when laundry would change a quantity (or is already on): short trips hide it (#412). */
  laundryVisible?: boolean;
  /** A laundry change is being saved: the toggle waits. */
  laundryBusy?: boolean;
  onLaundry: (next: boolean) => void;
  onEditTrip: () => void;
  /** Where the trip is on the way to Ready (#411). */
  state: PackedState;
  /** Opens the "Review your bag" sheet. */
  onReview: () => void;
  /** Takes a Ready trip back to packing; the packed counts stay. */
  onNotReady: () => void;
  /** A Ready change is being saved: the Ready controls wait. */
  readyBusy?: boolean;
}

// The header of the laptop Packing view (#376 part 3 section 1.3): "‹ Trip" and the title, the quantity progress, and the
// actions. Once everything is in, "0 to go" becomes "All packed" (#411), and a Ready trip says "Ready to go" and offers
// "Review bag" and "Mark as not ready".
export function PackingHeader({
  tripName,
  headline,
  laundry,
  laundryVisible = true,
  laundryBusy = false,
  onLaundry,
  onEditTrip,
  state,
  onReview,
  onNotReady,
  readyBusy = false,
}: PackingHeaderProps) {
  const allPacked = state !== "open";
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
      <div
        className={styles.progressZone}
        data-all-packed={allPacked ? "true" : undefined}
        data-packed-state={state}
      >
        <div className={styles.progressTop}>
          <p className={styles.progressLine}>
            <span className={styles.bigNumber}>{headline.packed}</span> of {headline.total} in the
            bag
          </p>
          <p className={styles.toGo}>
            {state === "ready"
              ? "Ready to go"
              : state === "packed"
                ? "All packed"
                : `${headline.toGo} to go`}
          </p>
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
        {state === "ready" ? (
          <>
            <button
              type="button"
              className={cx(styles.action, styles.actionOff)}
              onClick={onReview}
            >
              Review bag
            </button>
            <button
              type="button"
              className={cx(styles.action, styles.actionOff)}
              disabled={readyBusy}
              onClick={onNotReady}
            >
              Mark as not ready
            </button>
          </>
        ) : null}
        {laundryVisible ? (
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
        ) : null}
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
