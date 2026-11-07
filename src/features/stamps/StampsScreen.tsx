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
  selected,
  onSelect,
}: {
  sticker: StickerView;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className={styles.stickerButton}
      aria-label={sticker.accessibleName}
      aria-pressed={selected}
      data-upcoming={sticker.upcoming || undefined}
      data-shape={sticker.shape}
      data-colour={sticker.colour}
      onClick={onSelect}
      style={{ "--sticker-tilt": `${sticker.tilt}deg` } as React.CSSProperties}
    >
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
    </button>
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
}: {
  state: LifecycleState;
  today: string;
  embedded?: boolean;
}) {
  const [filter, setFilter] = useState<StampFilter>("rolling");
  const [selectedId, setSelectedId] = useState<string | null>(null);

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
              [view.totals.nights, "nights away"],
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

  return <StampsContent state={load.state} today={load.today} />;
}
