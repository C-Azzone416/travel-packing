"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

/** The trips with a label write in flight, and the one way to start a write. See `useLabelWrites`. */
export interface LabelWrites {
  pending: ReadonlySet<string>;
  /**
   * The single code path for a stamp label write (the editor's Save and the top bar's Retry both run it). It marks the trip
   * pending when it starts and clears the mark when it settles, writes after any earlier write of the same trip has settled,
   * and builds its payload then: only the changed slots, over the latest confirmed labels.
   */
  write: (source: TripsSource, tripId: string, edit: LabelEdit) => Promise<LabelWriteResult>;
}

const NOTHING: StampLabels = [null, null];

/**
 * Keeps stamp label writes in order, at most one in flight per trip. It belongs above anything that can unmount an editor (the
 * laptop/phone switch), so a write that outlives its editor still blocks, and still precedes, the next one for that trip.
 */
export function useLabelWrites(
  getTrips: () => readonly LifecycleTrip[],
  /** Called with the trip as confirmed, BEFORE the trip stops being pending, so nothing can start from the old copy in between. */
  onConfirmed: (trip: LifecycleTrip) => void,
): LabelWrites {
  const [counts, setCounts] = useState<ReadonlyMap<string, number>>(new Map());
  const chains = useRef(new Map<string, Promise<StampLabels | null>>());
  const getTripsRef = useRef(getTrips);
  const confirmedRef = useRef(onConfirmed);
  useEffect(() => {
    getTripsRef.current = getTrips;
    confirmedRef.current = onConfirmed;
  });

  const mark = useCallback((tripId: string, by: 1 | -1) => {
    setCounts((current) => {
      const next = new Map(current);
      const count = (next.get(tripId) ?? 0) + by;
      if (count > 0) next.set(tripId, count);
      else next.delete(tripId);
      return next;
    });
  }, []);

  const write = useCallback<LabelWrites["write"]>(
    (source, tripId, edit) => {
      mark(tripId, 1);
      const earlier = chains.current.get(tripId) ?? Promise.resolve(null);
      const run = earlier.then(async (confirmed) => {
        const before: StampLabels =
          confirmed ??
          getTripsRef.current().find((trip) => trip.id === tripId)?.stampLabels ??
          NOTHING;
        const first = edit.changed[0] ? edit.slot1 : before[0];
        const second = edit.changed[1] ? edit.slot2 : before[1];
        const change = await source.setStampLabels(tripId, first, second);
        confirmedRef.current(change.trip);
        return { change, before };
      });
      const link = run.then(
        (result) => result.change.trip.stampLabels ?? NOTHING,
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
    [mark],
  );

  const pending = useMemo<ReadonlySet<string>>(() => new Set(counts.keys()), [counts]);
  return useMemo(() => ({ pending, write }), [pending, write]);
}
