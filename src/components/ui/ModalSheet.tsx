"use client";

import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface ModalSheetProps {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  actions?: ReactNode;
  /**
   * Close on a press outside the dialog. Default true. Destructive confirms pass false so a stray tap can't
   * dismiss them (design's #16 gap 1).
   */
  dismissOnBackdrop?: boolean;
}

// Bottom sheet on phones, centered dialog from 660px. Traps focus, closes on
// Escape or a backdrop press, and returns focus to whatever opened it.
export function ModalSheet({
  open,
  title,
  description,
  onClose,
  children,
  actions,
  dismissOnBackdrop = true,
}: ModalSheetProps) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const dialog = dialogRef.current as HTMLDivElement;
    (dialog.querySelector<HTMLElement>(FOCUSABLE) ?? dialog).focus();
    // Everything else on the page is inert while the dialog is open, so focus and assistive tech stay inside
    // it. Anything that was already inert is left exactly as it was.
    const background = [...document.body.children].filter(
      (node) => node !== backdropRef.current && !node.hasAttribute("inert"),
    );
    for (const node of background) node.setAttribute("inert", "");
    return () => {
      for (const node of background) node.removeAttribute("inert");
      document.body.style.overflow = previousOverflow;
      opener?.focus();
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
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (
      event.shiftKey &&
      (document.activeElement === first || document.activeElement === dialogRef.current)
    ) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

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
            <h2 id={titleId}>{title}</h2>
            {description ? <p id={descriptionId}>{description}</p> : null}
          </div>
        </div>
        {children}
        {actions ? <div className="modal-actions">{actions}</div> : null}
      </div>
    </div>,
    document.body,
  );
}
