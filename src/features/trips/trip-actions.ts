"use server";

// The trip screen's server actions (#16 on the real data layer). Every one goes through the owner-gated service:
// the owner comes from the session, the trip id from the URL is only a lookup key (another owner's id is
// NOT_FOUND), and the data layer's per-trip lock orders concurrent edits. Result -> UI mapping matches the
// dashboard's: UNAUTHENTICATED -> sign-in, FORBIDDEN -> access denied (redirects), anything else is a code.

import { redirect } from "next/navigation";
import type { ItemEdit } from "@/domain/item-ops";
import type { Signals } from "@/domain/readiness";
import type { ThemeId } from "@/domain/themes";
import type { Staple, TripConfig, Scope } from "@/domain/trip";
import type { LifecycleTrip } from "@/domain/trip-lifecycle";
import { ACCESS_DENIED_PATH, SIGN_IN_PATH } from "@/server/auth/proxy-handler";
import type { DataContext } from "@/server/data/context";
import type { ErrorCode, Result } from "@/server/data/result";
import { getDataContext } from "@/server/data/runtime";
import * as service from "@/server/data/service";
import { toLifecycleTrip } from "@/server/trips/to-lifecycle";
import type { NewToiletryItem } from "./trips-source";

export type TripReadResult = { ok: true; trip: LifecycleTrip } | { ok: false; code: ErrorCode };
export type StaplesReadResult = { ok: true; staples: Staple[] } | { ok: false; code: ErrorCode };
export type TripCommandResult =
  { ok: true; trip: LifecycleTrip; signals: Signals } | { ok: false; code: ErrorCode };

const NO_SIGNALS: Signals = { promptBagPlacement: false, reviewPrompt: false };

type Failure = { ok: false; code: ErrorCode };

async function withContext<T>(
  work: (context: DataContext) => Promise<Result<T>>,
  done: (data: T) => { ok: true } & Record<string, unknown>,
): Promise<Failure | ({ ok: true } & Record<string, unknown>)> {
  const context = await getDataContext();
  if (!context) return { ok: false, code: "INTERNAL" };
  const result = await work(context);
  if (result.ok) return done(result.data);
  if (result.error.code === "UNAUTHENTICATED") redirect(SIGN_IN_PATH);
  if (result.error.code === "FORBIDDEN") redirect(ACCESS_DENIED_PATH);
  return { ok: false, code: result.error.code };
}

type Changed = Promise<Result<service.TripResult>>;

async function command(work: (context: DataContext) => Changed): Promise<TripCommandResult> {
  return withContext(work, (data) => ({
    ok: true as const,
    trip: toLifecycleTrip(data.trip),
    signals: data.signals ?? NO_SIGNALS,
  })) as Promise<TripCommandResult>;
}

export async function getTripAction(tripId: string): Promise<TripReadResult> {
  return withContext(
    (context) => service.getTrip(context, { tripId }),
    (trip) => ({ ok: true as const, trip: toLifecycleTrip(trip) }),
  ) as Promise<TripReadResult>;
}

export async function listStaplesAction(): Promise<StaplesReadResult> {
  return withContext(
    (context) => service.listStaplesForOwner(context),
    (staples) => ({ ok: true as const, staples }),
  ) as Promise<StaplesReadResult>;
}

/** Create or update one staple. The server validates every field; changes apply to future trips only. */
export async function upsertStapleAction(staple: Staple): Promise<StaplesReadResult> {
  return withContext(
    (context) =>
      service.upsertStaple(context, {
        semanticId: staple.id,
        name: staple.name,
        category: staple.category,
        qty: staple.qty,
        cadence: staple.cadence,
        packLast: staple.packLast,
        ...(staple.groupId ? { groupId: staple.groupId } : {}),
      }),
    (staples) => ({ ok: true as const, staples }),
  ) as Promise<StaplesReadResult>;
}

export async function setPackedAction(
  tripId: string,
  itemId: string,
  packed: number,
): Promise<TripCommandResult> {
  return command((context) => service.setPackedItem(context, { tripId, itemId, packed }));
}

export async function togglePackedAction(
  tripId: string,
  itemId: string,
): Promise<TripCommandResult> {
  return command((context) => service.togglePackedItem(context, { tripId, itemId }));
}

export async function incrementPackedAction(
  tripId: string,
  itemId: string,
): Promise<TripCommandResult> {
  return command((context) => service.incrementPackedItem(context, { tripId, itemId }));
}

export async function decrementPackedAction(
  tripId: string,
  itemId: string,
): Promise<TripCommandResult> {
  return command((context) => service.decrementPackedItem(context, { tripId, itemId }));
}

export async function editItemAction(
  tripId: string,
  itemId: string,
  edit: ItemEdit,
): Promise<TripCommandResult> {
  return command((context) =>
    service.editTripItem(context, {
      tripId,
      itemId,
      name: edit.name,
      qty: edit.qty,
      timing: edit.timing,
      scope: edit.scope,
    }),
  );
}

export async function removeItemAction(
  tripId: string,
  itemId: string,
  scope: Scope,
): Promise<TripCommandResult> {
  return command((context) => service.removeItemFromTrip(context, { tripId, itemId, scope }));
}

export async function addToiletryItemAction(
  tripId: string,
  item: NewToiletryItem,
): Promise<TripCommandResult> {
  return command((context) =>
    service.addToiletryItemToTrip(context, {
      tripId,
      name: item.name,
      qty: item.qty,
      packLast: item.packLast,
      scope: item.scope,
    }),
  );
}

export async function confirmBagPlacementAction(tripId: string): Promise<TripCommandResult> {
  return command((context) => service.confirmToiletryBag(context, { tripId }));
}

export async function undoBagPlacementAction(tripId: string): Promise<TripCommandResult> {
  return command((context) => service.undoToiletryBag(context, { tripId }));
}

export async function markReadyAction(tripId: string): Promise<TripCommandResult> {
  return command((context) => service.markTripReady(context, { tripId }));
}

export async function markNotReadyAction(tripId: string): Promise<TripCommandResult> {
  return command((context) => service.markTripNotReady(context, { tripId }));
}

export async function acceptWeatherAction(tripId: string): Promise<TripCommandResult> {
  return command((context) => service.acceptTripWeather(context, { tripId }));
}

export async function skipWeatherAction(tripId: string): Promise<TripCommandResult> {
  return command((context) => service.skipTripWeather(context, { tripId }));
}

export async function reviewWeatherAgainAction(tripId: string): Promise<TripCommandResult> {
  return command((context) => service.reviewTripWeatherAgain(context, { tripId }));
}

export async function setThemeAction(tripId: string, theme: ThemeId): Promise<TripCommandResult> {
  return command((context) => service.setTripTheme(context, { tripId, theme }));
}

export async function updatePreferencesAction(
  tripId: string,
  config: TripConfig,
): Promise<TripCommandResult> {
  return command((context) => service.updateTripPreferences(context, { tripId, config }));
}
