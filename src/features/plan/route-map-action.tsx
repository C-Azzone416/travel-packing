"use server";

// The live map on Plan a trip (#390). RouteMap draws with d3 and the world's geography, which are server-only (about 0.85 MB
// of data the browser must never download), so the screen asks the server for the drawn map as the person edits the route.
// The action is owner-gated like every other draft action, draws only what it is given (a few places and a travel mode)
// and stores and logs nothing.

import { redirect } from "next/navigation";
import type { ReactElement } from "react";
import { z } from "zod";
import { RouteMap } from "@/components/route-map/RouteMap";
import { ACCESS_DENIED_PATH, SIGN_IN_PATH } from "@/server/auth/proxy-handler";
import { AuthFailure, requireOwner } from "@/server/auth/guard";
import { getDataContext } from "@/server/data/runtime";

const point = z.object({
  lat: z.number().finite().min(-90).max(90),
  lng: z.number().finite().min(-180).max(180),
  label: z.string().max(80),
  code: z.string().max(3).optional(),
  kind: z.enum(["home", "stop"]),
});
const input = z.object({
  points: z.array(point).max(8),
  mode: z.enum(["fly", "drive", "other"]),
  size: z.enum(["laptop", "phone"]),
});

export type RouteMapActionInput = z.input<typeof input>;

/** The sizes: the drawing's own coordinate space (it scales to its container), see the spec's Plan preview tag. */
const SIZES = {
  laptop: { width: 418, height: 160, radius: 12 },
  phone: { width: 346, height: 133, radius: 12 },
} as const;

export async function renderRouteMapAction(raw: RouteMapActionInput): Promise<ReactElement | null> {
  const parsed = input.safeParse(raw);
  if (!parsed.success) return null;
  const context = await getDataContext();
  if (!context) return null;
  try {
    await requireOwner(context.auth.provider, context.auth.allowlist);
  } catch (error) {
    if (error instanceof AuthFailure) {
      redirect(error.code === "UNAUTHENTICATED" ? SIGN_IN_PATH : ACCESS_DENIED_PATH);
    }
    return null;
  }
  const { points, mode, size } = parsed.data;
  return <RouteMap points={points} mode={mode} oceanLabel={size === "laptop"} {...SIZES[size]} />;
}
