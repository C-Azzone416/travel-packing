"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Suitcase } from "@/components/suitcase/Suitcase";
import { useSaveStatus } from "@/components/shell/SaveStatus";
import { Icon } from "@/components/ui/Icon";
import { useToast } from "@/components/ui/Toast";
import { LAPTOP_QUERY, useMediaQuery } from "@/components/ui/useMediaQuery";
import { CUBE_LABELS, type Cube } from "@/domain/cubes";
import type { Staple } from "@/domain/trip";
import { useTripsSource } from "@/features/trips/TripsSourceProvider";
import { removeStapleAction } from "@/features/trips/trip-actions";
import { StapleInlineEditor } from "./StapleInlineEditor";
import { StapleRow } from "./StapleRow";
import { StapleSheet } from "./StapleSheet";
import { StaplesPreview } from "./StaplesPreview";
import { StaplesTabs } from "./StaplesTabs";
import { STAPLE_COUNT_RULES, STAPLE_LAUNDRY_NOTE } from "./staple-count-rules";
import {
  DEFAULT_NIGHTS,
  STAPLE_CUBES,
  groupByCube,
  itemsLabel,
  moveToCube,
  previewStaples,
  stapleCount,
  stapleCube,
} from "./staples-cubes";
import { findDuplicate, newStapleId } from "./staples-view";
import styles from "./Staples.module.css";

type Load = { phase: "loading" } | { phase: "error" } | { phase: "ready"; staples: Staple[] };

const NAME_MAX = 50;

export function StaplesScreen({
  removeStaple = async (id: string) => {
    const result = await removeStapleAction(id);
    if (!result.ok) throw new Error(result.code);
    return result.staples;
  },
}: {
  removeStaple?: (id: string) => Promise<Staple[]>;
} = {}) {
  const source = useTripsSource();
  const { track } = useSaveStatus();
  const toast = useToast();
  const [load, setLoad] = useState<Load>({ phase: "loading" });
  const [reloads, setReloads] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Staple>>({});
  const [announcement, setAnnouncement] = useState("");
  const [nights, setNights] = useState(DEFAULT_NIGHTS);
  const [laundry, setLaundry] = useState(true);
  const [name, setName] = useState("");
  const [addCube, setAddCube] = useState<Cube>("clothing");
  const [problem, setProblem] = useState<
    null | { kind: "name" } | { kind: "duplicate"; id: string }
  >(null);
  const laptop = useMediaQuery(LAPTOP_QUERY);
  // The newest value of each staple being edited, and the save chain per staple (one request at a time, last value wins).
  const latest = useRef<Record<string, Staple>>({});
  const chains = useRef<Record<string, Promise<void>>>({});
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
    delete latest.current[id];
    setDrafts((current) => {
      const { [id]: _gone, ...rest } = current;
      void _gone;
      return rest;
    });
  }, []);

  // Changes save as they are made. The editor shows the new value at once; the list itself changes only when the server
  // confirms. A failure puts the staple back to what is stored, and the save chip shows Error.
  const commit = useCallback(
    (next: Staple) => {
      latest.current[next.id] = next;
      setDrafts((current) => ({ ...current, [next.id]: next }));
      const previous = chains.current[next.id] ?? Promise.resolve();
      chains.current[next.id] = previous.then(async () => {
        if (latest.current[next.id] !== next) return; // a newer change is queued behind this one
        await track(
          () => source.upsertStaple(next),
          (staples) => {
            setLoad({ phase: "ready", staples });
            if (latest.current[next.id] === next) clearDraft(next.id);
          },
        ).catch(() => {
          if (latest.current[next.id] === next) clearDraft(next.id);
        });
      });
    },
    [clearDraft, source, track],
  );

  // Remove goes on the same per-staple chain as the saves, so it cannot overtake an upsert still in flight and bring the
  // staple back; saves still queued behind it are dropped.
  const remove = useCallback(
    (staple: Staple) => {
      delete latest.current[staple.id];
      const previous = chains.current[staple.id] ?? Promise.resolve();
      chains.current[staple.id] = previous.then(async () => {
        await track(
          () => removeStaple(staple.id),
          (staples) => {
            clearDraft(staple.id);
            setLoad({ phase: "ready", staples });
            setOpenId(null);
            setAnnouncement(`${staple.name} removed from future trips.`);
            toast.show(`${staple.name} removed from future trips.`);
          },
        ).catch(() => clearDraft(staple.id));
      });
    },
    [clearDraft, removeStaple, toast, track],
  );

  const close = useCallback((id: string) => {
    setOpenId(null);
    // Escape from the inline editor puts focus back on its row.
    queueMicrotask(() => rowButtons.current[id]?.focus());
  }, []);

  const staples = useMemo(
    () => (load.phase === "ready" ? load.staples.map((staple) => drafts[staple.id] ?? staple) : []),
    [load, drafts],
  );
  const summary = useMemo(
    () => previewStaples(staples, nights, laundry),
    [staples, nights, laundry],
  );
  const sections = useMemo(() => groupByCube(staples), [staples]);
  const rowFor = useMemo(() => new Map(summary.rows.map((row) => [row.staple.id, row])), [summary]);

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
    void track(
      () => source.upsertStaple(created),
      (list) => {
        setLoad({ phase: "ready", staples: list });
        setName("");
        setAnnouncement(`${created.name} added to ${CUBE_LABELS[addCube]}.`);
        toast.show(`${created.name} saved for future trips.`);
        // On a phone the cube is chosen in the sheet after adding, so the new staple opens straight away.
        if (!laptop) setOpenId(created.id);
      },
    ).catch(() => undefined);
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
    taken: (name: string, exceptId: string) => findDuplicate(staples, name, exceptId),
    onChange: (next: Staple) => {
      setAddCube(stapleCube(next));
      commit(next);
    },
    onRemove: () => remove(staple),
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
                      {laptop
                        ? `${stapleCount(inCube.length)} · ${itemsLabel(items)}`
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
                            plain={row?.plain ?? staple.qty}
                            qty={row?.qty ?? staple.qty}
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
