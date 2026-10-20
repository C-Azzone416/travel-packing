"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import type { LocationProvider } from "@/domain/location-provider";
import type { DraftStop, SampleLocation } from "@/domain/trip-lifecycle";
import { MAX_STOPS } from "@/domain/trip-stops";
import { LocationPicker } from "./LocationPicker";
import {
  addStop,
  canAddStop,
  fixSummary,
  formatNights,
  moveStop,
  nightsAt,
  removeStop,
  routeSummary,
  setFirstArrive,
  setLeave,
  snapContiguous,
  stopProblems,
  type StopProblem,
} from "./stops-draft";
import { formatShortDate } from "./view";

export interface StopListProps {
  /**
   * Two to six stops in the create flow. The edit sheet also passes one stop: it is then a plain destination
   * (no stop numbers, move or remove) with the Add button below it.
   */
  stops: DraftStop[];
  onChange: (stops: DraftStop[]) => void;
  provider: LocationProvider;
  fallbackProvider?: LocationProvider;
  allowCustom?: boolean;
  /** Text already typed in the first stop's search box (kept when a single destination grows into a route). */
  firstQuery?: string;
  /** The person pressed Continue/Save with problems: show every message, including missing places. */
  attempted: boolean;
}

const queryOf = (location: SampleLocation) =>
  location.id === "custom" ? location.label : `${location.city}, ${location.region}`;

// The Stops step for a route of 2-6 stops (design #108 §1.2-1.4): one card per stop, Arrive read-only from stop 2 on,
// Leave editable (it shifts every later stop), move up/down and remove buttons, add at the end, a live summary.
export function StopList({
  stops,
  onChange,
  provider,
  fallbackProvider,
  allowCustom,
  attempted,
  firstQuery = "",
}: StopListProps) {
  const base = useId();
  const nextKey = useRef(stops.length);
  // A stable key per stop, so a search box keeps its text when stops are reordered or one above it is removed.
  const [keys, setKeys] = useState(() => stops.map((_, index) => index));
  const [queries, setQueries] = useState<Record<number, string>>(() =>
    Object.fromEntries(
      stops.map((stop, index) => [
        index,
        stop.location ? queryOf(stop.location) : index === 0 ? firstQuery : "",
      ]),
    ),
  );
  const [confirming, setConfirming] = useState<number | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [focusKey, setFocusKey] = useState<number | null>(null);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (focusKey === null) return;
    root.current
      ?.querySelector<HTMLInputElement>(`[data-stop-key="${focusKey}"] input[role="combobox"]`)
      ?.focus();
    setFocusKey(null);
  }, [focusKey]);

  const single = stops.length === 1;
  const problems = stopProblems(stops);
  const shown = problems.filter(
    (problem) => attempted || (problem.field !== "place" && problem.message !== "Choose a date."),
  );
  const forField = (index: number, field: StopProblem["field"]) =>
    shown.find((problem) => problem.stopIndex === index && problem.field === field);
  const nameOf = (stop: DraftStop, index: number) => stop.location?.city ?? `Stop ${index + 1}`;
  const total = (list: DraftStop[]) => {
    const first = list[0].arrive;
    const last = list[list.length - 1].leave;
    const nights = nightsAt({ arrive: first, leave: last });
    return nights === null ? "" : ` Trip is now ${formatNights(nights)}.`;
  };

  function patch(index: number, change: Partial<DraftStop>) {
    onChange(stops.map((stop, at) => (at === index ? { ...stop, ...change } : stop)));
  }

  function add() {
    const key = nextKey.current++;
    setKeys([...keys, key]);
    setQueries({ ...queries, [key]: "" });
    onChange(addStop(stops));
    setFocusKey(key);
    setAnnouncement(`Stop ${stops.length + 1} added`);
  }

  function remove(index: number) {
    const next = removeStop(stops, index);
    setKeys(keys.filter((_, at) => at !== index));
    setConfirming(null);
    onChange(next);
    setAnnouncement(`Stop removed.${total(next)}`);
  }

  function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= stops.length) return;
    const next = moveStop(stops, index, direction);
    setKeys(
      keys.map((key, at) => (at === index ? keys[target] : at === target ? keys[index] : key)),
    );
    onChange(next);
    setAnnouncement(`${nameOf(stops[index], index)} moved to stop ${target + 1}. Dates updated.`);
  }

  return (
    <div className="stop-list" ref={root}>
      {stops.map((stop, index) => {
        const key = keys[index];
        const id = `${base}-${key}`;
        const nights = nightsAt(stop);
        const placeProblem = forField(index, "place");
        const arriveProblem = forField(index, "arrive");
        const leaveProblem = forField(index, "leave");
        const name = nameOf(stop, index);
        return (
          <div key={key}>
            {index > 0 ? (
              <div className="stop-connector" aria-hidden="true">
                <span>Travel day, {formatShortDate(stop.arrive)}</span>
              </div>
            ) : null}
            <Card as="div" padded className="stop-card" data-stop-key={key}>
              <div role="group" aria-labelledby={`${id}-title`}>
                <div className={single ? "stop-head sr-only" : "stop-head"}>
                  <span className="stop-number" aria-hidden="true">
                    {index + 1}
                  </span>
                  <h3 id={`${id}-title`}>Stop {index + 1}</h3>
                  {single ? null : (
                    <div className="stop-actions">
                      <button
                        type="button"
                        className="icon-button"
                        aria-label={`Move ${name} up`}
                        aria-disabled={index === 0}
                        onClick={() => move(index, -1)}
                      >
                        <span aria-hidden="true">↑</span>
                      </button>
                      <button
                        type="button"
                        className="icon-button"
                        aria-label={`Move ${name} down`}
                        aria-disabled={index === stops.length - 1}
                        onClick={() => move(index, 1)}
                      >
                        <span aria-hidden="true">↓</span>
                      </button>
                      <button
                        type="button"
                        className="icon-button danger"
                        aria-label={`Remove ${name}`}
                        onClick={() => (stop.location ? setConfirming(index) : remove(index))}
                      >
                        <span aria-hidden="true">🗑</span>
                      </button>
                    </div>
                  )}
                </div>
                {confirming === index ? (
                  <div className="callout stop-confirm" role="group" aria-label={`Remove ${name}?`}>
                    <strong>Remove {name}?</strong>
                    <div className="actions">
                      <Button variant="danger" small onClick={() => remove(index)}>
                        Remove
                      </Button>
                      <Button variant="secondary" small onClick={() => setConfirming(null)}>
                        Keep
                      </Button>
                    </div>
                  </div>
                ) : null}
                <LocationPicker
                  provider={provider}
                  fallbackProvider={fallbackProvider}
                  allowCustom={allowCustom}
                  label={`Destination search, Stop ${index + 1}`}
                  query={queries[key] ?? ""}
                  onQueryChange={(text) => setQueries({ ...queries, [key]: text })}
                  selected={stop.location}
                  onSelect={(location) => {
                    setQueries({ ...queries, [key]: queryOf(location) });
                    patch(index, { location });
                  }}
                  onClear={() => patch(index, { location: null })}
                />
                {placeProblem ? (
                  <p className="tiny field-error" id={`${id}-place-error`}>
                    {placeProblem.message}
                  </p>
                ) : null}
                <div className="two-col stop-dates">
                  <label className="field">
                    {index === 0 ? "Arrive" : `Arrive, Stop ${index + 1}`}
                    <input
                      type="date"
                      value={stop.arrive}
                      readOnly={index > 0}
                      aria-describedby={
                        index > 0
                          ? `${id}-arrive-help`
                          : arriveProblem
                            ? `${id}-arrive-error`
                            : undefined
                      }
                      aria-invalid={arriveProblem ? true : undefined}
                      onChange={(event) => onChange(setFirstArrive(stops, event.target.value))}
                    />
                  </label>
                  <label className="field">
                    {index === 0 ? "Leave" : `Leave, Stop ${index + 1}`}
                    <input
                      type="date"
                      value={stop.leave}
                      min={stop.arrive || undefined}
                      aria-describedby={leaveProblem ? `${id}-leave-error` : undefined}
                      aria-invalid={leaveProblem ? true : undefined}
                      onChange={(event) => onChange(setLeave(stops, index, event.target.value))}
                    />
                  </label>
                </div>
                {index > 0 ? (
                  <p className="tiny muted" id={`${id}-arrive-help`}>
                    Same day you leave Stop {index}
                  </p>
                ) : null}
                {!single && nights !== null && nights >= 1 ? (
                  <span className="nights-chip">{formatNights(nights)}</span>
                ) : null}
                {arriveProblem ? (
                  <p className="tiny field-error" id={`${id}-arrive-error`}>
                    {arriveProblem.message}{" "}
                    <button
                      type="button"
                      className="button ghost small"
                      onClick={() => onChange(snapContiguous(stops))}
                    >
                      Fix dates
                    </button>
                  </p>
                ) : null}
                {leaveProblem ? (
                  <p className="tiny field-error" id={`${id}-leave-error`}>
                    {leaveProblem.message}
                  </p>
                ) : null}
              </div>
            </Card>
          </div>
        );
      })}
      {canAddStop(stops) ? (
        <Button variant="secondary" className="add-stop" onClick={add}>
          + Add another stop
        </Button>
      ) : (
        <p className="tiny muted">You can add up to {MAX_STOPS} stops.</p>
      )}
      <p className="route-summary" aria-live="polite">
        {routeSummary(stops)}
      </p>
      {attempted && problems.length ? (
        <p className="tiny field-error" role="alert">
          {fixSummary(problems.length)}
        </p>
      ) : null}
      <p className="sr-only" role="status" aria-label="Stops updates">
        {announcement}
      </p>
    </div>
  );
}
