"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { CubeRailItem, Suitcase } from "@/components/suitcase";
import type { Cube } from "@/domain/cubes";
import type { TripItem } from "@/domain/trip";
import type { LifecycleTrip } from "@/domain/trip-lifecycle";
import { CubePanel, type AddOutcome } from "./CubePanel";
import { PackingHeader } from "./PackingHeader";
import { buildCubeViews, headline, type CubeFilter } from "./packing-model";
import styles from "./packing.module.css";

export interface PackingLaptopProps {
  trip: LifecycleTrip;
  /** Which cube opens first (the Home tiles link here with ?cube=). Falls back to the first cube. */
  openCube?: Cube;
  failedRows: ReadonlySet<string>;
  laundryBusy: boolean;
  onLaundry: (next: boolean) => void;
  onEditTrip: () => void;
  onTick: (item: TripItem, packed: boolean) => void;
  onRetry: (itemId: string) => void;
  onEditItem: (itemId: string) => void;
  onMove: (item: TripItem, cube: Cube) => void;
  onRemove: (item: TripItem) => void;
  onMorningOf: (cube: Cube, on: boolean) => void;
  onAdd: (cube: Cube, name: string) => Promise<AddOutcome>;
  /** The Forecast block (cards and their review rows). */
  forecast: ReactNode;
  /** The toiletry bag step: drawn at the foot of the Toiletries cube. */
  toiletryExtra?: ReactNode;
  /** What sits under the suitcase until the Phase 3 issues (#411 all packed / Ready, #389 Edit trip) take it over. */
  below?: ReactNode;
}

// The laptop (>= 1024px) Packing view (#385): header, Forecast, and the suitcase with the cube rail on the left and the
// open cube on the right. The screen keeps all data flow (saves, authorization, optimistic counts); this only draws.
export function PackingLaptop({
  trip,
  openCube,
  failedRows,
  laundryBusy,
  onLaundry,
  onEditTrip,
  onTick,
  onRetry,
  onEditItem,
  onMove,
  onRemove,
  onMorningOf,
  onAdd,
  forecast,
  toiletryExtra,
  below,
}: PackingLaptopProps) {
  const views = buildCubeViews(trip);
  const [chosen, setChosen] = useState<Cube | undefined>(openCube);
  const [filters, setFilters] = useState<Partial<Record<Cube, CubeFilter>>>({});
  const [editing, setEditing] = useState(false);
  const panelId = useId();
  const titleId = useId();
  const switched = useRef(false);
  // The cube that is open: the chosen one while it is still drawn (an emptied cube disappears), else the first.
  const current = views.find((view) => view.cube === chosen) ?? views[0];

  // Choosing another cube moves focus to its title, so a keyboard user lands on what they opened.
  useEffect(() => {
    if (!switched.current) return;
    switched.current = false;
    document.getElementById(titleId)?.focus();
  }, [current.cube, titleId]);

  const choose = (cube: Cube) => {
    if (cube === current.cube) return;
    switched.current = true;
    setEditing(false);
    setChosen(cube);
  };
  const totals = headline(trip);
  return (
    <div className={styles.page} data-packing-layout="laptop">
      <PackingHeader
        tripName={trip.destination}
        headline={totals}
        laundry={trip.config.laundry}
        laundryBusy={laundryBusy}
        onLaundry={onLaundry}
        onEditTrip={onEditTrip}
      />
      {forecast}
      <Suitcase interior="dark" className={styles.suitcase}>
        <div className={styles.case}>
          <nav className={styles.rail} aria-label="Cubes">
            <ul>
              {views.map((view) => (
                <li key={view.cube}>
                  <CubeRailItem
                    name={view.label}
                    packed={view.packed}
                    total={view.total}
                    note={view.note}
                    morningOf={view.morningOf}
                    alert={view.alert}
                    selected={view.cube === current.cube}
                    controls={panelId}
                    onSelect={() => choose(view.cube)}
                  />
                </li>
              ))}
            </ul>
          </nav>
          <CubePanel
            key={current.cube}
            view={current}
            cubes={views}
            filter={filters[current.cube] ?? "all"}
            onFilter={(filter) => setFilters((all) => ({ ...all, [current.cube]: filter }))}
            editing={editing}
            onEditing={setEditing}
            laundry={trip.config.laundry}
            failedRows={failedRows}
            onTick={onTick}
            onRetry={onRetry}
            onEditItem={onEditItem}
            onMove={onMove}
            onRemove={onRemove}
            onMorningOf={onMorningOf}
            onAdd={onAdd}
            extra={current.cube === "toiletries" ? toiletryExtra : undefined}
            panelId={panelId}
            titleId={titleId}
          />
        </div>
      </Suitcase>
      {below ? <div className={styles.below}>{below}</div> : null}
    </div>
  );
}
