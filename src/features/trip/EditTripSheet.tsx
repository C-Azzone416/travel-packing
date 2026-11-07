"use client";

import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { ModalSheet } from "@/components/ui/ModalSheet";
import { Switch } from "@/components/ui/Switch";
import { calculateSuggestions } from "@/domain/calc";
import { curatedLocationProvider } from "@/domain/location-provider";
import type { TripConfig } from "@/domain/trip";
import type { DraftStop, LifecycleTrip } from "@/domain/trip-lifecycle";
import { tripDisplayName, type TravelMode } from "@/domain/trip-route";
import type { TripStop } from "@/domain/trip-stops";
import { FeedbackEditorEntry } from "@/features/feedback/FeedbackEditorEntry";
import { StopRows } from "@/features/plan/StopRows";
import { TravelModeControl } from "@/features/plan/steps";
import planStyles from "@/features/plan/plan.module.css";
import { useLocationProvider } from "@/features/trips/LocationProviderContext";
import { tripMathLine } from "@/features/trips/count-copy";
import {
  clampOccasions,
  MAX_OCCASIONS,
  MIN_OCCASIONS,
  NICE_OFF_HINT,
  NICE_OUTFITS_DESCRIPTION,
  returnOutfitHelp,
} from "@/features/trips/draft";
import {
  fixSummary,
  formatNights,
  nightsAt,
  setFirstArrive,
  setLeave,
  shiftEnd,
  snapContiguous,
  stopProblems,
} from "@/features/trips/stops-draft";
import { localToday } from "@/lib/today";
import { reconcile, type EndpointsTouched } from "./edit-reconcile";
import { changeCount, editChanges, saveLabel, type ChangeRow } from "./edit-diff";
import styles from "./EditTripSheet.module.css";

export type EditTripTab = "route" | "preferences";
export type ApplyOutcome = "ok" | "stale" | "failed";
/** What a host reports after one of the sheet's saves: the trip's new save time (the next save is based on it), or null for a failure. */
export type SaveResult = { updatedAt?: string } | "stale" | null;

export interface EditTripSheetProps {
  /** The trip as saved: its route, its preferences and its list (the live changes are computed from it). */
  trip: LifecycleTrip;
  /** The section that starts open. */
  initialTab: EditTripTab;
  allowCustom?: boolean;
  /** The device-local date, for the "forecast appears" line. Default: today. */
  today?: string;
  onClose: () => void;
  /** Save the route. Resolves the new save time, or null when it failed (nothing changed). */
  onSaveRoute: (stops: TripStop[], basedOn: string | undefined) => Promise<SaveResult>;
  /** Save how the trip is travelled. */
  onSetTravelMode: (mode: TravelMode, basedOn: string | undefined) => Promise<SaveResult>;
  /** Apply the preferences, based on the trip's `updatedAt` the live changes were computed from. */
  onApplyPreferences: (config: TripConfig, basedOn: string | undefined) => Promise<ApplyOutcome>;
}

type Notice = null | "route-failed" | "travel-failed" | "failed" | "stale";

const isEqual = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

const NOTICES: Record<Exclude<Notice, null>, string> = {
  "route-failed": "Couldn’t save the route. Nothing changed. Press Save to try again.",
  "travel-failed":
    "Couldn’t save how you’re getting there. Nothing changed. Press Save to try again.",
  failed: "Couldn’t apply the changes. Nothing changed. Your selections are kept.",
  stale:
    "Your list changed while you were editing. The changes below are up to date. Check them, then save.",
};

/** The old value struck, an arrow, then the new one; read as "was X, now Y" by a screen reader. */
function Change({ row }: { row: ChangeRow }) {
  return (
    <li className={styles.row} data-kind={row.kind}>
      <span className={styles.rowLabel}>{row.label}</span>
      <span className={styles.rowValue}>
        {row.from ? (
          <>
            <del className={styles.old}>{row.from}</del>
            <span aria-hidden="true"> → </span>
            <span className="sr-only"> changes to </span>
          </>
        ) : null}
        <ins className={styles.new}>{row.to}</ins>
      </span>
      {row.sub ? <span className={styles.rowSub}>{row.sub}</span> : null}
    </li>
  );
}

function Section({
  id,
  title,
  open,
  dirty,
  onToggle,
  children,
}: {
  id: string;
  title: string;
  open: boolean;
  dirty: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <section className={styles.section} data-open={open ? "" : undefined}>
      <h3 className={styles.sectionHead}>
        <button
          type="button"
          id={`${id}-head`}
          className={styles.sectionButton}
          aria-expanded={open}
          aria-controls={`${id}-body`}
          onClick={onToggle}
        >
          <span>{title}</span>
          {dirty ? (
            <span className={styles.dot} role="img" aria-label="edited, not saved yet" />
          ) : null}
          <Icon name={open ? "caretUp" : "caretDown"} size={18} className={styles.caret} />
        </button>
      </h3>
      <div id={`${id}-body`} role="region" aria-labelledby={`${id}-head`} hidden={!open}>
        {children}
      </div>
    </section>
  );
}

// Edit trip (#389; spec #376 part 3 section 1.6): a side sheet from 1024px, a full screen below. Two collapsible sections, Route &
// dates (the stops, Leave and Come home, Getting there) and Packing preferences, a dot on each edited one, and a live "What
// changes in your list" panel beside the edits instead of a separate review step. Save N changes saves everything at once, in
// the order the server needs (route, how you're travelling, preferences), each based on the save time the one before returned.
// Cancel, Escape and × leave the trip untouched: nothing is saved until Save.
export function EditTripSheet({
  trip,
  initialTab,
  allowCustom,
  today,
  onClose,
  onSaveRoute,
  onSetTravelMode,
  onApplyPreferences,
}: EditTripSheetProps) {
  const provider = useLocationProvider();
  const ids = useId();
  const [stops, setStops] = useState<DraftStop[]>(trip.stops);
  const [prefs, setPrefs] = useState<TripConfig>(trip.config);
  const [mode, setMode] = useState<TravelMode | null>(trip.travelMode ?? null);
  // What the drafts were last in step with. When the trip changes under the sheet (a save by another device, or our own partial
  // save), each field is rebased: the person's value if they changed it from this baseline, the fresh server value otherwise
  // (edit-reconcile.ts). Adjusted while rendering, the documented way to react to a changed prop.
  const fresh = { stops: trip.stops, config: trip.config, travelMode: trip.travelMode ?? null };
  const [baseline, setBaseline] = useState(fresh);
  // Whether the person used the Leave or Come home controls (a stop edit moves those dates too, but that is not their edit).
  const [touched, setTouched] = useState<EndpointsTouched>({ leave: false, home: false });
  if (!isEqual(baseline, fresh)) {
    const next = reconcile(
      { stops: baseline.stops, config: baseline.config, travelMode: baseline.travelMode },
      { stops, config: prefs, travelMode: mode },
      fresh,
      touched,
    );
    setBaseline(fresh);
    // An endpoint the server now agrees with is settled: it stays the person's only while the new baseline still differs from it.
    const edge = (list: readonly DraftStop[], which: "arrive" | "leave") =>
      list[which === "arrive" ? 0 : list.length - 1]?.[which];
    setTouched((was) => ({
      leave: was.leave && edge(next.stops as DraftStop[], "arrive") !== edge(fresh.stops, "arrive"),
      home: was.home && edge(next.stops as DraftStop[], "leave") !== edge(fresh.stops, "leave"),
    }));
    setStops(next.stops as DraftStop[]);
    setPrefs(next.config);
    setMode(next.travelMode);
  }
  const [open, setOpen] = useState<Record<EditTripTab, boolean>>({
    route: initialTab === "route",
    preferences: initialTab === "preferences",
  });
  const [acknowledged, setAcknowledged] = useState(false);
  const [movesOpen, setMovesOpen] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const failureRef = useRef<HTMLDivElement>(null);
  const niceHintId = `${ids}-nice-hint`;
  const now = today ?? localToday();
  const fallback = provider === curatedLocationProvider ? undefined : curatedLocationProvider;

  const draft = useMemo(() => ({ stops, config: prefs, travelMode: mode }), [stops, prefs, mode]);
  const changes = useMemo(
    () => editChanges(trip, draft, calculateSuggestions, now),
    [trip, draft, now],
  );
  const { rows } = changes;
  const count = rows.length;
  const needsTick = changes.needsAcknowledgement;
  // Something differs from the saved trip, even if it is not complete enough to list yet (a stop with no place).
  const edited = count > 0 || changes.dirty.route || changes.dirty.preferences;
  const canSave = count > 0 && changes.valid && (!needsTick || acknowledged) && !busy;
  // Phone: the list of changes starts open while it is short; the person's own choice wins from then on.
  const [autoOpen, setAutoOpen] = useState(true);
  const panelRef = useRef<HTMLDivElement>(null);
  const rowsRef = useRef<HTMLDivElement>(null);
  const listOpen = movesOpen ?? autoOpen;

  const nights = nightsAt({
    arrive: stops[0]?.arrive ?? "",
    leave: stops[stops.length - 1]?.leave ?? "",
  });
  const mathDays = useMemo(
    () => calculateSuggestions({ ...prefs, start: trip.start, end: trip.end }),
    [prefs, trip.start, trip.end],
  );
  const patch = (next: Partial<TripConfig>) => setPrefs((current) => ({ ...current, ...next }));
  const problems = stopProblems(stops);
  const last = stops.length - 1;
  const lastNights = stops[last] ? nightsAt(stops[last]) : null;
  const canShorten = lastNights !== null && lastNights > (stops.length > 1 ? 1 : 0);

  // Leave / Come home are the person's edit only while they differ from the baseline: putting a date back clears the intent.
  function editLeave(next: DraftStop[]) {
    setTouched((was) => ({ ...was, leave: next[0]?.arrive !== baseline.stops[0]?.arrive }));
    setStops(next);
  }
  function editHome(next: DraftStop[]) {
    const end = (list: readonly { leave: string }[]) => list[list.length - 1]?.leave;
    setTouched((was) => ({ ...was, home: end(next) !== end(baseline.stops) }));
    setStops(next);
  }

  function undoAll() {
    setTouched({ leave: false, home: false });
    setStops(trip.stops);
    setPrefs(trip.config);
    setMode(trip.travelMode ?? null);
    setAcknowledged(false);
    setNotice(null);
  }

  async function save() {
    if (busy) return;
    if (problems.length) return;
    setBusy(true);
    setNotice(null);
    // Each save is based on the save time the one before it returned, so the preferences are still checked against the list the
    // person was shown.
    let basedOn = trip.updatedAt;
    if (changes.routeChanged) {
      const saved = await onSaveRoute(stops as TripStop[], basedOn);
      if (!saved || saved === "stale") {
        setBusy(false);
        setNotice(saved === "stale" ? "stale" : "route-failed");
        return;
      }
      basedOn = saved.updatedAt ?? basedOn;
    }
    if (changes.travelChanged && mode) {
      const saved = await onSetTravelMode(mode, basedOn);
      if (!saved || saved === "stale") {
        setBusy(false);
        setNotice(saved === "stale" ? "stale" : "travel-failed");
        return;
      }
      basedOn = saved.updatedAt ?? basedOn;
    }
    if (changes.applyPreferences) {
      const outcome = await onApplyPreferences(prefs, basedOn);
      setBusy(false);
      if (outcome !== "ok") {
        setNotice(outcome);
        return;
      }
    }
    setBusy(false);
    onClose();
  }

  // #376 §1.6: the list starts folded away if the open panel would cover more than 45% of the screen. The height it would have
  // open is what is not the list now plus the list's natural height (the list is only hidden, never removed, so it can be read).
  useLayoutEffect(() => {
    if (movesOpen !== null) return;
    const measure = () => {
      const panel = panelRef.current;
      const list = rowsRef.current;
      if (!panel || !list) return;
      const expanded = panel.offsetHeight - list.offsetHeight + list.scrollHeight;
      setAutoOpen(expanded <= window.innerHeight * 0.45);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [movesOpen, rows, notice, needsTick, changes.notes.length, problems.length]);

  const message = notice ? NOTICES[notice] : null;
  // The failure sits just above the pinned panel; make sure it is in view when it appears.
  useEffect(() => {
    if (message) failureRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [message]);

  const panel = (
    <div ref={panelRef} className={styles.panel}>
      {message ? (
        <p ref={failureRef} className={styles.failure} role="alert">
          {message}
        </p>
      ) : null}
      <div className={styles.panelHead}>
        <h3 id={`${ids}-changes`} className={styles.panelTitle}>
          <span className={styles.panelTitleWide}>What changes in your list</span>
          <span className={styles.panelTitleNarrow}>
            {count === 0 ? "No changes yet" : changeCount(count)}
          </span>
        </h3>
        {count > 0 ? (
          <button
            type="button"
            className={styles.moves}
            aria-expanded={listOpen}
            aria-controls={`${ids}-rows`}
            onClick={() => setMovesOpen(!listOpen)}
          >
            See what moves <Icon name={listOpen ? "caretUp" : "caretDown"} size={16} />
          </button>
        ) : null}
        {edited ? (
          <button type="button" className={styles.undo} disabled={busy} onClick={undoAll}>
            Undo all
          </button>
        ) : null}
      </div>
      <p className="sr-only" role="status" aria-label="Changes summary">
        {count === 0 ? "Nothing to save yet." : `${changeCount(count)} to save.`}
      </p>
      <div
        ref={rowsRef}
        id={`${ids}-rows`}
        className={styles.rows}
        data-open={listOpen ? "" : undefined}
      >
        {count === 0 ? (
          <p className={styles.empty}>No changes yet.</p>
        ) : (
          <ul aria-label="What changes in your list" className={styles.list}>
            {rows.map((row) => (
              <Change key={row.id} row={row} />
            ))}
          </ul>
        )}
        {changes.notes.map((note) => (
          <p key={note} className={styles.note}>
            {note}
          </p>
        ))}
        <p className={styles.note}>
          Items you added or edited yourself stay as they are. Packed items stay ticked.
        </p>
      </div>
      {needsTick && count > 0 ? (
        <label className={styles.ack}>
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(event) => setAcknowledged(event.target.checked)}
          />
          <span>I understand packed counts above will change.</span>
        </label>
      ) : null}
      {problems.length ? (
        <p className={styles.failure} role="status">
          {fixSummary(problems.length).replace("to continue", "to save")}
        </p>
      ) : null}
      <div className={styles.buttons}>
        <Button variant="secondary" disabled={busy} onClick={onClose}>
          Cancel
        </Button>
        <Button disabled={!canSave} aria-busy={busy} onClick={() => void save()}>
          {busy ? "Saving…" : saveLabel(count)}
        </Button>
      </div>
    </div>
  );

  return (
    <ModalSheet
      open
      variant="side"
      showClose
      headerAction={<FeedbackEditorEntry busy={busy} />}
      title="Edit trip"
      description={tripDisplayName(trip)}
      onClose={() => !busy && onClose()}
      dismissOnBackdrop={!edited}
      actions={panel}
    >
      <div className={styles.body} data-edit-body="" inert={busy}>
        <Section
          id={`${ids}-route`}
          title="Route & dates"
          open={open.route}
          dirty={changes.dirty.route}
          onToggle={() => setOpen((current) => ({ ...current, route: !current.route }))}
        >
          <div className={styles.group} role="group" aria-labelledby={`${ids}-stops`}>
            <p id={`${ids}-stops`} className={planStyles.eyebrow}>
              Stops
            </p>
            <StopRows
              stops={stops}
              onChange={(next) => setStops(next)}
              provider={provider}
              fallbackProvider={fallback}
              allowCustom={allowCustom}
              attempted={false}
            />
          </div>
          <div className={planStyles.twoCol}>
            <label className={planStyles.field}>
              Leave
              <input
                type="date"
                value={stops[0]?.arrive ?? ""}
                onChange={(event) =>
                  editLeave(snapContiguous(setFirstArrive(stops, event.target.value)))
                }
              />
            </label>
            <label className={planStyles.field}>
              Come home
              <input
                type="date"
                value={stops[last]?.leave ?? ""}
                min={stops[last]?.arrive || undefined}
                onChange={(event) => editHome(setLeave(stops, last, event.target.value))}
              />
            </label>
          </div>
          <div className={styles.nightsRow}>
            <button
              type="button"
              className={styles.step}
              aria-label="One night fewer"
              disabled={!canShorten}
              onClick={() => editHome(shiftEnd(stops, -1))}
            >
              <Icon name="minus" size={16} />
            </button>
            {nights !== null ? <span className={styles.nights}>{formatNights(nights)}</span> : null}
            <button
              type="button"
              className={styles.step}
              aria-label="One night more"
              onClick={() => editHome(shiftEnd(stops, 1))}
            >
              <Icon name="plus" size={16} />
            </button>
          </div>
          {problems.map((problem) => (
            <p key={`${problem.stopIndex}-${problem.field}`} className={planStyles.error}>
              {problem.field === "place"
                ? problem.message
                : `${stops[problem.stopIndex].location?.city ?? `Stop ${problem.stopIndex + 1}`}: ${problem.message}`}
            </p>
          ))}
          <div className={styles.group} role="group" aria-labelledby={`${ids}-how`}>
            <p id={`${ids}-how`} className={planStyles.eyebrow}>
              Getting there
            </p>
            <TravelModeControl value={mode} onChange={setMode} />
          </div>
        </Section>

        <Section
          id={`${ids}-prefs`}
          title="Packing preferences"
          open={open.preferences}
          dirty={changes.dirty.preferences}
          onToggle={() => setOpen((current) => ({ ...current, preferences: !current.preferences }))}
        >
          <div className={styles.prefs}>
            <fieldset className="pref-group">
              <legend>Clothing counts</legend>
              <Switch
                label="Laundry on this trip"
                marker={<Icon name="refresh" size={16} />}
                description="Halves anything marked ↻ in your Staples."
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
              <div className={`${planStyles.twoCol} occasion-row`}>
                <label className={planStyles.field}>
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
          </div>
          <p className="tiny muted">
            <strong>How we count:</strong>{" "}
            {tripMathLine(mathDays.days, mathDays.dailyDays, prefs.returnOutfit)}
          </p>
        </Section>
      </div>
    </ModalSheet>
  );
}
