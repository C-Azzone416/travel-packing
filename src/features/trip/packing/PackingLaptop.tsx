"use client";

import Link from "next/link";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { CubeRailItem, PackedRibbon, Suitcase } from "@/components/suitcase";
import { Icon } from "@/components/ui/Icon";
import type { Cube } from "@/domain/cubes";
import { laundryControlVisible } from "@/domain/short-trip";
import type { TripItem } from "@/domain/trip";
import type { LifecycleTrip } from "@/domain/trip-lifecycle";
import type { PackedState } from "../packed-state";
import { CubePanel, type AddOutcome } from "./CubePanel";
import { PackedBanner } from "./PackedBanner";
import type { PackingViewState } from "./use-packing-view-state";
import { PackingHeader } from "./PackingHeader";
import { buildCubeViews, headline, isPacked, type CubeView } from "./packing-model";
import styles from "./packing.module.css";

export interface PackingLaptopProps {
  trip: LifecycleTrip;
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
  /** What sits under the suitcase (the packing tools). */
  below?: ReactNode;
  /** Where the trip is on the way to Ready: drives the ribbon, the header line and the banner (#411). */
  state: PackedState;
  /** Opens the "Review your bag" sheet. */
  onReview: () => void;
  onNotReady: () => void;
  /** A Ready change is being saved. */
  readyBusy?: boolean;
  /** The "Everything is in" banner has not been dismissed this session. */
  bannerOpen: boolean;
  onDismissBanner: () => void;
  /** 768-1023 (#414): the same structure inside the phone shell, with the phone action bar as the panel footer. */
  tablet?: boolean;
  /** Packs every unpacked item of the cube in ONE change (resolves true when saved). Needed for the tablet footer. */
  onAllIn?: (view: CubeView) => Promise<boolean>;
  /** The open cube, filters, Edit list and All in progress, kept by the screen so a layout change loses none of them. */
  viewState: PackingViewState;
}

// The laptop (>= 1024px) Packing view (#385): header, Forecast, and the suitcase with the cube rail on the left and the
// open cube on the right. The screen keeps all data flow (saves, authorization, optimistic counts); this only draws.
export function PackingLaptop({
  trip,
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
  state,
  onReview,
  onNotReady,
  readyBusy,
  bannerOpen,
  onDismissBanner,
  tablet,
  onAllIn,
  viewState,
}: PackingLaptopProps) {
  const views = buildCubeViews(trip);
  // Laundry is offered only where it would change a quantity (a short trip hides it, #412).
  const laundryVisible = laundryControlVisible(trip);
  const {
    chosen,
    setChosen,
    filters,
    setFilters,
    editing,
    setEditing,
    packing,
    setPacking,
    addPending,
  } = viewState;
  const panelId = useId();
  const titleId = useId();
  const switched = useRef(false);
  const next = useRef<HTMLElement | null>(null);
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
  const following = views[views.indexOf(current) + 1];
  const allIn = async () => {
    if (packing || !onAllIn) return;
    setPacking(true);
    const saved = await onAllIn(current);
    setPacking(false);
    if (saved) next.current?.focus();
  };
  const bar =
    tablet && onAllIn ? (
      <div className={styles.tabletBar}>
        <button
          type="button"
          className={styles.tabletAllIn}
          disabled={current.items.every(isPacked) || packing}
          onClick={() => void allIn()}
        >
          All in
          <Icon name="check" size={18} />
        </button>
        {state === "packed" ? (
          <button
            type="button"
            className={styles.tabletNext}
            ref={(node) => {
              next.current = node;
            }}
            onClick={onReview}
          >
            Review your bag <span aria-hidden="true">›</span>
          </button>
        ) : following ? (
          <button
            type="button"
            className={styles.tabletNext}
            ref={(node) => {
              next.current = node;
            }}
            onClick={() => choose(following.cube)}
          >
            Next: {following.label} <span aria-hidden="true">›</span>
          </button>
        ) : (
          <Link
            href="/"
            className={styles.tabletNext}
            ref={(node) => {
              next.current = node;
            }}
          >
            Done <span aria-hidden="true">›</span>
          </Link>
        )}
      </div>
    ) : undefined;
  const totals = headline(trip);
  return (
    <div className={styles.page} data-packing-layout={tablet ? "tablet" : "laptop"}>
      <PackingHeader
        tripName={trip.destination}
        headline={totals}
        laundry={trip.config.laundry}
        laundryVisible={laundryVisible}
        laundryBusy={laundryBusy}
        onLaundry={onLaundry}
        onEditTrip={onEditTrip}
        state={state}
        onReview={onReview}
        onNotReady={onNotReady}
        readyBusy={readyBusy}
      />
      {forecast}
      <Suitcase interior="dark" className={styles.suitcase} ribbon={<PackedRibbon state={state} />}>
        {state === "packed" && bannerOpen ? (
          <PackedBanner
            className={styles.bannerInCase}
            onReview={onReview}
            onDismiss={onDismissBanner}
          />
        ) : null}
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
            editLocked={addPending.includes(current.cube)}
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
            bar={bar}
            panelId={panelId}
            titleId={titleId}
          />
        </div>
      </Suitcase>
      {below ? <div className={styles.below}>{below}</div> : null}
    </div>
  );
}
