"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useSaveStatus } from "@/components/shell/SaveStatus";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import type { SavedListItem } from "@/domain/saved-lists";
import type { SavedListActions, SavedListResult } from "@/features/staples/saved-list-actions";
import type { SavedListDetail } from "@/server/data/service";
import { ListItemSheet, type ItemOutcome } from "./ListItemSheet";
import { ListNameSheet, type RenameOutcome } from "./ListNameSheet";
import { groupByCategory, itemsLabel } from "./saved-lists-view";

type Load =
  | { phase: "loading" }
  | { phase: "error" }
  | { phase: "missing" }
  | { phase: "ready"; list: SavedListDetail };
type Editing = null | { item: SavedListItem | null };

export interface SavedListEditorProps {
  listId: string;
  actions: Pick<SavedListActions, "get" | "rename" | "addItem" | "updateItem" | "removeItem">;
}

// The list editor (#167, design §4): the list's items grouped by category, add / edit / remove, rename. Edits change
// only this list; trips made from it keep their own copy. The list updates only after the server confirms.
export function SavedListEditor({ listId, actions }: SavedListEditorProps) {
  const { track } = useSaveStatus();
  const toast = useToast();
  const [load, setLoad] = useState<Load>({ phase: "loading" });
  const [reloads, setReloads] = useState(0);
  const [editing, setEditing] = useState<Editing>(null);
  const [renaming, setRenaming] = useState(false);

  useEffect(() => {
    let cancelled = false;
    track(
      async () => {
        const result = await actions.get(listId);
        if (!result.ok) throw new Error(result.code);
        return result.list;
      },
      (list) => {
        if (!cancelled) setLoad({ phase: "ready", list });
      },
      { read: true },
    ).catch((error: unknown) => {
      if (cancelled) return;
      const code = error instanceof Error ? error.message : "";
      setLoad({ phase: code === "NOT_FOUND" || code === "INVALID_INPUT" ? "missing" : "error" });
    });
    return () => {
      cancelled = true;
    };
  }, [actions, listId, track, reloads]);

  /** Run one write; on success show the server's list. A refusal that is an answer (EXISTS) comes back as the outcome. */
  async function write(
    run: () => Promise<SavedListResult>,
    onDone?: (list: SavedListDetail) => void,
  ): Promise<ItemOutcome> {
    let outcome: ItemOutcome = { ok: true };
    try {
      await track(async () => {
        const result = await run();
        if (result.ok) {
          setLoad({ phase: "ready", list: result.list });
          onDone?.(result.list);
          return;
        }
        if (result.reason === "EXISTS") {
          outcome = { ok: false, reason: "EXISTS" };
          return;
        }
        throw new Error(result.code);
      });
    } catch {
      return { ok: false, reason: "FAILED" };
    }
    return outcome;
  }

  async function saveItem(
    current: SavedListItem | null,
    value: { name: string; category: string; qty: number },
  ): Promise<ItemOutcome> {
    const outcome = await write(
      () =>
        current ? actions.updateItem(listId, current.id, value) : actions.addItem(listId, value),
      () => {
        setEditing(null);
        toast.show(`${value.name} ${current ? "saved" : "added"}.`);
      },
    );
    return outcome;
  }

  async function removeItem(item: SavedListItem) {
    await write(
      () => actions.removeItem(listId, item.id),
      () =>
        toast.show(`“${item.name}” removed.`, {
          action: {
            label: "Undo",
            onAction: () =>
              void write(() =>
                actions.addItem(listId, {
                  name: item.name,
                  category: item.category,
                  qty: item.qty,
                }),
              ),
          },
        }),
    );
  }

  async function rename(name: string): Promise<RenameOutcome> {
    let outcome: RenameOutcome = { ok: true };
    try {
      await track(async () => {
        const result = await actions.rename(listId, name);
        if (result.ok) {
          setLoad({ phase: "ready", list: result.list });
          setRenaming(false);
          toast.show(`Renamed to “${name}”.`);
          return;
        }
        if (result.reason === "NAME_TAKEN") {
          outcome = { ok: false, reason: "NAME_TAKEN" };
          return;
        }
        throw new Error(result.code);
      });
    } catch {
      return { ok: false, reason: "FAILED" };
    }
    return outcome;
  }

  const back = (
    <Link className="back-link" href="/staples/lists">
      <span aria-hidden="true">←</span> Saved lists
    </Link>
  );

  if (load.phase === "loading") {
    return (
      <section className="screen saved-list-page" aria-busy="true" aria-label="Loading saved list">
        {back}
        <div className="staples-shell">
          {[0, 1, 2].map((row) => (
            <div className="skeleton-row" key={row} aria-hidden="true" />
          ))}
        </div>
      </section>
    );
  }

  if (load.phase === "missing") {
    return (
      <section className="screen saved-list-page">
        {back}
        <div className="empty-state">
          <h1 className="empty-state-title">That list isn’t available.</h1>
          <p className="muted">It may have been deleted.</p>
        </div>
      </section>
    );
  }

  if (load.phase === "error") {
    return (
      <section className="screen saved-list-page">
        {back}
        <div className="empty-state">
          <h1 className="empty-state-title">Couldn’t load this list.</h1>
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

  const { list } = load;
  const groups = groupByCategory(list.items);

  return (
    <section className="screen saved-list-page">
      {back}
      <div className="page-head staples-page-head">
        <div className="head-copy">
          <p className="eyebrow">Editing saved list</p>
          <h1>{list.name}</h1>
          <p className="muted">
            Edits here only change this list. Trips already made from it keep their own copy.
          </p>
        </div>
        <Button
          variant="ghost"
          aria-label={`Rename ${list.name}`}
          onClick={() => setRenaming(true)}
        >
          Rename
        </Button>
      </div>
      <div className="saved-list-toolbar">
        <Button small onClick={() => setEditing({ item: null })}>
          ＋ Add item
        </Button>
        <p className="muted">{itemsLabel(list.items.length)}</p>
      </div>

      {list.items.length === 0 ? (
        <div className="empty-state">
          <strong>This list is empty.</strong>
          <p className="muted">Add an item, or delete the list.</p>
        </div>
      ) : (
        <div className="staples-shell">
          {groups.map((group) => {
            const id = `list-category-${group.category.toLowerCase().replaceAll(" ", "-")}`;
            return (
              <section className="staple-category" key={group.category} aria-labelledby={id}>
                <div className="staple-category-head">
                  <h2 id={id}>{group.category}</h2>
                  <span className="category-count">{itemsLabel(group.rows.length)}</span>
                </div>
                {group.rows.map((item) => (
                  <div className="list-item-row" key={item.id} data-list-item-id={item.id}>
                    <div className="staple-name">
                      <strong>{item.name}</strong>
                    </div>
                    <span className="tag">Needed {item.qty}</span>
                    <Button
                      variant="ghost"
                      small
                      aria-label={`Edit ${item.name}`}
                      onClick={() => setEditing({ item })}
                    >
                      Edit
                    </Button>
                    <Button
                      variant="ghost"
                      small
                      className="danger-text"
                      aria-label={`Remove ${item.name}`}
                      onClick={() => void removeItem(item)}
                    >
                      Remove
                    </Button>
                  </div>
                ))}
              </section>
            );
          })}
        </div>
      )}

      {editing ? (
        <ListItemSheet
          key={editing.item?.id ?? "new"}
          item={editing.item}
          items={list.items}
          onSave={(value) => saveItem(editing.item, value)}
          onClose={() => setEditing(null)}
          onEditOther={(itemId) => {
            const other = list.items.find((entry) => entry.id === itemId);
            if (other) setEditing({ item: other });
          }}
        />
      ) : null}
      {renaming ? (
        <ListNameSheet currentName={list.name} onSave={rename} onClose={() => setRenaming(false)} />
      ) : null}
    </section>
  );
}
