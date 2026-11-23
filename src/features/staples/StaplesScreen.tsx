"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Suitcase } from "@/components/suitcase/Suitcase";
import { useSaveStatus } from "@/components/shell/SaveStatus";
import { Icon } from "@/components/ui/Icon";
import { useToast } from "@/components/ui/Toast";
import { LAPTOP_QUERY, useMediaQuery } from "@/components/ui/useMediaQuery";
import { CUBE_LABELS, type Cube } from "@/domain/cubes";
import type { StapleRevision } from "@/domain/calc/staples";
import type { Staple } from "@/domain/trip";
import { useTripsSource } from "@/features/trips/TripsSourceProvider";
import { removeStapleAction } from "@/features/trips/trip-actions";
import { StapleInlineEditor } from "./StapleInlineEditor";
import { StapleRow } from "./StapleRow";
import { StapleSheet } from "./StapleSheet";
import { StaplesPreview, previewTotalText } from "./StaplesPreview";
import { StaplesTabs } from "./StaplesTabs";
import { STAPLE_COUNT_RULES, STAPLE_LAUNDRY_NOTE } from "./staple-count-rules";
import {
  DEFAULT_NIGHTS,
  STAPLE_CUBES,
  groupByCube,
  itemsLabel,
  nightsLabel,
  moveToCube,
  previewStaples,
  stapleCount,
  stapleCube,
} from "./staples-cubes";
import { findDuplicate, newStapleId } from "./staples-view";
import styles from "./Staples.module.css";

type Load = { phase: "loading" } | { phase: "error" } | { phase: "ready"; staples: Staple[] };

type Operation = {
  phase: "pending" | "failed" | "conflict" | "loading" | "load-failed";
  retired: boolean;
  retry: () => void;
  write?: () => Promise<Staple[]>;
};
const NAME_MAX = 50;

export function StaplesScreen({
  removeStaple = async (id: string, expected: StapleRevision) => {
    const result = await removeStapleAction(id, expected);
    if (!result.ok) throw new Error(result.code);
    return result.staples;
  },
}: {
  removeStaple?: (id: string, expected: StapleRevision) => Promise<Staple[]>;
} = {}) {
  const source = useTripsSource();
  const { track, discard } = useSaveStatus();
  const toast = useToast();
  const [load, setLoad] = useState<Load>({ phase: "loading" });
  const [reloads, setReloads] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Staple>>({});
  const [announcement, setAnnouncement] = useState("");
  const [previewOn, setPreviewOn] = useState(false);
  const [nights, setNights] = useState(DEFAULT_NIGHTS);
  const [laundry, setLaundry] = useState(true);
  const [name, setName] = useState("");
  const [addCube, setAddCube] = useState<Cube>("clothing");
  const [problem, setProblem] = useState<
    null | { kind: "name" } | { kind: "duplicate"; id: string }
  >(null);
  const laptop = useMediaQuery(LAPTOP_QUERY);
  const operations = useRef<Record<string, Operation>>({});
  const [, refresh] = useState(0);
  const changed = () => refresh((value) => value + 1);
  const rowButtons = useRef<Record<string, HTMLButtonElement | null>>({});

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

  const clearDraft = useCallback((id: string) => {
    setDrafts((current) => {
      const { [id]: _gone, ...rest } = current;
      void _gone;
      return rest;
    });
  }, []);

  // Advance only this target's confirmed baseline; unrelated local operations keep their own intent.
  const accept = (id: string, rows: Staple[]) =>
    setLoad((current) => {
      if (current.phase !== "ready") return current;
      const row = rows.find((entry) => entry.id === id);
      const staples = current.staples.flatMap((entry) =>
        entry.id === id ? (row ? [row] : []) : [entry],
      );
      if (row && !staples.some((entry) => entry.id === id)) staples.push(row);
      return { phase: "ready", staples };
    });
  const begin = (intent: Staple, expected: StapleRevision | null | undefined, removing = false) => {
    if (operations.current[intent.id]) return;
    const next = Object.freeze({
      ...intent,
      revision: intent.revision && Object.freeze({ ...intent.revision }),
    });
    const token = expected && Object.freeze({ ...expected });
    setDrafts((current) => ({ ...current, [next.id]: next }));
    const op: Operation = { phase: "failed", retired: false, retry: () => {} };
    let flight: Promise<Staple[]> | undefined;
    const write = (): Promise<Staple[]> => {
      if (op.retired || op.phase === "conflict") return Promise.reject(new Error("STALE"));
      if (flight) return flight;
      op.phase = "pending";
      changed();
      flight = (async () => {
        try {
          if (token === undefined) throw new Error("INVALID_INPUT");
          return await (removing
            ? removeStaple(next.id, token!)
            : source.upsertStaple(next, token));
        } catch (error) {
          op.phase =
            error instanceof Error && ["STALE", "INVALID_INPUT"].includes(error.message)
              ? "conflict"
              : "failed";
          changed();
          throw error;
        } finally {
          flight = undefined;
        }
      })();
      return flight;
    };
    op.retry = () => {
      if (op.retired || op.phase !== "failed") return;
      void track(
        write,
        (rows) => {
          accept(next.id, rows);
          clearDraft(next.id);
          delete operations.current[next.id];
          op.retired = true;
          changed();
          if (removing) {
            setOpenId((id) => (id === next.id ? null : id));
            setAnnouncement(`${next.name} removed from future trips.`);
            toast.show(`${next.name} removed from future trips.`);
          } else if (token === null) {
            setAnnouncement(`${next.name} added to ${CUBE_LABELS[stapleCube(next)]}.`);
            toast.show(`${next.name} saved for future trips.`);
          }
        },
        { retryable: () => !op.retired && op.phase === "failed" },
      ).catch(() => {});
    };
    operations.current[next.id] = op;
    op.write = write;
    op.retry();
  };
  const reload = async (id: string) => {
    const op = operations.current[id];
    if (op?.phase === "pending" || op?.phase === "loading") return;
    if (op) {
      op.retired = true;
      if (op.write) discard(op.write);
      op.phase = "loading";
    }
    changed();
    try {
      const rows = await source.listStaples();
      if (rows.find((row) => row.id === id && !row.revision)) throw new Error("INVALID_INPUT");
      accept(id, rows);
      clearDraft(id);
      delete operations.current[id];
    } catch {
      if (op) op.phase = "load-failed";
    }
    changed();
  };

  const close = useCallback((id: string) => {
    setOpenId(null);
    // Escape from the inline editor puts focus back on its row.
    queueMicrotask(() => rowButtons.current[id]?.focus({ preventScroll: true }));
  }, []);

  useEffect(() => {
    if (!laptop || !openId) return;
    // A newly disabled control may lose focus to the body; Escape still closes the editor.
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") close(openId);
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [laptop, openId, close]);

  const staples = useMemo(
    () =>
      load.phase === "ready"
        ? [
            ...load.staples.map((staple) => drafts[staple.id] ?? staple),
            ...Object.values(drafts).filter(
              (draft) => !load.staples.some((row) => row.id === draft.id),
            ),
          ]
        : [],
    [load, drafts],
  );
  const summary = useMemo(
    () => previewStaples(staples, nights, laundry),
    [staples, nights, laundry],
  );
  const sections = useMemo(() => groupByCube(staples), [staples]);
  const rowFor = useMemo(() => new Map(summary.rows.map((row) => [row.staple.id, row])), [summary]);

  // The preview is a read-only what-if: turning it on or off, or moving its inputs, never writes and never touches drafts.
  const togglePreview = (on: boolean) => {
    setPreviewOn(on);
    setAnnouncement(
      on ? `Preview on: ${previewTotalText(summary.total, nights)}.` : "Preview off.",
    );
  };

  const submitAdd = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed === "") return setProblem({ kind: "name" });
    const duplicate = findDuplicate(staples, trimmed, null);
    if (duplicate) return setProblem({ kind: "duplicate", id: duplicate.id });
    const base: Staple = {
      id: newStapleId(),
      name: trimmed,
      qty: 1,
      cadence: "per trip",
      category: "Other essentials",
      packLast: false,
    };
    const created = moveToCube(base, addCube);
    setProblem(null);
    begin(created, null);
    setName("");
    if (!laptop) setOpenId(created.id);
  };

  const head = (
    <header className={styles.head}>
      <h1 className={styles.title}>Staples</h1>
      {load.phase === "ready" ? (
        <p className={styles.headCount}>{stapleCount(staples.length)}</p>
      ) : null}
      <p className={styles.lede}>
        Your Staples start every new trip. Per-day items scale with trip length; special items like
        a passport get added to a trip, and coats come from the weather. Tap an item to change its
        count, cube or laundry setting.
      </p>
      <details className={styles.countRules}>
        <summary>How counts work</summary>
        <ul>
          {STAPLE_COUNT_RULES.map((rule) => (
            <li key={rule.cadence}>
              <strong>{rule.label}</strong> <span>{rule.description}</span>
            </li>
          ))}
        </ul>
        <p>{STAPLE_LAUNDRY_NOTE}</p>
      </details>
    </header>
  );
  const tabs = <StaplesTabs current="staples" />;

  if (load.phase === "loading") {
    return (
      <section className={styles.screen} aria-busy="true" aria-label="Loading staples">
        {head}
        {tabs}
        <div>
          {[0, 1, 2, 3].map((row) => (
            <div className={styles.skeleton} key={row} aria-hidden="true" />
          ))}
        </div>
      </section>
    );
  }

  if (load.phase === "error") {
    return (
      <section className={styles.screen}>
        {head}
        {tabs}
        <div className={styles.state}>
          <strong>Couldn’t load your staples.</strong>
          <p>Nothing was changed.</p>
          <button
            type="button"
            className={styles.stateButton}
            onClick={() => {
              setLoad({ phase: "loading" });
              setReloads((count) => count + 1);
            }}
          >
            Try again
          </button>
        </div>
      </section>
    );
  }

  const opened = openId ? (staples.find((staple) => staple.id === openId) ?? null) : null;
  const controls = (staple: Staple) => ({
    staple,
    locked: Boolean(operations.current[staple.id]) || !staple.revision,
    recovery: (() => {
      const op = operations.current[staple.id];
      if (!op && staple.revision) return null;
      const phase = op?.phase ?? "conflict";
      return (
        <div role="status" aria-label={`Save ${staple.name}`}>
          <p>
            {phase === "pending"
              ? "Saving…"
              : phase === "loading"
                ? "Reloading…"
                : phase === "conflict"
                  ? "This staple changed. Reload to review it."
                  : phase === "load-failed"
                    ? "Couldn’t reload. Try again."
                    : "Couldn’t save. Your change is kept here."}
          </p>
          {phase === "failed" ? (
            <button type="button" onClick={op!.retry}>
              Retry save
            </button>
          ) : null}
          {phase !== "pending" && phase !== "loading" ? (
            <button
              type="button"
              onClick={() => {
                if (!op)
                  operations.current[staple.id] = {
                    phase: "conflict",
                    retired: true,
                    retry: () => {},
                  };
                void reload(staple.id);
              }}
            >
              {phase === "load-failed" ? "Try reload again" : "Reload and discard change"}
            </button>
          ) : null}
        </div>
      );
    })(),
    taken: (name: string, exceptId: string) => findDuplicate(staples, name, exceptId),
    onChange: (next: Staple) => {
      setAddCube(stapleCube(next));
      begin(next, staple.revision);
    },
    onRemove: () => begin(staple, staple.revision, true),
    onClose: () => close(staple.id),
  });

  return (
    <section className={styles.screen}>
      {head}
      {tabs}
      <p className="sr-only" role="status" aria-label="Staples updates">
        {announcement}
      </p>
      <div className={styles.layout}>
        <Suitcase interior="dark" inset="staples" className={styles.case}>
          <form
            className={styles.add}
            onSubmit={submitAdd}
            noValidate
            autoComplete="off"
            aria-label="Add a staple"
          >
            <input
              className={styles.addField}
              name="packing-item-name"
              value={name}
              maxLength={NAME_MAX}
              placeholder="Add a staple…"
              aria-label="Staple name"
              aria-invalid={problem !== null}
              aria-describedby={problem ? "staple-add-problem" : undefined}
              autoComplete="off"
              onChange={(event) => {
                setName(event.target.value);
                setProblem(null);
              }}
            />
            {laptop ? (
              <select
                className={styles.addSelect}
                aria-label="Cube for the new staple"
                value={addCube}
                onChange={(event) => setAddCube(event.target.value as Cube)}
              >
                {STAPLE_CUBES.map((cube) => (
                  <option key={cube} value={cube}>
                    {CUBE_LABELS[cube]}
                  </option>
                ))}
              </select>
            ) : null}
            <button type="submit" className={styles.addButton} aria-label="Add staple">
              <Icon name="plus" size={laptop ? 18 : 22} />
              <span className={styles.addLabel} aria-hidden="true">
                Add
              </span>
            </button>
          </form>
          {problem ? (
            <p id="staple-add-problem" className={styles.addError} role="alert">
              {problem.kind === "name" ? (
                "Enter a name."
              ) : (
                <>
                  {`You already have ${staples.find((s) => s.id === problem.id)?.name ?? "that"}. `}
                  <button
                    type="button"
                    onClick={() => {
                      setOpenId(problem.id);
                      setProblem(null);
                    }}
                  >
                    Edit it instead
                  </button>
                  {"."}
                </>
              )}
            </p>
          ) : null}
          {staples.length === 0 ? (
            <p className={styles.addError}>
              Your Staples list is intentionally empty. Add an item whenever you want it to appear
              on future trips.
            </p>
          ) : null}
          <div className={styles.sections}>
            {sections.map(({ cube, label, staples: inCube }) => {
              const id = `staples-${cube}`;
              const items = inCube.reduce(
                (sum, staple) => sum + (rowFor.get(staple.id)?.qty ?? 0),
                0,
              );
              return (
                <section className={styles.cubeCard} key={cube} aria-labelledby={id}>
                  <div className={styles.cubeHead}>
                    <h2 className={styles.cubeName} id={id}>
                      {label}
                    </h2>
                    <span className={styles.cubeCount}>
                      {!previewOn
                        ? stapleCount(inCube.length)
                        : laptop
                          ? `${stapleCount(inCube.length)} · ${itemsLabel(items)} for ${nightsLabel(nights)}`
                          : itemsLabel(items)}
                    </span>
                  </div>
                  {inCube.length ? (
                    <ul className={styles.list}>
                      {inCube.map((staple) => {
                        const row = rowFor.get(staple.id);
                        return (
                          <StapleRow
                            key={staple.id}
                            staple={staple}
                            total={
                              previewOn && row ? { plain: row.plain, qty: row.qty, nights } : null
                            }
                            laptop={laptop}
                            open={openId === staple.id}
                            onToggle={() => setOpenId(openId === staple.id ? null : staple.id)}
                            buttonRef={(node) => {
                              rowButtons.current[staple.id] = node;
                            }}
                            editor={<StapleInlineEditor {...controls(staple)} />}
                          />
                        );
                      })}
                    </ul>
                  ) : (
                    <p className={styles.empty}>No staples yet</p>
                  )}
                </section>
              );
            })}
          </div>
        </Suitcase>
        <StaplesPreview
          laptop={laptop}
          on={previewOn}
          onToggle={togglePreview}
          nights={nights}
          onNights={setNights}
          laundry={laundry}
          onLaundry={setLaundry}
          summary={summary}
        />
      </div>
      {opened && !laptop ? <StapleSheet key={opened.id} {...controls(opened)} /> : null}
    </section>
  );
}
