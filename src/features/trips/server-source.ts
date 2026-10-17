// The dashboard's TripsSource backed by the server actions (the real data layer). Client-safe: it only holds the
// action functions it is given, so tests can pass fakes.

import type { LifecycleState } from "@/domain/trip-lifecycle";
import type { TripsActionResult } from "./actions";
import { TripsSourceError, type TripsSource } from "./trips-source";

export interface TripsActions {
  load(): Promise<TripsActionResult>;
  archive(tripId: string): Promise<TripsActionResult>;
  restore(tripId: string): Promise<TripsActionResult>;
  remove(tripId: string): Promise<TripsActionResult>;
  undoRemove(tripId: string): Promise<TripsActionResult>;
}

/** A failed action becomes a TripsSourceError carrying only the error code (never data). */
async function unwrap(pending: Promise<TripsActionResult>): Promise<LifecycleState> {
  const result = await pending;
  if (!result.ok) throw new TripsSourceError(result.code);
  return result.state;
}

export function createServerTripsSource(actions: TripsActions): TripsSource {
  return {
    load: () => unwrap(actions.load()),
    archive: (id) => unwrap(actions.archive(id)),
    restore: (id) => unwrap(actions.restore(id)),
    remove: (id) => unwrap(actions.remove(id)),
    undoRemove: (id) => unwrap(actions.undoRemove(id)),
  };
}
