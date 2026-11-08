"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSaveStatus } from "@/components/shell/SaveStatus";
import { Button, buttonClassName } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ModalSheet } from "@/components/ui/ModalSheet";
import { useToast } from "@/components/ui/Toast";
import { CUBE_LABELS, itemCube, type Cube } from "@/domain/cubes";
import { findExistingItem } from "@/domain/item-ops";
import type { Staple, TripItem } from "@/domain/trip";
import type { LifecycleTrip } from "@/domain/trip-lifecycle";
import { diffRecommendations, type WeatherChange } from "@/domain/weather/diff";
import { recommendPacking } from "@/domain/weather/recommend";
import { TripsSourceError, type TripChange } from "@/features/trips/trips-source";
import { useTripsSource } from "@/features/trips/TripsSourceProvider";
import { AddToiletryForm } from "./AddToiletryForm";
import { automaticStamps } from "@/domain/stamps";
import { localToday } from "@/lib/today";
import { weatherForReview } from "./weather-remaining";
import { LAPTOP_MIN_WIDTH, useMinWidth } from "@/lib/use-min-width";
import { SaveAsListSheet, type SaveOutcome } from "./SaveAsListSheet";
import {
  EditTripSheet,
  type ApplyOutcome,
  type EditTripTab,
  type SaveResult,
} from "./EditTripSheet";
import { ItemEditor } from "./ItemEditor";
import { EditStampSheet } from "./EditStampSheet";
import { bagGate, packedAnnouncement, showReviewPrompt } from "./trip-view";
import { revocationReason } from "./review-view";
import { WeatherPanel, type WeatherPanelState } from "./WeatherPanel";
import { BagStep } from "./packing/BagStep";
import { ForecastSection } from "./packing/ForecastSection";
import { ForecastPhone } from "./packing/ForecastPhone";
import { PackingLaptop } from "./packing/PackingLaptop";
import { PackingPhone } from "./packing/PackingPhone";
import type { AddOutcome } from "./packing/CubePanel";
import {
  buildCubeViews,
  categoryForCube,
  isPacked,
  itemsLabel,
  toSuggestions,
  type CubeView,
  type Suggestion,
} from "./packing/packing-model";
import type { WeatherSettings, WeatherSuggestionState } from "@/server/data/weather-store";

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
  | { kind: "stamp" }
  | { kind: "trip"; tab: EditTripTab };

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
  onFail?: (error: unknown) => void;
}

export function TripScreen({
  tripId,
  openItemId,
  openCube,
}: {
  tripId: string;
  openItemId?: string;
  /** The cube the laptop Packing view opens first (?cube=, which the Home tiles link to). */
  openCube?: Cube;
}) {
  const source = useTripsSource();
  const router = useRouter();
  const { track } = useSaveStatus();
  const toast = useToast();
  const [load, setLoad] = useState<Load>({ phase: "loading" });
  const [staples, setStaples] = useState<Staple[]>([]);
  const [reloads, setReloads] = useState(0);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [submitting, setSubmitting] = useState(false);
  const [failedRows, setFailedRows] = useState<ReadonlySet<string>>(new Set());
  const [announcement, setAnnouncement] = useState("");
  const [stampFailed, setStampFailed] = useState(false);
  const [weather, setWeather] = useState<WeatherExperience | null>(null);
  const [laundryBusy, setLaundryBusy] = useState(false);
  const laptop = useMinWidth(LAPTOP_MIN_WIDTH);
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
        .catch((error: unknown) => {
          options.onFail?.(error);
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

  // A tick shows at once and is sent at once (one write per tick; writes for one item queue behind each other).
  const setCount = useCallback(
    (item: TripItem, count: number) => {
      tappedRef.current = { ...tappedRef.current, [item.id]: count };
      setTapped(tappedRef.current);
      setAnnouncement(packedAnnouncement({ ...item, packed: count }));
      flush(item.id);
    },
    [flush],
  );

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
  // the open cube's title when the item is gone. It waits for the commit that removes the sheet and updates the row (a save
  // re-renders the row after the write finishes), so it is an effect, not a timer.
  const focusAfterClose = useRef<string | null>(null);
  useEffect(() => {
    const itemId = focusAfterClose.current;
    if (!itemId || dialog || load.phase !== "ready") return;
    focusAfterClose.current = null;
    const row = document.querySelector<HTMLElement>(
      `[data-item-id="${itemId.replaceAll('"', '\\"')}"]`,
    );
    (
      row?.querySelector<HTMLElement>(".edit-target") ??
      row?.querySelector<HTMLElement>("input") ??
      document.querySelector<HTMLElement>("section[data-cube] h2")
    )?.focus();
  }, [dialog, load]);

  /** A failed save from the Edit trip sheet: STALE (the trip changed since the sheet was based on it) shows the current trip first. */
  function failedSave(error: unknown, resolve: (result: SaveResult) => void) {
    if (!(error instanceof Error && error.message === "STALE")) return resolve(null);
    void source
      .getTrip(tripId)
      .then((current) => {
        confirmed.current = current;
        setLoad({ phase: "ready", trip: current });
      })
      .catch(() => undefined)
      .finally(() => resolve("stale"));
  }

  const close = () => {
    setDialog(null);
    // The sheet has no opener to give focus back to, so the screen puts it somewhere sensible itself (above).
    focusAfterClose.current = returnFocusTo.current;
    returnFocusTo.current = null;
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
  const gate = bagGate(trip);
  const editing =
    dialog?.kind === "edit" ? trip.items.find((entry) => entry.id === dialog.itemId) : undefined;
  const weatherStops = trip.stops ?? [];
  // While the trip is on, only the days still ahead are reviewed: the same calculation the Home counts with (#410).
  const weatherDays =
    weather?.panel.kind === "ready"
      ? weatherForReview(trip, weatherStops, weather.panel.stops, localToday()).flatMap(
          (stop) => stop.days,
        )
      : [];
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

  const reviewWrite = (selected: WeatherChange[], skipped: WeatherChange[]) =>
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
    );

  // ---- the laptop Packing view's handlers (#385): each goes through `act`, so saves, retries and the save states are the
  // same as everywhere else on this screen.
  const cubeViews = buildCubeViews(trip);
  // The cube that opens first: ?cube= (the Home tiles), or the cube of the item ?edit= asks for, so its row is on screen.
  const openingItem = openItemId ? trip.items.find((entry) => entry.id === openItemId) : undefined;
  const firstCube = openCube ?? (openingItem ? itemCube(openingItem) : undefined);
  const cubeName = (cube: Cube) =>
    cubeViews.find((view) => view.cube === cube)?.label ?? CUBE_LABELS[cube];
  const stopNames = weatherStops.map((stop) => stop.location.city);
  const firstForecastStop =
    weather?.panel.kind === "ready"
      ? (weather.panel.stops.find((stop) => stop.days.length > 0)?.stopIndex ?? 0)
      : 0;
  const suggestions = toSuggestions(
    weatherChanges,
    stopNames,
    firstForecastStop,
    trip.items.filter((entry) => itemCube(entry) === "weather").map((entry) => entry.id),
  );

  const resolveSuggestion = (suggestion: Suggestion, decision: "add" | "dismiss") => {
    if (!source.weather) return;
    const [selected, skipped] =
      decision === "add" ? [[suggestion.change], []] : [[], [suggestion.change]];
    void act(() => reviewWrite(selected, skipped), {
      modal: true,
      announce: () =>
        decision === "add"
          ? suggestion.verb === "Add"
            ? `${suggestion.name} added to ${suggestion.destination}.`
            : `${suggestion.name} removed.`
          : `${suggestion.name} dismissed.`,
      after: (change) => void loadWeather(change.trip),
    });
  };

  const setLaundry = (laundry: boolean) => {
    if (laundryBusy) return;
    setLaundryBusy(true);
    const before = new Map(trip.items.map((entry) => [entry.id, entry.qty]));
    void act(() => source.updatePreferences(tripId, { ...trip.config, laundry }, trip.updatedAt), {
      modal: true,
      onFail: (error) => {
        if (error instanceof Error && error.message === "STALE") {
          // The list moved on: show the current one, so the toggle reads what is really saved.
          void source
            .getTrip(tripId)
            .then((current) => {
              confirmed.current = current;
              setLoad({ phase: "ready", trip: current });
            })
            .catch(() => undefined);
        }
        toast.show("Couldn’t change laundry. Nothing was changed.");
      },
      after: (change) => {
        const changed = change.trip.items.filter((entry) => before.get(entry.id) !== entry.qty);
        toast.show(
          `Laundry ${laundry ? "on" : "off"} · ${changed.length} ${changed.length === 1 ? "item" : "items"} changed`,
        );
      },
    }).then(() => setLaundryBusy(false));
  };

  const moveItem = (item: TripItem, cube: Cube) =>
    void act(() => source.moveItemToCube(tripId, item.id, cube), {
      announce: () => `${item.name} moved to ${cubeName(cube)}.`,
    });

  const removeFromCube = (item: TripItem) =>
    void act(() => source.removeItem(tripId, item.id, "this-trip"), {
      announce: () => `${item.name} removed.`,
    });

  const setMorningOf = (cube: Cube, on: boolean) =>
    void act(() => source.setMorningOf(tripId, cube, on), {
      announce: () => `${cubeName(cube)} ${on ? "marked" : "no longer marked"} Morning of.`,
    });

  const addToCube = (cube: Cube, name: string): Promise<AddOutcome> => {
    // Toiletries items gate the bag step, so they go through the Bathroom form.
    if (cube === "toiletries") {
      setDialog({ kind: "add-toiletry", name, qty: 1 });
      return Promise.resolve({ ok: true });
    }
    const category = categoryForCube(cube);
    const existing = findExistingItem(trip, name, category);
    if (existing) return Promise.resolve({ ok: false, reason: "EXISTS", existingId: existing.id });
    return new Promise((resolve) => {
      void act(() => source.addItem(tripId, { name, category, neededQty: 1, cube }), {
        announce: () => `${name} added to ${cubeName(cube)}.`,
        after: () => resolve({ ok: true }),
        onFail: (error) => {
          const again = findExistingItem(trip, name, category);
          resolve(
            error instanceof TripsSourceError && error.message === "EXISTS" && again
              ? { ok: false, reason: "EXISTS", existingId: again.id }
              : { ok: false, reason: "FAILED" },
          );
        },
      });
    });
  };

  const weatherPanelProps = {
    stops: weatherStops,
    unit: weather?.settings.temperatureUnit ?? ("F" as const),
    onOptIn: () => void setWeatherOptIn(true),
    onDecline: () => void setWeatherOptIn(false),
    onTurnOn: () => void setWeatherOptIn(true),
    onRefresh: () => weather && void loadWeather(trip, weather.settings),
  };

  const tickItem = (item: TripItem, packed: boolean) => setCount(item, packed ? item.qty : 0);

  const retryRow = (id: string) => {
    // The retry button only renders while a failure is recorded for this row.
    const failed = retries.current.get(id) as {
      write: () => Promise<TripChange>;
      options: ActOptions;
    };
    void act(failed.write, failed.options);
  };

  const editItem = (id: string) => {
    returnFocusTo.current = id;
    setDialog({ kind: "edit", itemId: id });
  };

  /**
   * "All in" (#386): packs everything still unpacked in the cube as ONE change, so a failed save leaves the cube as it was
   * (never half packed). Undo puts every one of those items back to the count it had, also as one change.
   */
  const allIn = (view: CubeView): Promise<boolean> => {
    const before = view.items.filter((entry) => !isPacked(entry));
    if (before.length === 0) return Promise.resolve(true);
    const undo = before.map((entry) => ({ itemId: entry.id, packed: entry.packed }));
    // Counts are quantities everywhere (#376): the message says how many more units went in, not how many rows changed.
    const units = before.reduce((sum, entry) => sum + (entry.qty - entry.packed), 0);
    return new Promise((resolve) => {
      void act(
        () =>
          source.setPackedMany(
            tripId,
            before.map((entry) => ({ itemId: entry.id, packed: entry.qty })),
          ),
        {
          announce: () => `Packed ${itemsLabel(units)} in ${view.label}.`,
          onFail: () => {
            toast.show(`Couldn’t pack ${view.label}. Nothing was changed.`);
            resolve(false);
          },
          after: () => {
            toast.show(`Packed ${itemsLabel(units)}`, {
              action: {
                label: "Undo",
                onAction: () => {
                  void act(() => source.setPackedMany(tripId, undo), {
                    announce: () => `${view.label} put back.`,
                    onFail: () => toast.show("Couldn’t undo. Nothing was changed."),
                  });
                },
              },
            });
            resolve(true);
          },
        },
      );
    });
  };

  // While weather is off, asking, loading, offline or unavailable the forecast block is the existing Weather panel (#408 replaces it).
  const forecastPlaceholder =
    weather && weatherStops.length > 0 ? (
      <WeatherPanel {...weatherPanelProps} state={weather.panel} />
    ) : null;

  const toiletryExtra =
    gate.state === "none" ? null : (
      <BagStep
        gate={gate}
        onPlace={() => setDialog({ kind: "bag" })}
        onUndo={() => void act(() => source.undoBagPlacement(tripId))}
        onAddItem={() => setDialog({ kind: "add-toiletry" })}
      />
    );

  // What sits under the suitcase until the Phase 3 issues (#411 all packed / Ready, #389 Edit trip) take it over. The laptop has
  // "Edit trip" in its header; on a phone it is one of these links (the Home tag's menu takes it over in #389).
  const packingTools = (withEditTrip: boolean) => (
    <div className="packing-tools" role="group" aria-label="More for this trip">
      {withEditTrip ? (
        <button
          type="button"
          className="link-button edit-route"
          onClick={() => setDialog({ kind: "trip", tab: "route" })}
        >
          Edit trip
        </button>
      ) : null}
      <button
        type="button"
        className="link-button save-as-list"
        onClick={() => setDialog({ kind: "save-list" })}
      >
        Save as a list
      </button>
      {trip.stops.length > 0 ? (
        <button
          type="button"
          className="link-button edit-stamp"
          onClick={() => setDialog({ kind: "stamp" })}
        >
          Edit stamp
        </button>
      ) : null}
      <button
        type="button"
        className="link-button edit-preferences"
        onClick={() => setDialog({ kind: "trip", tab: "preferences" })}
      >
        Edit preferences
      </button>
    </div>
  );
  const packingReview = (
    <>
      {showReviewPrompt(trip) ? (
        <div className="review-prompt">
          <h3>Everything is checked. Want to review?</h3>
          <p>
            We will show the full bag, including Pack last and the return outfit, before you decide
            it is ready.
          </p>
          <Link
            className={buttonClassName({ variant: "secondary" })}
            href={`/trips/${tripId}/review`}
          >
            Review your bag
          </Link>
        </div>
      ) : null}
      {trip.ready ? (
        <Card padded className="ready-card">
          <p className="eyebrow">Confirmed after review</p>
          <h2>You’re ready to go.</h2>
          <p>
            You can still correct anything below. Any checklist change will revoke Ready, or you can
            mark the trip not ready without changing packing progress.
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
    </>
  );

  return (
    <section className="screen">
      <p className="sr-only" role="status" aria-label="Packing updates">
        {announcement}
      </p>
      {laptop ? (
        <PackingLaptop
          trip={trip}
          openCube={firstCube}
          failedRows={failedRows}
          laundryBusy={laundryBusy}
          onLaundry={setLaundry}
          onEditTrip={() => setDialog({ kind: "trip", tab: "route" })}
          onTick={tickItem}
          onRetry={retryRow}
          onEditItem={editItem}
          onMove={moveItem}
          onRemove={removeFromCube}
          onMorningOf={setMorningOf}
          onAdd={addToCube}
          forecast={
            <ForecastSection
              stops={weatherStops}
              state={weather?.panel ?? { kind: "off" }}
              unit={weather?.settings.temperatureUnit ?? "F"}
              today={localToday()}
              suggestions={suggestions}
              busy={submitting}
              onResolve={resolveSuggestion}
              onRefresh={weatherPanelProps.onRefresh}
              placeholder={forecastPlaceholder}
            />
          }
          toiletryExtra={toiletryExtra}
          below={
            <>
              {packingTools(false)}
              {packingReview}
            </>
          }
        />
      ) : (
        <PackingPhone
          trip={trip}
          openCube={firstCube}
          failedRows={failedRows}
          laundryBusy={laundryBusy}
          onLaundry={setLaundry}
          onTick={tickItem}
          onRetry={retryRow}
          onEditItem={editItem}
          onMove={moveItem}
          onRemove={removeFromCube}
          onMorningOf={setMorningOf}
          onAdd={addToCube}
          onAllIn={allIn}
          forecast={
            <ForecastPhone
              stops={weatherStops}
              state={weather?.panel ?? { kind: "off" }}
              unit={weather?.settings.temperatureUnit ?? "F"}
              today={localToday()}
              suggestions={suggestions}
              busy={submitting}
              onResolve={resolveSuggestion}
              onRefresh={weatherPanelProps.onRefresh}
              placeholder={forecastPlaceholder}
            />
          }
          toiletryExtra={toiletryExtra}
          below={
            <>
              {packingTools(true)}
              {packingReview}
            </>
          }
        />
      )}

      {editing ? (
        <ItemEditor
          key={editing.id}
          item={editing}
          destination={trip.destination}
          tripDays={trip.days}
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
      {dialog?.kind === "stamp" ? (
        <EditStampSheet
          automatic={automaticStamps(trip.stops)}
          stops={trip.stops}
          saved={trip.stampLabels}
          departure={trip.start}
          saving={submitting}
          failed={stampFailed}
          onClose={() => {
            setStampFailed(false);
            close();
          }}
          onSave={(slot1, slot2) => {
            setStampFailed(false);
            const before = trip.stampLabels ?? [null, null];
            void act(() => source.setStampLabels(tripId, slot1, slot2), {
              modal: true,
              onFail: () => setStampFailed(true),
              after: (change) => {
                const now = change.trip.stampLabels ?? [null, null];
                // Only slots that changed count: a change that only cleared overrides is a reset.
                const changed = [0, 1].filter((slot) => now[slot] !== before[slot]);
                toast.show(
                  changed.length > 0 && changed.every((slot) => now[slot] === null)
                    ? "Stamp reset to automatic."
                    : "Stamp updated.",
                );
                close();
              },
            });
          }}
        />
      ) : null}
      {dialog?.kind === "trip" ? (
        <EditTripSheet
          trip={trip}
          initialTab={dialog.tab}
          onClose={close}
          onSaveRoute={(stops, basedOn) =>
            new Promise<SaveResult>((resolve) => {
              void act(() => source.setStops(tripId, stops, basedOn), {
                modal: true,
                onFail: (error) => failedSave(error, resolve),
                announce: () => "Route updated.",
                after: (change) => {
                  // New stops and dates are a new question for the weather service.
                  void loadWeather(change.trip, weather?.settings);
                  resolve({ updatedAt: change.trip.updatedAt });
                },
              });
            })
          }
          onSetTravelMode={(mode, basedOn) =>
            new Promise<SaveResult>((resolve) => {
              void act(() => source.setTravelMode(tripId, mode, basedOn), {
                modal: true,
                onFail: (error) => failedSave(error, resolve),
                announce: () => "Getting there updated.",
                after: (change) => resolve({ updatedAt: change.trip.updatedAt }),
              });
            })
          }
          onApplyPreferences={(config, basedOn) =>
            new Promise<ApplyOutcome>((resolve) => {
              const wasReady = trip.ready;
              const hadBagPlaced = trip.toiletryBagPacked;
              void act(() => source.updatePreferences(tripId, config, basedOn), {
                modal: true,
                onFail: (error) => {
                  if (!(error instanceof Error && error.message === "STALE"))
                    return resolve("failed");
                  // The list moved on while it was being reviewed: show the current one, so reviewing again is about it.
                  void source
                    .getTrip(tripId)
                    .then((current) => {
                      confirmed.current = current;
                      setLoad({ phase: "ready", trip: current });
                    })
                    .catch(() => undefined)
                    .finally(() => resolve("stale"));
                },
                after: (change) => {
                  toast.show(
                    [
                      "Preferences updated.",
                      wasReady ? "Ready turned off." : null,
                      hadBagPlaced && !change.trip.toiletryBagPacked
                        ? "Toiletry bag placement reset."
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" "),
                  );
                  resolve("ok");
                },
              });
            })
          }
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
