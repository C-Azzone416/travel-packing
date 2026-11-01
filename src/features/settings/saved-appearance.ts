import { DEFAULT_APPEARANCE, parseAppearance, type Appearance } from "@/domain/appearance";
import { getAppDb } from "@/server/db/app-db";
import { readAppearance } from "@/server/data/appearance-store";
import { getDataContext } from "@/server/data/runtime";
import * as service from "@/server/data/service";

/** The signed-in person's saved theme, or Base when nobody is signed in, nothing is saved, or the read fails. */
export async function readSavedAppearance(): Promise<Appearance> {
  try {
    const context = await getDataContext();
    if (!context) return DEFAULT_APPEARANCE;
    const result = await service.getAppearance(context);
    return result.ok ? result.data : DEFAULT_APPEARANCE;
  } catch {
    return DEFAULT_APPEARANCE;
  }
}

/**
 * The saved theme of a person who just signed in (their id comes from the provider session, never from a cookie), or
 * undefined if it cannot be read. Used only to refresh the anonymous palette cookie; the cookie never carries the id.
 */
export async function readAppearanceForUser(userId: string): Promise<Appearance | undefined> {
  try {
    const db = await getAppDb();
    return db ? await readAppearance(db, userId) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The theme to render this request with. Signed in: the cookie mirror wins when present (an unknown value means Base),
 * so the first paint needs no database read; with no mirror (a new device, or just after sign-in) the saved theme is
 * read. Signed out: the anonymous palette cookie (#283), else Base; the mirror is ignored. Never an auth decision.
 */
export async function appearanceForRequest(
  cookieValue: string | undefined,
  signedIn: boolean,
  anonymous?: Appearance,
): Promise<Appearance> {
  if (!signedIn) return anonymous ?? DEFAULT_APPEARANCE;
  if (cookieValue !== undefined) return parseAppearance(cookieValue);
  return readSavedAppearance();
}
