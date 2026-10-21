"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import type { TripItem } from "@/domain/trip";
import type { BagGate, PackFilter } from "./trip-view";

export interface ToiletrySectionProps {
  tripId: string;
  items: TripItem[];
  gate: BagGate;
  filter: PackFilter;
  renderRow: (item: TripItem) => ReactNode;
  onPlaceBag: () => void;
  onUndoBag: () => void;
  onAddItem: () => void;
}

// One canonical Bathroom group. Checking its contents is normal; putting the finished bag in the suitcase
// is a separate, explicit step (plan §10), so the gate shows what is still needed and never confirms itself.
export function ToiletrySection({
  tripId,
  items,
  gate,
  filter,
  renderRow,
  onPlaceBag,
  onUndoBag,
  onAddItem,
}: ToiletrySectionProps) {
  const visible = filter === "still" ? items.filter((item) => item.packed < item.qty) : items;
  const titleId = `toiletry-title-${tripId}`;
  return (
    <section id="block-toiletries" className="toiletry-section" aria-labelledby={titleId}>
      <div className="list-section-head">
        <div>
          <h3 id={titleId}>Toiletries</h3>
          <div className="item-meta">
            Bathroom · {gate.checked} of {gate.total} contents checked
          </div>
        </div>
        <span className="tag">{visible.length}</span>
      </div>
      <p className="tiny muted toiletry-explainer">
        Check each item normally. After every required item is checked, confirm the separate step of
        putting the toiletry bag in the suitcase.
      </p>
      <div className="packing-list">
        {visible.length ? (
          visible.map(renderRow)
        ) : (
          <div className="empty-state compact">All toiletry contents are checked.</div>
        )}
      </div>

      {gate.state === "waiting" ? (
        <div className="bag-placement waiting">
          <div>
            <strong>Toiletry bag not ready to place</strong>
            <p>Check every Bathroom item first. The bag itself remains a separate suitcase step.</p>
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
          <Button small onClick={onPlaceBag}>
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
          <Button variant="secondary" small onClick={onUndoBag}>
            Undo placement
          </Button>
        </div>
      ) : null}
      <Button variant="ghost" small onClick={onAddItem}>
        ＋ Add a Bathroom item
      </Button>
    </section>
  );
}
