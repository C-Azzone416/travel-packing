"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { StampLabels } from "@/domain/stamps";
import type { LifecycleTrip } from "@/domain/trip-lifecycle";
import type { TripChange, TripsSource } from "@/features/trips/trips-source";

export interface LabelEdit {
  slot1: string | null;
  slot2: string | null;
  /** Which slots the person changed. An unchanged slot keeps whatever is confirmed when the write runs. */
  changed: readonly [boolean, boolean];
}

export interface LabelWriteResult {
  change: TripChange;
  /** The confirmed labels this write was merged over. */
  before: StampLabels;
}

export interface StampLabelWrites {
  /** The trips with a label write in flight. */
  pending: ReadonlySet<string>;
  /**
   * The single code path for a stamp label write (the editor's Save and the top bar's Retry both run it). It marks the trip
   * pending when it starts and clears the mark when it settles, writes after any earlier write of the same trip has settled,
   * and builds its payload then: only the changed slots, over the latest confirmed labels. `screenLabels` is the labels the
   * screen showed, used only when nothing has been confirmed from here yet.
   */
  write: (
    source: TripsSource,
    tripId: string,
    edit: LabelEdit,
    screenLabels?: StampLabels,
  ) => Promise<LabelWriteResult>;
  /** Note a trip the source confirmed by another route (the Trip page's own editor). */
  record: (trip: LifecycleTrip) => void;
  /** The trips as last confirmed from here, laid over what a screen loaded earlier, so every screen shows a retried label at once. */
  overlay: (trips: readonly LifecycleTrip[]) => readonly LifecycleTrip[];
}

const NOTHING: StampLabels = [null, null];

function useWritesState(): StampLabelWrites {
  const [counts, setCounts] = useState<ReadonlyMap<string, number>>(new Map());
  const [confirmed, setConfirmed] = useState<ReadonlyMap<string, LifecycleTrip>>(new Map());
  const confirmedRef = useRef(confirmed);
  useEffect(() => {
    confirmedRef.current = confirmed;
  }, [confirmed]);
  const chains = useRef(new Map<string, Promise<LifecycleTrip | null>>());

  const mark = useCallback((tripId: string, by: 1 | -1) => {
    setCounts((current) => {
      const next = new Map(current);
      const count = (next.get(tripId) ?? 0) + by;
      if (count > 0) next.set(tripId, count);
      else next.delete(tripId);
      return next;
    });
  }, []);

  const record = useCallback((trip: LifecycleTrip) => {
    // Visible to the next write at once, and to the screens when React renders.
    confirmedRef.current = new Map(confirmedRef.current).set(trip.id, trip);
    setConfirmed(confirmedRef.current);
  }, []);

  const write = useCallback<StampLabelWrites["write"]>(
    (source, tripId, edit, screenLabels) => {
      mark(tripId, 1);
      const earlier = chains.current.get(tripId) ?? Promise.resolve(null);
      const run = earlier.then(async (predecessor) => {
        const before: StampLabels =
          predecessor?.stampLabels ??
          confirmedRef.current.get(tripId)?.stampLabels ??
          screenLabels ??
          NOTHING;
        const first = edit.changed[0] ? edit.slot1 : before[0];
        const second = edit.changed[1] ? edit.slot2 : before[1];
        const change = await source.setStampLabels(tripId, first, second);
        // Confirmed BEFORE the trip stops being pending, so nothing can start from the old copy in between.
        record(change.trip);
        return { change, before };
      });
      const link = run.then(
        (result) => result.change.trip,
        () => null,
      );
      chains.current.set(tripId, link);
      const settled = () => {
        if (chains.current.get(tripId) === link) chains.current.delete(tripId);
        mark(tripId, -1);
      };
      run.then(settled, settled);
      return run;
    },
    [mark, record],
  );

  const pending = useMemo<ReadonlySet<string>>(() => new Set(counts.keys()), [counts]);
  const overlay = useCallback<StampLabelWrites["overlay"]>(
    (trips) => {
      if (confirmed.size === 0) return trips;
      return trips.map((trip) => {
        const saved = confirmed.get(trip.id);
        if (!saved) return trip;
        // A copy loaded after the write (a newer updatedAt) wins; otherwise the confirmed one stands in for it.
        if (trip.updatedAt && saved.updatedAt && trip.updatedAt > saved.updatedAt) return trip;
        return saved.updatedAt ? saved : { ...trip, stampLabels: saved.stampLabels };
      });
    },
    [confirmed],
  );
  return useMemo(() => ({ pending, write, record, overlay }), [pending, write, record, overlay]);
}

const WritesContext = createContext<StampLabelWrites | null>(null);

/**
 * One stamp label write queue, pending set and record of confirmed trips for the whole app shell, as long as SaveStatus lives. The
 * top bar's Retry outlives the screen that sent the write, so the queue and what it confirmed cannot belong to a screen.
 */
export function StampLabelWritesProvider({ children }: { children: ReactNode }) {
  const value = useWritesState();
  return <WritesContext.Provider value={value}>{children}</WritesContext.Provider>;
}

/** The shell's instance; a screen rendered without the provider (a unit test) gets one of its own. */
export function useStampLabelWrites(): StampLabelWrites {
  const own = useWritesState();
  return useContext(WritesContext) ?? own;
}
