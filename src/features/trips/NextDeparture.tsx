"use client";

import Link from "next/link";
import { useState } from "react";
import { Button, buttonClassName } from "@/components/ui/Button";
import { Stamps } from "@/components/stamp/Stamp";
import { selectStamps } from "@/domain/stamps";
import { MoreMenu } from "@/components/ui/MoreMenu";
import type { LifecycleTrip } from "@/domain/trip-lifecycle";
import { QuickView } from "./QuickView";
import { RouteText } from "./RouteText";
import type { DepartureView, TripCardView, WeatherCell } from "./view";

export type HeroWeather =
  | { phase: "none" }
  | { phase: "loading" }
  | { phase: "unavailable" }
  | { phase: "ready"; cells: WeatherCell[] };

const GLYPH: Record<WeatherCell["glyph"], string> = { sun: "☀", rain: "☂", snow: "❄" };

export interface NextDepartureProps {
  trip: LifecycleTrip;
  view: TripCardView;
  departure: DepartureView;
  weather: HeroWeather;
  busy: boolean;
  onEdit: (id: string) => void;
  onArchive: (id: string) => void;
  onRemove: (id: string) => void;
}

/**
 * The roomy hero for the next departure (#139 spec §4): route, dates and nights, the route stamps (the same selectStamps output
 * as the packing screen), a compact one-cell-per-stay weather strip, the days-to-go numeral, packed progress and the actions.
 * Continue packing is the one primary action; Edit trip and + Add item are secondary. + Add item is an interim: it opens
 * the trip screen with the existing add form (the inline input is #147).
 */
export function NextDeparture({
  trip,
  view,
  departure,
  weather,
  busy,
  onEdit,
  onArchive,
  onRemove,
}: NextDepartureProps) {
  const [quickOpen, setQuickOpen] = useState(false);
  const titleId = `next-title-${trip.id}`;
  const quickId = `quick-view-${trip.id}`;

  return (
    <article className="ledger-hero" aria-labelledby={titleId} aria-busy={busy}>
      <div className="ledger-hero-top">
        <div className="ledger-hero-copy">
          <p className="eyebrow">Next departure · {departure.startShort}</p>
          <h2 id={titleId}>{view.destination}</h2>
          {view.route.length && !view.routeIsTitle ? (
            <div className="item-meta">
              <RouteText cities={view.route} />
            </div>
          ) : view.place ? (
            <div className="item-meta">{view.place}</div>
          ) : null}
          <p className="ledger-dates">
            {departure.range} · {departure.nightsLabel}
          </p>
        </div>
        <div className="stamp-slot" data-stamp-slot>
          <Stamps stamps={selectStamps(trip.stops)} departure={trip.start} />
        </div>
      </div>

      {weather.phase === "ready" && weather.cells.length > 0 ? (
        <ul className="weather-strip" aria-label="Weather for each stay">
          {weather.cells.map((cell) => (
            <li key={cell.stopIndex}>
              <span className="weather-glyph" aria-hidden="true">
                {GLYPH[cell.glyph]}
              </span>
              <span className="weather-city">{cell.city}</span>
              <span className="weather-dates">{cell.dates}</span>
              <span className="weather-range">
                {cell.range} <small>{cell.source}</small>
              </span>
              <span className="weather-note">{cell.note}</span>
            </li>
          ))}
        </ul>
      ) : weather.phase === "unavailable" ? (
        <p className="weather-strip-note muted tiny">Weather is unavailable right now.</p>
      ) : null}

      <div className="ledger-hero-bottom">
        <div className="days-to-go">
          <strong>{departure.daysToGo}</strong>
          <span>{departure.daysLabel}</span>
        </div>
        <div className="ledger-progress">
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
          <div className="progress-copy">
            <span>
              {view.packed} of {view.total} packed
            </span>
            <span>{view.ready ? "Ready to go" : `${view.remaining} left`}</span>
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
          <Link
            className={buttonClassName({ variant: "secondary" })}
            href={`/trips/${trip.id}?add=item`}
            aria-label={`Add item: ${view.destination}`}
          >
            ＋ Add item
          </Link>
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
      </div>

      {quickOpen ? <QuickView trip={trip} id={quickId} /> : null}
    </article>
  );
}
