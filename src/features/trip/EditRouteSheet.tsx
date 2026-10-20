"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { ModalSheet } from "@/components/ui/ModalSheet";
import { curatedLocationProvider } from "@/domain/location-provider";
import type { DraftStop } from "@/domain/trip-lifecycle";
import type { TripStop } from "@/domain/trip-stops";
import { useLocationProvider } from "@/features/trips/LocationProviderContext";
import { StopList } from "@/features/trips/StopList";
import { fixSummary, stopProblems } from "@/features/trips/stops-draft";

export interface EditRouteSheetProps {
  stops: TripStop[];
  saving: boolean;
  /** The last save did not go through. The sheet stays open, and Save tries again. */
  failed?: boolean;
  allowCustom?: boolean;
  onClose: () => void;
  onSave: (stops: TripStop[]) => void;
}

// Edit a saved trip's route (epic #107, design #108 §1.5): the same stop cards as the create flow, in a sheet.
// Cancel discards. The trip changes only after the source confirms, so a failed save leaves the old route in place.
export function EditRouteSheet({
  stops,
  saving,
  failed = false,
  allowCustom,
  onClose,
  onSave,
}: EditRouteSheetProps) {
  const provider = useLocationProvider();
  const [draft, setDraft] = useState<DraftStop[]>(stops);
  const [attempted, setAttempted] = useState(false);
  const problems = stopProblems(draft);

  function save() {
    if (problems.length) {
      setAttempted(true);
      return;
    }
    onSave(draft as TripStop[]);
  }

  return (
    <ModalSheet
      open
      title="Edit route"
      description="Change the places and dates. Your list is recalculated for the new dates."
      onClose={onClose}
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={saving} aria-busy={saving} onClick={save}>
            {saving ? "Saving…" : "Save route"}
          </Button>
        </>
      }
    >
      <StopList
        stops={draft}
        onChange={setDraft}
        provider={provider}
        fallbackProvider={
          provider === curatedLocationProvider ? undefined : curatedLocationProvider
        }
        allowCustom={allowCustom}
        attempted={attempted}
        headingLevel={3}
      />
      {attempted && problems.length ? (
        <p className="tiny field-error">{fixSummary(problems.length)}</p>
      ) : null}
      {failed ? (
        <p className="field-error" role="alert">
          Couldn’t save the route. Nothing changed. Press Save route to try again.
        </p>
      ) : null}
    </ModalSheet>
  );
}
