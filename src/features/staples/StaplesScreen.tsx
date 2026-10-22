"use client";

import { useCallback, useEffect, useState } from "react";
import { useSaveStatus } from "@/components/shell/SaveStatus";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import type { Staple } from "@/domain/trip";
import { useTripsSource } from "@/features/trips/TripsSourceProvider";
import { StapleEditor } from "./StapleEditor";
import {
  countLabel,
  groupStaples,
  sectionDescription,
  unitLabel,
  type StapleFilter,
} from "./staples-view";

type Load = { phase: "loading" } | { phase: "error" } | { phase: "ready"; staples: Staple[] };
type Editing = null | { staple: Staple | null };

export function StaplesScreen() {
  const source = useTripsSource();
  const { track } = useSaveStatus();
  const toast = useToast();
  const [load, setLoad] = useState<Load>({ phase: "loading" });
  const [reloads, setReloads] = useState(0);
  const [filter, setFilter] = useState<StapleFilter>("all");
  const [editing, setEditing] = useState<Editing>(null);
  const [saving, setSaving] = useState(false);
  const [announcement, setAnnouncement] = useState("");

  useEffect(() => {
    let cancelled = false;
    // Opening the screen is a read: it never shows "Saving…", but a failure shows Error and Retry.
    track(
      () => source.listStaples(),
      (staples) => {
        if (!cancelled) setLoad({ phase: "ready", staples });
      },
      { read: true },
    ).catch(() => {
      if (!cancelled) setLoad({ phase: "error" });
    });
    return () => {
      cancelled = true;
    };
  }, [source, track, reloads]);

  const save = useCallback(
    (staple: Staple) => {
      setSaving(true);
      // The list changes only after the server confirms; a failure keeps the editor open with the Error chip.
      void track(
        () => source.upsertStaple(staple),
        (staples) => {
          setLoad({ phase: "ready", staples });
          setEditing(null);
          toast.show(`${staple.name} saved for future trips.`);
        },
      )
        .catch(() => undefined)
        .finally(() => setSaving(false));
    },
    [source, toast, track],
  );

  const choose = (next: StapleFilter) => {
    setFilter(next);
    if (load.phase === "ready") {
      const shown =
        next === "all" ? load.staples.length : load.staples.filter((s) => s.packLast).length;
      setAnnouncement(`${countLabel(shown)} shown`);
    }
  };

  const head = (
    <div className="page-head staples-page-head">
      <div className="head-copy">
        <p className="eyebrow">My staples</p>
        <h1>Every trip starts here</h1>
        <p className="muted">
          Clothing, bathroom, tech, and the other recurring essentials that seed every new trip.
          Changes here never rewrite existing trips.
        </p>
      </div>
      {load.phase === "ready" ? (
        <Button small onClick={() => setEditing({ staple: null })}>
          ＋ Add
        </Button>
      ) : null}
    </div>
  );

  if (load.phase === "loading") {
    return (
      <section className="screen" aria-busy="true" aria-label="Loading staples">
        {head}
        <div className="staples-shell">
          {[0, 1, 2, 3].map((row) => (
            <div className="skeleton-row" key={row} aria-hidden="true" />
          ))}
        </div>
      </section>
    );
  }

  if (load.phase === "error") {
    return (
      <section className="screen">
        {head}
        <div className="empty-state">
          <strong>Couldn’t load your staples.</strong>
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

  const sections = groupStaples(load.staples, filter);
  const target = editing?.staple ?? null;

  return (
    <section className="screen">
      {head}
      <p className="sr-only" role="status" aria-label="Staples updates">
        {announcement}
      </p>
      <div className="staples-shell">
        <div className="staples-toolbar">
          <div className="quick-filters" role="group" aria-label="Filter staples">
            <button type="button" aria-pressed={filter === "all"} onClick={() => choose("all")}>
              All
            </button>
            <button
              type="button"
              aria-pressed={filter === "packlast"}
              onClick={() => choose("packlast")}
            >
              Pack last
            </button>
          </div>
          <p>
            <strong>Pack last</strong> is a timing flag on an item, not a separate category.
          </p>
        </div>
        <div className="staple-categories">
          {sections.length ? (
            sections.map(({ section, staples }) => {
              const id = `staples-${section.toLowerCase().replaceAll(" ", "-")}`;
              return (
                <section className="staple-category" key={section} aria-labelledby={id}>
                  <div className="staple-category-head">
                    <div>
                      <h2 id={id}>{section}</h2>
                      <p>{sectionDescription(section)}</p>
                    </div>
                    <span className="category-count">{countLabel(staples.length)}</span>
                  </div>
                  {staples.length ? (
                    staples.map((staple) => (
                      <div className="staple-row" key={staple.id} data-staple-id={staple.id}>
                        <div className="staple-name">
                          <strong>{staple.name}</strong>
                          {staple.packLast ? <span className="timing-tag">Pack last</span> : null}
                        </div>
                        <span className="unit-badge">{unitLabel(staple)}</span>
                        <button
                          type="button"
                          className="icon-button"
                          aria-label={`Edit ${staple.name}`}
                          onClick={() => setEditing({ staple })}
                        >
                          <span aria-hidden="true">✎</span>
                        </button>
                      </div>
                    ))
                  ) : (
                    <p className="staple-empty">No staples yet</p>
                  )}
                </section>
              );
            })
          ) : (
            <div className="empty-state">No staples match this filter.</div>
          )}
        </div>
        <div className="callout staples-note">
          Editing an item from a trip lets you choose <strong>This trip only</strong> or{" "}
          <strong>Remember for future trips</strong>. Remembered changes affect future trips only.
        </div>
      </div>
      {editing ? (
        <StapleEditor
          key={target?.id ?? "new"}
          staple={target}
          staples={load.staples}
          saving={saving}
          onClose={() => setEditing(null)}
          onSave={save}
          onEditOther={(id) =>
            setEditing({ staple: load.staples.find((staple) => staple.id === id) ?? null })
          }
        />
      ) : null}
    </section>
  );
}
