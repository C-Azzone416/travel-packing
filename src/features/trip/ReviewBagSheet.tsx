"use client";

import { Button } from "@/components/ui/Button";
import { LaundryMarker } from "@/components/suitcase";
import { ModalSheet } from "@/components/ui/ModalSheet";
import type { TripItem } from "@/domain/trip";
import type { LifecycleTrip } from "@/domain/trip-lifecycle";
import { buildCubeViews, checkboxName, isPacked } from "./packing/packing-model";
import { readyBlocker } from "./review-view";
import { bagGate } from "./trip-view";
import styles from "./ReviewBagSheet.module.css";

export interface ReviewBagSheetProps {
  trip: LifecycleTrip;
  /** A change is being saved: the bag step and the Ready buttons wait. */
  busy: boolean;
  onTick: (item: TripItem, packed: boolean) => void;
  onPlaceBag: () => void;
  onUndoBag: () => void;
  onReady: () => void;
  onNotReady: () => void;
  onClose: () => void;
}

// "Review your bag" (#411, spec on #393 section 2.4 and DESIGN REC 8): the Ready final check as a sheet on Packing, opened by the
// "Review your bag" buttons and by ?review=1. The whole list by cube so a person can still untick, the toiletry-bag gate, and the
// one explicit step that makes the trip Ready. Nothing here becomes Ready by itself. The screen owns every save.
export function ReviewBagSheet({
  trip,
  busy,
  onTick,
  onPlaceBag,
  onUndoBag,
  onReady,
  onNotReady,
  onClose,
}: ReviewBagSheetProps) {
  const views = buildCubeViews(trip);
  const gate = bagGate(trip);
  const blocker = readyBlocker(trip);
  const gateRow =
    gate.state === "none" ? null : (
      <div className={styles.gate} data-bag-gate={gate.state}>
        <div className={styles.gateCopy}>
          <strong>Toiletry bag in suitcase</strong>
          <span className={styles.meta}>
            {trip.toiletryBagPacked ? "Confirmed" : "Not confirmed"}
          </span>
        </div>
        {gate.state === "waiting" ? (
          <span className="status-pill">Waiting on contents</span>
        ) : gate.state === "complete" ? (
          <Button
            variant="secondary"
            small
            aria-disabled={busy}
            onClick={() => !busy && onUndoBag()}
          >
            Undo placement
          </Button>
        ) : (
          <Button small aria-disabled={busy} onClick={() => !busy && onPlaceBag()}>
            Put bag in suitcase
          </Button>
        )}
      </div>
    );
  return (
    <ModalSheet
      open
      variant="side"
      showClose
      eyebrow="FINAL CHECK"
      title="Review your bag"
      onClose={onClose}
      actions={
        <div className={styles.footer}>
          {trip.ready ? (
            <Button variant="secondary" aria-disabled={busy} onClick={() => !busy && onNotReady()}>
              Mark as not ready
            </Button>
          ) : (
            <Button
              aria-disabled={busy || blocker !== null}
              aria-describedby={blocker ? "review-blocker" : undefined}
              onClick={() => !busy && blocker === null && onReady()}
            >
              I’m ready to go
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>
            Back to packing list
          </Button>
          {blocker && !trip.ready ? (
            <p id="review-blocker" className={styles.blocker}>
              {blocker}
            </p>
          ) : null}
        </div>
      }
    >
      <p className={styles.callout}>
        Nothing becomes Ready automatically. Make corrections here, then confirm when it looks
        right.
      </p>
      {views.map((view) => (
        <section key={view.cube} className={styles.group} aria-labelledby={`review-${view.cube}`}>
          <h3 id={`review-${view.cube}`} className={styles.cube}>
            {view.label}
          </h3>
          <ul className={styles.rows}>
            {view.items.map((item) => (
              <li key={item.id} className={styles.row} data-item-id={item.id}>
                <label className={styles.label}>
                  <input
                    type="checkbox"
                    checked={isPacked(item)}
                    aria-label={checkboxName(item)}
                    onChange={(event) => onTick(item, event.target.checked)}
                  />
                  <span className={styles.name}>{item.name}</span>
                  {item.qty > 1 ? <span className={styles.qty}>× {item.qty}</span> : null}
                  {trip.config.laundry && item.laundryHalves ? (
                    <LaundryMarker aria-hidden={undefined} />
                  ) : null}
                </label>
              </li>
            ))}
          </ul>
          {view.cube === "toiletries" ? gateRow : null}
        </section>
      ))}
      {views.some((view) => view.cube === "toiletries") ? null : gateRow}
    </ModalSheet>
  );
}
