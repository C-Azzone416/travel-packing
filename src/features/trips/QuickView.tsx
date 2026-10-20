"use client";

import { useState } from "react";
import { buttonClassName } from "@/components/ui/Button";
import Link from "next/link";
import { RouteText } from "./RouteText";
import { quickViewModel, routeCities, type QuickFilter } from "./view";
import type { LifecycleTrip } from "@/domain/trip-lifecycle";

// Read-only preview of a trip's list. The filter is local view state only: nothing
// here can write, so toggling it can never change a persisted value.
export function QuickView({ trip, id }: { trip: LifecycleTrip; id: string }) {
  const [filter, setFilter] = useState<QuickFilter>("still");
  const model = quickViewModel(trip, filter);
  const route = routeCities(trip);
  const count = model.categories.reduce((sum, entry) => sum + entry.rows.length, 0);

  return (
    <div className="quick-view" id={id}>
      <div className="quick-view-head">
        <div>
          <p className="eyebrow">Read-only preview</p>
          <h3>Packing quick view</h3>
        </div>
        <div
          className="quick-filters"
          role="group"
          aria-label={`Quick view filter for ${trip.destination}`}
        >
          <button
            type="button"
            aria-pressed={filter === "still"}
            onClick={() => setFilter("still")}
          >
            Still to pack
          </button>
          <button type="button" aria-pressed={filter === "all"} onClick={() => setFilter("all")}>
            All
          </button>
        </div>
      </div>
      {route.length ? (
        <p className="quick-view-route">
          <RouteText cities={route} budget={64} />
        </p>
      ) : null}
      <p className="sr-only" role="status" aria-label="Quick view result count">
        {count === 1 ? "1 item shown" : `${count} items shown`}
      </p>
      <div className="quick-view-list" role="region" aria-label="Quick view items" tabIndex={0}>
        {model.categories.length === 0 ? (
          <div className="empty-state compact">No items left in this view.</div>
        ) : (
          model.categories.map((category) => (
            <section key={category.title} className="quick-view-category">
              <h4>{category.title}</h4>
              {category.rows.map((row) => (
                <div key={row.id} className="quick-view-row">
                  <span className="quick-view-item-name">
                    {row.name}
                    {row.packLast ? <span className="timing-tag">Pack last</span> : null}
                  </span>
                  <strong>{row.detail}</strong>
                </div>
              ))}
            </section>
          ))
        )}
      </div>
      <div className="quick-bag-row">
        <span>
          <strong>Toiletry bag placement</strong>
          <small>Separate completion gate</small>
        </span>
        <span className={`quick-bag-status ${model.bag.status}`}>
          {model.bag.status === "complete" ? <span aria-hidden="true">✓ </span> : null}
          {model.bag.label}
        </span>
      </div>
      <Link
        className={buttonClassName({ variant: "secondary", small: true })}
        href={`/trips/${trip.id}`}
      >
        View full list
      </Link>
    </div>
  );
}
