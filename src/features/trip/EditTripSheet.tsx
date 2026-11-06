"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { ModalSheet } from "@/components/ui/ModalSheet";
import { Switch } from "@/components/ui/Switch";
import { curatedLocationProvider } from "@/domain/location-provider";
import type { Trip, TripConfig } from "@/domain/trip";
import type { DraftStop, LifecycleTrip } from "@/domain/trip-lifecycle";
import {
  TRAVEL_MODES,
  TRAVEL_MODE_LABEL,
  tripDisplayName,
  type TravelMode,
} from "@/domain/trip-route";
import type { TripStop } from "@/domain/trip-stops";
import { FeedbackEditorEntry } from "@/features/feedback/FeedbackEditorEntry";
import { useLocationProvider } from "@/features/trips/LocationProviderContext";
import { StopList } from "@/features/trips/StopList";
import {
  clampOccasions,
  MAX_OCCASIONS,
  MIN_OCCASIONS,
  NICE_OFF_HINT,
  NICE_OUTFITS_DESCRIPTION,
  returnOutfitHelp,
} from "@/features/trips/draft";
import { fixSummary, stopProblems } from "@/features/trips/stops-draft";
import { editTripChanges } from "./edit-trip-changes";

export type EditTripTab = "route" | "preferences";
export type ApplyOutcome = "ok" | "stale" | "failed";

export interface EditTripSheetProps {
  trip: Trip & Partial<Pick<LifecycleTrip, "destination" | "travelMode" | "name">>;
  /** The requested section opens first; both sections remain available in the same editor. */
  initialTab: EditTripTab;
  allowCustom?: boolean;
  onClose: () => void;
  onSaveRoute: (stops: TripStop[]) => Promise<boolean>;
  onApplyPreferences: (config: TripConfig, basedOn: string | undefined) => Promise<ApplyOutcome>;
  onSaveTravelMode?: (mode: TravelMode | null) => Promise<boolean>;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function EditTripSheet({
  trip,
  initialTab,
  allowCustom,
  onClose,
  onSaveRoute,
  onApplyPreferences,
  onSaveTravelMode = async () => true,
}: EditTripSheetProps) {
  const provider = useLocationProvider();
  const ids = useId();
  const [route, setRoute] = useState<DraftStop[]>(trip.stops);
  const [prefs, setPrefs] = useState<TripConfig>(trip.config);
  const [travelMode, setTravelMode] = useState<TravelMode | null>(trip.travelMode ?? null);
  const [attempted, setAttempted] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<"failed" | "stale" | null>(null);
  const [routeOpen, setRouteOpen] = useState(initialTab === "route");
  const [preferencesOpen, setPreferencesOpen] = useState(initialTab === "preferences");
  const failureRef = useRef<HTMLParagraphElement>(null);
  const niceHintId = `${ids}-nice-hint`;
  const problems = stopProblems(route);
  const completeRoute = problems.length === 0 && route.every((stop) => stop.location !== null);
  const savedRoute = completeRoute ? (route as TripStop[]) : trip.stops;
  const review = useMemo(
    () => editTripChanges(trip, savedRoute, prefs, travelMode),
    [trip, savedRoute, prefs, travelMode],
  );
  const routeDirty = !same(route, trip.stops);
  const prefsDirty = !same(prefs, trip.config);
  const travelDirty = travelMode !== (trip.travelMode ?? null);
  const dirty = routeDirty || prefsDirty || travelDirty;
  const count = review.lines.length;

  useEffect(() => {
    if (notice) failureRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [notice]);

  const patch = (next: Partial<TripConfig>) => setPrefs((current) => ({ ...current, ...next }));

  function undoAll() {
    setRoute(trip.stops);
    setPrefs(trip.config);
    setTravelMode(trip.travelMode ?? null);
    setAttempted(false);
    setAcknowledged(false);
    setNotice(null);
  }

  async function save() {
    if (busy || !dirty) return;
    if (!completeRoute) {
      setAttempted(true);
      setRouteOpen(true);
      return;
    }
    if (review.preview.needsAcknowledgement && !acknowledged) return;
    setBusy(true);
    setNotice(null);
    // Save preferences first; the route command then recalculates once more using those preferences and the new dates.
    // The final stored list therefore matches the combined live preview.
    if (prefsDirty) {
      const outcome = await onApplyPreferences(prefs, trip.updatedAt);
      if (outcome !== "ok") {
        setBusy(false);
        setNotice(outcome === "stale" ? "stale" : "failed");
        return;
      }
    }
    if (routeDirty && !(await onSaveRoute(route as TripStop[]))) {
      setBusy(false);
      setNotice("failed");
      return;
    }
    if (travelDirty && !(await onSaveTravelMode(travelMode))) {
      setBusy(false);
      setNotice("failed");
      return;
    }
    setBusy(false);
    onClose();
  }

  const saveLabel = busy
    ? "Saving…"
    : count === 1
      ? "Save 1 change"
      : count > 1
        ? `Save ${count} changes`
        : "Save changes";

  return (
    <ModalSheet
      open
      showClose
      title="Edit trip"
      onClose={onClose}
      headerAction={<FeedbackEditorEntry busy={busy} />}
      actions={
        <>
          <Button variant="secondary" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button
            className="edit-save"
            disabled={busy || !dirty || (review.preview.needsAcknowledgement && !acknowledged)}
            aria-busy={busy}
            onClick={() => void save()}
          >
            {saveLabel}
          </Button>
        </>
      }
    >
      <div className="edit-body edit-suitcase">
        <div className="edit-trip-heading">
          <h3>{tripDisplayName({ ...trip, destination: trip.destination ?? "Trip" })}</h3>
          <p>Change the route, dates and packing preferences. See what moves before you save.</p>
        </div>
        <details
          className="edit-section"
          open={routeOpen}
          onToggle={(event) => setRouteOpen(event.currentTarget.open)}
        >
          <summary>
            <span>Route &amp; dates</span>
            {routeDirty ? (
              <span className="edit-tab-dot">
                <span className="sr-only">edited</span>
              </span>
            ) : null}
          </summary>
          <div className="edit-section-body">
            <StopList
              stops={route}
              onChange={setRoute}
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
            <fieldset className="edit-travel-mode">
              <legend>Getting there</legend>
              <div className="edit-mode-options">
                {TRAVEL_MODES.map((mode) => (
                  <label key={mode}>
                    <input
                      type="radio"
                      name={`${ids}-travel-mode`}
                      value={mode}
                      checked={travelMode === mode}
                      onChange={() => setTravelMode(mode)}
                    />
                    <span>{TRAVEL_MODE_LABEL[mode]}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          </div>
        </details>

        <details
          className="edit-section"
          open={preferencesOpen}
          onToggle={(event) => setPreferencesOpen(event.currentTarget.open)}
        >
          <summary>
            <span>Packing preferences</span>
            {prefsDirty ? (
              <span className="edit-tab-dot">
                <span className="sr-only">edited</span>
              </span>
            ) : null}
          </summary>
          <div className="edit-section-body edit-prefs">
            <Switch
              label="Laundry on this trip"
              description="Halves anything marked Fewer with laundry in your Staples."
              checked={prefs.laundry}
              onChange={(laundry) => patch({ laundry })}
            />
            <Switch
              label="One spare underwear + socks"
              description="Added to the bag count, not the return outfit."
              checked={prefs.spare}
              onChange={(spare) => patch({ spare })}
            />
            <Switch
              label="Dedicated return travel outfit"
              description={returnOutfitHelp(prefs.returnOutfit)}
              checked={prefs.returnOutfit}
              onChange={(returnOutfit) => patch({ returnOutfit })}
            />
            <Switch
              label="Nice outfits"
              description={NICE_OUTFITS_DESCRIPTION}
              checked={prefs.niceAttire}
              onChange={(niceAttire) => patch({ niceAttire })}
            />
            {prefs.niceAttire ? null : (
              <p id={niceHintId} className="tiny muted">
                {NICE_OFF_HINT}
              </p>
            )}
            <div className="two-col occasion-row">
              <label className="field">
                Occasions
                <input
                  type="number"
                  min={MIN_OCCASIONS}
                  max={MAX_OCCASIONS}
                  value={prefs.occasionCount}
                  disabled={!prefs.niceAttire}
                  aria-describedby={prefs.niceAttire ? undefined : niceHintId}
                  onChange={(event) =>
                    patch({ occasionCount: clampOccasions(event.target.valueAsNumber) })
                  }
                />
              </label>
              <Switch
                label="Reuse one nice look"
                description="Repeat the same pieces."
                checked={prefs.reuseNice}
                disabled={!prefs.niceAttire}
                describedBy={prefs.niceAttire ? undefined : niceHintId}
                onChange={(reuseNice) => patch({ reuseNice })}
              />
            </div>
          </div>
        </details>

        <section className="edit-live-review" aria-labelledby={`${ids}-changes`}>
          <div className="edit-review-head">
            <h3 id={`${ids}-changes`}>What changes in your list</h3>
            {dirty ? (
              <Button variant="ghost" small onClick={undoAll}>
                Undo all
              </Button>
            ) : null}
          </div>
          {notice === "stale" ? (
            <p ref={failureRef} className="field-error" role="alert">
              Your list changed while you were editing. Nothing else was saved. Reopen Edit trip to
              review the current list.
            </p>
          ) : notice === "failed" ? (
            <p ref={failureRef} className="field-error" role="alert">
              Couldn’t save every change. Your selections are still here; try again.
            </p>
          ) : null}
          {count === 0 ? (
            <p className="muted">No changes yet.</p>
          ) : (
            <ul className="edit-change-list">
              {review.lines.map((line) => (
                <li key={line.id}>
                  <div>
                    <strong>{line.label}</strong>
                    {line.note ? <span>{line.note}</span> : null}
                  </div>
                  <p>
                    {line.before ? (
                      <>
                        <del>{line.before}</del> <span aria-hidden="true">→</span>{" "}
                      </>
                    ) : null}
                    <ins>{line.after}</ins>
                  </p>
                </li>
              ))}
            </ul>
          )}
          <p className="muted edit-review-note">
            Items you added or edited yourself stay as they are. Packed items stay ticked.
          </p>
          {review.preview.readyWillRevoke && dirty ? (
            <p>
              <strong>Ready turns off.</strong> Check the list, then mark it Ready again.
            </p>
          ) : null}
          {review.preview.needsAcknowledgement && dirty ? (
            <label className="review-ack">
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(event) => setAcknowledged(event.target.checked)}
              />
              <span>I understand that the packed counts shown above will change.</span>
            </label>
          ) : null}
        </section>
      </div>
    </ModalSheet>
  );
}
