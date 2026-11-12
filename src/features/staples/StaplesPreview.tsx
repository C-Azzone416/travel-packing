"use client";

import { useId, useRef, type CSSProperties } from "react";
import { Icon } from "@/components/ui/Icon";
import {
  MAX_NIGHTS,
  MIN_NIGHTS,
  itemsLabel,
  nightsLabel,
  type PreviewSummary,
} from "./staples-cubes";
import styles from "./Staples.module.css";

export interface StaplesPreviewProps {
  laptop: boolean;
  /** The opt-in "Preview a trip" mode. Off on every load; never stored. */
  on: boolean;
  onToggle: (on: boolean) => void;
  nights: number;
  onNights: (nights: number) => void;
  laundry: boolean;
  onLaundry: (on: boolean) => void;
  summary: PreviewSummary;
}

/** "Laundry saves 2 (anything marked ↻ is halved)." / "Laundry would save 2. Underwear and socks stay one per day." */
export function laundryNote(laundry: boolean, saves: number): string {
  if (!laundry) return `Laundry would save ${saves}. Underwear and socks stay one per day.`;
  return `Laundry saves ${saves} (anything marked ↻ is halved).`;
}

/** The status sentence when the preview turns on, and its text for the panel's total. */
export const previewTotalText = (total: number, nights: number): string =>
  `${itemsLabel(total)} for ${nightsLabel(nights)}`;

// The opt-in preview (#491). Off: a quiet card on a laptop (the column stays reserved) and one collapsed bar above the tab
// bar on a phone. On: the slider, the laundry switch, the total and "By cube"; the rows gain their own totals. The rows
// are never listed a second time here. Every number comes from the domain calculator through `previewStaples`.
export function StaplesPreview({
  laptop,
  on,
  onToggle,
  nights,
  onNights,
  laundry,
  onLaundry,
  summary,
}: StaplesPreviewProps) {
  const sliderId = useId();
  const switchId = useId();
  const previewSwitchId = useId();
  const bodyId = useId();
  const barRef = useRef<HTMLButtonElement>(null);
  const percent = ((nights - MIN_NIGHTS) / (MAX_NIGHTS - MIN_NIGHTS)) * 100;

  const controls = (
    <>
      <div className={laptop ? styles.sliderRow : "sr-only"}>
        <label htmlFor={sliderId}>Preview a trip of</label>
        <span className={styles.sliderValue} aria-hidden="true">
          {nightsLabel(nights)}
        </span>
      </div>
      <input
        id={sliderId}
        className={styles.slider}
        type="range"
        min={MIN_NIGHTS}
        max={MAX_NIGHTS}
        step={1}
        value={nights}
        aria-valuetext={nightsLabel(nights)}
        style={{ "--fill": `${percent}%` } as CSSProperties}
        onChange={(event) => onNights(Number(event.target.value))}
      />
      <label className={styles.switchRow} htmlFor={switchId}>
        Laundry on the trip
        <input
          id={switchId}
          className={styles.switchInput}
          type="checkbox"
          role="switch"
          checked={laundry}
          onChange={(event) => onLaundry(event.target.checked)}
        />
        <span className={styles.switchTrack} aria-hidden="true" />
      </label>
    </>
  );

  if (!laptop) {
    return (
      <aside className={styles.preview} aria-label="Preview">
        <div className={styles.previewTop}>
          <button
            ref={barRef}
            type="button"
            className={styles.dockTitle}
            aria-expanded={on}
            aria-controls={bodyId}
            onClick={() => onToggle(!on)}
          >
            {on ? `Preview: ${nightsLabel(nights)}` : "Preview a trip"}
            <Icon name="chevronRight" size={16} />
          </button>
          {on ? (
            <span className={styles.big} role="status">
              <span className={styles.bigNumber}>{summary.total}</span>
              <span className={styles.bigUnit}>{summary.total === 1 ? "item" : "items"}</span>
            </span>
          ) : null}
        </div>
        <div id={bodyId} className={styles.dockBody} hidden={!on}>
          {controls}
          <p className={styles.note}>{laundryNote(laundry, summary.saves)}</p>
          <button
            type="button"
            className={styles.dockOff}
            onClick={() => {
              // The dock body hides with this click: move focus to the bar that stays visible.
              barRef.current?.focus();
              onToggle(false);
            }}
          >
            Turn off
          </button>
        </div>
      </aside>
    );
  }

  return (
    <aside className={styles.preview} aria-label="Preview">
      {on ? (
        <p className={styles.previewEyebrow}>Preview</p>
      ) : (
        <>
          <h2 className={styles.previewTitle}>Preview a trip</h2>
          <p className={styles.note}>
            See what these rules add up to for a trip of any length. Nothing here changes your
            Staples.
          </p>
        </>
      )}
      <label className={styles.switchRow} htmlFor={previewSwitchId}>
        Preview a trip
        <input
          id={previewSwitchId}
          className={styles.switchInput}
          type="checkbox"
          role="switch"
          checked={on}
          aria-controls={bodyId}
          onChange={(event) => onToggle(event.target.checked)}
        />
        <span className={styles.switchTrack} aria-hidden="true" />
      </label>
      <div id={bodyId} hidden={!on}>
        {controls}
        <div className={styles.panelBlock}>
          <span className={styles.big} role="status">
            <span className={styles.bigNumber}>{summary.total}</span>
            <span className={styles.bigUnit}>
              {`${summary.total === 1 ? "item" : "items"} for ${nightsLabel(nights)}`}
            </span>
          </span>
          <p className={styles.note}>{laundryNote(laundry, summary.saves)}</p>
        </div>
        <div className={styles.panelBlock}>
          <h2 className={styles.previewEyebrow}>By cube</h2>
          <ul className={styles.byCube}>
            {summary.perCube.map(({ cube, label, items }) => (
              <li key={cube}>
                <span>{label}</span>
                <b>{items}</b>
              </li>
            ))}
          </ul>
        </div>
        <div className={styles.panelBlock}>
          <p className={styles.footnote}>
            Weather suggestions and special items are added on top when you plan a real trip.
          </p>
        </div>
      </div>
    </aside>
  );
}
