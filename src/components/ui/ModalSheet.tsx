"use client";

import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Safari (macOS and iOS) does not focus a button, link or checkbox when it is clicked or tapped, so `document.activeElement` is
// still whatever had focus before (<body>, or <main> after a route change) when a sheet opens from a tap. The control that was
// pressed is remembered here (capture phase, so before any handler can remove it) so focus can go back to it when the sheet
// closes. Chromium and Firefox focus the control itself, which gives the same answer.
const CONTROL = 'a[href], button, input, select, textarea, summary, [role="button"], [tabindex]';
/** A press older than this did not open the sheet that is opening now (a sheet opened by code, long after). */
const PRESS_FRESH_MS = 10_000;
let lastPressed: HTMLElement | null = null;
let lastPressedAt = 0;
if (typeof document !== "undefined") {
  document.addEventListener(
    "click",
    (event) => {
      lastPressed =
        event.target instanceof Element ? event.target.closest<HTMLElement>(CONTROL) : null;
      lastPressedAt = Date.now();
    },
    true,
  );
}

// The last control focused outside any dialog. A sheet whose form has `autoFocus` moves focus into itself while it mounts, before
// this module can look, so the control that opened it (reached by keyboard) is found here instead.
let lastOutsideFocus: HTMLElement | null = null;
if (typeof document !== "undefined") {
  document.addEventListener(
    "focusin",
    (event) => {
      const target = event.target;
      if (target instanceof HTMLElement && !target.closest('[role="dialog"]'))
        lastOutsideFocus = target;
    },
    true,
  );
}

/**
 * What to give focus back to when a sheet closes. The control that was just pressed, when focus did not land on something else
 * (it is still on <body>, or on an ancestor of the control as in Safari); otherwise whatever has focus. Focus that has already
 * moved into a dialog (an `autoFocus` field) is not an opener: the last control focused outside one is.
 */
function openerNow(): HTMLElement | null {
  const active = document.activeElement;
  const focused =
    active instanceof HTMLElement && active !== document.body && !active.closest('[role="dialog"]')
      ? active
      : null;
  const pressed =
    lastPressed?.isConnected && Date.now() - lastPressedAt < PRESS_FRESH_MS ? lastPressed : null;
  if (pressed && (!focused || focused.contains(pressed))) return pressed;
  if (focused) return focused;
  return lastOutsideFocus?.isConnected ? lastOutsideFocus : null;
}

// How many sheets are open. `data-sheet-open` on <body> is set while it is above zero so the toast provider and the stylesheet
// can hold plain toasts behind a sheet (#341).
let openSheets = 0;

export interface ModalSheetProps {
  open: boolean;
  title: string;
  description?: string;
  /** A small line above the title, e.g. "Step 1 of 2". */
  eyebrow?: string;
  onClose: () => void;
  children: ReactNode;
  actions?: ReactNode;
  /**
   * Close on a press outside the dialog. Default true. Destructive confirms pass false so a stray tap can't
   * dismiss them (design's #16 gap 1).
   */
  dismissOnBackdrop?: boolean;
  /**
   * A visible "×" so touch and screen-reader users can leave without saving. For forms and editors; dialogs that
   * already offer their own safe choice ("Not yet", "Skip", "Keep item") leave it off. Default false.
   */
  showClose?: boolean;
  /** A small control beside the close button in the head (the trip editor's Feedback entry, #296). Absent: the head is unchanged. */
  headerAction?: ReactNode;
}

// Bottom sheet on phones, centered dialog from 660px. Traps focus, closes on
// Escape or a backdrop press, and returns focus to whatever opened it.
export function ModalSheet({
  open,
  title,
  description,
  eyebrow,
  onClose,
  children,
  actions,
  dismissOnBackdrop = true,
  showClose = false,
  headerAction,
}: ModalSheetProps) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const opener = openerNow();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    openSheets += 1;
    document.body.setAttribute("data-sheet-open", "");
    const dialog = dialogRef.current as HTMLDivElement;
    // The close button comes first in the DOM, but a person opening a form wants to start in the form.
    // A control can ask to be first (a radio group asks for its checked option).
    const start =
      dialog.querySelector<HTMLElement>("[data-modal-autofocus]") ??
      [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)].find(
        (node) => !node.hasAttribute("data-modal-close") && !node.closest(".modal-head-end"),
      );
    (start ?? dialog).focus();
    // Everything else on the page is inert while the dialog is open, so focus and assistive tech stay inside
    // it. Anything that was already inert is left exactly as it was.
    const background = [...document.body.children].filter(
      (node) => node !== backdropRef.current && !node.hasAttribute("inert"),
    );
    for (const node of background) node.setAttribute("inert", "");
    return () => {
      for (const node of background) node.removeAttribute("inert");
      document.body.style.overflow = previousOverflow;
      openSheets -= 1;
      if (openSheets === 0) document.body.removeAttribute("data-sheet-open");
      // WebKit works out inertness lazily: a control that was inside the inert page cannot take focus until the style is flushed.
      void document.body.offsetHeight;
      // The page cannot scroll while the sheet is open, so the opener is where the person left it. Letting focus() scroll would
      // move a sticky opener (the Feedback button in the sticky bar, #282) to its in-flow position and jump the page.
      opener?.focus({ preventScroll: true });
    };
  }, [open]);

  if (!open) return null;

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = Array.from(
      (dialogRef.current as HTMLDivElement).querySelectorAll<HTMLElement>(FOCUSABLE),
    );
    if (focusable.length === 0) {
      event.preventDefault();
      return;
    }
    // Move focus ourselves instead of relying on the platform's tab order. Mobile Safari can omit buttons from its
    // native Tab sequence even though they are programmatically focusable; letting it choose there can escape to the
    // browser/page after a text field. One explicit sequence keeps the trap identical across keyboard implementations.
    const current = focusable.indexOf(document.activeElement as HTMLElement);
    const next = event.shiftKey
      ? current <= 0
        ? focusable.length - 1
        : current - 1
      : current < 0 || current === focusable.length - 1
        ? 0
        : current + 1;
    event.preventDefault();
    focusable[next].focus();
  }

  const closeButton = showClose ? (
    <button
      type="button"
      className="modal-close"
      data-modal-close=""
      aria-label="Close dialog"
      onClick={onClose}
    >
      <span aria-hidden="true">×</span>
    </button>
  ) : null;

  return createPortal(
    <div
      ref={backdropRef}
      className="modal-backdrop"
      data-testid="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (dismissOnBackdrop) onClose();
        // An ignored press must not pull focus out of the dialog (Escape would stop working).
        else event.preventDefault();
      }}
    >
      <div
        ref={dialogRef}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <div className="modal-head">
          <div>
            {eyebrow ? <p className="tiny muted modal-eyebrow">{eyebrow}</p> : null}
            <h2 id={titleId}>{title}</h2>
            {description ? <p id={descriptionId}>{description}</p> : null}
          </div>
          {headerAction ? (
            <div className="modal-head-end">
              {headerAction}
              {closeButton}
            </div>
          ) : (
            closeButton
          )}
        </div>
        {children}
        {actions ? <div className="modal-actions">{actions}</div> : null}
      </div>
    </div>,
    document.body,
  );
}
