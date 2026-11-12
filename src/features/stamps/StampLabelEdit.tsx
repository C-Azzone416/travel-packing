"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { useSaveStatus } from "@/components/shell/SaveStatus";
import { automaticStamps } from "@/domain/stamps";
import type { LifecycleTrip } from "@/domain/trip-lifecycle";
import { EditStampSheet } from "@/features/trip/EditStampSheet";
import { useTripsSource } from "@/features/trips/TripsSourceProvider";
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
  if (status === "error") return LABEL_FAILED;
  return pending ? LABEL_SAVING : null;
}

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
  if (trip.stops.length === 0) return null;
  return (
    <div className={styles.action}>
      <Button
        variant="secondary"
        small={small}
        aria-disabled={helper ? true : undefined}
        aria-describedby={helper ? helpId : undefined}
        onClick={() => {
          if (!helper) onEdit();
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
  const gate = useStampLabelGate();
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const opened = useRef(trip.stampLabels ?? [null, null]);

  const save = (slot1: string | null, slot2: string | null) => {
    setFailed(false);
    setSaving(true);
    const draft = [slot1, slot2];
    track(
      async () => {
        const fresh = (await source.getTrip(trip.id)).stampLabels ?? [null, null];
        const [a, b] = draft.map((value, slot) =>
          value !== opened.current[slot] ? value : fresh[slot],
        );
        return source.setStampLabels(trip.id, a, b);
      },
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
      failed={failed}
      blockedNote={saving ? undefined : (gate ?? undefined)}
      onClose={onClose}
      onSave={save}
    />
  );
}
