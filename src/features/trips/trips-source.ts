// The dashboard talks to trips only through this port, so the real data layer (#10)
// can replace the in-memory source without touching any UI.

import { DEFAULT_STAPLES } from "@/domain/calc";
import type { Staple } from "@/domain/trip";
import {
  archiveTrip,
  removeTrip,
  restoreTrip,
  saveDraft,
  undoRemoveTrip,
  type LifecycleResult,
  type LifecycleState,
  type LifecycleTrip,
  type TripDraft,
} from "@/domain/trip-lifecycle";
import { localToday } from "@/lib/today";

export interface TripsSource {
  load(): Promise<LifecycleState>;
  archive(tripId: string): Promise<LifecycleState>;
  restore(tripId: string): Promise<LifecycleState>;
  remove(tripId: string): Promise<LifecycleState>;
  undoRemove(tripId: string): Promise<LifecycleState>;
  /** Persist a finished draft as a new trip. Rejects (and changes nothing) if the draft is incomplete. */
  createTrip(draft: TripDraft): Promise<LifecycleTrip>;
}

export class TripsSourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TripsSourceError";
  }
}

export interface MemorySourceOptions {
  /** Stamps `deletedAt`; injected so the source never reads the clock itself. */
  now: () => number;
  newId?: () => string;
  today?: () => string;
  staples?: readonly Staple[];
}

// Applies the domain commands to an in-memory state. Used until #10 lands, and by tests.
export function createMemoryTripsSource(
  initial: LifecycleState,
  {
    now,
    newId = () => crypto.randomUUID(),
    today = localToday,
    staples = DEFAULT_STAPLES,
  }: MemorySourceOptions,
): TripsSource & { snapshot(): LifecycleState } {
  let state = initial;

  const apply = async (result: LifecycleResult): Promise<LifecycleState> => {
    if (!result.ok) throw new TripsSourceError(result.reason);
    state = result.state;
    return state;
  };

  return {
    snapshot: () => state,
    load: async () => state,
    archive: (id) => apply(archiveTrip(state, id)),
    restore: (id) => apply(restoreTrip(state, id)),
    remove: (id) => apply(removeTrip(state, id, now())),
    createTrip: async (draft) => {
      const result = saveDraft({ ...state, draft }, [...staples], { newId, today: today() });
      if (!result.ok) throw new TripsSourceError(result.reason);
      state = { ...result.state, draft: null };
      return result.trip;
    },
    undoRemove: async (id) => {
      state = undoRemoveTrip(state, id);
      return state;
    },
  };
}
