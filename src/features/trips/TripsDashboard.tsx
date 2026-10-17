"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button, buttonClassName } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ModalSheet } from "@/components/ui/ModalSheet";
import { useToast } from "@/components/ui/Toast";
import { useSaveStatus } from "@/components/shell/SaveStatus";
import { pastAndArchivedTrips, upcomingTrips, type LifecycleState } from "@/domain/trip-lifecycle";
import { localToday } from "@/lib/today";
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

  useEffect(() => {
    let cancelled = false;
    track(() => source.load())
      .then((state) => {
        if (!cancelled) setLoad({ phase: "ready", state, today: getToday() });
      })
      .catch(() => {
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

  // Run a write for one trip. Nothing is removed or changed on screen until the source confirms.
  const run = useCallback(
    async (id: string, write: () => Promise<LifecycleState>): Promise<boolean> => {
      setBusy((current) => new Set(current).add(id));
      try {
        const state = await track(write);
        setLoad((current) => (current.phase === "ready" ? { ...current, state } : current));
        return true;
      } catch {
        return false;
      } finally {
        setBusy((current) => {
          const next = new Set(current);
          next.delete(id);
          return next;
        });
        headingRef.current?.focus();
      }
    },
    [track],
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
          New trip
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

  async function confirmRemove(id: string) {
    const trip = state.trips.find((entry) => entry.id === id);
    setRemoving(null);
    if (!trip) return;
    const ok = await run(id, () => source.remove(id));
    if (!ok) return;
    toast.show(`${trip.destination} removed`, {
      action: {
        label: "Undo",
        onAction: () => {
          void run(id, () => source.undoRemove(id)).then((restored) => {
            if (restored) toast.show(`${trip.destination} restored`);
          });
        },
      },
    });
  }

  return (
    <section className="screen">
      {archiveView ? (
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
      ) : (
        <div className="hero">
          <div className="hero-art" aria-hidden="true">
            <div className="sun" />
            <div className="hill one" />
            <div className="hill two" />
          </div>
          <div className="hero-copy">
            <p className="eyebrow">Less remembering. More ready.</p>
            <h1>Pack for the trip, not the anxiety.</h1>
            <p>
              Create a personal list that accounts for your travel days, return outfit, laundry
              plans, and the things you pack last.
            </p>
            <div className="actions">
              <Link className={buttonClassName()} href="/trips/new">
                ＋ New trip
              </Link>
            </div>
          </div>
        </div>
      )}

      <div className="section-head">
        <div>
          <p className="eyebrow">Your trips</p>
          <h2 ref={headingRef} tabIndex={-1}>
            {archiveView ? "Trip history" : "Where are we going?"}
          </h2>
        </div>
      </div>
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

      <div className="card-grid">
        {visible.length === 0 ? (
          <div className="empty-state">
            <strong>{archiveView ? "No past or archived trips yet." : "No upcoming trips."}</strong>
            <br />
            {archiveView
              ? "Archived trips and trips whose return date has passed will appear here."
              : "Create a trip or restore one from Past & archive."}
          </div>
        ) : (
          visible.map((trip, index) => (
            <TripCard
              key={trip.id}
              trip={trip}
              view={tripCardView(trip, today, view)}
              first={index === 0}
              busy={busy.has(trip.id)}
              onArchive={(id) => void run(id, () => source.archive(id))}
              onRestore={(id) => void run(id, () => source.restore(id))}
              onRemove={setRemoving}
            />
          ))
        )}
      </div>

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

      <ModalSheet
        open={removeTarget !== null}
        title={removeTarget ? `Remove ${removeTarget.destination}?` : "Remove trip"}
        description="It moves to Recently deleted in Past & archive, where you can undo it. Nothing about your list changes."
        onClose={() => setRemoving(null)}
        actions={
          <>
            <Button variant="secondary" onClick={() => setRemoving(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => removeTarget && void confirmRemove(removeTarget.id)}
            >
              Remove trip
            </Button>
          </>
        }
      >
        {null}
      </ModalSheet>
    </section>
  );
}
