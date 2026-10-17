"use client";

import Link from "next/link";
import { useState } from "react";
import { DestinationArt } from "@/components/art/DestinationArt";
import { Button, buttonClassName } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { StatusBadge } from "@/components/ui/StatusBadge";
import type { LifecycleTrip } from "@/domain/trip-lifecycle";
import { QuickView } from "./QuickView";
import type { TripCardView } from "./view";

export interface TripCardProps {
  trip: LifecycleTrip;
  view: TripCardView;
  /** Only the first card on the page loads its art eagerly. */
  first: boolean;
  /** An action on this card is saving: its buttons are disabled until the server confirms. */
  busy: boolean;
  onArchive: (id: string) => void;
  onRestore: (id: string) => void;
  onRemove: (id: string) => void;
}

export function TripCard({
  trip,
  view,
  first,
  busy,
  onArchive,
  onRestore,
  onRemove,
}: TripCardProps) {
  const [quickOpen, setQuickOpen] = useState(false);
  const quickId = `quick-view-${trip.id}`;
  const status = view.ready ? (
    <StatusBadge status="ready">Ready to go</StatusBadge>
  ) : (
    <StatusBadge status="remaining">{view.remaining} left to pack</StatusBadge>
  );

  return (
    <Card
      as="article"
      className="trip-card"
      aria-labelledby={`trip-title-${trip.id}`}
      aria-busy={busy}
    >
      <DestinationArt locationId={trip.location?.id} variant="card" priority={first} />
      <div className="trip-card-body">
        <div className="trip-top">
          <div>
            {view.eyebrow ? <p className="eyebrow">{view.eyebrow}</p> : null}
            <h2 id={`trip-title-${trip.id}`}>{view.destination}</h2>
            {view.place ? <div className="item-meta">{view.place}</div> : null}
          </div>
          {status}
        </div>
        <div className="meta">
          <span>◷ {view.range}</span>
          <span>{view.days} days</span>
          {view.forecast ? <span>{view.forecast} · Simulated</span> : null}
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
        <div className="progress-copy">
          <span>
            {view.packed} of {view.total} packed
          </span>
          <span>{view.percent}%</span>
        </div>
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
        {quickOpen ? <QuickView trip={trip} id={quickId} /> : null}
        <div className="actions">
          <Link
            className={buttonClassName({ small: true })}
            href={`/trips/${trip.id}`}
            aria-label={`${view.ready ? "Review bag" : "Keep packing"}: ${view.destination}`}
          >
            {view.ready ? "Review bag" : "Keep packing"}
          </Link>
          <Link
            className={buttonClassName({ variant: "secondary", small: true })}
            href={`/trips/new?copy=${trip.id}`}
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
          {view.canRestore ? (
            <Button
              variant="secondary"
              small
              disabled={busy}
              aria-label={`Restore: ${view.destination}`}
              onClick={() => onRestore(trip.id)}
            >
              Restore
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
      </div>
    </Card>
  );
}
