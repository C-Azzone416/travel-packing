"use client";

import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Icon } from "@/components/ui/Icon";
import { cx } from "@/components/suitcase/cx";
import { WEATHER_RULES } from "@/domain/weather/recommend";
import { Attribution } from "../WeatherPanel";
import { weatherRowView, type DayView, type WeatherRowView } from "../weather-view";
import { CityBody, ReviewRegion, type ForecastSectionProps } from "./ForecastSection";
import type { Suggestion } from "./packing-model";
import phone from "./packing-phone.module.css";
import styles from "./packing.module.css";

/** "Thu–Sat" (or "Thu"): the first and last rainy day of a city's forecast; null when no day is rainy. */
export function rainSpan(days: readonly DayView[]): string | null {
  const wet = days.filter((day) => day.rainPercent >= WEATHER_RULES.rainProbability * 100);
  if (wet.length === 0) return null;
  const first = wet[0].parts.weekday;
  const last = wet[wet.length - 1].parts.weekday;
  return first === last ? first : `${first}–${last}`;
}

/** The phone's line above the rows: "New: rain Thu–Sat". The laptop's longer sentence says the same thing with more room. */
export function phoneReviewHeading(
  suggestions: readonly Suggestion[],
  days: readonly DayView[],
): string {
  const tags = [
    ...new Set(
      suggestions.flatMap((entry) =>
        entry.change.kind === "add" ? [entry.change.item.tag.toLowerCase()] : [],
      ),
    ),
  ];
  const span = tags.length === 1 && tags[0] === "rain" ? rainSpan(days) : null;
  return `New: ${tags.length ? tags.join(", ") : "weather changes"}${span ? ` ${span}` : ""}`;
}

export type ForecastPhoneProps = ForecastSectionProps;

// The forecast card of the phone Packing view (#376 part 3 section 1.4, part 2 section 6): ONE city at a time. The city
// toggle is an ARIA tab list (roving tab stop, arrow keys, Home and End) with an accent dot after a city that has changes;
// "N to review" opens one row per change (Add / Dismiss) under the tiles. With several cities the toggle scrolls
// sideways inside the card, never the page.
export function ForecastPhone({
  stops,
  state,
  unit,
  today,
  suggestions,
  busy,
  onResolve,
  onRefresh,
  placeholder,
}: ForecastPhoneProps) {
  const base = useId();
  const [chosen, setChosen] = useState<number | null>(null);
  const [openStops, setOpenStops] = useState<ReadonlySet<number>>(new Set());
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);
  // Where focus goes when the last row of the open city is added or dismissed: the city's tab (or its name).
  const fallback = useRef<HTMLElement | null>(null);
  if (stops.length === 0) return null;
  const usable =
    state.kind === "ready" && !state.stops.every((entry) => entry.status === "unavailable");
  if (!usable) return <>{placeholder}</>;

  const pendingFor = (index: number) => suggestions.filter((entry) => entry.stopIndex === index);
  // Until a city is chosen, the one with changes comes first (the dot is on it), else the first stop.
  const firstAlert = stops.findIndex((_, index) => pendingFor(index).length > 0);
  const active = Math.min(chosen ?? (firstAlert < 0 ? 0 : firstAlert), stops.length - 1);
  const stop = stops[active];
  const mine = pendingFor(active);
  const view: WeatherRowView | null =
    state.kind === "ready"
      ? (() => {
          const weather = state.stops.find((entry) => entry.stopIndex === active);
          return weather ? weatherRowView(stop, weather, unit, today) : null;
        })()
      : null;
  const open = openStops.has(active);
  const anyPending = suggestions.length > 0;

  const choose = (index: number, focus = false) => {
    setChosen(index);
    if (focus) tabs.current[index]?.focus();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = stops.length - 1;
    const next =
      event.key === "ArrowRight"
        ? index === last
          ? 0
          : index + 1
        : event.key === "ArrowLeft"
          ? index === 0
            ? last
            : index - 1
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? last
              : null;
    if (next === null) return;
    event.preventDefault();
    choose(next, true);
  };

  const toggle: ReactNode =
    stops.length > 1 ? (
      <div className={phone.cityTabs} role="tablist" aria-label="City">
        {stops.map((entry, index) => {
          const changes = pendingFor(index).length;
          return (
            <button
              key={`${entry.location.id}-${index}`}
              ref={(node) => {
                tabs.current[index] = node;
                if (index === active) fallback.current = node;
              }}
              type="button"
              role="tab"
              id={`${base}-tab-${index}`}
              aria-selected={index === active}
              aria-controls={`${base}-panel`}
              tabIndex={index === active ? 0 : -1}
              className={cx(phone.cityTab, index === active && phone.cityTabOn)}
              onClick={() => choose(index)}
              onKeyDown={(event) => onKeyDown(event, index)}
            >
              <span className={phone.cityTabName}>{entry.location.city}</span>
              {changes > 0 ? (
                <>
                  <span className={phone.cityDot} aria-hidden="true" />
                  <span className="sr-only">, has changes to review</span>
                </>
              ) : null}
            </button>
          );
        })}
      </div>
    ) : (
      <h2
        className={phone.cityOnly}
        ref={(node) => {
          fallback.current = node;
        }}
        tabIndex={-1}
      >
        {stop.location.city}
      </h2>
    );

  return (
    <section
      className={cx(phone.phoneForecast, anyPending && phone.phoneForecastAlert)}
      aria-label="Forecast"
      data-forecast-state={anyPending ? "alert" : "normal"}
      data-review-open={open ? "true" : undefined}
    >
      <div className={phone.phoneForecastHead}>
        {toggle}
        {mine.length > 0 ? (
          <button
            type="button"
            className={cx(styles.review, phone.reviewPhone)}
            aria-expanded={open}
            aria-controls={`${base}-review`}
            onClick={() =>
              setOpenStops((current) => {
                const next = new Set(current);
                if (!next.delete(active)) next.add(active);
                return next;
              })
            }
          >
            <span className={styles.reviewDot} aria-hidden="true" />
            {mine.length} to review
            <Icon name={open ? "caretUp" : "caretDown"} size={14} />
          </button>
        ) : null}
      </div>
      <div
        id={`${base}-panel`}
        role={stops.length > 1 ? "tabpanel" : undefined}
        aria-labelledby={stops.length > 1 ? `${base}-tab-${active}` : undefined}
        className={phone.phonePanel}
      >
        <CityBody view={view} unit={unit} onRefresh={onRefresh} compact />
      </div>
      <ReviewRegion
        id={`${base}-review`}
        open={open}
        suggestions={mine}
        busy={busy}
        onResolve={onResolve}
        fallbackFocus={fallback}
        heading={phoneReviewHeading(mine, view?.forecastDays ?? [])}
      />
      <Attribution />
    </section>
  );
}
