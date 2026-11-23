"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/Button";
import type { Staple } from "@/domain/trip";
import type { StaplesSetup } from "@/domain/staples-setup";
import type { StaplesSetupBaseline, StaplesSetupResult } from "@/features/trips/trip-actions";
import { StaplesSetupScreen } from "./StaplesSetupScreen";

export interface StaplesSetupActions {
  get(): Promise<StaplesSetupResult>;
  save(staples: Staple[], baseline: StaplesSetupBaseline): Promise<StaplesSetupResult>;
  skip(): Promise<StaplesSetupResult>;
  dismiss(): Promise<StaplesSetupResult>;
}

type ReviewedSetup = StaplesSetup & { baseline: StaplesSetupBaseline };
type Load = { phase: "loading" } | { phase: "error" } | { phase: "ready"; setup: ReviewedSetup };

const unwrap = (result: StaplesSetupResult): ReviewedSetup => {
  if (!result.ok) throw new Error(result.code);
  if (
    result.staples.some(
      ({ revision }) =>
        !revision || !revision.rowId || !Number.isInteger(revision.version) || revision.version < 1,
    )
  )
    throw new Error("INVALID_INPUT");
  return {
    state: result.state,
    reminderDismissed: result.reminderDismissed,
    staples: result.staples,
    baseline: Object.freeze(
      result.staples.map((entry) =>
        Object.freeze({
          semanticId: entry.id,
          revision: Object.freeze({ ...entry.revision! }),
        }),
      ),
    ),
  };
};

export function StaplesSetupGate({
  actions,
  children,
}: {
  actions: StaplesSetupActions;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [load, setLoad] = useState<Load>({ phase: "loading" });
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [mutationError, setMutationError] = useState(false);
  const [reloads, setReloads] = useState(0);
  const [saveFailure, setSaveFailure] = useState<"retry" | "conflict" | "reload" | null>(null);
  const [reviewKey, setReviewKey] = useState(0);
  const flight = useRef(false);
  const intended = useRef<{ staples: Staple[]; baseline: StaplesSetupBaseline } | null>(null);

  async function save(staples: Staple[], setup: ReviewedSetup) {
    if (flight.current || (saveFailure && saveFailure !== "retry")) return;
    intended.current ??= {
      staples: Object.freeze(
        staples.map((entry) =>
          Object.freeze({
            ...entry,
            ...(entry.revision ? { revision: Object.freeze({ ...entry.revision }) } : {}),
          }),
        ),
      ) as unknown as Staple[],
      baseline: setup.baseline,
    };
    flight.current = true;
    setBusy(true);
    setSaveFailure(null);
    try {
      const result = await actions.save(intended.current.staples, intended.current.baseline);
      if (!result.ok) {
        setSaveFailure(
          result.code === "STALE" || result.code === "INVALID_INPUT" ? "conflict" : "retry",
        );
        return;
      }
      setLoad({ phase: "ready", setup: unwrap(result) });
      intended.current = null;
      setOpen(false);
    } catch {
      setSaveFailure("retry");
    } finally {
      flight.current = false;
      setBusy(false);
    }
  }

  async function review() {
    if (flight.current) return;
    flight.current = true;
    setBusy(true);
    try {
      const setup = unwrap(await actions.get());
      setLoad({ phase: "ready", setup });
      intended.current = null;
      setSaveFailure(null);
      setMutationError(false);
      setReviewKey((value) => value + 1);
    } catch {
      setSaveFailure("reload");
    } finally {
      flight.current = false;
      setBusy(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    actions
      .get()
      .then(unwrap)
      .then((setup) => {
        if (!cancelled && !intended.current) setLoad({ phase: "ready", setup });
      })
      .catch(() => {
        if (!cancelled && !intended.current) setLoad({ phase: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [actions, reloads]);

  const run = useCallback((work: () => Promise<StaplesSetupResult>, after?: () => void) => {
    if (flight.current) return;
    flight.current = true;
    setBusy(true);
    setMutationError(false);
    work()
      .then(unwrap)
      .then((setup) => {
        setLoad({ phase: "ready", setup });
        after?.();
      })
      .catch(() => {
        setMutationError(true);
      })
      .finally(() => {
        flight.current = false;
        setBusy(false);
      });
  }, []);

  if (load.phase === "loading") {
    return (
      <section className="screen" aria-busy="true" aria-label="Loading Staples setup">
        <h1 className="sr-only">Loading your Staples</h1>
        <div className="skeleton-card" />
      </section>
    );
  }
  if (load.phase === "error") {
    const retry = () => {
      setLoad({ phase: "loading" });
      setReloads((value) => value + 1);
    };
    if (pathname !== "/staples") {
      return (
        <>
          <div
            className="callout staples-reminder staples-setup-notice"
            role="status"
            aria-label="Staples setup unavailable"
          >
            <div>
              <strong>Couldn’t check your Staples setup.</strong>
              <p>You can keep using your trips. Nothing was changed.</p>
            </div>
            <Button small variant="ghost" onClick={retry}>
              Try again
            </Button>
          </div>
          {children}
        </>
      );
    }
    return (
      <section className="screen">
        <div className="empty-state">
          <h1>Couldn’t load your Staples setup.</h1>
          <p className="muted">Nothing was changed. Try again to reload your Staples.</p>
          <Button onClick={retry}>Try again</Button>
        </div>
      </section>
    );
  }

  const { setup } = load;
  if (setup.state === "incomplete" || open) {
    return (
      <StaplesSetupScreen
        key={reviewKey}
        setup={setup}
        busy={busy}
        saveError={mutationError || saveFailure !== null}
        recovery={saveFailure ?? undefined}
        onReview={() => void review()}
        onSave={(staples) => void save(staples, setup)}
        onSkip={() => {
          if (flight.current) return;
          const discard = () => {
            intended.current = null;
            setSaveFailure(null);
            setOpen(false);
          };
          setMutationError(false);
          return setup.state === "incomplete" ? run(actions.skip, discard) : discard();
        }}
      />
    );
  }

  return (
    <>
      {setup.state === "skipped" && !setup.reminderDismissed ? (
        <aside className="callout staples-reminder" aria-label="Staples setup reminder">
          <div className="staples-reminder-copy">
            <strong>
              {setup.staples.length > 0
                ? "Review the Staples already in your account."
                : "Build your Staples when you’re ready."}
            </strong>
            <p>
              {setup.staples.length > 0
                ? "Check your recurring list before your next trip."
                : "Start future trips from your own recurring list."}
            </p>
            {mutationError ? (
              <p className="staples-reminder-error" role="alert">
                Couldn’t update your reminder. Try again.
              </p>
            ) : null}
          </div>
          <div className="actions">
            <Button small onClick={() => setOpen(true)}>
              {setup.staples.length > 0 ? "Review Staples" : "Build Staples"}
            </Button>
            <Button small variant="ghost" disabled={busy} onClick={() => run(actions.dismiss)}>
              Don’t remind me
            </Button>
          </div>
        </aside>
      ) : null}
      {children}
    </>
  );
}
