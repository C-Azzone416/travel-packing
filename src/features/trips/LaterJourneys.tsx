"use client";

import Link from "next/link";
import { Button, buttonClassName } from "@/components/ui/Button";
import type { LifecycleTrip } from "@/domain/trip-lifecycle";
import { QuickView } from "./QuickView";
import { useState } from "react";
import { RouteText } from "./RouteText";
import { departureView, formatDays, type TripCardView } from "./view";

export interface LaterJourneyProps {
  trip: LifecycleTrip;
  view: TripCardView;
  today: string;
  busy: boolean;
  onArchive: (id: string) => void;
  onRemove: (id: string) => void;
}

function Journey({ trip, view, today, busy, onArchive, onRemove }: LaterJourneyProps) {
  const departure = departureView(trip, today);
  const [quickOpen, setQuickOpen] = useState(false);
  const quickId = `quick-view-${trip.id}`;
  return (
    <li>
      <article className="later-journey" aria-labelledby={`trip-title-${trip.id}`} aria-busy={busy}>
        <div className="later-days">
          <strong>{departure.daysToGo}</strong>
          <span>{departure.daysLabel}</span>
        </div>
        <div className="later-body">
          <p className="eyebrow">{departure.startShort}</p>
          <h3 id={`trip-title-${trip.id}`}>{view.destination}</h3>
          {view.route.length && !view.routeIsTitle ? (
            <div className="item-meta">
              <RouteText cities={view.route} />
            </div>
          ) : view.place ? (
            <div className="item-meta">{view.place}</div>
          ) : null}
          <p className="later-dates">
            {departure.range} · {departure.nightsLabel} · {formatDays(view.days)}
          </p>
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
          <div className="later-actions">
            <Link
              className="later-link"
              href={`/trips/${trip.id}`}
              aria-label={`${view.ready ? "Review bag" : "Keep packing"}: ${view.destination}`}
            >
              {view.ready ? "Review bag" : "Keep packing"}
            </Link>
            <button
              className="quick-view-toggle"
              type="button"
              aria-expanded={quickOpen}
              aria-controls={quickId}
              onClick={() => setQuickOpen((open) => !open)}
            >
              <span>Quick view</span>
              <span className="chevron" aria-hidden="true">
                {quickOpen ? "⌃" : "⌄"}
              </span>
            </button>
            <Link
              className={buttonClassName({ variant: "ghost", small: true })}
              href={`/trips/new?copy=${trip.id}`}
              aria-label={`Copy trip: ${view.destination}`}
            >
              Copy trip
            </Link>
            {view.canArchive ? (
              <Button
                variant="ghost"
                small
                disabled={busy}
                aria-label={`Archive: ${view.destination}`}
                onClick={() => onArchive(trip.id)}
              >
                Archive
              </Button>
            ) : null}
            <Button
              variant="ghost"
              small
              disabled={busy}
              aria-label={`Remove: ${view.destination}`}
              onClick={() => onRemove(trip.id)}
            >
              Remove
            </Button>
          </div>
          {quickOpen ? <QuickView trip={trip} id={quickId} /> : null}
        </div>
      </article>
    </li>
  );
}

/** The sidebar of later departures (#139 spec §4): days numeral, date eyebrow, title, dates, progress, Keep packing. */
export function LaterJourneys({
  entries,
  today,
  busy,
  onArchive,
  onRemove,
}: {
  entries: { trip: LifecycleTrip; view: TripCardView }[];
  today: string;
  busy: ReadonlySet<string>;
  onArchive: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <aside className="later-journeys" aria-labelledby="later-journeys-title">
      <p className="eyebrow">Afterwards</p>
      <h2 id="later-journeys-title">Later journeys</h2>
      {entries.length === 0 ? (
        <p className="muted tiny">Nothing else planned yet.</p>
      ) : (
        <ul>
          {entries.map(({ trip, view }) => (
            <Journey
              key={trip.id}
              trip={trip}
              view={view}
              today={today}
              busy={busy.has(trip.id)}
              onArchive={onArchive}
              onRemove={onRemove}
            />
          ))}
        </ul>
      )}
    </aside>
  );
}
