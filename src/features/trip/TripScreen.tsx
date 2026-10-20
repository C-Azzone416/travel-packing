"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { DestinationArt } from "@/components/art/DestinationArt";
import { useSaveStatus } from "@/components/shell/SaveStatus";
import { Button, buttonClassName } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ModalSheet } from "@/components/ui/ModalSheet";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useToast } from "@/components/ui/Toast";
import type { Staple, TripItem } from "@/domain/trip";
import type { LifecycleTrip } from "@/domain/trip-lifecycle";
import { TripsSourceError, type TripChange } from "@/features/trips/trips-source";
import { useTripsSource } from "@/features/trips/TripsSourceProvider";
import { RouteText } from "@/features/trips/RouteText";
import { formatDays, formatRange, routeCities } from "@/features/trips/view";
import { AddToiletryForm } from "./AddToiletryForm";
import { themeFor } from "@/domain/themes";
import { EditRouteSheet } from "./EditRouteSheet";
import { ItemEditor } from "./ItemEditor";
import { PackRow } from "./PackRow";
import { PreferencesForm } from "./PreferencesForm";
import { ThemeSheet } from "./ThemeSheet";
import { ToiletrySection } from "./ToiletrySection";
import {
  bagGate,
  packedAnnouncement,
  progress,
  showReviewPrompt,
  showToiletries,
  tripSections,
  visibleItems,
  type PackFilter,
} from "./trip-view";
import { revocationReason } from "./review-view";
import { WeatherCard, WeatherDialog } from "./Weather";

/** Taps on a quantity stepper settle for this long before one write carries the final count. */
export const PACK_DEBOUNCE_MS = 300;

type Load =
  | { phase: "loading" }
  | { phase: "missing" }
  | { phase: "error" }
  | { phase: "ready"; trip: LifecycleTrip };
type Dialog =
  | null
  | { kind: "edit"; itemId: string }
  | { kind: "add-toiletry" }
  | { kind: "bag" }
  | { kind: "weather" }
  | { kind: "preferences" }
  | { kind: "theme" }
  | { kind: "route" };

interface ActOptions {
  /** The row this change is for, so a failure shows "Not saved · Retry" beside it. */
  row?: string;
  /** A change made from a dialog: its submit buttons wait for the source. */
  modal?: boolean;
  /** The change may have altered the owner's staples ("Remember for future trips"). */
  staples?: boolean;
  announce?: (change: TripChange) => string;
  after?: (change: TripChange) => void;
  /** The write failed: a dialog can say so itself, since the top-bar chip is out of reach behind it. */
  onFail?: () => void;
}

function ListSection({
  id,
  title,
  subtitle,
  items,
  filter,
  renderRow,
}: {
  id: string;
  title: string;
  subtitle: string;
  items: TripItem[];
  filter: PackFilter;
  renderRow: (item: TripItem) => ReactNode;
}) {
  const visible = visibleItems(items, filter);
  return (
    <section className="list-section" aria-labelledby={id}>
      <div className="list-section-head">
        <div>
          <h3 id={id}>{title}</h3>
          <div className="item-meta">{subtitle}</div>
        </div>
        <span className="tag">{visible.length}</span>
      </div>
      <div className="packing-list">
        {visible.length ? (
          visible.map(renderRow)
        ) : (
          <div className="empty-state">Nothing left in this section.</div>
        )}
      </div>
    </section>
  );
}

export function TripScreen({ tripId }: { tripId: string }) {
  const source = useTripsSource();
  const { track } = useSaveStatus();
  const toast = useToast();
  const [load, setLoad] = useState<Load>({ phase: "loading" });
  const [staples, setStaples] = useState<Staple[]>([]);
  const [reloads, setReloads] = useState(0);
  const [filter, setFilter] = useState<PackFilter>("all");
  const [dialog, setDialog] = useState<Dialog>(null);
  const [submitting, setSubmitting] = useState(false);
  const [failedRows, setFailedRows] = useState<ReadonlySet<string>>(new Set());
  const [announcement, setAnnouncement] = useState("");
  const [themeFailed, setThemeFailed] = useState(false);
  const [routeFailed, setRouteFailed] = useState(false);
  const bagPromptDismissed = useRef(false);
  // The last trip the server confirmed, so a change that takes the trip out of Ready can say so.
  const confirmed = useRef<LifecycleTrip | null>(null);
  const retries = useRef(
    new Map<string, { write: () => Promise<TripChange>; options: ActOptions }>(),
  );
  // Counts the user has tapped but the source has not confirmed yet. The row shows these straight away; one write
  // per item carries the latest, and writes for the same item are sent one after another.
  const [tapped, setTapped] = useState<Readonly<Record<string, number>>>({});
  const tappedRef = useRef<Record<string, number>>({});
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const chains = useRef(new Map<string, Promise<void>>());

  useEffect(() => {
    let cancelled = false;
    // Opening a trip is a read: it never shows "Saving…", but a failure shows Error and Retry.
    track(
      () => Promise.all([source.getTrip(tripId), source.listStaples()]),
      ([trip, owned]) => {
        if (cancelled) return;
        setStaples(owned);
        confirmed.current = trip;
        setLoad({ phase: "ready", trip });
      },
      { read: true },
    ).catch((error: unknown) => {
      if (!cancelled)
        setLoad({
          phase:
            // A malformed id (INVALID_INPUT) can't be a trip either, so it reads the same as a missing one.
            error instanceof TripsSourceError &&
            (error.message === "NOT_FOUND" || error.message === "INVALID_INPUT")
              ? "missing"
              : "error",
        });
    });
    return () => {
      cancelled = true;
    };
  }, [source, track, tripId, reloads]);

  const act = useCallback(
    (write: () => Promise<TripChange>, options: ActOptions = {}): Promise<void> => {
      if (options.modal) setSubmitting(true);
      return track(write, (change) => {
        const reason = confirmed.current ? revocationReason(confirmed.current, change.trip) : null;
        confirmed.current = change.trip;
        setLoad({ phase: "ready", trip: change.trip });
        if (reason) toast.show(`No longer ready: ${reason}`);
        if (options.row) {
          retries.current.delete(options.row);
          setFailedRows((current) => new Set([...current].filter((id) => id !== options.row)));
        }
        if (change.signals.promptBagPlacement && !bagPromptDismissed.current)
          setDialog({ kind: "bag" });
        if (options.announce) setAnnouncement(options.announce(change));
        if (options.staples) void source.listStaples().then(setStaples);
        options.after?.(change);
      })
        .then(() => undefined)
        .catch(() => {
          options.onFail?.();
          if (!options.row) return;
          const row = options.row;
          retries.current.set(row, { write, options });
          setFailedRows((current) => new Set(current).add(row));
        })
        .finally(() => setSubmitting(false));
    },
    [source, toast, track],
  );

  const settle = useCallback((id: string, value: number) => {
    // A newer tap while this write was in flight keeps its own count on screen.
    if (tappedRef.current[id] !== value) return;
    const rest = { ...tappedRef.current };
    delete rest[id];
    tappedRef.current = rest;
    setTapped(rest);
  }, []);

  // Sends the item's latest tapped count. Writes for one item queue behind each other; the value is read when the
  // write starts (and again on Retry), so a retry never re-sends a stale count.
  const flush = useCallback(
    (id: string) => {
      const timer = timers.current.get(id);
      if (timer) clearTimeout(timer);
      timers.current.delete(id);
      if (tappedRef.current[id] === undefined) return;
      const sent = { value: tappedRef.current[id] };
      const write = () => {
        sent.value = tappedRef.current[id] ?? sent.value;
        return source.setPacked(tripId, id, sent.value);
      };
      const queued = (chains.current.get(id) ?? Promise.resolve()).then(() =>
        act(write, { row: id, after: () => settle(id, sent.value) }),
      );
      chains.current.set(id, queued);
    },
    [act, settle, source, tripId],
  );

  const setCount = useCallback(
    (item: TripItem, count: number, delay: number) => {
      tappedRef.current = { ...tappedRef.current, [item.id]: count };
      setTapped(tappedRef.current);
      setAnnouncement(packedAnnouncement({ ...item, packed: count }));
      const pending = timers.current.get(item.id);
      if (pending) clearTimeout(pending);
      if (delay === 0) flush(item.id);
      else
        timers.current.set(
          item.id,
          setTimeout(() => flush(item.id), delay),
        );
    },
    [flush],
  );

  // Leaving the screen sends whatever has been tapped but not yet sent.
  useEffect(() => {
    const waiting = timers.current;
    return () => {
      for (const id of [...waiting.keys()]) flush(id);
    };
  }, [flush]);

  const close = () => setDialog(null);

  if (load.phase === "loading") {
    return (
      <section className="screen" aria-busy="true" aria-label="Loading trip">
        <h1>Packing list</h1>
      </section>
    );
  }

  if (load.phase === "missing") {
    return (
      <section className="screen">
        <h1>That trip isn’t available</h1>
        <p className="lede">It may have been removed. Your other trips are untouched.</p>
        <Link className={buttonClassName()} href="/">
          Back to trips
        </Link>
      </section>
    );
  }

  if (load.phase === "error") {
    return (
      <section className="screen">
        <h1>Packing list</h1>
        <div className="empty-state">
          <strong>Couldn’t load this trip.</strong>
          <p className="muted">Nothing was changed.</p>
          <Button
            onClick={() => {
              setLoad({ phase: "loading" });
              setReloads((count) => count + 1);
            }}
          >
            Try again
          </Button>
        </div>
      </section>
    );
  }

  const trip: LifecycleTrip = {
    ...load.trip,
    items: load.trip.items.map((entry) =>
      tapped[entry.id] === undefined ? entry : { ...entry, packed: tapped[entry.id] },
    ),
  };
  const sections = tripSections(trip);
  const gate = bagGate(trip);
  const totals = progress(trip);
  const place = trip.location
    ? [trip.location.region, trip.location.country].filter(Boolean).join(", ")
    : "";
  const editing =
    dialog?.kind === "edit" ? trip.items.find((entry) => entry.id === dialog.itemId) : undefined;

  const row = (item: TripItem) => (
    <PackRow
      key={item.id}
      item={item}
      failed={failedRows.has(item.id)}
      onToggle={() => setCount(item, item.packed >= item.qty ? 0 : item.qty, 0)}
      onIncrement={() => setCount(item, Math.min(item.qty, item.packed + 1), PACK_DEBOUNCE_MS)}
      onDecrement={() => setCount(item, Math.max(0, item.packed - 1), PACK_DEBOUNCE_MS)}
      onEdit={(id) => setDialog({ kind: "edit", itemId: id })}
      onRetry={(id) => {
        // The retry button only renders while a failure is recorded for this row.
        const failed = retries.current.get(id) as {
          write: () => Promise<TripChange>;
          options: ActOptions;
        };
        void act(failed.write, failed.options);
      }}
    />
  );

  return (
    <section className="screen">
      <div className="destination-trip-head">
        <DestinationArt theme={trip.theme} variant="header" priority />
        <div className="destination-head-content">
          <Link className="back" href="/" aria-label="Back to trips">
            ←
          </Link>
          <div className="head-copy destination-head-copy">
            <h1>{trip.destination}</h1>
            {routeCities(trip).length ? (
              <p className="route-chip">
                <RouteText cities={routeCities(trip)} budget={64} />
              </p>
            ) : null}
            <p>
              {place ? `${place} · ` : ""}
              {formatRange(trip)} · {formatDays(trip.days)}
            </p>
            <Button
              variant="secondary"
              small
              className="edit-route"
              onClick={() => setDialog({ kind: "route" })}
            >
              Edit route
            </Button>
          </div>
          {trip.ready ? (
            <StatusBadge status="ready">Ready</StatusBadge>
          ) : (
            <StatusBadge status="draft">Packing</StatusBadge>
          )}
          <Button
            variant="secondary"
            small
            className="change-theme"
            onClick={() => setDialog({ kind: "theme" })}
          >
            Change theme
          </Button>
        </div>
      </div>

      <p className="sr-only" role="status" aria-label="Packing updates">
        {announcement}
      </p>

      <div className="trip-layout">
        <div>
          <Card padded>
            <div className="section-head packing-head">
              <div>
                <h2>Packing list</h2>
                <p className="tiny muted">Partial quantities count as progress.</p>
              </div>
              <strong>{totals.percent}%</strong>
            </div>
            <div
              className="progress-track"
              role="progressbar"
              aria-label="Packing progress"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={totals.percent}
              aria-valuetext={`${totals.percent}% packed`}
            >
              <span style={{ width: `${totals.percent}%` }} />
            </div>
            <div className="filters" role="group" aria-label="Packing list filters">
              <button
                type="button"
                className={filter === "all" ? "filter active" : "filter"}
                aria-pressed={filter === "all"}
                onClick={() => setFilter("all")}
              >
                All
              </button>
              <button
                type="button"
                className={filter === "still" ? "filter active" : "filter"}
                aria-pressed={filter === "still"}
                onClick={() => setFilter("still")}
              >
                Still to pack
              </button>
            </div>

            <ListSection
              id="section-main"
              title="Everyday & occasion items"
              subtitle={`${sections.main.length} loose items`}
              items={sections.main}
              filter={filter}
              renderRow={row}
            />
            {showToiletries(trip, filter) ? (
              <ToiletrySection
                tripId={tripId}
                items={sections.toiletries}
                gate={gate}
                filter={filter}
                renderRow={row}
                onPlaceBag={() => setDialog({ kind: "bag" })}
                onUndoBag={() => void act(() => source.undoBagPlacement(tripId))}
                onAddItem={() => setDialog({ kind: "add-toiletry" })}
              />
            ) : null}
            {sections.returns.length ? (
              <ListSection
                id="section-return"
                title="Return travel outfit"
                subtitle="Fresh set kept separate from everyday counts"
                items={sections.returns}
                filter={filter}
                renderRow={row}
              />
            ) : null}
            {sections.packLast.length ? (
              <ListSection
                id="section-packlast"
                title="Pack last"
                subtitle="A timing view: items flagged Pack last. Bathroom items flagged Pack last stay in Toiletries."
                items={sections.packLast}
                filter={filter}
                renderRow={row}
              />
            ) : null}

            {showReviewPrompt(trip) ? (
              <div className="review-prompt">
                <h3>Everything is checked. Want to review?</h3>
                <p>
                  We will show the full bag, including Pack last and the return outfit, before you
                  decide it is ready.
                </p>
                <Link
                  className={buttonClassName({ variant: "secondary" })}
                  href={`/trips/${tripId}/review`}
                >
                  Review your bag
                </Link>
              </div>
            ) : null}
          </Card>
        </div>

        <aside className="side">
          {trip.ready ? (
            <Card padded className="ready-card">
              <p className="eyebrow">Confirmed after review</p>
              <h2>You’re ready to go.</h2>
              <p>
                You can still correct anything below. Any checklist change will revoke Ready, or you
                can mark the trip not ready without changing packing progress.
              </p>
              <div className="actions">
                <Link
                  className={buttonClassName({ variant: "secondary", small: true })}
                  href={`/trips/${tripId}/review`}
                >
                  Review bag again
                </Link>
                <Button
                  className="ready-secondary"
                  small
                  onClick={() =>
                    void act(() => source.markNotReady(tripId), {
                      after: () => toast.show("Progress kept."),
                    })
                  }
                >
                  Mark as not ready
                </Button>
              </div>
            </Card>
          ) : null}
          <WeatherCard
            weather={trip.weather}
            onReview={() => setDialog({ kind: "weather" })}
            onReviewAgain={() =>
              void act(() => source.reviewWeatherAgain(tripId), {
                after: () => setDialog({ kind: "weather" }),
              })
            }
          />
          <Card padded>
            <h3>Trip math</h3>
            <p className="tiny muted">
              {formatDays(trip.days)} − outbound worn − return outfit ={" "}
              <strong>{trip.dailyDays} everyday days</strong>.
            </p>
            <Button variant="ghost" small onClick={() => setDialog({ kind: "preferences" })}>
              Edit preferences
            </Button>
          </Card>
        </aside>
      </div>

      {editing ? (
        <ItemEditor
          key={editing.id}
          item={editing}
          destination={trip.destination}
          dailyDays={trip.dailyDays}
          staples={staples}
          saving={submitting}
          onClose={close}
          onSave={(edit) =>
            void act(() => source.editItem(tripId, editing.id, edit), {
              modal: true,
              staples: edit.scope === "remember",
              after: close,
            })
          }
          onRemove={(scope) =>
            void act(() => source.removeItem(tripId, editing.id, scope), {
              modal: true,
              staples: scope === "remember",
              after: close,
            })
          }
        />
      ) : null}
      {dialog?.kind === "add-toiletry" ? (
        <AddToiletryForm
          destination={trip.destination}
          saving={submitting}
          onClose={close}
          onAdd={(item) =>
            void act(() => source.addToiletryItem(tripId, item), {
              modal: true,
              staples: item.scope === "remember",
              after: close,
            })
          }
        />
      ) : null}
      {dialog?.kind === "preferences" ? (
        <PreferencesForm
          config={trip.config}
          saving={submitting}
          onClose={close}
          onSave={(config) =>
            void act(() => source.updatePreferences(tripId, config), { modal: true, after: close })
          }
        />
      ) : null}
      {dialog?.kind === "theme" ? (
        <ThemeSheet
          current={trip.theme}
          saving={submitting}
          failed={themeFailed}
          onClose={() => {
            setThemeFailed(false);
            close();
          }}
          onSave={(theme) => {
            setThemeFailed(false);
            void act(() => source.setTheme(tripId, theme), {
              modal: true,
              onFail: () => setThemeFailed(true),
              announce: (change) => `Theme changed to ${themeFor(change.trip.theme).label}.`,
              after: close,
            });
          }}
        />
      ) : null}
      {dialog?.kind === "route" ? (
        <EditRouteSheet
          stops={trip.stops}
          saving={submitting}
          failed={routeFailed}
          onClose={() => {
            setRouteFailed(false);
            close();
          }}
          onSave={(stops) => {
            setRouteFailed(false);
            void act(() => source.setStops(tripId, stops), {
              modal: true,
              onFail: () => setRouteFailed(true),
              announce: () => "Route updated.",
              after: close,
            });
          }}
        />
      ) : null}
      {dialog?.kind === "weather" ? (
        <WeatherDialog
          suggestion={trip.weather.suggestion}
          ready={trip.ready}
          saving={submitting}
          onClose={close}
          onAccept={() =>
            void act(() => source.acceptWeather(tripId), { modal: true, after: close })
          }
          onSkip={() => void act(() => source.skipWeather(tripId), { modal: true, after: close })}
        />
      ) : null}
      <ModalSheet
        open={dialog?.kind === "bag"}
        title="Toiletry bag in suitcase?"
        description="A separate bag-placement step."
        onClose={() => {
          bagPromptDismissed.current = true;
          close();
        }}
        actions={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                bagPromptDismissed.current = true;
                close();
              }}
            >
              Not yet
            </Button>
            <Button
              onClick={() => void act(() => source.confirmBagPlacement(tripId), { after: close })}
            >
              Confirm
            </Button>
          </>
        }
      >
        <p>All Bathroom items are checked. Is the completed toiletry bag in the suitcase?</p>
      </ModalSheet>
    </section>
  );
}
