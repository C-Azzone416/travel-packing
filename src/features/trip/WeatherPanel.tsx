"use client";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import type { TripStop } from "@/domain/trip-stops";
import type { StopWeather } from "@/domain/weather/types";
import type { TemperatureUnit } from "@/server/data/weather-store";
import { displayTemperature, hasCoordinates, weatherRowView } from "./weather-view";

export type WeatherPanelState =
  | { kind: "prompt" }
  | { kind: "off" }
  | { kind: "loading" }
  | { kind: "offline" }
  | { kind: "ready"; stops: StopWeather[] };

export interface WeatherPanelProps {
  stops: TripStop[];
  state: WeatherPanelState;
  unit: TemperatureUnit;
  changesCount?: number;
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
  stops,
  state,
  unit,
  changesCount = 0,
  onOptIn,
  onDecline,
  onTurnOn,
  onRefresh,
  onReview,
}: WeatherPanelProps) {
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

  return (
    <Card
      as="section"
      padded
      className="weather-panel"
      aria-labelledby="weather-heading"
      aria-label={`Weather in degrees ${unit === "F" ? "Fahrenheit" : "Celsius"}`}
    >
      <div className="weather-panel-head">
        <h2 id="weather-heading">Weather</h2>
        <Button variant="ghost" small aria-label="Refresh weather" onClick={onRefresh}>
          ↻
        </Button>
      </div>
      {changesCount > 0 ? (
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
            const view = weather ? weatherRowView(stop, weather) : null;
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
    </Card>
  );
}
