"use client";

import type { TripItem } from "@/domain/trip";
import { checkLabel, isComplete } from "./trip-view";

export interface PackRowProps {
  item: TripItem;
  /** The last change to this row did not save. Shown beside the row as well as in the top-bar chip. */
  failed: boolean;
  onToggle: (itemId: string) => void;
  onIncrement: (itemId: string) => void;
  onDecrement: (itemId: string) => void;
  onEdit: (itemId: string) => void;
  onRetry: (itemId: string) => void;
}

export function PackRow({
  item,
  failed,
  onToggle,
  onIncrement,
  onDecrement,
  onEdit,
  onRetry,
}: PackRowProps) {
  const complete = isComplete(item);
  // Limits use aria-disabled (still focusable, and announced) rather than removing the button.
  const atMin = item.packed <= 0;
  const atMax = item.packed >= item.qty;
  return (
    <div className={complete ? "pack-row complete" : "pack-row"} data-item-id={item.id}>
      <button
        type="button"
        className="check-button"
        aria-label={checkLabel(item)}
        aria-pressed={complete}
        onClick={() => onToggle(item.id)}
      >
        <span aria-hidden="true">{complete ? "✓" : ""}</span>
      </button>
      <button type="button" className="item-body" onClick={() => onEdit(item.id)}>
        <span className="item-name">{item.name}</span>{" "}
        <span className="item-meta">
          {item.category} · tap to edit
          {item.section === "packlast" ? <span className="timing-tag">Pack last</span> : null}
        </span>
      </button>
      <div className="qty-stepper" role="group" aria-label={`${item.name} packed quantity`}>
        <button
          type="button"
          aria-label={`Decrease packed ${item.name}`}
          aria-disabled={atMin}
          onClick={() => !atMin && onDecrement(item.id)}
        >
          −
        </button>
        <span role="img" aria-label={`${item.packed} of ${item.qty} packed`}>
          {item.packed}/{item.qty}
        </span>
        <button
          type="button"
          aria-label={`Increase packed ${item.name}`}
          aria-disabled={atMax}
          onClick={() => !atMax && onIncrement(item.id)}
        >
          ＋
        </button>
      </div>
      {failed ? (
        <button type="button" className="row-error" onClick={() => onRetry(item.id)}>
          Not saved · Retry
        </button>
      ) : null}
    </div>
  );
}
