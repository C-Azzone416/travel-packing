"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";

export type MoreMenuItem =
  | { key: string; label: string; onSelect: () => void; danger?: boolean }
  | { key: string; label: string; href: string };

export interface MoreMenuProps {
  /** What the menu is about ("San Diego"): names the button and the menu, so each item can be short. */
  subject: string;
  items: readonly MoreMenuItem[];
  /** The ⋯ button's look: the outline of a secondary button (the hero) or a quiet ghost (a journey row). */
  variant?: "ghost" | "secondary";
  /** A save for this trip is in flight: the button waits. */
  disabled?: boolean;
}

/**
 * The per-trip ⋯ menu (#155, design's ruling): a disclosure button and a role="menu" panel. Enter, Space or ArrowDown
 * opens it on the first item; Arrow keys move (wrapping), Home and End jump, Esc closes and returns focus to the
 * button, Tab closes and moves on, a click outside closes. Choosing an item closes the menu first, then acts. A
 * danger item (Remove) sits after a divider.
 */
export function MoreMenu({ subject, items, variant = "ghost", disabled = false }: MoreMenuProps) {
  const [open, setOpen] = useState(false);
  const [up, setUp] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const entries = () => [
    ...(panel.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []),
  ];
  const focusItem = (index: number) => {
    const all = entries();
    if (all.length) all[(index + all.length) % all.length].focus();
  };
  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) button.current?.focus();
  }, []);

  // Open upward when there is no room below the button. "Below" ends at the top of the bottom tab bar on a phone
  // (it is fixed over the page), not at the window edge; when neither side fits, the panel scrolls.
  useEffect(() => {
    if (!open || !panel.current || !button.current) return;
    const box = button.current.getBoundingClientRect();
    const tabBar = document.querySelector<HTMLElement>(".bottom-nav");
    const floor =
      tabBar && getComputedStyle(tabBar).position === "fixed"
        ? tabBar.getBoundingClientRect().top
        : window.innerHeight;
    const below = floor - box.bottom - 8;
    const above = box.top - 8;
    const height = panel.current.scrollHeight;
    const flip = below < height && above > below;
    setUp(flip);
    panel.current.style.maxHeight = `${Math.max(120, Math.floor(flip ? above : below))}px`;
  }, [open]);

  // A click outside closes without stealing focus.
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    return () => document.removeEventListener("mousedown", onPointer);
  }, [open]);

  function openOn(index: number) {
    setOpen(true);
    // The panel mounts on this render; focus the item once it exists.
    requestAnimationFrame(() => focusItem(index));
  }

  function onButtonKey(event: KeyboardEvent) {
    if (event.key === "Escape" && open) {
      event.preventDefault();
      close(true);
    } else if (event.key === "Tab" && open) {
      close(false);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      openOn(0);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      openOn(-1);
    }
  }

  function onMenuKey(event: KeyboardEvent) {
    const all = entries();
    const index = all.indexOf(document.activeElement as HTMLElement);
    if (event.key === "ArrowDown") focusItem(index + 1);
    else if (event.key === "ArrowUp") focusItem(index - 1);
    else if (event.key === "Home") focusItem(0);
    else if (event.key === "End") focusItem(-1);
    else if (event.key === "Escape") close(true);
    else if (event.key === "Tab") return close(false);
    else return;
    event.preventDefault();
  }

  const danger = items.filter((item) => "danger" in item && item.danger);
  const regular = items.filter((item) => !("danger" in item && item.danger));

  const renderItem = (item: MoreMenuItem) =>
    "href" in item ? (
      <Link
        key={item.key}
        role="menuitem"
        tabIndex={-1}
        href={item.href}
        onClick={() => close(false)}
      >
        {item.label}
      </Link>
    ) : (
      <button
        key={item.key}
        type="button"
        role="menuitem"
        tabIndex={-1}
        className={item.danger ? "danger" : undefined}
        onClick={() => {
          // Focus goes back to the ⋯ button first, so a sheet the item opens returns focus to something that exists.
          close(true);
          item.onSelect();
        }}
      >
        {item.label}
      </button>
    );

  return (
    <div className="more-menu" ref={root}>
      <button
        ref={button}
        type="button"
        className={`more-menu-button ${variant}`}
        aria-label={`More actions for ${subject}`}
        aria-haspopup="menu"
        disabled={disabled}
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => (open ? close(false) : openOn(0))}
        onKeyDown={onButtonKey}
      >
        <span aria-hidden="true">⋯</span>
      </button>
      {open ? (
        <div
          ref={panel}
          id={menuId}
          role="menu"
          aria-label={`Actions for ${subject}`}
          className={up ? "more-menu-panel up" : "more-menu-panel"}
          onKeyDown={onMenuKey}
        >
          {regular.map(renderItem)}
          {danger.length ? <hr role="separator" /> : null}
          {danger.map(renderItem)}
        </div>
      ) : null}
    </div>
  );
}
