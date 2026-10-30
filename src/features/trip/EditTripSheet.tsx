"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/Button";
import { ModalSheet } from "@/components/ui/ModalSheet";
import { Switch } from "@/components/ui/Switch";
import { calculateSuggestions } from "@/domain/calc";
import { FeedbackEditorEntry } from "@/features/feedback/FeedbackEditorEntry";
import { curatedLocationProvider } from "@/domain/location-provider";
import { previewRecalculation, type RecalcPreview } from "@/domain/recalc-preview";
import type { Trip, TripConfig } from "@/domain/trip";
import type { DraftStop } from "@/domain/trip-lifecycle";
import type { TripStop } from "@/domain/trip-stops";
import { useLocationProvider } from "@/features/trips/LocationProviderContext";
import { StopList } from "@/features/trips/StopList";
import { tripMathLine } from "@/features/trips/count-copy";
import {
  clampOccasions,
  MAX_OCCASIONS,
  MIN_OCCASIONS,
  NICE_OFF_HINT,
  NICE_OUTFITS_DESCRIPTION,
  returnOutfitHelp,
} from "@/features/trips/draft";
import { fixSummary, stopProblems } from "@/features/trips/stops-draft";

export type EditTripTab = "route" | "preferences";
export type ApplyOutcome = "ok" | "stale" | "failed";

export interface EditTripSheetProps {
  /** The trip as saved: its route, its preferences and its list (the review is computed from it). */
  trip: Trip;
  initialTab: EditTripTab;
  allowCustom?: boolean;
  onClose: () => void;
  /** Save the route. Resolves true once saved. The sheet stays open when the preferences tab still has unsaved changes. */
  onSaveRoute: (stops: TripStop[]) => Promise<boolean>;
  /** Apply the reviewed preferences, based on the trip's `updatedAt` the review was computed from. */
  onApplyPreferences: (config: TripConfig, basedOn: string | undefined) => Promise<ApplyOutcome>;
}

const TABS: { id: EditTripTab; label: string }[] = [
  { id: "route", label: "Route & dates" },
  { id: "preferences", label: "Packing preferences" },
];

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function sameStops(a: readonly DraftStop[], b: readonly TripStop[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function sameConfig(a: TripConfig, b: TripConfig): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

// Edit trip (#203, design's spec): the route and dates and the packing preferences in one sheet, each tab keeping its own
// unsaved draft. Changing preferences recalculates the suggested items, so "Review changes" first shows what that does (it is
// computed from the same recalculation the server runs); applying is a second, deliberate step. Cancel, Escape and × leave
// the trip untouched, asking first when there is something to lose.
export function EditTripSheet({
  trip,
  initialTab,
  allowCustom,
  onClose,
  onSaveRoute,
  onApplyPreferences,
}: EditTripSheetProps) {
  const provider = useLocationProvider();
  const ids = useId();
  const [tab, setTab] = useState<EditTripTab>(initialTab);
  // The route tab's draft. A saved route (the trip's stops changed under us) is its new starting point, so the draft is reset
  // while rendering, the documented way to adjust state to a changed prop.
  const [route, setRoute] = useState<{
    base: readonly TripStop[];
    draft: DraftStop[];
    attempted: boolean;
  }>({
    base: trip.stops,
    draft: trip.stops,
    attempted: false,
  });
  if (!sameStops(route.base, trip.stops))
    setRoute({ base: trip.stops, draft: trip.stops, attempted: false });
  const routeDraft = route.draft;
  const attempted = route.attempted;
  const setRouteDraft = (draft: DraftStop[]) => setRoute((current) => ({ ...current, draft }));
  const setAttempted = (value: boolean) =>
    setRoute((current) => ({ ...current, attempted: value }));
  const [prefs, setPrefs] = useState<TripConfig>(trip.config);
  const [step, setStep] = useState<"edit" | "review">("edit");
  const [acknowledged, setAcknowledged] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<null | "route-failed" | "failed" | "stale">(null);
  const reviewHeading = useRef<HTMLHeadingElement>(null);
  const failureRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<Partial<Record<EditTripTab, HTMLButtonElement | null>>>({});
  const niceHintId = `${ids}-nice-hint`;

  const problems = stopProblems(routeDraft);
  const routeDirty = !sameStops(routeDraft, trip.stops);
  const prefsDirty = !sameConfig(prefs, trip.config);
  const dirty = routeDirty || prefsDirty;

  const preview: RecalcPreview | null = useMemo(
    () => (step === "review" ? previewRecalculation(trip, prefs, calculateSuggestions) : null),
    [step, trip, prefs],
  );
  const mathDays = useMemo(
    () => calculateSuggestions({ ...prefs, start: trip.start, end: trip.end }),
    [prefs, trip.start, trip.end],
  );

  const patch = (next: Partial<TripConfig>) => setPrefs((current) => ({ ...current, ...next }));

  function requestClose() {
    if (busy) return;
    if (dirty) setDiscarding(true);
    else onClose();
  }

  function selectTab(next: EditTripTab) {
    setTab(next);
    setStep("edit");
    setNotice(null);
  }

  function onTabKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const move = { ArrowRight: 1, ArrowLeft: -1, Home: -index, End: TABS.length - 1 - index }[
      event.key as "ArrowRight"
    ];
    if (move === undefined) return;
    event.preventDefault();
    const target = TABS[(index + move + TABS.length) % TABS.length].id;
    selectTab(target);
    tabRefs.current[target]?.focus();
  }

  async function saveRoute() {
    if (problems.length) {
      setAttempted(true);
      return;
    }
    setBusy(true);
    setNotice(null);
    const saved = await onSaveRoute(routeDraft as TripStop[]);
    setBusy(false);
    if (!saved) {
      setNotice("route-failed");
      return;
    }
    // The route is saved; unsaved packing changes are not lost with it.
    if (prefsDirty) {
      setAttempted(false);
      setTab("preferences");
    } else onClose();
  }

  function review() {
    setNotice(null);
    setAcknowledged(false);
    setStep("review");
    // The review heading takes focus once it is on screen.
    setTimeout(() => reviewHeading.current?.focus(), 0);
  }

  async function apply() {
    if (!preview || busy) return;
    if (preview.needsAcknowledgement && !acknowledged) return;
    setBusy(true);
    setNotice(null);
    const outcome = await onApplyPreferences(prefs, trip.updatedAt);
    setBusy(false);
    if (outcome === "ok") onClose();
    else if (outcome === "stale") {
      setNotice("stale");
      setStep("edit");
    } else setNotice("failed");
  }

  const footer = discarding ? (
    <>
      <p className="edit-trip-discard" role="alert">
        Discard your changes?
      </p>
      <Button variant="secondary" onClick={() => setDiscarding(false)}>
        Keep editing
      </Button>
      <Button variant="danger" onClick={onClose}>
        Discard
      </Button>
    </>
  ) : step === "review" ? (
    <>
      <Button
        disabled={busy || (preview?.needsAcknowledgement === true && !acknowledged)}
        aria-busy={busy}
        onClick={() => void apply()}
      >
        {busy ? "Applying…" : "Apply changes"}
      </Button>
      <Button
        variant="secondary"
        disabled={busy}
        onClick={() => {
          setStep("edit");
          setNotice(null);
        }}
      >
        Back to preferences
      </Button>
      <Button variant="ghost" disabled={busy} onClick={requestClose}>
        Cancel
      </Button>
    </>
  ) : tab === "route" ? (
    <>
      <Button disabled={busy} aria-busy={busy} onClick={() => void saveRoute()}>
        {busy ? "Saving…" : "Save route"}
      </Button>
      <Button variant="secondary" disabled={busy} onClick={requestClose}>
        Cancel
      </Button>
    </>
  ) : (
    <>
      <Button disabled={!prefsDirty} onClick={review} aria-describedby={`${ids}-nochange`}>
        Review changes
      </Button>
      <Button variant="secondary" onClick={requestClose}>
        Cancel
      </Button>
      {prefsDirty ? null : (
        <span id={`${ids}-nochange`} className="tiny muted edit-trip-nochange">
          No changes to apply
        </span>
      )}
    </>
  );

  const failureMessage =
    notice === "route-failed"
      ? "Couldn’t save the route. Nothing changed. Press Save route to try again."
      : notice === "failed"
        ? "Couldn’t apply the changes. Nothing changed. Your selections are kept."
        : null;

  // The failure sits outside the scrolling body, just above the pinned footer; make sure it is in view when it appears.
  useEffect(() => {
    if (failureMessage) failureRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [failureMessage]);

  return (
    <ModalSheet
      open
      showClose
      headerAction={<FeedbackEditorEntry busy={busy} />}
      title="Edit trip"
      description="Route, dates and packing preferences for this trip."
      onClose={requestClose}
      actions={footer}
    >
      <div className="edit-body">
        <div className="edit-tabs" role="tablist" aria-label="What to edit">
          {TABS.map((entry, index) => {
            const changed = entry.id === "route" ? routeDirty : prefsDirty;
            return (
              <button
                key={entry.id}
                ref={(node) => {
                  tabRefs.current[entry.id] = node;
                }}
                type="button"
                role="tab"
                id={`${ids}-tab-${entry.id}`}
                aria-selected={tab === entry.id}
                aria-controls={`${ids}-panel-${entry.id}`}
                tabIndex={tab === entry.id ? 0 : -1}
                disabled={busy}
                onClick={() => selectTab(entry.id)}
                onKeyDown={(event) => onTabKey(event, index)}
              >
                {entry.label}
                {changed ? (
                  <span className="edit-tab-dot" role="img" aria-label="unsaved changes" />
                ) : null}
              </button>
            );
          })}
        </div>

        <div
          role="tabpanel"
          id={`${ids}-panel-route`}
          aria-labelledby={`${ids}-tab-route`}
          hidden={tab !== "route"}
        >
          <StopList
            stops={routeDraft}
            onChange={setRouteDraft}
            provider={provider}
            fallbackProvider={
              provider === curatedLocationProvider ? undefined : curatedLocationProvider
            }
            allowCustom={allowCustom}
            attempted={attempted}
            headingLevel={3}
          />
          <p className="tiny muted">Your list is recalculated for the new dates.</p>
          {attempted && problems.length ? (
            <p className="tiny field-error">{fixSummary(problems.length)}</p>
          ) : null}
        </div>

        <div
          role="tabpanel"
          id={`${ids}-panel-preferences`}
          aria-labelledby={`${ids}-tab-preferences`}
          hidden={tab !== "preferences"}
        >
          {step === "edit" ? (
            <div className="edit-prefs">
              {notice === "stale" ? (
                <p className="field-error" role="alert">
                  Your list changed while you were reviewing. Review again.
                </p>
              ) : null}
              <fieldset className="pref-group">
                <legend>Clothing counts</legend>
                <Switch
                  label="Laundry access"
                  description="Reduce repeatable everyday clothing."
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
              </fieldset>
              <fieldset className="pref-group">
                <legend>Nice outfits</legend>
                <Switch
                  label="Nice outfits"
                  description={NICE_OUTFITS_DESCRIPTION}
                  checked={prefs.niceAttire}
                  onChange={(niceAttire) => patch({ niceAttire })}
                />
                {prefs.niceAttire ? null : (
                  <p id={niceHintId} className="tiny muted nice-hint">
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
              </fieldset>
              <p className="tiny muted" aria-live="polite">
                <strong>How we count:</strong>{" "}
                {tripMathLine(mathDays.days, mathDays.dailyDays, prefs.returnOutfit)}
              </p>
            </div>
          ) : preview ? (
            <ReviewChanges
              preview={preview}
              headingRef={reviewHeading}
              acknowledged={acknowledged}
              onAcknowledge={setAcknowledged}
            />
          ) : null}
        </div>
      </div>
      {failureMessage ? (
        <div ref={failureRef} className="field-error edit-failure" role="alert">
          {failureMessage}
          {step === "review" && notice === "failed" ? (
            <>
              {" "}
              <Button variant="secondary" small disabled={busy} onClick={() => void apply()}>
                Try again
              </Button>
            </>
          ) : null}
        </div>
      ) : null}
    </ModalSheet>
  );
}

interface ReviewProps {
  preview: RecalcPreview;
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  acknowledged: boolean;
  onAcknowledge: (value: boolean) => void;
}

/** "Review changes to your list": what applying will do, in plain words, grouped. Every line comes from the preview. */
function ReviewChanges({ preview, headingRef, acknowledged, onAcknowledge }: ReviewProps) {
  const ackId = useId();
  const { updated, removed, added, stays, suppressed, packedReduced } = preview;
  const chips = [
    updated.length ? `${updated.length} updated` : null,
    removed.length ? `${removed.length} removed` : null,
    added.length ? `${added.length} added` : null,
    `${stays.length} stay as you left them`,
  ].filter((chip): chip is string => chip !== null);
  const sentence = [
    updated.length ? `${updated.length} updated` : null,
    removed.length ? `${removed.length} removed` : null,
    added.length ? `${added.length} added` : null,
    `${stays.length} unchanged`,
  ]
    .filter((part): part is string => part !== null)
    .join(", ");
  const nothing = updated.length === 0 && removed.length === 0 && added.length === 0;

  return (
    <div className="review-changes">
      <h3 ref={headingRef} tabIndex={-1}>
        Review changes to your list
      </h3>
      <p className="muted">
        You changed your preferences, so we’ll recalculate the suggested items. Anything you added
        or edited stays exactly as it is.
      </p>
      <ul className="review-chips" aria-hidden="true">
        {chips.map((chip) => (
          <li key={chip}>{chip}</li>
        ))}
      </ul>
      <p className="sr-only" role="status">
        {sentence}
      </p>

      {nothing ? <p>Nothing in your list changes except the preference.</p> : null}

      {updated.length ? (
        <section className="review-group" aria-labelledby={`${ackId}-updated`}>
          <h4 id={`${ackId}-updated`}>Updated suggestions</h4>
          <ul>
            {updated.map((line) => (
              <li key={line.id}>
                <span>
                  {line.name}:{" "}
                  <strong>
                    {line.fromQty} → {line.toQty}
                  </strong>
                </span>
                {line.packedFrom !== undefined ? (
                  <span className="tag warn-tag">
                    Packed {line.packedFrom} → {line.packedTo}
                  </span>
                ) : null}
                {line.packedFrom !== undefined ? (
                  <p className="tiny muted">
                    The new target is lower than what you’ve packed, so the packed count is lowered
                    to the new target.
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {removed.length ? (
        <section className="review-group" aria-labelledby={`${ackId}-removed`}>
          <h4 id={`${ackId}-removed`}>Removed because of your new preferences</h4>
          <ul>
            {removed.map((line) => (
              <li key={line.id}>
                <span>
                  {line.name} (target {line.qty}, {line.packed} packed)
                </span>
                {line.packed > 0 ? <span className="tag warn-tag">Packed</span> : null}
                {line.edited ? <span className="tag">Edited</span> : null}
              </li>
            ))}
          </ul>
          <p className="tiny muted">
            These are remembered. Turn the preference back on and they return with your edits and
            packed counts.
          </p>
        </section>
      ) : null}

      {added.length ? (
        <section className="review-group" aria-labelledby={`${ackId}-added`}>
          <h4 id={`${ackId}-added`}>New suggestions</h4>
          <ul>
            {added.map((line) => (
              <li key={line.id}>
                {line.name}
                {line.optional ? " (optional)" : ""}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <details className="review-group review-stay">
        <summary>
          Stay as you left them <span className="tiny muted">{count(stays.length, "item")}</span>
        </summary>
        <ul>
          {stays.map((line) => (
            <li key={line.id}>
              {line.name} <span className="tiny muted">({line.why})</span>
            </li>
          ))}
          {suppressed.map((line) => (
            <li key={`suppressed-${line.id}`}>
              Not re-added: {line.name} <span className="tiny muted">(you removed it)</span>
            </li>
          ))}
        </ul>
      </details>

      {preview.readyWillRevoke || preview.bagWillReset ? (
        <div className="review-also">
          <h4>Also changes</h4>
          {preview.readyWillRevoke ? (
            <p>
              <strong>Ready turns off.</strong> Check the list, then mark it Ready again.
            </p>
          ) : null}
          {preview.bagWillReset ? (
            <p>
              <strong>Toiletry bag placement resets</strong> because Bathroom items changed:{" "}
              {preview.bathroomChanges.join(", ")}.
            </p>
          ) : null}
        </div>
      ) : null}

      {preview.needsAcknowledgement ? (
        <label className="review-ack">
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(event) => onAcknowledge(event.target.checked)}
          />
          <span>
            I understand packed counts above will change
            {packedReduced.length === 0 ? " and packed or edited items will be removed" : ""}.
          </span>
        </label>
      ) : null}
    </div>
  );
}
