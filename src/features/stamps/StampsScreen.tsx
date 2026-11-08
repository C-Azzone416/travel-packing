"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { buttonClassName, Button } from "@/components/ui/Button";
import { Suitcase } from "@/components/suitcase";
import { useSaveStatus } from "@/components/shell/SaveStatus";
import { localToday } from "@/lib/today";
import { useTripsSource } from "@/features/trips/TripsSourceProvider";
import type { LifecycleState } from "@/domain/trip-lifecycle";
import {
  filterLabel,
  stampTripView,
  stampsView,
  type PastTripView,
  type StampFilter,
  type StickerView,
} from "./stamps-view";
import styles from "./StampsScreen.module.css";

type Load =
  | { phase: "loading" }
  | { phase: "error" }
  | { phase: "ready"; state: LifecycleState; today: string };

const FILTERS: readonly StampFilter[] = ["rolling", "year", "all"];

function Sticker({
  sticker,
  selected = false,
  onSelect,
}: {
  sticker: StickerView;
  selected?: boolean;
  /** Without it the sticker is decorative (the Home's teaser): a span the keyboard and screen readers skip. */
  onSelect?: () => void;
}) {
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
    </>
  );
  const common = {
    className: styles.stickerButton,
    "data-upcoming": sticker.upcoming || undefined,
    "data-shape": sticker.shape,
    "data-colour": sticker.colour,
    style: { "--sticker-tilt": `${sticker.tilt}deg` } as React.CSSProperties,
  };
  return onSelect ? (
    <button
      type="button"
      {...common}
      aria-label={sticker.accessibleName}
      aria-pressed={selected}
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
          [totals.trips, "trips"],
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

function SelectedTrip({ trip }: { trip: PastTripView }) {
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
}: {
  state: LifecycleState;
  today: string;
  embedded?: boolean;
  /** The trip to select first (`/stamps?trip=<id>`, from the Home's recent trips). */
  initialTripId?: string | null;
}) {
  const [filter, setFilter] = useState<StampFilter>(initialTripId ? "all" : "rolling");
  const [selectedId, setSelectedId] = useState<string | null>(initialTripId);

  const view = useMemo(() => stampsView(state.trips, today, filter), [state, today, filter]);
  const visibleIds = useMemo(
    () =>
      new Set([
        ...view.stickers.map((sticker) => sticker.tripId),
        ...view.pastTrips.map((trip) => trip.id),
      ]),
    [view],
  );
  const defaultId = view.pastTrips[0]?.id ?? view.stickers[0]?.tripId ?? null;
  const activeId = selectedId && visibleIds.has(selectedId) ? selectedId : defaultId;
  const selectedTrip = activeId ? (state.trips.find((trip) => trip.id === activeId) ?? null) : null;
  const selected = selectedTrip ? stampTripView(selectedTrip) : null;

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
                  onSelect={() => setSelectedId(sticker.tripId)}
                />
              ))}
            </div>
          ) : (
            <p className={styles.noStickers}>Your first trip will start your sticker suitcase.</p>
          )}
          <dl className={styles.totals} aria-label="Travel totals">
            {[
              [view.totals.trips, "trips"],
              [view.totals.places, "places"],
              [view.totals.countries, "countries"],
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
          {selected ? <SelectedTrip trip={selected} /> : null}
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
    </section>
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
  return <StampsContent state={load.state} today={load.today} initialTripId={initialTripId} />;
}
