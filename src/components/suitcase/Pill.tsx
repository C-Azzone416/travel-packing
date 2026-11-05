"use client";

import Link from "next/link";
import {
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { Icon, type IconName } from "@/components/ui/Icon";
import { cx } from "./cx";
import shared from "./shared.module.css";
import styles from "./Pill.module.css";

export interface PillProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  children: ReactNode;
  /** The active filter. Exposed as aria-pressed, and styled dark. */
  active?: boolean;
  /** A count after the label: "To pack 5". Spoken as part of the name. */
  count?: number;
  /** "filter" is the Packing row (36/34 high); "stamps" is the larger Stamps row (40/38). */
  size?: "filter" | "stamps";
  /** An icon before the label ("Edit list" and its pencil). */
  icon?: IconName;
  /** On a phone only the icon shows (a 36 by 34 circle); the label stays as the accessible name. */
  iconOnlyOnPhone?: boolean;
}

// A filter pill (spec part 2 section 4): "All 14", "To pack 5", "Last 12 months". A real button with aria-pressed. On a
// phone the 34px pill keeps a 44px tap area (invisible padding), so it looks as drawn and is still easy to hit.
export function Pill({
  children,
  active = false,
  count,
  size = "filter",
  icon,
  iconOnlyOnPhone = false,
  className,
  type = "button",
  ...rest
}: PillProps) {
  return (
    <button
      type={type}
      aria-pressed={active}
      className={cx(
        styles.pill,
        shared.hit,
        shared.ring,
        size === "stamps" && styles.stamps,
        active && styles.active,
        iconOnlyOnPhone && styles.iconOnly,
        className,
      )}
      {...rest}
    >
      {icon ? <Icon name={icon} size={16} /> : null}
      <span className={iconOnlyOnPhone ? styles.labelPhoneHidden : undefined}>
        {children}
        {count === undefined ? null : (
          <>
            {" "}
            <span className={styles.count}>{count}</span>
          </>
        )}
      </span>
    </button>
  );
}

/** A row of pills that wraps (8px gap). Give it a label so the group is named. */
export function PillGroup({
  label,
  className,
  ...rest
}: { label: string } & HTMLAttributes<HTMLDivElement>) {
  return <div role="group" aria-label={label} className={cx(styles.group, className)} {...rest} />;
}

export interface NavPillProps {
  href: string;
  children: ReactNode;
  /** The section the visitor is in: dark pill, aria-current="page". */
  active?: boolean;
  className?: string;
}

// A top-bar link (laptop only, spec part 2 section 4): 40px high, dark when its section is current.
export function NavPill({ href, children, active = false, className }: NavPillProps) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cx(styles.nav, shared.ring, active && styles.navActive, className)}
    >
      {children}
    </Link>
  );
}

export interface PillTabItem {
  id: string;
  label: string;
  /** The line under the label: "41/60", "2 trips". */
  sub: string;
  /** The sub-label is an alert ("ALERT"): accent, or gold on the active pill. */
  alert?: boolean;
}

export interface PillTabsProps {
  /** Names the tab list for assistive tech. */
  label: string;
  items: readonly PillTabItem[];
  value: string;
  onChange: (id: string) => void;
  /** Ties each tab to its panel: tab `${idBase}-tab-${id}` controls panel `${idBase}-panel-${id}`. */
  idBase?: string;
  className?: string;
}

// The Home phone's pill row (spec part 2 section 4): Pack / Weather / Future / Stamps as an ARIA tab list. One tab is in
// the tab order (roving tabindex); arrow keys, Home and End move and select. The panel (rendered by the screen) points
// back with aria-labelledby `${idBase}-tab-${id}`.
export function PillTabs({ label, items, value, onChange, idBase, className }: PillTabsProps) {
  const generated = useId();
  const base = idBase ?? generated;
  const hasSelection = items.some((item) => item.id === value);
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const last = items.length - 1;
    const next =
      event.key === "ArrowRight"
        ? index === last
          ? 0
          : index + 1
        : event.key === "ArrowLeft"
          ? index === 0
            ? last
            : index - 1
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? last
              : null;
    if (next === null) return;
    event.preventDefault();
    onChange(items[next].id);
    refs.current[next]?.focus();
  }

  return (
    <div role="tablist" aria-label={label} className={cx(styles.tabs, className)}>
      {items.map((item, index) => {
        const selected = item.id === value;
        // A value that matches no tab must not leave the list out of the tab order: the first tab is the way in.
        const tabbable = selected || (!hasSelection && index === 0);
        return (
          <button
            key={item.id}
            ref={(node) => {
              refs.current[index] = node;
            }}
            type="button"
            role="tab"
            id={`${base}-tab-${item.id}`}
            aria-selected={selected}
            aria-controls={`${base}-panel-${item.id}`}
            tabIndex={tabbable ? 0 : -1}
            className={cx(styles.tab, shared.ring, selected && styles.tabActive)}
            onClick={() => onChange(item.id)}
            onKeyDown={(event) => onKeyDown(event, index)}
          >
            <span className={styles.tabLabel}>{item.label}</span>
            <span className={cx(styles.tabSub, item.alert && styles.tabAlert)}>{item.sub}</span>
          </button>
        );
      })}
    </div>
  );
}
