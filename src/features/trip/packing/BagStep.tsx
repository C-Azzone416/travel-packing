"use client";

import { Button } from "@/components/ui/Button";
import type { BagGate } from "../trip-view";
import styles from "./packing.module.css";

// The toiletry bag step at the foot of the Toiletries cube. Checking the contents is normal; putting the finished bag in
// the suitcase is a separate, explicit step (plan section 10), so this shows what is still needed and never confirms itself.
export function BagStep({
  gate,
  onPlace,
  onUndo,
  onAddItem,
}: {
  gate: BagGate;
  onPlace: () => void;
  onUndo: () => void;
  onAddItem: () => void;
}) {
  if (gate.state === "none") return null;
  return (
    <div className={styles.bag} data-bag-state={gate.state}>
      {gate.state === "waiting" ? (
        <div className="bag-placement waiting">
          <div>
            <strong>Toiletry bag not ready to place</strong>
            <p>
              Check every Bathroom item first ({gate.checked} of {gate.total} checked). The bag
              itself remains a separate suitcase step.
            </p>
          </div>
          <span className="status-pill draft">Waiting</span>
        </div>
      ) : null}
      {gate.state === "pending" ? (
        <div className="bag-placement pending">
          <div>
            <strong>Toiletry bag ready to place</strong>
            <p>All Bathroom items are checked. The bag is still outside the suitcase.</p>
          </div>
          <Button small onClick={onPlace}>
            Put bag in suitcase
          </Button>
        </div>
      ) : null}
      {gate.state === "complete" ? (
        <div className="bag-placement complete">
          <div>
            <strong>Toiletry bag is in the suitcase</strong>
            <p>Contents stay checked. You can undo only this placement step.</p>
          </div>
          <Button variant="secondary" small onClick={onUndo}>
            Undo placement
          </Button>
        </div>
      ) : null}
      <Button variant="ghost" small onClick={onAddItem}>
        ＋ Add a Bathroom item
      </Button>
    </div>
  );
}
