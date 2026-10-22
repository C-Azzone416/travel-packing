"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, buttonClassName } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ModalSheet } from "@/components/ui/ModalSheet";
import { useToast } from "@/components/ui/Toast";
import { useSaveStatus } from "@/components/shell/SaveStatus";
import {
  pastAndArchivedTrips,
  upcomingTrips,
  type LifecycleState,
  type LifecycleTrip,
} from "@/domain/trip-lifecycle";
import { localToday } from "@/lib/today";
import { AddToiletryForm } from "@/features/trip/AddToiletryForm";
import { EditRouteSheet } from "@/features/trip/EditRouteSheet";
import { editItemHref } from "@/features/trip/edit-link";
import { LaterJourneys } from "./LaterJourneys";
import { NextDeparture, type HeroWeather } from "./NextDeparture";
import { TripCard } from "./TripCard";
import type { NewCustomItem, NewToiletryItem, TripsSource } from "./trips-source";
import {
  departureView,
  formatRange,
  journeysAheadLabel,
  tripCardView,
  weatherCells,
  type TripListView,
} from "./view";

type Load =
  | { phase: "loading" }
  | { phase: "error" }
  | { phase: "ready"; state: LifecycleState; today: string };

export interface TripsDashboardProps {
  source: TripsSource;
  /** The one place "today" comes from; injectable so tests never depend on the clock. */
  getToday?: () => string;
}

/** Earliest departure first (stable for equal dates), so the hero is always the next trip, not the newest one. */
function byDeparture(trips: LifecycleTrip[]): LifecycleTrip[] {
  return [...trips].sort((a, b) => a.start.localeCompare(b.start));
}

export function TripsDashboard({ source, getToday = localToday }: TripsDashboardProps) {
  const { track } = useSaveStatus();
  const toast = useToast();
  const [load, setLoad] = useState<Load>({ phase: "loading" });
  const [view, setView] = useState<TripListView>("upcoming");
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const [removing, setRemoving] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const [reloads, setReloads] = useState(0);
  const router = useRouter();
  const [bathroom, setBathroom] = useState<{ tripId: string; name: string; qty: number } | null>(
    null,
  );
  const [bathroomSaving, setBathroomSaving] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [editFailed, setEditFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  // The last weather answer and which hero route it was for; a stale one is never shown for another route.
  const [fetched, setFetched] = useState<{ key: string; value: HeroWeather } | null>(null);

  // The hero is the first upcoming trip; only its weather is fetched (a compact strip, one cell per stay).
  const heroTrip =
    load.phase === "ready"
      ? (byDeparture(upcomingTrips(load.state.trips, load.today))[0] ?? null)
      : null;
  const heroId = heroTrip?.id ?? null;
  const heroRoute = useMemo(
    () =>
      heroTrip?.stops
        .map((stop) => [stop.location.city, stop.arrive, stop.leave].join("|"))
        .join(";"),
    [heroTrip],
  );
  const weatherKey = heroId ? `${heroId}#${heroRoute}` : null;
  useEffect(() => {
    const weatherSource = source.weather;
    if (!heroId || !weatherKey || !weatherSource) return;
    let cancelled = false;
    const answer = (value: HeroWeather) => {
      if (!cancelled) setFetched({ key: weatherKey, value });
    };
    void (async () => {
      try {
        const settings = await weatherSource.getSettings();
        if (!settings.weatherOptIn) return answer({ phase: "none" });
        const result = await weatherSource.getTripWeather(heroId);
        if (result.kind !== "ready") return answer({ phase: "unavailable" });
        answer({
          phase: "ready",
          cells: weatherCells(heroTrip?.stops ?? [], result.stops, settings.temperatureUnit),
        });
      } catch {
        answer({ phase: "unavailable" });
      }
    })();
    return () => {
      cancelled = true;
    };
    // weatherKey stands for the hero and its stops: a changed route is a new question for the weather service.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, weatherKey]);
  const weather: HeroWeather =
    !weatherKey || !source.weather
      ? { phase: "none" }
      : fetched?.key === weatherKey
        ? fetched.value
        : { phase: "loading" };

  useEffect(() => {
    let cancelled = false;
    // A load is a read: it must not flash "Saving…", but a failure still shows Error and Retry.
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
  }, [source, track, getToday, reloads]);

  const tryAgain = () => {
    setLoad({ phase: "loading" });
    setReloads((count) => count + 1);
  };

  // Run a write for one trip. Nothing changes on screen until the source confirms; `after` runs
  // on success only, including when the chip's Retry re-sends the write.
  const run = useCallback(
    (id: string, write: () => Promise<LifecycleState>, after?: () => void): Promise<void> => {
      setBusy((current) => new Set(current).add(id));
      return track(write, (state) => {
        setLoad({ phase: "ready", state, today: getToday() });
        after?.();
      })
        .then(() => undefined)
        .catch(() => undefined)
        .finally(() => {
          setBusy((current) => {
            const next = new Set(current);
            next.delete(id);
            return next;
          });
          headingRef.current?.focus();
        });
    },
    [track, getToday],
  );

  if (load.phase === "loading") {
    return (
      <section className="screen" aria-busy="true" aria-label="Loading trips">
        <h1>Trips</h1>
        <div className="card-grid">
          {[0, 1].map((key) => (
            <Card key={key} className="trip-card skeleton-card" aria-hidden="true">
              <div className="skeleton-art" />
              <div className="trip-card-body">
                <div className="skeleton-bar" />
                <div className="skeleton-bar short" />
              </div>
            </Card>
          ))}
        </div>
        <Link className={buttonClassName()} href="/trips/new">
          Plan a trip
        </Link>
      </section>
    );
  }

  if (load.phase === "error") {
    return (
      <section className="screen">
        <h1>Trips</h1>
        <div className="empty-state">
          <strong>Couldn’t load your trips.</strong>
          <p className="muted">Nothing was changed.</p>
          <Button onClick={tryAgain}>Try again</Button>
        </div>
      </section>
    );
  }

  const { state, today } = load;
  const upcoming = upcomingTrips(state.trips, today);
  const past = pastAndArchivedTrips(state.trips, today);
  const visible = view === "upcoming" ? upcoming : past;
  const archiveView = view === "archive";
  const removeTarget = state.trips.find((trip) => trip.id === removing) ?? null;

  function confirmRemove(trip: LifecycleTrip) {
    const id = trip.id;
    setRemoving(null);
    void run(
      id,
      () => source.remove(id),
      () =>
        toast.show(`${trip.destination} removed`, {
          action: {
            label: "Undo",
            onAction: () =>
              void run(
                id,
                () => source.undoRemove(id),
                () => toast.show(`${trip.destination} restored`),
              ),
          },
        }),
    );
  }

  /** The hero's inline "＋ Add item" (#147): true once the source saved it, so the form folds away. */
  async function addItem(id: string, item: NewCustomItem): Promise<boolean> {
    return track(
      async () => {
        await source.addItem(id, item);
        return source.load();
      },
      (next) => {
        setLoad({ phase: "ready", state: next, today: getToday() });
        toast.show(`${item.name.trim()} added to ${item.category}`);
      },
    )
      .then(() => true)
      .catch(() => false);
  }

  /** Bathroom items gate bag placement, so they use the Bathroom form, here as on the packing screen. */
  function addBathroomItem(id: string, item: NewToiletryItem) {
    setBathroomSaving(true);
    track(
      async () => {
        await source.addToiletryItem(id, item);
        return source.load();
      },
      (next) => {
        setLoad({ phase: "ready", state: next, today: getToday() });
        setBathroom(null);
        toast.show(`${item.name.trim()} added to Bathroom`);
      },
    )
      .catch(() => toast.show("Couldn’t add that item. Nothing was changed."))
      .finally(() => setBathroomSaving(false));
  }

  function saveRoute(id: string, stops: Parameters<typeof source.setStops>[1]) {
    setEditFailed(false);
    setSaving(true);
    track(
      async () => {
        await source.setStops(id, stops);
        return source.load();
      },
      (next) => {
        setLoad({ phase: "ready", state: next, today: getToday() });
        setEditing(null);
      },
    )
      .catch(() => setEditFailed(true))
      .finally(() => setSaving(false));
  }

  const archive = (id: string) => void run(id, () => source.archive(id));

  const tabs = (
    <div className="trip-tabs" role="group" aria-label="Trip views">
      <button
        type="button"
        aria-pressed={!archiveView}
        className={archiveView ? "" : "active"}
        onClick={() => setView("upcoming")}
      >
        Upcoming <span>{upcoming.length}</span>
      </button>
      <button
        type="button"
        aria-pressed={archiveView}
        className={archiveView ? "active" : ""}
        onClick={() => setView("archive")}
      >
        Past & archive <span>{past.length}</span>
      </button>
    </div>
  );
  const departures = byDeparture(upcoming);
  const hero = departures[0] ?? null;
  const editTarget = state.trips.find((trip) => trip.id === editing) ?? null;

  return (
    <section className="screen">
      {archiveView ? (
        <>
          <div className="page-head">
            <div className="head-copy">
              <p className="eyebrow">Trip history</p>
              <h1>Past trips & archive</h1>
              <p className="muted">
                Past dates appear here automatically. Archiving is separate from whether a trip is
                Ready.
              </p>
            </div>
          </div>
          <div className="section-head">
            <div>
              <p className="eyebrow">Your trips</p>
              <h2 ref={headingRef} tabIndex={-1}>
                Trip history
              </h2>
            </div>
          </div>
          {tabs}
          <div className="card-grid">
            {visible.length === 0 ? (
              <div className="empty-state">
                <strong>No past or archived trips yet.</strong>
                <br />
                Archived trips and trips whose return date has passed will appear here.
              </div>
            ) : (
              visible.map((trip, index) => (
                <TripCard
                  key={trip.id}
                  trip={trip}
                  view={tripCardView(trip, today, view)}
                  first={index === 0}
                  busy={busy.has(trip.id)}
                  onArchive={archive}
                  onRestore={(id) => void run(id, () => source.restore(id))}
                  onRemove={setRemoving}
                />
              ))
            )}
          </div>
        </>
      ) : (
        <>
          <div className="ledger-head">
            <div>
              <p className="eyebrow">{journeysAheadLabel(upcoming.length)}</p>
              <h1 ref={headingRef} tabIndex={-1}>
                Your travel ledger
              </h1>
            </div>
            <Link className={buttonClassName()} href="/trips/new">
              Plan a trip
            </Link>
          </div>
          {tabs}
          {hero ? (
            <div className="ledger-grid">
              <NextDeparture
                trip={hero}
                view={tripCardView(hero, today, view)}
                departure={departureView(hero, today)}
                weather={weather}
                busy={busy.has(hero.id)}
                onEdit={(id) => {
                  setEditFailed(false);
                  setEditing(id);
                }}
                onAddItem={(item) => addItem(hero.id, item)}
                onBathroom={(name, qty) => setBathroom({ tripId: hero.id, name, qty })}
                onEditExisting={(itemId) => router.push(editItemHref(hero.id, itemId))}
                onArchive={archive}
                onRemove={setRemoving}
              />
              <LaterJourneys
                entries={departures.slice(1).map((trip) => ({
                  trip,
                  view: tripCardView(trip, today, view),
                }))}
                today={today}
                busy={busy}
                onArchive={archive}
                onRemove={setRemoving}
              />
            </div>
          ) : (
            <div className="empty-state">
              <strong>No upcoming trips.</strong>
              <br />
              Plan a trip or restore one from Past & archive.
            </div>
          )}
        </>
      )}

      {archiveView ? (
        <>
          <div className="section-head">
            <div>
              <p className="eyebrow">Recoverable</p>
              <h2>Recently deleted</h2>
            </div>
          </div>
          <Card padded className="deleted-list">
            {state.deletedTrips.length === 0 ? (
              <div className="empty-state">Nothing recently deleted.</div>
            ) : (
              state.deletedTrips.map(({ trip }) => (
                <div key={trip.id} className="archive-row">
                  <div>
                    <strong>{trip.destination}</strong>
                    <div className="item-meta">{formatRange(trip)}</div>
                  </div>
                  <Button
                    variant="secondary"
                    small
                    disabled={busy.has(trip.id)}
                    aria-label={`Undo remove: ${trip.destination}`}
                    onClick={() => void run(trip.id, () => source.undoRemove(trip.id))}
                  >
                    Undo remove
                  </Button>
                </div>
              ))
            )}
          </Card>
        </>
      ) : null}

      {bathroom && state.trips.some((trip) => trip.id === bathroom.tripId) ? (
        <AddToiletryForm
          destination={state.trips.find((trip) => trip.id === bathroom.tripId)!.destination}
          saving={bathroomSaving}
          initialName={bathroom.name}
          initialQty={bathroom.qty}
          onClose={() => setBathroom(null)}
          onAdd={(item) => addBathroomItem(bathroom.tripId, item)}
        />
      ) : null}

      {editTarget ? (
        <EditRouteSheet
          stops={editTarget.stops}
          saving={saving}
          failed={editFailed}
          onClose={() => {
            setEditFailed(false);
            setEditing(null);
          }}
          onSave={(stops) => saveRoute(editTarget.id, stops)}
        />
      ) : null}

      {removeTarget ? (
        <ModalSheet
          open
          title={`Remove ${removeTarget.destination}?`}
          description="It moves to Recently deleted in Past & archive, where you can undo it. Nothing about your list changes."
          onClose={() => setRemoving(null)}
          actions={
            <>
              <Button variant="secondary" onClick={() => setRemoving(null)}>
                Cancel
              </Button>
              <Button variant="danger" onClick={() => confirmRemove(removeTarget)}>
                Remove trip
              </Button>
            </>
          }
        >
          {null}
        </ModalSheet>
      ) : null}
    </section>
  );
}
