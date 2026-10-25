"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { STAPLE_SUGGESTIONS, type StaplesSetup } from "@/domain/staples-setup";
import type { Staple } from "@/domain/trip";
import { StapleEditor } from "./StapleEditor";
import { SECTIONS, sectionOf } from "./staples-view";

export interface StaplesSetupScreenProps {
  setup: StaplesSetup;
  busy: boolean;
  saveError?: boolean;
  onSave: (staples: Staple[]) => void;
  onSkip: () => void;
}

type Editing = null | { staple: Staple | null };

/** First-run setup is local until one atomic save; closing/reloading restores the last committed server state. */
export function StaplesSetupScreen({
  setup,
  busy,
  saveError = false,
  onSave,
  onSkip,
}: StaplesSetupScreenProps) {
  const [staples, setStaples] = useState<Staple[]>(setup.staples);
  const [editing, setEditing] = useState<Editing>(null);
  const selected = useMemo(() => new Set(staples.map((staple) => staple.id)), [staples]);
  const target = editing?.staple ?? null;

  function toggle(suggestion: Staple) {
    setStaples((current) =>
      current.some((entry) => entry.id === suggestion.id)
        ? current.filter((entry) => entry.id !== suggestion.id)
        : [...current, suggestion],
    );
  }

  function saveOne(staple: Staple) {
    setStaples((current) =>
      current.some((entry) => entry.id === staple.id)
        ? current.map((entry) => (entry.id === staple.id ? staple : entry))
        : [...current, staple],
    );
    setEditing(null);
  }

  return (
    <section className="screen staples-setup" aria-labelledby="staples-setup-title">
      <div className="page-head staples-page-head">
        <div className="head-copy">
          <p className="eyebrow">Optional setup</p>
          <h1 id="staples-setup-title">Build your Staples</h1>
          <p className="muted">
            Choose only what belongs on every trip. Nothing is selected for you, and you can change
            this list later without rewriting existing trips.
          </p>
        </div>
        <Button
          small
          variant="secondary"
          onClick={() => setEditing({ staple: null })}
          disabled={busy}
        >
          ＋ Custom item
        </Button>
      </div>

      <div className="staple-categories">
        {SECTIONS.map((section) => {
          const suggestions = STAPLE_SUGGESTIONS.filter((entry) => entry.category === section);
          if (suggestions.length === 0) return null;
          return (
            <section className="staple-category" key={section} aria-labelledby={`setup-${section}`}>
              <div className="staple-category-head">
                <h2 id={`setup-${section}`}>{section}</h2>
                <span className="category-count">Suggestions</span>
              </div>
              {suggestions.map(({ staple }) => {
                const current = staples.find((entry) => entry.id === staple.id);
                return (
                  <div className="staple-row" key={staple.id}>
                    <label className="staple-name staples-suggestion-check">
                      <input
                        type="checkbox"
                        checked={selected.has(staple.id)}
                        onChange={() => toggle(staple)}
                        disabled={busy}
                      />
                      <span className="save-list-box" aria-hidden="true">
                        ✓
                      </span>
                      <strong>{current?.name ?? staple.name}</strong>
                    </label>
                    {current ? (
                      <Button small variant="ghost" onClick={() => setEditing({ staple: current })}>
                        Edit
                      </Button>
                    ) : null}
                  </div>
                );
              })}
            </section>
          );
        })}
      </div>

      {staples.some((entry) => !STAPLE_SUGGESTIONS.some(({ staple }) => staple.id === entry.id)) ? (
        <section className="staple-category" aria-labelledby="setup-custom-items">
          <div className="staple-category-head">
            <h2 id="setup-custom-items">Your custom items</h2>
          </div>
          {staples
            .filter((entry) => !STAPLE_SUGGESTIONS.some(({ staple }) => staple.id === entry.id))
            .map((staple) => (
              <div className="staple-row" key={staple.id}>
                <div className="staple-name">
                  <strong>{staple.name}</strong>
                  <span className="unit-badge">{sectionOf(staple)}</span>
                </div>
                <Button small variant="ghost" onClick={() => setEditing({ staple })}>
                  Edit
                </Button>
              </div>
            ))}
        </section>
      ) : null}

      <div className="staples-setup-actions-shell">
        {saveError ? (
          <div className="callout error staples-setup-error" role="alert">
            <strong>Couldn’t save your Staples.</strong>
            <p>Your selections are still here. Check your connection and try again.</p>
          </div>
        ) : null}
        <div className="actions staples-setup-actions">
          <Button variant="ghost" onClick={onSkip} disabled={busy}>
            Skip for now
          </Button>
          <Button onClick={() => onSave(staples)} disabled={busy}>
            {busy
              ? "Saving…"
              : saveError
                ? "Try save again"
                : `Save ${staples.length || "empty"} Staples`}
          </Button>
        </div>
      </div>

      {editing ? (
        <StapleEditor
          key={target?.id ?? "new"}
          staple={target}
          staples={staples}
          saving={false}
          onClose={() => setEditing(null)}
          onSave={saveOne}
          onRemove={
            target
              ? () => {
                  setStaples((current) => current.filter((entry) => entry.id !== target.id));
                  setEditing(null);
                }
              : undefined
          }
          onEditOther={(id) =>
            setEditing({ staple: staples.find((entry) => entry.id === id) ?? null })
          }
        />
      ) : null}
    </section>
  );
}
