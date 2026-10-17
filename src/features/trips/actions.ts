"use server";

import { redirect } from "next/navigation";
import type { LifecycleState } from "@/domain/trip-lifecycle";
import * as service from "@/server/data/service";
import type { DataContext } from "@/server/data/context";
import type { ErrorCode, Result } from "@/server/data/result";
import { getDataContext } from "@/server/data/runtime";
import { ACCESS_DENIED_PATH, SIGN_IN_PATH } from "@/server/auth/proxy-handler";
import { toLifecycleState } from "@/server/trips/to-lifecycle";

export type TripsActionResult =
  { ok: true; state: LifecycleState } | { ok: false; code: ErrorCode };

/** The dashboard's whole state, read through the owner gate. */
async function readState(context: DataContext): Promise<Result<LifecycleState>> {
  const live = await service.listTrips(context);
  if (!live.ok) return live;
  const deleted = await service.listRecentlyDeletedTrips(context);
  if (!deleted.ok) return deleted;
  return { ok: true, data: toLifecycleState(live.data, deleted.data) };
}

/**
 * Run one write (or none), then return the fresh state. Result -> UI mapping:
 * UNAUTHENTICATED -> sign-in, FORBIDDEN -> access denied (both redirect on the server); everything else is returned
 * as a code the dashboard shows as an error with Retry. A missing database configuration is INTERNAL, never a crash.
 */
async function respond(
  write?: (context: DataContext) => Promise<Result<unknown>>,
): Promise<TripsActionResult> {
  const context = await getDataContext();
  if (!context) return { ok: false, code: "INTERNAL" };
  const written = write ? await write(context) : null;
  const outcome = written && !written.ok ? written : await readState(context);
  if (outcome.ok) return { ok: true, state: outcome.data };
  if (outcome.error.code === "UNAUTHENTICATED") redirect(SIGN_IN_PATH);
  if (outcome.error.code === "FORBIDDEN") redirect(ACCESS_DENIED_PATH);
  return { ok: false, code: outcome.error.code };
}

export async function loadTripsAction(): Promise<TripsActionResult> {
  return respond();
}

export async function archiveTripAction(tripId: string): Promise<TripsActionResult> {
  return respond((context) => service.archiveTrip(context, { tripId }));
}

export async function restoreTripAction(tripId: string): Promise<TripsActionResult> {
  return respond((context) => service.restoreArchivedTrip(context, { tripId }));
}

export async function removeTripAction(tripId: string): Promise<TripsActionResult> {
  return respond((context) => service.removeTrip(context, { tripId }));
}

export async function undoRemoveTripAction(tripId: string): Promise<TripsActionResult> {
  return respond((context) => service.undoRemoveTrip(context, { tripId }));
}
