"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { buttonClassName, Button } from "@/components/ui/Button";
import { Suitcase } from "@/components/suitcase";
import { useSaveStatus } from "@/components/shell/SaveStatus";
import { useToast } from "@/components/ui/Toast";
import { automaticStamps, type StampLabels } from "@/domain/stamps";
import { localToday } from "@/lib/today";
import { useTripsSource } from "@/features/trips/TripsSourceProvider";
import type { LifecycleState, LifecycleTrip } from "@/domain/trip-lifecycle";
import { EditStampSheet } from "@/features/trip/EditStampSheet";
import { StampDetailsSheet } from "./StampDetailsSheet";
import {
  filterLabel,
  stampTripView,
  stampsView,
  stickerEditable,
  type PastTripView,
  type StampFilter,
  type StickerView,
} from "./stamps-view";
import styles from "./StampsScreen.module.css";

type Load =
  | { phase: "loading" }
  | { phase: "error" }
  | { phase: "ready"; state: LifecycleState; today: string };

const NO_LABELS: Record<string, StampLabels> = {};

interface EditorOpen {
  tripId: string;
  /** The sticker that opened it, to give focus back to; null when the selected card opened it. */
  stickerKey: string | null;
  /** Which opening this is, so a late save cannot close a different one. */
  token: number;
}

const FILTERS: readonly StampFilter[] = ["rolling", "year", "all"];

export function Sticker({
  sticker,
  selected = false,
  onSelect,
  className,
  large = false,
}: {
  sticker: StickerView;
  /** An extra class from the screen that draws it (the Home's Welcome home card sizes it). */
  className?: string;
  selected?: boolean;
  /** Without it the sticker is decorative (the Home's teaser): a span the keyboard and screen readers skip. */
  onSelect?: () => void;
  /** The close-up in the stamp details: bigger, not a control, still named so a screen reader hears what the grid says. */
  large?: boolean;
}) {
  const tag = sticker.upcoming && (onSelect || large);
  const body = (
    <>
      <span
        className={styles.stickerRegion}
        title={sticker.region}
        data-text={sticker.region}
        aria-hidden="true"
      />
      <strong className={styles.stickerCode} data-text={sticker.code || "—"} aria-hidden="true" />
      <span className={styles.stickerMonth} data-text={sticker.month} aria-hidden="true" />
      {sticker.completedCount > 1 ? (
        <span className={styles.repeatBadge} aria-hidden="true">
          ×{sticker.completedCount}
        </span>
      ) : null}
      {tag ? (
        <span className={styles.upcomingTag} aria-hidden="true">
          Upcoming
        </span>
      ) : null}
    </>
  );
  const common = {
    className: [styles.stickerButton, large ? styles.stickerLarge : "", className ?? ""]
      .filter(Boolean)
      .join(" "),
    "data-upcoming": sticker.upcoming || undefined,
    "data-shape": sticker.shape,
    "data-colour": sticker.colour,
    style: { "--sticker-tilt": `${sticker.tilt}deg` } as React.CSSProperties,
  };
  if (large)
    return (
      <span {...common} role="img" aria-label={sticker.accessibleName}>
        {body}
      </span>
    );
  return onSelect ? (
    <button
      type="button"
      {...common}
      data-sticker-key={sticker.key}
      aria-label={sticker.accessibleName}
      aria-pressed={selected}
      aria-haspopup="dialog"
      onClick={onSelect}
    >
      {body}
    </button>
  ) : (
    <span {...common} aria-hidden="true" data-decorative="true">
      {body}
    </span>
  );
}

/**
 * The Home's Stamps teaser (#409): the dark sticker suitcase with the latest stickers, two totals and a link to Stamps.
 * It draws the same stickers as the Stamps screen, but decoratively: the link is the one control.
 */
export function StickerTeaser({
  stickers,
  inked,
  filterLabel: label,
  totals,
}: {
  stickers: readonly StickerView[];
  inked: number;
  filterLabel: string;
  totals: { trips: number; nights: number };
}) {
  return (
    <Suitcase interior="dark" inset="stamps" className={`${styles.stickerCase} ${styles.teaser}`}>
      <div className={styles.caseHead}>
        <h2>Stickers · {label}</h2>
        <strong>{inked} inked</strong>
      </div>
      {stickers.length ? (
        <div className={styles.stickerGrid} aria-hidden="true">
          {stickers.map((sticker) => (
            <Sticker key={sticker.key} sticker={sticker} />
          ))}
        </div>
      ) : (
        <p className={styles.noStickers}>No stickers in this window yet.</p>
      )}
      <dl className={styles.totals} aria-label="Travel totals">
        {[
          [totals.trips, totals.trips === 1 ? "trip" : "trips"],
          [totals.nights, totals.nights === 1 ? "night away" : "nights away"],
        ].map(([value, text]) => (
          <div key={text}>
            <dt>{text}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <Link className={styles.teaserLink} href="/stamps">
        All stamps ›
      </Link>
    </Suitcase>
  );
}

function SelectedTrip({ trip, onEdit }: { trip: PastTripView; onEdit?: () => void }) {
  return (
    <article className={styles.selectedCard} aria-label={`Selected trip: ${trip.name}`}>
      <p className={styles.selectedEyebrow} data-colour={trip.stickerColour ?? undefined}>
        {trip.eyebrow}
      </p>
      <h3>{trip.name}</h3>
      <p>{trip.facts}</p>
      <div className={styles.selectedActions}>
        <Link
          className={buttonClassName({ variant: "secondary", small: true })}
          href={`/trips/new?copy=${trip.id}`}
        >
          Reuse this list
        </Link>
        <Link className={styles.openTrip} href={`/trips/${trip.id}`}>
          Open trip
        </Link>
        {onEdit ? (
          <Button variant="secondary" small onClick={onEdit}>
            Edit stamp label
          </Button>
        ) : null}
      </div>
    </article>
  );
}

function PastTripRow({
  trip,
  selected,
  onSelect,
}: {
  trip: PastTripView;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className={styles.tripRow}
      aria-pressed={selected}
      onClick={onSelect}
      data-selected={selected || undefined}
    >
      <span
        className={styles.tripCode}
        data-colour={trip.stickerColour ?? undefined}
        aria-hidden="true"
      >
        {trip.code || "—"}
      </span>
      <span className={styles.tripCopy}>
        <strong>{trip.name}</strong>
        <span>{trip.facts}</span>
      </span>
      <span className={styles.tripPacked}>
        {trip.packed}/{trip.total} packed
      </span>
    </button>
  );
}

/**
 * The stamps themselves: the filters, the sticker suitcase and the past trips. The Stamps screen and the Home phone's
 * Stamps pill (#388) draw the same thing from the same trips; `embedded` leaves out the page heading (the Home has its own).
 */
export function StampsContent({
  state,
  today,
  embedded = false,
  initialTripId = null,
  onTripSaved,
}: {
  state: LifecycleState;
  today: string;
  embedded?: boolean;
  /**
   * Called with the trip as the source confirmed it after a label save. The screen that owns `state` puts it there, so every
   * layout of that screen (the Home's panel unmounts on a pill change or a resize) reads the same confirmed labels. Without it
   * the labels saved here are kept in this component.
   */
  onTripSaved?: (trip: LifecycleTrip) => void;
  /** The trip to select first (`/stamps?trip=<id>`, from the Home's recent trips). */
  initialTripId?: string | null;
}) {
  const [filter, setFilter] = useState<StampFilter>(initialTripId ? "all" : "rolling");
  const [selectedId, setSelectedId] = useState<string | null>(initialTripId);
  /** The stamp labels saved from here, so the stickers, the card and the details change in place. */
  const [ownLabels, setOwnLabels] = useState<Record<string, StampLabels>>({});
  const savedLabels = onTripSaved ? NO_LABELS : ownLabels;
  const saving = useRef(false);
  const [detailKey, setDetailKey] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorOpen | null>(null);
  const editorRef = useRef<EditorOpen | null>(null);
  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);
  const editorCount = useRef(0);
  /** The editor adds one history entry so the phone's Back button closes it within Stamps instead of leaving the panel. */
  const ownEntry = useRef(false);
  const focusAfterEditor = useRef<string | null>(null);
  const [announcement, setAnnouncement] = useState("");

  const trips = useMemo<LifecycleTrip[]>(
    () =>
      state.trips.map((trip) =>
        savedLabels[trip.id] ? { ...trip, stampLabels: savedLabels[trip.id] } : trip,
      ),
    [state.trips, savedLabels],
  );
  const view = useMemo(() => stampsView(trips, today, filter), [trips, today, filter]);
  const visibleIds = useMemo(
    () =>
      new Set([
        ...view.stickers.map((sticker) => sticker.tripId),
        ...view.pastTrips.map((trip) => trip.id),
      ]),
    [view],
  );
  // Only an earned sticker is selected without a tap: an upcoming one must not look inked at first paint (#493).
  const defaultId =
    view.stickers.find((sticker) => !sticker.upcoming)?.tripId ?? view.pastTrips[0]?.id ?? null;
  const activeId = selectedId && visibleIds.has(selectedId) ? selectedId : defaultId;
  const selectedTrip = activeId ? (trips.find((trip) => trip.id === activeId) ?? null) : null;
  const selected = selectedTrip ? stampTripView(selectedTrip, today) : null;
  const detailSticker = detailKey
    ? (view.stickers.find((sticker) => sticker.key === detailKey) ?? null)
    : null;
  const detailTrip = detailSticker
    ? (trips.find((trip) => trip.id === detailSticker.tripId) ?? null)
    : null;
  const editorTrip = editor ? (trips.find((trip) => trip.id === editor.tripId) ?? null) : null;

  // After the editor closes, focus goes back to the sticker that opened it (not to the details it replaced).
  useEffect(() => {
    if (editor || !focusAfterEditor.current) return;
    const key = focusAfterEditor.current;
    focusAfterEditor.current = null;
    [...document.querySelectorAll<HTMLElement>("[data-sticker-key]")]
      .find((node) => node.dataset.stickerKey === key)
      ?.focus();
  }, [editor]);

  const openEditor = (tripId: string, stickerKey: string | null) => {
    editorCount.current += 1;
    setEditor({ tripId, stickerKey, token: editorCount.current });
    if (!ownEntry.current) {
      ownEntry.current = true;
      window.history.pushState({ stampEditor: true }, "", window.location.href);
    }
  };
  const dismissEditor = () => {
    focusAfterEditor.current = editorRef.current?.stickerKey ?? null;
    setEditor(null);
  };
  const closeEditor = () => {
    if (ownEntry.current) {
      ownEntry.current = false;
      window.history.back();
    }
    dismissEditor();
  };
  // Back (the browser's or the phone's) with the editor open closes it and keeps the person where they were.
  useEffect(() => {
    const onPop = () => {
      if (!ownEntry.current) return;
      // A pending save cannot be dismissed (Back included): the entry Back removed is put back and the editor stays.
      if (saving.current) {
        window.history.pushState({ stampEditor: true }, "", window.location.href);
        return;
      }
      ownEntry.current = false;
      dismissEditor();
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
    // dismissEditor only reads refs and a state setter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <section className={`${styles.root} ${embedded ? styles.embedded : "screen"}`}>
      <div className={styles.pageHead}>
        {embedded ? null : (
          <div>
            <h1>Stamps</h1>
            <p className="lede">
              Every trip earns a sticker when you get home. Go back somewhere and you get another
              one.
            </p>
          </div>
        )}
        <div className={styles.filters} role="group" aria-label="Filter stamps">
          {FILTERS.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={filter === option}
              onClick={() => setFilter(option)}
            >
              {filterLabel(option, today)}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.layout}>
        <Suitcase interior="dark" inset="stamps" className={styles.stickerCase}>
          <div className={styles.caseHead}>
            <p>Stickers · {view.filterLabel}</p>
            <strong>{view.inked} inked</strong>
          </div>
          {view.stickers.length ? (
            <div className={styles.stickerGrid} aria-label="Trip stickers">
              {view.stickers.map((sticker) => (
                <Sticker
                  key={sticker.key}
                  sticker={sticker}
                  selected={activeId === sticker.tripId}
                  onSelect={() => {
                    setSelectedId(sticker.tripId);
                    setDetailKey(sticker.key);
                  }}
                />
              ))}
            </div>
          ) : (
            <p className={styles.noStickers}>Your first trip will start your sticker suitcase.</p>
          )}
          <dl className={styles.totals} aria-label="Travel totals">
            {[
              [view.totals.trips, view.totals.trips === 1 ? "trip" : "trips"],
              [view.totals.places, view.totals.places === 1 ? "place" : "places"],
              [view.totals.countries, view.totals.countries === 1 ? "country" : "countries"],
              [view.totals.nights, view.totals.nights === 1 ? "night away" : "nights away"],
            ].map(([value, label]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          <p className={styles.caseNote}>
            Dashed stickers are trips you haven’t taken yet. They ink when you get home. A gold
            badge means you’ve been more than once.
          </p>
        </Suitcase>

        <section className={styles.past} aria-labelledby="past-trips-title">
          <h2 id="past-trips-title">Past trips</h2>
          {selected && selectedTrip ? (
            <SelectedTrip
              trip={selected}
              onEdit={
                automaticStamps(selectedTrip.stops).length > 0
                  ? () => openEditor(selectedTrip.id, null)
                  : undefined
              }
            />
          ) : null}
          {view.pastTrips.length ? (
            <div className={styles.tripList}>
              {view.pastTrips.map((trip) => (
                <PastTripRow
                  key={trip.id}
                  trip={trip}
                  selected={activeId === trip.id}
                  onSelect={() => setSelectedId(trip.id)}
                />
              ))}
            </div>
          ) : (
            <p className={styles.emptyCard}>No past trips yet.</p>
          )}
        </section>
      </div>

      {detailSticker && detailTrip && !editor ? (
        <StampDetailsSheet
          sticker={detailSticker}
          trip={detailTrip}
          summary={stampTripView(detailTrip, today)}
          canEdit={automaticStamps(detailTrip.stops).length > 0}
          editable={stickerEditable(detailTrip, detailSticker.stopIndex)}
          onEdit={() => {
            setDetailKey(null);
            openEditor(detailTrip.id, detailSticker.key);
          }}
          onClose={() => setDetailKey(null)}
        />
      ) : null}
      {editorTrip ? (
        <StampLabelEditor
          key={editor?.token}
          trip={editorTrip}
          onClose={closeEditor}
          onSavingChange={(value) => {
            saving.current = value;
          }}
          onSaved={(saved) => {
            if (onTripSaved) onTripSaved(saved);
            else
              setOwnLabels((current) => ({
                ...current,
                [saved.id]: saved.stampLabels ?? [null, null],
              }));
            setAnnouncement("Stamp label saved.");
            // A save finishing closes only the editor that sent it.
            if (editorRef.current?.token === editor?.token) closeEditor();
          }}
        />
      ) : null}
      <p className="sr-only" role="status">
        {announcement}
      </p>
    </section>
  );
}

/** The existing Edit stamp sheet, wired to the trips source. Mounted only while it is open, so a read-only view needs no providers. */
function StampLabelEditor({
  trip,
  onClose,
  onSaved,
  onSavingChange,
}: {
  trip: LifecycleTrip;
  onClose: () => void;
  onSaved: (trip: LifecycleTrip) => void;
  onSavingChange: (saving: boolean) => void;
}) {
  const source = useTripsSource();
  const { track } = useSaveStatus();
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  // The labels as last confirmed, read when Save is pressed: only the slots the person changed are written over them.
  const latest = useRef(trip.stampLabels);
  useEffect(() => {
    latest.current = trip.stampLabels;
  }, [trip.stampLabels]);
  return (
    <EditStampSheet
      automatic={automaticStamps(trip.stops)}
      stops={trip.stops}
      saved={trip.stampLabels}
      departure={trip.start}
      saving={saving}
      failed={failed}
      onClose={onClose}
      onSave={(slot1, slot2, changed) => {
        setFailed(false);
        setSaving(true);
        onSavingChange(true);
        const before = latest.current ?? [null, null];
        const first = changed[0] ? slot1 : before[0];
        const second = changed[1] ? slot2 : before[1];
        track(
          () => source.setStampLabels(trip.id, first, second),
          (change) => {
            const now = change.trip.stampLabels ?? [null, null];
            // Only slots that changed count: a change that only cleared overrides is a reset.
            const changed = [0, 1].filter((slot) => now[slot] !== before[slot]);
            toast.show(
              changed.length > 0 && changed.every((slot) => now[slot] === null)
                ? "Stamp reset to automatic."
                : "Stamp updated.",
            );
            onSaved(change.trip);
          },
        )
          .catch(() => setFailed(true))
          .finally(() => {
            onSavingChange(false);
            setSaving(false);
          });
      }}
    />
  );
}

export function StampsScreen({ getToday = localToday }: { getToday?: () => string }) {
  const source = useTripsSource();
  const { track } = useSaveStatus();
  const [load, setLoad] = useState<Load>({ phase: "loading" });
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    track(
      () => source.load(),
      (state) => {
        if (!cancelled) setLoad({ phase: "ready", state, today: getToday() });
      },
      { read: true },
    ).catch(() => {
      if (!cancelled) setLoad({ phase: "error" });
    });
    return () => {
      cancelled = true;
    };
  }, [source, track, getToday, reload]);

  if (load.phase === "loading") {
    return (
      <section className={`${styles.root} screen`} aria-busy="true" aria-label="Loading stamps">
        <h1>Stamps</h1>
        <p className="lede">Every trip earns a sticker when you get home.</p>
        <div className={styles.loadingCase} aria-hidden="true" />
      </section>
    );
  }

  if (load.phase === "error") {
    return (
      <section className={`${styles.root} screen`}>
        <h1>Stamps</h1>
        <div className={styles.emptyCard}>
          <strong>Couldn’t load your stamps.</strong>
          <p>Nothing was changed.</p>
          <Button onClick={() => (setLoad({ phase: "loading" }), setReload((value) => value + 1))}>
            Try again
          </Button>
        </div>
      </section>
    );
  }

  // The trips have loaded in the browser by now, so reading the address cannot disagree with the server's markup.
  const initialTripId = new URLSearchParams(window.location.search).get("trip");
  return (
    <StampsContent
      state={load.state}
      today={load.today}
      initialTripId={initialTripId}
      onTripSaved={(saved) =>
        setLoad((current) =>
          current.phase === "ready"
            ? {
                ...current,
                state: {
                  ...current.state,
                  trips: current.state.trips.map((trip) => (trip.id === saved.id ? saved : trip)),
                },
              }
            : current,
        )
      }
    />
  );
}
