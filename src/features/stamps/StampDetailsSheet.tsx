"use client";

import Link from "next/link";
import { buttonClassName } from "@/components/ui/Button";
import { ModalSheet } from "@/components/ui/ModalSheet";
import type { LifecycleTrip } from "@/domain/trip-lifecycle";
import { Stamps } from "@/components/stamp/Stamp";
import { selectStamps } from "@/domain/stamps";
import { StampLabelAction } from "./StampLabelEdit";
import { Sticker } from "./StampsScreen";
import type { PastTripView, StickerView } from "./stamps-view";
import styles from "./StampDetailsSheet.module.css";

/**
 * Stamp details (#494): what a tap on a sticker opens. The sticker close up, the trip's route stamps as saved (a preview, nothing to edit), its facts and the two actions. Read only; label editing is a separate change.
 */
export function StampDetailsSheet({
  sticker,
  trip,
  summary,
  onEdit,
  onClose,
}: {
  sticker: StickerView;
  trip: LifecycleTrip;
  summary: PastTripView;
  /** Opens the label editor; absent where editing is not offered (the Home). */
  onEdit?: () => void;
  onClose: () => void;
}) {
  const stamps = selectStamps(trip.stops, trip.stampLabels);
  return (
    <ModalSheet
      open
      showClose
      focusTitle
      title={`${sticker.place} · ${sticker.monthYear}`}
      onClose={onClose}
      actions={
        <>
          {onEdit ? (
            <StampLabelAction trip={trip} fromRoute={sticker.codeFromRoute} onEdit={onEdit} />
          ) : null}
          <Link
            className={buttonClassName({ variant: "secondary" })}
            href={`/trips/new?copy=${trip.id}`}
          >
            Reuse this list
          </Link>
          <Link className={buttonClassName({ variant: "ghost" })} href={`/trips/${trip.id}`}>
            Open trip
          </Link>
        </>
      }
    >
      <div className={styles.details}>
        <div className={styles.close}>
          <Sticker sticker={sticker} large />
        </div>
        {stamps.length ? (
          <div className={styles.preview}>
            <Stamps compact departure={trip.start} stamps={stamps} />
          </div>
        ) : null}
        <p className={styles.facts}>{summary.facts}</p>
        <p className={styles.status}>
          {sticker.upcoming ? "Upcoming · inks when you get home" : "Inked"}
          {sticker.completedCount > 1 ? ` · Visited ${sticker.completedCount} times` : ""}
        </p>
      </div>
    </ModalSheet>
  );
}
