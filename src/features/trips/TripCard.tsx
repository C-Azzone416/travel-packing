"use client";

import Link from "next/link";
import { useState } from "react";
import { DestinationArt } from "@/components/art/DestinationArt";
import { Button, buttonClassName } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { StatusBadge } from "@/components/ui/StatusBadge";
import type { LifecycleTrip } from "@/domain/trip-lifecycle";
import { QuickView } from "./QuickView";
import { RouteText } from "./RouteText";
import { formatDays, type TripCardView } from "./view";

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

/** Historical wording for a past trip: says what was packed, never what is left to do (spec #301). */
function pastStatus(view: TripCardView): {
  chip: string;
  ready: boolean;
  valueText: string;
} {
  if (view.total === 0) {
    return { chip: "No items", ready: false, valueText: "No items packed (0%)" };
  }
  if (view.ready) {
    return {
      chip: "Marked Ready",
      ready: true,
      valueText: `Marked Ready, packed ${view.packed} of ${view.total} (${view.percent}%)`,
    };
  }
  if (view.packed >= view.total) {
    return {
      chip: `All ${view.total} packed`,
      ready: false,
      valueText: `All ${view.total} packed (100%)`,
    };
  }
  return {
    chip: `Packed ${view.packed} of ${view.total}`,
    ready: false,
    valueText: `Packed ${view.packed} of ${view.total} (${view.percent}%)`,
  };
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
  const past = view.past ? pastStatus(view) : null;
  const status = past ? (
    <StatusBadge status={past.ready ? "ready" : "remaining"}>{past.chip}</StatusBadge>
  ) : view.ready ? (
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
      <DestinationArt theme={trip.theme} variant="card" priority={first} />
      <div className="trip-card-body">
        <div className="trip-top">
          <div>
            {view.eyebrow ? <p className="eyebrow">{view.eyebrow}</p> : null}
            <h2 id={`trip-title-${trip.id}`}>{view.destination}</h2>
            {view.route.length ? (
              <div className="item-meta">
                {view.routeIsTitle ? (
                  `${view.route.length} stops`
                ) : (
                  <RouteText cities={view.route} />
                )}
              </div>
            ) : view.place ? (
              <div className="item-meta">{view.place}</div>
            ) : null}
          </div>
          {status}
        </div>
        <div className="meta">
          <span>◷ {view.range}</span>
          <span>{formatDays(view.days)}</span>
        </div>
        <div
          className="progress-track"
          role="progressbar"
          aria-label={`${view.destination} packing progress`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={view.percent}
          aria-valuetext={past ? past.valueText : `${view.percent}% packed`}
        >
          <span style={{ width: `${view.percent}%` }} />
        </div>
        {past ? (
          <div className="progress-copy">
            <span>{view.percent}% packed</span>
          </div>
        ) : (
          <div className="progress-copy">
            <span>
              {view.packed} of {view.total} packed
            </span>
            <span>{view.percent}%</span>
          </div>
        )}
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
