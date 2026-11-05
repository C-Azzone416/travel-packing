"use client";

import { useId, useState, type CSSProperties } from "react";
import { Icon } from "@/components/ui/Icon";
import { useMediaQuery } from "@/components/ui/useMediaQuery";
import { LaundryMarker } from "@/components/suitcase/Markers";
import {
  MAX_NIGHTS,
  MIN_NIGHTS,
  nightsLabel,
  scalesWithTrip,
  type PreviewSummary,
} from "./staples-cubes";
import { HalvedCount } from "./StapleRow";
import styles from "./Staples.module.css";

export interface StaplesPreviewProps {
  laptop: boolean;
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

// The preview (spec part 3 section 1.5): a sticky panel beside the suitcase on a laptop, a collapsible dock above the
// tab bar on a phone. Every number comes from the domain calculator through `previewStaples`.
export function StaplesPreview({
  laptop,
  nights,
  onNights,
  laundry,
  onLaundry,
  summary,
}: StaplesPreviewProps) {
  const sliderId = useId();
  const switchId = useId();
  const bodyId = useId();
  const shortScreen = useMediaQuery("(max-height: 699px), (max-width: 359px)");
  // The dock starts collapsed on a short screen so the list stays usable; a tap on its title toggles it.
  const [expandedByUser, setExpandedByUser] = useState<boolean | null>(null);
  const expanded = laptop || (expandedByUser ?? !shortScreen);
  const percent = ((nights - MIN_NIGHTS) / (MAX_NIGHTS - MIN_NIGHTS)) * 100;
  const scaling = summary.rows.filter((row) => scalesWithTrip(row.staple));

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
            type="button"
            className={styles.dockTitle}
            aria-expanded={expanded}
            aria-controls={bodyId}
            onClick={() => setExpandedByUser(!expanded)}
          >
            {`Preview: ${nightsLabel(nights)}`}
            <Icon name="chevronRight" size={16} />
          </button>
          <span className={styles.big} role="status">
            <span className={styles.bigNumber}>{summary.total}</span>
            <span className={styles.bigUnit}>{summary.total === 1 ? "item" : "items"}</span>
          </span>
        </div>
        <div id={bodyId} className={styles.dockBody} hidden={!expanded}>
          {controls}
          <p className={styles.note}>{laundryNote(laundry, summary.saves)}</p>
        </div>
      </aside>
    );
  }

  return (
    <aside className={styles.preview} aria-label="Preview">
      <p className={styles.previewEyebrow}>Preview</p>
      {controls}
      <div className={styles.panelBlock}>
        <span className={styles.big} role="status">
          <span className={styles.bigNumber}>{summary.total}</span>
          <span
            className={styles.bigUnit}
          >{`${summary.total === 1 ? "item" : "items"} to start`}</span>
        </span>
        <p className={styles.note}>{laundryNote(laundry, summary.saves)}</p>
      </div>
      <div className={styles.panelBlock}>
        <h2 className={styles.previewEyebrow}>Scales with the trip</h2>
        {scaling.length ? (
          <ul className={styles.scales}>
            {scaling.map(({ staple, plain, qty }) => (
              <li key={staple.id} className={styles.scaleRow}>
                <span>{staple.name}</span>
                <span className={styles.scaleCount}>
                  {staple.laundryHalves ? <LaundryMarker variant="staples" /> : null}
                  <span>
                    <HalvedCount plain={plain} qty={qty} />
                  </span>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.footnote}>Nothing scales with the trip yet.</p>
        )}
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
    </aside>
  );
}
