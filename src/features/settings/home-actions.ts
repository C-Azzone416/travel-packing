"use server";

import { redirect } from "next/navigation";
import type { SampleLocation } from "@/domain/trip-lifecycle";
import type { TripOrigin } from "@/domain/trip-route";
import { ACCESS_DENIED_PATH, SIGN_IN_PATH } from "@/server/auth/proxy-handler";
import { getDataContext } from "@/server/data/runtime";
import type { ErrorCode } from "@/server/data/result";
import * as service from "@/server/data/service";

export type HomeCityResult = { ok: true; home: TripOrigin | null } | { ok: false; code: ErrorCode };

async function handle(
  operation: (
    context: NonNullable<Awaited<ReturnType<typeof getDataContext>>>,
  ) => ReturnType<typeof service.getHomeCity>,
): Promise<HomeCityResult> {
  const context = await getDataContext();
  if (!context) return { ok: false, code: "INTERNAL" };
  const result = await operation(context);
  if (result.ok) return { ok: true, home: result.data };
  if (result.error.code === "UNAUTHENTICATED") redirect(SIGN_IN_PATH);
  if (result.error.code === "FORBIDDEN") redirect(ACCESS_DENIED_PATH);
  return { ok: false, code: result.error.code };
}

/** Read the signed-in owner's one city-level default. */
export async function getHomeCityAction(): Promise<HomeCityResult> {
  return handle((context) => service.getHomeCity(context));
}

/** Save a canonical place by id, or clear the default. Existing trips retain their own origin. */
export async function updateHomeCityAction(
  location: SampleLocation | null,
): Promise<HomeCityResult> {
  return handle((context) =>
    service.setHomeCity(context, { location: location ? { id: location.id } : null }),
  );
}
