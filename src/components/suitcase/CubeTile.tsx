import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { Icon } from "@/components/ui/Icon";
import { cx } from "./cx";
import { MorningOfMarker } from "./Markers";
import styles from "./CubeTile.module.css";

export interface CubeProgress {
  /** The cube's name ("Clothing"). */
  name: string;
  /** Quantity packed and quantity in total (counts are quantity everywhere, decision on #376). */
  packed: number;
  total: number;
  /** One line under the bar (weather, passport, adapter, 3.4 oz). Ellipsised, never wraps. */
  note?: string | null;
  /** Shows the Morning-of marker after the note (a per-cube flag, spec part 3 section 6). */
  morningOf?: boolean;
  /** Weather items to review or not yet packed: the tile is outlined (rail: accent bar and note only). */
  alert?: boolean;
}

/** Packed share of the total as a whole percent, clamped to 0..100 (an empty cube is 0, never NaN). */
export function percentPacked(packed: number, total: number): number {
  if (!(total > 0)) return 0;
  return Math.min(100, Math.max(0, Math.round((packed / total) * 100)));
}

/** A cube with something in it and everything packed. */
export function isComplete(packed: number, total: number): boolean {
  return total > 0 && packed >= total;
}

function Bar({ packed, total }: Pick<CubeProgress, "packed" | "total">) {
  return (
    <span className={styles.bar} aria-hidden="true" data-bar>
      <span
        className={styles.fill}
        style={{ width: `${percentPacked(packed, total)}%` } satisfies CSSProperties}
        data-fill
      />
    </span>
  );
}

function Count({ packed, total }: Pick<CubeProgress, "packed" | "total">) {
  return (
    <span className={styles.count} aria-hidden="true" data-count>
      {packed}/{total}
      {isComplete(packed, total) ? <Icon name="check" size={14} className={styles.tick} /> : null}
    </span>
  );
}

/** What a screen reader hears in place of the bar and the n/m text. */
function Spoken({ packed, total, alert }: Pick<CubeProgress, "packed" | "total" | "alert">) {
  return (
    <span className="sr-only">
      {packed} of {total} packed
      {isComplete(packed, total) ? ", complete" : ""}
      {alert ? ", needs attention" : ""}
    </span>
  );
}

function Note({
  note,
  morningOf,
  hideOnPhone = false,
}: Pick<CubeProgress, "note" | "morningOf"> & { hideOnPhone?: boolean }) {
  return (
    <span className={cx(styles.note, hideOnPhone && styles.noteLaptopOnly)} data-note>
      {note}
      {note && morningOf ? " · " : null}
      {morningOf ? <MorningOfMarker /> : null}
    </span>
  );
}

export interface CubeTileProps extends CubeProgress {
  /** Home links each cube to Packing with that cube open. Without it the tile is a plain block. */
  href?: string;
  className?: string;
}

// A cube on the Home suitcase (spec part 2 section 2). Laptop: name left, n/m right, bar, then the note line (reserved,
// so a tile without a note keeps its height). Phone: the count goes under the name and there is no note.
export function CubeTile({
  name,
  packed,
  total,
  note,
  morningOf,
  alert,
  href,
  className,
}: CubeTileProps): ReactNode {
  const complete = isComplete(packed, total);
  const body = (
    <>
      <span className={styles.name}>{name}</span>
      <Count packed={packed} total={total} />
      <Bar packed={packed} total={total} />
      <Spoken packed={packed} total={total} alert={alert} />
      <Note note={note} morningOf={morningOf} hideOnPhone />
    </>
  );
  const classes = cx(
    styles.tile,
    alert && styles.alert,
    complete && !alert && styles.complete,
    href && styles.interactive,
    className,
  );
  const state = alert ? "alert" : complete ? "complete" : "normal";
  return href ? (
    <Link href={href} className={classes} data-cube-state={state}>
      {body}
    </Link>
  ) : (
    <div className={classes} data-cube-state={state}>
      {body}
    </div>
  );
}

export interface CubeRailItemProps extends CubeProgress {
  selected?: boolean;
  onSelect?: () => void;
  className?: string;
  /** The id of the panel this item opens (aria-controls). */
  controls?: string;
}

// A cube in the Packing rail on the dark suitcase (spec part 2 section 2). The selected item is a paper card.
export function CubeRailItem({
  name,
  packed,
  total,
  note,
  morningOf,
  alert,
  selected = false,
  onSelect,
  className,
  controls,
}: CubeRailItemProps) {
  return (
    <button
      type="button"
      className={cx(
        styles.rail,
        selected && styles.railSelected,
        alert && styles.railAlert,
        isComplete(packed, total) && !alert && styles.railComplete,
        className,
      )}
      aria-current={selected ? "true" : undefined}
      aria-controls={controls}
      onClick={onSelect}
      data-cube-state={alert ? "alert" : "normal"}
    >
      <span className={styles.railTop}>
        <span className={styles.railName}>{name}</span>
        <Count packed={packed} total={total} />
      </span>
      <Bar packed={packed} total={total} />
      <Spoken packed={packed} total={total} alert={alert} />
      <Note note={note} morningOf={morningOf} />
    </button>
  );
}

export interface CubeChipProps extends Omit<CubeProgress, "note" | "alert"> {
  selected?: boolean;
  onSelect?: () => void;
  className?: string;
}

// A cube chip in the phone Packing bar (spec part 2 section 2): name, then "9/14" and the Morning-of marker.
export function CubeChip({
  name,
  packed,
  total,
  morningOf,
  selected = false,
  onSelect,
  className,
}: CubeChipProps) {
  return (
    <button
      type="button"
      className={cx(styles.chip, selected && styles.chipSelected, className)}
      aria-pressed={selected}
      onClick={onSelect}
    >
      <span className={styles.chipName}>{name}</span>
      <span className={styles.chipCount}>
        <span aria-hidden="true">
          {packed}/{total}
        </span>
        <span className="sr-only">
          {packed} of {total} packed
        </span>
        {morningOf ? <MorningOfMarker /> : null}
      </span>
    </button>
  );
}
