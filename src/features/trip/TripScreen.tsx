"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
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
import { diffRecommendations, type WeatherChange } from "@/domain/weather/diff";
import { weatherGuidance, type ItemGuidance } from "@/domain/weather/guidance";
import { recommendPacking } from "@/domain/weather/recommend";
import {
  TripsSourceError,
  type NewCustomItem,
  type TripChange,
} from "@/features/trips/trips-source";
import { useTripsSource } from "@/features/trips/TripsSourceProvider";
import { tripMathLine } from "@/features/trips/count-copy";
import { RouteText } from "@/features/trips/RouteText";
import { formatDays, formatRange, routeCities, routeIsTitle } from "@/features/trips/view";
import { AddToiletryForm } from "./AddToiletryForm";
import { Stamps } from "@/components/stamp/Stamp";
import { themeFor } from "@/domain/themes";
import { selectStamps } from "@/domain/stamps";
import { daysBetween } from "@/domain/trip-stops";
import { localToday } from "@/lib/today";
import { AddItemInline } from "./AddItemInline";
import { SaveAsListSheet, type SaveOutcome } from "./SaveAsListSheet";
import { EditRouteSheet } from "./EditRouteSheet";
import { ItemEditor } from "./ItemEditor";
import { PackRow } from "./PackRow";
import { PreferencesForm } from "./PreferencesForm";
import { ThemeSheet } from "./ThemeSheet";
import { ToiletrySection } from "./ToiletrySection";
import {
  bagGate,
  completeCount,
  leavesEyebrow,
  packedAnnouncement,
  progress,
  sectionLinks,
  showReviewPrompt,
  showToiletries,
  tripSections,
  visibleItems,
  type PackFilter,
} from "./trip-view";
import { revocationReason } from "./review-view";
import { ReviewSheet } from "./ReviewSheet";
import { SHOW_TRIP_PICTURE } from "./hero-picture";
import { WeatherPanel, WeatherReviewBanner, type WeatherPanelState } from "./WeatherPanel";
import type { WeatherSettings, WeatherSuggestionState } from "@/server/data/weather-store";

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
  | { kind: "add-toiletry"; name?: string; qty?: number }
  | { kind: "save-list" }
  | { kind: "bag" }
  | { kind: "preferences" }
  | { kind: "theme" }
  | { kind: "route" };

interface WeatherExperience {
  settings: WeatherSettings;
  panel: WeatherPanelState;
  suggestions: WeatherSuggestionState[];
}

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
    <section id={id.replace("section-", "block-")} className="list-section" aria-labelledby={id}>
      <div className="list-section-head">
        <h3 id={id}>{title}</h3>
        <span className="list-section-count">
          {completeCount(items)} of {items.length} complete
        </span>
      </div>
      <p className="item-meta list-section-sub">{subtitle}</p>
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

export function TripScreen({ tripId, openItemId }: { tripId: string; openItemId?: string }) {
  const source = useTripsSource();
  const router = useRouter();
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
  const [weather, setWeather] = useState<WeatherExperience | null>(null);
  const [weatherReviewOpen, setWeatherReviewOpen] = useState(false);
  const [weatherReviewError, setWeatherReviewError] = useState(false);
  const weatherRequest = useRef(0);
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

  const loadWeather = useCallback(
    async (trip: LifecycleTrip, knownSettings?: WeatherSettings) => {
      const weatherSource = source.weather;
      if (!weatherSource) {
        setWeather(null);
        return;
      }
      const request = ++weatherRequest.current;
      try {
        const [settings, suggestions] = await Promise.all([
          knownSettings ?? weatherSource.getSettings(),
          weatherSource.listSuggestions(trip.id),
        ]);
        if (request !== weatherRequest.current) return;
        if (!settings.weatherOptIn) {
          setWeather({
            settings,
            panel: { kind: trip.weather.status === "pending" ? "prompt" : "off" },
            suggestions,
          });
          return;
        }
        setWeather({ settings, panel: { kind: "loading" }, suggestions });
        const result = await weatherSource.getTripWeather(trip.id);
        if (request !== weatherRequest.current) return;
        if (result.kind === "offline") {
          setWeather({ settings, panel: { kind: "offline" }, suggestions });
          return;
        }
        setWeather({
          settings,
          panel:
            result.kind === "ready"
              ? { kind: "ready", stops: result.stops }
              : {
                  kind: "ready",
                  stops: trip.stops.map((_, stopIndex) => ({
                    stopIndex,
                    status: "unavailable" as const,
                    days: [],
                  })),
                },
          suggestions,
        });
      } catch {
        if (request !== weatherRequest.current) return;
        setWeather(null);
      }
    },
    [source],
  );

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
        void loadWeather(trip);
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
  }, [loadWeather, source, track, tripId, reloads]);

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

  /** The inline "＋ Add item": resolves true when the source saved it, so the form can fold away. */
  const addCustomItem = (item: NewCustomItem): Promise<boolean> =>
    new Promise((resolve) => {
      void act(() => source.addItem(tripId, item), {
        announce: () => `${item.name.trim()} added to ${item.category}.`,
        after: () => resolve(true),
        onFail: () => resolve(false),
      });
    });

  /** Save the chosen items as a new saved list (#169); the trip itself is not changed. */
  const saveList = async (name: string, itemIds: string[]): Promise<SaveOutcome> => {
    let outcome: SaveOutcome = { ok: true };
    let created: Awaited<ReturnType<typeof source.saveAsList>> | null = null;
    try {
      await track(async () => {
        try {
          created = await source.saveAsList(tripId, name, itemIds);
        } catch (error) {
          if (error instanceof TripsSourceError && error.message === "NAME_TAKEN") {
            outcome = { ok: false, reason: "NAME_TAKEN" };
            return;
          }
          throw error;
        }
      });
    } catch {
      return { ok: false, reason: "FAILED" };
    }
    if (created) {
      const list: { name: string; itemCount: number } = created;
      setDialog(null);
      toast.show(
        `“${list.name}” saved (${list.itemCount} ${list.itemCount === 1 ? "item" : "items"}).`,
        {
          action: { label: "View lists", onAction: () => router.push("/staples/lists") },
        },
      );
    }
    return outcome;
  };

  // "Edit quantity" on the dashboard arrives with ?edit=<item id>: once the trip has loaded, that item's editor opens
  // (once), the URL goes back to the plain trip, and closing the editor puts focus on that item's row.
  const urlItem = useRef(openItemId);
  const returnFocusTo = useRef<string | null>(null);
  useEffect(() => {
    if (load.phase !== "ready" || !urlItem.current) return;
    const itemId = urlItem.current;
    urlItem.current = undefined;
    window.history.replaceState(null, "", `/trips/${tripId}`);
    if (load.trip.items.some((entry) => entry.id === itemId)) {
      returnFocusTo.current = itemId;
      setDialog({ kind: "edit", itemId });
    }
  }, [load, tripId]);

  // After the editor opened from ?edit= closes (Escape, ×, Save or Remove), focus goes to that item's Edit target, or to
  // the list heading when the item is gone. It waits for the commit that removes the sheet and updates the row (a save
  // re-renders the row after the write finishes), so it is an effect, not a timer.
  const [focusAfterClose, setFocusAfterClose] = useState<string | null>(null);
  useEffect(() => {
    if (!focusAfterClose || dialog || load.phase !== "ready") return;
    const row = document.querySelector<HTMLElement>(
      `[data-item-id="${focusAfterClose.replaceAll('"', '\\"')}"]`,
    );
    (
      row?.querySelector<HTMLElement>(".edit-target") ??
      document.getElementById("packing-list-heading")
    )?.focus();
    setFocusAfterClose(null);
  }, [focusAfterClose, dialog, load]);

  const close = () => {
    setDialog(null);
    const itemId = returnFocusTo.current;
    returnFocusTo.current = null;
    // The sheet has no opener to give focus back to, so the screen puts it somewhere sensible itself.
    if (itemId) setFocusAfterClose(itemId);
  };

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
  const weatherStops = trip.stops ?? [];
  const weatherDays =
    weather?.panel.kind === "ready" ? weather.panel.stops.flatMap((stop) => stop.days) : [];
  const weatherRecommendation = recommendPacking({
    days: weatherDays,
    dayStopNames: weatherStops.map((stop) => stop.location.city),
    config: { ...trip.config, start: trip.start, end: trip.end },
    theme: trip.theme,
  });
  const suppressedWeather = Object.fromEntries(
    (weather?.suggestions ?? [])
      .filter((suggestion) => suggestion.status === "skipped")
      .map((suggestion) => [suggestion.semanticId, suggestion.ruleSignature]),
  );
  // Without a usable day (every stop unavailable) there is nothing to recommend: the list stays as it is.
  const weatherChanges =
    weather?.panel.kind === "ready" && weatherDays.length > 0
      ? diffRecommendations(trip.items, weatherRecommendation, suppressedWeather)
      : [];

  // Pills only while weather is on and the forecast is usable; a stale item loses its pill when the forecast moves.
  const guidance =
    weather?.panel.kind === "ready" && weatherDays.length > 0
      ? weatherGuidance(
          trip.items.map((entry) => entry.id),
          weatherRecommendation,
        )
      : new Map<string, ItemGuidance>();

  // The forecast strip lives inside the hero; the opt-in prompt and the "weather is off" line stay below it.
  const weatherEmbedded =
    weather !== null && weather.panel.kind !== "prompt" && weather.panel.kind !== "off";

  const setWeatherOptIn = async (weatherOptIn: boolean) => {
    if (!source.weather || !weather) return;
    try {
      const settings = await source.weather.updateSettings({ weatherOptIn });
      if (!weatherOptIn) {
        setWeather({ ...weather, settings, panel: { kind: "off" } });
        await act(() => source.skipWeather(tripId));
        return;
      }
      await loadWeather(trip, settings);
    } catch {
      toast.show("Couldn’t update weather. Nothing was changed.");
    }
  };

  const applyWeatherReview = (selected: WeatherChange[], skipped: WeatherChange[]) => {
    if (!source.weather) return;
    setWeatherReviewError(false);
    void act(
      () =>
        source.weather!.applyReview(
          tripId,
          selected.map((change) => {
            if (change.kind === "add") {
              const { semanticId, name, category, qty, optional, groupId } = change.item;
              return {
                kind: "add" as const,
                semanticId: change.semanticId,
                ruleSignature: change.ruleSignature,
                item: {
                  semanticId,
                  name,
                  category,
                  qty,
                  optional,
                  ...(groupId ? { groupId } : {}),
                },
              };
            }
            if (change.kind === "split") {
              return {
                kind: "split" as const,
                semanticId: change.semanticId,
                ruleSignature: change.ruleSignature,
                clothing: change.clothing,
              };
            }
            return {
              kind: "remove" as const,
              semanticId: change.semanticId,
              ruleSignature: change.ruleSignature,
            };
          }),
          skipped.map((change) => ({
            semanticId: change.semanticId,
            ruleSignature: change.ruleSignature,
          })),
        ),
      {
        modal: true,
        onFail: () => setWeatherReviewError(true),
        after: (change) => {
          setWeatherReviewOpen(false);
          toast.show("Packing list updated for the weather.");
          void loadWeather(change.trip);
        },
      },
    );
  };

  const row = (item: TripItem) => (
    <PackRow
      key={item.id}
      item={item}
      failed={failedRows.has(item.id)}
      guidance={guidance.get(item.id)}
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
      <section
        className="trip-hero"
        data-picture={SHOW_TRIP_PICTURE ? "on" : "off"}
        aria-labelledby="trip-title"
      >
        <div className="hero-picture" aria-hidden="true">
          <DestinationArt theme={trip.theme} variant="header" priority />
        </div>
        <Link className="back-link" href="/">
          <span aria-hidden="true">←</span> All trips
        </Link>
        <div className="trip-hero-main">
          <div className="trip-hero-copy">
            <p className="eyebrow hero-eyebrow">
              {leavesEyebrow(daysBetween(localToday(), trip.start))}
            </p>
            <h1 id="trip-title">{trip.destination}</h1>
            {routeCities(trip).length && !routeIsTitle(trip) ? (
              <p className="route-chip">
                <RouteText cities={routeCities(trip)} budget={64} />
              </p>
            ) : null}
            <p className="trip-hero-dates">
              {place ? `${place} · ` : ""}
              {formatRange(trip)} · {formatDays(trip.days)}
            </p>
            <div className="head-actions">
              <Button
                variant="secondary"
                small
                className="edit-route"
                onClick={() => setDialog({ kind: "route" })}
              >
                Edit route
              </Button>
              <Button
                variant="secondary"
                small
                className="change-theme"
                onClick={() => setDialog({ kind: "theme" })}
              >
                Change theme
              </Button>
              <Button
                variant="secondary"
                small
                className="save-as-list"
                onClick={() => setDialog({ kind: "save-list" })}
              >
                Save as a list
              </Button>
            </div>
          </div>
          <div className="hero-stamps">
            <Stamps
              stamps={selectStamps(trip.stops)}
              departure={trip.start}
              onPicture={SHOW_TRIP_PICTURE}
            />
          </div>
        </div>
        {trip.ready ? <StatusBadge status="ready">Ready</StatusBadge> : null}
        {weather && weatherStops.length > 0 && weatherEmbedded ? (
          <WeatherPanel
            embedded
            stops={weatherStops}
            state={weather.panel}
            unit={weather.settings.temperatureUnit}
            changesCount={weatherChanges.length}
            onOptIn={() => void setWeatherOptIn(true)}
            onDecline={() => void setWeatherOptIn(false)}
            onTurnOn={() => void setWeatherOptIn(true)}
            onRefresh={() => void loadWeather(trip, weather.settings)}
            onReview={() => {
              setWeatherReviewError(false);
              setWeatherReviewOpen(true);
            }}
          />
        ) : null}
      </section>

      <p className="sr-only" role="status" aria-label="Packing updates">
        {announcement}
      </p>

      {weather && weatherStops.length > 0 && !weatherEmbedded ? (
        <WeatherPanel
          stops={weatherStops}
          state={weather.panel}
          unit={weather.settings.temperatureUnit}
          changesCount={weatherChanges.length}
          onOptIn={() => void setWeatherOptIn(true)}
          onDecline={() => void setWeatherOptIn(false)}
          onTurnOn={() => void setWeatherOptIn(true)}
          onRefresh={() => void loadWeather(trip, weather.settings)}
          onReview={() => {
            setWeatherReviewError(false);
            setWeatherReviewOpen(true);
          }}
        />
      ) : null}
      {weather && weatherEmbedded ? (
        <WeatherReviewBanner
          changesCount={weatherChanges.length}
          onReview={() => {
            setWeatherReviewError(false);
            setWeatherReviewOpen(true);
          }}
        />
      ) : null}

      <div className="packing-top">
        <div className="packing-progress">
          <h2 id="packing-list-heading" className="sr-only" tabIndex={-1}>
            Packing list
          </h2>
          <p className="progress-line">
            {totals.packed} of {totals.total} packed
            {totals.total - totals.packed > 0 ? ` / ${totals.total - totals.packed} left` : ""}
          </p>
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
        </div>
        <div className="filters" role="group" aria-label="Packing list filters">
          <button
            type="button"
            className={filter === "all" ? "filter active" : "filter"}
            aria-pressed={filter === "all"}
            onClick={() => setFilter("all")}
          >
            All items
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
      </div>

      <div className="trip-layout">
        <div>
          <div className="packing-panel">
            <AddItemInline
              items={trip.items}
              busy={submitting}
              onAdd={addCustomItem}
              onBathroom={(name, qty) => setDialog({ kind: "add-toiletry", name, qty })}
              onEditExisting={(itemId) => setDialog({ kind: "edit", itemId })}
            />
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
          </div>
        </div>

        <aside className="side">
          <nav className="sections-panel" aria-label="Packing sections">
            <h3>Packing sections</h3>
            <ul>
              {sectionLinks(sections, showToiletries(trip, filter)).map((link) => (
                <li key={link.target}>
                  <a href={`#${link.target}`}>{link.label}</a>
                </li>
              ))}
            </ul>
            <p className="tiny muted">Jump to a section of the list.</p>
          </nav>
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
          <Card padded>
            <h3>Trip math</h3>
            <p className="tiny muted">
              {tripMathLine(trip.days, trip.dailyDays, trip.config.returnOutfit)}
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
      {dialog?.kind === "save-list" ? (
        <SaveAsListSheet
          tripName={trip.destination}
          items={trip.items}
          onSave={saveList}
          onClose={close}
        />
      ) : null}
      {dialog?.kind === "add-toiletry" ? (
        <AddToiletryForm
          destination={trip.destination}
          initialName={dialog.name}
          initialQty={dialog.qty}
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
              after: (change) => {
                close();
                // New stops and dates are a new question for the weather service.
                void loadWeather(change.trip, weather?.settings);
              },
            });
          }}
        />
      ) : null}
      <ReviewSheet
        open={weatherReviewOpen}
        changes={weatherChanges}
        ready={trip.ready}
        saving={submitting}
        error={weatherReviewError}
        legacyPacked={trip.items.some(
          (item) => (item.id === "tops" || item.id === "bottoms") && item.packed > 0,
        )}
        onClose={() => setWeatherReviewOpen(false)}
        onApply={applyWeatherReview}
        onSkip={(changes) => applyWeatherReview([], changes)}
      />
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
