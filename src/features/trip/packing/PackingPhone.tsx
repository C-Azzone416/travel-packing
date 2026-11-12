"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { CubeChip, PackedRibbon, Suitcase } from "@/components/suitcase";
import { cx } from "@/components/suitcase/cx";
import { Icon } from "@/components/ui/Icon";
import { laundryControlVisible } from "@/domain/short-trip";
import { CubePanel, FilterBar } from "./CubePanel";
import { PackedBanner } from "./PackedBanner";
import type { PackingLaptopProps } from "./PackingLaptop";
import { buildCubeViews, headline, isPacked, type CubeView } from "./packing-model";
import { useTextZoomed } from "./use-text-zoomed";
import styles from "./packing-phone.module.css";

export interface PackingPhoneProps extends Omit<PackingLaptopProps, "onEditTrip"> {
  /** Packs every unpacked item of the cube in ONE change. Resolves true when it was saved. */
  onAllIn: (view: CubeView) => Promise<boolean>;
}

// The phone (below 1024px) Packing view, "Pack mode" (#386; spec on #376 part 3 section 1.4): the header with the Laundry
// toggle and the count, the cube bar, ONE city's forecast, the filter pills and the pencil, the open cube in the suitcase,
// and the action bar ("All in ✓" and "Next: <cube>"). Like the laptop view it only draws: the screen owns every save.
export function PackingPhone({
  trip,
  failedRows,
  laundryBusy,
  onLaundry,
  onTick,
  onRetry,
  onEditItem,
  onMove,
  onRemove,
  onMorningOf,
  onAdd,
  onAllIn,
  viewState,
  forecast,
  toiletryExtra,
  below,
  state,
  onReview,
  onNotReady,
  readyBusy,
  bannerOpen,
  onDismissBanner,
}: PackingPhoneProps) {
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
  const [said, setSaid] = useState("");
  const panelId = useId();
  const titleId = useId();
  const switched = useRef(false);
  const bar = useRef<HTMLUListElement>(null);
  const next = useRef<HTMLElement | null>(null);
  const zoomed = useTextZoomed();
  const current = views.find((view) => view.cube === chosen) ?? views[0];
  const index = views.indexOf(current);
  const following = views[index + 1];
  const complete = current.items.every(isPacked);

  // Choosing another cube moves focus to its title, so a keyboard user lands on what they opened.
  useEffect(() => {
    if (!switched.current) return;
    switched.current = false;
    document.getElementById(titleId)?.focus();
  }, [current.cube, titleId]);

  // The open cube's chip is scrolled into view in the bar (the bar scrolls; the page does not).
  useEffect(() => {
    const list = bar.current;
    const chip = list?.querySelector<HTMLElement>("[aria-current]");
    if (!list || !chip) return;
    list.scrollLeft = chip.offsetLeft - (list.clientWidth - chip.offsetWidth) / 2;
  }, [current.cube]);

  const choose = (view: CubeView, say: boolean) => {
    if (view.cube === current.cube) return;
    switched.current = true;
    setEditing(false);
    setChosen(view.cube);
    if (say) setSaid(`${view.label}, ${view.packed} of ${view.total} packed.`);
  };

  const allIn = async () => {
    if (packing) return;
    setPacking(true);
    const saved = await onAllIn(current);
    setPacking(false);
    // The cube is done: the next thing to do is the Next button, so focus goes there.
    if (saved) next.current?.focus();
  };

  const totals = headline(trip);
  const filter = filters[current.cube] ?? "all";
  return (
    <div
      className={styles.page}
      data-packing-layout="phone"
      data-zoomed={zoomed ? "true" : undefined}
    >
      <div className={styles.stage}>
        <header className={styles.head}>
          <h1 id="trip-title" className={styles.title}>
            Pack mode
          </h1>
          <div className={styles.headEnd}>
            {laundryVisible ? (
              <button
                type="button"
                className={cx(
                  styles.laundry,
                  trip.config.laundry ? styles.laundryOn : styles.laundryOff,
                )}
                aria-pressed={trip.config.laundry}
                disabled={laundryBusy}
                onClick={() => onLaundry(!trip.config.laundry)}
              >
                <Icon name="refresh" size={16} />
                {trip.config.laundry ? "Laundry on" : "Laundry off"}
              </button>
            ) : null}
            <p className={styles.count} data-all-packed={state !== "open" ? "true" : undefined}>
              <span aria-hidden="true">
                <span className={styles.countNow}>{totals.packed}</span>
                <span className={styles.countOf}> / {totals.total}</span>
              </span>
              <span className="sr-only">
                {totals.packed} of {totals.total} in the bag
              </span>
              {state === "open" ? null : <span className="sr-only">All packed.</span>}
            </p>
          </div>
        </header>
        {state === "ready" ? (
          <div className={styles.readyRow}>
            <p className={styles.readyLine}>Ready to go</p>
            <button type="button" className={styles.textButton} onClick={onReview}>
              Review bag
            </button>
            <button
              type="button"
              className={styles.textButton}
              disabled={readyBusy}
              onClick={onNotReady}
            >
              Mark as not ready
            </button>
          </div>
        ) : null}

        <nav className={styles.barWrap} aria-label="Cubes">
          <ul className={styles.bar} ref={bar}>
            {views.map((view) => (
              <li key={view.cube}>
                <CubeChip
                  name={view.label}
                  packed={view.packed}
                  total={view.total}
                  morningOf={view.morningOf}
                  selected={view.cube === current.cube}
                  controls={panelId}
                  onSelect={() => choose(view, false)}
                />
              </li>
            ))}
          </ul>
        </nav>

        {forecast}

        <FilterBar
          view={current}
          filter={filter}
          onFilter={(value) => setFilters((all) => ({ ...all, [current.cube]: value }))}
          editing={editing}
          onEditing={setEditing}
          editLocked={addPending.some((entry) => entry.cube === current.cube)}
          className={styles.pills}
          phone
        />

        <Suitcase
          interior="paper"
          inset="none"
          className={styles.suitcase}
          ribbon={<PackedRibbon state={state} />}
        >
          <CubePanel
            key={current.cube}
            view={current}
            cubes={views}
            filter={filter}
            onFilter={(value) => setFilters((all) => ({ ...all, [current.cube]: value }))}
            editing={editing}
            onEditing={setEditing}
            editLocked={addPending.some((entry) => entry.cube === current.cube)}
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
            layout="phone"
          />
        </Suitcase>

        {state === "packed" && bannerOpen ? (
          <PackedBanner onReview={onReview} onDismiss={onDismissBanner} />
        ) : null}

        <div className={styles.actions}>
          <button
            type="button"
            className={styles.allIn}
            disabled={complete || packing}
            onClick={() => void allIn()}
          >
            All in
            <Icon name="check" size={18} />
          </button>
          {state === "packed" ? (
            <button
              type="button"
              className={styles.next}
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
              className={styles.next}
              ref={(node) => {
                next.current = node;
              }}
              onClick={() => choose(following, true)}
            >
              Next: {following.label} <span aria-hidden="true">›</span>
            </button>
          ) : (
            <Link
              href="/"
              className={styles.next}
              ref={(node) => {
                next.current = node;
              }}
            >
              Done <span aria-hidden="true">›</span>
            </Link>
          )}
        </div>
      </div>
      <p className="sr-only" role="status" aria-label="Cube">
        {said}
      </p>
      {below ? <div className={styles.below}>{below}</div> : null}
    </div>
  );
}
