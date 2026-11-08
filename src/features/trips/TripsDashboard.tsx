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
import { EditTripSheet, type ApplyOutcome } from "@/features/trip/EditTripSheet";
import { HomeLaptop } from "./HomeLaptop";
import { HomeEmpty } from "./HomeEmpty";
import { HomePhone } from "./HomePhone";
import type { HomeMaps } from "./home-map-types";
import { cityWeather, noTripModel, usualRows, type HeroWeather } from "./home-view";
import { LAPTOP_MIN_WIDTH, useMinWidth } from "@/lib/use-min-width";
import { routeSignature, stopsOrDestination, tripRoutePoints } from "@/domain/trip-route";
import { TripCard } from "./TripCard";
import type { TripsSource } from "./trips-source";
import { formatRange, tripCardView, type TripListView } from "./view";

type Load =
  | { phase: "loading" }
  | { phase: "error" }
  | { phase: "ready"; state: LifecycleState; today: string };

export interface TripsDashboardProps {
  source: TripsSource;
  /** The one place "today" comes from; injectable so tests never depend on the clock. */
  getToday?: () => string;
  /** Route maps drawn on the server for the trips that may be next (laptop Home). */
  maps?: HomeMaps;
}

/** Earliest departure first (stable for equal dates), so the hero is always the next trip, not the newest one. */
function byDeparture(trips: LifecycleTrip[]): LifecycleTrip[] {
  return [...trips].sort((a, b) => a.start.localeCompare(b.start));
}

export function TripsDashboard({ source, getToday = localToday, maps }: TripsDashboardProps) {
  const { track } = useSaveStatus();
  const toast = useToast();
  const [load, setLoad] = useState<Load>({ phase: "loading" });
  const [view, setView] = useState<TripListView>("upcoming");
  const laptop = useMinWidth(LAPTOP_MIN_WIDTH);
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const [removing, setRemoving] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  // After a write the control that was used may be gone (the next trip archived): focus goes to the page heading.
  const [focusTick, setFocusTick] = useState(0);
  useEffect(() => {
    if (focusTick > 0) headingRef.current?.focus();
  }, [focusTick]);

  const [reloads, setReloads] = useState(0);
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null);
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
        if (!settings.weatherOptIn) return answer({ phase: "off" });
        const result = await weatherSource.getTripWeather(heroId);
        // A 200 with no stop, or only unavailable ones, has no weather in it: "unavailable", not a forecast (an opt-out
        // between the settings and the weather requests answers 200 with an empty list).
        if (result.kind !== "ready" || result.stops.every((stop) => stop.status !== "ok"))
          return answer({ phase: "unavailable" });
        const stops = heroTrip ? stopsOrDestination(heroTrip) : [];
        const today = getToday();
        // Skipped suggestions stay out of the count; if they cannot be read, nothing is skipped.
        const skipped = await Promise.resolve()
          .then(() => weatherSource.listSuggestions(heroId))
          .catch(() => []);
        answer({
          phase: "ready",
          city: cityWeather(stops, result.stops, settings.temperatureUnit, today),
          usual: usualRows(stops, result.stops, settings.temperatureUnit, today),
          review: {
            stops: result.stops,
            suppressed: Object.fromEntries(
              skipped
                .filter((entry) => entry.status === "skipped")
                .map((entry) => [entry.semanticId, entry.ruleSignature]),
            ),
          },
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
  // Whether the account has a home city, for the first-run nudge. Asked once, when the Home opens (not when the trips run
  // out, so no read lands in the middle of a later archive or remove). Unknown until answered, and a failed or missing answer
  // stays unknown: the nudge is a hint, so it never guesses.
  const [homeCityUnset, setHomeCityUnset] = useState(false);
  useEffect(() => {
    if (!source.homeCity) return;
    let cancelled = false;
    source
      .homeCity()
      .then((home) => {
        if (!cancelled) setHomeCityUnset(home === null);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [source]);
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
        // The server drew the maps for the trips as they were: ask for fresh ones now that something changed.
        router.refresh?.();
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
          setFocusTick((tick) => tick + 1);
        });
    },
    [track, getToday, router],
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

  /** Save the route from the Edit trip sheet; true once saved. The sheet shows its own failure message. */
  function saveRoute(id: string, stops: Parameters<typeof source.setStops>[1]): Promise<boolean> {
    return track(
      async () => {
        await source.setStops(id, stops);
        return source.load();
      },
      (next) => {
        setLoad({ phase: "ready", state: next, today: getToday() });
        router.refresh?.();
      },
    )
      .then(() => true)
      .catch(() => false);
  }

  /** Apply reviewed packing preferences from the Edit trip sheet (#203). STALE means the trip changed since the review. */
  function applyPreferences(
    id: string,
    config: Parameters<typeof source.updatePreferences>[1],
    basedOn: string | undefined,
  ): Promise<ApplyOutcome> {
    const before = state.trips.find((trip) => trip.id === id);
    return track(
      async () => {
        await source.updatePreferences(id, config, basedOn);
        return source.load();
      },
      (next) => {
        setLoad({ phase: "ready", state: next, today: getToday() });
        const after = next.trips.find((trip) => trip.id === id);
        toast.show(
          [
            "Preferences updated.",
            before?.ready ? "Ready turned off." : null,
            before?.toiletryBagPacked && after && !after.toiletryBagPacked
              ? "Toiletry bag placement reset."
              : null,
          ]
            .filter(Boolean)
            .join(" "),
        );
      },
    )
      .then((): ApplyOutcome => "ok")
      .catch(async (error: unknown): Promise<ApplyOutcome> => {
        if (!(error instanceof Error && error.message === "STALE")) return "failed";
        // The list moved on while it was being reviewed: show the current one, so reviewing again is about it.
        await source
          .load()
          .then((next) => setLoad({ phase: "ready", state: next, today: getToday() }))
          .catch(() => undefined);
        return "stale";
      });
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
  /** The server-drawn map for this trip, only while it still matches the route the trip has now. */
  const mapFor = (trip: LifecycleTrip) => {
    const drawn = maps?.[trip.id];
    const now = routeSignature(tripRoutePoints(trip), trip.travelMode);
    return drawn && drawn.signature === now ? drawn.node : null;
  };
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
              visible.map((trip) => (
                <TripCard
                  key={trip.id}
                  trip={trip}
                  view={tripCardView(trip, today, view)}
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
          {hero && laptop ? (
            <HomeLaptop
              trip={hero}
              later={departures.slice(1)}
              today={today}
              weather={weather}
              map={mapFor(hero)}
              busy={busy.has(hero.id)}
              onEdit={(id) => setEditing(id)}
              onArchive={archive}
              onRemove={setRemoving}
              onOpenArchive={() => setView("archive")}
              headingRef={headingRef}
            />
          ) : hero ? (
            <HomePhone
              trip={hero}
              later={departures.slice(1)}
              state={state}
              today={today}
              weather={weather}
              map={mapFor(hero)}
              busy={busy.has(hero.id)}
              onEdit={(id) => setEditing(id)}
              onArchive={archive}
              onRemove={setRemoving}
              onOpenArchive={() => setView("archive")}
              headingRef={headingRef}
            />
          ) : (
            <HomeEmpty
              model={noTripModel(state.trips, today)}
              laptop={laptop}
              homeCityUnset={homeCityUnset}
              hasHistory={
                state.deletedTrips.length > 0 || state.trips.some((trip) => trip.archived)
              }
              onOpenArchive={() => setView("archive")}
              headingRef={headingRef}
            />
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

      {editTarget ? (
        <EditTripSheet
          trip={editTarget}
          initialTab="route"
          onClose={() => setEditing(null)}
          onSaveRoute={(stops) => saveRoute(editTarget.id, stops)}
          onApplyPreferences={(config, basedOn) => applyPreferences(editTarget.id, config, basedOn)}
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
