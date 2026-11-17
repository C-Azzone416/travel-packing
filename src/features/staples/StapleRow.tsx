"use client";

import type { ReactNode } from "react";
import { LaundryMarker } from "@/components/suitcase/Markers";
import type { Staple } from "@/domain/trip";
import { nightsLabel, ruleText, scalesWithTrip } from "./staples-cubes";
import styles from "./Staples.module.css";

/** A row's trip total in the preview: "4", or "~~4~~ 3" when laundry halves it. The sentence for a screen reader follows. */
export function PreviewTotal({
  plain,
  qty,
  nights,
}: {
  plain: number;
  qty: number;
  nights: number;
}) {
  const trip = nightsLabel(nights).replace(" ", "-").replace(/s$/, "");
  const halved = plain !== qty;
  return (
    <>
      <span aria-hidden="true">
        {halved ? (
          <>
            <del className={styles.was}>{plain}</del>
            <ins className={styles.now}>{qty}</ins>
          </>
        ) : (
          qty
        )}
      </span>
      <span className="sr-only">
        {halved
          ? `${qty} for a ${trip} trip, reduced from ${plain} with laundry`
          : `${qty} for a ${trip} trip`}
      </span>
    </>
  );
}

export interface StapleRowProps {
  staple: Staple;
  /** The preview's totals for this row; null while the preview is off (the row then shows only its saved rule). */
  total: { plain: number; qty: number; nights: number } | null;
  laptop: boolean;
  open: boolean;
  onToggle: () => void;
  /** The inline editor, rendered under the row while it is open (laptop only). */
  editor?: ReactNode;
  buttonRef?: (node: HTMLButtonElement | null) => void;
}

// One staple: name, the laundry marker when it is flagged, its saved rule, and (only while the preview is on) its total for the preview trip. The whole
// row is one button that opens the editor (inline on a laptop, a sheet on a phone).
export function StapleRow({
  staple,
  total,
  laptop,
  open,
  onToggle,
  editor,
  buttonRef,
}: StapleRowProps) {
  const scaled = scalesWithTrip(staple);
  return (
    <li className={styles.item} data-staple-id={staple.id}>
      <button
        type="button"
        ref={buttonRef}
        className={styles.row}
        aria-expanded={laptop ? open : undefined}
        aria-haspopup={laptop ? undefined : "dialog"}
        onClick={onToggle}
      >
        <span className={styles.rowName}>
          {staple.name}
          {staple.packLast ? <span className={styles.packLast}>Pack last</span> : null}
        </span>
        {staple.laundryHalves ? <LaundryMarker variant="staples" /> : null}
        <span className={`${styles.cadence} ${scaled ? styles.cadenceScaled : ""}`}>
          {ruleText(staple)}
        </span>
        {total ? (
          <span className={styles.count}>
            <span className={styles.arrow} aria-hidden="true">
              →
            </span>
            <PreviewTotal {...total} />
          </span>
        ) : null}
      </button>
      {open && laptop ? editor : null}
    </li>
  );
}
