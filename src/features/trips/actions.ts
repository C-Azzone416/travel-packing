"use server";

import { redirect } from "next/navigation";
import {
  draftStops,
  type LifecycleState,
  type LifecycleTrip,
  type TripDraft,
} from "@/domain/trip-lifecycle";
import type { AcceptedWeatherDecision } from "./trip-actions";
import * as service from "@/server/data/service";
import type { DataContext } from "@/server/data/context";
import type { ErrorCode, Result } from "@/server/data/result";
import { getDataContext } from "@/server/data/runtime";
import { ACCESS_DENIED_PATH, SIGN_IN_PATH } from "@/server/auth/proxy-handler";
import { toLifecycleState, toLifecycleTrip } from "@/server/trips/to-lifecycle";

export type TripsActionResult =
  { ok: true; state: LifecycleState } | { ok: false; code: ErrorCode };
export type CreateTripActionResult =
  { ok: true; trip: LifecycleTrip } | { ok: false; code: ErrorCode };

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

/**
 * Save a finished draft as a new trip (or a copy of one of the owner's trips). The server re-validates everything:
 * the place by its id (the server looks it up itself; nothing else about it is trusted), the dates, the preferences, and (for a copy) that the source trip
 * is the caller's own. A draft without a confirmed location is INVALID_INPUT.
 */
export async function createTripAction(draft: TripDraft): Promise<CreateTripActionResult> {
  const context = await getDataContext();
  if (!context) return { ok: false, code: "INTERNAL" };
  const route = draft ? draftStops(draft) : [];
  // A route of several stops goes as `stops`; one destination keeps the single-destination form.
  const where =
    route.length > 1
      ? {
          stops: route.map((stop) => ({
            location: { id: stop.location?.id ?? "" },
            arrive: stop.arrive,
            leave: stop.leave,
          })),
        }
      : { location: { id: draft?.location?.id ?? "" }, start: draft?.start, end: draft?.end };
  const saved =
    !route.length || route.some((stop) => !stop.location)
      ? ({ ok: false, error: { code: "INVALID_INPUT" } } as const)
      : draft.mode === "copy" && draft.sourceId
        ? await service.copyTrip(context, {
            sourceId: draft.sourceId,
            ...where,
            theme: draft.theme,
          })
        : await service.createTrip(context, { ...where, config: draft.config, theme: draft.theme });
  if (saved.ok) return { ok: true, trip: toLifecycleTrip(saved.data) };
  if (saved.error.code === "UNAUTHENTICATED") redirect(SIGN_IN_PATH);
  if (saved.error.code === "FORBIDDEN") redirect(ACCESS_DENIED_PATH);
  return { ok: false, code: saved.error.code };
}

/** Atomically save a draft and the weather rows already shown on Shape the list. */
export async function createTripWithWeatherAction(
  draft: TripDraft,
  accepted: AcceptedWeatherDecision[],
): Promise<CreateTripActionResult> {
  const context = await getDataContext();
  if (!context) return { ok: false, code: "INTERNAL" };
  if (!draft?.location) return { ok: false, code: "INVALID_INPUT" };
  const route =
    draft.stops && draft.stops.length > 1
      ? {
          stops: draftStops(draft).map((stop) => ({
            location: { id: stop.location?.id ?? "" },
            arrive: stop.arrive,
            leave: stop.leave,
          })),
        }
      : {
          location: { id: draft.location.id },
          start: draft.start,
          end: draft.end,
        };
  const saved = await service.createTripWithWeatherReview(context, {
    mode: draft.mode,
    sourceId: draft.sourceId,
    ...route,
    config: draft.config,
    theme: draft.theme,
    accepted,
  });
  if (saved.ok) return { ok: true, trip: toLifecycleTrip(saved.data) };
  if (saved.error.code === "UNAUTHENTICATED") redirect(SIGN_IN_PATH);
  if (saved.error.code === "FORBIDDEN") redirect(ACCESS_DENIED_PATH);
  return { ok: false, code: saved.error.code };
}
