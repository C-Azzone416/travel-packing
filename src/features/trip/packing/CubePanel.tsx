"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { LaundryMarker, Pill, PillGroup } from "@/components/suitcase";
import { cx } from "@/components/suitcase/cx";
import { Icon } from "@/components/ui/Icon";
import { ADD_ITEM_NAME_MAX } from "@/domain/item-ops";
import type { Cube } from "@/domain/cubes";
import type { TripItem } from "@/domain/trip";
import {
  checkboxName,
  editName,
  filterCounts,
  filterItems,
  HINT,
  HINT_DAY_TRIP,
  isPacked,
  moveTargets,
  panelFooter,
  type CubeFilter,
  type CubeView,
} from "./packing-model";
import styles from "./packing.module.css";

export type AddOutcome =
  | { ok: true }
  | { ok: false; reason: "EXISTS"; existingId: string }
  | { ok: false; reason: "FAILED" };

export interface CubePanelProps {
  view: CubeView;
  /** The cubes the "move to" select offers (every drawn cube; the item's own is left out). */
  cubes: readonly CubeView[];
  filter: CubeFilter;
  onFilter: (filter: CubeFilter) => void;
  editing: boolean;
  onEditing: (editing: boolean) => void;
  /** The trip has laundry on: halved items show the ↻ marker. */
  laundry: boolean;
  failedRows: ReadonlySet<string>;
  onTick: (item: TripItem, packed: boolean) => void;
  onRetry: (itemId: string) => void;
  onEditItem: (itemId: string) => void;
  onMove: (item: TripItem, cube: Cube) => void;
  onRemove: (item: TripItem) => void;
  onMorningOf: (cube: Cube, on: boolean) => void;
  /** Adds a typed name to this cube. Toiletries items go through the Bathroom form instead. */
  onAdd: (cube: Cube, name: string) => Promise<AddOutcome>;
  /** The toiletry bag step, shown at the foot of the Toiletries cube. */
  extra?: ReactNode;
  /** The tablet action bar (#414): drawn last, sticky at the foot of the panel. */
  bar?: ReactNode;
  panelId: string;
  titleId: string;
  /**
   * "laptop" (the default) draws the whole panel as #385 did. "phone" (#386) leaves the filter pills out (the screen draws them
   * above the suitcase), writes the count as "9 of 14", lists in one column that scrolls inside the suitcase, and keeps the
   * hint line off (only the state lines show).
   */
  layout?: "laptop" | "phone";
}

export interface FilterBarProps {
  view: Pick<CubeView, "items">;
  filter: CubeFilter;
  onFilter: (filter: CubeFilter) => void;
  editing: boolean;
  onEditing: (editing: boolean) => void;
  className?: string;
  /** On a phone the pencil is an icon alone (its label stays the accessible name) until it turns into "Done". */
  phone?: boolean;
}

// The All / To pack / Packed pills (each counts the ROWS it lists) and the Edit list pill. Shared by the laptop panel head and
// the phone screen, where it sits above the suitcase.
export function FilterBar({
  view,
  filter,
  onFilter,
  editing,
  onEditing,
  className,
  phone = false,
}: FilterBarProps) {
  const counts = filterCounts(view.items);
  return (
    <PillGroup label="Packing list view" className={className}>
      {editing ? null : (
        <>
          <Pill active={filter === "all"} count={counts.all} onClick={() => onFilter("all")}>
            All
          </Pill>
          <Pill
            active={filter === "to-pack"}
            count={counts.toPack}
            onClick={() => onFilter("to-pack")}
          >
            To pack
          </Pill>
          <Pill
            active={filter === "packed"}
            count={counts.packed}
            onClick={() => onFilter("packed")}
          >
            Packed
          </Pill>
        </>
      )}
      <Pill
        icon={editing ? "check" : "pencil"}
        active={editing}
        iconOnlyOnPhone={phone && !editing}
        className={phone ? styles.editPill : undefined}
        onClick={() => onEditing(!editing)}
      >
        {editing ? "Done" : "Edit list"}
      </Pill>
    </PillGroup>
  );
}

function Row({
  item,
  laundry,
  failed,
  onTick,
  onRetry,
}: {
  item: TripItem;
  laundry: boolean;
  failed: boolean;
  onTick: CubePanelProps["onTick"];
  onRetry: CubePanelProps["onRetry"];
}) {
  const packed = isPacked(item);
  const partial = !packed && item.packed > 0;
  const input = useRef<HTMLInputElement>(null);
  // A partly packed row (packed some of its quantity before the redesign) shows the mixed state; one tick finishes it.
  useEffect(() => {
    if (input.current) input.current.indeterminate = partial;
  }, [partial]);
  return (
    <li className={styles.row} data-item-id={item.id} data-packed={packed ? "true" : "false"}>
      <label className={cx(styles.rowLabel, packed && styles.packed)}>
        <input
          ref={input}
          type="checkbox"
          className={styles.box}
          checked={packed}
          aria-label={checkboxName(item)}
          onChange={() => onTick(item, !packed)}
        />
        <span className={styles.name}>{item.name}</span>
        {item.section === "return" ? <span className={styles.qty}>return outfit</span> : null}
        {item.qty > 1 ? <span className={styles.qty}>× {item.qty}</span> : null}
        {laundry && item.laundryHalves ? (
          <LaundryMarker aria-hidden={undefined} className={styles.laundryMark} />
        ) : null}
        {partial ? (
          <span className={styles.partial}>
            {item.packed} of {item.qty}
          </span>
        ) : null}
      </label>
      {failed ? (
        <button type="button" className={styles.rowError} onClick={() => onRetry(item.id)}>
          Not saved · Retry
        </button>
      ) : null}
    </li>
  );
}

function EditRow({
  item,
  cubes,
  from,
  onEditItem,
  onMove,
  onRemove,
}: {
  item: TripItem;
  cubes: readonly CubeView[];
  from: Cube;
  onEditItem: CubePanelProps["onEditItem"];
  onMove: CubePanelProps["onMove"];
  onRemove: CubePanelProps["onRemove"];
}) {
  return (
    <li className={cx(styles.row, styles.editRow)} data-item-id={item.id}>
      <button
        type="button"
        className={cx(styles.editName, "edit-target")}
        onClick={() => onEditItem(item.id)}
      >
        {/* The name starts with the visible words (label-content-name-mismatch): "Edit" is spoken only. */}
        <span className="sr-only">Edit</span> <span className={styles.name}>{item.name}</span>{" "}
        {item.section === "return" ? <span className={styles.qty}>return outfit</span> : null}{" "}
        {item.qty > 1 ? <span className={styles.qty}>× {item.qty}</span> : null}
      </button>
      <select
        className={styles.move}
        aria-label={`Move ${editName(item)} to another cube`}
        value=""
        onChange={(event) => {
          if (event.target.value) onMove(item, event.target.value as Cube);
        }}
      >
        <option value="">Move to…</option>
        {moveTargets(cubes, from).map((target) => (
          <option key={target.cube} value={target.cube}>
            {target.label}
          </option>
        ))}
      </select>
      <button
        type="button"
        className={styles.remove}
        aria-label={`Remove ${editName(item)}`}
        onClick={() => onRemove(item)}
      >
        <Icon name="close" size={16} />
      </button>
    </li>
  );
}

function AddRow({
  cube,
  label,
  onAdd,
  onEditItem,
  onCancel,
  onSubmitted,
}: {
  cube: Cube;
  label: string;
  onAdd: CubePanelProps["onAdd"];
  onEditItem: CubePanelProps["onEditItem"];
  /** Quick add (#496): present when the row opened from the "＋ Add an item" button. It adds Cancel and Escape, and takes focus. */
  onCancel?: () => void;
  /** Called when a name is sent, with whether it was saved, so the panel can bring a new row into view. */
  onSubmitted?: (saved: boolean | null) => void;
}) {
  const [name, setName] = useState("");
  const [problem, setProblem] = useState<null | "EMPTY" | "LONG" | "FAILED">(null);
  const [existing, setExisting] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const messageId = useId();

  useEffect(() => {
    if (onCancel) field.current?.focus();
    // Focus once, when the quick row opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (saving) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setProblem("EMPTY");
      return field.current?.focus();
    }
    if (trimmed.length > ADD_ITEM_NAME_MAX) {
      setProblem("LONG");
      return field.current?.focus();
    }
    setSaving(true);
    setProblem(null);
    setExisting(null);
    onSubmitted?.(null);
    const outcome = await onAdd(cube, trimmed);
    setSaving(false);
    onSubmitted?.(outcome.ok);
    if (outcome.ok) {
      setName("");
      return field.current?.focus();
    }
    if (outcome.reason === "EXISTS") setExisting(outcome.existingId);
    else setProblem("FAILED");
  }

  const message =
    problem === "EMPTY"
      ? "Enter an item name."
      : problem === "LONG"
        ? `Keep the name under ${ADD_ITEM_NAME_MAX} characters.`
        : problem === "FAILED"
          ? "Couldn’t add it. Nothing was changed."
          : null;
  return (
    <form
      className={styles.addRow}
      onSubmit={submit}
      noValidate
      autoComplete="off"
      onKeyDown={(event) => {
        if (onCancel && event.key === "Escape") {
          event.stopPropagation();
          onCancel();
        }
      }}
    >
      <label className={styles.addField}>
        <span className="sr-only">Add an item to {label}</span>
        <input
          ref={field}
          className={styles.addInput}
          name="packing-item-name"
          value={name}
          placeholder="+ Add an item"
          maxLength={ADD_ITEM_NAME_MAX + 20}
          autoComplete="off"
          aria-invalid={message ? true : undefined}
          aria-describedby={message || existing ? messageId : undefined}
          onChange={(event) => {
            setName(event.target.value);
            setProblem(null);
            setExisting(null);
          }}
        />
      </label>
      <button type="submit" className={styles.addButton} disabled={saving}>
        Add
      </button>
      {onCancel ? (
        <button type="button" className={styles.addCancel} onClick={onCancel}>
          Cancel
        </button>
      ) : null}
      {message || existing ? (
        <p id={messageId} className={styles.addMessage} role="alert">
          {message ?? (
            <>
              That’s already on your list.{" "}
              <button
                type="button"
                className={styles.linkButton}
                onClick={() => onEditItem(existing as string)}
              >
                Edit its quantity
              </button>
            </>
          )}
        </p>
      ) : null}
    </form>
  );
}

/**
 * The always-visible add control (#496). A dashed "＋ Add an item" button at the end of a cube's list; it swaps for the add row,
 * which Cancel or Escape closes (discarding the text) and hands focus back to the button.
 */
function QuickAdd({
  cube,
  label,
  onAdd,
  onEditItem,
  onSubmitted,
}: {
  cube: Cube;
  label: string;
  onAdd: CubePanelProps["onAdd"];
  onEditItem: CubePanelProps["onEditItem"];
  onSubmitted: (saved: boolean | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const restore = useRef(false);
  useEffect(() => {
    if (!open && restore.current) {
      restore.current = false;
      button.current?.focus();
    }
  }, [open]);
  return (
    <div className={styles.quickAdd}>
      {open ? (
        <AddRow
          cube={cube}
          label={label}
          onAdd={onAdd}
          onEditItem={onEditItem}
          onSubmitted={onSubmitted}
          onCancel={() => {
            restore.current = true;
            setOpen(false);
          }}
        />
      ) : (
        <button
          ref={button}
          type="button"
          className={styles.quickAddButton}
          aria-label={`Add an item to ${label}`}
          onClick={() => setOpen(true)}
        >
          ＋ Add an item
        </button>
      )}
    </div>
  );
}

// The open cube (#376 part 3 section 1.3): its title and "9 of 14 packed", the All / To pack / Packed pills with the
// number of rows each lists, "Edit list", a two-column checklist with ONE tick per item, and the footer line. Edit list
// swaps the checklist for the editing rows (rename/quantity, move to another cube, remove) plus "Add an item" and the
// cube's Morning of switch.
export function CubePanel({
  view,
  cubes,
  filter,
  onFilter,
  editing,
  onEditing,
  laundry,
  failedRows,
  onTick,
  onRetry,
  onEditItem,
  onMove,
  onRemove,
  onMorningOf,
  onAdd,
  extra,
  bar,
  panelId,
  titleId,
  layout = "laptop",
}: CubePanelProps) {
  const phone = layout === "phone";
  const shown = editing ? view.items : filterItems(view.items, filter);
  const lockedOn = view.items.some((item) => item.section === "packlast");
  const switchId = useId();
  const listRef = useRef<HTMLUListElement>(null);
  const scrollNew = useRef(false);
  // A saved quick add brings its new row into view (All / To pack show it; Packed does not list it).
  useEffect(() => {
    if (!scrollNew.current) return;
    scrollNew.current = false;
    listRef.current?.lastElementChild?.scrollIntoView?.({ block: "nearest" });
  }, [view.total]);
  const onSubmitted = (saved: boolean | null) => {
    scrollNew.current = saved === null || saved === true;
  };
  // One add control per cube: Toiletries adds through the Bathroom control in its bag step, every other cube through this.
  const addControl = extra ? null : editing ? (
    <AddRow cube={view.cube} label={view.label} onAdd={onAdd} onEditItem={onEditItem} />
  ) : (
    <QuickAdd
      cube={view.cube}
      label={view.label}
      onAdd={onAdd}
      onEditItem={onEditItem}
      onSubmitted={onSubmitted}
    />
  );
  const footerText = panelFooter(view, shown.length);
  // The hint ("Tick as you pack ...") is for the laptop; a phone shows only the lines that report a state.
  const footer =
    phone && (footerText === HINT || footerText === HINT_DAY_TRIP) ? null : (
      <p className={styles.footer}>{footerText}</p>
    );
  return (
    <section
      id={panelId}
      className={cx(styles.panel, phone && styles.panelPhone)}
      aria-labelledby={titleId}
      data-cube={view.cube}
      data-editing={editing ? "true" : undefined}
    >
      <div className={styles.panelHead}>
        <div className={styles.panelTitleRow}>
          <h2 id={titleId} className={styles.panelTitle} tabIndex={-1}>
            {view.label}
          </h2>
          <p className={styles.panelCount}>
            {phone ? `${view.packed} of ${view.total}` : `${view.packed} of ${view.total} packed`}
          </p>
        </div>
        {phone ? null : (
          <FilterBar
            view={view}
            filter={filter}
            onFilter={onFilter}
            editing={editing}
            onEditing={onEditing}
            className={styles.panelPills}
          />
        )}
      </div>

      {shown.length > 0 ? (
        <ul
          ref={listRef}
          className={cx(styles.list, editing && styles.listEditing, phone && styles.listPhone)}
          style={{ ["--rows" as string]: Math.ceil(shown.length / 2) }}
          aria-label={`${view.label} items`}
        >
          {shown.map((item) =>
            editing ? (
              <EditRow
                key={item.id}
                item={item}
                cubes={cubes}
                from={view.cube}
                onEditItem={onEditItem}
                onMove={onMove}
                onRemove={onRemove}
              />
            ) : (
              <Row
                key={item.id}
                item={item}
                laundry={laundry}
                failed={failedRows.has(item.id)}
                onTick={onTick}
                onRetry={onRetry}
              />
            ),
          )}
        </ul>
      ) : null}

      {extra}

      {editing ? (
        <div className={styles.editFooter}>
          {addControl}
          {view.morningOfAvailable ? (
            <div className={styles.morningRow}>
              <label className={styles.morningLabel} htmlFor={switchId}>
                <strong>Morning of</strong>
                <span>
                  {lockedOn
                    ? "A Pack last item is in this cube."
                    : "Pack this cube the morning you leave."}
                </span>
              </label>
              <input
                id={switchId}
                type="checkbox"
                role="switch"
                className={styles.switch}
                checked={view.morningOf}
                disabled={lockedOn}
                onChange={(event) => onMorningOf(view.cube, event.target.checked)}
              />
            </div>
          ) : null}
        </div>
      ) : phone ? (
        <>
          {footer}
          {addControl}
        </>
      ) : (
        <>
          {addControl}
          {footer}
        </>
      )}
      {bar}
    </section>
  );
}
