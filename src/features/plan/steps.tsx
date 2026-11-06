"use client";

import { useId, useState } from "react";
import { curatedLocationProvider, type LocationProvider } from "@/domain/location-provider";
import { draftStops, setDraftStops, type TripDraft } from "@/domain/trip-lifecycle";
import { routeText, type TravelMode } from "@/domain/trip-route";
import { LocationPicker } from "@/features/trips/LocationPicker";
import {
  formatNights,
  nightsAt,
  setFirstArrive,
  setLeave,
  snapContiguous,
  stopProblems,
} from "@/features/trips/stops-draft";
import { withDates } from "@/features/trips/draft";
import { formatShortDate } from "@/features/trips/view";
import { MAX_TRIP_NAME_LENGTH } from "@/domain/trip-route";
import {
  COPY_DATE_NOTICE,
  MODE_CHOICES,
  placesOf,
  stopRange,
  tagTitle,
  whenSummary,
  type PlanPreview,
} from "./plan-model";
import { StopRows } from "./StopRows";
import styles from "./plan.module.css";

export interface DraftProps {
  draft: TripDraft;
  onDraft: (draft: TripDraft) => void;
}

export interface WhereStepProps extends DraftProps {
  provider: LocationProvider;
  allowCustom?: boolean;
  /** The account's home city, to tell "home" from another place in the From field. */
  homeId: string | null;
  attempted: boolean;
  firstQuery: string;
}

/** Step 1: From (the home city unless changed for this trip) and the places to go, in order. */
export function WhereStep({
  draft,
  onDraft,
  provider,
  allowCustom,
  homeId,
  attempted,
  firstQuery,
}: WhereStepProps) {
  const fallback = provider === curatedLocationProvider ? undefined : curatedLocationProvider;
  const [changing, setChanging] = useState(false);
  const [query, setQuery] = useState("");
  const origin = draft.origin ?? null;
  const fromId = useId();
  const showPicker = changing || origin === null;
  return (
    <div className={styles.stepBody}>
      <div className={styles.group} role="group" aria-labelledby={fromId}>
        <p id={fromId} className={styles.eyebrow}>
          From
        </p>
        {showPicker ? (
          <>
            <LocationPicker
              provider={provider}
              fallbackProvider={fallback}
              allowCustom={allowCustom}
              label="From"
              resultsLabel="From results"
              query={query}
              onQueryChange={setQuery}
              selected={null}
              onSelect={(location) => {
                onDraft({ ...draft, origin: location });
                setChanging(false);
                setQuery("");
              }}
              onClear={() => undefined}
            />
            {origin !== null ? (
              <button
                type="button"
                className={styles.textButton}
                onClick={() => setChanging(false)}
              >
                Keep {origin.city}
              </button>
            ) : (
              <p className={styles.hint}>
                Optional. Without a starting place the map has no home pin.
              </p>
            )}
          </>
        ) : (
          <button
            type="button"
            className={styles.fromField}
            aria-label={`From: ${origin.city}${origin.id === homeId ? " (home)" : ""}. Change`}
            onClick={() => setChanging(true)}
          >
            <span className={styles.fromCity}>{origin.city}</span>
            {origin.id === homeId ? <span className={styles.fromHome}>· home</span> : null}
          </button>
        )}
      </div>
      <div className={styles.group} role="group" aria-labelledby={`${fromId}-to`}>
        <p id={`${fromId}-to`} className={styles.eyebrow}>
          To · in order
        </p>
        <StopRows
          stops={draftStops(draft)}
          onChange={(stops) => onDraft(setDraftStops(draft, stops))}
          provider={provider}
          fallbackProvider={fallback}
          allowCustom={allowCustom}
          firstQuery={firstQuery}
          attempted={attempted}
        />
      </div>
    </div>
  );
}

export interface WhenStepProps extends DraftProps {
  attempted: boolean;
  /** A copied route is still on the source trip's dates. */
  staleCopy: boolean;
}

/** Step 2: the dates. One stop: Leave and Return. A route: each stop's Leave (the first also Arrive), later stops follow. */
export function WhenStep({ draft, onDraft, attempted, staleCopy }: WhenStepProps) {
  const stops = draftStops(draft);
  const multi = stops.length > 1;
  const [adjusted, setAdjusted] = useState(false);
  const base = useId();
  if (!multi) {
    return (
      <div className={styles.stepBody}>
        <div className={styles.twoCol}>
          <label className={styles.field}>
            Leave
            <input
              name="start"
              type="date"
              value={draft.start}
              required
              aria-describedby={`${base}-hint ${base}-notice`}
              onChange={(event) => {
                const change = withDates(draft, event.target.value, draft.end);
                onDraft(change.draft);
                setAdjusted(change.adjusted);
              }}
            />
          </label>
          <label className={styles.field}>
            Return
            <input
              name="end"
              type="date"
              value={draft.end}
              min={draft.start || undefined}
              required
              aria-describedby={`${base}-hint ${base}-notice`}
              onChange={(event) => {
                const change = withDates(draft, draft.start, event.target.value);
                onDraft(change.draft);
                setAdjusted(change.adjusted);
              }}
            />
          </label>
        </div>
        <p id={`${base}-hint`} className={styles.hint}>
          Same-day trips are allowed. Return cannot be before departure.
        </p>
        <p id={`${base}-notice`} className={styles.notice} role="status" aria-label="Date notice">
          {adjusted ? "Return date moved to match your departure." : ""}
        </p>
      </div>
    );
  }
  const problems = stopProblems(stops).filter((problem) => problem.field !== "place");
  const apply = (next: typeof stops) => onDraft(setDraftStops(draft, next));
  return (
    <div className={styles.stepBody}>
      {staleCopy ? (
        <p className={attempted ? styles.error : styles.hint}>{COPY_DATE_NOTICE}</p>
      ) : null}
      <ol className={styles.dateStops}>
        {stops.map((stop, index) => {
          const nights = nightsAt(stop);
          const city = stop.location?.city ?? `Stop ${index + 1}`;
          return (
            <li key={index} className={styles.dateStop}>
              <p className={styles.dateStopName}>
                {city}
                {nights !== null && nights >= 1 ? (
                  <span className={styles.nights}>{formatNights(nights)}</span>
                ) : null}
              </p>
              <div className={styles.twoCol}>
                <label className={styles.field}>
                  {index === 0 ? "Arrive" : `Arrive, Stop ${index + 1}`}
                  <input
                    type="date"
                    value={stop.arrive}
                    readOnly={index > 0}
                    aria-readonly={index > 0 ? true : undefined}
                    onChange={(event) => {
                      // Stops 2+ arrive the day the previous one leaves; iOS still opens its picker on a read-only input.
                      if (index === 0)
                        apply(snapContiguous(setFirstArrive(stops, event.target.value)));
                    }}
                  />
                </label>
                <label className={styles.field}>
                  {index === 0 ? "Leave" : `Leave, Stop ${index + 1}`}
                  <input
                    type="date"
                    value={stop.leave}
                    min={stop.arrive || undefined}
                    onChange={(event) =>
                      apply(snapContiguous(setLeave(stops, index, event.target.value)))
                    }
                  />
                </label>
              </div>
              {index > 0 ? (
                <p
                  className={styles.hint}
                >{`Same day you leave ${stops[index - 1].location?.city ?? `Stop ${index}`}`}</p>
              ) : null}
            </li>
          );
        })}
      </ol>
      {attempted
        ? problems.map((problem) => (
            <p key={`${problem.stopIndex}-${problem.field}`} className={styles.error}>
              {`${stops[problem.stopIndex].location?.city ?? `Stop ${problem.stopIndex + 1}`}: ${problem.message}`}
            </p>
          ))
        : null}
      {problems.length > 0 ? (
        <button
          type="button"
          className={styles.textButton}
          onClick={() => apply(snapContiguous(stops))}
        >
          Fix dates
        </button>
      ) : (
        <p
          className={styles.hint}
        >{`${formatShortDate(draft.start)} – ${formatShortDate(draft.end)}`}</p>
      )}
    </div>
  );
}

export interface HowStepProps extends DraftProps {
  attempted: boolean;
}

/** Step 3: Fly, Drive, or Train or other. Colour is never the only signal: the chosen one is pressed and says so. */
export function HowStep({ draft, onDraft, attempted }: HowStepProps) {
  const name = useId();
  return (
    <div className={styles.stepBody}>
      <fieldset className={styles.modes}>
        <legend className="sr-only">How are you getting there?</legend>
        {MODE_CHOICES.map((choice) => (
          <label
            key={choice.mode}
            className={styles.mode}
            data-checked={draft.travelMode === choice.mode ? "" : undefined}
          >
            <input
              type="radio"
              name={name}
              value={choice.mode}
              checked={draft.travelMode === choice.mode}
              onChange={() => onDraft({ ...draft, travelMode: choice.mode as TravelMode })}
            />
            <span>{choice.label}</span>
          </label>
        ))}
      </fieldset>
      <p className={attempted && !draft.travelMode ? styles.error : styles.hint}>
        Flights draw as an arc on the map, drives as a road line.
      </p>
    </div>
  );
}

export interface ReviewStepProps extends DraftProps {
  preview: PlanPreview | null;
}

/** Step 5: name the trip (optional) and read back what will be created. */
export function ReviewStep({ draft, onDraft, preview }: ReviewStepProps) {
  const nameId = useId();
  const places = placesOf(draft);
  const route = routeText(
    draft.origin ? { location: draft.origin } : null,
    places.map((location) => ({ location, arrive: "", leave: "" })),
  );
  const placeholder = tagTitle({ ...draft, name: null });
  const stops = draftStops(draft);
  return (
    <div className={styles.stepBody}>
      <div className={styles.field}>
        <label htmlFor={nameId}>Name this trip</label>
        <input
          id={nameId}
          type="text"
          maxLength={MAX_TRIP_NAME_LENGTH}
          value={draft.name ?? ""}
          placeholder={[placeholder.title, placeholder.also].filter(Boolean).join(" ")}
          autoComplete="off"
          onChange={(event) => onDraft({ ...draft, name: event.target.value })}
        />
        <p className={styles.hint}>Optional. Without a name the trip is called by its places.</p>
      </div>
      <dl className={styles.summary}>
        <dt>Route</dt>
        <dd>{route}</dd>
        <dt>Dates</dt>
        <dd>{whenSummary(draft)}</dd>
        <dt>Getting there</dt>
        <dd>{MODE_CHOICES.find((choice) => choice.mode === draft.travelMode)?.summary}</dd>
        {stops.length > 1 ? (
          <>
            <dt>Stops</dt>
            <dd>
              {stops
                .map((stop) => `${stop.location?.city ?? ""} ${stopRange(stop)}`.trim())
                .join(", ")}
            </dd>
          </>
        ) : null}
        <dt>List</dt>
        <dd>{preview ? `About ${preview.total} ${preview.total === 1 ? "item" : "items"}` : ""}</dd>
      </dl>
    </div>
  );
}
