"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useSaveStatus } from "@/components/shell/SaveStatus";
import { Button, buttonClassName } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { StaplesTabs } from "@/features/staples/StaplesTabs";
import type { SavedListActions } from "@/features/staples/saved-list-actions";
import type { SavedListSummary } from "@/server/data/service";
import { DeleteListSheet } from "./DeleteListSheet";
import { ListNameSheet, type RenameOutcome } from "./ListNameSheet";
import { categorySummary, itemsLabel, updatedText } from "./saved-lists-view";

type Load =
  { phase: "loading" } | { phase: "error" } | { phase: "ready"; lists: SavedListSummary[] };

export interface SavedListsScreenProps {
  actions: Pick<SavedListActions, "list" | "rename" | "remove">;
}

// The Saved lists page (#167, design §3): cards with name, item count, last change and what each holds; Edit, Rename and
// Delete. Lists are created from a trip's packing screen, so there is no Add button here.
export function SavedListsScreen({ actions }: SavedListsScreenProps) {
  const { track } = useSaveStatus();
  const toast = useToast();
  const [load, setLoad] = useState<Load>({ phase: "loading" });
  const [reloads, setReloads] = useState(0);
  const [renaming, setRenaming] = useState<SavedListSummary | null>(null);
  const [deleting, setDeleting] = useState<SavedListSummary | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Opening the page is a read: no "Saving…", but a failure shows Error and Retry.
    track(
      async () => {
        const result = await actions.list();
        if (!result.ok) throw new Error(result.code);
        return result.lists;
      },
      (lists) => {
        if (!cancelled) setLoad({ phase: "ready", lists });
      },
      { read: true },
    ).catch(() => {
      if (!cancelled) setLoad({ phase: "error" });
    });
    return () => {
      cancelled = true;
    };
  }, [actions, track, reloads]);

  /** Reload the cards after a write, so counts and dates are always the server's. */
  const refresh = useCallback(async () => {
    const result = await actions.list();
    if (result.ok) setLoad({ phase: "ready", lists: result.lists });
  }, [actions]);

  async function rename(list: SavedListSummary, name: string): Promise<RenameOutcome> {
    try {
      let outcome: RenameOutcome = { ok: true };
      await track(async () => {
        const result = await actions.rename(list.id, name);
        if (!result.ok) {
          outcome =
            result.reason === "NAME_TAKEN"
              ? { ok: false, reason: "NAME_TAKEN" }
              : { ok: false, reason: "FAILED" };
          // A refusal is an answer, not a failed save: nothing to retry.
          if (result.reason === "NAME_TAKEN") return;
          throw new Error(result.code);
        }
      });
      if (!outcome.ok) return outcome;
      await refresh();
      setRenaming(null);
      toast.show(`Renamed to “${name}”.`);
      return outcome;
    } catch {
      return { ok: false, reason: "FAILED" };
    }
  }

  async function remove(list: SavedListSummary): Promise<boolean> {
    try {
      await track(async () => {
        const result = await actions.remove(list.id);
        // Already gone (deleted elsewhere) is the outcome the person wanted.
        if (!result.ok && result.code !== "NOT_FOUND") throw new Error(result.code);
      });
      await refresh();
      setDeleting(null);
      toast.show(`“${list.name}” deleted.`);
      return true;
    } catch {
      return false;
    }
  }

  const head = (
    <>
      <div className="page-head staples-page-head">
        <div className="head-copy">
          <p className="eyebrow">My saved lists</p>
          <h1>Lists you reuse</h1>
          <p className="muted">
            Start a new trip from one of these. Changes here never rewrite existing trips.
          </p>
        </div>
      </div>
      <StaplesTabs current="lists" />
    </>
  );

  if (load.phase === "loading") {
    return (
      <section className="screen saved-list-page" aria-busy="true" aria-label="Loading saved lists">
        {head}
        <div className="staples-shell">
          {[0, 1, 2].map((row) => (
            <div className="skeleton-row" key={row} aria-hidden="true" />
          ))}
        </div>
      </section>
    );
  }

  if (load.phase === "error") {
    return (
      <section className="screen saved-list-page">
        {head}
        <div className="empty-state">
          <strong>Couldn’t load your saved lists.</strong>
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

  return (
    <section className="screen saved-list-page">
      {head}
      {load.lists.length === 0 ? (
        <div className="empty-state">
          <strong>No saved lists yet.</strong>
          <p className="muted">Open a trip, then choose Save as a list on its packing screen.</p>
          <Link className={buttonClassName({ variant: "secondary" })} href="/">
            Go to trips
          </Link>
        </div>
      ) : (
        <ul className="saved-lists">
          {load.lists.map((list) => (
            <li key={list.id}>
              <article className="saved-list-card" aria-labelledby={`list-${list.id}`}>
                <h2 id={`list-${list.id}`}>{list.name}</h2>
                <p className="saved-list-meta">
                  {itemsLabel(list.itemCount)} · updated {updatedText(list.updatedAt)}
                </p>
                {list.categories.length ? (
                  <p className="saved-list-categories">{categorySummary(list.categories)}</p>
                ) : null}
                <div className="saved-list-actions">
                  <Link
                    className={buttonClassName({ variant: "secondary" })}
                    href={`/staples/lists/${list.id}`}
                    aria-label={`Edit ${list.name}`}
                  >
                    Edit
                  </Link>
                  <Button
                    variant="ghost"
                    aria-label={`Rename ${list.name}`}
                    onClick={() => setRenaming(list)}
                  >
                    Rename
                  </Button>
                  <Button
                    variant="ghost"
                    className="danger-text"
                    aria-label={`Delete ${list.name}`}
                    onClick={() => setDeleting(list)}
                  >
                    Delete
                  </Button>
                </div>
              </article>
            </li>
          ))}
        </ul>
      )}

      {renaming ? (
        <ListNameSheet
          currentName={renaming.name}
          onSave={(name) => rename(renaming, name)}
          onClose={() => setRenaming(null)}
        />
      ) : null}
      {deleting ? (
        <DeleteListSheet
          name={deleting.name}
          onDelete={() => remove(deleting)}
          onClose={() => setDeleting(null)}
        />
      ) : null}
    </section>
  );
}
