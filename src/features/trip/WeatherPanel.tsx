"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import type { TripStop } from "@/domain/trip-stops";
import type { StopWeather } from "@/domain/weather/types";
import type { TemperatureUnit } from "@/server/data/weather-store";
import {
  displayTemperature,
  hasCoordinates,
  rainLine,
  todayUtc,
  typicalLine,
  weatherRowView,
  type PartSummary,
  type WeatherRowView,
} from "./weather-view";

/** The most forecast days a stay shows before "Show all N days" (#303). */
export const FORECAST_DAY_CAP = 7;

const GLYPH_MARK = { sun: "☀", rain: "☂", snow: "❄" } as const;

/** A stay with at least one forecast day: a labelled Forecast section, a daily list, and a Typical summary. */
function ForecastStay({ view, unit }: { view: WeatherRowView; unit: TemperatureUnit }) {
  const [expanded, setExpanded] = useState(false);
  const listId = useId();
  const forecast = view.forecast as PartSummary;
  const typical = view.typical;
  const shown = expanded ? view.forecastDays : view.forecastDays.slice(0, FORECAST_DAY_CAP);
  const extra = view.forecastDays.length > FORECAST_DAY_CAP;
  return (
    <>
      <div className="weather-place">
        <h3>{view.city}</h3>
        <p className="tiny muted">
          {view.dates} · {view.nights} {view.nights === 1 ? "night" : "nights"}
        </p>
      </div>
      <div className="weather-part">
        <p className="weather-part-head">
          <span className="weather-source forecast">Forecast</span>
          <span>
            High {displayTemperature(forecast.high, unit)}° · Low{" "}
            {displayTemperature(forecast.low, unit)}° · {rainLine(forecast, "No rain expected")}
          </span>
        </p>
        <ol id={listId} className="weather-days" aria-label={`Daily forecast for ${view.city}`}>
          {shown.map((day) => (
            <li key={day.date} className="weather-day">
              <span className="sr-only">{day.spoken}</span>
              <span className="weather-day-label" aria-hidden="true">
                {day.label}
              </span>
              <span className="weather-day-glyph" aria-hidden="true">
                {GLYPH_MARK[day.glyph]}
              </span>
              <span className="weather-day-temps" aria-hidden="true">
                {day.high}° / {day.low}°
              </span>
              <span className="weather-day-rain" aria-hidden="true">
                {day.rainPercent}% rain
              </span>
            </li>
          ))}
        </ol>
        {extra ? (
          <button
            type="button"
            className="link-button weather-days-toggle"
            aria-expanded={expanded}
            aria-controls={listId}
            onClick={() => setExpanded(!expanded)}
          >
            {expanded
              ? `Show first ${FORECAST_DAY_CAP}`
              : `Show all ${view.forecastDays.length} days`}
          </button>
        ) : null}
      </div>
      {typical ? (
        <p className="weather-part-head weather-typical-part">
          <span className="weather-source typical">Typical</span>
          <span>{typicalLine(typical, unit)}</span>
        </p>
      ) : null}
    </>
  );
}

export type WeatherPanelState =
  | { kind: "prompt" }
  | { kind: "off" }
  | { kind: "loading" }
  | { kind: "offline" }
  | { kind: "ready"; stops: StopWeather[] };

/** The "weather check" band (#155): shown full width under the hero only when the forecast moved. */
export function WeatherReviewBanner({
  changesCount,
  onReview,
}: {
  changesCount: number;
  onReview: () => void;
}) {
  if (changesCount <= 0) return null;
  return (
    <div className="weather-review-banner" role="region" aria-label="Weather check">
      <div>
        <span className="weather-check-label">Weather check</span>
        <strong>
          {changesCount} weather {changesCount === 1 ? "change" : "changes"} to review
        </strong>
      </div>
      <Button small onClick={onReview}>
        Review changes
      </Button>
    </div>
  );
}

export interface WeatherPanelProps {
  /** Rendered inside the trip hero as its weather strip: no card, and the review band is drawn elsewhere. */
  embedded?: boolean;
  stops: TripStop[];
  state: WeatherPanelState;
  unit: TemperatureUnit;
  changesCount?: number;
  /** Today as YYYY-MM-DD (UTC) for the "Today" label; defaults to the clock. */
  today?: string;
  onOptIn: () => void;
  onDecline: () => void;
  onTurnOn: () => void;
  onRefresh: () => void;
  onReview: () => void;
}

function Attribution() {
  return (
    <a
      className="weather-attribution tiny"
      href="https://open-meteo.com/"
      target="_blank"
      rel="noopener noreferrer"
    >
      Weather data by Open-Meteo.com
    </a>
  );
}

function Skeleton({ count }: { count: number }) {
  return (
    <ul className="weather-list weather-skeleton" aria-busy="true">
      <span className="sr-only">Loading weather for your stops</span>
      {Array.from({ length: count }, (_, index) => (
        <li key={index}>
          <span className="skeleton-city" />
          <span className="skeleton-dates" />
          <span className="skeleton-range" />
        </li>
      ))}
    </ul>
  );
}

export function WeatherPanel({
  embedded = false,
  stops,
  state,
  unit,
  changesCount = 0,
  today,
  onOptIn,
  onDecline,
  onTurnOn,
  onRefresh,
  onReview,
}: WeatherPanelProps) {
  const dayToday = today ?? todayUtc();
  const customOnly = stops.every((stop) => !hasCoordinates(stop));

  if (state.kind === "prompt") {
    if (customOnly) {
      return (
        <Card
          as="section"
          padded
          className="weather-panel weather-compact"
          aria-labelledby="weather-heading"
        >
          <h2 id="weather-heading">Weather</h2>
          <p>Weather needs a place from the map. Custom places are skipped.</p>
        </Card>
      );
    }
    return (
      <Card
        as="section"
        padded
        className="weather-panel weather-opt-in"
        aria-labelledby="weather-heading"
      >
        <h2 id="weather-heading">Get weather for your stops?</h2>
        <p>
          Only map coordinates and dates are sent to Open-Meteo. We never send your trip name, your
          places’ names, or who you are.
        </p>
        <p className="tiny muted">You can change this any time in Settings.</p>
        <div className="weather-opt-actions">
          <Button onClick={onOptIn}>Get weather</Button>
          <Button variant="secondary" onClick={onDecline}>
            Not now
          </Button>
        </div>
        <Attribution />
      </Card>
    );
  }

  if (state.kind === "off") {
    return (
      <Card
        as="section"
        padded
        className="weather-panel weather-off"
        aria-labelledby="weather-heading"
      >
        <h2 id="weather-heading">Weather</h2>
        <p>
          Weather is off.{" "}
          <button type="button" className="link-button" onClick={onTurnOn}>
            Turn on
          </button>
        </p>
      </Card>
    );
  }

  const allUnavailable =
    state.kind === "ready" && state.stops.every((stop) => stop.status === "unavailable");
  const anyTypical =
    state.kind === "ready" &&
    state.stops.some((stop) => stop.days.some((day) => day.source === "typical"));

  const Wrapper = embedded ? "section" : Card;
  const wrapperProps = embedded
    ? { className: "weather-panel weather-embedded" }
    : { as: "section" as const, padded: true, className: "weather-panel" };
  return (
    <Wrapper
      {...wrapperProps}
      aria-labelledby="weather-heading"
      aria-label={`Weather in degrees ${unit === "F" ? "Fahrenheit" : "Celsius"}`}
    >
      <div className="weather-panel-head">
        <h2 id="weather-heading">Weather</h2>
        <Button variant="ghost" small aria-label="Refresh weather" onClick={onRefresh}>
          ↻
        </Button>
      </div>
      {!embedded && changesCount > 0 ? (
        <div className="weather-review-banner">
          <strong>
            {changesCount} weather {changesCount === 1 ? "change" : "changes"} to review
          </strong>
          <Button small onClick={onReview}>
            Review changes
          </Button>
        </div>
      ) : null}
      {state.kind === "loading" ? <Skeleton count={stops.length} /> : null}
      {state.kind === "offline" ? <p>You’re offline. Weather will load when you’re back.</p> : null}
      {allUnavailable ? (
        <div className="weather-unavailable">
          <p>We couldn’t reach the weather service. Your list is unchanged.</p>
          <Button variant="ghost" small onClick={onRefresh}>
            Try again
          </Button>
        </div>
      ) : null}
      {state.kind === "ready" && !allUnavailable ? (
        <ul className="weather-list" aria-label="Weather by stop">
          {stops.map((stop, index) => {
            const weather = state.stops.find((entry) => entry.stopIndex === index);
            const view = weather ? weatherRowView(stop, weather, unit, dayToday) : null;
            if (!view) {
              const custom = !hasCoordinates(stop);
              return (
                <li key={`${stop.location.id}-${index}`} className="weather-row unavailable">
                  <div>
                    <h3>{stop.location.city}</h3>
                    <p className="tiny muted">
                      {custom
                        ? "No weather for custom places. Choose a map place to see it."
                        : "Weather isn’t available right now."}
                    </p>
                  </div>
                  {!custom ? (
                    <Button variant="ghost" small onClick={onRefresh}>
                      Try again
                    </Button>
                  ) : null}
                </li>
              );
            }
            if (view.forecast) {
              return (
                <li
                  key={`${stop.location.id}-${index}`}
                  className="weather-row weather-row-forecast"
                >
                  <ForecastStay view={view} unit={unit} />
                </li>
              );
            }
            const source = view.source === "forecast" ? "Forecast" : "Typical for these dates";
            const rain =
              view.rainDays > 0
                ? `Rain on ${view.rainDays} of ${view.totalDays} days`
                : view.source === "forecast"
                  ? "No rain expected"
                  : "Rarely rains";
            return (
              <li key={`${stop.location.id}-${index}`} className="weather-row">
                <div className="weather-place">
                  <h3>{view.city}</h3>
                  <p className="tiny muted">
                    {view.dates} · {view.nights} {view.nights === 1 ? "night" : "nights"}
                  </p>
                </div>
                <div className="weather-range">
                  <span aria-hidden="true">
                    {view.glyph === "snow" ? "❄" : view.glyph === "rain" ? "☂" : "☀"}
                  </span>
                  <strong>
                    High {displayTemperature(view.high, unit)}° · Low{" "}
                    {displayTemperature(view.low, unit)}°
                  </strong>
                </div>
                <span className={view.rainDays ? "weather-rain tag" : "tiny muted"}>{rain}</span>
                <span className={`weather-source ${view.source}`}>{source}</span>
                {view.mixed ? (
                  <p className="weather-mixed tiny muted">
                    Later days are typical for these dates.
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
      {anyTypical ? (
        <p className="tiny muted">
          Typical weather is an average of the last 5 years, not a forecast.
        </p>
      ) : null}
      <Attribution />
    </Wrapper>
  );
}
