"use client";

import { cx } from "@/components/suitcase/cx";
import { Icon } from "@/components/ui/Icon";
import styles from "./packing.module.css";

// The one inline banner at the top of the open cube once everything is in (#411, spec on #393 section 2.4): not a toast and not
// a modal. role="status" announces it once. Dismissible; the screen brings it back only if the person unticks and re-completes.
export function PackedBanner({
  className,
  onReview,
  onDismiss,
}: {
  className?: string;
  onReview: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className={cx(styles.banner, className)} role="status" data-packed-banner>
      <p className={styles.bannerText}>Everything is in. Review your bag to mark the trip Ready.</p>
      <button type="button" className={styles.bannerButton} onClick={onReview}>
        Review your bag
      </button>
      <button type="button" className={styles.bannerClose} aria-label="Dismiss" onClick={onDismiss}>
        <Icon name="close" size={18} />
      </button>
    </div>
  );
}
