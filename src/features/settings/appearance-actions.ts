"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { APPEARANCE_COOKIE, APPEARANCE_COOKIE_MAX_AGE, type Appearance } from "@/domain/appearance";
import { ACCESS_DENIED_PATH, SIGN_IN_PATH } from "@/server/auth/proxy-handler";
import { getDataContext } from "@/server/data/runtime";
import * as service from "@/server/data/service";
import type { ErrorCode } from "@/server/data/result";

export type AppearanceResult =
  { ok: true; appearance: Appearance } | { ok: false; code: ErrorCode };

/** Save the person's explicit theme choice. On success the cookie mirror is refreshed so the next render is themed. */
export async function updateAppearanceAction(appearance: Appearance): Promise<AppearanceResult> {
  const context = await getDataContext();
  if (!context) return { ok: false, code: "INTERNAL" };
  const result = await service.updateAppearance(context, { appearance });
  if (result.ok) {
    (await cookies()).set(APPEARANCE_COOKIE, result.data, {
      path: "/",
      maxAge: APPEARANCE_COOKIE_MAX_AGE,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    });
    return { ok: true, appearance: result.data };
  }
  if (result.error.code === "UNAUTHENTICATED") redirect(SIGN_IN_PATH);
  if (result.error.code === "FORBIDDEN") redirect(ACCESS_DENIED_PATH);
  return { ok: false, code: result.error.code };
}
