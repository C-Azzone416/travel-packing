"use client";

import Link from "next/link";
import { useState } from "react";
import { Button, buttonClassName } from "@/components/ui/Button";
import { Stamps } from "@/components/stamp/Stamp";
import { selectStamps } from "@/domain/stamps";
import { MoreMenu } from "@/components/ui/MoreMenu";
import type { LifecycleTrip } from "@/domain/trip-lifecycle";
import { AddItemInline } from "@/features/trip/AddItemInline";
import { QuickView } from "./QuickView";
import type { NewCustomItem } from "./trips-source";
import { RouteText } from "./RouteText";
import type { DepartureView, HeroForecast, TripCardView, WeatherCell } from "./view";

export type HeroWeather =
  | { phase: "none" }
  | { phase: "loading" }
  | { phase: "unavailable" }
  | { phase: "ready"; cells: WeatherCell[]; forecast?: HeroForecast | null };

const GLYPH: Record<WeatherCell["glyph"], string> = { sun: "☀", rain: "☂", snow: "❄" };

/**
 * The daily forecast under the weather strip (#303): the first stay with forecast days, up to 7 of them. Chips on a wide
 * hero, 28px rows on a phone (CSS decides); a stay with more days links to the trip page for the rest.
 */
function HeroForecastBlock({ forecast, tripId }: { forecast: HeroForecast; tripId: string }) {
  return (
    <section className="hero-forecast" aria-label={`Forecast for ${forecast.city}`}>
      <p className="weather-part-head hero-forecast-head">
        <span className="weather-source forecast">Forecast</span>
        <span>{forecast.city}</span>
      </p>
      <ol className="hero-days">
        {forecast.days.map((day) => (
          <li key={day.date} className="hero-day">
            <span className="sr-only">{day.spoken}</span>
            <span className="hero-day-label" aria-hidden="true">
              {day.parts.weekday} <span className="hero-day-month">{day.parts.month} </span>
              {day.parts.day}
            </span>
            <span className="hero-day-glyph" aria-hidden="true">
              {GLYPH[day.glyph]}
            </span>
            <span className="hero-day-temps" aria-hidden="true">
              {day.high}° / {day.low}°
            </span>
          </li>
        ))}
      </ol>
      {forecast.more > 0 ? (
        <p className="hero-days-more">
          <Link
            href={`/trips/${tripId}`}
            aria-label={`${forecast.more} more forecast ${forecast.more === 1 ? "day" : "days"} for ${forecast.city} on the trip page`}
          >
            +{forecast.more} more {forecast.more === 1 ? "day" : "days"}
          </Link>
        </p>
      ) : null}
    </section>
  );
}

export interface NextDepartureProps {
  trip: LifecycleTrip;
  view: TripCardView;
  departure: DepartureView;
  weather: HeroWeather;
  busy: boolean;
  onEdit: (id: string) => void;
  /** The inline "＋ Add item" (#147): resolves true once the item is saved. */
  onAddItem: (item: NewCustomItem) => Promise<boolean>;
  /** Bathroom was chosen: the dashboard opens the Bathroom form with these values. */
  onBathroom: (name: string, qty: number) => void;
  /** The item is already on the list: go to the trip screen to edit its quantity. */
  onEditExisting: (itemId: string) => void;
  onArchive: (id: string) => void;
  onRemove: (id: string) => void;
}

/**
 * The roomy hero for the next departure (#139 spec §4): route, dates and nights, the route stamps (the same selectStamps output
 * as the packing screen), a compact one-cell-per-stay weather strip, the days-to-go numeral, packed progress and the actions.
 * Continue packing is the one primary action; Edit trip and ＋ Add item (a disclosed inline input, #147) are secondary.
 */
export function NextDeparture({
  trip,
  view,
  departure,
  weather,
  busy,
  onEdit,
  onAddItem,
  onBathroom,
  onEditExisting,
  onArchive,
  onRemove,
}: NextDepartureProps) {
  const [quickOpen, setQuickOpen] = useState(false);
  const [formHost, setFormHost] = useState<HTMLElement | null>(null);
  const titleId = `next-title-${trip.id}`;
  const quickId = `quick-view-${trip.id}`;

  return (
    <article className="ledger-hero" aria-labelledby={titleId} aria-busy={busy}>
      <div className="ledger-hero-top">
        <div className="ledger-hero-copy">
          <p className="eyebrow">Next departure · {departure.startShort}</p>
          <h2 id={titleId}>{view.destination}</h2>
          <p className="ledger-meta">
            <span className="ledger-meta-line">
              {view.route.length && !view.routeIsTitle ? (
                <span className="ledger-meta-place">
                  <RouteText cities={view.route} />
                </span>
              ) : view.place && !view.routeIsTitle ? (
                <span className="ledger-meta-place">{view.place}</span>
              ) : null}
              <span className="ledger-meta-dates">
                {departure.range} · {departure.nightsLabel}
              </span>
            </span>
          </p>
        </div>
        <div className="stamp-slot" data-stamp-slot>
          <Stamps stamps={selectStamps(trip.stops, trip.stampLabels)} departure={trip.start} />
        </div>
      </div>

      {weather.phase === "ready" && weather.cells.length > 0 ? (
        <>
          <ul className="weather-strip" aria-label="Weather for each stay">
            {weather.cells.map((cell) => (
              <li key={cell.stopIndex}>
                <div className="weather-cell-top">
                  <span className="weather-glyph" aria-hidden="true">
                    {GLYPH[cell.glyph]}
                  </span>
                  <span className="weather-city">{cell.city}</span>
                  <span className="weather-dates">{cell.dates}</span>
                  <span className="weather-range">
                    {cell.range} <small>{cell.source}</small>
                  </span>
                </div>
                <span className="weather-note">{cell.note}</span>
              </li>
            ))}
          </ul>
          {weather.forecast ? (
            <HeroForecastBlock forecast={weather.forecast} tripId={trip.id} />
          ) : null}
        </>
      ) : weather.phase === "unavailable" ? (
        <p className="weather-strip-note muted tiny">Weather is unavailable right now.</p>
      ) : null}

      <div className="ledger-status">
        <div className="ledger-status-row">
          <div className="days-to-go">
            <strong>{departure.daysToGo}</strong>
            <span>{departure.daysLabel}</span>
          </div>
          <div
            className="progress-track"
            role="progressbar"
            aria-label={`${view.destination} packing progress`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={view.percent}
            aria-valuetext={`${view.percent}% packed`}
          >
            <span style={{ width: `${view.percent}%` }} />
          </div>
          <div className="ledger-counts">
            <span>
              {view.packed} of {view.total} packed
            </span>
            <span>{view.ready ? "Ready to go" : `${view.remaining} left`}</span>
          </div>
        </div>
      </div>
      <div className="ledger-actions">
        <Link
          className={buttonClassName()}
          href={`/trips/${trip.id}`}
          aria-label={`${view.ready ? "Review bag" : "Continue packing"}: ${view.destination}`}
        >
          {view.ready ? "Review bag" : "Continue packing"}
        </Link>
        <Button
          variant="secondary"
          disabled={busy}
          aria-label={`Edit trip: ${view.destination}`}
          onClick={() => onEdit(trip.id)}
        >
          Edit trip
        </Button>
        <AddItemInline
          variant="hero"
          formHost={formHost}
          items={trip.items}
          busy={busy}
          onAdd={onAddItem}
          onBathroom={onBathroom}
          onEditExisting={onEditExisting}
        />
        <MoreMenu
          variant="secondary"
          subject={view.destination}
          disabled={busy}
          items={[
            {
              key: "quick",
              label: quickOpen ? "Hide quick view" : "Quick view",
              onSelect: () => setQuickOpen((open) => !open),
            },
            { key: "copy", label: "Copy trip", href: `/trips/new?copy=${trip.id}` },
            ...(view.canArchive
              ? [{ key: "archive", label: "Archive", onSelect: () => onArchive(trip.id) }]
              : []),
            { key: "remove", label: "Remove", danger: true, onSelect: () => onRemove(trip.id) },
          ]}
        />
      </div>

      <div className="add-item-host" ref={setFormHost} />
      {quickOpen ? <QuickView trip={trip} id={quickId} /> : null}
    </article>
  );
}
