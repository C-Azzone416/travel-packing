"use client";

import Link from "next/link";
import { Button, buttonClassName } from "@/components/ui/Button";
import { ModalSheet } from "@/components/ui/ModalSheet";
import { Stamps } from "@/components/stamp/Stamp";
import { selectStamps } from "@/domain/stamps";
import type { LifecycleTrip } from "@/domain/trip-lifecycle";
import { Sticker } from "./StampsScreen";
import { UPCOMING_EYEBROW, type PastTripView, type StickerView } from "./stamps-view";
import styles from "./StampDetailsSheet.module.css";

/**
 * Stamp details (#494): what a tap on a sticker opens. The sticker close up, the stamps the trip really carries (so the person
 * sees what editing changes), the trip's facts and the three actions. Label editing only.
 */
export function StampDetailsSheet({
  sticker,
  trip,
  summary,
  canEdit,
  editable,
  onEdit,
  onClose,
}: {
  sticker: StickerView;
  trip: LifecycleTrip;
  summary: PastTripView;
  /** The route has a stamp to edit at all. Without one the action is left out. */
  canEdit: boolean;
  /** The editor can change what THIS sticker says (a sticker for a later stop shows an automatic code). */
  editable: boolean;
  onEdit: () => void;
  onClose: () => void;
}) {
  const stamps = selectStamps(trip.stops, trip.stampLabels);
  return (
    <ModalSheet
      open
      showClose
      title={`${sticker.place} · ${sticker.monthYear}`}
      onClose={onClose}
      actions={
        <>
          {canEdit ? (
            <Button
              onClick={onEdit}
              disabled={!editable}
              aria-describedby={editable ? undefined : "stamp-details-route"}
            >
              Edit stamp label
            </Button>
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
          {sticker.upcoming ? UPCOMING_EYEBROW : "Inked"}
          {sticker.completedCount > 1 ? ` · Visited ${sticker.completedCount} times` : ""}
        </p>
        {canEdit && !editable ? (
          <p id="stamp-details-route" className={styles.routeNote}>
            This sticker’s code comes from the route.
          </p>
        ) : null}
      </div>
    </ModalSheet>
  );
}
