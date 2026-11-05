"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Icon } from "@/components/ui/Icon";
import { WeatherDayTile } from "@/components/suitcase";
import type { WeatherIconName } from "@/components/suitcase/WeatherDayTile";
import { cx } from "@/components/suitcase/cx";
import type { TripStop } from "@/domain/trip-stops";
import type { StopWeather } from "@/domain/weather/types";
import type { TemperatureUnit } from "@/server/data/weather-store";
import type { WeatherPanelState } from "../WeatherPanel";
import {
  displayTemperature,
  rainLine,
  weatherRowView,
  type DayView,
  type WeatherRowView,
} from "../weather-view";
import type { Suggestion } from "./packing-model";
import styles from "./packing.module.css";

/** The most forecast tiles a city card draws. */
export const CARD_DAY_CAP = 7;

const ICON_FOR: Record<DayView["glyph"], WeatherIconName> = {
  sun: "sun",
  rain: "rain",
  snow: "cloud",
};

export interface ForecastSectionProps {
  stops: readonly TripStop[];
  state: WeatherPanelState;
  unit: TemperatureUnit;
  /** Today as YYYY-MM-DD, for the day labels. */
  today: string;
  /** Pending weather changes, one row each. They are not on the list until added. */
  suggestions: readonly Suggestion[];
  /** A decision is being saved: the Add and Dismiss buttons wait. */
  busy: boolean;
  onResolve: (suggestion: Suggestion, decision: "add" | "dismiss") => void;
  onRefresh: () => void;
  /**
   * What stands in for the cards while weather is off, asking, loading, offline or unavailable. Today that is the existing
   * Weather panel; #408 replaces it with the dashed "Usual weather" rows (this is the integration point).
   */
  placeholder: ReactNode;
}

/** "New: rain · not on your list until you add them" */
export function reviewHeading(suggestions: readonly Suggestion[]): string {
  const tags = [
    ...new Set(
      suggestions.flatMap((entry) =>
        entry.change.kind === "add" ? [entry.change.item.tag.toLowerCase()] : [],
      ),
    ),
  ];
  return `New: ${tags.length ? tags.join(", ") : "weather changes"} · not on your list until you add them`;
}

function CityCard({
  stop,
  weather,
  unit,
  today,
  suggestions,
  busy,
  open,
  onToggle,
  onResolve,
  onRefresh,
}: {
  stop: TripStop;
  open: boolean;
  onToggle: () => void;
  weather: StopWeather | undefined;
  unit: TemperatureUnit;
  today: string;
  suggestions: readonly Suggestion[];
  busy: boolean;
  onResolve: ForecastSectionProps["onResolve"];
  onRefresh: () => void;
}) {
  const base = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const region = useRef<HTMLDivElement>(null);
  const view: WeatherRowView | null = weather ? weatherRowView(stop, weather, unit, today) : null;
  const pending = suggestions.length;
  const outlined = pending > 0;
  const refocus = useRef(false);

  // After a row is added or dismissed it is gone: focus goes to the next row's Add button, or to the city when none is left.
  useEffect(() => {
    if (!refocus.current) return;
    refocus.current = false;
    const next = region.current?.querySelector<HTMLElement>("[data-suggestion-add]");
    (next ?? heading.current)?.focus();
  }, [pending]);

  const days = view?.forecastDays ?? [];
  const weight = Math.max(1, view?.nights ?? 1);
  return (
    <article
      className={cx(styles.city, outlined && styles.cityAlert)}
      style={{ ["--days" as string]: weight }}
      aria-labelledby={`${base}-city`}
      data-city-state={outlined ? "alert" : "normal"}
    >
      <div className={styles.cityHead}>
        <h3 id={`${base}-city`} className={styles.cityName} ref={heading} tabIndex={-1}>
          {stop.location.city}
        </h3>
        {view ? <span className={styles.cityDates}>{view.dates}</span> : null}
        <span className={styles.citySpacer} />
        {outlined ? (
          <button
            type="button"
            className={styles.review}
            aria-expanded={open}
            aria-controls={`${base}-review`}
            onClick={onToggle}
          >
            <span className={styles.reviewDot} aria-hidden="true" />
            {pending} to review
            <Icon name={open ? "caretUp" : "caretDown"} size={14} />
          </button>
        ) : (
          <span className={styles.noChanges}>No changes</span>
        )}
      </div>
      {!view ? (
        <p className={styles.cityNote}>
          Weather isn’t available for this stop right now.{" "}
          <button type="button" className={styles.linkButton} onClick={onRefresh}>
            Try again
          </button>
        </p>
      ) : view.forecast ? (
        <>
          <ol className={styles.days} aria-label={`Daily forecast for ${view.city}`}>
            {days.slice(0, CARD_DAY_CAP).map((day) => (
              <li key={day.date}>
                <WeatherDayTile
                  day={day.parts.weekday}
                  date={String(day.parts.day)}
                  icon={ICON_FOR[day.glyph]}
                  high={day.high}
                  low={day.low}
                  precipProbability={day.rainPercent / 100}
                />
              </li>
            ))}
          </ol>
          {days.length > CARD_DAY_CAP ? (
            <p className={styles.cityNote}>
              Showing the first {CARD_DAY_CAP} of {days.length} forecast days.
            </p>
          ) : null}
        </>
      ) : (
        // A stay with no forecast days yet. #408 draws these as the dashed "Usual weather" rows.
        <p className={cx(styles.cityNote, styles.usual)}>
          Typical for these dates: High {displayTemperature(view.high, unit)}° · Low{" "}
          {displayTemperature(view.low, unit)}° ·{" "}
          {rainLine(
            { high: view.high, low: view.low, rainDays: view.rainDays, totalDays: view.totalDays },
            "Rarely rains",
          )}
        </p>
      )}
      <div
        id={`${base}-review`}
        ref={region}
        className={styles.reviewRegion}
        hidden={!open || !outlined}
      >
        {outlined ? (
          <>
            <p className={styles.reviewHeading}>{reviewHeading(suggestions)}</p>
            <ul className={styles.suggestions}>
              {suggestions.map((entry) => (
                <li key={`${entry.change.semanticId}:${entry.change.ruleSignature}`}>
                  <span className={styles.suggestionText}>
                    <strong>{entry.name}</strong>
                    <span className={styles.suggestionTo}>
                      <span aria-hidden="true">→</span> {entry.destination}
                    </span>
                  </span>
                  <button
                    type="button"
                    className={styles.add}
                    data-suggestion-add
                    disabled={busy}
                    aria-label={`${entry.verb} ${entry.name}${entry.verb === "Add" ? ` to ${entry.destination}` : ""}`}
                    onClick={() => {
                      refocus.current = true;
                      onResolve(entry, "add");
                    }}
                  >
                    <Icon name={entry.verb === "Add" ? "plus" : "close"} size={14} />
                    {entry.verb}
                  </button>
                  <button
                    type="button"
                    className={styles.dismiss}
                    disabled={busy}
                    aria-label={`Dismiss ${entry.name}`}
                    onClick={() => {
                      refocus.current = true;
                      onResolve(entry, "dismiss");
                    }}
                  >
                    Dismiss
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </div>
    </article>
  );
}

// The Forecast block of the laptop Packing view (#376 part 3 section 1.3, part 2 section 6): one card per stop with its
// day tiles. A stop with pending weather changes is outlined and offers "N to review", which opens one row per change
// inside the card ("Rain shell → Rain gear  + Add  Dismiss"). Pending changes are not items, so no count includes them.
export function ForecastSection({
  stops,
  state,
  unit,
  today,
  suggestions,
  busy,
  onResolve,
  onRefresh,
  placeholder,
}: ForecastSectionProps) {
  const headingId = useId();
  // Which cards are open lives here, so a forecast that reloads (and redraws the cards) does not close them.
  const [openStops, setOpenStops] = useState<ReadonlySet<number>>(new Set());
  if (stops.length === 0) return null;
  const usable =
    state.kind === "ready" && !state.stops.every((entry) => entry.status === "unavailable");
  if (!usable) return <>{placeholder}</>;
  const pending = suggestions.length;
  return (
    <section className={styles.forecast} aria-labelledby={headingId}>
      <div className={styles.forecastHead}>
        <h2 id={headingId} className={styles.forecastTitle}>
          Forecast
        </h2>
        <p className={styles.forecastStatus}>
          {pending > 0 ? `${pending} new to review` : "No new changes"}
        </p>
      </div>
      <div className={styles.cards}>
        {stops.map((stop, index) => (
          <CityCard
            key={`${stop.location.id}-${index}`}
            stop={stop}
            weather={
              state.kind === "ready" ? state.stops.find((s) => s.stopIndex === index) : undefined
            }
            unit={unit}
            today={today}
            suggestions={suggestions.filter((entry) => entry.stopIndex === index)}
            busy={busy}
            open={openStops.has(index)}
            onToggle={() =>
              setOpenStops((current) => {
                const next = new Set(current);
                if (!next.delete(index)) next.add(index);
                return next;
              })
            }
            onResolve={onResolve}
            onRefresh={onRefresh}
          />
        ))}
      </div>
    </section>
  );
}
