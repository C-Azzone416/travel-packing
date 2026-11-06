"use client";

import { useEffect, useRef, useState, type DragEvent } from "react";
import { Icon } from "@/components/ui/Icon";
import type { LocationProvider } from "@/domain/location-provider";
import type { DraftStop, SampleLocation } from "@/domain/trip-lifecycle";
import { MAX_STOPS } from "@/domain/trip-stops";
import { LocationPicker } from "@/features/trips/LocationPicker";
import { addStop, canAddStop, moveStop, removeStop } from "@/features/trips/stops-draft";
import { moveStopTo, stopRange } from "./plan-model";
import styles from "./plan.module.css";

export interface StopRowsProps {
  stops: DraftStop[];
  onChange: (stops: DraftStop[]) => void;
  provider: LocationProvider;
  fallbackProvider?: LocationProvider;
  allowCustom?: boolean;
  /** The first stop's search text, kept when a copy arrives with one stop. */
  firstQuery?: string;
  /** Show every missing-place message (the person pressed Next with something missing). */
  attempted: boolean;
}

const queryOf = (location: SampleLocation) =>
  location.id === "custom" ? location.label : `${location.city}, ${location.region}`;

// The stops of the Where step (spec #376 section 1.7): the places in order. A confirmed place is a row (drag handle, name,
// its dates once the dates step is done, remove); a place still to choose is the search box. Drag with the mouse, or use
// the Move up / Move down buttons (the keyboard and touch way). Dates are chosen on the next step.
export function StopRows({
  stops,
  onChange,
  provider,
  fallbackProvider,
  allowCustom,
  firstQuery = "",
  attempted,
}: StopRowsProps) {
  const nextKey = useRef(stops.length);
  // A stable key per stop, so a search box keeps its text when stops above it are reordered or removed.
  const [keys, setKeys] = useState(() => stops.map((_, index) => index));
  const [queries, setQueries] = useState<Record<number, string>>(() => ({ 0: firstQuery }));
  const [announcement, setAnnouncement] = useState("");
  const [dragging, setDragging] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  // The key of a stop whose search box should take focus once it has rendered (a stop was just added or cleared).
  const focusKey = useRef<number | null>(null);
  // The move button that was just pressed: reordering moves the row in the page, which can drop focus, so it is put back.
  const refocus = useRef<{ key: number; direction: "up" | "down" } | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const single = stops.length === 1;

  useEffect(() => {
    if (refocus.current) {
      root.current
        ?.querySelector<HTMLButtonElement>(
          `[data-stop-key="${refocus.current.key}"] [data-move="${refocus.current.direction}"]`,
        )
        ?.focus();
      refocus.current = null;
    }
    if (focusKey.current === null) return;
    root.current
      ?.querySelector<HTMLInputElement>(
        `[data-stop-key="${focusKey.current}"] input[role="combobox"]`,
      )
      ?.focus();
    focusKey.current = null;
  });

  const nameOf = (stop: DraftStop, index: number) => stop.location?.city ?? `Stop ${index + 1}`;

  function patch(index: number, change: Partial<DraftStop>) {
    onChange(stops.map((stop, at) => (at === index ? { ...stop, ...change } : stop)));
  }

  function add() {
    const key = nextKey.current++;
    setKeys([...keys, key]);
    setQueries({ ...queries, [key]: "" });
    onChange(addStop(stops));
    focusKey.current = key;
    setAnnouncement(`Stop ${stops.length + 1} added`);
  }

  function remove(index: number) {
    const stop = stops[index];
    if (single) {
      // The only stop cannot go: clearing it returns to the search box.
      setQueries({ ...queries, [keys[0]]: "" });
      patch(0, { location: null });
      focusKey.current = keys[0];
      setAnnouncement(`${nameOf(stop, 0)} cleared`);
      return;
    }
    setKeys(keys.filter((_, at) => at !== index));
    onChange(removeStop(stops, index));
    setAnnouncement(`${nameOf(stop, index)} removed. ${stops.length - 1} stops left.`);
  }

  function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= stops.length) return;
    refocus.current = { key: keys[index], direction: direction === -1 ? "up" : "down" };
    setKeys(
      keys.map((key, at) => (at === index ? keys[target] : at === target ? keys[index] : key)),
    );
    onChange(moveStop(stops, index, direction));
    setAnnouncement(`${nameOf(stops[index], index)} moved to stop ${target + 1}`);
  }

  function drop(event: DragEvent, to: number) {
    event.preventDefault();
    const from = dragging;
    setDragging(null);
    setOver(null);
    if (from === null || from === to) return;
    const moved = keys[from];
    const rest = keys.filter((_, at) => at !== from);
    rest.splice(to, 0, moved);
    setKeys(rest);
    onChange(moveStopTo(stops, from, to));
    setAnnouncement(`${nameOf(stops[from], from)} moved to stop ${to + 1}`);
  }

  return (
    <div ref={root} className={styles.stops}>
      <ol className={styles.stopList}>
        {stops.map((stop, index) => {
          const key = keys[index];
          const range = stopRange(stop);
          const missing = !stop.location && attempted;
          if (!stop.location) {
            return (
              <li key={key} data-stop-key={key} className={styles.stopPick}>
                <LocationPicker
                  provider={provider}
                  fallbackProvider={fallbackProvider}
                  allowCustom={allowCustom}
                  label={single ? "Destination search" : `Destination search, Stop ${index + 1}`}
                  query={queries[key] ?? ""}
                  onQueryChange={(text) => setQueries({ ...queries, [key]: text })}
                  selected={null}
                  onSelect={(location) => {
                    setQueries({ ...queries, [key]: queryOf(location) });
                    patch(index, { location });
                  }}
                  onClear={() => undefined}
                />
                {missing ? (
                  <p className={styles.error}>{`Choose a place for Stop ${index + 1}.`}</p>
                ) : null}
                {!single ? (
                  <button
                    type="button"
                    className={styles.textButton}
                    onClick={() => remove(index)}
                  >{`Remove Stop ${index + 1}`}</button>
                ) : null}
              </li>
            );
          }
          const name = stop.location.city;
          return (
            <li
              key={key}
              data-stop-key={key}
              className={styles.stopRow}
              data-over={over === index && dragging !== index ? "" : undefined}
              data-dragging={dragging === index ? "" : undefined}
              draggable={!single}
              onDragStart={(event) => {
                setDragging(index);
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", String(index));
              }}
              onDragOver={(event) => {
                if (dragging === null) return;
                event.preventDefault();
                setOver(index);
              }}
              onDrop={(event) => drop(event, index)}
              onDragEnd={() => {
                setDragging(null);
                setOver(null);
              }}
            >
              <span className={styles.grip} aria-hidden="true">
                ⋮⋮
              </span>
              <span className={styles.stopName}>{name}</span>
              {range ? <span className={styles.stopDates}>{range}</span> : null}
              {!single ? (
                <span className={styles.stopMoves}>
                  <button
                    type="button"
                    className={styles.iconButton}
                    data-move="up"
                    aria-label={`Move ${name} up`}
                    aria-disabled={index === 0}
                    onClick={() => move(index, -1)}
                  >
                    <Icon name="caretUp" size={16} />
                  </button>
                  <button
                    type="button"
                    className={styles.iconButton}
                    data-move="down"
                    aria-label={`Move ${name} down`}
                    aria-disabled={index === stops.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    <Icon name="caretDown" size={16} />
                  </button>
                </span>
              ) : null}
              <button
                type="button"
                className={styles.iconButton}
                aria-label={single ? `Change ${name}` : `Remove ${name}`}
                onClick={() => remove(index)}
              >
                <Icon name="close" size={16} />
              </button>
            </li>
          );
        })}
      </ol>
      {canAddStop(stops) ? (
        <button type="button" className={styles.addStop} onClick={add}>
          <Icon name="plus" size={18} />
          Add a stop
        </button>
      ) : (
        <p className={styles.hint}>You can add up to {MAX_STOPS} stops.</p>
      )}
      <p className="sr-only" role="status" aria-label="Stops updates">
        {announcement}
      </p>
    </div>
  );
}
