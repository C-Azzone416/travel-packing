"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import type { Staple } from "@/domain/trip";
import type { StaplesSetup } from "@/domain/staples-setup";
import type { StaplesSetupResult } from "@/features/trips/trip-actions";
import { StaplesSetupScreen } from "./StaplesSetupScreen";

export interface StaplesSetupActions {
  get(): Promise<StaplesSetupResult>;
  save(staples: Staple[]): Promise<StaplesSetupResult>;
  skip(): Promise<StaplesSetupResult>;
  dismiss(): Promise<StaplesSetupResult>;
}

type Load = { phase: "loading" } | { phase: "error" } | { phase: "ready"; setup: StaplesSetup };

const unwrap = (result: StaplesSetupResult): StaplesSetup => {
  if (!result.ok) throw new Error(result.code);
  return {
    state: result.state,
    reminderDismissed: result.reminderDismissed,
    staples: result.staples,
  };
};

export function StaplesSetupGate({
  actions,
  children,
}: {
  actions: StaplesSetupActions;
  children: ReactNode;
}) {
  const [load, setLoad] = useState<Load>({ phase: "loading" });
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [mutationError, setMutationError] = useState(false);
  const [reloads, setReloads] = useState(0);

  useEffect(() => {
    let cancelled = false;
    actions
      .get()
      .then(unwrap)
      .then((setup) => {
        if (!cancelled) setLoad({ phase: "ready", setup });
      })
      .catch(() => {
        if (!cancelled) setLoad({ phase: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [actions, reloads]);

  const run = useCallback(
    (work: () => Promise<StaplesSetupResult>, after?: () => void, keepSetupOnError = false) => {
      if (busy) return;
      setBusy(true);
      setMutationError(false);
      work()
        .then(unwrap)
        .then((setup) => {
          setLoad({ phase: "ready", setup });
          after?.();
        })
        .catch(() => {
          if (keepSetupOnError) setMutationError(true);
          else setLoad({ phase: "error" });
        })
        .finally(() => setBusy(false));
    },
    [busy],
  );

  if (load.phase === "loading") {
    return (
      <section className="screen" aria-busy="true" aria-label="Loading Staples setup">
        <h1 className="sr-only">Loading your Staples</h1>
        <div className="skeleton-card" />
      </section>
    );
  }
  if (load.phase === "error") {
    return (
      <section className="screen">
        <div className="empty-state">
          <h1>Couldn’t load your Staples setup.</h1>
          <p className="muted">Nothing was changed.</p>
          <Button
            onClick={() => {
              setLoad({ phase: "loading" });
              setReloads((value) => value + 1);
            }}
          >
            Try again
          </Button>
        </div>
      </section>
    );
  }

  const { setup } = load;
  if (setup.state === "incomplete" || open) {
    return (
      <StaplesSetupScreen
        setup={setup}
        busy={busy}
        saveError={mutationError}
        onSave={(staples) =>
          run(
            () => actions.save(staples),
            () => setOpen(false),
            true,
          )
        }
        onSkip={() => {
          setMutationError(false);
          return setup.state === "incomplete" ? run(actions.skip) : setOpen(false);
        }}
      />
    );
  }

  return (
    <>
      {setup.state === "skipped" && !setup.reminderDismissed ? (
        <aside className="callout staples-reminder" aria-label="Staples setup reminder">
          <div>
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
