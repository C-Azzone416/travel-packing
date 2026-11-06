"use client";

import type { ReactNode } from "react";
import { LaundryMarker } from "@/components/suitcase/Markers";
import type { Staple } from "@/domain/trip";
import styles from "./Staples.module.css";

/** "× 5", or "~~× 5~~ × 3" when laundry halves it in the preview (spec part 3 section 6). */
export function HalvedCount({ plain, qty }: { plain: number; qty: number }) {
  if (plain === qty) return <>{`× ${qty}`}</>;
  return (
    <>
      <del className={styles.was}>{`× ${plain}`}</del>
      <ins className={styles.now}>{`× ${qty}`}</ins>
      <span className="sr-only">{`, reduced from ${plain} with laundry`}</span>
    </>
  );
}

export interface StapleRowProps {
  staple: Staple;
  plain: number;
  qty: number;
  laptop: boolean;
  open: boolean;
  onToggle: () => void;
  /** The inline editor, rendered under the row while it is open (laptop only). */
  editor?: ReactNode;
  buttonRef?: (node: HTMLButtonElement | null) => void;
}

// One staple: name, the laundry marker when it is flagged, its cadence, and its count in the preview trip. The whole
// row is one button that opens the editor (inline on a laptop, a sheet on a phone).
export function StapleRow({
  staple,
  plain,
  qty,
  laptop,
  open,
  onToggle,
  editor,
  buttonRef,
}: StapleRowProps) {
  const scaled = staple.cadence !== "per trip";
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
          {staple.cadence}
        </span>
        <span className={styles.count}>
          <HalvedCount plain={plain} qty={qty} />
        </span>
      </button>
      {open && laptop ? editor : null}
    </li>
  );
}
