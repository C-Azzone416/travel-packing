"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { useSaveStatus } from "@/components/shell/SaveStatus";
import { automaticStamps } from "@/domain/stamps";
import type { LifecycleTrip } from "@/domain/trip-lifecycle";
import { EditStampSheet } from "@/features/trip/EditStampSheet";
import { useTripsSource } from "@/features/trips/TripsSourceProvider";
import type { TripsSource } from "@/features/trips/trips-source";
import styles from "./StampLabelEdit.module.css";

export const LABEL_SAVING = "Saving the last change…";
export const LABEL_FAILED = "Last change didn't save. Retry from the top bar first.";
export const LABEL_ROUTE = "This sticker's code comes from the route.";
const LABEL_BACK = "Stamp label editing available again.";

/**
 * Label editing is off while any write is pending or failed-and-not-retried (#494): the session-wide save status is the
 * gate, so an edit never overlaps another write. Nothing is stored here; it re-enables when the status clears.
 */
export function useStampLabelGate(): string | null {
  const { pending, status } = useSaveStatus();
  // A retry in flight reads as saving, not as the failure it is retrying.
  if (pending) return LABEL_SAVING;
  return status === "error" ? LABEL_FAILED : null;
}

/** What an open label editor shows from the gate: the one Try again for its own failed save, else the gate's note. */
export function useEditorGate(failed: boolean, saving: boolean) {
  const gate = useStampLabelGate();
  const { retry } = useSaveStatus();
  const retryable = failed && gate === LABEL_FAILED;
  return {
    failed: retryable,
    onRetry: retry,
    blockedNote: saving || retryable ? undefined : (gate ?? undefined),
  };
}

type Labels = readonly [string | null, string | null];

/**
 * The write behind every label Save: read the trip fresh, keep the server's value for each slot the person did not change,
 * and write both. Run it inside track(), so a Retry reads again.
 */
export async function saveFreshLabels(
  source: TripsSource,
  tripId: string,
  draft: Labels,
  changed: readonly [boolean, boolean],
) {
  const fresh = (await source.getTrip(tripId)).stampLabels ?? [null, null];
  return source.setStampLabels(
    tripId,
    changed[0] ? draft[0] : fresh[0],
    changed[1] ? draft[1] : fresh[1],
  );
}

/** Whether the trip has a stamp the editor can change: an automatic one, or a saved first label. */
export const hasEditableStamp = (trip: LifecycleTrip): boolean =>
  automaticStamps(trip.stops).length > 0 || Boolean(trip.stampLabels?.[0]);

/** "Edit stamp label" with its helper line. Disabled with aria-disabled so it stays focusable. */
export function StampLabelAction({
  trip,
  fromRoute = false,
  onEdit,
  small = false,
}: {
  trip: LifecycleTrip;
  fromRoute?: boolean;
  onEdit: () => void;
  small?: boolean;
}) {
  const gate = useStampLabelGate();
  const helpId = useId();
  const helper = fromRoute ? LABEL_ROUTE : gate;
  const [announce, setAnnounce] = useState("");
  const wasBlocked = useRef(false);
  useEffect(() => {
    if (fromRoute) return;
    setAnnounce(gate ?? (wasBlocked.current ? LABEL_BACK : ""));
    wasBlocked.current = gate !== null;
  }, [gate, fromRoute]);
  if (!hasEditableStamp(trip)) return null;
  return (
    <div className={styles.action}>
      <Button
        variant="secondary"
        small={small}
        aria-disabled={helper ? true : undefined}
        aria-describedby={helper ? helpId : undefined}
        onClick={(event) => {
          if (helper) return;
          // The sheet gives focus back to what had it when it opened: take it first (a tap may not focus a button).
          event.currentTarget.focus({ preventScroll: true });
          onEdit();
        }}
      >
        Edit stamp label
      </Button>
      {helper ? (
        <p id={helpId} className={styles.helper}>
          {helper}
        </p>
      ) : null}
      <span className="sr-only" role="status" aria-live="polite">
        {announce}
      </span>
    </div>
  );
}

/**
 * The editor for one trip. Save reads the trip fresh from the server, keeps the slots the person did not touch as the
 * server has them, and writes both, all inside one tracked write so the top bar's Retry replays the read and the write
 * together.
 */
export function StampLabelEditor({
  trip,
  onSaved,
  onClose,
}: {
  trip: LifecycleTrip;
  onSaved: (trip: LifecycleTrip) => void;
  onClose: () => void;
}) {
  const source = useTripsSource();
  const { track } = useSaveStatus();
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const editor = useEditorGate(failed, saving);

  const save = (
    slot1: string | null,
    slot2: string | null,
    changed: readonly [boolean, boolean],
  ) => {
    setFailed(false);
    setSaving(true);
    track(
      () => saveFreshLabels(source, trip.id, [slot1, slot2], changed),
      (change) => {
        setSaving(false);
        onSaved(change.trip);
        toast.show("Stamp label saved.");
        onClose();
      },
    ).catch(() => {
      setSaving(false);
      setFailed(true);
    });
  };

  return (
    <EditStampSheet
      automatic={automaticStamps(trip.stops)}
      stops={trip.stops}
      saved={trip.stampLabels}
      departure={trip.start}
      saving={saving}
      failed={editor.failed}
      onRetry={editor.onRetry}
      blockedNote={editor.blockedNote}
      onClose={onClose}
      onSave={save}
    />
  );
}
