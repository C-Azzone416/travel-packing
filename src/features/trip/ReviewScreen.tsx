"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSaveStatus } from "@/components/shell/SaveStatus";
import { Button, buttonClassName } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ModalSheet } from "@/components/ui/ModalSheet";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useToast } from "@/components/ui/Toast";
import type { TripItem } from "@/domain/trip";
import type { LifecycleTrip } from "@/domain/trip-lifecycle";
import { TripsSourceError, type TripChange } from "@/features/trips/trips-source";
import { useTripsSource } from "@/features/trips/TripsSourceProvider";
import { readyBlocker, reviewStatus, revocationReason } from "./review-view";
import { bagGate, isComplete, tripSections } from "./trip-view";

type Load =
  | { phase: "loading" }
  | { phase: "missing" }
  | { phase: "error" }
  | { phase: "ready"; trip: LifecycleTrip };

/** The element to put focus back on after a change re-renders the page (a row's button, the bag step, the Ready button). */
const FOCUS_ATTR = "data-review-focus";

function ReviewRows({
  id,
  title,
  items,
  busy,
  onToggle,
}: {
  id: string;
  title: string;
  items: TripItem[];
  busy: boolean;
  onToggle: (item: TripItem) => void;
}) {
  return (
    <section className="review-group" aria-labelledby={id}>
      <div className="list-section-head">
        <div>
          <h3 id={id}>{title}</h3>
        </div>
        <span className="tag">{items.length}</span>
      </div>
      {items.map((item) => {
        const complete = isComplete(item);
        return (
          <div className="review-row" key={item.id} data-item-id={item.id}>
            <div>
              <strong>{item.name}</strong>
              {item.section === "packlast" ? <span className="timing-tag">Pack last</span> : null}
              <div className="item-meta">
                {item.packed} of {item.qty} packed
              </div>
            </div>
            <button
              type="button"
              className={buttonClassName({
                variant: complete ? "secondary" : "primary",
                small: true,
              })}
              aria-disabled={busy}
              {...{ [FOCUS_ATTR]: item.id }}
              onClick={() => !busy && onToggle(item)}
            >
              {complete ? "Packed ✓" : "Fix: unpacked"}{" "}
              <span className="sr-only">
                {item.name}
                {complete ? ", mark unpacked" : ""}
              </span>
            </button>
          </div>
        );
      })}
    </section>
  );
}

export function ReviewScreen({ tripId }: { tripId: string }) {
  const source = useTripsSource();
  const { track } = useSaveStatus();
  const toast = useToast();
  const [load, setLoad] = useState<Load>({ phase: "loading" });
  const [reloads, setReloads] = useState(0);
  const [busy, setBusy] = useState(false);
  const [bagDialog, setBagDialog] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const bagPromptDismissed = useRef(false);
  const focusKey = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Opening the review is a read: it never shows "Saving…", but a failure shows Error and Retry.
    track(
      () => source.getTrip(tripId),
      (trip) => {
        if (!cancelled) setLoad({ phase: "ready", trip });
      },
      { read: true },
    ).catch((error: unknown) => {
      if (cancelled) return;
      setLoad({
        phase:
          error instanceof TripsSourceError &&
          (error.message === "NOT_FOUND" || error.message === "INVALID_INPUT")
            ? "missing"
            : "error",
      });
    });
    return () => {
      cancelled = true;
    };
  }, [source, track, tripId, reloads]);

  // After a change the page re-renders; put focus back where the user was working (the same row, not the top).
  useEffect(() => {
    if (!focusKey.current) return;
    const target = document.querySelector<HTMLElement>(`[${FOCUS_ATTR}="${focusKey.current}"]`);
    focusKey.current = null;
    target?.focus();
  }, [load]);

  const trip = load.phase === "ready" ? load.trip : null;

  // Every change waits for the server: the page only changes after it confirms, and a failure leaves it as it was.
  const act = useCallback(
    (
      write: () => Promise<TripChange>,
      options: {
        focus?: string;
        message?: (change: TripChange, before: LifecycleTrip) => void;
      } = {},
    ) => {
      if (!trip) return Promise.resolve();
      const before = trip;
      setBusy(true);
      return track(write, (change) => {
        focusKey.current = options.focus ?? null;
        setLoad({ phase: "ready", trip: change.trip });
        const reason = revocationReason(before, change.trip);
        if (reason) toast.show(`No longer ready: ${reason}`);
        if (change.signals.promptBagPlacement && !bagPromptDismissed.current) setBagDialog(true);
        options.message?.(change, before);
      })
        .catch(() => undefined)
        .finally(() => setBusy(false));
    },
    [toast, track, trip],
  );

  if (load.phase === "loading") {
    return (
      <section className="screen" aria-busy="true" aria-label="Loading review">
        <h1>Review your bag</h1>
      </section>
    );
  }
  if (load.phase === "missing") {
    return (
      <section className="screen">
        <h1>That trip isn’t available</h1>
        <p className="lede">It may have been removed. Your other trips are untouched.</p>
        <Link className={buttonClassName()} href="/">
          Back to trips
        </Link>
      </section>
    );
  }
  if (load.phase === "error") {
    return (
      <section className="screen">
        <h1>Review your bag</h1>
        <div className="empty-state">
          <strong>Couldn’t load this trip.</strong>
          <p className="muted">Nothing was changed.</p>
          <Button
            onClick={() => {
              setLoad({ phase: "loading" });
              setReloads((count) => count + 1);
            }}
          >
            Try again
          </Button>
        </div>
      </section>
    );
  }

  const current = load.trip;
  const sections = tripSections(current);
  const gate = bagGate(current);
  const blocker = readyBlocker(current);
  const status = reviewStatus(current);
  const toggle = (item: TripItem) =>
    void act(() => source.togglePacked(tripId, item.id), { focus: item.id });

  return (
    <section className="screen">
      <div className="page-head">
        <Link className="back" href={`/trips/${tripId}`} aria-label="Back to packing list">
          ←
        </Link>
        <div className="head-copy">
          <p className="eyebrow">Final check</p>
          <h1>Review your bag</h1>
          <p className="muted">
            Nothing becomes Ready automatically. Make corrections here, then confirm when it looks
            right.
          </p>
        </div>
        {current.ready ? (
          <StatusBadge status="ready">Ready</StatusBadge>
        ) : (
          <StatusBadge status="draft">Packing</StatusBadge>
        )}
      </div>

      <p className="sr-only" role="status" aria-label="Review updates">
        {announcement}
      </p>

      <Card padded className="review-card">
        <ReviewRows
          id="review-main"
          title="Everyday & occasion items"
          items={sections.main}
          busy={busy}
          onToggle={toggle}
        />
        <ReviewRows
          id="review-toiletries"
          title="Toiletries · Bathroom"
          items={sections.toiletries}
          busy={busy}
          onToggle={toggle}
        />
        {gate.state !== "none" ? (
          <section className="review-group bag-review-gate" aria-label="Toiletry bag in suitcase">
            <div className="review-row">
              <div>
                <strong>Toiletry bag in suitcase</strong>
                <div className="item-meta">
                  Separate completion gate ·{" "}
                  {current.toiletryBagPacked ? "confirmed" : "not confirmed"}
                </div>
              </div>
              {gate.state === "waiting" ? (
                <span className="status-pill">Waiting on contents</span>
              ) : gate.state === "complete" ? (
                <Button
                  variant="secondary"
                  small
                  aria-disabled={busy}
                  {...{ [FOCUS_ATTR]: "bag" }}
                  onClick={() =>
                    !busy && void act(() => source.undoBagPlacement(tripId), { focus: "bag" })
                  }
                >
                  Undo placement
                </Button>
              ) : (
                <Button
                  small
                  aria-disabled={busy}
                  {...{ [FOCUS_ATTR]: "bag" }}
                  onClick={() => !busy && setBagDialog(true)}
                >
                  Put bag in suitcase
                </Button>
              )}
            </div>
          </section>
        ) : null}
        {sections.returns.length ? (
          <ReviewRows
            id="review-return"
            title="Return travel outfit"
            items={sections.returns}
            busy={busy}
            onToggle={toggle}
          />
        ) : null}
        {sections.packLast.length ? (
          <ReviewRows
            id="review-packlast"
            title="Pack last timing view"
            items={sections.packLast}
            busy={busy}
            onToggle={toggle}
          />
        ) : null}

        <div className="callout">
          <strong>{status.status}</strong> {status.help}
        </div>

        <div className="actions review-actions">
          {current.ready ? (
            <Button
              variant="secondary"
              aria-disabled={busy}
              {...{ [FOCUS_ATTR]: "ready" }}
              onClick={() =>
                !busy &&
                void act(() => source.markNotReady(tripId), {
                  focus: "ready",
                  message: () => {
                    toast.show("Progress kept.");
                    setAnnouncement("Marked not ready. Progress kept.");
                  },
                })
              }
            >
              Mark as not ready
            </Button>
          ) : (
            <>
              <Button
                aria-disabled={busy || blocker !== null}
                aria-describedby={blocker ? "ready-blocker" : undefined}
                {...{ [FOCUS_ATTR]: "ready" }}
                onClick={() =>
                  !busy &&
                  blocker === null &&
                  void act(() => source.markReady(tripId), {
                    focus: "ready",
                    message: () => setAnnouncement("Marked ready."),
                  })
                }
              >
                I’m ready to go
              </Button>
              {blocker ? (
                <p id="ready-blocker" className="tiny muted ready-blocker">
                  {blocker}
                </p>
              ) : null}
            </>
          )}
          <Link className={buttonClassName({ variant: "secondary" })} href={`/trips/${tripId}`}>
            Back to packing list
          </Link>
        </div>
      </Card>

      <ModalSheet
        open={bagDialog}
        title="Toiletry bag in suitcase?"
        description="A separate bag-placement step."
        onClose={() => {
          bagPromptDismissed.current = true;
          setBagDialog(false);
        }}
        actions={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                bagPromptDismissed.current = true;
                setBagDialog(false);
              }}
            >
              Not yet
            </Button>
            <Button
              onClick={() =>
                void act(() => source.confirmBagPlacement(tripId), { focus: "bag" }).then(() =>
                  setBagDialog(false),
                )
              }
            >
              Confirm
            </Button>
          </>
        }
      >
        <p>All Bathroom items are checked. Is the completed toiletry bag in the suitcase?</p>
      </ModalSheet>
    </section>
  );
}
